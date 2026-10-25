// See README.md for how to run the app (container-based static server).
// The app requires HTTP for module loading and the service worker — do not
// open index.html via file://.

// Browser/OS integration is anchored by one long-lived HTMLAudioElement.
// The audible loop intentionally comes from a decoded Web Audio buffer because
// perfect loop points are a hard product requirement for these short files.

import { AudioPlayer } from "./audio-player.js";
import { createLocalSourceResolver } from "./local-source.js";
import {
    configurePlaybackAudioSession,
    initMediaSession,
    registerMediaSessionHandlers,
    updateMediaSessionPlaybackState,
    updateMediaSessionPositionState,
    updateMediaSessionStatus,
} from "./media-session.js";
import { AppMenu } from "./components/app-menu.js";
import { ThemeSelector } from "./components/theme-selector.js";
import { VolumeControl } from "./components/volume-control.js";
import { registerInstallPrompt, registerLaunchQueueConsumer, registerServiceWorker } from "./pwa.js";
import {
    applyThemePreference,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
    watchSystemTheme,
} from "./theme-utils.js";
import { tracks } from "./tracks.js";
const VERSION = "2.0.1";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const KEY_SPACE = " ";
const KEY_ARROW_RIGHT = "ArrowRight";
const KEY_ARROW_LEFT = "ArrowLeft";
const SAVED_VOLUME_KEY = "soundscape.volume";
const SAVED_TRACK_ID_KEY = "soundscape.currentTrackId";
const TITLE_ANIMATION_CLASSES = ["is-changing", "is-changing-next", "is-changing-previous"];
const MEDIA_SESSION_POSITION_INTERVAL_MS = 1000;
const LOADING_LABEL = "Loading soundscape";
// A track already in the cache decodes in a few milliseconds, so showing the
// indicator the instant loading starts would flash it on almost every skip.
// Holding it back until the wait is long enough to notice means it only ever
// appears when there is a real delay to explain. It also has to outlast the
// title change animation: the h1's accessible text only settles when that ends,
// so announcing "loading" sooner would reach a screen reader before the name of
// the track it refers to. A test pins it against the animation duration.
const LOADING_INDICATOR_DELAY_MS = 450;

customElements.define("app-menu", AppMenu);
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
const installButton = document.getElementById("installButton");
const playbackError = document.getElementById("playbackError");
const trackLoading = document.getElementById("trackLoading");
const trackLoadingLabel = document.getElementById("trackLoadingLabel");

const requestedTrackIndex = getTrackIndexFromUrl(globalThis.location?.href);
let currentTrackIndex = requestedTrackIndex === -1 ? getSavedTrackIndex() : requestedTrackIndex;
let currentTrackChangeId = 0;
let mediaSessionPositionTimer = 0;
let loadingIndicatorTimer = 0;

// The local output. Always present, and the one the app falls back to.
const localOutput = new AudioPlayer(audioElement, {
    onStateChange: () => syncPlaybackState(isOutputPlaying()),
    onLoadingChange: syncLoadingIndicator,
    resolveSource: createLocalSourceResolver(audioElement, { override: readCodecOverride() }),
});

// Every playback path asks this rather than naming the local player, so a second
// output — casting was one, and js/AGENTS.md says where to find it — can come
// back as a plugin without the core being untangled again. It is *derived*, never assigned: a variable holding the answer could
// disagree with the transports.
function activeOutput() {
    return localOutput;
}

// --- Input: buttons, keyboard and OS media keys ---------------------------

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
    applyVolume(volumeControl.value);
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
// On `system` the OS can change the colours without asking us. It repaints on
// its own — color-scheme and light-dark() see to that — but the controls that
// fade a colour would each ease there separately, so the swap is marked instant
// the same way a chosen theme's is.
watchSystemTheme();
restoreSavedVolume();
updateTrackTitle();
applyRequestedTrack();
startMediaSession();
registerServiceWorker();
registerInstallPrompt(installButton);
initLaunchQueue();
appVersion.textContent = VERSION;

async function playPauseClick() {
    if (isOutputPlaying()) {
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
    // A modified key is the browser's or the OS's shortcut, not ours: Alt+Left
    // is Back, for one.
    if (event.altKey || event.ctrlKey || event.metaKey) return true;

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

// --- Track selection and navigation ---------------------------------------

async function playNextTrack() {
    return changeTrack(1, "next");
}

async function playPreviousTrack() {
    return changeTrack(-1, "previous");
}

// An app shortcut is an explicit "play this soundscape", so it starts playback
// whichever soundscape it names. Starting it only for the one already showing
// would make the same click behave differently depending on state the user
// cannot see: pick the current track and the room fills, pick any other and the
// title changes over silence. Shortcuts exist only for an installed app, where
// autoplay is not the obstacle it would be on a cold page load.
async function selectTrack(requestedIndex) {
    if (requestedIndex !== currentTrackIndex) {
        const offset = requestedIndex - currentTrackIndex;
        const didChangeTrack = await changeTrack(offset, offset > 0 ? "next" : "previous");

        // A change that failed has already reported itself and rolled back to
        // whatever was loaded before. Starting that would answer the shortcut
        // with the wrong soundscape, over the top of its own error message.
        if (!didChangeTrack) return false;
    }

    if (!isOutputPlaying()) await playAudio();

    return true;
}

async function changeTrack(offset, direction) {
    const trackChangeId = ++currentTrackChangeId;
    const previousTrackIndex = currentTrackIndex;
    currentTrackIndex = (currentTrackIndex + offset + tracks.length) % tracks.length;
    const attemptedTrack = getCurrentTrack();

    try {
        const result = await playCurrentTrack(trackChangeId, direction);
        if (trackChangeId !== currentTrackChangeId) {
            return false;
        }
        return result;
    } catch (error) {
        if (trackChangeId !== currentTrackChangeId) {
            return false;
        }

        // After a failed track change, did the attempted soundscape nonetheless
        // become the loaded one? If it did, the app is on it and rolling the
        // title back would describe a track that is no longer there.
        if (activeOutput().holdsTrack(attemptedTrack)) {
            updateMediaSessionStatus(attemptedTrack);
            syncPlaybackState(isOutputPlaying());
            reportPlaybackFailure("Could not start soundscape track.", error, outputFailureMessage());
            return false;
        }

        currentTrackIndex = previousTrackIndex;
        saveCurrentTrack();
        updateTrackTitle();
        updateMediaSessionStatus(getCurrentTrack());
        syncPlaybackState(isOutputPlaying());
        // Named explicitly: the title has just rolled back, so "this
        // soundscape" would read as the one on screen, not the one that failed.
        reportPlaybackFailure("Could not change soundscape track.", error, outputFailureMessage(), attemptedTrack);
        return false;
    }
}

function getCurrentTrack() {
    return tracks[currentTrackIndex];
}

// A ?track=<slug> URL (e.g. from a manifest app shortcut) wins over the saved
// track so shared/pinned links open on the requested soundscape. Once applied,
// the param is persisted and removed: persisted because on a first visit the
// service worker claims the page and reloads it once, which would otherwise
// discard the choice; removed because leaving it in the address bar would make
// every later reload of that URL override the user's saved soundscape.
function applyRequestedTrack() {
    if (requestedTrackIndex !== -1) {
        saveCurrentTrack();
    }

    stripTrackParamFromUrl();
}

function stripTrackParamFromUrl() {
    const href = globalThis.location?.href;

    if (typeof href !== "string" || typeof globalThis.history?.replaceState !== "function") return;

    const url = new URL(href);

    if (!url.searchParams.has("track")) return;

    url.searchParams.delete("track");
    globalThis.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

// `?codec=aac` forces the local fallback for a session.
//
// Without it the fallback is unreachable by hand on every browser this project
// is developed in: the probe picks Opus, correctly, and the AAC path is only
// ever taken by browsers nobody here is sitting in front of. A flag that cannot
// be exercised is a flag that is not really tested.
//
// Read once, at construction, exactly like the probe it overrides — so it
// cannot change a resolved source under an active track.
function readCodecOverride() {
    try {
        return new URL(globalThis.location?.href ?? "").searchParams.get("codec") ?? undefined;
    } catch {
        return undefined;
    }
}

function getTrackIndexFromUrl(url) {
    if (typeof url !== "string" || url.length === 0) return -1;

    // Base URL is a throwaway — .invalid is reserved and never resolves (RFC 2606)
    const requestedSlug = new URL(url, "http://example.invalid").searchParams.get("track");

    if (!requestedSlug) return -1;

    return tracks.findIndex((track) => track.id === requestedSlug);
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

// An unknown or absent value falls back to the first soundscape, which is also
// what an install from before ids does: its preference was a resource URL under
// a different key, and nothing reads that any more. That costs such a listener
// their selected soundscape once, on one load, and then the new key is written
// and it never happens again. Deliberately not migrated — the app is not widely
// enough used for a one-time reset to be worth carrying translation code for.
function getSavedTrackIndex() {
    const savedTrackId = loadPreference(SAVED_TRACK_ID_KEY);
    const savedTrackIndex = tracks.findIndex((track) => track.id === savedTrackId);

    return savedTrackIndex === -1 ? 0 : savedTrackIndex;
}

function saveCurrentTrack() {
    savePreference(SAVED_TRACK_ID_KEY, getCurrentTrack().id);
}

// --- Title display --------------------------------------------------------

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
    setDocumentTitle(trackTitle);
    restartTitleChangeAnimation(direction);
}

function setTrackTitle(trackTitle) {
    currentTitle.textContent = trackTitle;
    incomingTitle.textContent = "";
    setDocumentTitle(trackTitle);
}

// Keep the app name in the tab so bookmarks and window lists stay identifiable.
function setDocumentTitle(trackTitle) {
    document.title = `${trackTitle} · Soundscape`;
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

// --- Volume ---------------------------------------------------------------

function restoreSavedVolume() {
    const savedVolumeValue = loadPreference(SAVED_VOLUME_KEY);
    const savedVolume = savedVolumeValue === null ? Number.NaN : Number(savedVolumeValue);
    const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : localOutput.getVolume();

    volumeControl.value = String(volume);
    applyVolume(volume);
}

function applyVolume(volume) {
    const output = activeOutput();

    if (output.canControlVolume()) output.setVolume(volume);
}

function isOutputPlaying() {
    return activeOutput().isPlaying();
}

// --- Status messages: errors and the loading indicator --------------------

// Only a failure that left the listener in silence is worth showing. A failed
// track change while audio is playing is absorbed completely — the previous
// soundscape keeps going and pressing next again just works — so surfacing it
// would put a warning over music that never stopped. Those stay console-only,
// which is where a developer wants them anyway.
//
// `message` overrides the default when the failure is not about the soundscape
// — an output's own wording, from failureMessage().
function reportPlaybackFailure(logMessage, error, message, track = getCurrentTrack()) {
    console.warn(logMessage, error);

    if (isOutputPlaying()) return;

    showPlaybackError(message ?? (globalThis.navigator?.onLine === false
        ? `You're offline and ${track.title} hasn't been downloaded yet.`
        : `${track.title} could not be played. Try again, or pick another.`));
}

// The error and the loading bar share one strip and never stand together;
// whichever arrives later wins. A bar that appears clears an older error (see
// syncLoadingIndicator), and an error that appears takes the bar down. The title
// stays dimmed, so a load still running still shows.
function showPlaybackError(message) {
    hideLoadingBar();
    playbackError.textContent = message;
    playbackError.hidden = false;
}

function hideLoadingBar() {
    trackLoadingLabel.textContent = "";
    trackLoading.hidden = true;
}

function syncLoadingIndicator(isLoading) {
    clearTimeout(loadingIndicatorTimer);
    loadingIndicatorTimer = 0;

    if (!isLoading) {
        title.classList.remove("is-loading");
        hideLoadingBar();
        return;
    }

    loadingIndicatorTimer = setTimeout(() => {
        loadingIndicatorTimer = 0;
        // A failure notice from an earlier attempt contradicts a bar that says
        // audio is on its way, and the two sit close enough to collide once
        // reduced motion turns the bar into a line of text. The message is about
        // an attempt that is over; this one is still running.
        clearPlaybackError();
        // Reveal first, write second. A hidden element is out of the
        // accessibility tree entirely, so a screen reader has no live region to
        // observe until it is shown — and it is the text landing in that region
        // that produces the announcement.
        trackLoading.hidden = false;
        trackLoadingLabel.textContent = LOADING_LABEL;
        title.classList.add("is-loading");
    }, LOADING_INDICATOR_DELAY_MS);
}

function clearPlaybackError() {
    if (playbackError.hidden) return;

    playbackError.hidden = true;
    playbackError.textContent = "";
}

// --- Preferences ----------------------------------------------------------

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

// --- Playback -------------------------------------------------------------

async function playCurrentTrack(trackChangeId, direction = "next") {
    const track = getCurrentTrack();
    // Decide from playback intent, not the media element's transient paused
    // state: during a track swap the element is briefly paused (src set +
    // load()), so isPlaying() can read false and wrongly start the new track
    // paused, stopping playback mid-navigation.
    const wasPlaying = activeOutput().isPlaybackRequested();

    saveCurrentTrack();
    updateTrackTitle({ animate: true, direction });

    await activeOutput().startTrack(track, { wasPlaying });

    // Two quick skips leave two of these in flight, and an output can answer the
    // first one last. Writing metadata from a skip that has already been
    // superseded would name a soundscape the output is no longer pointed at, in
    // the OS media UI, with the title on screen disagreeing.
    //
    // Checked here for every output rather than delegated. AudioPlayer has its
    // own internal request guard and used to report this by answering false, but
    // that is a different question — it stops an older decode replacing the
    // active source, not whether this caller may write OS metadata — and an
    // output need not have one at all, which is why the answer is the core's to
    // give.
    if (trackChangeId !== currentTrackChangeId) return false;

    finishTrackChange(track);
    return true;
}

// Set metadata and re-register action handlers after the new source has
// started. Some browsers reset the Media Session association when the
// <audio> element's src changes, so refreshing the handlers here keeps
// keyboard/earphone controls working across track changes.
function finishTrackChange(track) {
    clearPlaybackError();
    updateMediaSessionStatus(track);
    registerMediaSessionHandlers(mediaSessionActions);
    syncPlaybackState(isOutputPlaying());
}

async function playAudio() {
    try {
        const output = activeOutput();

        configurePlaybackAudioSession();

        // Resume if this output is already holding the current soundscape,
        // otherwise load it. Asked as "holds *this* track" rather than "holds
        // anything", so an output holding some other soundscape is never
        // resumed under the current title.
        if (output.holdsTrack(getCurrentTrack())) {
            await output.play();
        } else {
            saveCurrentTrack();
            await output.startTrack(getCurrentTrack());
        }

        clearPlaybackError();
        syncPlaybackState(isOutputPlaying());
    } catch (error) {
        reportPlaybackFailure("Could not start playback.", error, outputFailureMessage());
        syncPlaybackState(isOutputPlaying());
    }
}

// What the active output wants said when it fails. Undefined hands
// reportPlaybackFailure back to its own wording, which is about the soundscape —
// what the local player asks for by answering null.
function outputFailureMessage() {
    return activeOutput().failureMessage() ?? undefined;
}

async function pauseAudio() {
    try {
        await activeOutput().pause();

        syncPlaybackState(false);
    } catch (error) {
        console.warn("Could not pause playback.", error);
        syncPlaybackState(isOutputPlaying());
    }
}

// The local media element's play/pause events mirror app state back into the
// app — OS media controls and headset buttons arrive this way. These name the
// local player rather than asking activeOutput(), because they are *about that
// element*; js/AGENTS.md lists the few paths entitled to do so.
async function handleBrowserPlaybackStart() {
    if (localOutput.isBrowserPlaybackSyncSuppressed()) return;

    try {
        if (!localOutput.isPlaying()) {
            await playAudio();
            return;
        }

        syncPlaybackState(true);
    } catch (error) {
        console.warn("Could not resume playback after the media element started.", error);
        syncPlaybackState(localOutput.isPlaying());
    }
}

async function handleBrowserPlaybackPause() {
    if (localOutput.isBrowserPlaybackSyncSuppressed()) return;

    try {
        if (localOutput.isPlaybackRequested()) {
            await pauseAudio();
            return;
        }

        syncPlaybackState(false);
    } catch (error) {
        console.warn("Could not pause playback after the media element paused.", error);
        syncPlaybackState(localOutput.isPlaying());
    }
}

async function handleVisibilityChange() {
    if (document.hidden || !localOutput.isPlaybackRequested()) return;

    try {
        await localOutput.play();
    } catch (error) {
        console.warn("Could not resume playback after visibility change.", error);
    }

    syncPlaybackState(localOutput.isPlaying());
}

function syncPlaybackState(isPlaying) {
    let playbackState = "none";

    if (isPlaying) {
        playbackState = "playing";
    } else if (localOutput.hasTrack()) {
        playbackState = "paused";
    }

    updateMediaSessionPlaybackState(playbackState);
    syncMediaSessionPositionState();
    updateMediaSessionPositionTimer(isPlaying);
    playPauseButton.setAttribute("aria-label", isPlaying ? PAUSE_LABEL : PLAY_LABEL);
    playPauseButton.dataset.playing = isPlaying ? "true" : "false";
}

// Asked of the active output, which answers null when it has no position yet.
function syncMediaSessionPositionState() {
    updateMediaSessionPositionState(activeOutput().getMediaSessionPositionState());
}

function updateMediaSessionPositionTimer(isPlaying) {
    // Nothing to poll on an output that cannot report a position.
    if (!isPlaying || !activeOutput().canReportPosition()) {
        clearInterval(mediaSessionPositionTimer);
        mediaSessionPositionTimer = 0;
        return;
    }

    if (mediaSessionPositionTimer) return;

    mediaSessionPositionTimer = setInterval(syncMediaSessionPositionState, MEDIA_SESSION_POSITION_INTERVAL_MS);
}

// --- Boot -----------------------------------------------------------------

function startMediaSession() {
    initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
    syncPlaybackState(isOutputPlaying());
}
