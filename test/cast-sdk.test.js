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
        pendingTimers: [],
        // What the receiver is holding, which outlives the page: this is what a
        // rejoined session finds already loaded.
        receiverMedia: null,
        loadShouldFail: false,
    };

    const emit = (map, type) => {
        for (const handler of map.get(type) ?? []) handler({ type });
    };

    const session = {
        loadMedia(request) {
            state.loads.push(request);
            state.receiverMedia = request.media;

            return state.loadShouldFail ? Promise.reject(new Error("load failed")) : Promise.resolve();
        },
        getMediaSession: () => (state.receiverMedia ? { media: state.receiverMedia } : null),
    };

    const player = { isPaused: true, isConnected: false, playerState: "PLAYING" };
    const store = new Map();

    const scope = {
        isSecureContext: true,
        PresentationRequest: function PresentationRequest() {},
        location: { href: "https://soundscape.test/index.html" },
        setTimeout: (fn) => {
            state.pendingTimers.push(fn);
            return state.pendingTimers.length;
        },
        clearTimeout: (id) => {
            if (id) state.pendingTimers[id - 1] = null;
        },
        localStorage: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, value),
            removeItem: (key) => store.delete(key),
        },
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
                    PLAYER_STATE_CHANGED: "playerstatechanged",
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
                    PlayerState: {
                        IDLE: "IDLE",
                        PLAYING: "PLAYING",
                        PAUSED: "PAUSED",
                        BUFFERING: "BUFFERING",
                    },
                    RepeatMode: { OFF: "REPEAT_OFF", SINGLE: "REPEAT_SINGLE" },
                    QueueData: function QueueData() {
                        this.items = null;
                        this.repeatMode = null;
                    },
                    QueueItem: function QueueItem(media) {
                        this.media = media;
                    },
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

            // Ending a session stops the receiver and it forgets the media. A
            // rejoin is the other case entirely — the page goes away, the
            // session does not — which is why the rejoin tests below never pass
            // through this state.
            if (next === "NOT_CONNECTED") state.receiverMedia = null;

            emit(state.listeners, "caststatechanged");
        },
        emitPlayerPaused() {
            emit(state.playerListeners, "ispausedchanged");
        },
        setPlayerState(next) {
            player.playerState = next;
            emit(state.playerListeners, "playerstatechanged");
        },
        runTimers() {
            const due = state.pendingTimers.splice(0);

            for (const fn of due) fn?.();
        },
        store,
    };
}

function createController({ sdk = createFakeSdk(), ...overrides } = {}) {
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

// start() reaches the rejoin through a chain of promises, none of which the
// caller is handed.
async function settle() {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
}

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

// The twins are two minutes long and ambience runs for hours, so a plain load
// ends in silence. The receiver has to do the repeating: a sender-driven reload
// would tie playback to the page staying awake, which on a phone it will not.
test("the receiver is told to repeat the soundscape indefinitely", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    const [request] = sdk.state.loads;

    assert.equal(request.queueData.repeatMode, "REPEAT_SINGLE");
    assert.equal(request.queueData.items.length, 1);
    assert.equal(request.queueData.items[0].media, request.media);
});

// Queue support belongs to the receiver build. An older one should lose the
// looping, not the playback.
test("a receiver without queue support still gets the track", async () => {
    const sdk = createFakeSdk();

    delete sdk.scope.chrome.cast.media.QueueData;

    const { controller } = createController({ sdk });

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");

    assert.equal(await controller.play(), true);
    assert.equal(sdk.state.loads[0].queueData, undefined);
});

// Belt to the queue's braces: if the receiver ends the media anyway, there is
// no `ended` event on this path, only the state going IDLE.
test("a receiver that falls idle mid-soundscape is restarted", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.setPlayerState("IDLE");
    sdk.runTimers();
    await Promise.resolve();

    assert.equal(sdk.state.loads.length, 2);
});

test("a receiver idling after a deliberate pause is left alone", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();
    sdk.player.isPaused = false;
    controller.pause();

    sdk.setPlayerState("IDLE");
    sdk.runTimers();
    await Promise.resolve();

    assert.equal(sdk.state.loads.length, 1);
});

// Nothing loads the SDK until the button is pressed, so without a hint left
// behind the SDK's own ORIGIN_SCOPED rejoin can never run — and reopening the
// app shows "idle" beside a speaker that is still playing.
test("a session running at the last close is rejoined on the next open", async () => {
    const sdk = createFakeSdk();

    await createController({ sdk }).controller.prompt();
    sdk.setCastState("CONNECTED");

    assert.equal(sdk.store.get("soundscape.casting"), "1");

    // A fresh page against the same storage: the SDK comes up unprompted.
    const reopened = createController({ sdk });

    reopened.controller.start();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(reopened.sdkLoads(), 1);
});

// The other half of making the rejoin work, and the one that bites: `loadedUrl`
// is null on a fresh page, so a rejoined session looks like it holds nothing and
// play() reloads it — dropping a speaker minutes into a soundscape back to the
// start, every single time the app is reopened.
test("reopening the app onto a live session does not restart the soundscape", async () => {
    const sdk = createFakeSdk();
    const first = createController({ sdk });

    await first.controller.prompt();
    first.controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await first.controller.play();
    sdk.player.isPaused = false;

    assert.equal(sdk.state.loads.length, 1);

    // A new page against the same still-running session. Nothing has been
    // pressed here, so the local intent is quite correctly false.
    const reopened = createController({ sdk });

    reopened.controller.setTrack(TRACK);
    reopened.controller.start();
    await settle();

    assert.equal(reopened.controller.getTrackUrl(), "resources/rain.m4a");
    assert.equal(reopened.controller.isPlaying(), true);

    await reopened.controller.play();

    assert.equal(sdk.state.loads.length, 1, "a running soundscape must not be reloaded");
});

// The receiver playing is a request for playback whoever made it, and the app
// that rejoins it never pressed anything. Left false, the idle safety net would
// sit disarmed for exactly the session it exists to watch.
test("a rejoined session that is playing counts as playback being wanted", async () => {
    const sdk = createFakeSdk();
    const { controller } = createController({ sdk });

    // What the previous page left behind when it was closed mid-cast.
    sdk.store.set("soundscape.casting", "1");
    controller.setTrack(TRACK);
    controller.start();
    await settle();
    sdk.setCastState("CONNECTED");

    assert.equal(controller.isPlaybackRequested(), false);

    sdk.player.isPaused = false;
    sdk.emitPlayerPaused();

    assert.equal(controller.isPlaybackRequested(), true);
});

// A receiver that cannot play the file answers every restart with another IDLE.
// Unbounded, that is a reload loop pointed at someone's speaker.
test("a receiver that will not play is not restarted forever", async () => {
    console.warn = () => {};

    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    // Buffering between attempts, which is a receiver trying rather than one
    // succeeding: it must not refill the allowance.
    for (let attempt = 0; attempt < 6; attempt += 1) {
        sdk.setPlayerState("BUFFERING");
        sdk.setPlayerState("IDLE");
        sdk.runTimers();
        await settle();
    }

    // The initial load, plus the capped run of restarts.
    assert.equal(sdk.state.loads.length, 1 + 3);
});

// The same IDLE arrives while a load is being accepted, and a restart into that
// would fight the load already running.
test("a receiver that gets going again is left alone and forgiven", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    // Idle in passing: by the time the timer fires the receiver has started.
    sdk.setPlayerState("IDLE");
    sdk.setPlayerState("PLAYING");
    sdk.runTimers();
    await settle();

    assert.equal(sdk.state.loads.length, 1, "a transient idle is not a stall");

    // And the earlier run of restarts is forgotten, so a real stall much later
    // still gets its full allowance.
    sdk.setPlayerState("IDLE");
    sdk.runTimers();
    await settle();

    assert.equal(sdk.state.loads.length, 2);
});

test("someone who was not casting contacts Google on neither visit", async () => {
    const sdk = createFakeSdk();
    const { controller, sdkLoads } = createController({ sdk });

    controller.start();
    await Promise.resolve();

    assert.equal(sdkLoads(), 0);
    assert.equal(sdk.store.has("soundscape.casting"), false);
});

test("ending a session clears the rejoin hint", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    sdk.setCastState("CONNECTED");
    sdk.setCastState("NOT_CONNECTED");

    assert.equal(sdk.store.has("soundscape.casting"), false);
});

// Samsung Internet is Chromium enough to pass the capability check — it has the
// Presentation API — and then reports no cast framework. Remembering that is
// what lets the app say so instead of doing nothing.
test("a browser with no cast framework is reported as unreachable", async () => {
    console.warn = () => {};

    const { controller } = createController({
        loader: () => Promise.reject(new Error("Cast SDK reported unavailable")),
    });

    assert.equal(controller.isTransportReady(), true, "nothing is known before a press");
    assert.equal(await controller.prompt(), false);
    assert.equal(controller.isTransportReady(), false);
});
