import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    restoreAppTestEnvironment,
    startAppTestEnvironment,
} from "./helpers/app-test-harness.js";
import { tracks } from "../src/js/tracks.js";

/**
 * The app driving Chrome's Cast SDK, end to end.
 *
 * `app-remote-playback.test.js` covers the other provider and everything the two
 * share; this file does not repeat it. Here is only what the SDK path can show:
 * its loads are answered by a *receiver* rather than by an element, so it is the
 * one provider where a track change can be refused after the app has moved on.
 */

afterEach(() => {
    restoreAppTestEnvironment();
});

function settle(ticks = 8) {
    return Array.from({ length: ticks }).reduce((p) => p.then(() => {}), Promise.resolve());
}

// A person picking a device: the button opens the picker, the picker connects.
// Both halves matter — the session is what makes `getCurrentSession()` answer,
// and the state change is what the app hears.
async function castTo(environment) {
    await environment.elements.get("remotePlaybackUi").press();
    await settle();
    environment.castSdk.setCastState("CONNECTED");
    await settle();
}

function titleText(environment) {
    return environment.elements.get("title").children.get(".track-title-text--current").textContent;
}

function loadedTracks(environment) {
    return environment.castSdk.state.loads.map((load) => load.media.contentId);
}

test("the app reaches the Cast SDK on Chrome, and casts through it", async () => {
    const environment = await startAppTestEnvironment({ castSdk: true });

    assert.equal(
        environment.elements.get("remotePlaybackUi").attached,
        true,
        "Chrome should be offered a cast control",
    );

    await environment.elements.get("playPauseButton").dispatch("click");
    await castTo(environment);

    assert.equal(environment.elements.get("remotePlaybackUi").state, "connected");
    assert.match(loadedTracks(environment).at(-1) ?? "", /\.m4a$/, "the receiver plays the AAC twin");
    assert.equal(
        environment.audioElement.paused,
        true,
        "local playback is parked while the room has it",
    );
});

test("a track change while casting moves the receiver and the title together", async () => {
    const environment = await startAppTestEnvironment({ castSdk: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await castTo(environment);

    const before = loadedTracks(environment).length;

    await environment.elements.get("nextButton").dispatch("click");
    await settle();

    assert.equal(
        loadedTracks(environment).length,
        before + 1,
        "one press must reach the receiver exactly once",
    );
    // Read through Media Session, not the <h1>: the on-screen title crosses a
    // 420ms animation and only settles when it ends, so it still holds the old
    // name at this point. Metadata is written synchronously and is the honest
    // answer to "what does the app think is playing".
    assert.equal(
        environment.navigator.mediaSession.metadata.title,
        tracks[1].title,
        "the OS media UI names what the receiver was actually given",
    );
});

// A single track change asks the receiver three times and awaits one of them.
// While the controller deduplicated by *refusing* the later callers, the awaited
// one was among the refused — so it resolved before the receiver had said
// anything, and a refusal reached nobody. The title sat on a soundscape the room
// was not playing.
//
// Only reachable while a load is open, hence `holdLoads`; see the fake.
test("a track change the receiver refuses rolls the title back to what is playing", async () => {
    const environment = await startAppTestEnvironment({ castSdk: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await castTo(environment);

    const playing = titleText(environment);

    environment.castSdk.state.holdLoads = true;
    environment.castSdk.state.loadShouldFail = true;

    const skip = environment.elements.get("nextButton").dispatch("click");
    await settle();

    assert.ok(
        environment.castSdk.heldLoadCount() > 0,
        "the receiver should still be deciding — otherwise this proves nothing",
    );

    await environment.castSdk.settleLoads();
    await skip;
    await settle();

    assert.equal(
        environment.navigator.mediaSession.metadata.title,
        playing,
        "the app reported a soundscape the receiver had refused",
    );
    assert.equal(
        titleText(environment),
        playing,
        "the title kept naming a soundscape the room was not playing",
    );
});

// The half that is worse for the listener: putting the app back on the playing
// soundscape must not re-fetch it, or a failed skip restarts the room from zero.
test("the rollback does not restart the soundscape the room is already playing", async () => {
    const environment = await startAppTestEnvironment({ castSdk: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await castTo(environment);

    environment.castSdk.state.holdLoads = true;
    environment.castSdk.state.loadShouldFail = true;

    const skip = environment.elements.get("nextButton").dispatch("click");
    await settle();
    await environment.castSdk.settleLoads();
    await skip;

    environment.castSdk.state.holdLoads = false;
    environment.castSdk.state.loadShouldFail = false;
    await settle();
    await environment.castSdk.settleLoads();

    // Counted by URL, not by total: the rollback runs inside the failure it
    // reacts to, so a baseline taken afterwards already contains the load it is
    // meant to catch. This soundscape was handed over once, when casting began.
    const playingLoads = loadedTracks(environment).filter(
        (url) => url === loadedTracks(environment)[0],
    );

    assert.equal(
        playingLoads.length,
        1,
        "the receiver was told to reload the soundscape it was already playing",
    );
});

// Ending a cast has to leave the room as it found it. The app's own pause is not
// what decides that — the receiver's settled state is, because the person who
// pressed pause may have been standing at the speaker.
test("ending a cast that was playing continues the soundscape on this device", async () => {
    const environment = await startAppTestEnvironment({ castSdk: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await castTo(environment);

    assert.equal(environment.audioElement.paused, true);

    environment.castSdk.setCastState("NOT_CONNECTED");
    await settle();

    assert.equal(environment.elements.get("remotePlaybackUi").state, "idle");
    assert.equal(
        environment.audioElement.paused,
        false,
        "the soundscape should come back here rather than stop",
    );
});
