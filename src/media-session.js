const audioElementsWithPlaybackSync = new WeakSet();

export function initMediaSession(track, actions, audioElement) {
    updateMediaSessionStatus(track);
    registerMediaSessionHandlers(actions);
    registerAudioElementHandlers(actions, audioElement);
}

function registerMediaSessionHandlers(actions) {
    if (!supportsMediaSession()) return;

    setActionHandler("play", actions.playAudio);
    setActionHandler("pause", actions.pauseAudio);
    setActionHandler("previoustrack", actions.playPreviousTrack);
    setActionHandler("nexttrack", actions.playNextTrack);
}

function registerAudioElementHandlers(actions, audioElement) {
    if (!audioElement || audioElementsWithPlaybackSync.has(audioElement)) return;

    audioElementsWithPlaybackSync.add(audioElement);

    audioElement.addEventListener("play", () => {
        actions.onPlaybackStart?.();
    });
    audioElement.addEventListener("pause", () => {
        actions.onPlaybackPause?.();
    });
}

export function updateMediaSessionStatus(track) {
    if (!supportsMediaSession()) return;

    const metadata = {
        title: track.title,
        artist: "Soundscape",
        album: "Nature",
    };

    navigator.mediaSession.metadata = typeof MediaMetadata === "function"
        ? new MediaMetadata(metadata)
        : metadata;

    clearMediaSessionPositionState();
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
    if (!supportsMediaSession() || typeof navigator.mediaSession.setPositionState !== "function") return;

    try {
        navigator.mediaSession.setPositionState({});
    } catch (error) {
        console.warn("Media Session position state could not be cleared.", error);
    }
}

function supportsMediaSession() {
    return typeof navigator !== "undefined" && "mediaSession" in navigator;
}
