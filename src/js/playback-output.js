/**
 * PlaybackOutput — the shape of a thing that can be producing the soundscape.
 *
 * The app has more than one. `AudioPlayer` is the local one; a remote provider
 * (Chromecast, AirPlay) is another. **Exactly one drives playback at any
 * moment** — nothing in the browser can route an AudioContext to a cast target,
 * so the two are strictly exclusive rather than mixed. That rule is not cast
 * trivia; it is the fact every playback path in the app must respect, and this
 * interface is how the core respects it without knowing what any output is.
 *
 * The goal it serves, stated once so it does not drift: the core knows there
 * *may be more than one output*, and knows nothing about what any of them are.
 *
 * ## The members, and why each earns its place
 *
 *   isPlaying()               Is sound coming out right now. Always a live
 *                             re-read of the transport, never a cached flag.
 *   wantsPlayback()           Raw intent. Nothing ANDed in.
 *   isPlaybackRequested()     Intent *and* something to play.
 *   holdsTrack(track)         Is this the soundscape this output has loaded.
 *   startTrack(track, opts)   Be on this track, playing iff opts.wasPlaying.
 *   play() / pause()          Drive the transport.
 *   canControlVolume()        Does this output's volume belong to the app.
 *   getVolume() / setVolume() Only meaningful while the above is true.
 *   canReportPosition()       Can this transport ever report a position.
 *   getMediaSessionPositionState()  The reading now, or null.
 *   failureMessage()          What to tell the user when this output fails.
 *
 * ## Three things that are deliberately NOT here
 *
 * **The provider interface.** `isSupported`, `start`, `stopWatching`, `prompt`,
 * `prepare`, `allowTransportLoad`, `isTransportReady`, `backendName` are how a
 * *remote* output is discovered, opened and torn down. They are a second,
 * remote-only contract. Keeping them out is what stops this port drifting into
 * "AudioPlayer's methods, plus whatever cast needed" — a member that exists for
 * one implementation is a branch in a costume.
 *
 * `setTrack` and `setPlaybackRequested` are on that second contract too, and
 * both were on this one until the conformance check said otherwise. Neither is
 * ever aimed at the local player. `setTrack` exists so an *idle* remote keeps a
 * current source — which is how a picker gets a header to read, and the local
 * player has no equivalent need; it would be a no-op accepted only for
 * symmetry's sake. `setPlaybackRequested` exists because a handover pushes
 * intent into the output it is handing *to*, and the local player's intent is
 * only ever set by playing or pausing it. Two members that would have been
 * carried by one implementation for the other's benefit — exactly the failure
 * this section names — caught by the check rather than by review.
 *
 * **A loading state.** Casting has no local fetch or decode: the receiver pulls
 * the file itself. The local player's loading state is reported through an
 * `onLoadingChange` callback it is constructed with, not polled through here, so
 * there is no branch for the core to take. If someone ever tries to make the
 * remotes report loading "for symmetry", this port has failed.
 *
 * **A supersession answer.** `startTrack` resolves; whether a newer track change
 * has overtaken it is not its business. The generation counter that decides that
 * is owned by the core (`currentTrackChangeId`), and asking every output to
 * reconstruct it is what would make it forgettable per-provider. The core checks
 * once, for every output. `AudioPlayer`'s own internal request guard stays — it
 * stops an older decode overwriting the active source, which is a different
 * concern from whether the caller may write OS metadata.
 *
 * ## The one invariant relating two members
 *
 *     isPlaybackRequested()  ⇒  wantsPlayback()
 *
 * `wantsPlayback()` is the raw intent; `isPlaybackRequested()` ANDs in "there is
 * something to play". On `AudioPlayer` they genuinely differ, and the difference
 * is load-bearing: a device connecting while the very first track is still
 * decoding finds nothing loaded, and a handover reading the ANDed answer would
 * take that for "the user wasn't playing" and hand the receiver silence after an
 * explicit press of play. On a remote they answer identically, because a remote
 * has no "nothing has ever loaded" state — an honest coincidence, not a
 * collapse. Keep the two callers apart; the contract suite pins the implication
 * for every implementation.
 *
 * ## On reporting
 *
 * An output must have settled its own state *before* it reports a change. The
 * core reads ownership live, so a provider that announced a connection before
 * `isConnected()` agreed would have the core read the previous owner and the
 * whole design would invert.
 */

/**
 * Every member of the port. Ordered as documented above.
 *
 * This exists so the contract can be checked rather than asserted. A registry
 * that accepts plugins should be able to reject a malformed one at the boundary,
 * where the fault is still attributable — not three interactions later when
 * something returns undefined in the middle of a handover.
 */
export const PLAYBACK_OUTPUT_MEMBERS = [
    "isPlaying",
    "wantsPlayback",
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
