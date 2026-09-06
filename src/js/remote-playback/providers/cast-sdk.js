/**
 * Casting to Chromecast and Google/Nest speakers via the Google Cast SDK.
 *
 * This exists because the standards-track answer does not work. The Remote
 * Playback API in providers/media-element.js is designed for exactly this job —
 * "a page with a media element initiate and control playback of that media on a
 * remote device" — and it was the correct first choice. In practice its picker
 * never opened: measured on Chrome/Windows, Chrome/Android and Samsung
 * Internet, `remote.prompt()` was refused every time. Chrome only offers
 * devices once its Media Router judges the media "remotable", and that
 * judgement runs through machinery that never engaged for an audio file —
 * desktop got as far as "no remote playback devices found", Android never
 * looked at all. The API's dependable real-world use turns out to be the
 * opposite of ours: `disableRemotePlayback`, to take the cast button *away*
 * from native video controls.
 *
 * Every SDK-free alternative was tried before adding a Google script to an
 * otherwise self-contained app:
 *
 *   - Presenting the app's own URL works and is genuinely SDK-free, but only on
 *     desktop: Chrome renders the page in an offscreen tab and mirrors it, and
 *     Chrome for Android refuses the same call with "Invalid presentation URL".
 *   - Presenting a `cast:` URL launches the receiver but leaves it deaf. Per
 *     Google's own sample, "the sender page will be unable to communicate with
 *     it as the Chromecast does not implement the Presentation Receiver API",
 *     so there is no way to say which soundscape to play.
 *   - A custom receiver listening on a private namespace would work, and needs
 *     a registered application ID — an account and a fee. More entanglement
 *     with Google than the SDK, not less.
 *
 * So: the SDK, with Google's stock Default Media Receiver, which needs no
 * registration, no account and no fee. Safari keeps the Remote Playback and
 * AirPlay path in providers/media-element.js, which is the one platform where
 * that API is properly honoured.
 *
 * The script is fetched from gstatic.com and cannot be precached, which is why
 * nothing loads it until the cast button is actually pressed. A visitor who
 * never casts never contacts Google, and the app stays fully usable offline.
 */

import { REMOTE_FAILURE_MESSAGE } from "../messages.js";
import { remoteUrlFor } from "../track-source.js";

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

// The twins are AAC in MP4, which the Default Media Receiver lists as supported
// (`audio/mp4; codecs="mp4a.40.2"`). One format for every path, as before.
const CAST_MIME = "audio/mp4";

// requestSession() rejects with a bare string code rather than an Error. These
// are ordinary outcomes — the picker was dismissed, or it timed out waiting —
// and reporting them would turn normal use into console noise.
const BENIGN_SESSION_ERRORS = new Set(["cancel", "timeout"]);

// Set while a session is running, so the next page load knows to bring the SDK
// up by itself. Without it the SDK's own ORIGIN_SCOPED rejoin can never happen
// here: nothing loads the script until the button is pressed, so a reopened app
// would sit showing "idle" beside a speaker that is still playing.
const RESUME_KEY = "soundscape.casting";

const APP_NAME = "Soundscape";

// Largest first: cast UIs and their notifications pick from the list, and a TV
// showing a full-screen backdrop wants the big one while a phone notification
// wants the small. Both are already precached icons, so this costs no new asset.
const ARTWORK_PATHS = [
    "resources/icons/icon-512.png",
    "resources/icons/icon-192.png",
];

// A receiver that has finished its media goes IDLE, and unlike a media element
// there is no `ended` to wait for. Repeat mode should mean this never happens —
// it is the belt to the queue's braces, for a receiver that ignores it.
//
// Long enough to sit out the IDLE a receiver passes through while it is
// accepting a load: restarting into that would fight the load already running,
// and the resulting reload would land on IDLE again. The state is re-read when
// it fires, so this only has to cover the transition, not guess at it.
const IDLE_RESTART_DELAY_MS = 1500;

// A receiver that cannot play the file at all answers every restart with
// another IDLE. Without a cap that is an unbounded reload loop against someone's
// speaker; with one it is three attempts and then silence, which is at least
// honest. Reset the moment playback is actually observed.
const MAX_CONSECUTIVE_IDLE_RESTARTS = 3;

/**
 * Whether this browser can cast through the SDK, answered *before* the SDK is
 * loaded — which is the whole difficulty. `chrome.cast` only exists once the
 * script has run, so capability has to be inferred from what the SDK is built
 * on: the Presentation API, which Chrome exposes only in a secure context.
 *
 * Deliberately false in Safari and Firefox. Neither ships the Presentation API,
 * so both fall through to providers/media-element.js — Safari to AirPlay, Firefox
 * to no cast button at all, which is correct in both cases.
 *
 * The Presentation API and secure-context checks alone are not enough: every
 * Chromium browser exposes them, but Google's cast framework only ever comes
 * up in actual Chrome — Samsung Internet passes both checks and then the SDK
 * fails to load. Rather than show the button and report that failure after a
 * press, capability is narrowed here with the same brand signal that
 * providers/media-element.js uses to exclude Samsung from the Remote Playback
 * backend, so the browsers that cannot cast get no button at all instead of one
 * that explains itself.
 */
export function isCastSdkCapable(scope = globalThis) {
    return (
        typeof scope.PresentationRequest === "function" &&
        scope.isSecureContext === true &&
        Boolean(scope.navigator?.userAgentData?.brands?.some(({ brand }) => brand === "Google Chrome"))
    );
}

/**
 * Loads the sender script once and resolves when the framework is ready.
 *
 * The SDK announces itself by calling a global rather than by resolving
 * anything, so that global is the handshake. It is installed before the script
 * is appended, because a cached script can run the moment it is inserted.
 */
export function loadCastSdk({ scope = globalThis, url = SDK_URL } = {}) {
    if (scope.__castSdkLoad) return scope.__castSdkLoad;

    scope.__castSdkLoad = new Promise((resolve, reject) => {
        const doc = scope.document;

        if (!doc) {
            reject(new Error("No document to load the Cast SDK into."));
            return;
        }

        scope.__onGCastApiAvailable = (isAvailable, reason) => {
            if (isAvailable) {
                resolve();
                return;
            }

            reject(new Error(`Cast SDK reported unavailable: ${reason ?? "no reason given"}`));
        };

        const script = doc.createElement("script");

        script.src = url;
        script.async = true;
        script.addEventListener("error", () => reject(new Error("Could not load the Cast SDK.")));
        doc.head.append(script);
    });

    return scope.__castSdkLoad;
}

/**
 * Turns a load request into an endlessly repeating one.
 *
 * Ambience has to run for hours; the twins are two minutes long, so a plain
 * load plays once and the room goes quiet — which is what it did. `loadMedia`
 * carries a one-item queue through `queueData`, and `RepeatMode.SINGLE` means
 * "the current item will be repeated indefinitely", so the repeat happens
 * entirely on the device: no round trip per lap, and nothing to go wrong when
 * the phone sleeps, locks, or leaves the house. That last part is the real
 * prize — a sender-driven reload would tie hours of playback to this page
 * staying awake, which on a phone it will not.
 *
 * Guarded rather than assumed: queue support is a property of the receiver
 * build, and an older one missing these constructors should lose the looping,
 * not the playback.
 */
function applyRepeat(chrome, request, mediaInfo) {
    const media = chrome?.cast?.media;

    if (!media?.QueueData || !media.QueueItem || !media.RepeatMode) return;

    const queueData = new media.QueueData();

    queueData.items = [new media.QueueItem(mediaInfo)];
    queueData.repeatMode = media.RepeatMode.SINGLE;
    queueData.startIndex = 0;
    request.queueData = queueData;
}

/**
 * Drives casting through the SDK, presenting the same surface script.js already
 * uses for the Remote Playback path so the transport handover — pausing local
 * audio, suspending the AudioContext, handing playback back on disconnect —
 * needs no branch of its own.
 *
 * The shape is nonetheless different underneath, and in a way that removes
 * work rather than adding it. There is no media element to park, no source to
 * preload, no metadata to wait for and no loop watchdog: the receiver fetches
 * the file itself and reports its own state back.
 */
export class CastSdkController {
    constructor({
        onChange,
        onPlaybackChange,
        onTrackAdopted,
        onVolumeChange,
        tracks = [],
        scope = globalThis,
        loader = loadCastSdk,
    } = {}) {
        this.onChange = onChange;
        this.onPlaybackChange = onPlaybackChange;
        // Rejoining can discover the receiver on a soundscape this page never
        // chose — someone changed it from another device, or from the speaker.
        this.onTrackAdopted = onTrackAdopted;
        // The device's level is the device's, and it can be changed from
        // anywhere; this is how the slider hears about it.
        this.onVolumeChange = onVolumeChange;
        this.tracks = tracks;
        this.scope = scope;
        this.loader = loader;
        this.track = null;
        // What the receiver was actually given, which is not always the app's
        // current track — nothing is loaded until a cast is running.
        this.loadedUrl = null;
        // The soundscape the receiver is being moved *to*, held from the moment
        // it is asked for rather than from the moment it answers, and the run
        // carrying it there — shared with every caller that asks meanwhile.
        // `loadedUrl` cannot stand in for this: it names the track being left
        // for the whole round trip. See loadTrack.
        this.pendingTrack = null;
        this.pendingLoad = null;
        this.loadRunId = 0;
        this.playbackRequested = false;
        this.promptPending = false;
        this.sdkReady = null;
        // Set once the SDK has definitively refused to come up. isCastSdkCapable
        // already keeps browsers without Google's cast stack (Samsung Internet)
        // from reaching this controller at all, so this covers a narrower case:
        // real Chrome where the gstatic fetch itself fails — network trouble, an
        // extension, a corporate proxy. Remembering that is what turns a button
        // that does nothing into a button that says so.
        this.sdkUnavailable = false;
        this.idleRestartTimer = 0;
        this.idleRestarts = 0;
        this.context = null;
        this.player = null;
        this.playerController = null;
    }

    isSupported() {
        return isCastSdkCapable(this.scope);
    }

    backendName() {
        return this.isSupported() ? "cast-sdk" : null;
    }

    // Nothing can be observed before the SDK is loaded, so this reports the
    // opening state — normally "idle" — and then, only for someone who was
    // casting when they last closed the app, brings the SDK up so its
    // ORIGIN_SCOPED rejoin can find the running session and report it.
    //
    // That condition is the whole design. Loading unconditionally would rejoin
    // reliably but contact Google on every single visit, which is exactly what
    // this module is written to avoid; loading never — which is what it did —
    // means the rejoin can never happen at all, and reopening the app leaves it
    // showing "idle" next to a speaker that is still playing.
    start() {
        if (!this.isSupported()) return false;

        this.notifyChange();

        if (this.readResumeHint()) {
            // Nothing to report on failure: no one asked for this, and a press
            // of the button will surface it properly.
            void this.ensureSdk().then(() => this.handleCastStateChange()).catch(() => {});
        }

        return true;
    }

    // The Remote Playback path preloads a file so Safari's picker has a header
    // to read. The SDK needs no such thing: the receiver does its own fetching,
    // so there is nothing to release and nothing to spend.
    allowTransportLoad() {
        return false;
    }

    // Someone is reaching for the button. Fetching a cross-origin script and
    // starting a Cast context takes long enough to read as a dead control, and
    // all of it can happen before the press rather than after it.
    //
    // This is the latest possible moment that keeps the promise the module is
    // built on: a visitor who never goes near casting never contacts Google.
    // Hovering or focusing the cast button is as clear a statement of intent as
    // exists short of the click itself, and on a touch screen the pointerdown
    // that precedes the click still arrives first.
    prepare() {
        if (!this.isSupported() || this.sdkReady) return false;

        // Failure is the press's to report, not this one's — nobody asked.
        void this.ensureSdk().catch(() => {});

        return true;
    }

    // Read by the app as "could a press have reached a picker" — there is no
    // metadata precondition on this path, so the only thing that stops one is
    // the SDK never coming up at all.
    isTransportReady() {
        return !this.sdkUnavailable;
    }

    // Best effort on both sides: storage can throw (private mode, disabled
    // cookies), and losing the hint costs a rejoin, not a feature.
    readResumeHint() {
        try {
            return this.scope.localStorage?.getItem(RESUME_KEY) === "1";
        } catch {
            return false;
        }
    }

    writeResumeHint(casting) {
        try {
            if (casting) {
                this.scope.localStorage?.setItem(RESUME_KEY, "1");
            } else {
                this.scope.localStorage?.removeItem(RESUME_KEY);
            }
        } catch {
            // Best effort by design.
        }
    }

    // Every subscription initialise() takes out is released here, and the two
    // lists have to stay in step. VOLUME_LEVEL_CHANGED was missing from this one
    // for a while and nothing noticed, because nothing calls stopWatching in the
    // app yet — the controller lives as long as the page. That stops being true
    // the moment a provider can be detached, which is what the shared output
    // contract's teardown case now pins.
    stopWatching() {
        const events = this.scope.cast?.framework;

        if (!events || !this.context) return;

        this.context.removeEventListener(
            events.CastContextEventType.CAST_STATE_CHANGED,
            this.handleCastStateChange,
        );
        this.playerController?.removeEventListener(
            events.RemotePlayerEventType.IS_PAUSED_CHANGED,
            this.handlePlaybackChange,
        );
        this.playerController?.removeEventListener(
            events.RemotePlayerEventType.IS_CONNECTED_CHANGED,
            this.handleCastStateChange,
        );
        this.playerController?.removeEventListener(
            events.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
            this.handleVolumeChange,
        );
        this.playerController?.removeEventListener(
            events.RemotePlayerEventType.PLAYER_STATE_CHANGED,
            this.handlePlayerStateChange,
        );
        this.scope.clearTimeout?.(this.idleRestartTimer);
        this.idleRestartTimer = 0;
    }

    async ensureSdk() {
        if (this.sdkReady) return this.sdkReady;

        this.sdkReady = this.loader({ scope: this.scope })
            .then(() => this.initialise())
            .catch((error) => {
                // Not retried. A browser that answers "no cast framework here"
                // will answer the same way for the life of the page, and
                // remembering it is what lets the button explain itself.
                this.sdkUnavailable = true;

                throw error;
            });

        return this.sdkReady;
    }

    initialise() {
        const { cast, chrome } = this.scope;

        this.context = cast.framework.CastContext.getInstance();
        this.context.setOptions({
            receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            // Origin-scoped so a session this page started is rejoined after a
            // reload, and one started by an unrelated tab is not adopted.
            autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        this.context.addEventListener(
            cast.framework.CastContextEventType.CAST_STATE_CHANGED,
            this.handleCastStateChange,
        );

        this.player = new cast.framework.RemotePlayer();
        this.playerController = new cast.framework.RemotePlayerController(this.player);

        // The receiver has its own remote and the person holding it is not this
        // page, so its pause is the app's only word that the room went quiet —
        // the same reasoning as the transport element's play/pause in providers/media-element.js.
        this.playerController.addEventListener(
            cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
            this.handlePlaybackChange,
        );
        this.playerController.addEventListener(
            cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
            this.handleCastStateChange,
        );

        // The device's own level can be changed from the speaker, the Home app
        // or another sender, and the slider has to follow it rather than sit
        // where this page last left it.
        if (cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED) {
            this.playerController.addEventListener(
                cast.framework.RemotePlayerEventType.VOLUME_LEVEL_CHANGED,
                this.handleVolumeChange,
            );
        }

        // The safety net under repeat mode. A receiver that played the file
        // through and stopped reports IDLE, and there is no `ended` event on
        // this path to catch it — the same reasoning that gave the Remote
        // Playback path its LoopWatchdog, minus the polling, because the SDK
        // volunteers the state change.
        if (cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED) {
            this.playerController.addEventListener(
                cast.framework.RemotePlayerEventType.PLAYER_STATE_CHANGED,
                this.handlePlayerStateChange,
            );
        }
    }

    castState() {
        return this.context?.getCastState?.() ?? null;
    }

    isConnected() {
        return this.castState() === this.scope.cast?.framework?.CastState?.CONNECTED;
    }

    isConnecting() {
        return this.castState() === this.scope.cast?.framework?.CastState?.CONNECTING;
    }

    isPlaying() {
        return this.isConnected() && this.player?.isPaused === false;
    }

    isPlaybackRequested() {
        return this.playbackRequested;
    }

    // PlaybackOutput. Coincides with the above on any remote — see the same
    // member in providers/media-element.js for why that is honest rather than duplicated.
    wantsPlayback() {
        return this.playbackRequested;
    }

    // PlaybackOutput. Against what the receiver was actually given, which on a
    // rejoin is whatever it has been playing all along rather than whatever this
    // page last chose.
    holdsTrack(track) {
        return Boolean(track) && this.loadedUrl === remoteUrlFor(track);
    }

    // PlaybackOutput. The receiver owns the position and the page cannot read
    // it; see the same member in providers/media-element.js.
    canReportPosition() {
        return false;
    }

    getMediaSessionPositionState() {
        return null;
    }

    failureMessage() {
        return REMOTE_FAILURE_MESSAGE;
    }

    // Unlike the Remote Playback path, this transport has a volume API of its
    // own — `RemotePlayerController.setVolumeLevel` — so the slider can drive
    // the speaker instead of being switched off with an explanation.
    //
    // Answered false while disconnected so the app never routes a local level
    // change into a session that does not exist.
    canControlVolume() {
        return this.isConnected() && Boolean(this.playerController);
    }

    getVolume() {
        return this.canControlVolume() ? this.player?.volumeLevel : undefined;
    }

    setVolume(level) {
        if (!this.canControlVolume()) return false;

        this.player.volumeLevel = Math.min(1, Math.max(0, Number(level)));
        this.playerController.setVolumeLevel();

        return true;
    }

    setPlaybackRequested(requested) {
        this.playbackRequested = Boolean(requested);
    }

    getTrackUrl() {
        return this.loadedUrl;
    }

    // PlaybackOutput. setTrack already loads the receiver when one is connected
    // and playing, so the only thing left is the case it deliberately skips: a
    // connected receiver that is paused, which a track change should start.
    async startTrack(track, { wasPlaying = true } = {}) {
        this.setTrack(track);

        if (wasPlaying) await this.play();
    }

    // Remembered unconditionally, loaded only while a cast is running: with
    // nothing connected there is no receiver to tell.
    setTrack(track) {
        this.track = track;

        if (!this.isConnected() || !this.playbackRequested) return;

        void this.loadTrack(track).catch((error) => {
            console.warn("Could not change the soundscape on the cast device.", error);
        });
    }

    async prompt() {
        if (!this.isSupported() || this.promptPending) return false;

        this.promptPending = true;

        try {
            await this.ensureSdk();
            // Opens the browser's own picker and connects. There is no separate
            // disconnect call in the app: pressing the button again while
            // connected is what offers "stop casting", exactly as before.
            await this.context.requestSession();

            return true;
        } catch (error) {
            if (BENIGN_SESSION_ERRORS.has(error)) return false;

            console.warn("Could not open the cast device picker.", error);

            return false;
        } finally {
            this.promptPending = false;
        }
    }

    async play() {
        if (!this.isConnected()) return false;

        this.playbackRequested = true;

        if (!this.track) return false;

        // Whether this soundscape needs loading is `loadTrack`'s question, and
        // asking it here as well is how the two answers came apart: a load
        // already under way is what starts the sound, so the answer to play is
        // to wait for it rather than to press play at a receiver still fetching.
        // Only a receiver that already holds the track needs the play verb.
        if (await this.loadTrack(this.track)) return true;

        if (this.player?.isPaused) this.playerController?.playOrPause();

        return true;
    }

    pause() {
        this.playbackRequested = false;

        if (this.isConnected() && this.player?.isPaused === false) {
            this.playerController?.playOrPause();
        }
    }

    // The receiver fetches the file itself, so it needs an absolute URL — a
    // page-relative one means nothing on the other side of the network.
    absoluteRemoteUrl(track) {
        return new URL(remoteUrlFor(track), this.scope.location?.href ?? SDK_URL).href;
    }

    absoluteUrl(path) {
        return new URL(path, this.scope.location?.href ?? SDK_URL).href;
    }

    // What the receiver, and every cast notification downstream of it, has to
    // describe the sound with. Left at just a title it reads as "Default Media
    // Receiver" with a bare track name and no picture — the app it came from is
    // nowhere on screen.
    //
    // None of this needs a registered receiver application. The $5 registration
    // buys a *custom receiver*; metadata and artwork are ordinary fields on a
    // load request that the stock receiver renders.
    buildMetadata(track) {
        const { chrome } = this.scope;
        const MetadataType = chrome.cast.media.MusicTrackMediaMetadata;

        if (!MetadataType) return undefined;

        const metadata = new MetadataType();

        metadata.title = track.title;
        // Artist rather than album: it is the line cast UIs show under the
        // title, and "Soundscape" there is what identifies where the sound is
        // coming from.
        metadata.artist = APP_NAME;
        metadata.albumName = APP_NAME;

        if (chrome.cast.Image) {
            metadata.images = ARTWORK_PATHS.map(
                (path) => new chrome.cast.Image(this.absoluteUrl(path)),
            );
        }

        return metadata;
    }

    // Where the receiver is, or is on its way to. Every "does it already hold
    // this?" question is asked against this rather than `loadedUrl`, because for
    // the length of a round trip the two disagree — and that window is where a
    // person pressing skip twice lives. Derived rather than stored, so it cannot
    // drift from the request it describes.
    targetUrl() {
        return this.pendingTrack ? remoteUrlFor(this.pendingTrack) : this.loadedUrl;
    }

    // One press, one load, and never two open at once. A single track change
    // reaches here three times — the app keeps the transport current, then
    // `startTrack` sets it again, then `play()` asks — and each is a full load
    // that a real receiver answers by re-fetching the file, so a skip restarted
    // the soundscape twice before it settled.
    //
    // Requests are therefore coalesced rather than run in parallel: one
    // `loadMedia` open at a time, `pendingTrack` a slot holding only the newest
    // destination, and anything superseded while still queued never sent. Both
    // of this feature's skip bugs came of asking `loadedUrl` where this asks
    // `targetUrl()`; the plugin's AGENTS.md records what each of them did to the room.
    //
    // A later caller is handed the same run rather than refused. Refusing meant
    // the awaited path (startTrack → play) resolved before the receiver had
    // answered, so a failed load reached nobody and the title named a soundscape
    // the room was not playing.
    loadTrack(track) {
        const session = this.context?.getCurrentSession?.();

        if (!session || !track) return Promise.resolve(false);

        // Already where it is going: either a request for it is open, and the
        // caller waits on that, or the receiver genuinely holds it and loading
        // again would be a re-fetch that restarts the soundscape. The
        // idle-restart path clears `loadedUrl` to get past this.
        if (remoteUrlFor(track) === this.targetUrl()) {
            return this.pendingLoad ?? Promise.resolve(false);
        }

        this.pendingTrack = track;
        this.pendingLoad ??= this.drainLoads();

        return this.pendingLoad;
    }

    // Sends whatever the slot holds, one `loadMedia` at a time, until the
    // receiver is where the app wants it. A loop rather than a chain of promises
    // because the destination can change while a request is open: whatever the
    // slot says when the receiver answers is what goes next, and every request
    // it overtook was replaced before it cost the room anything.
    //
    // Answers whether the receiver was asked at all, which is what tells `play()`
    // that a load — every one of which carries autoplay — is already starting the
    // soundscape for it.
    async drainLoads() {
        const runId = ++this.loadRunId;

        try {
            while (this.pendingTrack) {
                const track = this.pendingTrack;
                // Re-read every lap: a session can end while a request is open,
                // and there is nothing to load into once it has.
                const session = this.context?.getCurrentSession?.();

                if (!session) {
                    // Emptied on the way out, or the slot names a destination no
                    // run is heading for: `targetUrl()` would go on reporting the
                    // receiver as en route to a track nothing will ever send, and
                    // every later request for it would read as already under way.
                    // The disconnect handler clears it too, but only once the
                    // state change arrives — this is the same session ending, seen
                    // first.
                    if (this.loadRunId === runId) this.pendingTrack = null;

                    return false;
                }

                let failure = null;

                try {
                    await this.sendLoad(session, track);
                } catch (error) {
                    failure = error;
                }

                // A disconnect voids every run open on the session it ended, so
                // this one may be a ghost by now: holding the answer to a
                // question about a session that has gone, which the SDK can take
                // until well after the reconnect to give. It must not record what
                // it loaded — the next rejoin reads `loadedUrl` to decide whether
                // the room is already playing what it wants — nor resend it over
                // whatever the live run is doing, nor report a failure nobody is
                // waiting on. Checked after the request rather than only before
                // it, because that is where the whole disconnect fits.
                if (this.loadRunId !== runId) return false;

                if (failure) {
                    // A request nobody is waiting on any more: the destination
                    // moved while it was open, and the load that replaced it is
                    // the one whose outcome matters. Passing this on would report
                    // an abandoned soundscape's failure against the current one.
                    if (this.pendingTrack !== track) continue;

                    // Emptied before the failure is passed on, or the retry that
                    // follows reads as a request already under way and never
                    // reaches the receiver.
                    this.pendingTrack = null;

                    throw failure;
                }

                // Recorded here rather than in `sendLoad` so that it is behind
                // the ownership check above: a receiver's answer is only news
                // about what the app holds if the app still holds the question.
                this.loadedUrl = remoteUrlFor(track);

                // Left alone if a newer request has claimed the slot: that is
                // the next lap's work, not a leftover of this one.
                if (this.pendingTrack === track) this.pendingTrack = null;
            }

            return true;
        } finally {
            // Only if this run still owns the slot. A disconnect empties it so a
            // session dying mid-request cannot leave every later caller waiting
            // on a promise the SDK may never settle — and the reconnect after it
            // can start a new run while this one is still unwinding.
            if (this.loadRunId === runId) this.pendingLoad = null;
        }
    }

    async sendLoad(session, track) {
        const { chrome } = this.scope;
        const mediaInfo = new chrome.cast.media.MediaInfo(this.absoluteRemoteUrl(track), CAST_MIME);

        mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

        mediaInfo.metadata = this.buildMetadata(track);

        const request = new chrome.cast.media.LoadRequest(mediaInfo);

        request.autoplay = true;
        applyRepeat(chrome, request, mediaInfo);

        // Just the request. What the receiver now holds is `drainLoads`'s to
        // record, because only it knows whether this answer is still wanted.
        await session.loadMedia(request);

        return true;
    }

    handleCastStateChange = () => {
        const connected = this.isConnected();

        // Before anything is announced, because the app decides what to do with
        // the connection the instant it hears about it.
        if (connected) this.adoptReceiverMedia();

        // A session that ends takes its loaded media with it, so the next
        // connection has to load again rather than assume the receiver still
        // holds the track.
        if (!connected) {
            this.loadedUrl = null;
            this.pendingTrack = null;
            this.pendingLoad = null;
            // Voids any run still open on the session that has just gone, so
            // whatever the SDK eventually answers it with cannot be mistaken for
            // news about the next one. See drainLoads.
            this.loadRunId += 1;
            this.cancelIdleRestart();
            this.idleRestarts = 0;
        }

        // Only a settled state is worth remembering: writing the hint while
        // merely connecting would arm a rejoin for a session that may never
        // exist.
        if (connected || !this.isConnecting()) this.writeResumeHint(connected);

        this.notifyChange();
    };

    // Rejoining a session that has been playing all along must not restart it.
    // `loadedUrl` is null on a fresh page, so without this `play()` sees the
    // current track as "not loaded" and loads it again — dropping a speaker
    // that was minutes into a soundscape back to the beginning, every time the
    // app is reopened. Adopting what the receiver already holds turns that same
    // call into the no-op it should be.
    //
    // Matched against the whole catalogue, not just the current track. A session
    // outlives the page that started it, so the receiver may well be on a
    // soundscape this page never chose: changed from a phone while the tablet
    // was closed, or from the speaker itself. Reopening the app should show what
    // is actually playing, and reporting it is what lets the title, the saved
    // track and the OS metadata follow.
    adoptReceiverMedia() {
        if (this.loadedUrl) return;

        const media = this.context?.getCurrentSession?.()?.getMediaSession?.()?.media
            ?? this.player?.mediaInfo;
        const contentId = media?.contentId;

        if (!contentId) return;

        const playing = this.tracks.find(
            (candidate) => this.absoluteRemoteUrl(candidate) === contentId,
        ) ?? (this.track && this.absoluteRemoteUrl(this.track) === contentId ? this.track : null);

        if (!playing) return;

        this.loadedUrl = remoteUrlFor(playing);

        if (playing === this.track) return;

        this.track = playing;
        this.onTrackAdopted?.(playing);
    }

    cancelIdleRestart() {
        this.scope.clearTimeout?.(this.idleRestartTimer);
        this.idleRestartTimer = 0;
    }

    // Sitting paused, as opposed to merely not producing sound. BUFFERING and
    // IDLE are receivers in the middle of something, and neither is somebody
    // reaching for pause.
    isReceiverPaused() {
        const { PlayerState } = this.scope.chrome?.cast?.media ?? {};

        return Boolean(PlayerState) && this.player?.playerState === PlayerState.PAUSED;
    }

    isReceiverIdle() {
        const { PlayerState } = this.scope.chrome?.cast?.media ?? {};

        return Boolean(PlayerState) && this.player?.playerState === PlayerState.IDLE;
    }

    // Media loaded and working, whether or not it is currently making a sound.
    // Deliberately not "anything that is not idle": BUFFERING is a receiver
    // trying, not a receiver succeeding, and a device that never gets past
    // fetching would cycle BUFFERING/IDLE and reset its own restart allowance
    // for ever.
    isReceiverWorking() {
        const { PlayerState } = this.scope.chrome?.cast?.media ?? {};

        if (!PlayerState) return false;

        return this.player?.playerState === PlayerState.PLAYING
            || this.player?.playerState === PlayerState.PAUSED;
    }

    // A receiver that reached the end anyway — repeat mode unhonoured, or the
    // stream dropped. Reloading is the only move available, and it is safe to
    // make wrongly: the app either wanted this playing or it did not.
    //
    // Deferred, and then re-checked when it fires, because IDLE is also the
    // state a receiver passes through while a new load is being accepted. A
    // restart into that would fight the load already running and land back on
    // IDLE, which is the shape of a loop rather than a recovery.
    handlePlayerStateChange = () => {
        // Proof a restart worked, so the run of failed ones is over.
        if (this.isReceiverWorking()) this.idleRestarts = 0;

        if (!this.isReceiverIdle()) {
            this.cancelIdleRestart();

            return;
        }

        if (!this.isConnected() || !this.playbackRequested || !this.track) return;

        if (this.idleRestarts >= MAX_CONSECUTIVE_IDLE_RESTARTS) return;

        this.cancelIdleRestart();
        this.idleRestartTimer = this.scope.setTimeout?.(() => {
            this.idleRestartTimer = 0;

            if (!this.isConnected() || !this.playbackRequested || !this.isReceiverIdle()) return;

            this.idleRestarts += 1;
            // Cleared so `loadTrack` reads the receiver as holding nothing and
            // sends the restart, rather than answering that it is already there.
            // Only half of what `targetUrl()` reports: a load still open takes
            // precedence, and rightly — that request *is* a restart, and a second
            // one beside it would be the double-load this feature spent two bugs
            // learning not to send.
            this.loadedUrl = null;

            void this.loadTrack(this.track).catch((error) => {
                console.warn("Could not restart the soundscape on the cast device.", error);
            });
        }, IDLE_RESTART_DELAY_MS);
    };

    handleVolumeChange = () => {
        if (!this.isConnected()) return;

        this.onVolumeChange?.(this.player?.volumeLevel);
    };

    handlePlaybackChange = () => {
        if (!this.isConnected()) return;

        // The receiver's settled state *is* the playback intent, whoever set it.
        // Raising it matters on a rejoin: nothing was pressed in this page's
        // lifetime, so the flag starts false while the room is full of sound,
        // which would leave the idle safety net disarmed for a session it is
        // meant to be watching.
        //
        // Clearing it matters when the pause came from the device itself — the
        // speaker's own remote, or the Home app. The app's pause clears the flag
        // before this event arrives, so mirroring is a no-op there; a device's
        // pause has nothing else that ever clears it, and leaving it raised told
        // the handback the room was still listening. Ending a cast that had been
        // paused on the device then started the soundscape on this machine
        // instead of leaving it quiet.
        //
        // Safe to mirror here, and deliberately not done on the media element
        // path: there a track change fires a `pause` of its own for a cast that
        // is not stopping. This transport reports the receiver's state rather
        // than an element's — and the clear is narrowed further to a *settled*
        // PAUSED, so a receiver merely buffering or between items is never
        // mistaken for one somebody stopped. Only a receiver that is sitting
        // paused says the room is no longer listening.
        if (this.player?.isPaused === false) {
            this.playbackRequested = true;
        } else if (this.isReceiverPaused()) {
            this.playbackRequested = false;
        }

        this.onPlaybackChange?.();
    };

    notifyChange() {
        const report = (error) => console.warn("Could not apply a cast state change.", error);

        try {
            void Promise.resolve(this.onChange?.({
                connected: this.isConnected(),
                connecting: this.isConnecting(),
            })).catch(report);
        } catch (error) {
            report(error);
        }
    }
}
