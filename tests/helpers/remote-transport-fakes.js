/**
 * The platform fakes the two real remote outputs are driven by.
 *
 * These were built separately inside `providers/airplay.test.js` and `providers/cast-sdk.test.js` and
 * grew to fit whatever each file happened to be testing. They are lifted here
 * unchanged in behaviour so one shared contract suite can construct either
 * controller, which is the whole point of the exercise: a spec that only one
 * implementation can run is not a contract.
 *
 * Nothing here simulates a device. They stand in for the *browser APIs* the
 * controllers talk to — a media element with a Remote Playback object, and the
 * `cast.framework` / `chrome.cast` namespace the gstatic script installs — so a
 * test can drive a connection, a receiver's own pause, or a rejoin without
 * reaching anything on the network. The ban on real devices in automated runs is
 * absolute; see AGENTS.md.
 *
 * Every fake counts its listeners. That is not incidental: teardown is part of
 * the output contract, and "removes every listener it added" is only assertable
 * if the fake remembers.
 */

// ---------------------------------------------------------------------------
// The media element path: W3C Remote Playback API and AirPlay (src/js/remote-playback/providers/airplay.js)
// ---------------------------------------------------------------------------

function createListenerMap() {
    const listeners = new Map();

    return {
        add(type, handler) {
            listeners.set(type, [...(listeners.get(type) ?? []), handler]);
        },
        remove(type, handler) {
            listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== handler));
        },
        async emit(type, event = {}) {
            for (const handler of listeners.get(type) ?? []) {
                await handler({ type, ...event });
            }
        },
        count(type) {
            if (type !== undefined) return (listeners.get(type) ?? []).length;

            let total = 0;

            for (const handlers of listeners.values()) total += handlers.length;

            return total;
        },
    };
}

export function createFakeMediaElement(extras = {}) {
    const listeners = createListenerMap();

    return {
        baseURI: "https://soundscape.test/",
        paused: true,
        src: "",
        // HAVE_ENOUGH_DATA by default, because the picker's metadata wait is not
        // what most tests are about. The ones that are start at 0 and drive the
        // element by hand.
        readyState: 4,
        volume: 1,
        loop: false,
        currentTime: 0,
        playCalls: 0,
        pauseCalls: 0,
        playShouldReject: null,
        addEventListener: (type, handler) => listeners.add(type, handler),
        removeEventListener: (type, handler) => listeners.remove(type, handler),
        emit: (type, event) => listeners.emit(type, event),
        listenerCount: (type) => listeners.count(type),
        async play() {
            this.playCalls += 1;

            if (this.playShouldReject) throw this.playShouldReject;

            this.paused = false;
            await listeners.emit("play");
        },
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
            void listeners.emit("pause");
        },
        ...extras,
    };
}

/** A W3C Remote Playback object, as Chromium and Safari 13.1+ expose it. */
export function createFakeRemotePlaybackApi() {
    const listeners = createListenerMap();

    return {
        state: "disconnected",
        promptCalls: 0,
        promptRejection: null,

        // Counted, never expected to run. The backend feature-detects on this
        // method without calling it — see the comment on
        // `remotePlaybackBackend.isSupported` in providers/airplay.js for why it probes one it
        // does not use — so the fake must carry it to be selected at all, and
        // counting proves no network scan was ever started.
        watchAvailabilityCalls: 0,
        watchAvailability() {
            this.watchAvailabilityCalls += 1;
            return Promise.resolve(7);
        },

        addEventListener: (type, handler) => listeners.add(type, handler),
        removeEventListener: (type, handler) => listeners.remove(type, handler),
        listenerCount: (type) => listeners.count(type),
        prompt() {
            this.promptCalls += 1;

            if (this.promptRejection) return Promise.reject(this.promptRejection);

            return Promise.resolve();
        },

        // Test-facing. The real sequence between the picker and a live session,
        // which on a Chromecast lasts several seconds and is a state the app
        // reports to the user.
        async beginConnecting() {
            this.state = "connecting";
            await listeners.emit("connecting");
        },
        async connect() {
            this.state = "connected";
            await listeners.emit("connect");
        },
        async disconnect() {
            this.state = "disconnected";
            await listeners.emit("disconnect");
        },
    };
}

/**
 * An element on a browser that can cast. Defaults to the Remote Playback API,
 * which is what Chromium and modern Safari select; pass `airplay: true` for the
 * WebKit-only path.
 *
 * Note the `navigator` scope this is meant to be paired with: the Remote
 * Playback backend refuses Chromium outright, so a test that wants that backend
 * selected must pass a scope whose `userAgentData` is absent or non-Chromium.
 * `nonChromiumScope()` below is that scope.
 */
export function createCastableElement({ airplay = false } = {}) {
    if (airplay) {
        return createFakeMediaElement({ webkitShowPlaybackTargetPicker() {} });
    }

    const remote = createFakeRemotePlaybackApi();

    return createFakeMediaElement({ remote });
}

/**
 * A clock the test drives.
 *
 * `AirPlayController`'s loop watchdog is a poll that outlives every call that
 * starts it, so against the real clock a test that plays and does not tear down
 * leaks a live interval — which under `node --test` holds the event loop open
 * and the run never finishes. It is also the only way to test the watchdog's
 * actual behaviour (how many still samples it tolerates, and that a restart
 * returns to the un-advanced posture) without waiting whole seconds per case.
 */
export function createFakeClock() {
    const intervals = new Map();
    const timeouts = new Map();
    let nextId = 1;

    return {
        setInterval(handler, delay) {
            const id = nextId++;

            intervals.set(id, { handler, delay });

            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
        },
        setTimeout(handler, delay) {
            const id = nextId++;

            timeouts.set(id, { handler, delay });

            return id;
        },
        clearTimeout(id) {
            timeouts.delete(id);
        },

        // Test-facing.
        /** Live timers of both kinds — the assertion behind "arms no polling". */
        pendingCount() {
            return intervals.size + timeouts.size;
        },
        /** Run every armed interval once, as one poll tick would. */
        tickIntervals() {
            for (const { handler } of [...intervals.values()]) handler();
        },
        /** Fire and clear every pending timeout, as running out the clock would. */
        runTimeouts() {
            for (const [id, { handler }] of [...timeouts.entries()]) {
                timeouts.delete(id);
                handler();
            }
        },
    };
}

/**
 * Safari/Firefox shape: no `userAgentData` at all, so `isChromium` is false.
 *
 * Carries a driveable clock, because `providers/airplay.js` resolves timers off this same
 * scope. A scope without one falls back to the real clock, which is what every
 * existing test in `providers/airplay.test.js` relies on.
 */
export function nonChromiumScope(extras = {}) {
    return { navigator: {}, ...createFakeClock(), ...extras };
}

// ---------------------------------------------------------------------------
// The Cast SDK path (src/js/remote-playback/providers/cast-sdk.js)
// ---------------------------------------------------------------------------

/**
 * Stands in for the SDK the gstatic script installs. Only the members the
 * controller actually touches: enough to prove the load request, the session
 * request and the media handed to the receiver, without any network.
 */
export function createFakeCastSdk() {
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
        volumeCommits: 0,
        // A receiver that does not answer straight away. By default `loadMedia`
        // settles in the same microtask, so the three callers a track change
        // produces never overlap and the controller's in-flight guard is never
        // exercised — a test written against that passes whatever the guard
        // does. Set this and loads hang until `settleLoads()`.
        holdLoads: false,
    };

    // Loads awaiting settleLoads(), oldest first.
    const heldLoads = [];

    const emit = (map, type) => {
        for (const handler of map.get(type) ?? []) handler({ type });
    };

    const countListeners = (map) => {
        let total = 0;

        for (const handlers of map.values()) total += handlers.length;

        return total;
    };

    // What accepting a load does to the receiver, shared by the immediate and the
    // held path so a delayed load lands in the same state. A load carries
    // `autoplay`, and a receiver that accepts one starts playing and says so —
    // which is what makes `isPlaying()` answerable after `play()`, since the SDK
    // path never calls a play verb for a fresh track.
    const completeLoad = (request) => {
        if (state.loadShouldFail) return Promise.reject(new Error("load failed"));

        if (request.autoplay) {
            player.isPaused = false;
            player.playerState = "PLAYING";
            emit(state.playerListeners, "ispausedchanged");
        }

        return Promise.resolve();
    };

    const session = {
        loadMedia(request) {
            state.loads.push(request);
            state.receiverMedia = request.media;

            if (state.holdLoads) {
                return new Promise((resolve, reject) => {
                    heldLoads.push({ request, resolve, reject });
                });
            }

            return completeLoad(request);
        },
        getMediaSession: () => (state.receiverMedia ? { media: state.receiverMedia } : null),
    };

    const player = { isPaused: true, isConnected: false, playerState: "PLAYING", volumeLevel: 1 };
    const store = new Map();

    const scope = {
        isSecureContext: true,
        PresentationRequest: function PresentationRequest() {},
        navigator: { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } },
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
                    VOLUME_LEVEL_CHANGED: "volumelevelchanged",
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
                        // The real controller reads the level off the player
                        // rather than taking an argument, so the fake counts
                        // commits to prove the two-step was completed.
                        setVolumeLevel() {
                            state.volumeCommits += 1;
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
                Image: function Image(url) {
                    this.url = url;
                },
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
        store,
        listenerCount() {
            return countListeners(state.listeners) + countListeners(state.playerListeners);
        },
        setCastState(next) {
            state.castState = next;
            player.isConnected = next === "CONNECTED";

            // Ending a session stops the receiver and it forgets the media. A
            // rejoin is the other case entirely — the page goes away, the
            // session does not — which is why rejoin tests never pass through
            // this state.
            if (next === "NOT_CONNECTED") state.receiverMedia = null;

            emit(state.listeners, "caststatechanged");
        },
        emitPlayerPaused() {
            emit(state.playerListeners, "ispausedchanged");
        },
        setVolumeLevel(next) {
            player.volumeLevel = next;
            emit(state.playerListeners, "volumelevelchanged");
        },
        setPlayerState(next) {
            player.playerState = next;
            emit(state.playerListeners, "playerstatechanged");
        },

        /** How many loads are open right now — the window the guard lives in. */
        heldLoadCount() {
            return heldLoads.length;
        },

        /**
         * Let every open load answer, honouring `loadShouldFail`. Resolves once
         * the controller has finished reacting, so a test can assert on what
         * follows rather than counting microtasks.
         */
        async settleLoads() {
            const open = heldLoads.splice(0, heldLoads.length);

            for (const { request, resolve, reject } of open) {
                completeLoad(request).then(resolve, reject);
            }

            await settle();
        },
        runTimers() {
            const due = state.pendingTimers.splice(0);

            for (const fn of due) fn?.();
        },
    };
}

/**
 * `start()` and `prompt()` reach their work through chains of promises the
 * caller is never handed, so tests need a way to let those settle.
 */
export async function settle(ticks = 6) {
    for (let tick = 0; tick < ticks; tick += 1) await Promise.resolve();
}
