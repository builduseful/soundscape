/**
 * Which file a remote target should play.
 *
 * Every soundscape ships an AAC twin under `resources/soundscapes/cast/`, named
 * for the track id, built by `scripts/build-audio.mjs --cast`. Deriving the name
 * from the id rather than listing it keeps the catalog to one line per track and
 * makes the two impossible to mismatch; a test checks every twin exists on disk.
 *
 * The twin is derived from the *id*, never from the local file. Those are no
 * longer the same thing: the local source is itself chosen per browser, so
 * deriving from it would make the cast asset depend on what the sending browser
 * happened to be able to decode — and on a browser using a fallback encoding it
 * would name a file that does not exist.
 *
 * It lives here rather than in tracks.js so the catalog carries no remote-only
 * fact — delete this directory and tracks.js is untouched.
 *
 * ## Why AAC in MP4, and never the Opus original
 *
 * Safari could not decode Ogg Opus at all before 18.4, and Chrome's desktop
 * remoting only carries Opus if the sink advertises it. AAC in MP4 is the one
 * format every path accepts, and one shared format keeps a single code path for
 * every backend rather than per-platform codec selection.
 */

/**
 * The URL a remote target should be handed for `track`.
 *
 * Deliberately returns no MIME type to pair with it. The local source's MIME
 * feeds `canPlayType()` on the local element, which answers for *this* browser — and
 * this browser is not what decodes the twin, so the answer would be
 * irrelevant. Providers that need one state it themselves, because it is a fact
 * about the receiver they are talking to.
 */
export function remoteUrlFor(track) {
    if (!track?.id) return null;

    return `resources/soundscapes/cast/${track.id}.m4a`;
}
