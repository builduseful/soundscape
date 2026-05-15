import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    restoreAppTestEnvironment,
    startAppTestEnvironment,
} from "../test-helpers/app-test-harness.js";

afterEach(() => {
    restoreAppTestEnvironment();
});

async function startThenPause(mediaActions, navigator, audioElement) {
    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
}

test("media next key keeps working after changing tracks while paused", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await startThenPause(mediaActions, navigator, audioElement);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, "Garden Rain");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, "Heavy Rain");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 4);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});

test("media previous key keeps working after changing tracks while paused", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await startThenPause(mediaActions, navigator, audioElement);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, "Brown Noise");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, "Pink Noise");
    assert.equal(navigator.mediaSession.playbackState, "paused");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.play();
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 4);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});

test("media track keys keep playback running while already playing", async () => {
    const { audioElement, mediaActions, navigator } = await startAppTestEnvironment();

    await mediaActions.play();
    assert.equal(navigator.mediaSession.metadata.title, "Rain");
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 1);

    await mediaActions.next();
    assert.equal(navigator.mediaSession.metadata.title, "Garden Rain");
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 2);

    await mediaActions.previous();
    assert.equal(navigator.mediaSession.metadata.title, "Rain");
    assert.equal(navigator.mediaSession.playbackState, "playing");
    assert.equal(audioElement.playCalls, 3);

    await mediaActions.pause();
    assert.equal(navigator.mediaSession.playbackState, "paused");
});
