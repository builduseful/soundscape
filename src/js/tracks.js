// List of the soundscapes
const OGG_OPUS_MIME = "audio/ogg; codecs=opus";

// Each track ships an AAC twin for cast targets, same basename, built by
// scripts/build-cast-audio.mjs. Deriving the name rather than listing it keeps
// the catalog to one line per track and the two files impossible to mismatch;
// tracks.test.js checks every twin exists.
//
// Deliberately no cast MIME to match `mime`. That one feeds canPlayType() on
// the local element, which answers for this browser — and the browser is not
// what decodes a cast file, so the answer would be irrelevant.
function withCastSource(track) {
    return {
        ...track,
        castUrl: track.url.replace(/\.opus$/u, ".m4a"),
    };
}

export const tracks = [
    // Nature
    { title: "Rain", url: "resources/soundscapes/rain_loopable.opus", mime: OGG_OPUS_MIME },
    { title: "Garden Rain", url: "resources/soundscapes/rain_garden_loopable.opus", mime: OGG_OPUS_MIME },
    { title: "Heavy Rain", url: "resources/soundscapes/rain-from-room-loop-smallest.opus", mime: OGG_OPUS_MIME },
    { title: "Rain & Thunder", url: "resources/soundscapes/rain_thunder_storm_loopable.opus", mime: OGG_OPUS_MIME },
    { title: "Heavy Thunderstorm", url: "resources/soundscapes/rain-and-thunder-loop.opus", mime: OGG_OPUS_MIME },

    // Cozy
    { title: "Fireplace", url: "resources/soundscapes/fireplace_crackle_loopable.opus", mime: OGG_OPUS_MIME },
    { title: "Deep Fireplace", url: "resources/soundscapes/fireplace_low_rumble_loopable.opus", mime: OGG_OPUS_MIME },

    // Ambient
    { title: "The Open Road", url: "resources/soundscapes/open-road-loop.opus", mime: OGG_OPUS_MIME },

    // Noises
    { title: "Brown Noise", url: "resources/soundscapes/brown-noise-loop.opus", mime: OGG_OPUS_MIME },
    { title: "Pink Noise", url: "resources/soundscapes/pink-noise-loop.opus", mime: OGG_OPUS_MIME },
    { title: "White Noise", url: "resources/soundscapes/white-noise-loop.opus", mime: OGG_OPUS_MIME },
].map(withCastSource);

// URL-safe identifier derived from the title ("Rain & Thunder" → "rain-thunder").
// Used by the ?track= query param and the manifest app shortcuts.
export function trackSlug(track) {
    return track.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
