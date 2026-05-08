// To run the project you can use https://www.npmjs.com/package/http-server
// Open the cmd at the project root, and run:
// > http-server

// Built using the Web Audio API (https://webaudio.github.io/web-audio-api/)
// "The primary paradigm is of an audio routing graph, where a number of AudioNode
// objects are connected together to define the overall audio rendering."

// Web Audio API examples: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API

// Using the MediaSessionService
// https://web.dev/media-session/

import { AudioPlayer } from "./src/audio-player.js";
import { initMediaSession, updateMediaSessionStatus } from "./src/media-session.js";
import { tracks } from "./src/tracks.js";
import { updateBackgroundImage } from "./src/theme.js";

const PLAY_ICON = `<i class="material-icons">play_arrow</i>`;
const PAUSE_ICON = `<i class="material-icons">pause</i>`;

const volumeSliderElement = document.getElementById("volumeSlider");
const title = document.getElementById("title");
const playPauseButton = document.getElementById("playPauseButton");
const nextButton = document.getElementById("nextButton");
const previousButton = document.getElementById("previousButton");
const audioElement = document.getElementById("audioElement");

audioElement.volume = 1;
audioElement.loop = true;

let currentTrackIndex = 0;

const audioPlayer = new AudioPlayer(audioElement);
const controls = {
    title,
    playPauseButton,
    nextButton,
    previousButton,
};

// Media Session connects browser/OS media controls to the app's playback actions.
const mediaSessionActions = {
    playAudio,
    pauseAudio,
    // Media keys reuse the same track-change functions as the buttons.
    playPreviousTrack,
    playNextTrack,
    initMediaSession: startMediaSession,
};

volumeSliderElement.addEventListener("input", () => {
    audioPlayer.updateVolume(volumeSliderElement.value);
});
playPauseButton.addEventListener("click", playPauseClick);
nextButton.addEventListener("click", playNextTrack);
previousButton.addEventListener("click", playPreviousTrack);

async function playPauseClick() {
    if (!audioPlayer.hasContext()) {
        // Load the current soundscape
        const soundscape = getCurrentTrack();

        await audioPlayer.playTrack(soundscape, true);

        await startMediaSession();

        return;
    }

    if (audioPlayer.state === "running") {
        await pauseAudio();
        return;
    }

    if (audioPlayer.state === "suspended") {
        await playAudio();
        return;
    }
}

async function playNextTrack() {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;

    await playCurrentTrack();
}

async function playPreviousTrack() {
    currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;

    await playCurrentTrack();
}

function getCurrentTrack() {
    return tracks[currentTrackIndex];
}

async function playCurrentTrack() {
    // Load the current soundscape
    const track = getCurrentTrack();

    await audioPlayer.playTrack(track, true, true);
    updateMediaSessionStatus(track);

    // Keep the visual state in sync whenever the current track changes.
    await updateBackgroundImage(track, controls);
}

async function playAudio() {
    console.log("playAudio");
    await audioPlayer.play();
    navigator.mediaSession.playbackState = "playing";

    // Update the play/pause button to show the correct icon
    playPauseButton.innerHTML = PAUSE_ICON;
}

async function pauseAudio() {
    console.log("pauseAudio");
    await audioPlayer.pause();
    navigator.mediaSession.playbackState = "paused";

    // Update the play/pause button to show the correct icon
    playPauseButton.innerHTML = PLAY_ICON;
}

async function startMediaSession() {
    await initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
}
