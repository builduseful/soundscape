const audioElementsWithPlaybackSync = new WeakSet();

export function initMediaSession(track, actions, audioElement) {
    updateMediaSessionStatus(track);
    registerMediaSessionHandlers(actions);
    registerAudioElementHandlers(actions, audioElement);
}

export function registerMediaSessionHandlers(actions) {
    if (!supportsMediaSession()) return;

    setActionHandler("play", actions.playAudio);
    setActionHandler("pause", actions.pauseAudio);
    setActionHandler("stop", actions.pauseAudio);
    setActionHandler("previoustrack", actions.playPreviousTrack);
    setActionHandler("nexttrack", actions.playNextTrack);
}

function registerAudioElementHandlers(actions, audioElement) {
    if (!audioElement || audioElementsWithPlaybackSync.has(audioElement)) return;

    audioElementsWithPlaybackSync.add(audioElement);

    audioElement.addEventListener("play", () => {
        actions.onBrowserPlaybackStart?.();
    });
    audioElement.addEventListener("pause", () => {
        actions.onBrowserPlaybackPause?.();
    });
}

export function updateMediaSessionStatus(track) {
    if (!supportsMediaSession()) return;

    const metadata = {
        title: track.title,
        artist: "Soundscape",
        album: "Soundscape",
        artwork: [
            { src: "resources/icons/icon-96.png", sizes: "96x96", type: "image/png" },
            { src: "resources/icons/icon-128.png", sizes: "128x128", type: "image/png" },
            { src: "resources/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "resources/icons/icon-256.png", sizes: "256x256", type: "image/png" },
            { src: "resources/icons/icon-384.png", sizes: "384x384", type: "image/png" },
            { src: "resources/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
    };

    navigator.mediaSession.metadata = typeof MediaMetadata === "function"
        ? new MediaMetadata(metadata)
        : metadata;

    clearMediaSessionPositionState();
}

export function updateMediaSessionPositionState(positionState) {
    if (!supportsMediaSession() || typeof navigator.mediaSession.setPositionState !== "function") return;

    try {
        if (positionState) {
            navigator.mediaSession.setPositionState(positionState);
        } else {
            navigator.mediaSession.setPositionState({});
        }
    } catch (error) {
        console.warn("Media Session position state could not be updated.", error);
    }
}

export function updateMediaSessionPlaybackState(playbackState) {
    if (!supportsMediaSession()) return;

    navigator.mediaSession.playbackState = playbackState;
}

function setActionHandler(action, handler) {
    if (typeof handler !== "function") return;

    try {
        navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
        console.warn(`Media Session action "${action}" is not supported.`, error);
    }
}

export function configurePlaybackAudioSession() {
    if (typeof navigator === "undefined" || !("audioSession" in navigator)) return;

    try {
        navigator.audioSession.type = "playback";
    } catch (error) {
        console.warn("Audio Session playback type is not supported.", error);
    }
}

function clearMediaSessionPositionState() {
    updateMediaSessionPositionState(null);
}

function supportsMediaSession() {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
}
