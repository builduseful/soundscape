import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CastSdkController, isCastSdkCapable } from "../src/js/cast-sdk.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});

// Stands in for the SDK the gstatic script installs. Only the members the
// controller actually touches: enough to prove the load request, the session
// request and the media it hands the receiver, without any network.
function createFakeSdk() {
    const state = {
        options: null,
        sessionRequests: 0,
        sessionError: null,
        loads: [],
        castState: "NOT_CONNECTED",
        listeners: new Map(),
        playerListeners: new Map(),
    };

    const emit = (map, type) => {
        for (const handler of map.get(type) ?? []) handler({ type });
    };

    const session = {
        loadMedia(request) {
            state.loads.push(request);
            return Promise.resolve();
        },
    };

    const player = { isPaused: true, isConnected: false };

    const scope = {
        isSecureContext: true,
        PresentationRequest: function PresentationRequest() {},
        location: { href: "https://soundscape.test/index.html" },
        cast: {
            framework: {
                CastState: {
                    NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE",
                    NOT_CONNECTED: "NOT_CONNECTED",
                    CONNECTING: "CONNECTING",
                    CONNECTED: "CONNECTED",
                },
                CastContextEventType: { CAST_STATE_CHANGED: "caststatechanged" },
                RemotePlayerEventType: {
                    IS_PAUSED_CHANGED: "ispausedchanged",
                    IS_CONNECTED_CHANGED: "isconnectedchanged",
                },
                CastContext: {
                    getInstance: () => ({
                        setOptions(options) {
                            state.options = options;
                        },
                        getCastState: () => state.castState,
                        getCurrentSession: () => (state.castState === "CONNECTED" ? session : null),
                        requestSession() {
                            state.sessionRequests += 1;
                            return state.sessionError
                                ? Promise.reject(state.sessionError)
                                : Promise.resolve();
                        },
                        addEventListener(type, handler) {
                            state.listeners.set(type, [...(state.listeners.get(type) ?? []), handler]);
                        },
                        removeEventListener(type, handler) {
                            state.listeners.set(
                                type,
                                (state.listeners.get(type) ?? []).filter((c) => c !== handler),
                            );
                        },
                    }),
                },
                RemotePlayer: function RemotePlayer() {
                    return player;
                },
                RemotePlayerController: function RemotePlayerController() {
                    return {
                        playOrPause() {
                            player.isPaused = !player.isPaused;
                        },
                        addEventListener(type, handler) {
                            state.playerListeners.set(type, [
                                ...(state.playerListeners.get(type) ?? []),
                                handler,
                            ]);
                        },
                        removeEventListener(type, handler) {
                            state.playerListeners.set(
                                type,
                                (state.playerListeners.get(type) ?? []).filter((c) => c !== handler),
                            );
                        },
                    };
                },
            },
        },
        chrome: {
            cast: {
                AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
                media: {
                    DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
                    StreamType: { BUFFERED: "BUFFERED" },
                    MediaInfo: function MediaInfo(contentId, contentType) {
                        this.contentId = contentId;
                        this.contentType = contentType;
                    },
                    MusicTrackMediaMetadata: function MusicTrackMediaMetadata() {
                        this.title = "";
                    },
                    LoadRequest: function LoadRequest(media) {
                        this.media = media;
                    },
                },
            },
        },
    };

    return {
        scope,
        state,
        player,
        setCastState(next) {
            state.castState = next;
            player.isConnected = next === "CONNECTED";
            emit(state.listeners, "caststatechanged");
        },
        emitPlayerPaused() {
            emit(state.playerListeners, "ispausedchanged");
        },
    };
}

function createController(overrides = {}) {
    const sdk = createFakeSdk();
    let loads = 0;
    const controller = new CastSdkController({
        scope: sdk.scope,
        loader: () => {
            loads += 1;
            return Promise.resolve();
        },
        ...overrides,
    });

    return { sdk, controller, sdkLoads: () => loads };
}

const TRACK = { title: "Rain", url: "resources/rain.opus", castUrl: "resources/rain.m4a" };

// Capability has to be answerable before the SDK exists, since loading it is
// exactly what must not happen at boot.
test("cast support is detected without loading the SDK", () => {
    assert.equal(isCastSdkCapable({ PresentationRequest() {}, isSecureContext: true }), true);
    // Safari and Firefox: no Presentation API, so they fall through to cast.js.
    assert.equal(isCastSdkCapable({ isSecureContext: true }), false);
    // The SDK needs a secure context, so an http origin gets no cast button.
    assert.equal(isCastSdkCapable({ PresentationRequest() {}, isSecureContext: false }), false);
});

// The whole justification for adding a Google script to a self-contained app:
// a visitor who never casts never contacts Google.
test("nothing is fetched from Google until the button is pressed", async () => {
    const { controller, sdkLoads } = createController();

    controller.start();
    controller.setTrack(TRACK);

    assert.equal(sdkLoads(), 0, "the SDK must not load at boot");

    await controller.prompt();

    assert.equal(sdkLoads(), 1);
});

test("the picker uses the free Default Media Receiver", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();

    assert.equal(sdk.state.options.receiverApplicationId, "CC1AD845");
    assert.equal(sdk.state.options.autoJoinPolicy, "origin_scoped");
    assert.equal(sdk.state.sessionRequests, 1);
});

// requestSession rejects with a bare string, not an Error, and a dismissed
// picker is an ordinary outcome rather than a fault.
test("a dismissed picker is not reported as a failure", async () => {
    const warnings = [];
    const { sdk, controller } = createController();

    console.warn = (...args) => warnings.push(args);

    for (const code of ["cancel", "timeout"]) {
        sdk.state.sessionError = code;
        assert.equal(await controller.prompt(), false);
    }

    assert.deepEqual(warnings, []);
});

test("an unexpected session failure is logged rather than thrown at the caller", async () => {
    const warnings = [];
    const { sdk, controller } = createController();

    console.warn = (...args) => warnings.push(args);
    sdk.state.sessionError = "receiver_unavailable";

    assert.equal(await controller.prompt(), false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /cast device picker/);
});

test("a second prompt is refused while the picker is already open", async () => {
    const { sdk, controller } = createController();

    const first = controller.prompt();

    assert.equal(await controller.prompt(), false);
    await first;
    assert.equal(sdk.state.sessionRequests, 1);
});

// The receiver fetches the file itself, so a page-relative path would mean
// nothing on the other side of the network.
test("the receiver is handed an absolute URL to the AAC twin", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");

    assert.equal(await controller.play(), true);

    const [request] = sdk.state.loads;

    assert.equal(request.media.contentId, "https://soundscape.test/resources/rain.m4a");
    assert.equal(request.media.contentType, "audio/mp4");
    assert.equal(request.media.metadata.title, "Rain");
    assert.equal(request.autoplay, true);
});

test("connection state changes reach the listener", async () => {
    const reports = [];
    const { sdk, controller } = createController({ onChange: (state) => reports.push(state) });

    await controller.prompt();
    sdk.setCastState("CONNECTING");
    sdk.setCastState("CONNECTED");

    assert.deepEqual(reports.at(-2), { connected: false, connecting: true });
    assert.deepEqual(reports.at(-1), { connected: true, connecting: false });
});

// A pause pressed on the device itself is the app's only word that the room
// went quiet.
test("a pause at the receiver reaches the app", async () => {
    let playbackChanges = 0;
    const { sdk, controller } = createController({ onPlaybackChange: () => (playbackChanges += 1) });

    await controller.prompt();
    sdk.setCastState("CONNECTED");
    sdk.emitPlayerPaused();

    assert.equal(playbackChanges, 1);

    // Nothing to report once the session is gone; the disconnect handles that.
    sdk.setCastState("NOT_CONNECTED");
    sdk.emitPlayerPaused();

    assert.equal(playbackChanges, 1);
});

test("a track change while casting reloads the receiver", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus", castUrl: "resources/fire.m4a" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    controller.setTrack(other);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(sdk.state.loads.length, 2);
    assert.match(sdk.state.loads.at(-1).media.contentId, /fire\.m4a$/);
});

// Nothing is connected, so there is no receiver to tell.
test("a track change with no cast running loads nothing", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);

    assert.equal(sdk.state.loads.length, 0);
});

// A session that ends takes its media with it, so the next connection must load
// again rather than assume the receiver still holds the track.
test("disconnecting forgets what the receiver was holding", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    assert.equal(controller.getTrackUrl(), "resources/rain.m4a");

    sdk.setCastState("NOT_CONNECTED");

    assert.equal(controller.getTrackUrl(), null);

    sdk.setCastState("CONNECTED");
    await controller.play();

    assert.equal(sdk.state.loads.length, 2, "the track is loaded again on reconnect");
});

test("pause stops the receiver only while it is playing", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();
    sdk.player.isPaused = false;

    assert.equal(controller.isPlaying(), true);

    controller.pause();

    assert.equal(sdk.player.isPaused, true);
    assert.equal(controller.isPlaybackRequested(), false);

    // Already paused: toggling again would start it playing.
    controller.pause();

    assert.equal(sdk.player.isPaused, true);
});

// The Remote Playback path preloads a file so Safari's picker has a header to
// read. The SDK has no such precondition, so a press can never be too early.
test("the SDK path has no preload gate", () => {
    const { controller } = createController();

    assert.equal(controller.isTransportReady(), true);
    assert.equal(controller.allowTransportLoad(), false);
});
