import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { localCodecs, localSourceFor, localSourcesFor } from "../src/js/local-source.js";
import { tracks } from "../src/js/tracks.js";

const LOCAL_DIRS = { opus: "opus", aac: "aac" };
const SOUNDSCAPES_DIR = new URL("../src/resources/soundscapes/", import.meta.url);

test("every track has a distinct title and an existing local source", async () => {
    const titles = new Set();

    for (const track of tracks) {
        assert.equal(typeof track.title, "string");
        assert.notEqual(track.title.trim(), "");
        assert.equal(titles.has(track.title), false, `Duplicate track title: ${track.title}`);

        titles.add(track.title);

        for (const source of localSourcesFor(track)) {
            await access(new URL(`../src/${source.url}`, import.meta.url));
        }
    }
});

// Ids are the catalog's addressing scheme: ?track= links, the manifest's app
// shortcuts and the saved preference all name a soundscape by id, and
// getTrackIndexFromUrl resolves one with findIndex — first match wins, silently.
// A duplicate would make the second track unreachable by link or shortcut with
// nothing to say so, and a character outside this set would need escaping in
// exactly one of the three places it is used.
test("every track has a distinct, non-empty, URL-safe id", () => {
    const ids = new Set();

    for (const track of tracks) {
        assert.equal(typeof track.id, "string");
        assert.notEqual(track.id, "", `Track "${track.title}" has an empty id`);
        assert.match(track.id, /^[a-z0-9-]+$/, `Track id "${track.id}" is not URL-safe`);
        assert.equal(ids.has(track.id), false, `Duplicate track id: ${track.id}`);

        ids.add(track.id);
    }
});

// Every id that has ever been published, frozen.
//
// An id is an address: it is the saved preference, the `?track=` value in a
// shared link, and the manifest shortcut target. Changing one breaks all three
// silently — the link resolves to nothing and the listener lands on track 0.
//
// These were originally chosen to match the slugs the app derived from titles
// before 1.15.0, which is the only reason introducing ids broke no existing link
// and needed no manifest edit. That is history now; what matters is that they
// never move again.
//
// **Titles are deliberately absent from this test.** Renaming a soundscape must
// stay free — that is the whole point of having ids — so a test that re-derived
// these from the current titles would fail on a legitimate rename and invite
// someone to "fix" it by editing an id, causing exactly the breakage above.
const PUBLISHED_TRACK_IDS = [
    "rain",
    "garden-rain",
    "heavy-rain",
    "rain-thunder",
    "heavy-thunderstorm",
    "fireplace",
    "deep-fireplace",
    "the-open-road",
    "brown-noise",
    "pink-noise",
    "white-noise",
];

test("published track ids never change", () => {
    assert.deepEqual(
        tracks.map((track) => track.id),
        PUBLISHED_TRACK_IDS,
        "An id is an address. Add to this list for a new soundscape; never edit or reorder it.",
    );
});

// The AAC twins are checked in remote-playback-assets.test.js. They are not the
// catalog's business: a track is an id and a title, and the twin exists only
// because remote targets cannot decode Ogg Opus. The catalog names no file at
// all now — not even its local one — so there is nothing here for a remote
// consumer to reach past its resolver and read.
test("the catalog knows nothing about remote playback", () => {
    for (const track of tracks) {
        assert.deepEqual(Object.keys(track).sort(), ["id", "title"]);
    }
});

// Every local codec directory holds exactly the catalog and nothing else. An
// orphan here is a file that ships, is cached, and is referenced by nothing —
// and after a rename it is also the file that used to be the soundscape.
test("soundscape audio resources are all represented in the track catalog", async () => {
    for (const codec of localCodecs()) {
        const directory = new URL(`../src/resources/soundscapes/${LOCAL_DIRS[codec]}/`, import.meta.url);
        const resourceFiles = (await readdir(directory)).sort();
        const catalogFiles = tracks
            .map((track) => path.basename(localSourceFor(track, codec).url))
            .sort();

        assert.deepEqual(resourceFiles, catalogFiles, `${codec}/ should hold exactly the catalog`);
    }
});

// The assets moved into role directories (opus/, cast/) from a flat folder. A
// file left behind at the top level would be deployed, precached by neither list
// and referenced by nothing — and both inventory tests above look inside one
// directory each, so neither would ever see it.
test("no audio is left loose in the soundscapes directory", async () => {
    const entries = await readdir(SOUNDSCAPES_DIR, { withFileTypes: true });
    const loose = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

    assert.deepEqual(loose, []);
});
