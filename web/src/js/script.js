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
import { GestureTutorial } from "./components/gesture-tutorial.js";
import { ThemeSelector } from "./components/theme-selector.js";
import { TrackScene } from "./components/track-scene.js";
import { attachGestures } from "./gestures.js";
import { registerInstallPrompt, registerLaunchQueueConsumer, registerServiceWorker } from "./pwa.js";
import {
    applyThemePreference,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
    watchSystemTheme,
} from "./theme-utils.js";
import { tracks } from "./tracks.js";
const VERSION = "2.1.13";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const KEY_SPACE = " ";
const KEY_ARROW_RIGHT = "ArrowRight";
const KEY_ARROW_LEFT = "ArrowLeft";
const KEY_ARROW_UP = "ArrowUp";
const KEY_ARROW_DOWN = "ArrowDown";
const SAVED_VOLUME_KEY = "soundscape.volume";
// How far a key or a notch of the wheel moves the volume, as a fraction of the
// whole: small enough to land on a level, large enough that crossing the range
// is a gesture rather than a chore.
const VOLUME_STEP = 0.05;
const SAVED_TRACK_ID_KEY = "soundscape.currentTrackId";
const TUTORIAL_DONE_KEY = "soundscape.gestureTutorialDone";
// After the page's own fade in, so the guide arrives into a settled screen.
const TUTORIAL_DELAY_MS = 900;
// Left alone this long, the screen rests.
const REST_AFTER_MS = 3000;
// The slowest a swipe carries on, in px/ms, for one let go almost still.
const SWIPE_MIN_SPEED = 0.6;
// However quick or slow the finger, a swipe finishes within these.
const SWIPE_MIN_MS = 160;
const SWIPE_MAX_MS = 420;
// Ease-out cubic: it starts at three times its average speed, which is how a
// swipe is timed to carry on at the finger's speed.
const SWIPE_EASING = "cubic-bezier(0.33, 1, 0.68, 1)";
const SWIPE_SETTLE_MS = 360;
// Paused, the drawing is this faint, and breathes out to PAUSED_SCENE_BREATH
// and SCENE_BREATH_SCALE of its size and back in over SCENE_BREATH_MS.
const PAUSED_SCENE = 0.55;
const PAUSED_SCENE_BREATH = 0.4;
const SCENE_BREATH_SCALE = 0.96;
const SCENE_BREATH_MS = 5000;
// The breath is slow enough that a step this often moves it less than a pixel,
// so it reads as smooth; drawn every frame instead, it would cost a frame at
// each refresh of the screen.
const SCENE_BREATH_STEP_MS = 100;
const SCENE_DIM_MS = 900;
const FADE_EASING = "cubic-bezier(0.37, 0, 0.63, 1)";
// How far across, as a share of the page, a swipe takes the sound down to nothing.
const SWIPE_FADE_DISTANCE = 0.5;
// The OS carries the position on by itself from each reading, so it is given a
// new one only where the loop starts over; before there is one, it is asked
// again this soon.
const MEDIA_SESSION_POSITION_RETRY_MS = 1000;
const LOADING_LABEL = "Loading soundscape";
// A track already in the cache decodes in a few milliseconds, so showing the
// indicator the instant loading starts would flash it on almost every skip.
// Holding it back until the wait is long enough to notice means it only ever
// appears when there is a real delay to explain. It also has to outlast a page
// turned by a key, so it never shows on a page still moving. A test pins it
// against the turn.
const LOADING_INDICATOR_DELAY_MS = 450;

customElements.define("app-menu", AppMenu);
customElements.define("gesture-tutorial", GestureTutorial);
customElements.define("theme-selector", ThemeSelector);
customElements.define("track-scene", TrackScene);

const title = document.getElementById("title");
const titleText = title.querySelector(".track-title-text");
const playPauseButton = document.getElementById("playPauseButton");
const nextButton = document.getElementById("nextButton");
const previousButton = document.getElementById("previousButton");
// The same question style.css asks, and for the same reason.
const touchScreen = globalThis.matchMedia?.("(hover: none) and (pointer: coarse)");
const audioElement = document.getElementById("audioElement");
const themeSelector = document.getElementById("themeSelector");
const appVersion = document.getElementById("appVersion");
const installButton = document.getElementById("installButton");
const playbackError = document.getElementById("playbackError");
const trackLoading = document.getElementById("trackLoading");
const trackLoadingLabel = document.getElementById("trackLoadingLabel");
const trackStatus = document.getElementById("trackStatus");
const trackScene = document.getElementById("trackScene");
const gestureVolume = document.getElementById("gestureVolume");
const gestureTutorial = document.getElementById("gestureTutorial");
const trackPeek = document.getElementById("trackPeek");
const trackPeekScene = document.getElementById("trackPeekScene");
const trackPeekTitle = document.getElementById("trackPeekTitle");

const requestedTrackIndex = getTrackIndexFromUrl(globalThis.location?.href);
let currentTrackIndex = requestedTrackIndex === -1 ? getSavedTrackIndex() : requestedTrackIndex;
let currentTrackChangeId = 0;
let mediaSessionPositionTimer = 0;
let loadingIndicatorTimer = 0;
let restTimer = 0;
let tutorialOpen = false;
// The level the sound is set to, from 0 to 1, and where a drag found it.
let volume = 1;
let volumeAtGestureStart = 0;
let volumeDragging = false;
let swipeDx = 0;
let swipeDragging = false;
// Which neighbour the peek shows: -1 the previous, 1 the next, 0 neither.
let peekSide = 0;
// Ends the name and drawing's carrying on after a drag, or settling back, at once.
let swipeMotion = null;
// When the paused drawings began to breathe, so every one breathes in step;
// their breaths, and the timer for the next step.
let breathStart = null;
let breaths = [];
let breathStep = null;

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

playPauseButton.addEventListener("click", playPauseClick);
nextButton.addEventListener("click", playNextTrack);
previousButton.addEventListener("click", playPreviousTrack);
touchScreen?.addEventListener("change", syncTransportTabStops);
syncTransportTabStops();
themeSelector.addEventListener("theme-change", (event) => {
    updateThemePreference(event.detail.theme);
});
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("keydown", handleDocumentKeydown);
document.addEventListener("keyup", handleDocumentKeyup);
document.addEventListener("wheel", handleWheel, { passive: false });
for (const type of ["pointermove", "pointerdown", "keydown"]) document.addEventListener(type, handleActivity);
gestureTutorial.addEventListener("tutorial-done", () => {
    savePreference(TUTORIAL_DONE_KEY, "true");
    tutorialOpen = false;
    wake();
});
attachGestures(document.querySelector(".container"), {
    onPress: () => setPressed(true),
    onRelease: () => setPressed(false),
    onTap: handleTapGesture,
    onSwipeMove: handleSwipeMove,
    onSwipe: handleSwipeGesture,
    onSwipeCancel: handleSwipeCancel,
    onVolumeStart: handleVolumeGestureStart,
    onVolumeChange: handleVolumeGestureChange,
    onVolumeEnd: handleVolumeGestureEnd,
    onVolumeCancel: handleVolumeGestureCancel,
});

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
// The local player's files, so asked of it by name: no other output has any.
registerServiceWorker({ onFirstControl: () => localOutput.recacheBuffers() });
registerInstallPrompt(installButton);
initLaunchQueue();
appVersion.textContent = VERSION;
offerGestureTutorial();

async function playPauseClick() {
    if (isOutputPlaying()) {
        await pauseAudio();
    } else {
        await playAudio();
    }
}

async function handleDocumentKeydown(event) {
    if (shouldIgnoreGlobalShortcut(event)) return;

    // Held, it keeps going, as a slider's does.
    if (event.key === KEY_ARROW_UP || event.key === KEY_ARROW_DOWN) {
        event.preventDefault();
        stepVolume(event.key === KEY_ARROW_UP ? 1 : -1);
        return;
    }

    if (event.repeat) return;

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

// --- Gestures -------------------------------------------------------------

async function handleTapGesture() {
    hideGestureVolume();
    gestureTutorial.completed("tap");
    await playPauseClick();
}

// The soundscapes lie side by side, a screen's width apart, and a swipe turns
// from one to the next as a page does: the name and drawing are under the
// finger, the neighbour coming in beside them. Let go heading on and they
// carry on at the finger's speed until the neighbour is in place; let go
// short, or heading back, and they settle home.
function pageWidth() {
    return document.documentElement.clientWidth;
}

function placeSwipe(dx) {
    const width = pageWidth();
    const side = dx < 0 ? 1 : -1;

    if (side !== peekSide) showPeek(side);
    trackStatus.style.transform = `translateX(${dx}px)`;
    trackPeek.style.transform = `translateX(${dx + side * width}px)`;
}

function showPeek(side, track = tracks[(currentTrackIndex + side + tracks.length) % tracks.length]) {
    peekSide = side;
    trackPeekScene.setAttribute("track", track.id);
    trackPeekScene.toggleAttribute("playing", trackScene.hasAttribute("playing"));
    trackPeekTitle.textContent = track.title;
    trackPeek.hidden = false;
}

function hidePeek() {
    peekSide = 0;
    trackPeek.hidden = true;
    trackPeekScene.removeAttribute("playing");
    trackPeek.style.transform = "";
}

function setPressed(pressed) {
    for (const element of [trackStatus, trackPeek]) {
        if (pressed) element.dataset.pressed = "";
        else delete element.dataset.pressed;
    }
}

function handleSwipeMove(dx) {
    // A drag that starts while the last swipe is still moving takes over from
    // where that would have ended.
    if (!swipeDragging) {
        swipeMotion?.();
        hideGestureVolume();
    }
    swipeDragging = true;
    swipeDx = dx;
    placeSwipe(dx);
    // The sound goes as the page turns: gently at first, so a touch that
    // wanders is not heard, and gone by halfway.
    if (isOutputPlaying()) {
        const turned = Math.min(1, Math.abs(dx) / (pageWidth() * SWIPE_FADE_DISTANCE));

        activeOutput().setPresence(Math.cos((turned * Math.PI) / 2));
    }
}

// Both moved from where the drag left them to `to`, the current one's offset.
function slide(to, duration) {
    const from = swipeDx;
    const width = pageWidth();
    const options = { duration, easing: SWIPE_EASING };

    swipeDragging = false;
    swipeDx = 0;
    trackStatus.style.transform = "";
    trackPeek.style.transform = "";
    const motion = trackStatus.animate(
        [{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }],
        { ...options, fill: "forwards" },
    );
    trackPeek.animate(
        [{ transform: `translateX(${from + peekSide * width}px)` }, { transform: `translateX(${to + peekSide * width}px)` }],
        { ...options, fill: "forwards" },
    );
    return motion;
}

async function handleSwipeGesture(direction, velocity) {
    const side = direction === "next" ? 1 : -1;

    gestureTutorial.completed("swipe");
    if (side !== peekSide) showPeek(side);
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const end = -side * pageWidth();
    const speed = Math.max(-velocity * side, SWIPE_MIN_SPEED);
    const duration = reduced ? 0 : Math.min(Math.max((3 * Math.abs(end - swipeDx)) / speed, SWIPE_MIN_MS), SWIPE_MAX_MS);

    // Gone by the time the next one is in place, and quiet until it plays.
    if (isOutputPlaying()) activeOutput().handOver(duration / 1000);

    // Once the peek is exactly where the current one sits, showing what it
    // will, the real one takes over, with the drawing's motion carried across
    // so the change cannot be seen.
    await whenSlid(slide(end, duration), () => {
        const changing = changeTrack(side, { turn: false });

        trackScene.takeOver(trackPeekScene);
        return changing;
    });
}

// A change made other than by a swipe (a key, the earphones, a shortcut)
// turns the page as a swipe let go still would. It is made at once: the peek
// takes the page that is leaving, so the real one can show the new track
// while it comes in. Under a finger, the drag carries on with the new track.
function turnPage(side) {
    swipeMotion?.();
    if (swipeDragging) {
        peekSide = 0;
        return;
    }
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    showPeek(-side, getCurrentTrack());
    trackPeekScene.takeOver(trackScene);
    swipeDx = side * pageWidth();
    whenSlid(slide(0, SWIPE_MAX_MS), () => {});
}

function handleSwipeCancel() {
    activeOutput().setPresence(1, SWIPE_SETTLE_MS / 1000);
    whenSlid(slide(0, SWIPE_SETTLE_MS), () => {});
}

// Runs `then` once the slide ends, or at once if a new drag cuts it short,
// and hands the page back to its stylesheet.
function whenSlid(motion, then) {
    let result;
    const finish = () => {
        if (swipeMotion !== finish) return result;

        swipeMotion = null;
        result = then();
        for (const element of [trackStatus, trackPeek]) {
            for (const animation of element.getAnimations()) animation.cancel();
        }
        hidePeek();
        return result;
    };

    swipeMotion = finish;
    return motion.finished.then(finish, () => {});
}

function handleVolumeGestureStart() {
    volumeAtGestureStart = volume;
    volumeDragging = true;
    showGestureVolume();
}

function handleVolumeGestureChange(change) {
    setVolume(volumeAtGestureStart + change);
}

function handleVolumeGestureEnd() {
    volumeDragging = false;
    savePreference(SAVED_VOLUME_KEY, String(volume));
    gestureTutorial.completed("volume");
}

function handleVolumeGestureCancel() {
    volumeDragging = false;
    setVolume(volumeAtGestureStart);
    hideGestureVolume();
}

// A notch of the wheel, as a key: up is louder. Not where the page is too
// short for the window, which a wheel scrolls.
function handleWheel(event) {
    const direction = -Math.sign(event.deltaY);
    const root = document.documentElement;

    if (!direction || event.ctrlKey || root.scrollHeight > root.clientHeight) return;
    if (event.target instanceof Element && event.target.closest("[popover]")) return;

    event.preventDefault();
    stepVolume(direction);
}

function stepVolume(direction) {
    showGestureVolume();
    setVolume(Math.round((volume + direction * VOLUME_STEP) * 100) / 100);
    savePreference(SAVED_VOLUME_KEY, String(volume));
}

function showGestureVolume() {
    gestureVolume.dataset.active = "";
}

// The level a drag, a key or the wheel set stays to be read until the screen
// rests, and goes with the words; any other gesture is about something else,
// and clears it. With a mouse it takes the controls' place, and moving the
// mouse on gives them back.
function hideGestureVolume() {
    delete gestureVolume.dataset.active;
}

// Touch screens are where the gestures are the only way in, so that is where
// the guide is offered; it is finished or skipped once, and not seen again.
function offerGestureTutorial() {
    if (!isTouchScreen()) return;
    if (loadPreference(TUTORIAL_DONE_KEY) !== null) return;

    tutorialOpen = true;
    wake();
    setTimeout(() => gestureTutorial.start(), TUTORIAL_DELAY_MS);
}

// Left alone, the screen rests: the controls step back and the rest dims to
// a trace, so the sound has the room rather than the screen. A touch, a moving
// mouse or a key brings it all back. Playing or paused alike, and with a mouse
// as with a finger, though not while the guide is still talking to it.
function handleActivity(event) {
    if (event.type === "pointermove" && event.pointerType !== "mouse") return;

    if (event.type === "pointermove" && !volumeDragging) hideGestureVolume();
    wake();
}

function canRest() {
    return !tutorialOpen;
}

function isTouchScreen() {
    return Boolean(touchScreen?.matches);
}

// On a touch screen the buttons are never drawn, but a screen reader still
// finds them; a keyboard there has its keys, and should not stop on nothing.
function syncTransportTabStops() {
    const tabIndex = isTouchScreen() ? -1 : 0;
    for (const button of [previousButton, playPauseButton, nextButton]) button.tabIndex = tabIndex;
}

function wake() {
    clearTimeout(restTimer);
    restTimer = 0;
    delete document.documentElement.dataset.resting;
    if (!canRest()) return;

    restTimer = setTimeout(() => {
        restTimer = 0;
        document.documentElement.dataset.resting = "";
        hideGestureVolume();
    }, REST_AFTER_MS);
}

// The sound starting or stopping starts the countdown without waiting for a touch.
function syncRest() {
    if (!restTimer && !("resting" in document.documentElement.dataset)) wake();
}

// --- Track selection and navigation ---------------------------------------

async function playNextTrack() {
    return changeTrack(1);
}

async function playPreviousTrack() {
    return changeTrack(-1);
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
        const didChangeTrack = await changeTrack(offset);

        // A change that failed has already reported itself and rolled back to
        // whatever was loaded before. Starting that would answer the shortcut
        // with the wrong soundscape, over the top of its own error message.
        if (!didChangeTrack) return false;
    }

    if (!isOutputPlaying()) await playAudio();

    return true;
}

async function changeTrack(offset, { turn = true } = {}) {
    if (turn) turnPage(Math.sign(offset));
    const trackChangeId = ++currentTrackChangeId;
    const previousTrackIndex = currentTrackIndex;
    currentTrackIndex = (currentTrackIndex + offset + tracks.length) % tracks.length;
    const attemptedTrack = getCurrentTrack();

    try {
        const result = await playCurrentTrack(trackChangeId);
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
// the param is persisted and removed: persisted so the choice outlives the
// param; removed because leaving it in the address bar would make every later
// reload of that URL override the user's saved soundscape.
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

function updateTrackTitle() {
    const trackTitle = getCurrentTrack().title;

    trackScene.setAttribute("track", getCurrentTrack().id);
    titleText.textContent = trackTitle;
    // Keep the app name in the tab so bookmarks and window lists stay identifiable.
    document.title = `${trackTitle} · Soundscape`;
}

// --- Volume ---------------------------------------------------------------

function restoreSavedVolume() {
    const savedVolumeValue = loadPreference(SAVED_VOLUME_KEY);
    const savedVolume = savedVolumeValue === null ? Number.NaN : Number(savedVolumeValue);

    setVolume(Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : localOutput.getVolume());
}

// The one place the level changes: the sound, the bar and what a screen reader
// is told move together.
function setVolume(value) {
    const output = activeOutput();

    volume = Math.min(1, Math.max(0, value));
    if (output.canControlVolume()) output.setVolume(volume);

    const percent = String(Math.round(volume * 100));

    gestureVolume.style.setProperty("--level", String(volume));
    gestureVolume.setAttribute("aria-valuenow", percent);
    gestureVolume.setAttribute("aria-valuetext", `${percent}%`);
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

async function playCurrentTrack(trackChangeId) {
    const track = getCurrentTrack();
    // Decide from playback intent, not the media element's transient paused
    // state: during a track swap the element is briefly paused (src set +
    // load()), so isPlaying() can read false and wrongly start the new track
    // paused, stopping playback mid-navigation.
    const wasPlaying = activeOutput().isPlaybackRequested();

    saveCurrentTrack();
    updateTrackTitle();

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
    syncRest();
    // The drawing moves while the sound plays, however it was asked to.
    trackScene.toggleAttribute("playing", isPlaying);
    syncBreath(!isPlaying);
}

// Paused, the drawing breathes: out, a little smaller and fainter, and back
// in, slowly. The browser eases it, but it is held and stepped a few times a
// second (stepBreath), and a hidden page takes no steps. Both pages breathe in
// step, so a swipe lands mid-breath unseen. Playing brings each up from
// wherever its breath is: an animation that simply stopped would jump to full
// strength.
function syncBreath(paused) {
    const breathing = paused && !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (breathing === (breathStart !== null)) return;
    clearTimeout(breathStep);
    if (breathing) {
        const out = { opacity: PAUSED_SCENE_BREATH / PAUSED_SCENE, scale: SCENE_BREATH_SCALE };
        const options = { duration: SCENE_BREATH_MS / 2, direction: "alternate", iterations: Infinity, easing: FADE_EASING };

        breathStart = document.timeline.currentTime;
        breaths = stages().map((stage) => stage.animate([{ opacity: 1, scale: 1 }, out], options));
        for (const breath of breaths) breath.pause();
        stepBreath(breathStart);
    } else {
        breathStart = null;
        for (const stage of stages()) {
            const { opacity, scale } = getComputedStyle(stage);

            stage.animate([{ opacity, scale }, { opacity: 1, scale: 1 }], { duration: SCENE_DIM_MS, easing: FADE_EASING });
        }
        for (const breath of breaths) breath.cancel();
        breaths = [];
    }
}

function stages() {
    return [trackScene.parentElement, trackPeekScene.parentElement];
}

// Waiting for a frame after each pause is what stops the steps in a hidden page.
function stepBreath(now) {
    const these = breaths;

    for (const breath of these) breath.currentTime = now - breathStart;
    breathStep = setTimeout(() => requestAnimationFrame((next) => {
        if (breaths === these) stepBreath(next);
    }), SCENE_BREATH_STEP_MS);
}

// Asked of the active output, which answers null when it has no position yet.
function syncMediaSessionPositionState() {
    updateMediaSessionPositionState(activeOutput().getMediaSessionPositionState());
}

function updateMediaSessionPositionTimer(isPlaying) {
    clearTimeout(mediaSessionPositionTimer);
    mediaSessionPositionTimer = 0;
    // Nothing to keep up to date on an output that cannot report a position.
    if (!isPlaying || !activeOutput().canReportPosition()) return;

    const reading = activeOutput().getMediaSessionPositionState();
    const untilWrap = reading ? (reading.duration - reading.position) * 1000 : MEDIA_SESSION_POSITION_RETRY_MS;

    mediaSessionPositionTimer = setTimeout(() => {
        mediaSessionPositionTimer = 0;
        syncMediaSessionPositionState();
        updateMediaSessionPositionTimer(isOutputPlaying());
    }, untilWrap);
}

// --- Boot -----------------------------------------------------------------

function startMediaSession() {
    initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
    syncPlaybackState(isOutputPlaying());
}
