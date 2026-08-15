/**
 * A first-class fake remote output.
 *
 * The suite has two hand-built fakes today (a Remote Playback object bolted to a
 * media element in `app-remote-playback.test.js`, and a `cast.framework` namespace in
 * `providers/cast-sdk.test.js`). Both fake a *platform*, which is right for testing a
 * particular controller against a particular browser API and wrong for
 * everything else: neither can stand in for "some remote output" when what is
 * under test is the app.
 *
 * This fakes the output itself. It implements the same public surface
 * `MediaElementController` and `CastSdkController` present, so it is drivable through
 * exactly the calls the app makes — which is what makes a test that passes
 * against it meaningful about the real ones. It is also the reference
 * implementation the shared contract suite is written against: if the contract
 * cannot be satisfied by something this simple, the contract is wrong.
 *
 * Deliberately configurable on the two axes the real outputs genuinely differ:
 *
 *   - `canControlVolume` — false on the Remote Playback path (element volume is
 *     the receiver's own level and outlives the session) and true on the Cast
 *     SDK path (`setVolumeLevel` is an explicit request). See AGENTS.md.
 *   - `supported` — so a test can model a browser with no remote output at all,
 *     which is the case the whole detachability claim rests on.
 *
 * It reaches nothing: no element, no network, no timers it does not own.
 */

import { remoteUrlFor } from "../../src/js/remote-playback/track-source.js";

export function createFakeRemotePlayback({
    onChange,
    onPlaybackChange,
    onTrackAdopted,
    onVolumeChange,
    canControlVolume = true,
    supported = true,
    name = "fake",
} = {}) {
    const calls = { play: 0, pause: 0, prompt: 0, prepare: 0, notifyChange: 0 };

    let connectionState = "disconnected";
    let playbackRequested = false;
    let deviceIsPlaying = false;
    let transportAllowed = false;
    let promptPending = false;
    let promptRejection = null;
    let track = null;
    let loadedUrl = null;
    let volume = 1;
    let watching = false;

    const notifyChange = () => {
        calls.notifyChange += 1;

        const report = (error) => console.warn("Could not apply a cast state change.", error);

        try {
            void Promise.resolve(onChange?.({
                connected: output.isConnected(),
                connecting: output.isConnecting(),
            })).catch(report);
        } catch (error) {
            report(error);
        }
    };

    // Mirrors both controllers: the source is only made current once a gesture
    // has been reported, or a connection is live or opening and a receiver is
    // already waiting on the answer.
    const syncLoadedUrl = () => {
        if (!supported) return;
        if (!transportAllowed && connectionState === "disconnected") return;

        loadedUrl = remoteUrlFor(track) ?? loadedUrl;
    };

    const output = {
        isSupported: () => supported,
        backendName: () => (supported ? name : null),

        start() {
            if (!supported || watching) return false;

            watching = true;
            notifyChange();

            return true;
        },

        stopWatching() {
            watching = false;
        },

        isConnected: () => supported && connectionState === "connected",
        isConnecting: () => supported && connectionState === "connecting",
        isPlaying: () => output.isConnected() && deviceIsPlaying,

        // The raw intent, ungated on still being connected: a disconnect has to
        // be able to ask "was this playing?" after the connection is gone.
        isPlaybackRequested: () => playbackRequested,
        // Coincide on any remote — see the same member in providers/media-element.js.
        wantsPlayback: () => playbackRequested,
        setPlaybackRequested(requested) {
            playbackRequested = Boolean(requested);
        },

        holdsTrack: (candidate) => Boolean(candidate) && loadedUrl === remoteUrlFor(candidate),

        // The receiver owns the position and the page cannot read it.
        canReportPosition: () => false,
        getMediaSessionPositionState: () => null,

        failureMessage: () => "That device couldn't play this soundscape. Try connecting again.",

        async startTrack(next, { wasPlaying = true } = {}) {
            output.setTrack(next);

            if (wasPlaying) await output.play();
        },

        setTrack(next) {
            track = next;
            syncLoadedUrl();

            if (output.isConnected() && playbackRequested && next) {
                loadedUrl = remoteUrlFor(next);
                deviceIsPlaying = true;
            }
        },
        getTrackUrl: () => loadedUrl,

        allowTransportLoad() {
            if (transportAllowed) return false;

            transportAllowed = true;
            syncLoadedUrl();

            return true;
        },

        prepare() {
            calls.prepare += 1;

            return false;
        },

        isTransportReady: () => true,

        canControlVolume: () => canControlVolume && output.isConnected(),
        getVolume: () => (output.canControlVolume() ? volume : undefined),
        setVolume(level) {
            if (!output.canControlVolume()) return false;

            volume = Math.min(1, Math.max(0, Number(level)));

            return true;
        },

        async prompt() {
            if (!supported || promptPending) return false;

            calls.prompt += 1;
            promptPending = true;

            try {
                if (promptRejection) throw promptRejection;

                return true;
            } catch {
                return false;
            } finally {
                promptPending = false;
            }
        },

        async play() {
            if (!output.isConnected()) return false;

            calls.play += 1;
            playbackRequested = true;
            loadedUrl = remoteUrlFor(track) ?? loadedUrl;
            deviceIsPlaying = true;

            return true;
        },

        pause() {
            calls.pause += 1;
            playbackRequested = false;
            deviceIsPlaying = false;
        },
    };

    // Test-facing. Everything below drives the *device*, never the app: these
    // stand for things happening in the room or on the network, which is exactly
    // the class of event the app cannot originate and must react to.
    const device = {
        calls,

        async beginConnecting() {
            connectionState = "connecting";
            syncLoadedUrl();
            notifyChange();
        },

        async connect({ alreadyPlaying = false, holdingUrl = null } = {}) {
            connectionState = "connected";

            // A session outlives the page that opened it, so a rejoin can find
            // the receiver already playing something this page never chose.
            if (holdingUrl) loadedUrl = holdingUrl;
            if (alreadyPlaying) deviceIsPlaying = true;

            syncLoadedUrl();
            notifyChange();
        },

        async disconnect() {
            connectionState = "disconnected";
            deviceIsPlaying = false;
            loadedUrl = null;
            notifyChange();
        },

        /** The receiver's own remote was pressed. The app hears only this. */
        async pressPauseOnDevice() {
            deviceIsPlaying = false;
            await onPlaybackChange?.();
        },

        async pressPlayOnDevice() {
            deviceIsPlaying = true;
            await onPlaybackChange?.();
        },

        /** The device's level was changed from the speaker or another sender. */
        async changeVolumeOnDevice(level) {
            volume = level;
            await onVolumeChange?.(level);
        },

        /** Report that the receiver is holding a track this page never chose. */
        async adoptTrack(next) {
            track = next;
            loadedUrl = remoteUrlFor(next) ?? null;
            await onTrackAdopted?.(next);
        },

        failNextPrompt(error) {
            promptRejection = error;
        },

        isPlayingOnDevice: () => deviceIsPlaying,
        isWatching: () => watching,
        loadedUrl: () => loadedUrl,
    };

    return { output, device };
}
