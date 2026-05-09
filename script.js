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

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const SAVED_VOLUME_KEY = "soundscape.volume";
const SAVED_TRACK_URL_KEY = "soundscape.currentTrackUrl";

const volumeSliderElement = document.getElementById("volumeSlider");
const title = document.getElementById("title");
const playPauseButton = document.getElementById("playPauseButton");
const nextButton = document.getElementById("nextButton");
const previousButton = document.getElementById("previousButton");
const audioElement = document.getElementById("audioElement");

audioElement.loop = true;

let currentTrackIndex = getSavedTrackIndex();

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
    savePreference(SAVED_VOLUME_KEY, volumeSliderElement.value);
});
playPauseButton.addEventListener("click", playPauseClick);
nextButton.addEventListener("click", playNextTrack);
previousButton.addEventListener("click", playPreviousTrack);

restoreSavedVolume();
updateBackgroundImage(getCurrentTrack(), controls);

async function playPauseClick() {
    if (!audioPlayer.hasContext()) {
        // Load the current soundscape
        const soundscape = getCurrentTrack();

        await audioPlayer.playTrack(soundscape, true);
        const artworkUrl = await updateBackgroundImage(soundscape, controls);

        await startMediaSession(artworkUrl);

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

function getSavedTrackIndex() {
    const savedTrackUrl = loadPreference(SAVED_TRACK_URL_KEY);
    const savedTrackIndex = tracks.findIndex((track) => track.url === savedTrackUrl);

    return savedTrackIndex === -1 ? 0 : savedTrackIndex;
}

function saveCurrentTrack() {
    savePreference(SAVED_TRACK_URL_KEY, getCurrentTrack().url);
}

function restoreSavedVolume() {
    const savedVolumeValue = loadPreference(SAVED_VOLUME_KEY);
    const savedVolume = savedVolumeValue === null ? NaN : Number(savedVolumeValue);
    const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : Number(volumeSliderElement.value);

    volumeSliderElement.value = String(volume);
    audioPlayer.updateVolume(volume);
}

function loadPreference(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.warn(`Could not load ${key}`, error);
        return null;
    }
}

function savePreference(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn(`Could not save ${key}`, error);
    }
}

async function playCurrentTrack() {
    // Load the current soundscape
    const track = getCurrentTrack();
    const wasPlaying = audioPlayer.isPlaying();

    saveCurrentTrack();
    await audioPlayer.playTrack(track, true, true, !wasPlaying);

    // Keep the visual state in sync whenever the current track changes.
    const artworkUrl = await updateBackgroundImage(track, controls);
    updateMediaSessionStatus(track, artworkUrl);
}

async function playAudio() {
    console.log("playAudio");
    await audioPlayer.play();
    navigator.mediaSession.playbackState = "playing";

    playPauseButton.textContent = PAUSE_LABEL;
    playPauseButton.setAttribute("aria-label", PAUSE_LABEL);
}

async function pauseAudio() {
    console.log("pauseAudio");
    await audioPlayer.pause();
    navigator.mediaSession.playbackState = "paused";

    playPauseButton.textContent = PLAY_LABEL;
    playPauseButton.setAttribute("aria-label", PLAY_LABEL);
}

async function startMediaSession(artworkUrl) {
    await initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement, artworkUrl);
}
