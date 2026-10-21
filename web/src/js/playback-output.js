/**
 * PlaybackOutput — the shape of a thing that can be producing the soundscape.
 *
 * Today there is one: `AudioPlayer`. The port is kept anyway, and the core
 * reaches the player only through `activeOutput()` in `script.js`, because a
 * second output has existed before — Chromecast and AirPlay, removed from the
 * web app with the tag js/AGENTS.md names — and keeping the seam is what lets
 * one come back as a plugin rather than as a rewrite of the core. If one does,
 * **exactly one output drives playback at any moment**: nothing in the browser
 * can route an AudioContext to a cast target, so outputs are exclusive, never
 * mixed.
 *
 * ## The members
 *
 *   isPlaying()               Is sound coming out right now. Always a live
 *                             re-read of the transport, never a cached flag.
 *   isPlaybackRequested()     Intent *and* something to play.
 *   holdsTrack(track)         Is this the soundscape this output has loaded.
 *   startTrack(track, opts)   Be on this track, playing iff opts.wasPlaying.
 *   play() / pause()          Drive the transport.
 *   canControlVolume()        Does this output's volume belong to the app.
 *   getVolume() / setVolume() Only meaningful while the above is true.
 *   canReportPosition()       Can this transport ever report a position.
 *   getMediaSessionPositionState()  The reading now, or null.
 *   failureMessage()          What to tell the user when this output fails,
 *                             or null for the app's own wording.
 *
 * ## Two things that are deliberately NOT here
 *
 * **A loading state.** The local player reports loading through the
 * `onLoadingChange` callback it is constructed with, not through this port, so
 * an output that has nothing to fetch need not pretend to.
 *
 * **A supersession answer.** `startTrack` resolves; whether a newer track change
 * has overtaken it is not its business. The generation counter that decides that
 * is owned by the core (`currentTrackChangeId`) and checked once, for every
 * output. `AudioPlayer`'s own internal request guard stays — it stops an older
 * decode overwriting the active source, which is a different concern from
 * whether the caller may write OS metadata.
 *
 * ## On reporting
 *
 * An output must have settled its own state *before* it reports a change. The
 * core reads state live, so an output that announced a change before its own
 * getters agreed would have the core read the previous state.
 */

/**
 * Every member of the port. Ordered as documented above.
 *
 * This exists so the contract can be checked rather than asserted. A registry
 * that accepts plugins should be able to reject a malformed one at the boundary,
 * where the fault is still attributable — not three interactions later when
 * something returns undefined mid-playback.
 */
export const PLAYBACK_OUTPUT_MEMBERS = [
    "isPlaying",
    "isPlaybackRequested",
    "holdsTrack",
    "startTrack",
    "play",
    "pause",
    "canControlVolume",
    "getVolume",
    "setVolume",
    "canReportPosition",
    "getMediaSessionPositionState",
    "failureMessage",
];

/** Which port members `candidate` is missing. Empty means it conforms. */
export function missingPlaybackOutputMembers(candidate) {
    if (!candidate) return [...PLAYBACK_OUTPUT_MEMBERS];

    return PLAYBACK_OUTPUT_MEMBERS.filter((member) => typeof candidate[member] !== "function");
}

/** Whether `candidate` can be used as a PlaybackOutput at all. */
export function implementsPlaybackOutput(candidate) {
    return missingPlaybackOutputMembers(candidate).length === 0;
}
