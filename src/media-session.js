export async function initMediaSession(track, actions, audioElement) {
    await actions.playAudio();

    updateMediaSessionStatus(track);
    registerMediaSessionHandlers(actions);
    registerAudioElementHandlers(actions, audioElement);
}

function registerMediaSessionHandlers(actions) {
    navigator.mediaSession.setActionHandler("play", async () => {
        console.log("mediaSession - play");
        await actions.playAudio();
    });
    navigator.mediaSession.setActionHandler("pause", async () => {
        console.log("mediaSession - pause");
        await actions.pauseAudio();
    });
    navigator.mediaSession.setActionHandler("previoustrack", async () => {
        console.log("mediaSession - previoustrack");
        await actions.playPreviousTrack();
    });
    navigator.mediaSession.setActionHandler("nexttrack", async () => {
        console.log("mediaSession - nexttrack");
        await actions.playNextTrack();
    });
    navigator.mediaSession.setActionHandler("stop", async () => {
        console.log("mediaSession - stop");
        await actions.initMediaSession();
        await actions.pauseAudio();
    });
}

function registerAudioElementHandlers(actions, audioElement) {
    // Sometimes the mediaSession events don't fire, this is backup
    audioElement.addEventListener("play", async () => {
        console.log("audioElement - play");
        await actions.playAudio();
    });
    audioElement.addEventListener("pause", async () => {
        console.log("audioElement - pause");
        await actions.pauseAudio();
    });
}

export function updateMediaSessionStatus(track) {
    navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: "Soundscape",
        album: "Nature",
        artwork: [
            { src: track.image, sizes: "1024x1024", type: "image/jpeg" },
        ]
    });
}
