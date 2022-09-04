// To run the project you can use https://www.npmjs.com/package/http-server
// Open the cmd at the project root, and run:
// > http-server

// Build using the Web Audio API (https://webaudio.github.io/web-audio-api/)
// "The primary paradigm is of an audio routing graph, where a number of AudioNode
// objects are connected together to define the overall audio rendering."

// Web Audio API examples: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API

// Using the MediaSessionService
// https://web.dev/media-session/

let volumeSliderElement = document.getElementById("volumeSlider");
let playPauseButton = document.getElementById("playPauseButton");
let audioContext = undefined; // Leave as undefined, until user gesture is performed
let gainNode = undefined;
let audioElement = document.getElementById("audioElement");
audioElement.volume = 1;
audioElement.loop = true;

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
    if (audioContext === undefined) {
        audioContext = new AudioContext();

        var audioBuffer = await getAudioAsync("resources/rain-from-room-loop-smallest.ogg", audioContext);

        playAudioBuffer(audioBuffer, true);

        await initMediaSession();

        return;
    }

    if (audioContext.state === "running") {
        await pauseAudio();
        return;
    }

    if (audioContext.state === "suspended") {
        await playAudio();
        return;
    }
}

async function playAudio() {
    console.log("playAudio");
    await audioContext.resume();
    await audioElement.play();
    navigator.mediaSession.playbackState = "playing";
    playPauseButton.innerHTML = "Pause";
}

async function pauseAudio() {
    console.log("pauseAudio");
    await audioContext.suspend();
    audioElement.pause();
    navigator.mediaSession.playbackState = "paused";
    playPauseButton.innerHTML = "Play";
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
        gainNode.gain.cancelScheduledValues(audioContext.currentTime);
        gainNode.gain.setValueAtTime(gainNode.gain.value, audioContext.currentTime);
        gainNode.gain.linearRampToValueAtTime(volumeSliderElement.value, audioContext.currentTime + 0.25);
    }
});


async function initMediaSession() {
    await playAudio();

    updateMediaSessionStatus();

    navigator.mediaSession.setActionHandler("play", async () => {
        console.log("mediaSession - play");
        await playAudio();
    });
    navigator.mediaSession.setActionHandler("pause", async () => {
        console.log("mediaSession - pause");
        await pauseAudio();
    });
    navigator.mediaSession.setActionHandler("previoustrack", async () => {
        console.log("mediaSession - previoustrack");
    });
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
        console.log("mediaSession - nexttrack");
    });
    navigator.mediaSession.setActionHandler("stop", async () => {
        console.log("mediaSession - stop");
        await initMediaSession();
        await pauseAudio();
    });

    // Sometimes the mediaSession events don't fire, this is backup
    audioElement.addEventListener("play", async () => {
        console.log("audioElement - play");
        await playAudio();
    });
    audioElement.addEventListener("pause", async () => {
        console.log("audioElement - pause");
        await pauseAudio();
    });
}

function updateMediaSessionStatus() {
    navigator.mediaSession.metadata = new MediaMetadata({
        title: "Rain",
        artist: "Soundscape",
        album: "Nature",
        artwork: [
            { src: "https://via.placeholder.com/96", sizes: "96x96", type: "image/png" },
            { src: "https://via.placeholder.com/128", sizes: "128x128", type: "image/png" },
            { src: "https://via.placeholder.com/192", sizes: "192x192", type: "image/png" },
            { src: "https://via.placeholder.com/256", sizes: "256x256", type: "image/png" },
            { src: "https://via.placeholder.com/384", sizes: "384x384", type: "image/png" },
            { src: "https://via.placeholder.com/512", sizes: "512x512", type: "image/png" },
        ]
    });
}