// See README.md for how to run the app (container-based static server).
// The app requires HTTP for module loading and the service worker — do not
// open index.html via file://.

// Browser/OS integration is anchored by one long-lived HTMLAudioElement.
// The audible loop intentionally comes from a decoded Web Audio buffer because
// perfect loop points are a hard product requirement for these short files.

import { AudioPlayer } from "./audio-player.js";
import {
    configurePlaybackAudioSession,
    initMediaSession,
    registerMediaSessionHandlers,
    updateMediaSessionPlaybackState,
    updateMediaSessionPositionState,
    updateMediaSessionStatus,
} from "./media-session.js";
import { ThemeSelector } from "./components/theme-selector.js";
import { VolumeControl } from "./components/volume-control.js";
import { registerLaunchQueueConsumer, registerServiceWorker } from "./pwa.js";
import {
    applyThemePreference,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
} from "./theme-utils.js";
import { tracks, trackSlug } from "./tracks.js";
const VERSION = "1.3.0";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const KEY_SPACE = " ";
const KEY_ARROW_RIGHT = "ArrowRight";
const KEY_ARROW_LEFT = "ArrowLeft";
const SAVED_VOLUME_KEY = "soundscape.volume";
const SAVED_TRACK_URL_KEY = "soundscape.currentTrackUrl";
const TITLE_ANIMATION_CLASSES = ["is-changing", "is-changing-next", "is-changing-previous"];
const MEDIA_SESSION_POSITION_INTERVAL_MS = 1000;

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
const appVersion = document.getElementById("appVersion");

let currentTrackIndex = getInitialTrackIndex();
let currentTrackChangeId = 0;
let mediaSessionPositionTimer = 0;

const audioPlayer = new AudioPlayer(audioElement, {
    onStateChange: () => syncPlaybackState(audioPlayer.isPlaying()),
});

// Media Session connects browser/OS media controls to the app's playback actions.
const mediaSessionActions = {
    playAudio,
    pauseAudio,
    // Media keys reuse the same track-change functions as the buttons.
    playPreviousTrack,
    playNextTrack,
    onBrowserPlaybackStart: handleBrowserPlaybackStart,
    onBrowserPlaybackPause: handleBrowserPlaybackPause,
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
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("keydown", handleDocumentKeydown);
document.addEventListener("keyup", handleDocumentKeyup);

updateThemePreference(loadThemePreference(), false);
restoreSavedVolume();
updateTrackTitle();
startMediaSession();
registerServiceWorker();
initLaunchQueue();
appVersion.textContent = `v${VERSION}`;

async function playPauseClick() {
    if (audioPlayer.isPlaying()) {
        await pauseAudio();
    } else {
        await playAudio();
    }
}

async function handleDocumentKeydown(event) {
    if (event.repeat || shouldIgnoreGlobalShortcut(event)) return;

    if (event.key === KEY_SPACE) {
        event.preventDefault();
        await playPauseClick();
        return;
    }

    if (event.key === KEY_ARROW_RIGHT) {
        event.preventDefault();
        await playNextTrack();
        return;
    }

    if (event.key === KEY_ARROW_LEFT) {
        event.preventDefault();
        await playPreviousTrack();
    }
}

function handleDocumentKeyup(event) {
    if (event.key !== KEY_SPACE || shouldIgnoreGlobalShortcut(event)) return;

    event.preventDefault();
}

function shouldIgnoreGlobalShortcut(event) {
    const target = event.target instanceof Element ? event.target : null;

    if (!target) return false;

    if (
        target.isContentEditable
        || target.closest("input, select, textarea, [contenteditable='true']")
    ) {
        return true;
    }

    const button = target.closest("button");

    return Boolean(button && !isTransportButton(button));
}

function isTransportButton(button) {
    return button === playPauseButton
        || button === nextButton
        || button === previousButton;
}

async function playNextTrack() {
    return changeTrack(1, "next");
}

async function playPreviousTrack() {
    return changeTrack(-1, "previous");
}

async function selectTrack(requestedIndex) {
    if (requestedIndex === currentTrackIndex) return false;

    const offset = requestedIndex - currentTrackIndex;

    return changeTrack(offset, offset > 0 ? "next" : "previous");
}

async function changeTrack(offset, direction) {
    const trackChangeId = ++currentTrackChangeId;
    const previousTrackIndex = currentTrackIndex;
    currentTrackIndex = (currentTrackIndex + offset + tracks.length) % tracks.length;
    const attemptedTrack = getCurrentTrack();

    try {
        const result = await playCurrentTrack(direction);
        if (trackChangeId !== currentTrackChangeId) {
            return false;
        }
        return result;
    } catch (error) {
        if (trackChangeId !== currentTrackChangeId) {
            return false;
        }

        if (audioPlayer.getTrackUrl() === attemptedTrack.url) {
            updateMediaSessionStatus(attemptedTrack);
            syncPlaybackState(audioPlayer.isPlaying());
            console.warn("Could not start soundscape track.", error);
            return false;
        }

        currentTrackIndex = previousTrackIndex;
        saveCurrentTrack();
        updateTrackTitle();
        updateMediaSessionStatus(getCurrentTrack());
        syncPlaybackState(audioPlayer.isPlaying());
        console.warn("Could not change soundscape track.", error);
        return false;
    }
}

function getCurrentTrack() {
    return tracks[currentTrackIndex];
}

// A ?track=<slug> URL (e.g. from a manifest app shortcut) wins over the saved
// track so shared/pinned links open on the requested soundscape.
function getInitialTrackIndex() {
    const requestedIndex = getTrackIndexFromUrl(globalThis.location?.href);

    return requestedIndex === -1 ? getSavedTrackIndex() : requestedIndex;
}

function getTrackIndexFromUrl(url) {
    if (typeof url !== "string" || url.length === 0) return -1;

    // Base URL is a throwaway — .invalid is reserved and never resolves (RFC 2606)
    const requestedSlug = new URL(url, "http://example.invalid").searchParams.get("track");

    if (!requestedSlug) return -1;

    return tracks.findIndex((track) => trackSlug(track) === requestedSlug);
}

// With launch_handler "focus-existing", clicking an app shortcut while the app
// is running focuses the existing window instead of navigating. The launch's
// ?track=<slug> arrives here so the shortcut still switches tracks, without a
// reload or a second window.
function initLaunchQueue() {
    registerLaunchQueueConsumer((launchParams) => {
        const requestedIndex = getTrackIndexFromUrl(launchParams?.targetURL);

        if (requestedIndex !== -1) {
            void selectTrack(requestedIndex);
        }
    });
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
    document.title = trackTitle;
    restartTitleChangeAnimation(direction);
}

function setTrackTitle(trackTitle) {
    currentTitle.textContent = trackTitle;
    incomingTitle.textContent = "";
    document.title = trackTitle;
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
    const didStartTrack = await audioPlayer.playTrack(track, true, true, !wasPlaying);
    if (!didStartTrack) return false;

    // Set metadata and re-register action handlers after the new source has
    // started. Some browsers reset the Media Session association when the
    // <audio> element's src changes, so refreshing the handlers here keeps
    // keyboard/earphone controls working across track changes.
    updateMediaSessionStatus(track);
    registerMediaSessionHandlers(mediaSessionActions);
    syncPlaybackState(audioPlayer.isPlaying());
    return true;
}

async function playAudio() {
    try {
        configurePlaybackAudioSession();

        if (audioPlayer.hasTrack()) {
            await audioPlayer.play();
        } else {
            saveCurrentTrack();
            const didStartTrack = await audioPlayer.playTrack(getCurrentTrack(), true);
            if (!didStartTrack) return;
        }

        syncPlaybackState(audioPlayer.isPlaying());
    } catch (error) {
        console.warn("Could not start playback.", error);
        syncPlaybackState(audioPlayer.isPlaying());
    }
}

async function pauseAudio() {
    try {
        await audioPlayer.pause();

        syncPlaybackState(false);
    } catch (error) {
        console.warn("Could not pause playback.", error);
        syncPlaybackState(audioPlayer.isPlaying());
    }
}

async function handleBrowserPlaybackStart() {
    if (audioPlayer.isBrowserPlaybackSyncSuppressed()) return;

    try {
        if (!audioPlayer.isPlaying()) {
            await playAudio();
            return;
        }

        syncPlaybackState(true);
    } catch (error) {
        console.warn("Could not resume playback after the media element started.", error);
        syncPlaybackState(audioPlayer.isPlaying());
    }
}

async function handleBrowserPlaybackPause() {
    if (audioPlayer.isBrowserPlaybackSyncSuppressed()) return;

    try {
        if (audioPlayer.isPlaybackRequested()) {
            await pauseAudio();
            return;
        }

        syncPlaybackState(false);
    } catch (error) {
        console.warn("Could not pause playback after the media element paused.", error);
        syncPlaybackState(audioPlayer.isPlaying());
    }
}

async function handleVisibilityChange() {
    if (document.hidden || !audioPlayer.isPlaybackRequested()) return;

    try {
        await audioPlayer.play();
    } catch (error) {
        console.warn("Could not resume playback after visibility change.", error);
    }

    syncPlaybackState(audioPlayer.isPlaying());
}

function syncPlaybackState(isPlaying) {
    let playbackState = "none";

    if (isPlaying) {
        playbackState = "playing";
    } else if (audioPlayer.hasTrack()) {
        playbackState = "paused";
    }

    updateMediaSessionPlaybackState(playbackState);
    syncMediaSessionPositionState();
    updateMediaSessionPositionTimer(isPlaying);
    playPauseButton.setAttribute("aria-label", isPlaying ? PAUSE_LABEL : PLAY_LABEL);
    playPauseButton.dataset.playing = isPlaying ? "true" : "false";
}

function syncMediaSessionPositionState() {
    updateMediaSessionPositionState(audioPlayer.getMediaSessionPositionState());
}

function updateMediaSessionPositionTimer(isPlaying) {
    if (!isPlaying) {
        clearInterval(mediaSessionPositionTimer);
        mediaSessionPositionTimer = 0;
        return;
    }

    if (mediaSessionPositionTimer) return;

    mediaSessionPositionTimer = setInterval(syncMediaSessionPositionState, MEDIA_SESSION_POSITION_INTERVAL_MS);
}

function startMediaSession() {
    initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
    syncPlaybackState(audioPlayer.isPlaying());
}
