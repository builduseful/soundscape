const FADE_DURATION_SECONDS = 0.25;

export class AudioPlayer {
    constructor(audioElement) {
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

        if (this.activeSource) {
            this.activeSource.stop();
            this.activeSource = null;
        }

        if (resetContext || this.currentTrackUrl !== track.url) {
            this.currentTrackUrl = track.url;
            this.audioElement.src = track.url;
            this.audioElement.load?.();
        }

        const buffer = await this.loadBuffer(track.url);
        this.activeSource = this.audioContext.createBufferSource();
        this.activeSource.buffer = buffer;
        this.activeSource.loop = loop;
        this.activeSource.connect(this.currentTrackGainNode);
        this.activeSource.start(0);

        this.audioElement.currentTime = 0;
        this.audioElement.loop = loop;

        if (startPaused) {
            this.audioElement.pause();
            await this.audioContext.suspend();
            return;
        }

        await this.play();
    }

    async loadBuffer(url) {
        if (this.bufferCache.has(url)) return this.bufferCache.get(url);

        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        this.bufferCache.set(url, audioBuffer);
        return audioBuffer;
    }

    ensureAudioGraph() {
        if (this.hasContext()) return;

        this.audioContext = new AudioContext();
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
        await this.audioContext.resume();
        await this.audioElement.play();
    }

    async pause() {
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
