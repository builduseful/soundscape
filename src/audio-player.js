const FADE_DURATION_SECONDS = 0.25;

export class AudioPlayer {
    constructor(audioElement) {
        this.audioElement = audioElement;
        this.audioContext = undefined; // Leave as undefined, until user gesture is performed
        this.currentTrackUrl = undefined;
        this.mediaElementSourceNode = undefined;
        this.currentTrackGainNode = undefined;
        this.volume = 1;
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

    async playTrack(track, loop, resetContext = false, startPaused = false) {
        this.ensureAudioGraph();
        this.audioElement.loop = loop;

        if (resetContext || this.currentTrackUrl !== track.url) {
            this.currentTrackUrl = track.url;
            this.audioElement.src = track.url;
            this.audioElement.load?.();
        }

        this.audioElement.currentTime = 0;

        if (startPaused) {
            this.audioElement.pause();
            await this.audioContext.suspend();
            return;
        }

        await this.play();
    }

    ensureAudioGraph() {
        if (this.hasContext()) return;

        this.audioContext = new AudioContext();
        this.mediaElementSourceNode = this.audioContext.createMediaElementSource(this.audioElement);
        this.currentTrackGainNode = this.audioContext.createGain();
        this.currentTrackGainNode.gain.value = this.volume;

        this.mediaElementSourceNode
            .connect(this.currentTrackGainNode)
            .connect(this.audioContext.destination);
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
}
