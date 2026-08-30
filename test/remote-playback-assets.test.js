import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { localSourceFor } from "../src/js/local-source.js";
import { remoteUrlFor } from "../src/js/remote-playback/track-source.js";
import { tracks } from "../src/js/tracks.js";

/**
 * The AAC twins, checked against the catalog and against the disk.
 *
 * These used to live in tracks.test.js, back when tracks.js derived `remoteUrl`
 * onto every track. They moved here with the derivation: the twins exist only
 * because remote targets cannot decode Ogg Opus, which makes them the plugin's
 * assets rather than the catalog's — and deleting src/js/remote-playback/ should
 * take this file with it and leave tracks.test.js alone.
 */

const CAST_DIR = new URL("../src/resources/soundscapes/cast/", import.meta.url);

// A receiver decodes the file itself and AirPlay cannot decode Opus, so a track
// without its AAC twin is a track that silently fails to cast — and nothing in a
// browser-free test run would otherwise notice the missing file.
test("every track ships an AAC twin for remote targets", async () => {
    for (const track of tracks) {
        const remoteUrl = remoteUrlFor(track);

        assert.equal(remoteUrl, `resources/soundscapes/cast/${track.id}.m4a`);
        await access(new URL(`../src/${remoteUrl}`, import.meta.url));
    }
});

test("cast audio has no orphans left behind by a renamed soundscape", async () => {
    const castFiles = (await readdir(CAST_DIR))
        .filter((fileName) => fileName.endsWith(".m4a"))
        .sort();
    const catalogCastFiles = tracks
        .map((track) => path.basename(remoteUrlFor(track)))
        .sort();

    assert.deepEqual(castFiles, catalogCastFiles);
});

// Chromium refuses to *remote* media of 15 seconds or less
// (kMinRemotingMediaDurationInSec), which is why the twins are built by
// repeating the loop period past two minutes. A twin short enough to trip that
// would fail to cast on desktop Chrome with no visible cause — the picker would
// simply list nothing — so the file size is a cheap proxy worth asserting.
test("no twin is small enough to be refused as too short to remote", async () => {
    const { stat } = await import("node:fs/promises");

    for (const track of tracks) {
        const { size } = await stat(new URL(`../src/${remoteUrlFor(track)}`, import.meta.url));

        // ~64 kbit/s AAC over 15 s is ~120 kB; anything at or under that is
        // certainly too short. Deliberately loose: this is a floor, not a spec.
        assert.ok(size > 120_000, `${remoteUrlFor(track)} is suspiciously short for a cast twin.`);
    }
});

// Nothing may hand a receiver the Opus original: Safari could not decode Ogg
// Opus at all before 18.4, and desktop remoting only carries Opus if the sink
// advertises it.
//
// The cast/ directory check is the half that survives a local fallback. Once a
// local .m4a exists, "not the local file" stops being a statement about the
// extension and becomes one about the directory: the two are different products
// — one loop period against a repeated programme with the crossfade baked in —
// and a receiver handed the local twin would seek audibly on every wrap.
test("remoteUrlFor never answers with the local source", () => {
    for (const track of tracks) {
        const remoteUrl = remoteUrlFor(track);

        assert.notEqual(remoteUrl, localSourceFor(track).url);
        assert.doesNotMatch(remoteUrl, /\.opus$/u);
        assert.ok(remoteUrl.startsWith("resources/soundscapes/cast/"));
    }
});

test("remoteUrlFor answers null rather than guessing when there is no track", () => {
    assert.equal(remoteUrlFor(null), null);
    assert.equal(remoteUrlFor(undefined), null);
    assert.equal(remoteUrlFor({}), null);
    assert.equal(remoteUrlFor({ title: "Rain" }), null);
});
