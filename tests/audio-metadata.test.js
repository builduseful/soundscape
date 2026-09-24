import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const SOUNDSCAPES_DIR = new URL("../src/resources/soundscapes/", import.meta.url);

// Encoders copy tags from their input, so a master tagged with someone's name
// ships that name in src/ — one did, until this test. Only the encoder's own
// stamp is allowed through; anything else means an encode skipped
// -map_metadata -1.
async function audioFiles(extension) {
    const files = [];

    for (const directory of await readdir(SOUNDSCAPES_DIR)) {
        const url = new URL(`${directory}/`, SOUNDSCAPES_DIR);

        for (const name of await readdir(url)) {
            if (name.endsWith(extension)) files.push({ label: `${directory}/${name}`, url: new URL(name, url) });
        }
    }

    return files;
}

// The OpusTags packet is the second packet of the stream (RFC 7845 §5.2).
function opusComments(bytes) {
    const packet = bytes.indexOf("OpusTags");

    assert.notEqual(packet, -1, "no OpusTags packet");

    let offset = packet + 8;
    offset += 4 + bytes.readUInt32LE(offset);

    const count = bytes.readUInt32LE(offset);
    const comments = [];

    offset += 4;

    for (let index = 0; index < count; index++) {
        const length = bytes.readUInt32LE(offset);

        comments.push(bytes.toString("utf8", offset + 4, offset + 4 + length));
        offset += 4 + length;
    }

    return comments;
}

// The atom types directly inside every ilst (iTunes metadata list) atom.
function mp4MetadataKeys(bytes) {
    const keys = [];

    for (let at = bytes.indexOf("ilst"); at !== -1; at = bytes.indexOf("ilst", at + 4)) {
        const end = at - 4 + bytes.readUInt32BE(at - 4);

        for (let child = at + 4; child < end; child += bytes.readUInt32BE(child)) {
            keys.push(bytes.toString("latin1", child + 4, child + 8));
        }
    }

    return keys;
}

test("shipped Opus carries no tags beyond the encoder's", async () => {
    for (const { label, url } of await audioFiles(".opus")) {
        const extra = opusComments(await readFile(url)).filter((comment) => !comment.startsWith("encoder="));

        assert.deepEqual(extra, [], `${label} carries metadata tags`);
    }
});

test("shipped MP4 audio carries no tags beyond the encoder's", async () => {
    for (const { label, url } of await audioFiles(".m4a")) {
        const extra = mp4MetadataKeys(await readFile(url)).filter((key) => key !== "©too");

        assert.deepEqual(extra, [], `${label} carries metadata tags`);
    }
});
