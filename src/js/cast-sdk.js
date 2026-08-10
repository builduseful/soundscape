/**
 * Casting to Chromecast and Google/Nest speakers via the Google Cast SDK.
 *
 * This exists because the standards-track answer does not work. The Remote
 * Playback API in cast.js is designed for exactly this job — "a page with a
 * media element initiate and control playback of that media on a connected
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
 * AirPlay path in cast.js, which is the one platform where that API is
 * properly honoured.
 *
 * The script is fetched from gstatic.com and cannot be precached, which is why
 * nothing loads it until the cast button is actually pressed. A visitor who
 * never casts never contacts Google, and the app stays fully usable offline.
 */

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

// The twins are AAC in MP4, which the Default Media Receiver lists as supported
// (`audio/mp4; codecs="mp4a.40.2"`). One format for every path, as before.
const CAST_MIME = "audio/mp4";

// requestSession() rejects with a bare string code rather than an Error. These
// are ordinary outcomes — the picker was dismissed, or it timed out waiting —
// and reporting them would turn normal use into console noise.
const BENIGN_SESSION_ERRORS = new Set(["cancel", "timeout"]);

/**
 * Whether this browser can cast through the SDK, answered *before* the SDK is
 * loaded — which is the whole difficulty. `chrome.cast` only exists once the
 * script has run, so capability has to be inferred from what the SDK is built
 * on: the Presentation API, which Chrome exposes only in a secure context.
 *
 * Deliberately false in Safari and Firefox. Neither ships the Presentation API,
 * so both fall through to cast.js — Safari to AirPlay, Firefox to no cast
 * button at all, which is correct in both cases.
 */
export function isCastSdkCapable(scope = globalThis) {
    return typeof scope.PresentationRequest === "function" && scope.isSecureContext === true;
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
    constructor({ onChange, onPlaybackChange, scope = globalThis, loader = loadCastSdk } = {}) {
        this.onChange = onChange;
        this.onPlaybackChange = onPlaybackChange;
        this.scope = scope;
        this.loader = loader;
        this.track = null;
        // What the receiver was actually given, which is not always the app's
        // current track — nothing is loaded until a cast is running.
        this.loadedUrl = null;
        this.playbackRequested = false;
        this.promptPending = false;
        this.sdkReady = null;
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

    // Nothing can be observed before the SDK is loaded, and loading it is
    // exactly what must not happen at boot. So this only reports the opening
    // state, which is always "idle" — a session already running on the device
    // is picked up by the SDK's own resume once it does load.
    start() {
        if (!this.isSupported()) return false;

        this.notifyChange();

        return true;
    }

    // The Remote Playback path preloads a file so Safari's picker has a header
    // to read. The SDK needs no such thing: the receiver does its own fetching,
    // so there is nothing to release and nothing to spend.
    allowTransportLoad() {
        return false;
    }

    // No metadata precondition either, so a press can never be too early.
    isTransportReady() {
        return true;
    }

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
    }

    async ensureSdk() {
        if (this.sdkReady) return this.sdkReady;

        this.sdkReady = this.loader({ scope: this.scope }).then(() => this.initialise());

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
        // the same reasoning as the cast element's play/pause in cast.js.
        this.playerController.addEventListener(
            cast.framework.RemotePlayerEventType.IS_PAUSED_CHANGED,
            this.handlePlaybackChange,
        );
        this.playerController.addEventListener(
            cast.framework.RemotePlayerEventType.IS_CONNECTED_CHANGED,
            this.handleCastStateChange,
        );
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

    setPlaybackRequested(requested) {
        this.playbackRequested = Boolean(requested);
    }

    getTrackUrl() {
        return this.loadedUrl;
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

        if (this.track.castUrl !== this.loadedUrl) {
            await this.loadTrack(this.track);

            return true;
        }

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
    absoluteCastUrl(track) {
        return new URL(track.castUrl, this.scope.location?.href ?? SDK_URL).href;
    }

    async loadTrack(track) {
        const session = this.context?.getCurrentSession?.();

        if (!session || !track) return false;

        const { chrome } = this.scope;
        const mediaInfo = new chrome.cast.media.MediaInfo(this.absoluteCastUrl(track), CAST_MIME);

        mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

        if (chrome.cast.media.MusicTrackMediaMetadata) {
            const metadata = new chrome.cast.media.MusicTrackMediaMetadata();

            metadata.title = track.title;
            mediaInfo.metadata = metadata;
        }

        const request = new chrome.cast.media.LoadRequest(mediaInfo);

        request.autoplay = true;

        await session.loadMedia(request);
        this.loadedUrl = track.castUrl;

        return true;
    }

    handleCastStateChange = () => {
        // A session that ends takes its loaded media with it, so the next
        // connection has to load again rather than assume the receiver still
        // holds the track.
        if (!this.isConnected()) this.loadedUrl = null;

        this.notifyChange();
    };

    handlePlaybackChange = () => {
        if (!this.isConnected()) return;

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
