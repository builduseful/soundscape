import { createLocalSourceResolver } from "./local-source.js";

const FADE_DURATION_SECONDS = 0.25;
const TRACK_CROSSFADE_SECONDS = 0.25;
const LOOP_CROSSFADE_MS = 10;
const CROSSFADE_CURVE_STEPS = 64;

// Builds a seamless loop by mixing the file's tail into its head and shortening
// the loop period by the overlap.
//
// The loop plays [0, loopEnd). The sample before the wrap is source[loopEnd - 1]
// and the sample after it is target[0] === source[loopEnd] — genuinely adjacent
// in the source, so the join is continuous by construction. The overlap window
// then fades that tail material out while the real head fades in.
//
// Trimming the period is the part that makes this work: blending into the tail
// while keeping the full length instead leaves the wrap jumping backwards by the
// overlap, which is a discontinuity plus a duplicated head.
export function applyLoopCrossfade(sourceBuffer, audioContext, crossfadeMs = LOOP_CROSSFADE_MS) {
    const sampleRate = sourceBuffer.sampleRate;
    const channels = sourceBuffer.numberOfChannels;
    const originalLength = sourceBuffer.length;
    const overlapSamples = Math.min(
        Math.max(1, Math.round((crossfadeMs * sampleRate) / 1000)),
        Math.floor(originalLength / 2),
    );
    const loopLength = originalLength - overlapSamples;

    const output = audioContext.createBuffer(channels, originalLength, sampleRate);

    for (let ch = 0; ch < channels; ch++) {
        const source = sourceBuffer.getChannelData(ch);
        const target = output.getChannelData(ch);
        target.set(source);

        for (let i = 0; i < overlapSamples; i++) {
            const t = i / overlapSamples;
            // Equal-power sin/cos curves keep perceived loudness constant for
            // noise-like ambience; linear fades create a small dip in the overlap.
            const fadeOut = Math.cos(t * Math.PI / 2);
            const fadeIn = Math.sin(t * Math.PI / 2);
            target[i] = source[loopLength + i] * fadeOut + source[i] * fadeIn;
        }
    }

    return {
        buffer: output,
        loopStart: 0,
        loopEnd: loopLength / sampleRate,
    };
}

export class AudioPlayer {
    /**
     * `resolveSource` answers which local file to play for a track, as
     * `{ url, mime }`. It is injected rather than imported outright so a test
     * can hand this player a fixture file without inventing a catalog entry for
     * it, and so the codec probe has one place to live.
     */
    constructor(
        audioElement,
        { onStateChange, onLoadingChange, resolveSource = createLocalSourceResolver(audioElement) } = {},
    ) {
        this.resolveSource = resolveSource;
        this.codecDowngraded = false;
        this.audioElement = audioElement;
        this.audioElement.preload = "auto";
        this.audioElement.loop = true;
        this.audioContext = undefined; // Leave as undefined until a user gesture starts playback.
        // Identity and fetch state are two different things, and only the first
        // is stable: `currentTrackId` names the soundscape, `currentTrackUrl`
        // names the file this browser resolved for it. Codec selection can give
        // two browsers different URLs for one track, so every identity question
        // — holdsTrack, hasTrack, handover — must ask the id.
        this.currentTrackId = undefined;
        this.currentTrackUrl = undefined;
        this.mediaElementSourceNode = undefined;
        this.currentTrackGainNode = undefined;
        this.outgoingGainNode = undefined;
        this.outgoingSource = null;
        this.volume = 1;

        this.bufferCache = new Map();
        this.activeSource = null;
        this.activeBuffer = null;
        this.activeLoopEnd = 0;
        this.activeSourceStartedAt = 0;
        this.activeSourceQueued = false;
        this.playbackRequestId = 0;
        this.playbackRequested = false;
        this.browserPlaybackSyncSuppressed = false;
        this.loadingRequestId = 0;
        this.onStateChange = onStateChange;
        this.onLoadingChange = onLoadingChange;
    }

    get state() {
        return this.audioContext?.state ?? "suspended";
    }

    hasContext() {
        return this.audioContext !== undefined;
    }

    isPlaying() {
        return this.hasContext() && this.audioContext.state === "running" && !this.audioElement.paused;
    }

    hasTrack() {
        return this.currentTrackId !== undefined;
    }

    // The file this player resolved, for diagnostics. Not identity, and not a
    // PlaybackOutput member — that is holdsTrack's job, below.
    getTrackUrl() {
        return this.currentTrackUrl;
    }

    // Whether this output holds the given soundscape. A PlaybackOutput member,
    // and the reason getTrackUrl() is not one: the caller would otherwise have
    // to know that the local player names a local file while a remote names the
    // AAC twin it derives — remote knowledge sitting in the core.
    holdsTrack(track) {
        return Boolean(track) && this.currentTrackId === track.id;
    }

    isPlaybackRequested() {
        return this.playbackRequested && this.hasTrack();
    }

    // The intent on its own, before asking whether a track has finished loading.
    // This is the reading a handover needs; playback-output.js explains why the
    // two must stay apart, and the contract suite pins the implication.
    wantsPlayback() {
        return this.playbackRequested;
    }

    isBrowserPlaybackSyncSuppressed() {
        return this.browserPlaybackSyncSuppressed;
    }

    // True while a track's audio is still being fetched and decoded. Until that
    // finishes there is nothing to start, so the app keeps playing whatever it
    // was already playing — from the listener's side the new title is up but the
    // sound has not changed yet, which is the gap this reports.
    isLoading() {
        return this.loadingRequestId !== 0;
    }

    getCurrentPosition() {
        if (!this.hasContext() || !this.activeBuffer || !this.activeLoopEnd) return 0;

        return (this.audioContext.currentTime - this.activeSourceStartedAt) % this.activeLoopEnd;
    }

    // Whether this transport can ever report a position, as opposed to whether
    // it has one right now. Two different facts, and the polling timer needs the
    // first: keyed off a null reading it would refuse to arm during the window
    // before the first buffer is set, and nothing would re-arm it afterwards.
    canReportPosition() {
        return true;
    }

    getMediaSessionPositionState() {
        if (!this.activeBuffer || !this.activeLoopEnd) return null;

        return {
            duration: this.activeLoopEnd,
            playbackRate: 1,
            position: Math.min(this.getCurrentPosition(), this.activeLoopEnd),
        };
    }

    /**
     * The PlaybackOutput verb: be on this track, playing iff `wasPlaying`.
     *
     * Deliberately narrower than playTrack below, which it delegates to. The two
     * arguments it drops are not simplifications — they are dead from the app's
     * side. `loop` is passed `true` at every call site the app has, and
     * `resetContext` only forces a media-element reload when the URL is
     * unchanged, which never happens on a track change. Both stay on playTrack
     * because its own tests exercise them.
     *
     * Resolves without reporting whether it was superseded. That answer belongs
     * to the core's track generation, which covers every output the same way;
     * see playback-output.js.
     */
    async startTrack(track, { wasPlaying = true } = {}) {
        await this.playTrack(track, true, true, !wasPlaying);
    }

    /**
     * Plays a track with sample-accurate looping.
     *
     * Intentional standards exception:
     * the general platform recommendation is to make a long-lived
     * HTMLAudioElement the audible transport. This app has a stricter product
     * requirement: loop points must be perfect, and native media-element looping
     * is close but not exact enough for these short ambience files. So the
     * audible path is a decoded AudioBufferSourceNode, while the same long-lived
     * media element is kept in sync as the browser-visible playback surface for
     * Media Session, hardware controls, audio focus, and preload/source state.
     */
    async playTrack(track, loop, resetContext = false, startPaused = false) {
        let source = this.resolveSource(track);

        if (!source) {
            throw new Error(`No local source for track: ${track?.id}`);
        }

        this.assertSourceSupported(source);
        this.ensureAudioGraph();
        const requestId = ++this.playbackRequestId;
        const shouldLoadMediaElement = resetContext || this.currentTrackId !== track.id;
        this.playbackRequested = !startPaused;

        let loopWindow;

        this.beginLoading(requestId);

        try {
            loopWindow = await this.loadBuffer(source.url);
        } catch (error) {
            if (requestId !== this.playbackRequestId) {
                return false;
            }

            const fallback = this.sourceAfterDecodeFailure(error, track);

            if (!fallback) throw error;

            source = fallback;

            try {
                loopWindow = await this.loadBuffer(source.url);
            } catch (retryError) {
                // The same guard as above, and needed for the same reason: a
                // skip during the retry leaves this request superseded, and a
                // superseded request must resolve quietly rather than raise a
                // playback error for a track the listener has already left.
                if (requestId !== this.playbackRequestId) {
                    return false;
                }

                throw retryError;
            }
        } finally {
            this.endLoading(requestId);
        }

        if (requestId !== this.playbackRequestId) {
            return false;
        }

        if (!this.playbackRequested) {
            this.audioElement.pause();
            await this.audioContext.suspend();
        }

        if (requestId !== this.playbackRequestId) {
            return false;
        }

        const { buffer, loopStart, loopEnd } = loopWindow;
        const previousSource = this.activeSource;
        const nextSource = this.audioContext.createBufferSource();
        nextSource.buffer = buffer;
        nextSource.loop = loop;
        nextSource.loopStart = loopStart;
        nextSource.loopEnd = loopEnd;
        nextSource.connect(this.currentTrackGainNode);

        const now = this.audioContext.currentTime;
        const shouldCrossfade = previousSource && this.currentTrackId !== track.id && this.playbackRequested;

        if (shouldCrossfade) {
            // End any previous crossfade that is still fading out so the
            // reused outgoing gain node only carries one source at a time.
            if (this.outgoingSource) {
                try {
                    this.outgoingSource.stop();
                    this.outgoingSource.disconnect(this.outgoingGainNode);
                } catch {}
                this.outgoingSource = null;
            }

            const currentGain = this.currentTrackGainNode.gain.value;
            const outgoingCurve = new Float32Array(CROSSFADE_CURVE_STEPS + 1);
            const incomingCurve = new Float32Array(CROSSFADE_CURVE_STEPS + 1);

            for (let i = 0; i <= CROSSFADE_CURVE_STEPS; i++) {
                const t = i / CROSSFADE_CURVE_STEPS;
                // Equal-power sin/cos curves keep the perceived loudness more
                // constant than a linear fade when two sources overlap.
                outgoingCurve[i] = Math.cos(t * Math.PI / 2) * currentGain;
                incomingCurve[i] = Math.sin(t * Math.PI / 2) * this.volume;
            }

            // Clamp the floating-point endpoint so the fade reaches exactly zero.
            outgoingCurve[CROSSFADE_CURVE_STEPS] = 0;

            previousSource.disconnect(this.currentTrackGainNode);
            previousSource.connect(this.outgoingGainNode);

            this.outgoingGainNode.gain.cancelScheduledValues(now);
            this.outgoingGainNode.gain.setValueAtTime(outgoingCurve[0], now);
            this.outgoingGainNode.gain.setValueCurveAtTime(outgoingCurve, now, TRACK_CROSSFADE_SECONDS);
            previousSource.stop(now + TRACK_CROSSFADE_SECONDS);

            this.currentTrackGainNode.gain.cancelScheduledValues(now);
            this.currentTrackGainNode.gain.setValueAtTime(incomingCurve[0], now);
            this.currentTrackGainNode.gain.setValueCurveAtTime(incomingCurve, now, TRACK_CROSSFADE_SECONDS);

            const fadingSource = previousSource;
            this.outgoingSource = fadingSource;

            setTimeout(() => {
                try {
                    fadingSource.disconnect(this.outgoingGainNode);
                } catch {}
                if (this.outgoingSource === fadingSource) {
                    this.outgoingSource = null;
                }
            }, TRACK_CROSSFADE_SECONDS * 1000 + 100);
        } else {
            previousSource?.stop();
        }

        nextSource.start(now);

        this.activeSource = nextSource;
        this.activeBuffer = buffer;
        this.activeLoopEnd = loopEnd;
        this.activeSourceStartedAt = now;
        this.currentTrackId = track.id;
        this.currentTrackUrl = source.url;
        // If the AudioContext is still suspended, the source start is scheduled but
        // cannot run until resume(). Mark it so the statechange handler can snap the
        // start time to the real playback start.
        this.activeSourceQueued = this.audioContext.state !== "running";

        if (shouldLoadMediaElement) {
            this.audioElement.src = source.url;
            this.audioElement.load?.();
        }

        this.audioElement.currentTime = 0;
        this.audioElement.loop = loop;

        if (!this.playbackRequested) {
            await this.refreshPausedBrowserPlaybackSurface();
            return true;
        }

        await this.play();
        return true;
    }

    // Skipping again mid-load hands the loading state to the newer request
    // without reporting a stop: the listener has been waiting since the first
    // press, so the indicator should stay up rather than blink between tracks.
    beginLoading(requestId) {
        const wasLoading = this.isLoading();

        this.loadingRequestId = requestId;

        if (!wasLoading) {
            this.notifyLoadingChange(true);
        }
    }

    endLoading(requestId) {
        if (this.loadingRequestId !== requestId) return;

        this.loadingRequestId = 0;
        this.notifyLoadingChange(false);
    }

    // endLoading runs in a `finally`, so a throwing indicator would replace the
    // real playback error with its own — destroying the diagnostic and turning a
    // superseded "ignore me" into a rejection. A cosmetic callback must never
    // cost the app that, so it is contained here.
    notifyLoadingChange(isLoading) {
        try {
            this.onLoadingChange?.(isLoading);
        } catch (error) {
            console.warn("Could not update the loading indicator.", error);
        }
    }

    /**
     * The one place a resolved source may change under an active track.
     *
     * Deliberately narrow. Only a *decode* failure downgrades: a fetch error, an
     * HTTP status or a cancelled request says nothing about whether this browser
     * can decode the format, and re-fetching the same bytes in a different
     * container would turn one network problem into two. And only once per page,
     * so a genuinely broken file cannot make every track change re-attempt every
     * encoding.
     */
    sourceAfterDecodeFailure(error, track) {
        if (!error?.isDecodeFailure || this.codecDowngraded) return null;
        if (!this.resolveSource.downgrade?.()) return null;

        this.codecDowngraded = true;

        return this.resolveSource(track);
    }

    async loadBuffer(url) {
        if (this.bufferCache.has(url)) return this.bufferCache.get(url);

        const bufferPromise = this.fetchBuffer(url).then(
            (audioBuffer) => applyLoopCrossfade(audioBuffer, this.audioContext),
        );
        this.bufferCache.set(url, bufferPromise);

        try {
            const loopWindow = await bufferPromise;
            this.bufferCache.set(url, loopWindow);
            return loopWindow;
        } catch (error) {
            if (this.bufferCache.get(url) === bufferPromise) {
                this.bufferCache.delete(url);
            }

            throw error;
        }
    }

    async fetchBuffer(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Could not load audio: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();

        try {
            return await this.audioContext.decodeAudioData(arrayBuffer);
        } catch (error) {
            // Marked rather than inspected by message: "this browser cannot
            // decode this format" and "the file did not arrive" need different
            // answers, and only the decoder can tell them apart.
            throw Object.assign(new Error(`Could not decode audio: ${url}`), {
                isDecodeFailure: true,
                cause: error,
            });
        }
    }

    ensureAudioGraph() {
        if (this.hasContext()) return;

        this.audioContext = new AudioContext();
        this.audioContext.addEventListener?.("statechange", () => {
            this.handleAudioContextStateChange();
        });
        this.mediaElementSourceNode = this.audioContext.createMediaElementSource(this.audioElement);

        // Keep the element connected and playing for browser/OS media plumbing,
        // but make the decoded buffer source the only audible output.
        this.silentGainNode = this.audioContext.createGain();
        this.silentGainNode.gain.value = 0;
        this.mediaElementSourceNode.connect(this.silentGainNode).connect(this.audioContext.destination);

        this.currentTrackGainNode = this.audioContext.createGain();
        this.currentTrackGainNode.gain.value = this.volume;
        this.currentTrackGainNode.connect(this.audioContext.destination);

        // Reused for inter-track crossfades so we don't create/destroy a gain
        // node every time the user skips tracks.
        this.outgoingGainNode = this.audioContext.createGain();
        this.outgoingGainNode.gain.value = 0;
        this.outgoingGainNode.connect(this.audioContext.destination);
    }

    handleAudioContextStateChange() {
        // When the context transitions to "running" for a freshly queued source,
        // snap activeSourceStartedAt to the real playback start so Media Session
        // position doesn't drift by the time spent in loadBuffer / decoding.
        if (this.audioContext.state === "running" && this.activeSourceQueued) {
            this.activeSourceStartedAt = this.audioContext.currentTime;
            this.activeSourceQueued = false;
        }
        this.onStateChange?.();
    }

    async play() {
        this.ensureAudioGraph();
        this.playbackRequested = true;
        await this.audioContext.resume();
        if (!this.playbackRequested) return;

        try {
            await this.audioElement.play();
        } catch (error) {
            this.playbackRequested = false;
            this.audioElement.pause();
            await this.audioContext.suspend();
            throw error;
        }

        if (!this.playbackRequested) {
            this.audioElement.pause();
            await this.audioContext.suspend();
        }
    }

    async pause() {
        this.playbackRequested = false;

        if (!this.hasContext()) return;

        this.audioElement.pause();
        await this.audioContext.suspend();
    }

    // Park the element for a handover, without its own pause event being read
    // back as a person pressing pause.
    //
    // The app already ignores this element's events while a remote owns the
    // soundscape, by asking whether one is active when the event arrives. That
    // question is answered live, and the answer can change first: a session that
    // fails the moment it opens disconnects while this pause is still in flight,
    // so by the time the event is delivered no remote is active, the handback has
    // already resumed local playback, and the event — caused by this very call —
    // reads as "the user paused" and stops the room. Suppressing at the source
    // says the one thing the live read cannot: this pause carries no intent,
    // whoever owns the output by the time anyone hears about it.
    //
    // The release is scheduled rather than awaited, and that is not a detail:
    // the caller is a handover, and making it wait a task before the receiver
    // may start would put a gap in the middle of moving the sound between two
    // outputs. Awaiting the pause alone is exactly what it did before; only the
    // suppression outlives the call, by the one task the pause event needs to be
    // dispatched in.
    async pauseForHandover() {
        this.browserPlaybackSyncSuppressed = true;

        try {
            await this.pause();
        } finally {
            setTimeout(() => {
                this.browserPlaybackSyncSuppressed = false;
            }, 0);
        }
    }

    async refreshPausedBrowserPlaybackSurface() {
        if (!this.audioElement.paused) return;

        // Re-activate the browser-visible media element after a paused track
        // swap so OS media controls keep targeting this media session.
        this.browserPlaybackSyncSuppressed = true;

        try {
            await this.audioElement.play();
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        } catch (error) {
            this.audioElement.pause();
            console.warn("Could not refresh the browser playback surface.", error);
        } finally {
            await new Promise((resolve) => setTimeout(resolve, 0));
            this.browserPlaybackSyncSuppressed = false;
        }
    }

    // Volume is a per-transport capability, because the two kinds of output
    // answer differently for real reasons: the app owns its own output level,
    // whereas on a cast the level being moved may be the speaker's own and
    // outlive the session. Local playback is the unambiguous case.
    canControlVolume() {
        return true;
    }

    getVolume() {
        return this.volume;
    }

    // Port spelling of updateVolume, which keeps its name because it is also the
    // local player's own fade-aware API and is called that throughout its tests.
    setVolume(volume) {
        this.updateVolume(volume);
    }

    // Nothing to override: a local failure is about the soundscape — the file,
    // the network, the decode — which is exactly what the app's default wording
    // already says. A remote returns its own, because "pick another track" sends
    // someone hunting through the catalogue for a fault that is in the room.
    failureMessage() {
        return null;
    }

    updateVolume(volume) {
        this.volume = Number(volume);

        if (this.currentTrackGainNode) {
            this.currentTrackGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.currentTrackGainNode.gain.setValueAtTime(this.currentTrackGainNode.gain.value, this.audioContext.currentTime);
            this.currentTrackGainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + FADE_DURATION_SECONDS);
        }
    }

    assertSourceSupported(source) {
        if (!source.mime || this.supportsSource(source)) return;

        // canPlayType() describes HTMLMediaElement support, but the audible path
        // is decodeAudioData(), which accepts codecs some browsers decline to
        // report on the media element. A conservative "" must not mute the whole
        // app before a single byte is fetched, so warn and let the decode decide.
        console.warn(`The media element reports no support for ${source.mime}. Attempting to decode anyway.`);
    }

    supportsSource(source) {
        if (!source.mime) return true;

        // This is intentionally only a MIME/container/codec gate. The real
        // playback path still proves the file by fetching and decoding it into
        // an AudioBuffer; MediaCapabilities.decodingInfo() needs bitrate,
        // channels, and sample rate, which we do not need for this early check.
        return typeof this.audioElement.canPlayType !== "function"
            || this.audioElement.canPlayType(source.mime) !== "";
    }
}
