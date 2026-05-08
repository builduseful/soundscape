import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { initMediaSession, updateMediaSessionStatus } from "../src/media-session.js";

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
    const mediaSession = {
        metadata: undefined,
        setActionHandler(action, handler) {
            handlers.set(action, handler);
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

    return { handlers, mediaSession };
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

test("initMediaSession starts playback, publishes metadata, and wires media key handlers", async () => {
    const { handlers, mediaSession } = installMediaSession();
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
        async initMediaSession() {
            calls.push("initMediaSession");
        },
    };
    const track = {
        title: "Rain",
        image: "/fallback-artwork.jpg",
    };

    await initMediaSession(track, actions, audioElement, "/artwork.jpg");

    assert.deepEqual(calls, ["playAudio"]);
    assert.equal(mediaSession.metadata.title, "Rain");
    assert.equal(mediaSession.metadata.artist, "Soundscape");
    assert.equal(mediaSession.metadata.album, "Nature");
    assert.deepEqual(mediaSession.metadata.artwork, [
        { src: "/artwork.jpg", sizes: "1024x1024", type: "image/jpeg" },
    ]);
    assert.deepEqual([...handlers.keys()], [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "stop",
    ]);

    await handlers.get("play")();
    await handlers.get("pause")();
    await handlers.get("previoustrack")();
    await handlers.get("nexttrack")();
    await handlers.get("stop")();

    assert.deepEqual(calls, [
        "playAudio",
        "playAudio",
        "pauseAudio",
        "playPreviousTrack",
        "playNextTrack",
        "initMediaSession",
        "pauseAudio",
    ]);
});

test("initMediaSession wires audio element play and pause fallbacks", async () => {
    installMediaSession();
    const audioElement = createAudioElement();
    const calls = [];
    const actions = {
        async playAudio() {
            calls.push("playAudio");
        },
        async pauseAudio() {
            calls.push("pauseAudio");
        },
        async playPreviousTrack() {},
        async playNextTrack() {},
        async initMediaSession() {},
    };

    await initMediaSession({ title: "Rain", image: "/rain.jpg" }, actions, audioElement);
    await audioElement.dispatch("play");
    await audioElement.dispatch("pause");

    assert.deepEqual(calls, ["playAudio", "playAudio", "pauseAudio"]);
});

test("updateMediaSessionStatus falls back to the track image for artwork", () => {
    const { mediaSession } = installMediaSession();

    updateMediaSessionStatus({ title: "Brown Noise", image: "/brown.jpg" });

    assert.equal(mediaSession.metadata.title, "Brown Noise");
    assert.deepEqual(mediaSession.metadata.artwork, [
        { src: "/brown.jpg", sizes: "1024x1024", type: "image/jpeg" },
    ]);
});
