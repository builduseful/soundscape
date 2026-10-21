// List of the soundscapes.
//
// `id` is the track's immutable identity: the ?track= value, the manifest
// shortcut target, the saved preference, and the resource basename under each
// role directory. It is deliberately not derived from `title`, because titles
// are editorial text that must stay renameable without breaking saved
// preferences, shared links or app shortcuts.
//
// A catalog entry is an id and a title, and nothing else. It names a soundscape;
// it does not name a file. Which file to play is a question about the consumer —
// this browser — and belongs to js/local-source.js.
//
// shared/catalog.json is the same list for every platform, and
// tests/shared-contract.test.js fails until the two agree.
export const tracks = [
    // Nature
    { id: "rain", title: "Rain" },
    { id: "garden-rain", title: "Garden Rain" },
    { id: "heavy-rain", title: "Heavy Rain" },
    { id: "rain-thunder", title: "Rain & Thunder" },
    { id: "heavy-thunderstorm", title: "Heavy Thunderstorm" },

    // Cozy
    { id: "fireplace", title: "Fireplace" },
    { id: "deep-fireplace", title: "Deep Fireplace" },

    // Ambient
    { id: "the-open-road", title: "The Open Road" },

    // Noises
    { id: "brown-noise", title: "Brown Noise" },
    { id: "pink-noise", title: "Pink Noise" },
    { id: "white-noise", title: "White Noise" },
];
