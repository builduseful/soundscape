const FADE_DURATION_SECONDS = 0.25;

export class AudioPlayer {
    constructor(audioElement, { onStateChange } = {}) {
        this.audioElement = audioElement;
        this.audioElement.preload = "auto";
        this.audioElement.loop = true;
        this.audioContext = undefined; // Leave as undefined until a user gesture starts playback.
        this.currentTrackUrl = undefined;
        this.mediaElementSourceNode = undefined;
        this.currentTrackGainNode = undefined;
        this.volume = 1;

        this.bufferCache = new Map();
        this.activeSource = null;
        this.activeBuffer = null;
        this.activeSourceStartedAt = 0;
        this.playbackRequestId = 0;
        this.playbackRequested = false;
        this.onStateChange = onStateChange;
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

    isPlaybackRequested() {
        return this.playbackRequested && this.hasTrack();
    }

    getCurrentPosition() {
        if (!this.hasContext() || !this.activeBuffer) return 0;

        const duration = this.activeBuffer.duration;
        if (!duration) return 0;

        return (this.audioContext.currentTime - this.activeSourceStartedAt) % duration;
    }

    getMediaSessionPositionState() {
        if (!this.activeBuffer) return null;

        return {
            duration: this.activeBuffer.duration,
            playbackRate: 1,
            position: Math.min(this.getCurrentPosition(), this.activeBuffer.duration),
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

        let buffer;

        try {
            buffer = await this.loadBuffer(track.url);
        } catch (error) {
            if (requestId !== this.playbackRequestId) {
                return false;
            }

            throw error;
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

        const previousSource = this.activeSource;
        const nextSource = this.audioContext.createBufferSource();
        nextSource.buffer = buffer;
        nextSource.loop = loop;
        nextSource.loopStart = 0;
        nextSource.loopEnd = buffer.duration;
        nextSource.connect(this.currentTrackGainNode);
        nextSource.start(this.audioContext.currentTime);

        this.activeSource = nextSource;
        this.activeBuffer = buffer;
        this.activeSourceStartedAt = this.audioContext.currentTime;
        this.currentTrackUrl = track.url;
        previousSource?.stop();

        if (shouldLoadMediaElement) {
            this.audioElement.src = track.url;
            this.audioElement.load?.();
        }

        this.audioElement.currentTime = 0;
        this.audioElement.loop = loop;

        if (!this.playbackRequested) {
            return true;
        }

        await this.play();
        return true;
    }

    async loadBuffer(url) {
        if (this.bufferCache.has(url)) return this.bufferCache.get(url);

        const bufferPromise = this.fetchBuffer(url);
        this.bufferCache.set(url, bufferPromise);

        try {
            const audioBuffer = await bufferPromise;
            this.bufferCache.set(url, audioBuffer);
            return audioBuffer;
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
            this.onStateChange?.();
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

    updateVolume(volume) {
        this.volume = Number(volume);

        if (this.currentTrackGainNode) {
            this.currentTrackGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
            this.currentTrackGainNode.gain.setValueAtTime(this.currentTrackGainNode.gain.value, this.audioContext.currentTime);
            this.currentTrackGainNode.gain.linearRampToValueAtTime(this.volume, this.audioContext.currentTime + FADE_DURATION_SECONDS);
        }
    }

    assertTrackSupported(track) {
        if (!track.mime) return;

        const isSupported = this.supportsTrack(track);

        if (!isSupported) {
            throw new Error(`Unsupported audio type: ${track.mime}`);
        }
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
