// See README.md for how to run the app (container-based static server).
// The app requires HTTP for module loading and the service worker — do not
// open index.html via file://.

// Browser/OS integration is anchored by one long-lived HTMLAudioElement.
// The audible loop intentionally comes from a decoded Web Audio buffer because
// perfect loop points are a hard product requirement for these short files.

import { AudioPlayer } from "./audio-player.js";
import { CastController } from "./cast.js";
import { CastSdkController, isCastSdkCapable } from "./cast-sdk.js";
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
} from "./theme-utils.js";
import { tracks, trackSlug } from "./tracks.js";
const VERSION = "1.14.0";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const CAST_BUTTON_LABEL_BY_STATE = {
    idle: "Play on another device",
    connecting: "Connecting to device",
    connected: "Casting — change device or stop",
};
// The Remote Playback API never tells a page which device was picked, so these
// stay generic on purpose rather than guessing a name.
const CAST_CONNECTED_STATUS = "Now playing on another device.";
const CAST_CONNECTING_STATUS = "Connecting to a device.";
const CAST_DISCONNECTED_STATUS = "Playback returned to this device.";
const CAST_STATUS_BY_STATE = {
    connecting: CAST_CONNECTING_STATUS,
    connected: CAST_CONNECTED_STATUS,
};
const VOLUME_LABEL = "Volume";
const CAST_VOLUME_LABEL = "Volume on the device you're casting to";
const CAST_FAILURE_MESSAGE = "That device couldn't play this soundscape. Try connecting again.";
// Both platforms need the cast file's header read before they will show a
// device list, and Chromium reports a picker it never opened as an ordinary
// dismissal — so without this the press looks like nothing happened at all.
const CAST_UNAVAILABLE_MESSAGE = "Couldn't open the device list yet. Check your connection, then try again.";
const KEY_SPACE = " ";
const KEY_ARROW_RIGHT = "ArrowRight";
const KEY_ARROW_LEFT = "ArrowLeft";
const SAVED_VOLUME_KEY = "soundscape.volume";
const SAVED_TRACK_URL_KEY = "soundscape.currentTrackUrl";
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
const castAudioElement = document.getElementById("castAudioElement");
const castButton = document.getElementById("castButton");
const castStatus = document.getElementById("castStatus");
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
// Every cast signal arrives through one callback that fires on any of them, so
// the previously reported state is what makes a change in it detectable. One
// variable for all three states rather than a flag per consumer: the
// announcement and the transport handover are both driven by a change in this.
let castConnectionState = "idle";
let castTransitionId = 0;

const audioPlayer = new AudioPlayer(audioElement, {
    onStateChange: () => syncPlaybackState(isOutputPlaying()),
    onLoadingChange: syncLoadingIndicator,
});

// A pause pressed on the Chromecast itself is the app's only word that the room
// went quiet. Re-read rather than trust: the answer is whatever the transport
// says right now, which is also what makes this safe to receive during the
// app's own transitions.
const castCallbacks = {
    onChange: handleCastChange,
    onPlaybackChange: () => syncPlaybackState(isOutputPlaying()),
};

// Two cast transports, chosen once at boot, presenting one surface to
// everything below — so the handover between outputs has no branch of its own.
//
// Chrome gets the Cast SDK. Its Remote Playback implementation never opens a
// picker for this app's audio, measured across desktop, Android and Samsung
// Internet; cast-sdk.js records the evidence and the SDK-free routes that were
// tried first. Safari keeps the Remote Playback and AirPlay path in cast.js,
// which is the platform where that API is properly honoured, and Firefox has
// neither and shows no button.
//
// Exactly one of audioPlayer and the cast controller drives playback at any
// moment; cast.js explains why they can never overlap.
const castController = isCastSdkCapable()
    ? new CastSdkController({
        ...castCallbacks,
        tracks,
        onTrackAdopted: adoptCastTrack,
        onVolumeChange: adoptCastVolume,
    })
    : new CastController(castAudioElement, castCallbacks);

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

    // Not persisted while the slider is driving a cast device: that level
    // belongs to the speaker in the room, and saving it would carry the room's
    // volume back to a pair of headphones tomorrow.
    if (!castController.canControlVolume()) {
        savePreference(SAVED_VOLUME_KEY, volumeControl.value);
    }
});
playPauseButton.addEventListener("click", playPauseClick);
castButton.addEventListener("click", handleCastClick);
castButton.addEventListener("pointerenter", prepareCast);
castButton.addEventListener("pointerdown", prepareCast);
castButton.addEventListener("focus", prepareCast);
nextButton.addEventListener("click", playNextTrack);
previousButton.addEventListener("click", playPreviousTrack);
themeSelector.addEventListener("theme-change", (event) => {
    updateThemePreference(event.detail.theme);
});
title.addEventListener("animationend", handleTitleAnimationEnd);
document.addEventListener("visibilitychange", handleVisibilityChange);
document.addEventListener("keydown", handleDocumentKeydown);
document.addEventListener("keyup", handleDocumentKeyup);
// Capture, so a handler that stops propagation cannot hide the gesture. The two
// together cover pointer and keyboard; either one is enough to release the cast
// transport, so whichever lands first removes both.
document.addEventListener("pointerdown", releaseCastTransport, true);
document.addEventListener("keydown", releaseCastTransport, true);

updateThemePreference(loadThemePreference(), false);
restoreSavedVolume();
updateTrackTitle();
applyRequestedTrack();
startMediaSession();
initCasting();
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

        if (isTrackLoaded(attemptedTrack)) {
            updateMediaSessionStatus(attemptedTrack);
            syncPlaybackState(isOutputPlaying());
            reportPlaybackFailure("Could not start soundscape track.", error, castFailureMessage());
            return false;
        }

        currentTrackIndex = previousTrackIndex;
        saveCurrentTrack();
        castController.setTrack(getCurrentTrack());
        updateTrackTitle();
        updateMediaSessionStatus(getCurrentTrack());
        syncPlaybackState(isOutputPlaying());
        reportPlaybackFailure("Could not change soundscape track.", error, castFailureMessage());
        return false;
    }
}

// After a failed track change, did the attempted soundscape nonetheless become
// the loaded one? If it did, the app is on it and rolling the title back would
// describe a track that is no longer there. The answer belongs to whichever
// output owns playback — while casting the local player still holds the track
// from before the cast started, and would answer for the wrong device.
function isTrackLoaded(track) {
    return isCasting()
        ? castController.getTrackUrl() === track.castUrl
        : audioPlayer.getTrackUrl() === track.url;
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

function restoreSavedVolume() {
    const savedVolumeValue = loadPreference(SAVED_VOLUME_KEY);
    const savedVolume = savedVolumeValue === null ? Number.NaN : Number(savedVolumeValue);
    const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : Number(volumeControl.value);

    volumeControl.value = String(volume);
    applyVolume(volume);
}

// Whichever output is actually making the sound. While a cast that supports it
// is connected the slider drives the speaker; otherwise it drives local
// playback, which is every other moment.
function applyVolume(volume) {
    if (castController.canControlVolume()) {
        castController.setVolume(volume);
        return;
    }

    audioPlayer.updateVolume(volume);
}

// A disabled slider that does not read as disabled is the worst of the three
// options — it looks broken rather than absent, and gives no clue why. So the
// control now takes one of two honest shapes while casting:
//
//   - The transport can carry volume (the Cast SDK can): the slider drives the
//     device, relabelled so it is clear whose level is being moved.
//   - It cannot (AirPlay, where element volume is not ours to set): no slider
//     at all, because a control that moves nothing should not be on screen.
//
// The device's level is *adopted*, never pushed. Sending this page's slider
// position on connect would turn the speaker in the room to wherever it
// happened to sit, and on a Cast device that change outlives the session.
function syncVolumeControlForCast(connected) {
    if (connected && !castController.canControlVolume()) {
        volumeControl.hidden = true;
        return;
    }

    volumeControl.hidden = false;
    volumeControl.setAttribute("label", connected ? CAST_VOLUME_LABEL : VOLUME_LABEL);

    if (!connected) {
        // The saved preference is this app's level, not the room's.
        restoreSavedVolume();
        return;
    }

    adoptCastVolume(castController.getVolume());
}

function adoptCastVolume(level) {
    if (!Number.isFinite(level)) return;

    volumeControl.value = String(level);
}

function isCasting() {
    return castController.isConnected();
}

function isOutputPlaying() {
    return isCasting() ? castController.isPlaying() : audioPlayer.isPlaying();
}

// Deliberately not "discovery": nothing is asked of the network here or ever.
// The button's visibility is decided once and never recomputed, because a browser
// either has a way to cast or it does not and that cannot change while the page
// is open. Both platforms discover devices inside their own picker when it opens,
// so the app never needs to know in advance whether one is out there — cast.js
// explains what that replaced and why it is not coming back.
//
// The track is handed over now so the controller knows what to load, but no bytes
// move until the first gesture releases it.
function initCasting() {
    castController.setTrack(getCurrentTrack());
    castController.start();
    castButton.hidden = !castController.isSupported();
}

// A dismissed picker and a picker that never opened are the same `false` here,
// and on Chromium they are the same DOMException too — so the transport's own
// readiness is what separates them. Asked after the await, it describes the
// state the press actually ran against.
//
// Deliberately not routed through reportPlaybackFailure: that suppresses
// messages while audio is playing, which is the usual moment someone reaches
// for this button, and the soundscape playing on is no consolation for a device
// list that will not appear.
async function handleCastClick() {
    // Opening a picker is not instant — a script may have to be fetched and a
    // cast context started before the browser's own device list appears — and
    // until it does the press has no visible effect at all, which reads as a
    // broken button. The same pulse the connecting state uses, because it is the
    // same thing being said: something is happening, wait.
    //
    // Not routed through handleCastChange: no connection state has changed, and
    // claiming one would make the glyph describe a session that does not exist.
    castButton.dataset.castBusy = "true";
    castButton.setAttribute("aria-busy", "true");

    try {
        const opened = await castController.prompt();

        if (opened || castController.isTransportReady()) return;

        playbackError.textContent = CAST_UNAVAILABLE_MESSAGE;
        playbackError.hidden = false;
    } finally {
        delete castButton.dataset.castBusy;
        castButton.removeAttribute("aria-busy");
    }
}

// Hover, focus, or the pointerdown that precedes a tap: the last moment before
// the press at which the wait can still be spent instead of shown. The transport
// decides whether that means anything — on the Cast SDK path it fetches the
// script, on the AirPlay path the first gesture already did the work.
function prepareCast() {
    if (castController.prepare()) {
        castButton.removeEventListener("pointerenter", prepareCast);
        castButton.removeEventListener("pointerdown", prepareCast);
        castButton.removeEventListener("focus", prepareCast);
    }
}

// A cast session outlives the page that started it, so rejoining one can find
// the receiver on a soundscape this page never chose — changed from a phone
// while this tablet was closed, or from the speaker itself. The app follows the
// room rather than the other way round: what is audible is the truth, and
// silently overwriting it with a stale saved track would move the sound in the
// room to answer a question nobody asked.
//
// Not a track *change*: nothing is loaded, and playCurrentTrack is exactly what
// must not run. This only catches the app up with what is already playing.
function adoptCastTrack(track) {
    const index = tracks.indexOf(track);

    if (index === -1) return;

    currentTrackIndex = index;
    saveCurrentTrack();
    updateTrackTitle();
    updateMediaSessionStatus(track);
    syncPlaybackState(isOutputPlaying());
}

// Connection governs which output owns the soundscape, and only a change in it
// moves audio.
async function handleCastChange({ connected, connecting }) {
    const state = castState(connected, connecting);
    const previousState = castConnectionState;

    castConnectionState = state;
    castButton.dataset.castState = state;
    castButton.setAttribute("aria-label", CAST_BUTTON_LABEL_BY_STATE[state]);
    announceCastState(state, previousState);

    // Only the connected edge moves audio. Passing through "connecting" changes
    // how the button looks and what is announced, but nothing about which
    // transport owns the soundscape.
    if (connected === (previousState === "connected")) return;

    syncVolumeControlForCast(connected);

    // A connect and a disconnect arriving close together — a failed session, or
    // a receiver taken over — leave two of these handlers in flight at once,
    // each awaiting a transport the other is undoing. Same generation guard as
    // changeTrack: whichever transition is no longer current stops touching
    // shared state. stopCasting needs none of its own — it hands straight to
    // playAudio, which re-checks isCasting() itself.
    const transitionId = ++castTransitionId;

    if (connected) {
        await startCasting(transitionId);
    } else {
        await stopCasting();
    }
}

// Reaching a Chromecast takes a few seconds, and the only sign of it is the
// button's pulse and its changed label — neither of which a screen reader
// announces on a control nobody is focused on. Idle is the one state with no
// wording of its own: "returned to this device" is only true if the audio ever
// left, and a connection abandoned at the picker never moved it. Writing an
// empty string still clears whatever the previous state said, silently.
function announceCastState(state, previousState) {
    if (state === previousState) return;

    castStatus.textContent = CAST_STATUS_BY_STATE[state]
        ?? (previousState === "connected" ? CAST_DISCONNECTED_STATUS : "");
}

// The cast element fetches nothing until a person has touched the page. A tab
// opened and left alone — restored on startup, or one of twenty from last
// session — then costs nothing for a feature it will never use. The first
// gesture loads it, well before anyone can reach the button, because Safari
// refuses to open its picker on an element whose header has not been read.
//
// One release is all there is, so both listeners come off together.
function releaseCastTransport() {
    document.removeEventListener("pointerdown", releaseCastTransport, true);
    document.removeEventListener("keydown", releaseCastTransport, true);
    castController.allowTransportLoad();
}

// The one place the two signals collapse into a name. Everything the cast shows
// the user — the glyph, the button's label, the announcement — is keyed off the
// result, so there is a single answer to "what is it doing".
function castState(connected, connecting) {
    if (connected) return "connected";

    return connecting ? "connecting" : "idle";
}

async function startCasting(transitionId) {
    // Read the intent before pausing: audioPlayer.pause() clears it, and it is
    // the answer to whether the cast should come up playing or silent. The raw
    // intent, not isPlaybackRequested() — a device that connects while the first
    // track is still decoding is still answering a press of play.
    //
    // A receiver already playing counts too, and only the second half of this
    // catches it: reopening the app rejoins a session that has been running all
    // along, where nothing was ever pressed in *this* page's lifetime and the
    // local player's intent is quite correctly false. Taking that alone would
    // answer a speaker mid-soundscape with a paused button — and then pause it.
    const wasPlaying = audioPlayer.wantsPlayback() || castController.isPlaying();

    // Hand the intent to the cast before either transport moves. A session that
    // fails as soon as it opens arrives as a disconnect while the local pause
    // below is still in flight, and the handback decides from this flag alone —
    // without it, a cast that never connected leaves the room silent.
    castController.setPlaybackRequested(wasPlaying);

    let failure = null;

    try {
        await audioPlayer.pause();

        if (wasPlaying) {
            await castController.play();
        }
    } catch (error) {
        failure = error;
    }

    // Everything below writes shared UI, so the staleness check comes before all
    // of it rather than only before the last line. A connect and a disconnect
    // arriving close together leave two of these in flight, each awaiting a
    // transport the other is undoing; the one that is no longer current must not
    // clear an error the newer transition just posted, or post one over it. The
    // log still happens either way — a failure is worth a developer's attention
    // whether or not it is still worth the user's.
    if (transitionId !== castTransitionId) {
        if (failure) console.warn("Could not start casting.", failure);

        return;
    }

    if (failure) {
        reportPlaybackFailure("Could not start casting.", failure, CAST_FAILURE_MESSAGE);
    } else {
        clearPlaybackError();
    }

    syncPlaybackState(isOutputPlaying());
}

async function stopCasting() {
    const wasPlaying = castController.isPlaybackRequested();

    castController.pause();

    if (!wasPlaying) {
        syncPlaybackState(false);
        return;
    }

    // Hand the soundscape back to local playback so ending a cast continues the
    // audio rather than dropping the room into silence. This is the one place
    // playback starts without a user gesture behind it: if the session began on
    // the cast, there is no AudioContext yet and the browser may refuse. That
    // failure is reported like any other, which is the honest outcome — the
    // alternative is going quiet with nothing on screen to explain it.
    await playAudio();
}

// Only a failure that left the listener in silence is worth showing. A failed
// track change while audio is playing is absorbed completely — the previous
// soundscape keeps going and pressing next again just works — so surfacing it
// would put a warning over music that never stopped. Those stay console-only,
// which is where a developer wants them anyway.
// `message` overrides the default when the failure is not about the soundscape.
// A cast that will not start is the case that matters: "pick another" sends the
// user hunting through tracks for a fault that is in the room, not the file.
function reportPlaybackFailure(logMessage, error, message) {
    console.warn(logMessage, error);

    if (isOutputPlaying()) return;

    playbackError.textContent = message ?? (globalThis.navigator?.onLine === false
        ? "You're offline and this soundscape hasn't been downloaded yet."
        : "This soundscape could not be played. Try again, or pick another.");
    playbackError.hidden = false;
}

function syncLoadingIndicator(isLoading) {
    clearTimeout(loadingIndicatorTimer);
    loadingIndicatorTimer = 0;

    if (!isLoading) {
        title.classList.remove("is-loading");
        trackLoadingLabel.textContent = "";
        trackLoading.hidden = true;
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

async function playCurrentTrack(trackChangeId, direction = "next") {
    // Load the current soundscape
    const track = getCurrentTrack();
    // Decide from playback intent, not the media element's transient paused
    // state: during a track swap the element is briefly paused (src set +
    // load()), so isPlaying() can read false and wrongly start the new track
    // paused, stopping playback mid-navigation.
    const wasPlaying = isCasting()
        ? castController.isPlaybackRequested()
        : audioPlayer.isPlaybackRequested();

    saveCurrentTrack();
    // Unconditionally, not just while casting: the cast element's source is how
    // a backend matches a device to a resource, and neither engine will report
    // one until the header has been read, so it has to track the current
    // soundscape even with nothing connected. Putting it behind an isCasting()
    // check is the bug this line exists to prevent; being the one place it
    // happens (with the boot seed and the failed-skip rollback) stops the
    // element and the app drifting apart.
    castController.setTrack(track);
    updateTrackTitle({ animate: true, direction });

    // Casting has no local fetch or decode to do — the receiver pulls the new
    // file itself — so there is no loading state and no crossfade to run here.
    if (isCasting()) {
        if (wasPlaying) {
            await castController.play();
        }

        // Two quick skips leave two of these in flight, and the receiver can
        // answer the first one last. Writing metadata from a skip that has
        // already been superseded would name a soundscape the receiver is no
        // longer pointed at, in the OS media UI, with the title on screen
        // disagreeing. On the local path AudioPlayer reports this itself by
        // answering false below; a cast has no equivalent, so the generation is
        // checked here.
        if (trackChangeId !== currentTrackChangeId) return false;

        finishTrackChange(track);
        return true;
    }

    const didStartTrack = await audioPlayer.playTrack(track, true, true, !wasPlaying);
    if (!didStartTrack) return false;

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
        if (isCasting()) {
            saveCurrentTrack();
            await castController.play();
            clearPlaybackError();
            syncPlaybackState(isOutputPlaying());
            return;
        }

        configurePlaybackAudioSession();

        if (audioPlayer.hasTrack()) {
            await audioPlayer.play();
        } else {
            saveCurrentTrack();
            const didStartTrack = await audioPlayer.playTrack(getCurrentTrack(), true);
            if (!didStartTrack) return;
        }

        clearPlaybackError();
        syncPlaybackState(isOutputPlaying());
    } catch (error) {
        reportPlaybackFailure("Could not start playback.", error, castFailureMessage());
        syncPlaybackState(isOutputPlaying());
    }
}

// Undefined hands reportPlaybackFailure back to its own wording, which is about
// the soundscape rather than the device.
function castFailureMessage() {
    return isCasting() ? CAST_FAILURE_MESSAGE : undefined;
}

async function pauseAudio() {
    try {
        if (isCasting()) {
            castController.pause();
        } else {
            await audioPlayer.pause();
        }

        syncPlaybackState(false);
    } catch (error) {
        console.warn("Could not pause playback.", error);
        syncPlaybackState(isOutputPlaying());
    }
}

// The local media element's play/pause events mirror app state back into the
// app. While casting it is deliberately parked and paused, so its events say
// nothing about what the listener is hearing and must not steer playback.
async function handleBrowserPlaybackStart() {
    if (audioPlayer.isBrowserPlaybackSyncSuppressed() || isCasting()) return;

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
    if (audioPlayer.isBrowserPlaybackSyncSuppressed() || isCasting()) return;

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
    // A cast keeps playing on the receiver whether the tab is visible or not,
    // and the local context is suspended on purpose — nothing to resume.
    if (document.hidden || isCasting() || !audioPlayer.isPlaybackRequested()) return;

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
    } else if (audioPlayer.hasTrack() || isCasting()) {
        playbackState = "paused";
    }

    updateMediaSessionPlaybackState(playbackState);
    syncMediaSessionPositionState();
    updateMediaSessionPositionTimer(isPlaying);
    playPauseButton.setAttribute("aria-label", isPlaying ? PAUSE_LABEL : PLAY_LABEL);
    playPauseButton.dataset.playing = isPlaying ? "true" : "false";
}

// A cast's position belongs to the receiver and the page cannot read it. The
// local player's reading is worse than none here: it still holds the buffer it
// was playing before the cast, and its context is suspended, so it would pin a
// frozen position under a "playing" state in the OS media UI.
function syncMediaSessionPositionState() {
    updateMediaSessionPositionState(isCasting() ? null : audioPlayer.getMediaSessionPositionState());
}

function updateMediaSessionPositionTimer(isPlaying) {
    // Nothing to poll while casting — there is no reading to refresh.
    if (!isPlaying || isCasting()) {
        clearInterval(mediaSessionPositionTimer);
        mediaSessionPositionTimer = 0;
        return;
    }

    if (mediaSessionPositionTimer) return;

    mediaSessionPositionTimer = setInterval(syncMediaSessionPositionState, MEDIA_SESSION_POSITION_INTERVAL_MS);
}

function startMediaSession() {
    initMediaSession(getCurrentTrack(), mediaSessionActions, audioElement);
    syncPlaybackState(isOutputPlaying());
}
