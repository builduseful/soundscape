// To run the project you can use https://www.npmjs.com/package/http-server
// Open the cmd at the project root, and run:
// > http-server

// Built using the Web Audio API (https://webaudio.github.io/web-audio-api/)
// "The primary paradigm is of an audio routing graph, where a number of AudioNode
// objects are connected together to define the overall audio rendering."

// Web Audio API examples: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API

// Using the MediaSessionService
// https://web.dev/media-session/

let volumeSliderElement = document.getElementById("volumeSlider");
let title = document.getElementById("title");
let playPauseButton = document.getElementById("playPauseButton");
let nextButton = document.getElementById("nextButton");
let previousButton = document.getElementById("previousButton");
let audioElement = document.getElementById("audioElement");
audioElement.volume = 1;
audioElement.loop = true;

let audioContext = undefined; // Leave as undefined, until user gesture is performed
let currentTrackGainNode = undefined;
let currentTrackSourceNode = undefined;
let currentTrackIndex = 0;

// List of the soundscapes
let tracks = [
    { title: "Rain", url: "resources/soundscapes/rain-from-room-loop-smallest.ogg", image: "resources/artwork/rain.jfif" },
    { title: "Rain & Thunder", url: "resources/soundscapes/rain-and-thunder-loop.ogg", image: "resources/artwork/rain-and-thunder.jfif" },
    { title: "The Open Road", url: "resources/soundscapes/open-road-loop.ogg", image: "resources/artwork/open-road.jfif" },
    { title: "Brown Noise", url: "resources/soundscapes/brown-noise-loop.ogg", image: "resources/artwork/brown-noise.jfif" },
    { title: "Pink Noise", url: "resources/soundscapes/pink-noise-loop.ogg", image: "resources/artwork/pink-noise.jfif" },
    { title: "White Noise", url: "resources/soundscapes/white-noise-loop.ogg", image: "resources/artwork/white-noise.jfif" },
]

function playAudioBuffer(audioBuffer, loop) {
    // Stop the current audio source node (if it exists)
    if (currentTrackSourceNode) {
        currentTrackSourceNode.stop();
        currentTrackSourceNode.disconnect();
        currentTrackGainNode.disconnect();
    }

    // Create a new audio source node (AudioBufferSourceNode)
    currentTrackSourceNode = audioContext.createBufferSource();
    currentTrackSourceNode.buffer = audioBuffer;
    currentTrackSourceNode.loop = loop;

    // Create gain node
    currentTrackGainNode = audioContext.createGain();

    // Specify output
    let destinationNode = audioContext.destination;

    // Setup the audio routing graph: audio source -> gain node -> destination node (i.e. output)
    currentTrackSourceNode
        .connect(currentTrackGainNode)
        .connect(destinationNode);

    currentTrackSourceNode.start(0);
}

async function playPauseClick() {
    if (audioContext === undefined) {
        audioContext = new AudioContext();

        // Load the current soundscape
        const soundscape = tracks[currentTrackIndex];

        var audioBuffer = await getAudioAsync(soundscape.url, audioContext);

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

async function playNextTrack() {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;

    // Load the current soundscape
    const track = tracks[currentTrackIndex];

    audioContext = new AudioContext();
    var audioBuffer = await getAudioAsync(track.url, audioContext);
    playAudioBuffer(audioBuffer, true);
    updateMediaSessionStatus();

    await updateBackgroundImage();
}

async function playPreviousTrack() {
    currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;

    // Load the current soundscape
    const track = tracks[currentTrackIndex];

    audioContext = new AudioContext();
    var audioBuffer = await getAudioAsync(track.url, audioContext);
    playAudioBuffer(audioBuffer, true);
    updateMediaSessionStatus();

    await updateBackgroundImage();
}

async function playAudio() {
    console.log("playAudio");
    await audioContext.resume();
    await audioElement.play();
    navigator.mediaSession.playbackState = "playing";

    // Update the play/pause button to show the correct icon
    playPauseButton.innerHTML = `<i class="material-icons">pause</i>`;
}

async function pauseAudio() {
    console.log("pauseAudio");
    await audioContext.suspend();
    audioElement.pause();
    navigator.mediaSession.playbackState = "paused";

    // Update the play/pause button to show the correct icon
    playPauseButton.innerHTML = `<i class="material-icons">play_arrow</i>`;
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
    if (currentTrackGainNode) {
        currentTrackGainNode.gain.cancelScheduledValues(audioContext.currentTime);
        currentTrackGainNode.gain.setValueAtTime(currentTrackGainNode.gain.value, audioContext.currentTime);
        currentTrackGainNode.gain.linearRampToValueAtTime(volumeSliderElement.value, audioContext.currentTime + 0.25);
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
        await playPreviousTrack();
    });
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
        console.log("mediaSession - nexttrack");
        await playNextTrack();
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
    const track = tracks[currentTrackIndex];

    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: "Soundscape",
        album: "Nature",
        artwork: [
            { src: track.image, sizes: "1024x1024", type: "image/jpeg" },
        ]
    });
}

// Change the background image to the current soundscape image
async function updateBackgroundImage() {
    const track = tracks[currentTrackIndex];

    // Load the image and set it as the background once loaded
    const image = await loadImage(track.image);
    document.body.style.backgroundImage = `url(${image.src})`;

    await getColors();
}

// Get the primary and secondary colors from the current soundscape image using color-thief
// then set the play/pause button background color and text color to the primary color
async function getColors() {
    const track = tracks[currentTrackIndex];

    const colorThief = new ColorThief();
    const image = await loadImage(track.image);

    const color = colorThief.getColor(image);

    const primaryColorString = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.6)`;
    const contrastColor = getContrastColor(color);
    const secondaryColorString = `rgba(${contrastColor[0]}, ${contrastColor[1]}, ${contrastColor[2]}, 0.6)`;

    playPauseButton.style.backgroundColor = secondaryColorString;
    playPauseButton.style.color = primaryColorString;

    previousButton.style.backgroundColor = primaryColorString;
    previousButton.style.color = secondaryColorString;

    nextButton.style.backgroundColor = primaryColorString;
    nextButton.style.color = secondaryColorString;

    title.style.color = secondaryColorString;
}

// Load an image from a given url
function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener("load", () => resolve(image));
        image.addEventListener("error", error => reject(error));
        image.src = url;
    });
}

// Get contrast color based on the given background color
function getContrastColor(color) {
    // Calculate the relative luminance of the color using the sRGB color space
    let r = color[0] / 255;
    let g = color[1] / 255;
    let b = color[2] / 255;
    let luminance = (r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)) * 0.2126
        + (g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)) * 0.7152
        + (b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)) * 0.0722;
    // Calculate the contrast color based on the luminance
    return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
}