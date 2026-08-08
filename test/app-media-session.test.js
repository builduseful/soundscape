import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    FAKE_TRACK_LOOP_SECONDS,
    restoreAppTestEnvironment,
    startAppTestEnvironment,
} from "./helpers/app-test-harness.js";
import { tracks, trackSlug } from "../src/js/tracks.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
    restoreAppTestEnvironment();
});

async function startThenPause(mediaActions, navigator, audioElement) {
    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
}

function getTitleParts(elements) {
    const title = elements.get("title");

    return {
        current: title.querySelector(".track-title-text--current"),
        incoming: title.querySelector(".track-title-text--incoming"),
        title,
    };
}

function getLastItem(items) {
    return items.at(-1);
}

function captureConsoleWarn() {
    const warnings = [];

    console.warn = (...args) => {
        warnings.push(args);
    };

    return warnings;
}

async function waitFor(condition) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.fail("Timed out waiting for app event work to settle.");
}

test("media next key keeps working after changing tracks while paused", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await startThenPause(mediaActions, navigator, audioElement);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, tracks[2].title);
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 4);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});

test("media session action handlers are refreshed after track changes", async () => {
    const environment = await startAppTestEnvironment();
    const { audioElement, mediaActions, navigator } = environment;

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    const callsAfterInit = environment.mediaSessionHandlerCalls;

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(audioElement.playCalls, 2);

    // The app should re-register Media Session action handlers after the
    // <audio> element's src changes, so keyboard/earphone controls keep working.
    assert.ok(
        environment.mediaSessionHandlerCalls > callsAfterInit,
        "action handlers should be refreshed after a track change",
    );

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
});

test("restores saved track, volume, and theme before the first play", async () => {
    const { audioContexts, audioElement, elements, mediaActions, navigator, storage } = await startAppTestEnvironment({
        storageEntries: {
            "soundscape.currentTrackUrl": tracks[1].url,
            "soundscape.themePreference": "dark",
            "soundscape.volume": "0.42",
        },
    });
    const { current } = getTitleParts(elements);

    assert.equal(current.textContent, tracks[1].title);
    assert.equal(document.title, `${tracks[1].title} · Soundscape`);
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(elements.get("themeSelector").getAttribute("value"), "dark");
    assert.equal(elements.get("volumeControl").value, "0.42");
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "none");

    await mediaActions.play();

    assert.equal(audioElement.src, tracks[1].url);
    assert.equal(audioContexts[0].gains[1].gain.value, 0.42);
    assert.equal(storage.get("soundscape.currentTrackUrl"), tracks[1].url);

    await mediaActions.pause();
});

test("invalid saved preferences fall back to safe defaults", async () => {
    const { elements, navigator } = await startAppTestEnvironment({
        storageEntries: {
            "soundscape.currentTrackUrl": "resources/soundscapes/missing.opus",
            "soundscape.themePreference": "sepia",
            "soundscape.volume": "loud",
        },
    });
    const { current, incoming } = getTitleParts(elements);

    assert.equal(current.textContent, tracks[0].title);
    assert.equal(incoming.textContent, "");
    assert.equal(document.title, `${tracks[0].title} · Soundscape`);
    assert.equal(document.documentElement.dataset.theme, undefined);
    assert.equal(elements.get("themeSelector").getAttribute("value"), "system");
    assert.equal(elements.get("volumeControl").value, "1");
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "none");
});

test("volume and theme controls persist app preferences", async () => {
    const { audioContexts, audioElement, elements, mediaActions, storage } = await startAppTestEnvironment();
    const themeSelector = elements.get("themeSelector");
    const volumeControl = elements.get("volumeControl");

    await themeSelector.dispatch("theme-change", { detail: { theme: "light" } });
    volumeControl.value = "0.25";
    await volumeControl.dispatch("input");
    await mediaActions.play();

    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(themeSelector.getAttribute("value"), "light");
    assert.equal(storage.get("soundscape.themePreference"), "light");
    assert.equal(storage.get("soundscape.volume"), "0.25");
    assert.equal(audioContexts[0].gains[1].gain.value, 0.25);
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.pause();
});

test("button controls drive playback and track changes", async () => {
    const { audioElement, elements, navigator } = await startAppTestEnvironment();
    const playPauseButton = elements.get("playPauseButton");

    await playPauseButton.dispatch("click");
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(playPauseButton.getAttribute("aria-label"), "Pause");
    assert.equal(audioElement.playCalls, 1);

    await elements.get("nextButton").dispatch("click");
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);

    await elements.get("previousButton").dispatch("click");
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 3);

    await playPauseButton.dispatch("click");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(playPauseButton.getAttribute("aria-label"), "Play");
    assert.equal(audioElement.pauseCalls, 1);
});

test("global keyboard shortcuts drive playback and track changes", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    const spaceDown = await document.dispatch("keydown", { key: " ", repeat: false });
    const spaceUp = await document.dispatch("keyup", { key: " " });
    assert.equal(spaceDown.defaultPrevented, true);
    assert.equal(spaceUp.defaultPrevented, true);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    const right = await document.dispatch("keydown", { key: "ArrowRight", repeat: false });
    assert.equal(right.defaultPrevented, true);
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);

    const left = await document.dispatch("keydown", { key: "ArrowLeft", repeat: false });
    assert.equal(left.defaultPrevented, true);
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.pause();
});

test("global keyboard shortcuts ignore repeats and editable controls", async () => {
    const { audioElement, elements, navigator } = await startAppTestEnvironment();
    const editableTarget = elements.get("volumeControl");
    editableTarget.closestMatch = (selector) => (
        selector === "input, select, textarea, [contenteditable='true']" ? editableTarget : null
    );

    const repeat = await document.dispatch("keydown", { key: " ", repeat: true });
    const editable = await document.dispatch("keydown", {
        key: " ",
        repeat: false,
        target: editableTarget,
    });

    assert.equal(repeat.defaultPrevented, false);
    assert.equal(editable.defaultPrevented, false);
    assert.equal(audioElement.playCalls, 0);
    assert.equal(navigator.mediaSession.playbackState, "none");
});

test("track title changes animate and settle after animationend", async () => {
    const { elements, mediaActions, navigator } = await startAppTestEnvironment();
    const { current, incoming, title } = getTitleParts(elements);

    await mediaActions.next();

    assert.equal(current.textContent, tracks[0].title);
    assert.equal(incoming.textContent, tracks[1].title);
    assert.equal(document.title, `${tracks[1].title} · Soundscape`);
    assert.equal(title.classList.contains("is-changing"), true);
    assert.equal(title.classList.contains("is-changing-next"), true);
    assert.equal(navigator.mediaSession.playbackState, "paused");

    await title.dispatch("animationend", { target: incoming });

    assert.equal(current.textContent, tracks[1].title);
    assert.equal(incoming.textContent, "");
    assert.equal(title.classList.contains("is-changing"), false);
    assert.equal(title.classList.contains("is-changing-next"), false);
});

test("reduced motion track changes update the title without animation state", async () => {
    const { elements, mediaActions } = await startAppTestEnvironment({ matchMediaMatches: true });
    const { current, incoming, title } = getTitleParts(elements);

    await mediaActions.next();

    assert.equal(current.textContent, tracks[1].title);
    assert.equal(incoming.textContent, "");
    assert.equal(title.classList.contains("is-changing"), false);
    assert.equal(title.classList.contains("is-changing-next"), false);
});

test("browser media element events can resume and pause app playback", async () => {
    const { audioElement, navigator } = await startAppTestEnvironment();

    audioElement.paused = false;
    await audioElement.dispatch("play");
    await waitFor(() => navigator.mediaSession.playbackState === "playing");
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    audioElement.paused = true;
    await audioElement.dispatch("pause");
    await waitFor(() => navigator.mediaSession.playbackState === "paused");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.pauseCalls, 1);
});

test("media session position timer follows Web Audio time and stops on pause", async () => {
    const {
        audioContexts,
        intervals,
        mediaActions,
        mediaSessionPositionStates,
        triggerInterval,
    } = await startAppTestEnvironment();

    await mediaActions.play();
    assert.equal(intervals.size, 1);
    assert.deepEqual(getLastItem(mediaSessionPositionStates), {
        duration: FAKE_TRACK_LOOP_SECONDS,
        playbackRate: 1,
        position: 0,
    });

    audioContexts[0].currentTime += 5;
    await triggerInterval(getLastItem([...intervals.keys()]));

    assert.deepEqual(getLastItem(mediaSessionPositionStates), {
        duration: FAKE_TRACK_LOOP_SECONDS,
        playbackRate: 1,
        position: 5,
    });

    await mediaActions.pause();
    assert.equal(intervals.size, 0);
    assert.deepEqual(getLastItem(mediaSessionPositionStates), {
        duration: FAKE_TRACK_LOOP_SECONDS,
        playbackRate: 1,
        position: 5,
    });
});

test("media previous key keeps working after changing tracks while paused", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await startThenPause(mediaActions, navigator, audioElement);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, tracks.at(-1).title);
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, tracks.at(-2).title);
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 4);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});

test("volume changes use linear ramping for smooth transitions", async () => {
    const { audioContexts, elements, mediaActions } = await startAppTestEnvironment();
    const volumeControl = elements.get("volumeControl");

    await mediaActions.play();

    const trackGain = audioContexts[0].gains[1];
    assert.equal(trackGain.gain.value, 1);

    volumeControl.value = "0.5";
    await volumeControl.dispatch("input");

    const lastCall = trackGain.gain.calls.at(-1);
    assert.equal(lastCall.name, "linearRampToValueAtTime");
    assert.equal(lastCall.value, 0.5);
    assert.equal(trackGain.gain.value, 0.5);

    await mediaActions.pause();
});

test("track swapping while paused refreshes the browser playback surface", async () => {
    const { audioElement, mediaActions } = await startAppTestEnvironment();

    await mediaActions.play();
    await mediaActions.pause();
    assert.equal(audioElement.playCalls, 1);
    assert.equal(audioElement.pauseCalls, 1);

    await mediaActions.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(audioElement.playCalls, 2);
    assert.equal(audioElement.pauseCalls, 3);
});

test("app handles track load failures gracefully", async () => {
    const { audioContexts, audioElement, elements, mediaActions, navigator, storage } = await startAppTestEnvironment();
    const warnings = captureConsoleWarn();

    await mediaActions.play();
    const context = audioContexts[0];
    const { current, incoming, title } = getTitleParts(elements);

    context.decodeAudioDataShouldFail = true;

    await assert.doesNotReject(() => mediaActions.next());

    assert.equal(context.decodeAudioDataCalls, 2);
    assert.equal(audioElement.src, tracks[0].url);
    assert.equal(audioElement.playCalls, 1);
    assert.equal(current.textContent, tracks[0].title);
    assert.equal(incoming.textContent, "");
    assert.equal(title.classList.contains("is-changing"), false);
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(storage.get("soundscape.currentTrackUrl"), tracks[0].url);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Could not change soundscape track/);

    // The failure was absorbed: the previous soundscape never stopped. Putting a
    // warning on screen over uninterrupted audio would be noise, so this stays a
    // console-only, developer-facing event.
    assert.equal(elements.get("playbackError").hidden, true);
});

test("a failure that leaves the listener in silence is surfaced", async () => {
    const { audioContexts, elements, mediaActions, navigator } = await startAppTestEnvironment();
    const warnings = captureConsoleWarn();
    const playbackError = elements.get("playbackError");

    audioContexts.length = 0;
    // Nothing is playing yet, so a failed play leaves the user with silence and
    // no other signal that anything happened.
    const context = await startFailingPlay(mediaActions, audioContexts);

    assert.notEqual(navigator.mediaSession.playbackState, "playing");
    assert.equal(playbackError.hidden, false);
    assert.match(playbackError.textContent, /could not be played|offline/i);
    assert.equal(warnings.length, 1);

    // Recovering clears it again.
    context.decodeAudioDataShouldFail = false;
    await mediaActions.play();

    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(playbackError.hidden, true);
    assert.equal(playbackError.textContent, "");
});

async function startFailingPlay(mediaActions, audioContexts) {
    await mediaActions.play();
    const context = audioContexts[0];

    context.decodeAudioDataShouldFail = true;
    await mediaActions.pause();
    await mediaActions.next();

    return context;
}

// Kept in step with src/js/script.js; component-contract.test.js pins that value
// against the title change animation it has to outlast.
const LOADING_INDICATOR_DELAY_MS = 450;

// Audio the app has never fetched can take seconds to arrive on a slow
// connection. The title switches immediately, so without this the listener is
// told they are on the new soundscape while the old one is still playing.
function installGatedFetch() {
    const pending = [];
    let gateOpen = false;

    const respond = () => ({
        ok: true,
        async arrayBuffer() {
            return new ArrayBuffer(8);
        },
    });

    return {
        fetch() {
            if (gateOpen) return Promise.resolve(respond());

            return new Promise((resolve) => pending.push(() => resolve(respond())));
        },
        openGate() {
            gateOpen = true;
        },
        closeGate() {
            gateOpen = false;
        },
        release() {
            const next = pending.shift();

            assert.ok(next, "expected a pending audio fetch to release");
            next();
        },
    };
}

function loadingTimers(timeoutLog) {
    return timeoutLog.filter((timeout) => timeout.delay === LOADING_INDICATOR_DELAY_MS);
}

function pendingLoadingTimer(timeoutLog) {
    return loadingTimers(timeoutLog).find((timeout) => !timeout.fired && !timeout.cleared);
}

async function showLoadingIndicator(timeoutLog, triggerTimeout) {
    await waitFor(() => pendingLoadingTimer(timeoutLog) !== undefined);
    await triggerTimeout(pendingLoadingTimer(timeoutLog).id);
}

test("a track change that has to wait for audio shows a loading indicator", async () => {
    const gatedFetch = installGatedFetch();
    const { elements, mediaActions, navigator, timeoutLog, triggerTimeout } = await startAppTestEnvironment({
        fetch: () => gatedFetch.fetch(),
    });
    const trackLoading = elements.get("trackLoading");
    const title = elements.get("title");

    const play = mediaActions.play();
    await waitFor(() => pendingLoadingTimer(timeoutLog) !== undefined);

    // Nothing on screen yet: a cached track resolves well inside this window and
    // a flash of a loading bar on every skip is worse than no bar at all.
    assert.equal(trackLoading.hidden, true);
    assert.equal(title.classList.contains("is-loading"), false);

    await triggerTimeout(pendingLoadingTimer(timeoutLog).id);
    assert.equal(trackLoading.hidden, false);
    // The text has to land in the live region after it is revealed, not sit in
    // the markup: an announcement follows the content change, not the unhiding.
    assert.equal(elements.get("trackLoadingLabel").textContent, "Loading soundscape");
    assert.equal(title.classList.contains("is-loading"), true);

    gatedFetch.release();
    await play;

    assert.equal(trackLoading.hidden, true);
    assert.equal(elements.get("trackLoadingLabel").textContent, "");
    assert.equal(title.classList.contains("is-loading"), false);
    assert.equal(navigator.mediaSession.playbackState, "playing");
});

// Asserting on the timer log rather than the final `hidden` value is what makes
// this a real test: an implementation that showed the indicator immediately
// would also end up hidden, and would only be caught by the timer never firing.
test("a track change fast enough to need no indicator never shows one", async () => {
    const gatedFetch = installGatedFetch();
    gatedFetch.openGate();
    const { elements, mediaActions, timeoutLog } = await startAppTestEnvironment({
        fetch: () => gatedFetch.fetch(),
    });
    const trackLoading = elements.get("trackLoading");

    await mediaActions.play();
    await mediaActions.next();
    // Back to a track whose decoded buffer is already in memory — the real
    // cache-hit path, which skips the fetch entirely.
    await mediaActions.previous();

    const timers = loadingTimers(timeoutLog);

    assert.equal(timers.length, 3);
    assert.ok(
        timers.every((timeout) => timeout.cleared && !timeout.fired),
        "every loading timer should be cleared before it can show anything",
    );
    assert.equal(trackLoading.hidden, true);
    assert.equal(elements.get("title").classList.contains("is-loading"), false);
});

// The offline case reaches the same code path: audio that never arrives has to
// hand the screen over to the error message, not leave the bar sweeping forever.
test("a track change that fails after the indicator is showing hides it again", async () => {
    const gatedFetch = installGatedFetch();
    const { audioContexts, elements, mediaActions, timeoutLog, triggerTimeout } = await startAppTestEnvironment({
        fetch: () => gatedFetch.fetch(),
    });
    const warnings = captureConsoleWarn();
    const trackLoading = elements.get("trackLoading");
    const playbackError = elements.get("playbackError");

    gatedFetch.openGate();
    await mediaActions.play();
    await mediaActions.pause();

    gatedFetch.closeGate();
    audioContexts[0].decodeAudioDataShouldFail = true;

    const next = mediaActions.next();
    await showLoadingIndicator(timeoutLog, triggerTimeout);
    assert.equal(trackLoading.hidden, false);

    gatedFetch.release();
    await next;

    assert.equal(trackLoading.hidden, true);
    assert.equal(playbackError.hidden, false);
    assert.equal(warnings.length, 1);
});

// A second skip must inherit the wait rather than restart it. Re-arming the
// delay on every press would mean a listener skipping faster than the debounce
// never sees the indicator at all — exactly when they most need it.
test("skipping again mid-load keeps the indicator up instead of restarting it", async () => {
    const gatedFetch = installGatedFetch();
    const { elements, mediaActions, timeoutLog, triggerTimeout } = await startAppTestEnvironment({
        fetch: () => gatedFetch.fetch(),
    });
    const trackLoading = elements.get("trackLoading");

    gatedFetch.openGate();
    await mediaActions.play();
    gatedFetch.closeGate();

    const firstSkip = mediaActions.next();
    await showLoadingIndicator(timeoutLog, triggerTimeout);
    assert.equal(trackLoading.hidden, false);

    const secondSkip = mediaActions.next();
    assert.equal(pendingLoadingTimer(timeoutLog), undefined, "the delay should not be re-armed");
    assert.equal(trackLoading.hidden, false);

    // The superseded request finishing must not take the indicator down with it.
    gatedFetch.release();
    assert.equal(await firstSkip, false);
    assert.equal(trackLoading.hidden, false);

    gatedFetch.release();
    await secondSkip;
    assert.equal(trackLoading.hidden, true);
});

// A stale failure notice under a live loading bar reads as a contradiction, and
// in the reduced-motion variant the two messages overlap outright.
test("starting a new load takes down a previous failure notice", async () => {
    const gatedFetch = installGatedFetch();
    const { audioContexts, elements, mediaActions, timeoutLog, triggerTimeout } = await startAppTestEnvironment({
        fetch: () => gatedFetch.fetch(),
    });
    captureConsoleWarn();
    const trackLoading = elements.get("trackLoading");
    const playbackError = elements.get("playbackError");

    gatedFetch.openGate();
    await mediaActions.play();
    await mediaActions.pause();

    audioContexts[0].decodeAudioDataShouldFail = true;
    await mediaActions.next();
    assert.equal(playbackError.hidden, false);

    audioContexts[0].decodeAudioDataShouldFail = false;
    gatedFetch.closeGate();
    const retry = mediaActions.next();
    await showLoadingIndicator(timeoutLog, triggerTimeout);

    assert.equal(trackLoading.hidden, false);
    assert.equal(playbackError.hidden, true, "the failure notice should not sit under a live loading bar");
    assert.equal(playbackError.textContent, "");

    gatedFetch.release();
    await retry;
    assert.equal(trackLoading.hidden, true);
    assert.equal(playbackError.hidden, true);
});

test("media play failures after a track switch keep the switched track selected", async () => {
    const { audioElement, elements, mediaActions, navigator, storage } = await startAppTestEnvironment({
        matchMediaMatches: true,
    });
    const warnings = captureConsoleWarn();

    await mediaActions.play();
    audioElement.playShouldFail = true;

    assert.equal(await mediaActions.next(), false);

    const { current, incoming, title } = getTitleParts(elements);

    assert.equal(audioElement.src, tracks[1].url);
    assert.equal(audioElement.playCalls, 2);
    assert.equal(current.textContent, tracks[1].title);
    assert.equal(incoming.textContent, "");
    assert.equal(title.classList.contains("is-changing"), false);
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(elements.get("playPauseButton").getAttribute("aria-label"), "Play");
    assert.equal(storage.get("soundscape.currentTrackUrl"), tracks[1].url);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Could not start soundscape track/);
});

test("concurrent track switches do not cause title/state reversion on intermediate failure", async () => {
    const { audioElement, elements, mediaActions, navigator, storage } = await startAppTestEnvironment({
        matchMediaMatches: true,
    });

    await mediaActions.play(); // Start on track 0. playCalls is now 1.

    // Suspend the first switch's play() so we can run a newer switch while the
    // older one is still in flight. Without the stale-change guard, the older
    // switch's catch block reverts state that the newer switch has already set.
    let resolveFirstPlay;
    audioElement.playGates.push(new Promise((resolve) => {
        resolveFirstPlay = resolve;
    }));
    audioElement.playShouldFail = true;
    const firstNext = mediaActions.next(); // track 0 -> track 1

    // Wait until the first switch has consumed the gate and is parked inside
    // play(). playCalls advances from 1 to 2 when firstNext's playTrack calls
    // audioElement.play(), at which point the gate has been shifted off the
    // queue.
    await waitFor(() => audioElement.playCalls === 2 && audioElement.playGates.length === 0);

    // Now run a second switch that succeeds. The newer switch must update state
    // (currentTrackIndex, saved URL, title, media session) before we let the
    // older one fail.
    audioElement.playShouldFail = false;
    const secondNext = mediaActions.next(); // track 1 -> track 2
    await secondNext;

    // The newer switch has settled. Let the older switch fail; its catch must
    // NOT roll back currentTrackIndex, the saved URL, the title, or the media
    // session metadata.
    resolveFirstPlay();
    await firstNext;

    const { current, incoming, title } = getTitleParts(elements);

    assert.equal(current.textContent, tracks[2].title);
    assert.equal(incoming.textContent, "");
    assert.equal(title.classList.contains("is-changing"), false);
    assert.equal(navigator.mediaSession.metadata.title, tracks[2].title);
    assert.equal(storage.get("soundscape.currentTrackUrl"), tracks[2].url);
});


test("playback resumes when the document becomes visible if it was playing", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");

    globalThis.document.hidden = true;
    await document.dispatch("visibilitychange");

    assert.equal(navigator.mediaSession.playbackState, "playing");

    globalThis.document.hidden = false;
    await document.dispatch("visibilitychange");

    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.pause();
});

test("play/pause button aria-label stays in sync with playback state", async () => {
    const { elements, mediaActions } = await startAppTestEnvironment();
    const playPauseButton = elements.get("playPauseButton");

    assert.equal(playPauseButton.getAttribute("aria-label"), "Play");

    await mediaActions.play();
    assert.equal(playPauseButton.getAttribute("aria-label"), "Pause");

    await mediaActions.pause();
    assert.equal(playPauseButton.getAttribute("aria-label"), "Play");
});

test("app shortcut launches switch tracks in a running instance", async () => {
    let launchConsumer;
    const { audioElement, mediaActions, navigator, storage } = await startAppTestEnvironment({
        launchQueue: {
            setConsumer(consumer) {
                launchConsumer = consumer;
            },
        },
    });

    await mediaActions.play();
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(audioElement.playCalls, 1);

    launchConsumer({ targetURL: `https://soundscape.localhost/?track=${trackSlug(tracks[2])}` });
    await waitFor(() => navigator.mediaSession.metadata.title === tracks[2].title);

    assert.equal(audioElement.src, tracks[2].url);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);
    assert.equal(storage.get("soundscape.currentTrackUrl"), tracks[2].url);

    await mediaActions.pause();
});

test("app shortcut launches ignore unknown slugs and the current track", async () => {
    let launchConsumer;
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment({
        launchQueue: {
            setConsumer(consumer) {
                launchConsumer = consumer;
            },
        },
    });

    await mediaActions.play();
    assert.equal(audioElement.playCalls, 1);

    launchConsumer({ targetURL: "https://soundscape.localhost/?track=does-not-exist" });
    launchConsumer({ targetURL: `https://soundscape.localhost/?track=${trackSlug(tracks[0])}` });
    launchConsumer({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.src, tracks[0].url);
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.pause();
});

test("media stop key pauses the app", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");

    await mediaActions.stop();
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.pauseCalls, 1);
});

test("app handles localStorage failures without crashing", async () => {
    const { elements, storage } = await startAppTestEnvironment();
    const volumeControl = elements.get("volumeControl");
    const warnings = captureConsoleWarn();

    globalThis.localStorage.shouldFail = true;

    volumeControl.value = "0.1";
    await volumeControl.dispatch("input");

    assert.equal(storage.get("soundscape.volume"), undefined);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Could not save soundscape\.volume/);

    globalThis.localStorage.shouldFail = false;
});

test("media track keys keep playback running while already playing", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await mediaActions.play();
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, tracks[1].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, tracks[0].title);
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});
