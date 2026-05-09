import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import {
    initMediaSession,
    updateMediaSessionPlaybackState,
    updateMediaSessionStatus,
} from "../src/media-session.js";

const originalMediaMetadata = globalThis.MediaMetadata;
const originalNavigator = globalThis.navigator;
const originalConsoleLog = console.log;

beforeEach(() => {
    console.log = () => {};
});

afterEach(() => {
    console.log = originalConsoleLog;
    globalThis.MediaMetadata = originalMediaMetadata;
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
    });
});

function installMediaSession() {
    const handlers = new Map();
    const positionStates = [];
    const mediaSession = {
        metadata: undefined,
        playbackState: "none",
        setActionHandler(action, handler) {
            handlers.set(action, handler);
        },
        setPositionState(positionState) {
            positionStates.push(positionState);
        },
    };

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: { mediaSession },
    });
    globalThis.MediaMetadata = class FakeMediaMetadata {
        constructor(metadata) {
            Object.assign(this, metadata);
        }
    };

    return { handlers, mediaSession, positionStates };
}

function createAudioElement() {
    const handlers = new Map();

    return {
        addEventListener(type, handler) {
            handlers.set(type, handler);
        },
        async dispatch(type) {
            await handlers.get(type)();
        },
    };
}

test("initMediaSession publishes metadata and wires media key handlers", async () => {
    const { handlers, mediaSession, positionStates } = installMediaSession();
    const audioElement = createAudioElement();
    const calls = [];
    const actions = {
        async playAudio() {
            calls.push("playAudio");
        },
        async pauseAudio() {
            calls.push("pauseAudio");
        },
        async playPreviousTrack() {
            calls.push("playPreviousTrack");
        },
        async playNextTrack() {
            calls.push("playNextTrack");
        },
    };
    const track = {
        title: "Rain",
    };

    await initMediaSession(track, actions, audioElement);

    assert.deepEqual(calls, []);
    assert.equal(mediaSession.metadata.title, "Rain");
    assert.equal(mediaSession.metadata.artist, "Soundscape");
    assert.equal(mediaSession.metadata.album, "Nature");
    assert.deepEqual(positionStates, [{}]);
    assert.deepEqual([...handlers.keys()], [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
    ]);

    await handlers.get("play")();
    await handlers.get("pause")();
    await handlers.get("previoustrack")();
    await handlers.get("nexttrack")();

    assert.deepEqual(calls, [
        "playAudio",
        "pauseAudio",
        "playPreviousTrack",
        "playNextTrack",
    ]);
});

test("initMediaSession wires audio element play and pause state sync", async () => {
    installMediaSession();
    const audioElement = createAudioElement();
    const calls = [];
    const actions = {
        async playAudio() {},
        async pauseAudio() {},
        async playPreviousTrack() {},
        async playNextTrack() {},
        onPlaybackStart() {
            calls.push("onPlaybackStart");
        },
        onPlaybackPause() {
            calls.push("onPlaybackPause");
        },
    };

    await initMediaSession({ title: "Rain" }, actions, audioElement);
    await audioElement.dispatch("play");
    await audioElement.dispatch("pause");

    assert.deepEqual(calls, ["onPlaybackStart", "onPlaybackPause"]);
});

test("updateMediaSessionStatus publishes track metadata", () => {
    const { mediaSession, positionStates } = installMediaSession();

    updateMediaSessionStatus({ title: "Brown Noise" });

    assert.equal(mediaSession.metadata.title, "Brown Noise");
    assert.deepEqual(positionStates, [{}]);
});

test("updateMediaSessionPlaybackState publishes playback state", () => {
    const { mediaSession } = installMediaSession();

    updateMediaSessionPlaybackState("playing");

    assert.equal(mediaSession.playbackState, "playing");
});

test("media session helpers are no-ops when the API is unavailable", () => {
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {},
    });

    assert.doesNotThrow(() => initMediaSession({ title: "Rain" }, {}, createAudioElement()));
    assert.doesNotThrow(() => updateMediaSessionStatus({ title: "Rain" }));
    assert.doesNotThrow(() => updateMediaSessionPlaybackState("paused"));
});
