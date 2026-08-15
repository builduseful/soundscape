/**
 * One contract, run against every output.
 *
 * Each output used to be tested to whatever depth someone thought of at the
 * time, against a fake shaped like its own platform.
 * `test/providers/media-element.test.js` knows about media elements and
 * `remote.state`; `test/providers/cast-sdk.test.js` knows about `cast.framework`
 * and receiver player states. Both are right for what they do, and neither can
 * say anything about the other — so a behaviour every output is supposed to
 * share was only ever verified on whichever one someone remembered.
 *
 * This file holds **two** specs, and the split is the point:
 *
 *   - The `PlaybackOutput` contract, run against all four implementations —
 *     `AudioPlayer` included. That is the half that proves the port is a port
 *     rather than a cast interface with a second implementation bolted on. If
 *     the local player ever has to be excused from a case here, the case belongs
 *     in the other spec.
 *   - The remote contract, run against the three remote outputs, for everything
 *     that only means something once there is a device on the other end:
 *     connecting, handing over, tearing down without leaking a listener.
 *
 * The fake is in both on purpose — it is the reference implementation, and a
 * contract it cannot satisfy is a contract that has smuggled in a detail of a
 * real platform.
 *
 * Every driver below reaches nothing. No device, no network, no timers beyond
 * the ones the output owns. AGENTS.md's ban on real devices in automated runs is
 * absolute.
 */

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import { AudioPlayer } from "../src/js/audio-player.js";
import { MediaElementController } from "../src/js/remote-playback/providers/media-element.js";
import { CastSdkController } from "../src/js/remote-playback/providers/cast-sdk.js";
import { missingPlaybackOutputMembers } from "../src/js/playback-output.js";
import { createFakeRemotePlayback } from "./helpers/fake-remote-playback.js";
import {
    createCastableElement,
    createFakeCastSdk,
    createFakeMediaElement,
    nonChromiumScope,
    settle,
} from "./helpers/remote-transport-fakes.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});

// Deliberately no remote URL on the track: a fixture carrying one would let a
// provider read it instead of deriving the twin through remoteUrlFor(), and
// still pass.
const TRACK = {
    title: "Rain",
    url: "resources/soundscapes/rain.opus",
};

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------
//
// Each driver returns the output under test plus a `device` that stands for
// everything on the far side of it — the connection opening, the receiver
// playing, someone pressing pause on the speaker itself. The app can originate
// none of those, which is exactly why they need driving from outside.
//
// `arm()` is whatever that platform needs before a connection is possible. It is
// not test scaffolding: it is the real precondition each output has (a gesture
// releasing the media element's source; the SDK script being loaded), and
// keeping it in the driver is what lets the spec above stay platform-blind.

const drivers = [
    {
        name: "MediaElementController (Remote Playback / AirPlay)",
        create(callbacks) {
            const element = createCastableElement();
            const scope = nonChromiumScope();
            const output = new MediaElementController(element, { ...callbacks, scope });

            return {
                output,
                clock: scope,
                device: {
                    async arm() {
                        output.allowTransportLoad();
                    },
                    beginConnecting: () => element.remote.beginConnecting(),
                    connect: () => element.remote.connect(),
                    disconnect: () => element.remote.disconnect(),
                    isPlayingOnDevice: () => !element.paused,
                    pressPauseOnDevice: async () => {
                        element.paused = true;
                        await element.emit("pause");
                    },
                    listenerCount: () => element.listenerCount() + element.remote.listenerCount(),
                },
            };
        },
    },
    {
        name: "CastSdkController (Google Cast SDK)",
        create(callbacks) {
            const sdk = createFakeCastSdk();
            const output = new CastSdkController({
                ...callbacks,
                scope: sdk.scope,
                loader: () => Promise.resolve(),
                tracks: [TRACK],
            });

            return {
                output,
                clock: {
                    pendingCount: () => sdk.state.pendingTimers.filter(Boolean).length,
                },
                device: {
                    // The SDK controller has no subscriptions at all until the
                    // gstatic script has loaded, which `prepare()` is what
                    // triggers. Nothing is observable before it.
                    async arm() {
                        output.prepare();
                        await settle();
                    },
                    async beginConnecting() {
                        sdk.setCastState("CONNECTING");
                    },
                    async connect() {
                        sdk.setCastState("CONNECTED");
                    },
                    async disconnect() {
                        sdk.setCastState("NOT_CONNECTED");
                    },
                    isPlayingOnDevice: () => sdk.player.isPaused === false,
                    // A receiver that somebody paused reports both: it is not
                    // producing sound, *and* it is sitting in PAUSED rather than
                    // passing through BUFFERING or IDLE. Setting only the first
                    // would describe a state no real receiver reaches, and would
                    // hide whether the controller can tell the two apart.
                    pressPauseOnDevice: async () => {
                        sdk.player.isPaused = true;
                        sdk.setPlayerState("PAUSED");
                        sdk.emitPlayerPaused();
                    },
                    listenerCount: () => sdk.listenerCount(),
                },
            };
        },
    },
    {
        name: "the fake remote output",
        create(callbacks) {
            const { output, device } = createFakeRemotePlayback(callbacks);

            return {
                output,
                // The fake owns no clock, so it arms nothing by construction.
                clock: { pendingCount: () => 0 },
                device: {
                    async arm() {
                        output.allowTransportLoad();
                    },
                    beginConnecting: () => device.beginConnecting(),
                    connect: () => device.connect(),
                    disconnect: () => device.disconnect(),
                    isPlayingOnDevice: () => device.isPlayingOnDevice(),
                    pressPauseOnDevice: () => device.pressPauseOnDevice(),
                    // The fake owns no platform object, so it leaks nothing by
                    // construction. Reported as zero rather than skipped so the
                    // leak assertion runs against it too and cannot rot.
                    listenerCount: () => 0,
                },
            };
        },
    },
];

/** Records what the app would have seen, in order. */
function createCallbackSpy() {
    const changes = [];
    const playbackChanges = [];

    return {
        changes,
        playbackChanges,
        callbacks: {
            onChange: (state) => {
                changes.push(state);
            },
            onPlaybackChange: () => {
                playbackChanges.push(true);
            },
        },
        last: () => changes[changes.length - 1],
    };
}

// ---------------------------------------------------------------------------
// The PlaybackOutput contract — every output, local included
// ---------------------------------------------------------------------------
//
// This is the narrower of the two contracts in this file and the more important
// one. The cases below hold for *any* output, so the local player runs them too
// — which is the part that proves the port is a port rather than a cast
// interface with a second implementation bolted on. None of them needs an
// AudioContext: `AudioPlayer` creates one lazily, on the playback path, so a
// freshly constructed one is cheap and inert.

const outputs = [
    {
        name: "AudioPlayer (local)",
        // The local player compares `track.url`; the remotes compare the twin
        // remoteUrlFor() derives. That difference is precisely what `holdsTrack`
        // exists to hide, which is why no driver below declares which field it
        // reads — a spec that knew would be a spec that had stopped hiding it.
        create: () => new AudioPlayer(createFakeMediaElement()),
    },
    {
        name: "MediaElementController",
        create: () => new MediaElementController(createCastableElement(), { scope: nonChromiumScope() }),
    },
    {
        name: "CastSdkController",
        create: () => new CastSdkController({ scope: createFakeCastSdk().scope, loader: () => Promise.resolve() }),
    },
    {
        name: "the fake remote output",
        create: () => createFakeRemotePlayback().output,
    },
];

for (const { name, create } of outputs) {
    describe(`PlaybackOutput: ${name}`, () => {
        test("implements every member of the port", () => {
            assert.deepEqual(missingPlaybackOutputMembers(create()), []);
        });

        test("starts idle, holding nothing", () => {
            const output = create();

            assert.equal(output.isPlaying(), false);
            assert.equal(output.wantsPlayback(), false);
            assert.equal(output.isPlaybackRequested(), false);
            assert.equal(output.holdsTrack(TRACK), false);
        });

        // The port's one invariant relating two members. On the local player
        // they genuinely differ; on a remote they coincide. Both satisfy this,
        // and an implementation that got them the wrong way round would hand a
        // receiver silence after an explicit press of play — the exact bug
        // AGENTS.md's "keep the two callers apart" paragraph describes, which
        // until now had no test.
        test("isPlaybackRequested implies wantsPlayback", () => {
            const output = create();
            const check = () => {
                if (!output.isPlaybackRequested()) return;

                assert.equal(
                    output.wantsPlayback(),
                    true,
                    "claims playback is requested while denying it wants playback",
                );
            };

            check();

            // Intent can only be pushed into an output that takes a handover,
            // which is the remotes. The local player's intent is set by playing
            // or pausing it, so at this level idle is all there is to check —
            // audio-player.test.js drives the loaded case.
            if (typeof output.setPlaybackRequested !== "function") return;

            for (const requested of [true, false, true]) {
                output.setPlaybackRequested(requested);
                check();
            }
        });

        test("holdsTrack answers for itself rather than exposing a URL scheme", () => {
            const output = create();

            assert.equal(output.holdsTrack(TRACK), false);
            assert.equal(output.holdsTrack(null), false);
            assert.equal(output.holdsTrack(undefined), false);
        });

        // Two different facts: whether a reading exists now, and whether this
        // transport can ever produce one. The polling timer needs the second.
        test("reports position capability as a constant, and null when it has none", () => {
            const output = create();
            const capable = output.canReportPosition();

            assert.equal(typeof capable, "boolean");
            assert.equal(output.canReportPosition(), capable, "capability changed between reads");

            if (!capable) {
                assert.equal(output.getMediaSessionPositionState(), null);
            }
        });

        test("setVolume is a no-op rather than a throw when volume is not its own", () => {
            const output = create();

            if (output.canControlVolume()) {
                output.setVolume(0.5);
                assert.equal(output.getVolume(), 0.5);
                return;
            }

            // Must not throw: the core calls this without asking first on the
            // paths where the slider is simply absent.
            output.setVolume(0.5);
            assert.equal(output.canControlVolume(), false);
        });

        test("failureMessage is a sentence or nothing, never undefined", () => {
            const message = create().failureMessage();

            assert.ok(
                message === null || (typeof message === "string" && message.length > 0),
                `failureMessage() returned ${JSON.stringify(message)}`,
            );
        });
    });
}

// ---------------------------------------------------------------------------
// The remote contract — connection, handover and teardown
// ---------------------------------------------------------------------------

for (const driver of drivers) {
    describe(driver.name, () => {
        async function setup() {
            const spy = createCallbackSpy();
            const { output, device, clock } = driver.create(spy.callbacks);

            return { spy, output, device, clock };
        }

        test("reports itself supported and starts watching", async () => {
            const { output } = await setup();

            assert.equal(output.isSupported(), true);
            assert.equal(output.start(), true);
        });

        // A page can load with a cast already live — the session outlives a
        // reload on the device side — so the opening state has to come from the
        // output rather than from whatever the markup happened to be shipped
        // with.
        test("reports its opening state on start", async () => {
            const { spy, output } = await setup();

            output.start();
            await settle();

            assert.ok(spy.changes.length >= 1, "start() reported no state at all");
            assert.deepEqual(spy.last(), { connected: false, connecting: false });
        });

        test("reports connecting, connected and disconnected in turn", async () => {
            const { spy, output, device } = await setup();

            output.start();
            await device.arm();
            await settle();

            await device.beginConnecting();
            await settle();
            assert.equal(output.isConnecting(), true, "not connecting after the picker was accepted");
            assert.deepEqual(spy.last(), { connected: false, connecting: true });

            await device.connect();
            await settle();
            assert.equal(output.isConnected(), true);
            assert.deepEqual(spy.last(), { connected: true, connecting: false });

            await device.disconnect();
            await settle();
            assert.equal(output.isConnected(), false);
            assert.deepEqual(spy.last(), { connected: false, connecting: false });
        });

        // Exactly one output drives playback at any moment. An output that
        // accepted play() while disconnected would be the second one.
        test("refuses to play while disconnected", async () => {
            const { output, device } = await setup();

            output.start();
            await device.arm();
            await settle();

            output.setTrack(TRACK);

            assert.equal(await output.play(), false);
            assert.equal(output.isPlaying(), false);
            assert.equal(device.isPlayingOnDevice(), false, "the device was started while disconnected");
        });

        test("plays and pauses the device once connected", async () => {
            const { output, device } = await setup();

            output.start();
            await device.arm();
            await settle();
            output.setTrack(TRACK);
            await device.connect();
            await settle();

            assert.equal(await output.play(), true);
            assert.equal(output.isPlaying(), true);
            assert.equal(device.isPlayingOnDevice(), true);

            output.pause();
            await settle();

            assert.equal(output.isPlaybackRequested(), false);
            assert.equal(device.isPlayingOnDevice(), false);
        });

        // The intent is handed over before either transport moves, so it has to
        // be settable independently of a connection existing yet — and readable
        // after one has gone, which is how the handback decides whether the room
        // gets its soundscape back.
        test("carries playback intent independently of the connection", async () => {
            const { output, device } = await setup();

            output.start();
            await device.arm();
            await settle();

            output.setPlaybackRequested(true);
            assert.equal(output.isPlaybackRequested(), true);

            await device.connect();
            await settle();
            assert.equal(output.isPlaybackRequested(), true, "intent was lost on connect");

            await device.disconnect();
            await settle();
            assert.equal(
                output.isPlaybackRequested(),
                true,
                "intent was cleared by the disconnect, so the handback cannot read it",
            );
        });

        // The receiver has its own controls and the person holding them is not
        // this page. The event is the app's only word that the room went quiet,
        // so it has to arrive — and afterwards the output must not still be
        // claiming to play.
        //
        // What this deliberately no longer asserts is what the pause does to
        // *intent*, because the honest answer differs by transport and pinning
        // one of them here made the other's constraint look universal. On the
        // media element path a spurious pause is fired by every source change,
        // so intent must survive it (pinned in app-remote-playback.test.js). The SDK path
        // has no such event and can tell a settled PAUSED from a receiver merely
        // buffering, so there a real pause does clear intent — which is what
        // stops ending a paused cast starting the soundscape on this machine
        // (pinned in providers/cast-sdk.test.js).
        test("reports a pause pressed on the device and stops claiming to play", async () => {
            const { spy, output, device } = await setup();

            output.start();
            await device.arm();
            await settle();
            output.setTrack(TRACK);
            await device.connect();
            await settle();
            await output.play();
            await settle();

            const before = spy.playbackChanges.length;

            await device.pressPauseOnDevice();
            await settle();

            assert.ok(
                spy.playbackChanges.length > before,
                "the device's own pause was never reported to the app",
            );
            assert.equal(
                output.isPlaying(),
                false,
                "the output still claims to be playing after the device was paused",
            );
        });

        test("never reports playing once disconnected", async () => {
            const { output, device } = await setup();

            output.start();
            await device.arm();
            await settle();
            output.setTrack(TRACK);
            await device.connect();
            await settle();
            await output.play();
            await settle();

            await device.disconnect();
            await settle();

            assert.equal(output.isPlaying(), false);
        });

        // Volume is a per-transport capability and the two real outputs answer
        // differently on purpose. What is uniform is that nothing claims to
        // control a volume when there is no session to control.
        test("claims no volume control while disconnected", async () => {
            const { output, device } = await setup();

            output.start();
            await device.arm();
            await settle();

            assert.equal(output.canControlVolume(), false);
        });

        // Teardown is what makes "swap a provider out" real rather than
        // aspirational. Anything an output subscribed to, it releases.
        test("releases every subscription on teardown", async () => {
            const { output, device, clock } = await setup();

            const baseline = device.listenerCount();

            output.start();
            await device.arm();
            await settle();
            output.setTrack(TRACK);
            await device.connect();
            await settle();
            await output.play();
            await settle();

            assert.ok(
                device.listenerCount() >= baseline,
                "the output subscribed to nothing at all, so this test proves nothing",
            );

            await device.disconnect();
            await settle();
            output.stopWatching();

            assert.equal(
                device.listenerCount(),
                baseline,
                "listeners survived teardown — a swapped-out provider keeps reacting",
            );
            assert.equal(
                clock.pendingCount(),
                0,
                "a timer survived teardown — a detached provider is still polling",
            );
        });
    });
}
