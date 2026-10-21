/**
 * The PlaybackOutput contract, run against every output.
 *
 * Today that is one, `AudioPlayer`. The list below is where a second output — a
 * cast plugin, if one comes back — joins, and a case the local player had to be
 * excused from would be a case that does not belong in the port.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { AudioPlayer } from "../src/js/audio-player.js";
import { missingPlaybackOutputMembers } from "../src/js/playback-output.js";

// Deliberately no URL of any kind on the track: a fixture carrying one would let
// an output read it instead of deriving its own source from the id, and still
// pass. A catalog entry carries no URL either, which is the point.
const TRACK = {
    id: "rain",
    title: "Rain",
};

/** As much of a media element as an idle player touches. */
function createFakeMediaElement() {
    return {
        paused: true,
        canPlayType: () => "probably",
        addEventListener() {},
        removeEventListener() {},
    };
}

// ---------------------------------------------------------------------------
// The PlaybackOutput contract — every output, local included
// ---------------------------------------------------------------------------
//
// The cases below hold for *any* output. None of them needs an AudioContext:
// `AudioPlayer` creates one lazily, on the playback path, so a freshly
// constructed one is cheap and inert.

const outputs = [
    {
        name: "AudioPlayer (local)",
        create: () => new AudioPlayer(createFakeMediaElement()),
    },
];

for (const { name, create } of outputs) {
    describe(`PlaybackOutput: ${name}`, () => {
        test("implements every member of the port", () => {
            assert.deepEqual(missingPlaybackOutputMembers(create()), []);
        });

        test("starts idle, holding nothing", () => {
            const output = create();

            assert.equal(output.isPlaying(), false);
            assert.equal(output.isPlaybackRequested(), false);
            assert.equal(output.holdsTrack(TRACK), false);
        });

        test("holdsTrack answers for itself rather than exposing a URL scheme", () => {
            const output = create();

            assert.equal(output.holdsTrack(TRACK), false);
            assert.equal(output.holdsTrack(null), false);
            assert.equal(output.holdsTrack(undefined), false);
        });

        // Two different facts: whether a reading exists now, and whether this
        // transport can ever produce one. The polling timer needs the second.
        test("reports position capability as a constant, and null when it has none", () => {
            const output = create();
            const capable = output.canReportPosition();

            assert.equal(typeof capable, "boolean");
            assert.equal(output.canReportPosition(), capable, "capability changed between reads");

            if (!capable) {
                assert.equal(output.getMediaSessionPositionState(), null);
            }
        });

        test("setVolume is a no-op rather than a throw when volume is not its own", () => {
            const output = create();

            if (output.canControlVolume()) {
                output.setVolume(0.5);
                assert.equal(output.getVolume(), 0.5);
                return;
            }

            // Must not throw: the core calls this without asking first on the
            // paths where the slider is simply absent.
            output.setVolume(0.5);
            assert.equal(output.canControlVolume(), false);
        });

        test("failureMessage is a sentence or nothing, never undefined", () => {
            const message = create().failureMessage();

            assert.ok(
                message === null || (typeof message === "string" && message.length > 0),
                `failureMessage() returned ${JSON.stringify(message)}`,
            );
        });
    });
}
