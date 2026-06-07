import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    restoreAppTestEnvironment,
    startAppTestEnvironment,
} from "../test-helpers/app-test-harness.js";
import { tracks } from "../src/tracks.js";

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
    assert.equal(document.title, tracks[1].title);
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
    assert.equal(document.title, tracks[0].title);
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
    assert.equal(document.title, tracks[1].title);
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
        duration: 30,
        playbackRate: 1,
        position: 0,
    });

    audioContexts[0].currentTime += 5;
    await triggerInterval(getLastItem([...intervals.keys()]));

    assert.deepEqual(getLastItem(mediaSessionPositionStates), {
        duration: 30,
        playbackRate: 1,
        position: 5,
    });

    await mediaActions.pause();
    assert.equal(intervals.size, 0);
    assert.deepEqual(getLastItem(mediaSessionPositionStates), {
        duration: 30,
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
