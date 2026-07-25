import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { tracks } from "../src/js/tracks.js";

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

test("soundscape audio resources are all represented in the track catalog", async () => {
    const resourceFiles = (await readdir(SOUNDSCAPES_DIR))
        .filter((fileName) => fileName.endsWith(".opus"))
        .sort();
    const catalogFiles = tracks
        .map((track) => path.basename(track.url))
        .sort();

    assert.deepEqual(resourceFiles, catalogFiles);
});
