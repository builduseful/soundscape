import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { test } from "node:test";

import {
    createLocalSourceResolver,
    localCodecs,
    localSourceFor,
    localSourcesFor,
    selectLocalCodec,
} from "../src/js/local-source.js";
import { remoteUrlFor } from "../src/js/remote-playback/track-source.js";
import { tracks } from "../src/js/tracks.js";

/**
 * The local resolver: which file *this browser* plays for a soundscape.
 *
 * Its counterpart is remote-playback/track-source.js, and the pair is the whole
 * reason the catalog names no files. These tests hold the two apart.
 */

test("every track resolves to an existing file in every local codec", async () => {
    for (const track of tracks) {
        assert.deepEqual(
            localSourcesFor(track).map((source) => source.codec),
            localCodecs(),
            "every codec should resolve",
        );

        for (const source of localSourcesFor(track)) {
            await access(new URL(`../src/${source.url}`, import.meta.url));
        }
    }
});

test("each codec names its own directory, extension and MIME type", () => {
    const track = { id: "rain", title: "Rain" };

    assert.deepEqual(localSourceFor(track, "opus"), {
        url: "resources/soundscapes/opus/rain.opus",
        mime: "audio/ogg; codecs=opus",
    });
    assert.deepEqual(localSourceFor(track, "aac"), {
        url: "resources/soundscapes/aac/rain.m4a",
        mime: "audio/mp4; codecs=mp4a.40.2",
    });
    assert.throws(() => localSourceFor(track, "flac"), /Unknown local codec/u);
});

// The probe is a preference, not a verdict: canPlayType() describes the media
// element, and the audible path is decodeAudioData(), which accepts formats some
// browsers decline to report on. So "nothing reported playable" must still yield
// the primary and let the decode decide, rather than muting the app before a
// byte is fetched.
test("the codec probe prefers Opus and falls back rather than refusing", () => {
    const element = (answers) => ({ canPlayType: (mime) => answers[mime] ?? "" });

    assert.equal(selectLocalCodec(element({ "audio/ogg; codecs=opus": "probably" })), "opus");
    assert.equal(selectLocalCodec(element({ "audio/mp4; codecs=mp4a.40.2": "probably" })), "aac");
    assert.equal(selectLocalCodec(element({})), "opus", "an element that reports nothing still gets the primary");
    assert.equal(selectLocalCodec({}), "opus", "an element that cannot answer is not one that refuses");
});

test("an explicit override wins over the probe, and nonsense does not", () => {
    const opusOnly = { canPlayType: (mime) => (mime.includes("opus") ? "probably" : "") };

    assert.equal(selectLocalCodec(opusOnly, "aac"), "aac");
    assert.equal(selectLocalCodec(opusOnly, "flac"), "opus", "an unknown override is ignored, not obeyed");
});

// The resolver's answer is fixed for the page except for one downgrade, which is
// safe only because identity is the track id and the buffer cache is keyed by
// resolved URL. See the module comment.
test("a resolver downgrades once and then holds", () => {
    const anything = { canPlayType: () => "probably" };
    const resolve = createLocalSourceResolver(anything);
    const track = { id: "rain", title: "Rain" };

    assert.equal(resolve.codec(), "opus");
    assert.equal(resolve(track).url, "resources/soundscapes/opus/rain.opus");

    assert.equal(resolve.downgrade(), true);
    assert.equal(resolve.codec(), "aac");
    assert.equal(resolve(track).url, "resources/soundscapes/aac/rain.m4a");

    // Nothing left to try: the caller must not retry forever.
    assert.equal(resolve.downgrade(), false);
    assert.equal(resolve.codec(), "aac");
});

test("a resolver with nowhere to downgrade to says so", () => {
    const opusOnly = { canPlayType: (mime) => (mime.includes("opus") ? "probably" : "") };
    const resolve = createLocalSourceResolver(opusOnly);

    assert.equal(resolve.downgrade(), false, "never downgrade to a format the element refuses");
    assert.equal(resolve.codec(), "opus");
});

// The URL is derived from the id and nothing else. Deriving it from the title
// would put editorial text in a file path, which is the coupling ids exist to
// break; deriving it from a previous resolution would let one browser's codec
// choice decide another's.
test("the local source is derived from the id alone", () => {
    const source = localSourceFor({ id: "made-up", title: "Anything At All" });

    assert.equal(source.url, "resources/soundscapes/opus/made-up.opus");
});

test("localSourceFor answers null rather than guessing when there is no track", () => {
    assert.equal(localSourceFor(null), null);
    assert.equal(localSourceFor(undefined), null);
    assert.equal(localSourceFor({}), null);
    assert.equal(localSourceFor({ title: "Rain" }), null);
});

// The two resolvers answer the same question for different consumers and must
// never converge. A local file handed to a receiver wraps audibly (no baked
// crossfade, one loop period); a cast file played locally is two minutes of
// repeats the app would loop at the wrong point.
test("the local and remote resolvers never name the same file", () => {
    for (const track of tracks) {
        for (const source of localSourcesFor(track)) {
            assert.notEqual(source.url, remoteUrlFor(track));
        }
    }
});

// Both are .m4a, which is exactly why the directory is the boundary and the
// extension is not. The local one is a single loop period the app crossfades at
// runtime; the cast one is two minutes of repeats with the crossfade already
// baked in. Swapping them is silent — same container, same codec — and wrong in
// both directions.
test("the local AAC fallback is not the cast twin", () => {
    for (const track of tracks) {
        const fallback = localSourceFor(track, "aac");

        assert.equal(fallback.url, `resources/soundscapes/aac/${track.id}.m4a`);
        assert.notEqual(fallback.url, remoteUrlFor(track));
        assert.ok(fallback.url.startsWith("resources/soundscapes/aac/"));
    }
});
