import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { tracks, trackSlug } from "../src/js/tracks.js";

const SOUNDSCAPES_DIR = new URL("../src/resources/soundscapes/", import.meta.url);
const OGG_OPUS_MIME = "audio/ogg; codecs=opus";

test("track catalog points at existing unique Opus resources", async () => {
    const titles = new Set();
    const urls = new Set();

    for (const track of tracks) {
        assert.equal(typeof track.title, "string");
        assert.notEqual(track.title.trim(), "");
        assert.equal(track.mime, OGG_OPUS_MIME);
        assert.match(track.url, /^resources\/soundscapes\/.+\.opus$/);
        assert.equal(titles.has(track.title), false, `Duplicate track title: ${track.title}`);
        assert.equal(urls.has(track.url), false, `Duplicate track URL: ${track.url}`);

        titles.add(track.title);
        urls.add(track.url);
        await access(new URL(`../src/${track.url}`, import.meta.url));
    }
});

// Slugs are the catalog's addressing scheme: ?track= links and the manifest's
// app shortcuts name a soundscape by slug, and getTrackIndexFromUrl resolves one
// with findIndex — first match wins, silently. Unique titles are not enough,
// because trackSlug strips punctuation: "Rain & Thunder" and "Rain Thunder" are
// two distinct titles that both become "rain-thunder", and the second would be
// unreachable by link or shortcut with nothing to say so.
test("every track has a distinct, non-empty slug", () => {
    const slugs = new Set();

    for (const track of tracks) {
        const slug = trackSlug(track);

        assert.notEqual(slug, "", `Track "${track.title}" has an empty slug`);
        assert.equal(slugs.has(slug), false, `Duplicate track slug: ${slug}`);

        slugs.add(slug);
    }
});

// The AAC twins are checked in remote-playback-assets.test.js. They are not the
// catalog's business: a track is a title, a URL and a MIME type, and the twin
// exists only because remote targets cannot decode Ogg Opus.
test("the catalog knows nothing about remote playback", () => {
    for (const track of tracks) {
        assert.deepEqual(Object.keys(track).sort(), ["mime", "title", "url"]);
    }
});

test("soundscape audio resources are all represented in the track catalog", async () => {
    const resourceFiles = (await readdir(SOUNDSCAPES_DIR))
        .filter((fileName) => fileName.endsWith(".opus"))
        .sort();
    const catalogFiles = tracks
        .map((track) => path.basename(track.url))
        .sort();

    assert.deepEqual(resourceFiles, catalogFiles);
});
