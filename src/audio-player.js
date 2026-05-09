const FADE_DURATION_SECONDS = 0.25;

export class AudioPlayer {
    constructor(audioElement) {
        this.audioElement = audioElement;
        this.audioContext = undefined; // Leave as undefined, until user gesture is performed
        this.currentTrackGainNode = undefined;
        this.currentTrackSourceNode = undefined;
        this.volume = 1;
    }

    get state() {
        return this.audioContext.state;
    }

    hasContext() {
        return this.audioContext !== undefined;
    }

    isPlaying() {
        return this.hasContext() && this.audioContext.state === "running";
    }

    async playTrack(track, loop, resetContext = false, startPaused = false) {
        if (resetContext || !this.hasContext()) {
            this.audioContext = new AudioContext();
        }

        if (startPaused && this.audioContext.state === "running") {
            await this.audioContext.suspend();
        }

        const audioBuffer = await getAudioAsync(track.url, this.audioContext);
        this.playAudioBuffer(audioBuffer, loop);
    }

    playAudioBuffer(audioBuffer, loop) {
        this.stopCurrentTrack();

        // Create a new audio source node (AudioBufferSourceNode)
        this.currentTrackSourceNode = this.audioContext.createBufferSource();
        this.currentTrackSourceNode.buffer = audioBuffer;
        this.currentTrackSourceNode.loop = loop;

        // Create gain node
        this.currentTrackGainNode = this.audioContext.createGain();
        this.currentTrackGainNode.gain.value = this.volume;

        // Specify output
        const destinationNode = this.audioContext.destination;

        // Setup the audio routing graph: audio source -> gain node -> destination node (i.e. output)
        this.currentTrackSourceNode
            .connect(this.currentTrackGainNode)
            .connect(destinationNode);

        this.currentTrackSourceNode.start(0);
    }

    stopCurrentTrack() {
        // Stop the current audio source node (if it exists)
        if (this.currentTrackSourceNode) {
            this.currentTrackSourceNode.stop();
            this.currentTrackSourceNode.disconnect();
            this.currentTrackGainNode.disconnect();
        }
    }

    async play() {
        await this.audioContext.resume();
        await this.audioElement.play();
    }

    async pause() {
        await this.audioContext.suspend();
        this.audioElement.pause();
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

/**
 * Gets an AudioBuffer from a given url
 * @param {string} url
 * @param {AudioContext} audioContext
 * @returns The AudioBuffer retrieved from the given url
 */
async function getAudioAsync(url, audioContext) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();

    return audioContext.decodeAudioData(arrayBuffer);
}
