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
    constructor(audioElement, { onStateChange, onLoadingChange } = {}) {
        this.audioElement = audioElement;
        this.audioElement.preload = "auto";
        this.audioElement.loop = true;
        this.audioContext = undefined; // Leave as undefined until a user gesture starts playback.
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
        return this.currentTrackUrl !== undefined;
    }

    getTrackUrl() {
        return this.currentTrackUrl;
    }

    isPlaybackRequested() {
        return this.playbackRequested && this.hasTrack();
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

    getMediaSessionPositionState() {
        if (!this.activeBuffer || !this.activeLoopEnd) return null;

        return {
            duration: this.activeLoopEnd,
            playbackRate: 1,
            position: Math.min(this.getCurrentPosition(), this.activeLoopEnd),
        };
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
        this.assertTrackSupported(track);
        this.ensureAudioGraph();
        const requestId = ++this.playbackRequestId;
        const shouldLoadMediaElement = resetContext || this.currentTrackUrl !== track.url;
        this.playbackRequested = !startPaused;

        let loopWindow;

        this.beginLoading(requestId);

        try {
            loopWindow = await this.loadBuffer(track.url);
        } catch (error) {
            if (requestId !== this.playbackRequestId) {
                return false;
            }

            throw error;
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
        const shouldCrossfade = previousSource && this.currentTrackUrl !== track.url && this.playbackRequested;

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
        this.currentTrackUrl = track.url;
        // If the AudioContext is still suspended, the source start is scheduled but
        // cannot run until resume(). Mark it so the statechange handler can snap the
        // start time to the real playback start.
        this.activeSourceQueued = this.audioContext.state !== "running";

        if (shouldLoadMediaElement) {
            this.audioElement.src = track.url;
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
        if ("ok" in response && !response.ok) {
            throw new Error(`Could not load audio: ${response.status} ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        return this.audioContext.decodeAudioData(arrayBuffer);
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

    updateVolume(volume) {
        this.volume = Number(volume);

        if (this.currentTrackGainNode) {
            this.currentTrackGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.currentTrackGainNode.gain.setValueAtTime(this.currentTrackGainNode.gain.value, this.audioContext.currentTime);
            this.currentTrackGainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + FADE_DURATION_SECONDS);
        }
    }

    assertTrackSupported(track) {
        if (!track.mime || this.supportsTrack(track)) return;

        // canPlayType() describes HTMLMediaElement support, but the audible path
        // is decodeAudioData(), which accepts codecs some browsers decline to
        // report on the media element. A conservative "" must not mute the whole
        // app before a single byte is fetched, so warn and let the decode decide.
        console.warn(`The media element reports no support for ${track.mime}. Attempting to decode anyway.`);
    }

    supportsTrack(track) {
        if (!track.mime) return true;

        // This is intentionally only a MIME/container/codec gate. The real
        // playback path still proves the file by fetching and decoding it into
        // an AudioBuffer; MediaCapabilities.decodingInfo() needs bitrate,
        // channels, and sample rate, which we do not need for this early check.
        return typeof this.audioElement.canPlayType !== "function"
            || this.audioElement.canPlayType(track.mime) !== "";
    }
}
