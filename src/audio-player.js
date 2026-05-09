const FADE_DURATION_SECONDS = 0.25;

export class AudioPlayer {
    constructor(audioElement) {
        this.audioElement = audioElement;
        this.audioElement.preload = "auto";
        this.audioElement.loop = true;
        this.audioContext = undefined; // Leave as undefined, until user gesture is performed
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
     * NOTE: To achieve perfect gapless transitions, we MUST fetch and decode the 
     * audio into memory (AudioBuffer). Standard streaming via <audio> introduces 
     * audible jitter at the loop point. We keep the <audio> element running 
     * silently in parallel solely to maintain MediaSession/OS integration.
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

        // Web Audio gapless looping: Decode buffer and use high-precision source node.
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

        // Connect the media element source to a gain node with 0 volume 
        // to ensure it "plays" through the context and updates currentTime.
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
        return typeof this.audioElement.canPlayType !== "function"
            || this.audioElement.canPlayType(track.mime) !== "";
    }
}
