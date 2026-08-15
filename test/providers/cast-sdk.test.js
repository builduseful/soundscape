import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CastSdkController, isCastSdkCapable } from "../../src/js/remote-playback/providers/cast-sdk.js";
// The platform-API fake, shared with the app-level tests. This file kept a copy
// of its own until the two started to matter separately — see the fakes note in
// the remote playback README for which fake answers which question.
import { createFakeCastSdk } from "../helpers/remote-transport-fakes.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});


function createController({ sdk = createFakeCastSdk(), ...overrides } = {}) {
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

const TRACK = { title: "Rain", url: "resources/rain.opus" };

// start() reaches the rejoin through a chain of promises, none of which the
// caller is handed.
async function settle() {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
}

// Capability has to be answerable before the SDK exists, since loading it is
// exactly what must not happen at boot.
test("cast support is detected without loading the SDK", () => {
    const chromeBrands = { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } };

    assert.equal(
        isCastSdkCapable({ PresentationRequest() {}, isSecureContext: true, navigator: chromeBrands }),
        true,
    );
    // Safari and Firefox: no Presentation API, so they fall through to providers/media-element.js.
    assert.equal(isCastSdkCapable({ isSecureContext: true, navigator: chromeBrands }), false);
    // The SDK needs a secure context, so an http origin gets no cast button.
    assert.equal(
        isCastSdkCapable({ PresentationRequest() {}, isSecureContext: false, navigator: chromeBrands }),
        false,
    );
    // Samsung Internet: Chromium enough for the Presentation API, but Google's
    // cast framework never comes up there, so it must not reach this controller.
    assert.equal(
        isCastSdkCapable({
            PresentationRequest() {},
            isSecureContext: true,
            navigator: { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Samsung Internet" }] } },
        }),
        false,
    );
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

// Fetching a cross-origin script and starting a cast context takes long enough
// that the press reads as a dead button. Approaching the button is as clear a
// statement of intent as exists short of the click, so the wait can be spent
// before the press instead of shown after it.
test("approaching the button loads the SDK before it is pressed", async () => {
    const { controller, sdkLoads } = createController();

    assert.equal(controller.prepare(), true);
    await settle();

    assert.equal(sdkLoads(), 1);

    // Once is enough; the listeners come off after the first one answers true.
    assert.equal(controller.prepare(), false);

    await controller.prompt();

    assert.equal(sdkLoads(), 1, "the press reuses what the approach already loaded");
});

test("preparing does nothing where casting is not supported", () => {
    const { controller, sdkLoads } = createController({
        sdk: { scope: { isSecureContext: false } },
    });

    assert.equal(controller.prepare(), false);
    assert.equal(sdkLoads(), 0);
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

// Title alone reads as "Default Media Receiver" with a bare track name and no
// picture: nothing on screen says where the sound came from. None of this needs
// a registered receiver — the $5 buys a custom receiver, not metadata.
test("the receiver is given enough metadata to name and picture the app", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    const { metadata } = sdk.state.loads[0].media;

    assert.equal(metadata.title, "Rain");
    assert.equal(metadata.artist, "Soundscape");
    assert.equal(metadata.images[0].url, "https://soundscape.test/resources/icons/icon-512.png");
    // Largest first, so a TV backdrop and a phone notification can each pick.
    assert.match(metadata.images[1].url, /icon-192\.png$/);
});

// A session outlives the page that started it, so the receiver can be on a
// soundscape this page never chose — changed from another device, or from the
// speaker. Reopening should show what is actually playing.
test("rejoining adopts the soundscape the receiver is actually on", async () => {
    const other = { title: "Fireplace", url: "resources/fire.opus" };
    const sdk = createFakeCastSdk();
    const adopted = [];

    // A previous page left the receiver on the second soundscape.
    const first = createController({ sdk, tracks: [TRACK, other] });

    await first.controller.prompt();
    first.controller.setTrack(other);
    sdk.setCastState("CONNECTED");
    await first.controller.play();

    // The new page opens on its own saved track, which is the wrong one.
    const reopened = createController({
        sdk,
        tracks: [TRACK, other],
        onTrackAdopted: (track) => adopted.push(track),
    });

    reopened.controller.setTrack(TRACK);
    reopened.controller.start();
    await settle();

    assert.deepEqual(adopted, [other]);
    assert.equal(reopened.controller.getTrackUrl(), "resources/fire.m4a");

    // And it must not then reload — the room is already playing this.
    await reopened.controller.play();

    assert.equal(sdk.state.loads.length, 1);
});

test("a receiver holding something unrecognised is not adopted", async () => {
    const sdk = createFakeCastSdk();
    const adopted = [];

    sdk.state.receiverMedia = { contentId: "https://elsewhere.test/podcast.m4a" };
    sdk.store.set("soundscape.casting", "1");

    const { controller } = createController({
        sdk,
        tracks: [TRACK],
        onTrackAdopted: (track) => adopted.push(track),
    });

    controller.setTrack(TRACK);
    controller.start();
    await settle();
    sdk.setCastState("CONNECTED");

    assert.deepEqual(adopted, []);
    assert.equal(controller.getTrackUrl(), null);
});

// The Remote Playback path has no volume API and switches the slider off. This
// one does, so the slider drives the speaker instead of being explained away.
test("the slider drives the cast device's volume", async () => {
    const volumes = [];
    const { sdk, controller } = createController({ onVolumeChange: (v) => volumes.push(v) });

    await controller.prompt();

    // Nothing connected: a level change must not be routed into a session that
    // does not exist.
    assert.equal(controller.canControlVolume(), false);
    assert.equal(controller.setVolume(0.5), false);

    sdk.setCastState("CONNECTED");

    assert.equal(controller.canControlVolume(), true);
    assert.equal(controller.setVolume(0.4), true);
    assert.equal(sdk.player.volumeLevel, 0.4);
    assert.equal(sdk.state.volumeCommits, 1);

    // Out of range is clamped rather than passed to the device.
    controller.setVolume(3);

    assert.equal(sdk.player.volumeLevel, 1);
});

// The level can be changed at the speaker, in the Home app, or by another
// sender, and the slider has to follow rather than sit where this page left it.
test("a volume change made elsewhere reaches the app", async () => {
    const volumes = [];
    const { sdk, controller } = createController({ onVolumeChange: (v) => volumes.push(v) });

    await controller.prompt();
    sdk.setCastState("CONNECTED");
    sdk.setVolumeLevel(0.25);

    assert.deepEqual(volumes, [0.25]);
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
    const other = { title: "Fireplace", url: "resources/fire.opus" };

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

// One press, one load. A track change reaches the receiver through three
// callers for a single skip — the app keeps the transport current, startTrack
// sets it again, and play() asks a third time because `loadedUrl` is not written
// until the receiver answers. Each one is a full load, and a real receiver
// re-fetches the file for every one of them.
test("a track change loads the receiver exactly once", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    assert.equal(sdk.state.loads.length, 1);

    // Exactly what script.js does for one press of next.
    controller.setTrack(other);
    await controller.startTrack(other, { wasPlaying: true });
    await settle();

    assert.equal(sdk.state.loads.length, 2, "the receiver was told to load more than once");
    assert.match(sdk.state.loads.at(-1).media.contentId, /fire\.m4a$/);
});

// The other half of the same guard. Deduplicating by refusing the later callers
// meant the awaited path — startTrack → play — resolved before the receiver had
// answered, so a receiver that could not play the file failed silently: the app
// would report success, write the new soundscape into the OS media UI, and leave
// the title naming something the room was not playing. The later caller now
// shares the in-flight request instead, so one press is still one load and the
// failure reaches whoever asked for it.
test("a load the receiver rejects is reported to the caller, not swallowed", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    assert.equal(sdk.state.loads.length, 1);

    sdk.state.loadShouldFail = true;

    // Exactly what script.js does for one press of next.
    controller.setTrack(other);
    await assert.rejects(
        () => controller.startTrack(other, { wasPlaying: true }),
        /load failed/,
    );

    assert.equal(sdk.state.loads.length, 2, "the failure must not cost the guard its one load");
    assert.equal(
        controller.holdsTrack(other),
        false,
        "a rejected load must not be recorded as the track the receiver holds",
    );
    assert.equal(
        controller.holdsTrack(TRACK),
        true,
        "the receiver is still on the soundscape it was playing",
    );
});

// A second request for a track already in flight must not reach the receiver
// again — the point of the guard — while still resolving with the first one.
test("a repeated request for the in-flight track shares it rather than reloading", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");

    const first = controller.loadTrack(TRACK);
    const second = controller.loadTrack(TRACK);

    assert.equal(sdk.state.loads.length, 1, "the receiver was asked twice");

    await Promise.all([first, second]);

    assert.equal(controller.holdsTrack(TRACK), true);
});

// Skipping back to the soundscape the receiver is *leaving*. `loadedUrl` still
// names it for the whole round trip, so a guard asked against that answered
// "already loaded" and sent nothing — the receiver finished the load it was
// making and the room played the track the app had just navigated away from,
// with the title on screen naming the other one. Nothing corrected it, because
// from the app's side the skip had gone to plan.
test("skipping back to the current track while a load is open still reaches the receiver", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    // A receiver that takes its time, which is the only kind there is.
    sdk.state.holdLoads = true;

    // Next, then previous before the first one has been answered.
    const next = controller.startTrack(other, { wasPlaying: true });
    await settle();
    const back = controller.startTrack(TRACK, { wasPlaying: true });
    await settle();

    sdk.state.holdLoads = false;
    await sdk.settleLoads();
    await Promise.all([next, back]);
    await settle();

    assert.match(
        sdk.state.receiverMedia.contentId,
        /rain\.m4a$/,
        "the room is playing the soundscape the app navigated away from",
    );
    assert.equal(controller.holdsTrack(TRACK), true);
});

// Two loads open at once is a race with the receiver as referee: it may answer
// them in either order, and the older one landing last wrote its soundscape into
// `loadedUrl` — so the app believed the room was on a track it had left, and the
// next press of play re-loaded it over the top of what was playing.
test("a second skip waits for the first rather than opening a load beside it", async () => {
    const { sdk, controller } = createController();
    const fire = { title: "Fireplace", url: "resources/fire.opus" };
    const road = { title: "Open road", url: "resources/road.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.state.holdLoads = true;

    const first = controller.startTrack(fire, { wasPlaying: true });
    await settle();
    const second = controller.startTrack(road, { wasPlaying: true });
    await settle();

    assert.equal(sdk.heldLoadCount(), 1, "two loads were open on the receiver at once");

    sdk.state.holdLoads = false;
    await sdk.settleLoads();
    await Promise.all([first, second]);
    await settle();

    assert.equal(controller.getTrackUrl(), "resources/road.m4a");
    assert.match(sdk.state.receiverMedia.contentId, /road\.m4a$/);
});

// The queue is a slot, not a backlog: only the newest destination is ever sent,
// so a run of presses costs the room one restart rather than one per press.
test("a destination superseded before it is sent never reaches the receiver", async () => {
    const { sdk, controller } = createController();
    const fire = { title: "Fireplace", url: "resources/fire.opus" };
    const road = { title: "Open road", url: "resources/road.opus" };
    const thunder = { title: "Thunder", url: "resources/thunder.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.state.holdLoads = true;

    const skips = [
        controller.startTrack(fire, { wasPlaying: true }),
        controller.startTrack(road, { wasPlaying: true }),
        controller.startTrack(thunder, { wasPlaying: true }),
    ];

    await settle();
    sdk.state.holdLoads = false;
    await sdk.settleLoads();
    await Promise.all(skips);
    await settle();

    // Rain (the first play), fire (already sent when the rest arrived), and
    // thunder. Road was replaced while still queued and cost nothing.
    assert.deepEqual(
        sdk.state.loads.map(({ media }) => media.contentId.split("/").at(-1)),
        ["rain.m4a", "fire.m4a", "thunder.m4a"],
    );
    assert.equal(controller.holdsTrack(thunder), true);
});

// The failure of a soundscape the app has already navigated away from is not
// the current skip's news. Passing it on would report the abandoned track's
// error against the one the room is about to play — and, worse, abandon the
// load that was queued behind it.
test("a load that fails after being superseded does not take the newer skip down with it", async () => {
    const { sdk, controller } = createController();
    const fire = { title: "Fireplace", url: "resources/fire.opus" };
    const road = { title: "Open road", url: "resources/road.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.state.holdLoads = true;
    sdk.state.loadShouldFail = true;

    const first = controller.startTrack(fire, { wasPlaying: true });
    await settle();

    // The skip that replaces it, queued behind a load that is about to fail.
    const second = controller.startTrack(road, { wasPlaying: true });
    await settle();

    // The fire load answers, with a failure; the road load behind it goes out
    // and is held in its turn.
    await sdk.settleLoads();

    sdk.state.loadShouldFail = false;
    sdk.state.holdLoads = false;
    await sdk.settleLoads();

    // Neither caller is told the abandoned load failed. The superseded one is
    // past caring — the app discards a skip it has already navigated away from
    // by generation — and telling the newer one would report a failure against a
    // soundscape it never asked for.
    await first;
    await second;

    assert.equal(controller.holdsTrack(road), true, "the queued skip was abandoned with the failed one");
    assert.match(sdk.state.receiverMedia.contentId, /road\.m4a$/);
});

// A session can end with a request still open on it, and the SDK answers that
// request whenever it gets round to it — after the disconnect, and after the
// reconnect behind it. The run holding it is a ghost by then, and everything it
// would go on to do is wrong: recording what it loaded (a track the live session
// is not on, and one that stops the next rejoin adopting what the room is
// actually playing), or resending it over the top of what the live run is doing.
test("a run abandoned by a disconnect stops rather than finishing into a new session", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    // A skip the receiver has not answered yet.
    sdk.state.holdLoads = true;
    const abandoned = controller.startTrack(other, { wasPlaying: true });
    await settle();

    // The session ends underneath it, and another one replaces it.
    sdk.setCastState("NOT_CONNECTED");
    await settle();
    sdk.setCastState("CONNECTED");
    await settle();

    const loadsBefore = sdk.state.loads.length;

    // Now the dead session's request finally answers.
    sdk.state.holdLoads = false;
    await sdk.settleLoads();
    await abandoned;
    await settle();

    assert.equal(sdk.state.loads.length, loadsBefore, "the ghost run sent a request of its own");
    assert.equal(
        controller.getTrackUrl(),
        null,
        "the ghost run recorded a load against a session that had gone",
    );
});

// The other half: the live run must be unaffected by the ghost unwinding, and
// the slot it owns must survive it.
test("a new session after a disconnect still loads normally", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.state.holdLoads = true;
    const abandoned = controller.startTrack(other, { wasPlaying: true });
    await settle();

    sdk.setCastState("NOT_CONNECTED");
    await settle();
    sdk.setCastState("CONNECTED");
    await settle();

    sdk.state.holdLoads = false;
    await controller.play();
    await sdk.settleLoads();
    await abandoned;
    await settle();

    assert.equal(controller.holdsTrack(other), true);
    assert.match(sdk.state.receiverMedia.contentId, /fire\.m4a$/);
});

// A load the receiver refuses has to leave the slot empty, or the retry that
// follows reads as a request already under way and never reaches the device.
test("a failed load does not leave a destination nobody is heading for", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    console.warn = () => {};

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.state.loadShouldFail = true;
    await assert.rejects(() => controller.startTrack(other, { wasPlaying: true }), /load failed/);

    sdk.state.loadShouldFail = false;
    await controller.startTrack(other, { wasPlaying: true });
    await settle();

    assert.equal(sdk.state.loads.length, 3, "the retry never reached the receiver");
    assert.equal(controller.holdsTrack(other), true);
});

// A pause pressed on the speaker itself is the one thing that clears the intent
// from outside the app. Without it the handback reads the room as still
// listening, and ending a cast that was paused starts the soundscape here.
test("a pause on the device clears the intent the handback reads", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    assert.equal(controller.isPlaybackRequested(), true);

    sdk.player.isPaused = true;
    sdk.setPlayerState("PAUSED");
    sdk.emitPlayerPaused();

    assert.equal(controller.isPlaybackRequested(), false, "the device's pause left the intent raised");

    // And the room is handed back exactly what it was doing: still paused.
    sdk.setCastState("NOT_CONNECTED");

    assert.equal(controller.isPlaybackRequested(), false);
});

// The narrow half of the rule above: only a receiver *sitting* paused says the
// room stopped. One that is buffering, or between queue items, is a receiver in
// the middle of something, and clearing the intent there would disarm the idle
// safety net for the session it exists to watch.
test("a receiver that is only buffering is not read as a pause", async () => {
    const { sdk, controller } = createController();

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();

    sdk.player.isPaused = true;
    sdk.setPlayerState("BUFFERING");
    sdk.emitPlayerPaused();

    assert.equal(controller.isPlaybackRequested(), true, "a buffering receiver cleared the intent");
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
    const sdk = createFakeCastSdk();

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
    const sdk = createFakeCastSdk();

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
    const sdk = createFakeCastSdk();
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
    const sdk = createFakeCastSdk();
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
    const sdk = createFakeCastSdk();
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

// isCastSdkCapable keeps browsers without Google's cast stack from reaching
// this controller, but real Chrome can still fail the gstatic fetch itself —
// network trouble, an extension, a corporate proxy. Remembering that is what
// lets the app say so instead of doing nothing.
test("a browser with no cast framework is reported as unreachable", async () => {
    console.warn = () => {};

    const { controller } = createController({
        loader: () => Promise.reject(new Error("Cast SDK reported unavailable")),
    });

    assert.equal(controller.isTransportReady(), true, "nothing is known before a press");
    assert.equal(await controller.prompt(), false);
    assert.equal(controller.isTransportReady(), false);
});

// A failed skip sends the app back to the soundscape that is still playing, and
// that rollback must be a no-op on the receiver. `setTrack` has no "already
// loaded" check of its own, so without one in `loadTrack` the rollback re-fetches
// the file and restarts the room from zero — punishing the listener for a
// failure they did not cause. Latent until the failure above became reportable.
test("the rollback after a failed skip does not restart the playing track", async () => {
    const { sdk, controller } = createController();
    const other = { title: "Fireplace", url: "resources/fire.opus" };

    await controller.prompt();
    controller.setTrack(TRACK);
    sdk.setCastState("CONNECTED");
    await controller.play();
    assert.equal(sdk.state.loads.length, 1);

    sdk.state.loadShouldFail = true;
    controller.setTrack(other);
    await assert.rejects(() => controller.startTrack(other, { wasPlaying: true }));
    const afterFailure = sdk.state.loads.length;

    // What changeTrack's catch does: put the app back on the track that is playing.
    sdk.state.loadShouldFail = false;
    controller.setTrack(TRACK);
    await settle();

    assert.equal(sdk.state.loads.length, afterFailure,
        "the receiver was told to load a track it is already playing");
});
