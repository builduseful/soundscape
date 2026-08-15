/**
 * Which file a remote target should play.
 *
 * Every soundscape ships an AAC twin beside its Opus original, same basename,
 * built by `scripts/build-cast-audio.mjs`. Deriving the name rather than listing
 * it keeps the catalog to one line per track and makes the two impossible to
 * mismatch; a test checks every twin exists on disk.
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
 * Deliberately returns no MIME type to pair with it. `track.mime` feeds
 * `canPlayType()` on the local element, which answers for *this* browser — and
 * this browser is not what decodes the twin, so the answer would be
 * irrelevant. Providers that need one state it themselves, because it is a fact
 * about the receiver they are talking to.
 */
export function remoteUrlFor(track) {
    if (!track?.url) return null;

    return track.url.replace(/\.opus$/u, ".m4a");
}
