import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CAST_BACKENDS, CastController, selectCastBackend } from "../src/js/cast.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});

function createElement(extras = {}) {
    const listeners = new Map();

    return {
        baseURI: "https://soundscape.test/",
        paused: true,
        src: "",
        volume: 1,
        loop: false,
        playCalls: 0,
        pauseCalls: 0,
        addEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            handlers.push(handler);
            listeners.set(type, handlers);
        },
        removeEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            listeners.set(type, handlers.filter((candidate) => candidate !== handler));
        },
        async emit(type, event = {}) {
            for (const handler of listeners.get(type) ?? []) {
                await handler({ type, ...event });
            }
        },
        listenerCount(type) {
            return (listeners.get(type) ?? []).length;
        },
        async play() {
            this.playCalls += 1;
            this.paused = false;
        },
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
        },
        ...extras,
    };
}

function createRemote() {
    const listeners = new Map();

    return {
        state: "disconnected",
        promptCalls: 0,
        promptRejection: null,
        // Counted, not implemented: the controller must never call this.
        watchAvailabilityCalls: 0,
        watchAvailability() {
            this.watchAvailabilityCalls += 1;
            return Promise.resolve(7);
        },
        addEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            handlers.push(handler);
            listeners.set(type, handlers);
        },
        removeEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            listeners.set(type, handlers.filter((candidate) => candidate !== handler));
        },
        prompt() {
            this.promptCalls += 1;

            if (this.promptRejection) return Promise.reject(this.promptRejection);

            return Promise.resolve();
        },
        async emit(type) {
            for (const handler of listeners.get(type) ?? []) {
                await handler({ type });
            }
        },
        listenerCount(type) {
            return (listeners.get(type) ?? []).length;
        },
    };
}

const track = { title: "Rain", url: "resources/soundscapes/rain.opus", castUrl: "resources/soundscapes/rain.m4a" };

test("no backend is selected on a browser that cannot cast", () => {
    const controller = new CastController(createElement());

    assert.equal(controller.isSupported(), false);
    assert.equal(controller.backendName(), null);
    assert.equal(controller.start(), false);
    assert.equal(controller.isConnected(), false);
});

// Firefox ships neither API. There is no button to reveal and no picker to open,
// so sourcing the element would fetch a cast twin for a cast that can never
// happen — and `preload="metadata"` does not keep that to a header.
test("a browser that cannot cast never fetches a cast twin", () => {
    const element = createElement();
    const controller = new CastController(element);

    controller.setTrack(track);

    assert.equal(element.src, "", "the element is left unsourced");
    assert.equal(controller.getTrackUrl(), null);
});

test("the Remote Playback backend is preferred when both are present", () => {
    // Chromium exposes the standard API; only WebKit-only builds fall through
    // to the proprietary AirPlay path.
    const element = createElement({
        remote: createRemote(),
        webkitShowPlaybackTargetPicker() {},
    });

    assert.equal(selectCastBackend(element, CAST_BACKENDS).name, "remote-playback");
});

test("the AirPlay backend is selected on WebKit", () => {
    const element = createElement({ webkitShowPlaybackTargetPicker() {} });
    const controller = new CastController(element);

    assert.equal(controller.backendName(), "airplay");
    assert.equal(controller.isSupported(), true);
});

// Nothing on the network is consulted, at any point. Discovery belongs to the
// picker, which both platforms open themselves — so the controller never learns
// whether a device exists and never scans to find out.
test("the controller never asks the network whether a device exists", async () => {
    const remote = createRemote();
    const controller = new CastController(createElement({ remote }));

    controller.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(remote.watchAvailabilityCalls, 0, "no scan was started");
    assert.equal(controller.isAvailable, undefined, "and no availability state is kept");
});

// The listener renders the control, so it needs a state to render before anything
// has happened — otherwise the opening appearance would come from the markup and
// the two could drift.
test("start reports the opening state", async () => {
    const remote = createRemote();
    const changes = [];
    const controller = new CastController(createElement({ remote }), {
        onChange: (state) => changes.push(state),
    });

    controller.start();

    assert.deepEqual(changes, [{ connected: false, connecting: false }]);
});

// A cast session outlives the page on the device side, so a reload can land with
// one already running. start() has to notice rather than report idle.
test("start reports a cast that was already live", async () => {
    const remote = createRemote();
    const changes = [];

    remote.state = "connected";

    const controller = new CastController(createElement({ remote }), {
        onChange: (state) => changes.push(state),
    });

    controller.start();

    assert.deepEqual(changes.at(-1), { connected: true, connecting: false });
});

test("connect and disconnect events are reported as connection changes", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const changes = [];
    const controller = new CastController(element, {
        onChange: (state) => changes.push(state),
    });

    controller.start();

    remote.state = "connected";
    await remote.emit("connect");
    assert.equal(controller.isConnected(), true);
    assert.equal(changes.at(-1).connected, true);

    remote.state = "disconnected";
    await remote.emit("disconnect");
    assert.equal(controller.isConnected(), false);
    assert.equal(changes.at(-1).connected, false);
});

// Apple documents the availability listener as a battery cost and asks that it
// not be registered without a specific need. There is none: the AirPlay picker
// finds targets itself.
test("the AirPlay backend never registers WebKit's availability listener", async () => {
    const element = createElement({
        webkitCurrentPlaybackTargetIsWireless: false,
        webkitShowPlaybackTargetPicker() {
            this.pickerCalls = (this.pickerCalls ?? 0) + 1;
        },
    });
    const controller = new CastController(element);

    controller.start();

    assert.equal(element.listenerCount("webkitplaybacktargetavailabilitychanged"), 0);

    element.webkitCurrentPlaybackTargetIsWireless = true;
    await element.emit("webkitcurrentplaybacktargetiswirelesschanged");
    assert.equal(controller.isConnected(), true);

    await controller.prompt();
    assert.equal(element.pickerCalls, 1);
});

// All four are ordinary outcomes per the Remote Playback spec — the user
// dismissed the picker, the device vanished while it was open, or a second
// prompt raced the first (which a double-click on the button produces).
test("routine picker outcomes are not reported as failures", async () => {
    for (const name of ["NotAllowedError", "NotFoundError", "OperationError", "AbortError"]) {
        const warnings = [];
        const remote = createRemote();

        console.warn = (...args) => warnings.push(args);
        remote.promptRejection = Object.assign(new Error("dismissed"), { name });

        const controller = new CastController(createElement({ remote }));

        assert.equal(await controller.prompt(), false);
        assert.deepEqual(warnings, [], `${name} should not be logged`);
    }
});

test("connecting is reported between the picker and a live connection", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const changes = [];
    const controller = new CastController(element, {
        onChange: (state) => changes.push(state),
    });

    controller.start();

    remote.state = "connecting";
    await remote.emit("connecting");
    assert.equal(controller.isConnecting(), true);
    assert.equal(controller.isConnected(), false);
    assert.equal(changes.at(-1).connected, false);

    remote.state = "connected";
    await remote.emit("connect");
    assert.equal(controller.isConnecting(), false);
    assert.equal(controller.isConnected(), true);
});

// AirPlay exposes only the settled state, so the shared interface has to answer
// for it rather than leaving the caller to special-case the backend.
test("AirPlay reports no connecting state", () => {
    const controller = new CastController(createElement({ webkitShowPlaybackTargetPicker() {} }));

    assert.equal(controller.isConnecting(), false);
});

// Neither casting spec promises the loop attribute reaches the receiver, so a
// receiver that ends the track instead of looping must not leave silence.
test("a receiver that ends the track instead of looping is restarted", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();
    assert.equal(element.playCalls, 1);

    element.paused = true;
    element.currentTime = 12;
    await element.emit("ended");

    assert.equal(element.playCalls, 2, "playback should resume");
    assert.equal(element.currentTime, 0, "and restart from the beginning");

    controller.pause();
    controller.stopWatching();
});

test("an ended event is ignored when the cast is paused or gone", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();
    await controller.pause();

    await element.emit("ended");
    assert.equal(element.playCalls, 1, "a paused cast should stay paused");

    await controller.play();
    remote.state = "disconnected";
    await element.emit("ended");
    assert.equal(element.playCalls, 2, "a dropped connection should not be replayed");

    controller.pause();
    controller.stopWatching();
});

// Chrome Android reports no end of media at all: FlingingRenderer drops every
// status that is not playing or paused, so `ended` never fires and `loop` is
// never applied. Position is the one signal every platform keeps.
test("a receiver that stops without saying so is restarted", async () => {
    const remote = createRemote();
    const element = createElement({ remote, currentTime: 0 });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();

    element.currentTime = 4;
    controller.watchdog.check();
    element.currentTime = 8;
    controller.watchdog.check();
    assert.equal(element.playCalls, 1, "a cast that is advancing is left alone");

    // Position frozen from here on: the receiver has stopped.
    controller.watchdog.check();
    assert.equal(element.playCalls, 1, "one still sample is a stutter, not a stop");

    controller.watchdog.check();
    assert.equal(element.playCalls, 2, "playback should resume");
    assert.equal(element.currentTime, 0, "and restart from the beginning");

    controller.pause();
    controller.stopWatching();
});

// A receiver can take seconds to fetch and buffer before its first frame.
// Restarting into that would fight the connection it is still making.
test("a cast that has not started yet is never mistaken for a stalled one", async () => {
    const remote = createRemote();
    const element = createElement({ remote, currentTime: 0 });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();

    for (let sample = 0; sample < 5; sample++) {
        controller.watchdog.check();
    }

    assert.equal(element.playCalls, 1, "buffering is not a stall");

    controller.pause();
    controller.stopWatching();
});

// A restart is a request, not a guarantee: a receiver can take one and stay
// silent. Treating "has never advanced" as a permanent reprieve would disarm
// the watchdog for the rest of the session on the first restart it issues,
// leaving the app showing playing into a quiet room.
test("a restart that does not take is tried again", async () => {
    const remote = createRemote();
    const element = createElement({ remote, currentTime: 0 });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();

    element.currentTime = 4;
    controller.watchdog.check();

    // Frozen from here on, and the element ignores the seek back to zero the
    // way a receiver that has dropped the media does.
    Object.defineProperty(element, "currentTime", { get: () => 4, set: () => {} });

    controller.watchdog.check();
    controller.watchdog.check();
    assert.equal(element.playCalls, 2, "the first stall should be restarted");

    for (let sample = 0; sample < 8; sample++) {
        controller.watchdog.check();
    }

    assert.equal(element.playCalls, 3, "and a restart that changed nothing tried again");

    controller.pause();
    controller.stopWatching();
});

// A play() that rejects means nothing ever started, so there is no position to
// poll — and an armed timer would outlive the failure for the whole session.
test("a cast that refuses to start leaves no watchdog behind", async () => {
    const remote = createRemote();
    const element = createElement({
        remote,
        currentTime: 0,
        play: () => Promise.reject(new Error("NotSupportedError")),
    });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";

    await assert.rejects(controller.play());
    assert.equal(controller.watchdog.isArmed(), false, "nothing left polling a dead transport");

    controller.stopWatching();
});

test("a cast paused from the receiver is left paused", async () => {
    const remote = createRemote();
    const element = createElement({ remote, currentTime: 0 });
    const controller = new CastController(element);

    controller.start();
    remote.state = "connected";
    await controller.play();

    element.currentTime = 4;
    controller.watchdog.check();

    // Paused on the device: the position stops moving, and that is correct.
    element.paused = true;
    controller.watchdog.check();
    controller.watchdog.check();
    controller.watchdog.check();

    assert.equal(element.playCalls, 1);

    controller.pause();
    controller.stopWatching();
});

test("the progress watchdog runs only while a cast wants audio", async () => {
    const remote = createRemote();
    const controller = new CastController(createElement({ remote }));

    controller.start();
    remote.state = "connected";

    assert.equal(controller.watchdog.isArmed(), false, "nothing to watch before playback");

    await controller.play();
    assert.equal(controller.watchdog.isArmed(), true, "armed while playing");

    controller.pause();
    assert.equal(controller.watchdog.isArmed(), false, "disarmed on pause");

    controller.stopWatching();
});

test("an unexpected picker failure is logged rather than thrown at the caller", async () => {
    const warnings = [];
    const remote = createRemote();

    console.warn = (...args) => warnings.push(args);
    remote.promptRejection = new Error("Route provider crashed");

    const controller = new CastController(createElement({ remote }));

    assert.equal(await controller.prompt(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /cast device picker/);
});

// Cast plays the AAC twin, never the Opus original: one shared format keeps a
// single code path for every backend, and it is the only one all of them decode.
test("setTrack hands the element the track's AAC twin", () => {
    const element = createElement({ remote: createRemote() });
    const controller = new CastController(element);

    controller.setTrack(track);
    assert.equal(element.src, "", "held back until a gesture releases it");

    controller.allowTransportLoad();

    assert.equal(element.src, track.castUrl);
    assert.equal(controller.getTrackUrl(), track.castUrl);
});

// Assigning src reloads the element, so a redundant write during a track change
// that lands on the same file would interrupt a cast that is already playing.
test("setTrack does not touch the element when the track is unchanged", () => {
    const element = createElement({ remote: createRemote() });
    const controller = new CastController(element);

    controller.allowTransportLoad();
    controller.setTrack(track);
    element.src = "untouched";
    controller.setTrack(track);

    assert.equal(element.src, "untouched");
});

// The gesture arrives once and its only job is to release the load. A second one
// must not re-assign src, because by then a cast may be playing from it.
test("a later gesture cannot re-source a live cast", () => {
    const element = createElement({ remote: createRemote() });
    const controller = new CastController(element);

    controller.setTrack(track);
    assert.equal(controller.allowTransportLoad(), true);

    element.src = "untouched";

    assert.equal(controller.allowTransportLoad(), false, "already released");
    assert.equal(element.src, "untouched");
});

test("play only starts a connected cast, and loops", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    // Looping is the element's standing configuration, not something play()
    // reapplies. Where the browser honours it, it implements it as a seek;
    // where it does not, the progress watchdog carries the loop instead.
    assert.equal(element.loop, true);

    assert.equal(await controller.play(), false);
    assert.equal(element.playCalls, 0);

    remote.state = "connected";
    assert.equal(await controller.play(), true);
    assert.equal(element.playCalls, 1);
    assert.equal(controller.isPlaying(), true);

    controller.pause();
});

// The intent has to outlive the connection: a disconnect is exactly when the
// app asks "was this playing?" to decide whether local playback resumes.
test("playback intent survives the connection dropping", async () => {
    const remote = createRemote();
    const controller = new CastController(createElement({ remote }));

    remote.state = "connected";
    await controller.play();
    assert.equal(controller.isPlaybackRequested(), true);

    remote.state = "disconnected";
    assert.equal(controller.isPlaybackRequested(), true);

    controller.pause();
    assert.equal(controller.isPlaybackRequested(), false);
});

test("pause clears intent and stops the element", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    remote.state = "connected";
    await controller.play();
    controller.pause();

    assert.equal(controller.isPlaybackRequested(), false);
    assert.equal(element.pauseCalls, 1);
    assert.equal(controller.isPlaying(), false);
});

// A double-click on the cast button is enough to fire two prompts, which is an
// error on both platforms. Refusing the second is better than absorbing it.
test("a second prompt is refused while the picker is already open", async () => {
    let openPicker;
    const stillOpen = new Promise((resolve) => {
        openPicker = resolve;
    });
    const remote = createRemote();

    remote.prompt = () => {
        remote.promptCalls += 1;
        return remote.promptCalls === 1 ? stillOpen : Promise.resolve();
    };

    const controller = new CastController(createElement({ remote }));
    const first = controller.prompt();

    assert.equal(await controller.prompt(), false);
    assert.equal(remote.promptCalls, 1);

    openPicker();
    assert.equal(await first, true);

    // And the guard releases once the picker closes.
    assert.equal(await controller.prompt(), true);
    assert.equal(remote.promptCalls, 2);
});

// Element volume is not a local setting while connected — Chromium forwards it
// to the receiver as a stream volume change, which on a Cast device is the
// device's own volume and outlives the session. The controller leaves it alone.
test("the controller never changes the element's volume", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    assert.equal(typeof controller.setVolume, "undefined", "there is no volume API to call");

    controller.start();
    controller.setTrack(track);
    remote.state = "connected";
    await controller.play();
    controller.pause();
    controller.stopWatching();

    assert.equal(element.volume, 1, "the device keeps its own level");
});

// A cast that fails the instant it opens arrives as a disconnect while the
// handover is still awaiting the local pause. The handback decides from this
// flag alone, so it has to be settable before any connection exists.
test("playback intent can be handed over before the transport moves", () => {
    const remote = createRemote();
    const controller = new CastController(createElement({ remote }));

    controller.setPlaybackRequested(true);
    assert.equal(controller.isPlaybackRequested(), true, "even while disconnected");

    controller.setPlaybackRequested(false);
    assert.equal(controller.isPlaybackRequested(), false);
    assert.equal(controller.watchdog.isArmed(), false, "and dropping the intent stops the watchdog");
});

test("stopWatching releases every subscription", async () => {
    const remote = createRemote();
    const element = createElement({ remote });
    const controller = new CastController(element);

    controller.start();

    assert.equal(remote.listenerCount("connect"), 1);
    assert.equal(element.listenerCount("ended"), 1);

    controller.stopWatching();

    assert.equal(remote.listenerCount("connect"), 0);
    assert.equal(remote.listenerCount("connecting"), 0);
    assert.equal(remote.listenerCount("disconnect"), 0);
    assert.equal(element.listenerCount("ended"), 0);
});

test("a throwing change listener cannot break cast state tracking", async () => {
    const warnings = [];
    const remote = createRemote();

    console.warn = (...args) => warnings.push(args);

    const controller = new CastController(createElement({ remote }), {
        onChange() {
            throw new Error("UI blew up");
        },
    });

    // start() reports the opening state, so the listener throws immediately.
    controller.start();

    remote.state = "connected";
    await remote.emit("connect");

    assert.equal(controller.isConnected(), true, "state tracking survives the listener");
    assert.equal(warnings.length, 2);
});
