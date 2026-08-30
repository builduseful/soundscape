/**
 * Which file this browser should play for a soundscape.
 *
 * The catalog names a soundscape; it does not name a file. That separation
 * exists because one track has several local encodings — an Ogg Opus primary
 * and an AAC fallback — and choosing between them is a fact about the
 * *browser*, not about the soundscape.
 *
 * The mirror of this module is remote-playback/track-source.js, which answers
 * the same question for a cast receiver. Neither may answer for the other: a
 * local fallback and a cast asset are different products, built differently
 * (see scripts/build-audio.mjs), and handed to different consumers.
 */

/**
 * The local encodings, in preference order.
 *
 * Opus first because it is the smaller file at equal quality and the published
 * primary. AAC exists for Safari and iOS before 18.4, which cannot read the
 * *Ogg* container at all — a container limitation rather than a codec one,
 * which is why the fallback is a different encoding of the same loop period
 * rather than a different soundscape.
 */
const CODECS = {
    opus: { directory: "opus", extension: "opus", mime: "audio/ogg; codecs=opus" },
    aac: { directory: "aac", extension: "m4a", mime: "audio/mp4; codecs=mp4a.40.2" },
};

const PREFERENCE_ORDER = ["opus", "aac"];

/**
 * The local source for `track` in `codec`, as a `{ url, mime }` pair.
 *
 * `mime` travels with the URL rather than with the track because it describes
 * the file that was chosen, and it feeds `canPlayType()` on the local element —
 * a question about this browser, which is the same question that picked the
 * file.
 */
export function localSourceFor(track, codec = "opus") {
    if (!track?.id) return null;

    const encoding = CODECS[codec];

    if (!encoding) throw new Error(`Unknown local codec: ${codec}`);

    return {
        url: `resources/soundscapes/${encoding.directory}/${track.id}.${encoding.extension}`,
        mime: encoding.mime,
    };
}

/** Every codec's source for `track`. Used by the asset inventory tests. */
export function localSourcesFor(track) {
    return PREFERENCE_ORDER.map((codec) => ({ codec, ...localSourceFor(track, codec) }));
}

export function localCodecs() {
    return [...PREFERENCE_ORDER];
}

function canPlay(audioElement, mime) {
    // A media element that cannot answer is not a media element that refuses.
    // Treating an absent canPlayType as "no" would fail every codec and mute the
    // app before a byte was fetched.
    if (typeof audioElement?.canPlayType !== "function") return true;

    return audioElement.canPlayType(mime) !== "";
}

/**
 * Which encoding this browser gets, decided once.
 *
 * `canPlayType()` is only a capability hint — the audible path is
 * `decodeAudioData()`, which accepts codecs some browsers decline to report on
 * the media element — so this is a preference, not a verdict. The verdict comes
 * from the decode, and `createLocalSourceResolver` handles it being wrong.
 */
export function selectLocalCodec(audioElement, override) {
    if (override && CODECS[override]) return override;

    const playable = PREFERENCE_ORDER.find((codec) => canPlay(audioElement, CODECS[codec].mime));

    // Nothing reported playable is not the same as nothing being playable, for
    // the reason above. Fall back to the primary and let the decode decide.
    return playable ?? PREFERENCE_ORDER[0];
}

/**
 * A resolver bound to one browser's answer.
 *
 * The answer is fixed for the page's lifetime with exactly one exception: a
 * confirmed *decode* failure downgrades it, once. Those two rules look like they
 * conflict and do not, because of two facts established elsewhere:
 *
 * - `AudioPlayer` keys its buffer cache by resolved URL, so the pre- and
 *   post-downgrade encodings occupy separate entries and neither is ever served
 *   for the other.
 * - `holdsTrack()` compares the track id, so re-resolving a track to a different
 *   encoding leaves it the same track, and identity, handover and the media
 *   session cannot desynchronise.
 *
 * Without both of those the downgrade would be a bug. With them it is one extra
 * fetch, once, on a browser that was about to play nothing at all.
 */
export function createLocalSourceResolver(audioElement, { override } = {}) {
    let codec = selectLocalCodec(audioElement, override);

    const resolve = (track) => localSourceFor(track, codec);

    resolve.codec = () => codec;

    /**
     * Step down after a decode failure. Answers whether anything changed, so the
     * caller retries only when there is something new to try.
     */
    resolve.downgrade = () => {
        const next = PREFERENCE_ORDER
            .slice(PREFERENCE_ORDER.indexOf(codec) + 1)
            .find((candidate) => canPlay(audioElement, CODECS[candidate].mime));

        if (!next) return false;

        console.warn(`Could not decode ${codec}; falling back to ${next} for this session.`);
        codec = next;

        return true;
    };

    return resolve;
}
