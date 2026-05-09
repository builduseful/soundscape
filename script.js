// To run the project you can use https://www.npmjs.com/package/http-server
// Open the cmd at the project root, and run:
// > http-server

// Playback is anchored by a long-lived HTMLAudioElement. Web Audio is layered
// behind it only for the app-level gain control.

import { AudioPlayer } from "./src/audio-player.js";
import {
    configurePlaybackAudioSession,
    initMediaSession,
    updateMediaSessionPlaybackState,
    updateMediaSessionStatus,
} from "./src/media-session.js";
import { ThemeSelector } from "./src/theme-selector.js";
import { VolumeControl } from "./src/volume-control.js";
import {
    applyThemePreference,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
} from "./src/theme-utils.js";
import { tracks } from "./src/tracks.js";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const SAVED_VOLUME_KEY = "soundscape.volume";
const SAVED_TRACK_URL_KEY = "soundscape.currentTrackUrl";
const TITLE_ANIMATION_CLASSES = ["is-changing", "is-changing-next", "is-changing-previous"];

customElements.define("theme-selector", ThemeSelector);
customElements.define("volume-control", VolumeControl);

const volumeControl = document.getElementById("volumeControl");
const title = document.getElementById("title");
const currentTitle = title.querySelector(".track-title-text--current");
const incomingTitle = title.querySelector(".track-title-text--incoming");
const playPauseButton = document.getElementById("playPauseButton");
const nextButton = document.getElementById("nextButton");
const previousButton = document.getElementById("previousButton");
const audioElement = document.getElementById("audioElement");
const themeSelector = document.getElementById("themeSelector");

let currentTrackIndex = getSavedTrackIndex();

const audioPlayer = new AudioPlayer(audioElement);

// Media Session connects browser/OS media controls to the app's playback actions.
const mediaSessionActions = {
    playAudio,
    pauseAudio,
    // Media keys reuse the same track-change functions as the buttons.
    playPreviousTrack,
    playNextTrack,
    onPlaybackStart: () => syncPlaybackState(true),
    onPlaybackPause: () => syncPlaybackState(false),
};

volumeControl.addEventListener("input", () => {
    audioPlayer.updateVolume(volumeControl.value);
    savePreference(SAVED_VOLUME_KEY, volumeControl.value);
});
playPauseButton.addEventListener("click", playPauseClick);
nextButton.addEventListener("click", playNextTrack);
previousButton.addEventListener("click", playPreviousTrack);
themeSelector.addEventListener("theme-change", (event) => {
    updateThemePreference(event.detail.theme);
});
title.addEventListener("animationend", handleTitleAnimationEnd);

updateThemePreference(loadThemePreference(), false);
restoreSavedVolume();
updateTrackTitle();
startMediaSession();

async function playPauseClick() {
    if (audioPlayer.isPlaying()) {
        await pauseAudio();
    } else {
        await playAudio();
    }
}

async function playNextTrack() {
    currentTrackIndex = (currentTrackIndex + 1) % tracks.length;

    await playCurrentTrack("next");
}

async function playPreviousTrack() {
    currentTrackIndex = (currentTrackIndex - 1 + tracks.length) % tracks.length;

    await playCurrentTrack("previous");
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

function updateTrackTitle({ animate = false, direction = "next" } = {}) {
    const trackTitle = getCurrentTrack().title;

    if (
        !animate
        || currentTitle.textContent === trackTitle
        || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
        resetTitleAnimation();
        setTrackTitle(trackTitle);
        return;
    }

    if (title.classList.contains("is-changing")) {
        currentTitle.textContent = incomingTitle.textContent;
    }

    incomingTitle.textContent = trackTitle;
    document.title = `${trackTitle} - Soundscape`;
    restartTitleChangeAnimation(direction);
}

function setTrackTitle(trackTitle) {
    currentTitle.textContent = trackTitle;
    incomingTitle.textContent = "";
    document.title = `${trackTitle} - Soundscape`;
}

function resetTitleAnimation() {
    title.classList.remove(...TITLE_ANIMATION_CLASSES);
}

function handleTitleAnimationEnd(event) {
    if (!event.target.classList.contains("track-title-text--incoming")) return;

    setTrackTitle(incomingTitle.textContent);
    resetTitleAnimation();
}

function restartTitleChangeAnimation(direction) {
    resetTitleAnimation();
    title.offsetWidth;
    title.classList.add("is-changing", `is-changing-${direction}`);
}

function restoreSavedVolume() {
    const savedVolumeValue = loadPreference(SAVED_VOLUME_KEY);
    const savedVolume = savedVolumeValue === null ? Number.NaN : Number(savedVolumeValue);
    const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : Number(volumeControl.value);

    volumeControl.value = String(volume);
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

function updateThemePreference(value, shouldSave = true) {
    const theme = normalizeThemePreference(value);

    applyThemePreference(theme);
    themeSelector.setAttribute("value", theme);

    if (shouldSave) {
        saveThemePreference(theme);
    }
}

async function playCurrentTrack(direction = "next") {
    // Load the current soundscape
    const track = getCurrentTrack();
    const wasPlaying = audioPlayer.isPlaying();

    saveCurrentTrack();
    updateTrackTitle({ animate: true, direction });
    await audioPlayer.playTrack(track, true, true, !wasPlaying);

    updateMediaSessionStatus(track);
    syncPlaybackState(wasPlaying);
}

async function playAudio() {
    configurePlaybackAudioSession();

    if (audioPlayer.hasTrack()) {
        await audioPlayer.play();
    } else {
        saveCurrentTrack();
        await audioPlayer.playTrack(getCurrentTrack(), true);
    }

    syncPlaybackState(true);
}

async function pauseAudio() {
    await audioPlayer.pause();

    syncPlaybackState(false);
}

function syncPlaybackState(isPlaying) {
    let playbackState = "none";

    if (isPlaying) {
        playbackState = "playing";
    } else if (audioPlayer.hasTrack()) {
        playbackState = "paused";
    }

    updateMediaSessionPlaybackState(playbackState);
    playPauseButton.setAttribute("aria-label", isPlaying ? PAUSE_LABEL : PLAY_LABEL);
}

function startMediaSession() {
    initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
    syncPlaybackState(audioPlayer.isPlaying());
}
