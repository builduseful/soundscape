// To run the project you can use https://www.npmjs.com/package/http-server
// Open the cmd at the project root, and run:
// > http-server

// Build using the Web Audio API (https://webaudio.github.io/web-audio-api/)
// "The primary paradigm is of an audio routing graph, where a number of AudioNode
// objects are connected together to define the overall audio rendering."

let volumeSliderElement = document.getElementById("volumeSlider");
let audioContext = undefined; // Leave as undefined, until user gesture is performed
let gainNode = undefined;

function playAudioBuffer(audioBuffer, loop) {
    // Create a new audio source node (AudioBufferSourceNode)
    let audioSourceNode = audioContext.createBufferSource();
    audioSourceNode.buffer = audioBuffer;
    audioSourceNode.loop = loop;

    // Create gain node
    gainNode = audioContext.createGain();

    // Specify output
    let destinationNode = audioContext.destination;

    // Setup the audio routing graph: audio source -> gain node -> destination node (i.e. output)
    audioSourceNode
        .connect(gainNode)
        .connect(destinationNode);

    audioSourceNode.start(0);
}

async function playPauseClick() {
    if (audioContext !== undefined) {
        if (audioContext.state === "running") {
            audioContext.suspend();
            return;
        }

        if (audioContext.state === "suspended") {
            audioContext.resume();
            return;
        }

        return;
    }

    audioContext = new AudioContext();

    var audioBuffer = await getAudioAsync("resources/rain-from-room-loop-smallest.ogg", audioContext);

    playAudioBuffer(audioBuffer, true);
}

/**
 * Gets an AudioBuffer from a given url
 * @param {string} url 
 * @param {AudioContext} audioContext 
 * @returns The AudioBuffer retrieved from the given url
 */
async function getAudioAsync(url, audioContext) {
    let response = await fetch(url);
    let arrayBuffer = await response.arrayBuffer();

    return audioContext.decodeAudioData(arrayBuffer);
}

volumeSliderElement.addEventListener("input", () => {
    if (gainNode) {
        gainNode.gain.value = volumeSliderElement.value / 100.0;
    }
});