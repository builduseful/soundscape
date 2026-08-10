import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    restoreAppTestEnvironment,
    startAppTestEnvironment,
} from "./helpers/app-test-harness.js";
import { tracks } from "../src/js/tracks.js";

afterEach(() => {
    restoreAppTestEnvironment();
});

async function connectCast(environment) {
    await environment.castRemote.connect();
    await settle();
}

// Any pointer or key event releases the cast element to load. Most tests want
// that already done, because a real user has touched the page long before they
// reach for the cast button.
async function touchPage(environment) {
    await globalThis.document.dispatch("pointerdown");
    await settle();

    return environment;
}

async function disconnectCast(environment) {
    await environment.castRemote.disconnect();
    await settle();
}

// The app awaits inside its cast handlers; the harness's event dispatch awaits
// the handler itself, but the promise chains it starts still need a turn.
function settle() {
    return new Promise((resolve) => setImmediate(resolve));
}

function basename(url) {
    return url.split("/").pop();
}

// Deciding this from whether a device is on the network would mean scanning it
// continuously to control one button. The button is simply there, and the picker
// it opens does its own discovery.
test("the cast button is there from the start, without asking the network", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const castButton = environment.elements.get("castButton");

    assert.equal(castButton.hidden, false);
    assert.equal(castButton.dataset.castState, "idle");
});

// It is the one control that can stop a cast, so it can never go away while one
// is running. Nothing recomputes its visibility any more, which is what makes
// that true by construction rather than by a guard.
test("the cast button stays put across a whole cast", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const castButton = environment.elements.get("castButton");

    await connectCast(environment);
    assert.equal(castButton.hidden, false);
    assert.equal(castButton.dataset.castState, "connected");

    await disconnectCast(environment);
    assert.equal(castButton.hidden, false);
    assert.equal(castButton.dataset.castState, "idle");
});

test("a browser with no cast support never shows the button", async () => {
    const environment = await startAppTestEnvironment();

    assert.equal(environment.elements.get("castButton").hidden, true);
    assert.equal(environment.castRemote, null);
});

// The whole point of the design: the app finds out what is on the network by
// opening the picker, never by scanning. Nothing in a full session should call it.
test("the app never starts an availability scan", async () => {
    const environment = await touchPage(await startAppTestEnvironment({ castDevices: true }));

    await environment.elements.get("nextButton").dispatch("click");
    await settle();
    await connectCast(environment);
    await disconnectCast(environment);

    assert.equal(environment.castRemote.watchAvailabilityCalls, 0);
});

test("clicking the cast button opens the device picker", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("castButton").dispatch("click");

    assert.equal(environment.castRemote.promptCalls, 1);
});

// The press that opens the picker is often the press that sources the element,
// and neither platform will show a device list before the header is read. The
// app waits for it rather than prompting into a guaranteed no-op.
test("the cast button waits for the transport's header before prompting", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    environment.castAudioElement.autoLoadMetadata = false;

    const clicked = environment.elements.get("castButton").dispatch("click");

    await settle();
    assert.equal(environment.castRemote.promptCalls, 0);

    environment.castAudioElement.completeMetadataLoad();
    await clicked;

    assert.equal(environment.castRemote.promptCalls, 1);
    assert.equal(environment.elements.get("playbackError").hidden, true);
});

// Chromium reports a picker it never opened as an ordinary dismissal, so a
// transport that never loads leaves the button looking simply broken. That is
// the one cast outcome the app has to put into words itself — and it says so
// even while audio is playing, since the soundscape playing on is no answer to a
// device list that will not appear.
test("a cast press that cannot reach a picker says so", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    environment.castAudioElement.autoLoadMetadata = false;
    environment.castRemote.promptShouldReject = Object.assign(new Error("dismissed"), {
        name: "NotAllowedError",
    });

    const clicked = environment.elements.get("castButton").dispatch("click");

    await settle();
    environment.castAudioElement.failMetadataLoad();
    await clicked;

    const playbackError = environment.elements.get("playbackError");

    assert.equal(playbackError.hidden, false);
    assert.match(playbackError.textContent, /device list/i);
});

test("connecting moves the soundscape to the receiver and silences local audio", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    assert.equal(environment.audioElement.paused, false);

    await connectCast(environment);

    // The local element is parked and the AudioContext suspended: the decoded
    // buffer cannot reach a cast target, so leaving it running would play the
    // soundscape in two places at once.
    assert.equal(environment.audioElement.paused, true);
    assert.equal(environment.audioContexts.at(-1).state, "suspended");
    assert.equal(environment.castAudioElement.paused, false);
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
});

test("connecting while paused does not start playing on the receiver", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await connectCast(environment);

    assert.equal(environment.castAudioElement.paused, true);
    assert.equal(environment.castAudioElement.playCalls, 0);
    assert.equal(environment.navigator.mediaSession.playbackState, "paused");
});

test("the receiver is handed the AAC twin, not the Opus original", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await connectCast(environment);

    assert.match(environment.castAudioElement.src, /\.m4a$/);
    assert.doesNotMatch(environment.castAudioElement.src, /\.opus$/);
});

// Once a person has touched the page the picker could open at any moment, and
// Safari will not open it on an element whose header has not been read — so from
// the first gesture the file is kept current, connected or not.
test("the cast element follows track changes once the page has been touched", async () => {
    const environment = await touchPage(await startAppTestEnvironment({ castDevices: true }));

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[0].castUrl)}$`));

    await environment.elements.get("nextButton").dispatch("click");
    await settle();

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[1].castUrl)}$`));
});

// `preload="metadata"` is a hint, not a budget: Chrome reads well past the header
// on a file this small, so an element sourced at boot charges every visitor for a
// cast most will never start. A tab restored on startup and never touched should
// cost nothing at all.
test("an untouched page fetches no cast audio", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    assert.equal(environment.castAudioElement.src, "", "nothing sourced before a gesture");
});

// The gesture is what releases it, and it lands long before anyone can reach the
// button — which is the point: loading it inside prompt() would reset readyState
// and break the very picker it was meant to serve.
test("the first gesture is what loads the cast audio", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await touchPage(environment);

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[0].castUrl)}$`));
});

// A keypress is a gesture too — the app is fully keyboard-driven, so someone who
// never touches a pointer must still be able to cast.
test("a keypress releases the cast transport as well as a pointer", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await globalThis.document.dispatch("keydown", { key: "Tab" });
    await settle();

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[0].castUrl)}$`));
});

// A cast can also open from outside the app — the OS picker, or a receiver being
// handed over — with no gesture on the page at all. The connection edge has to
// bring the element up to the current soundscape, or the receiver would start on
// whatever the element last held, which in this case is nothing.
test("a cast opened from outside the app still gets the current track", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("nextButton").dispatch("click");
    await settle();
    assert.equal(environment.castAudioElement.src, "", "still untouched, still unsourced");

    await connectCast(environment);

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[1].castUrl)}$`));
});

test("disconnecting hands a playing soundscape back to local audio", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);
    assert.equal(environment.castAudioElement.paused, false);

    await disconnectCast(environment);

    assert.equal(environment.castAudioElement.paused, true);
    assert.equal(environment.audioElement.paused, false);
    assert.equal(environment.audioContexts.at(-1).state, "running");
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
});

// Connecting and leaving without ever pressing play should cost nothing: no
// local track was ever loaded, so the app lands back in its cold-start state
// rather than claiming a paused soundscape it does not have.
test("disconnecting a cast that never played returns the app to its idle state", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await connectCast(environment);
    assert.equal(environment.navigator.mediaSession.playbackState, "paused", "a connected cast is idle, not absent");

    await disconnectCast(environment);

    assert.equal(environment.audioElement.paused, true);
    assert.equal(environment.castAudioElement.paused, true);
    assert.equal(environment.navigator.mediaSession.playbackState, "none");
});

// A session that only ever played on the receiver has no AudioContext yet, so
// the handback has to build one from cold. It is the one playback start with no
// user gesture behind it — a browser may refuse, and then the failure is
// reported rather than swallowed, but where it is allowed the audio continues.
test("disconnecting hands back even when the session only ever played on the cast", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await connectCast(environment);
    await environment.elements.get("playPauseButton").dispatch("click");
    assert.equal(environment.castAudioElement.paused, false);
    assert.equal(environment.audioContexts.length, 0, "casting should not build an audio graph");

    await disconnectCast(environment);
    await settle();

    assert.equal(environment.castAudioElement.paused, true);
    assert.equal(environment.audioElement.paused, false);
    assert.equal(environment.audioContexts.at(-1).state, "running");
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
});

// The receiver owns the position and the page cannot read it. The local player
// still holds the buffer from before the cast and its context is suspended, so
// its reading would pin a frozen position under a playing state.
test("no position state is published while casting", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    assert.ok(
        environment.mediaSessionPositionStates.some((state) => state?.duration > 0),
        "local playback should report a position",
    );

    await connectCast(environment);

    assert.deepEqual(environment.mediaSessionPositionStates.at(-1), {});

    // The 1s position poller must stop. The cast progress watchdog is a
    // different timer with a different job, and it stays.
    const delays = [...environment.intervals.values()].map((interval) => interval.delay);

    assert.ok(!delays.includes(1000), "nothing should be polling for a position");
});

// A receiver has its own controls and the person holding them is not this page.
// Without the transport listeners the room could be paused from the device while
// the app went on showing playing — and the Remote Playback API says nothing
// about it, so the element's own events are the only word the app gets.
test("a pause at the receiver reaches the app", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const playPauseButton = environment.elements.get("playPauseButton");

    await playPauseButton.dispatch("click");
    await connectCast(environment);
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");

    // Paused on the device itself: the element goes paused and announces it,
    // with nothing in the app having asked for it.
    environment.castAudioElement.paused = true;
    await environment.castAudioElement.dispatch("pause");

    assert.equal(environment.navigator.mediaSession.playbackState, "paused");
    assert.equal(playPauseButton.dataset.playing, "false");

    environment.castAudioElement.paused = false;
    await environment.castAudioElement.dispatch("play");

    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
    assert.equal(playPauseButton.dataset.playing, "true");
});

// Assigning `src` runs the media load algorithm, which pauses the element and
// fires `pause` — so every track change while casting emits one for a cast that
// is not stopping. The listener re-reads the transport instead of trusting the
// event, which is what keeps that from reading as "the receiver stopped".
test("the pause a track change fires does not read as a stopped receiver", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);

    await environment.elements.get("nextButton").dispatch("click");
    await settle();

    // The element is playing the new track by now, so the late event describes a
    // state that has already been overtaken.
    await environment.castAudioElement.dispatch("pause");

    assert.equal(environment.castAudioElement.paused, false);
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");

    // The handback reads the cast's playback intent and nothing else, so this is
    // where a wrongly cleared intent would surface: as a room that goes quiet on
    // disconnect instead of picking the soundscape back up.
    await disconnectCast(environment);
    assert.equal(environment.audioElement.paused, false, "intent survived the event");
});

// A connect and a disconnect arriving close together leave two transitions in
// flight, each awaiting a transport the other is undoing. The stale one must not
// touch the error strip on its way out: here the handback fails and says so, and
// a connect that finished afterwards would otherwise wipe that message.
test("a superseded cast transition cannot clear a newer failure", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const playbackError = environment.elements.get("playbackError");

    await environment.elements.get("playPauseButton").dispatch("click");

    // Hold the cast's play() open so the disconnect overtakes the connect.
    let releaseCastPlay;
    environment.castAudioElement.playGates.push(new Promise((resolve) => {
        releaseCastPlay = resolve;
    }));

    await connectCast(environment);

    // Local playback cannot restart, so the handback reports a failure.
    environment.audioElement.playShouldFail = true;
    await disconnectCast(environment);

    assert.equal(playbackError.hidden, false, "the handback failure is on screen");

    const reported = playbackError.textContent;

    releaseCastPlay();
    await settle();

    assert.equal(playbackError.hidden, false, "the stale transition left it alone");
    assert.equal(playbackError.textContent, reported);
});

// A device can connect while the very first track is still being fetched and
// decoded. That track has never loaded, so the player's "is a track playing?"
// answer is false — but the user has pressed play, and taking the load state for
// the intent hands the receiver a silence they did not ask for.
test("a cast that connects mid-load still answers the press of play", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    // Hold the first decode open so the connect lands inside it.
    let releaseFetch;
    const gate = new Promise((resolve) => {
        releaseFetch = resolve;
    });
    const realFetch = globalThis.fetch;

    globalThis.fetch = async (...args) => {
        await gate;
        return realFetch(...args);
    };

    const play = environment.elements.get("playPauseButton").dispatch("click");

    await connectCast(environment);
    releaseFetch();
    await play;
    await settle();

    assert.equal(environment.castAudioElement.paused, false, "the receiver should be playing");
    assert.equal(environment.audioElement.paused, true, "and local audio silent");
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
});

test("play and pause drive the receiver while casting", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const playPauseButton = environment.elements.get("playPauseButton");

    await connectCast(environment);

    await playPauseButton.dispatch("click");
    assert.equal(environment.castAudioElement.paused, false);
    assert.equal(environment.audioElement.paused, true, "local audio should stay silent");
    assert.equal(playPauseButton.dataset.playing, "true");

    await playPauseButton.dispatch("click");
    assert.equal(environment.castAudioElement.paused, true);
    assert.equal(playPauseButton.dataset.playing, "false");
});

test("changing track while casting swaps the receiver's source without decoding locally", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);

    const decodeCallsBeforeSkip = environment.audioContexts.at(-1).decodeAudioDataCalls;

    await environment.elements.get("nextButton").dispatch("click");
    await settle();

    assert.match(environment.castAudioElement.src, new RegExp(`${tracks[1].castUrl.split("/").pop()}$`));
    assert.equal(environment.castAudioElement.paused, false);
    // Nothing is fetched or decoded for a cast — the receiver pulls the file
    // itself — so the loading indicator has no reason to arm.
    assert.equal(
        environment.audioContexts.at(-1).decodeAudioDataCalls,
        decodeCallsBeforeSkip,
        "casting should not decode audio locally",
    );
    assert.equal(environment.elements.get("trackLoading").hidden, true);
    assert.equal(environment.navigator.mediaSession.metadata.title, tracks[1].title);
});

// Two quick skips leave two track changes in flight, and the receiver can answer
// the first one last. The local path is covered by AudioPlayer's own stale-request
// guard; a cast has no equivalent, so an out-of-order answer would let the older
// skip write its metadata over the newer one's — the OS media UI naming a
// soundscape the receiver is no longer pointed at.
test("a superseded skip while casting cannot overwrite the newer track's metadata", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);

    // Hold the first skip's play() open so the second one overtakes it.
    let releaseFirstSkip;
    environment.castAudioElement.playGates.push(new Promise((resolve) => {
        releaseFirstSkip = resolve;
    }));

    const nextButton = environment.elements.get("nextButton");
    const firstSkip = nextButton.dispatch("click");

    await nextButton.dispatch("click");
    await settle();
    assert.equal(environment.navigator.mediaSession.metadata.title, tracks[2].title);

    releaseFirstSkip();
    await firstSkip;
    await settle();

    assert.equal(
        environment.navigator.mediaSession.metadata.title,
        tracks[2].title,
        "the older skip should not report itself once it is no longer current",
    );
    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[2].castUrl)}$`));
});

// The rollback in changeTrack asks "did the attempted track load anyway?". While
// casting only the cast element can answer: the local player still holds the
// track from before the cast, so it would always say no and roll the title back
// to a soundscape the receiver is no longer pointed at.
test("a failed skip while casting keeps the title on the track the receiver holds", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);

    environment.castAudioElement.playShouldFail = true;
    await environment.elements.get("nextButton").dispatch("click");
    await settle();

    assert.match(environment.castAudioElement.src, new RegExp(`${basename(tracks[1].castUrl)}$`));
    assert.equal(
        environment.navigator.mediaSession.metadata.title,
        tracks[1].title,
        "the app should stay on the track the receiver was handed",
    );
});

test("media keys keep working while casting", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await connectCast(environment);

    await environment.mediaActions.play();
    assert.equal(environment.castAudioElement.paused, false);

    await environment.mediaActions.next();
    await settle();
    assert.equal(environment.navigator.mediaSession.metadata.title, tracks[1].title);

    await environment.mediaActions.pause();
    assert.equal(environment.castAudioElement.paused, true);
});

// A cast target's volume belongs to the device. Chromium forwards element
// volume to the receiver as a stream volume change — on a Cast device that is
// the speaker's own level, and it outlives the session — so connecting must not
// quietly turn the room up or down to wherever the slider happens to sit.
test("the volume slider never reaches the cast device", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const volumeControl = environment.elements.get("volumeControl");

    volumeControl.value = "0.35";
    await volumeControl.dispatch("input");

    assert.equal(environment.castAudioElement.volume, 1);
    assert.equal(environment.audioContexts.length, 0, "volume alone should not create an AudioContext");

    await connectCast(environment);
    assert.equal(environment.castAudioElement.volume, 1);

    volumeControl.value = "0.8";
    await volumeControl.dispatch("input");
    assert.equal(environment.castAudioElement.volume, 1, "not even while connected");
});

// A control that moves nothing is a control that lies, so it says so instead.
test("the volume control stands down while a device owns the audio", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const volumeControl = environment.elements.get("volumeControl");

    assert.equal(volumeControl.hasAttribute("disabled"), false);

    await connectCast(environment);

    assert.equal(volumeControl.hasAttribute("disabled"), true);
    assert.match(volumeControl.getAttribute("label"), /device/i);

    await disconnectCast(environment);

    assert.equal(volumeControl.hasAttribute("disabled"), false);
    assert.equal(volumeControl.getAttribute("label"), "Volume");
});

// The connection shows itself as a filled glyph and a changed button label,
// neither of which a screen reader announces on an unfocused control.
test("connecting and disconnecting are announced", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const castStatus = environment.elements.get("castStatus");

    assert.equal(castStatus.textContent, "", "nothing to announce at rest");

    await connectCast(environment);
    assert.match(castStatus.textContent, /another device/i);

    await disconnectCast(environment);
    assert.match(castStatus.textContent, /this device/i);
});

// Reaching a Chromecast takes seconds. The button pulses and relabels, but a
// label on an unfocused control is never announced, so without this the screen
// reader user gets silence for the whole wait.
test("the wait for a device is announced too", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const castStatus = environment.elements.get("castStatus");
    await environment.castRemote.beginConnecting();
    await settle();

    assert.equal(environment.elements.get("castButton").dataset.castState, "connecting");
    assert.match(castStatus.textContent, /connecting/i);
});

// "Playback returned to this device" is only true if it ever left. A connection
// abandoned before it completed never moved the audio, so the announcement is
// cleared rather than replaced with a claim that did not happen.
test("a connection that never completes is not announced as a handback", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });
    const castStatus = environment.elements.get("castStatus");
    await environment.castRemote.beginConnecting();
    await settle();
    await disconnectCast(environment);

    assert.equal(castStatus.textContent, "");
});

test("the local element's own pause event cannot stop a running cast", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);
    assert.equal(environment.castAudioElement.paused, false);

    // Parking the local element fires a pause event. Without a cast guard that
    // event reads as "the user paused" and would stop the receiver too.
    await environment.audioElement.dispatch("pause");

    assert.equal(environment.castAudioElement.paused, false);
    assert.equal(environment.navigator.mediaSession.playbackState, "playing");
});

test("returning to the tab does not resume local audio during a cast", async () => {
    const environment = await startAppTestEnvironment({ castDevices: true });

    await environment.elements.get("playPauseButton").dispatch("click");
    await connectCast(environment);

    globalThis.document.hidden = false;
    await globalThis.document.dispatch("visibilitychange");

    assert.equal(environment.audioElement.paused, true);
    assert.equal(environment.audioContexts.at(-1).state, "suspended");
});
