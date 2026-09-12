// See README.md for how to run the app (container-based static server).
// The app requires HTTP for module loading and the service worker — do not
// open index.html via file://.

// Browser/OS integration is anchored by one long-lived HTMLAudioElement.
// The audible loop intentionally comes from a decoded Web Audio buffer because
// perfect loop points are a hard product requirement for these short files.

import { AudioPlayer } from "./audio-player.js";
import { createLocalSourceResolver } from "./local-source.js";
import { createRemotePlayback } from "./remote-playback/index.js";
// The control is a custom element like the three imported below, and the only
// one that does not live in js/components/ — it belongs to remote playback and
// is deleted with it. Not routed through the plugin's index.js on purpose: that
// module must stay loadable without a DOM. See its header.
import { REMOTE_VOLUME_LABEL, RemotePlayback } from "./remote-playback/control.js";
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
const VERSION = "1.20.0";

const PLAY_LABEL = "Play";
const PAUSE_LABEL = "Pause";
const VOLUME_LABEL = "Volume";
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
customElements.define("remote-playback", RemotePlayback);
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
const remoteTransportElement = document.getElementById("remoteTransportElement");
const remotePlaybackUi = document.getElementById("remotePlaybackUi");
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
// The handover's state. It belongs beside the handover, far below, and cannot
// live there: see the comment above handleRemoteConnectionChange.
//
// Only the connected edge moves audio, and every connection signal arrives
// through one callback that fires on any of them — so the previous answer to
// that one question is what makes the edge detectable. The three-state name the
// control shows is the component's business, not this file's.
let remoteWasConnected = false;
let remoteTransitionId = 0;

// The local output. Always present, and the one the app falls back to.
const localOutput = new AudioPlayer(audioElement, {
    onStateChange: () => syncPlaybackState(isOutputPlaying()),
    onLoadingChange: syncLoadingIndicator,
    resolveSource: createLocalSourceResolver(audioElement, { override: readCodecOverride() }),
});

// The remote output, or null on a browser with no way to reach another device —
// Firefox, Samsung Internet, anything without the APIs. Null is an ordinary
// answer rather than a failure: every path below is written to work without one,
// which is what lets the whole remote-playback directory be deleted without
// touching anything else here.
//
// Which provider was chosen is deliberately not knowable from this file. The
// registry decides once, from the browser alone, and nothing downstream branches
// on the answer.
//
// A pause pressed on the receiving device itself is the app's only word that the room
// went quiet. Re-read rather than trust: the answer is whatever the transport
// says right now, which is also what makes this safe to receive during the
// app's own transitions.
const remotePlayback = createRemotePlayback({
    element: remoteTransportElement,
    tracks,
    onChange: handleRemoteConnectionChange,
    onPlaybackChange: () => syncPlaybackState(isOutputPlaying()),
    onTrackAdopted: adoptRemoteTrack,
    onVolumeChange: adoptRemoteVolume,
});

// Exactly one output drives playback at any moment — nothing in the browser can
// route an AudioContext to a remote target, so the two are strictly exclusive
// rather than mixed. This is the app's single answer to "which one", and it is
// *derived* rather than assigned: a variable holding the answer could disagree
// with the transports, and every caller here re-reads this so it cannot.
function activeOutput() {
    return remotePlayback?.isConnected() ? remotePlayback : localOutput;
}

// Some paths legitimately need the local player specifically rather than
// whichever output is active — the media element's own play/pause events,
// visibility, and the volume the app is allowed to remember. Named so those
// stay findable, and stay few.
function isRemoteActive() {
    return activeOutput() !== localOutput;
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

    // Not persisted while the slider is driving a remote device: that level
    // belongs to the speaker in the room, and saving it would carry the room's
    // volume back to a pair of headphones tomorrow.
    if (!isRemoteActive()) {
        savePreference(SAVED_VOLUME_KEY, volumeControl.value);
    }
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
initRemotePlayback();
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
        // title back would describe a track that is no longer there. The answer
        // belongs to whichever output owns playback — while a remote is active
        // the local player still holds the track from before, and would answer
        // for the wrong device.
        if (activeOutput().holdsTrack(attemptedTrack)) {
            updateMediaSessionStatus(attemptedTrack);
            syncPlaybackState(isOutputPlaying());
            reportPlaybackFailure("Could not start soundscape track.", error, outputFailureMessage());
            return false;
        }

        currentTrackIndex = previousTrackIndex;
        saveCurrentTrack();
        remotePlayback?.setTrack(getCurrentTrack());
        updateTrackTitle();
        updateMediaSessionStatus(getCurrentTrack());
        syncPlaybackState(isOutputPlaying());
        reportPlaybackFailure("Could not change soundscape track.", error, outputFailureMessage());
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
    // Falls back to the local player's own level rather than the slider's,
    // because the slider is not always showing it: while a remote is driving the
    // volume the control holds the *speaker's* level, adopted from the room. A
    // listener who has never moved the slider has nothing saved, so on handback
    // that fallback would hand the room's level to this device and keep it. The
    // local player's level is untouched while a remote owns the output, which is
    // exactly the one the handback is supposed to restore.
    const volume = Number.isFinite(savedVolume) && savedVolume >= 0 && savedVolume <= 1
        ? savedVolume
        : localOutput.getVolume();

    volumeControl.value = String(volume);
    applyVolume(volume);
}

// Whichever output is actually making the sound. While a remote that supports it
// is connected the slider drives the speaker; otherwise it drives local
// playback, which is every other moment.
function applyVolume(volume) {
    const output = activeOutput();

    if (output.canControlVolume()) {
        output.setVolume(volume);
        return;
    }

    // The active output's level is not the app's to set — some transports hand
    // it to the receiver, where it outlives the session. Set the local player's
    // anyway: it is parked and silent, and this is the level the room gets back
    // on handback.
    localOutput.setVolume(volume);
}

// A disabled slider that does not read as disabled is the worst of the three
// options — it looks broken rather than absent, and gives no clue why. So the
// control now takes one of two honest shapes while a remote is active:
//
//   - The transport can carry volume: the slider drives the device, relabelled
//     so it is clear whose level moves.
//   - It cannot: no slider at all, because a control that moves nothing should
//     not be on screen.
//
// The device's level is *adopted*, never pushed. Sending this page's slider
// position on connect would turn the speaker in the room to wherever it
// happened to sit, and on some devices that change outlives the session.
function syncVolumeControlForRemote(connected) {
    if (connected && !remotePlayback?.canControlVolume()) {
        volumeControl.hidden = true;
        return;
    }

    volumeControl.hidden = false;
    volumeControl.setAttribute("label", connected ? REMOTE_VOLUME_LABEL : VOLUME_LABEL);

    if (!connected) {
        // The saved preference is this app's level, not the room's.
        restoreSavedVolume();
        return;
    }

    adoptRemoteVolume(remotePlayback?.getVolume());
}

function adoptRemoteVolume(level) {
    if (!Number.isFinite(level)) return;

    volumeControl.value = String(level);
}

function isOutputPlaying() {
    return activeOutput().isPlaying();
}

// --- Remote playback: wiring, then the handover ---------------------------

// The one place the remote playback plugin is attached to the page, and the one
// place the app decides whether the feature exists at all. With no provider the
// control removes itself outright, so a Firefox visitor is left with no remote
// markup, no listeners and no state for the rest of the app to have an opinion
// about.
//
// The facade is small on purpose. The control can open a picker, spend the wait
// early, ask whether a picker could have opened, and report that one could not.
// It cannot connect, cannot read a connection, and cannot move audio — those are
// the app's, and handing them over would make the control a second answer to
// "which output owns the soundscape".
//
// Deliberately not "discovery": nothing is asked of the network here or ever.
// Every provider discovers devices inside its own picker when it opens, so the
// app never needs to know in advance whether one is out there — the plugin's
// AGENTS.md explains what that replaced and why it is not coming back.
//
// The track is handed over now so the provider knows what to load, but no bytes
// move until the first gesture releases it.
function initRemotePlayback() {
    if (!remotePlayback) {
        remotePlaybackUi.detach();
        return;
    }

    remotePlaybackUi.attach({
        // Forwarded, never read: the mark is the provider's, so this file
        // still knows nothing about which one it got.
        icon: remotePlayback.icon(),
        prompt: () => remotePlayback.prompt(),
        prepare: () => remotePlayback.prepare(),
        isTransportReady: () => remotePlayback.isTransportReady(),
        // The control owns the wording; the app owns where it goes. Deliberately
        // not routed through reportPlaybackFailure: that suppresses messages
        // while audio is playing, which is the usual moment someone reaches for
        // this button, and the soundscape playing on is no consolation for a
        // device list that will not appear.
        onUnavailable: (message) => {
            playbackError.textContent = message;
            playbackError.hidden = false;
        },
    });

    // Capture, so a handler that stops propagation cannot hide the gesture. The
    // two together cover pointer and keyboard; either one is enough to release
    // the transport, so whichever lands first removes both.
    document.addEventListener("pointerdown", releaseRemoteTransport, true);
    document.addEventListener("keydown", releaseRemoteTransport, true);

    remotePlayback.setTrack(getCurrentTrack());
    remotePlayback.start();
}

// A remote session outlives the page that started it, so rejoining one can find
// the receiver on a soundscape this page never chose — changed from a phone
// while this tablet was closed, or from the speaker itself. The app follows the
// room rather than the other way round: what is audible is the truth, and
// silently overwriting it with a stale saved track would move the sound in the
// room to answer a question nobody asked.
//
// Not a track *change*: nothing is loaded, and playCurrentTrack is exactly what
// must not run. This only catches the app up with what is already playing.
function adoptRemoteTrack(track) {
    const index = tracks.indexOf(track);

    if (index === -1) return;

    currentTrackIndex = index;
    saveCurrentTrack();
    updateTrackTitle();
    updateMediaSessionStatus(track);
    syncPlaybackState(isOutputPlaying());
}

// ---------------------------------------------------------------------------
// The handover.
//
// The one part of the app that knows there is more than one output, and the only
// place ownership of the soundscape moves. Everything else asks activeOutput()
// and gets on with it.
//
// It is core rather than plugin: the plugin reports that a connection changed,
// and what that *means* for the soundscape — who pauses, who resumes, what the
// listener is told — is not a decision a provider should be making. A provider
// that could move the audio itself would be a second answer to "which output",
// and there is deliberately only one.
//
// Its two pieces of state — remoteWasConnected and remoteTransitionId — are
// declared with the rest of the module's state near the top of the file, rather
// than here beside their only readers, which would be the better place.
//
// The reason is a hoisting rule: a `let` cannot be read at all until its own
// statement has run (its "temporal dead zone"), even from code further down the
// file. initRemotePlayback() runs in the boot block above this point, so if the
// declarations sat here, a provider reporting a connection during start() — a
// session rejoined from a previous page load does exactly that — would reach
// the handler before either binding existed, and throw. Two tests caught it.
// ---------------------------------------------------------------------------

// Connection governs which output owns the soundscape, and only a change in it
// moves audio.
async function handleRemoteConnectionChange({ connected, connecting }) {
    remotePlaybackUi.setConnection({ connected, connecting });

    const wasConnected = remoteWasConnected;

    remoteWasConnected = Boolean(connected);

    // Only the connected edge moves audio. Passing through "connecting" changes
    // how the control looks and what is announced — which the line above has
    // already done — but nothing about which output owns the soundscape.
    if (Boolean(connected) === wasConnected) return;

    syncVolumeControlForRemote(connected);

    // A connect and a disconnect arriving close together — a failed session, or
    // a receiver taken over — leave two of these handlers in flight at once,
    // each awaiting a transport the other is undoing. Same generation guard as
    // changeTrack: whichever transition is no longer current stops touching
    // shared state. handBackOutput needs none of its own — it hands straight to
    // playAudio, which re-reads activeOutput() itself.
    const transitionId = ++remoteTransitionId;

    if (connected) {
        await takeOverOutput(transitionId);
    } else {
        await handBackOutput();
    }
}

// The transport element fetches nothing until a person has touched the page. A tab
// opened and left alone — restored on startup, or one of twenty from last
// session — then costs nothing for a feature it will never use. The first
// gesture loads it, well before anyone can reach the button, because Safari
// refuses to open its picker on an element whose header has not been read.
//
// One release is all there is, so both listeners come off together.
function releaseRemoteTransport() {
    document.removeEventListener("pointerdown", releaseRemoteTransport, true);
    document.removeEventListener("keydown", releaseRemoteTransport, true);
    remotePlayback.allowTransportLoad();
}

// The remote takes over. Ownership has already moved — activeOutput() answers
// with the remote from the moment it reports connected — so this is not what
// makes it the owner; it is what carries the soundscape across.
async function takeOverOutput(transitionId) {
    // Read the intent before pausing: localOutput.pause() clears it, and it is
    // the answer to whether the remote should come up playing or silent. The raw
    // intent, not isPlaybackRequested() — a device that connects while the first
    // track is still decoding is still answering a press of play.
    //
    // A receiver already playing counts too, and only the second half of this
    // catches it: reopening the app rejoins a session that has been running all
    // along, where nothing was ever pressed in *this* page's lifetime and the
    // local player's intent is quite correctly false. Taking that alone would
    // answer a speaker mid-soundscape with a paused button — and then pause it.
    const wasPlaying = localOutput.wantsPlayback() || remotePlayback.isPlaying();

    // Hand the intent over before either transport moves. A session that fails
    // as soon as it opens arrives as a disconnect while the local pause below is
    // still in flight, and the handback decides from this flag alone — without
    // it, a connection that never completed leaves the room silent.
    remotePlayback.setPlaybackRequested(wasPlaying);

    let failure = null;

    try {
        // Parked, not paused-by-anyone: the element's own pause event carries no
        // intent here, and a session that fails as it opens would otherwise have
        // that event land after the handback and stop the room. See
        // AudioPlayer.pauseForHandover.
        await localOutput.pauseForHandover();

        if (wasPlaying) {
            await remotePlayback.play();
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
    if (transitionId !== remoteTransitionId) {
        if (failure) console.warn("Could not hand playback to the remote device.", failure);

        return;
    }

    if (failure) {
        reportPlaybackFailure("Could not hand playback to the remote device.", failure, remotePlayback.failureMessage());
    } else {
        clearPlaybackError();
    }

    syncPlaybackState(isOutputPlaying());
}

// The local player takes the soundscape back. Read the remote's intent first:
// the connection is already gone, so this is the last moment anything can ask
// whether the room was listening.
async function handBackOutput() {
    const wasPlaying = remotePlayback.isPlaybackRequested();

    remotePlayback.pause();

    if (!wasPlaying) {
        syncPlaybackState(false);
        return;
    }

    // Resume through the ordinary play path rather than driving the local player
    // directly, so ending a remote session continues the audio rather than dropping the
    // room into silence — and so it lands on whatever activeOutput() now says,
    // which is the local player by the time this runs.
    //
    // This is the one place playback starts without a user gesture behind it: if
    // the session began on the remote, there is no AudioContext yet and the
    // browser may refuse. That failure is reported like any other, which is the
    // honest outcome — the alternative is going quiet with nothing on screen to
    // explain it.
    await playAudio();
}

// --- Status messages: errors and the loading indicator --------------------

// Only a failure that left the listener in silence is worth showing. A failed
// track change while audio is playing is absorbed completely — the previous
// soundscape keeps going and pressing next again just works — so surfacing it
// would put a warning over music that never stopped. Those stay console-only,
// which is where a developer wants them anyway.
// `message` overrides the default when the failure is not about the soundscape.
// A remote device that will not start is the case that matters: "pick another" sends the
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
    // Load the current soundscape
    const track = getCurrentTrack();
    // Decide from playback intent, not the media element's transient paused
    // state: during a track swap the element is briefly paused (src set +
    // load()), so isPlaying() can read false and wrongly start the new track
    // paused, stopping playback mid-navigation.
    const wasPlaying = activeOutput().isPlaybackRequested();

    saveCurrentTrack();
    // Unconditionally, not just while connected: the transport element's source
    // is how a backend matches a device to a resource, and neither engine will
    // report one until the header has been read, so it has to track the current
    // soundscape even with nothing connected. Putting it behind a connection
    // check is the bug this line exists to prevent; being the one place it
    // happens (with the boot seed and the failed-skip rollback) stops the
    // element and the app drifting apart.
    remotePlayback?.setTrack(track);
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
    // active source, not whether this caller may write OS metadata — and a
    // remote has no equivalent at all, which is the whole reason the answer is
    // the core's to give.
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

        // Local playback only. The AudioContext and the browser's autoplay
        // policy are this device's problem; a receiver has neither.
        if (output === localOutput) configurePlaybackAudioSession();

        // Resume if this output is already holding the current soundscape,
        // otherwise load it. Asked as "holds *this* track" rather than "holds
        // anything": a session rejoined mid-soundscape moves the app's current
        // track to whatever the room is playing, so the local player can be
        // holding a soundscape the app is no longer on, and resuming it would
        // answer play with the wrong sound.
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
// reportPlaybackFailure back to its own wording, which is about the soundscape
// rather than the device — and that is exactly what the local player asks for by
// answering null.
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
// app. While a remote is active it is deliberately parked and paused, so its events say
// nothing about what the listener is hearing and must not steer playback.
async function handleBrowserPlaybackStart() {
    if (localOutput.isBrowserPlaybackSyncSuppressed() || isRemoteActive()) return;

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
    if (localOutput.isBrowserPlaybackSyncSuppressed() || isRemoteActive()) return;

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
    // A remote keeps playing on the receiver whether the tab is visible or not,
    // and the local context is suspended on purpose — nothing to resume.
    if (document.hidden || isRemoteActive() || !localOutput.isPlaybackRequested()) return;

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
    } else if (isRemoteActive() || localOutput.hasTrack()) {
        playbackState = "paused";
    }

    updateMediaSessionPlaybackState(playbackState);
    syncMediaSessionPositionState();
    updateMediaSessionPositionTimer(isPlaying);
    playPauseButton.setAttribute("aria-label", isPlaying ? PAUSE_LABEL : PLAY_LABEL);
    playPauseButton.dataset.playing = isPlaying ? "true" : "false";
}

// Asked of the active output, which answers null when it cannot know. A remote's
// position belongs to the receiver and the page cannot read it, and the local
// player's reading is worse than none while one is connected: it still holds the
// buffer it was playing before, and its context is suspended, so it would pin a
// frozen position under a "playing" state in the OS media UI.
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
