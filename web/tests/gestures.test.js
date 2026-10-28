import assert from "node:assert/strict";
import { test } from "node:test";

import { createGestureTracker, SWIPE_MIN_PX, SWIPE_PROJECTION_MS, TAP_MAX_MS, TAP_SLOP_PX, VOLUME_TRAVEL_PX } from "../src/js/gestures.js";

function track() {
    const calls = [];
    const presses = [];
    const tracker = createGestureTracker({
        onPress: () => presses.push("press"),
        onRelease: () => presses.push("release"),
        onTap: () => calls.push("tap"),
        onSwipeMove: (dx) => calls.push(`across ${dx}`),
        onSwipe: (direction) => calls.push(`swipe ${direction}`),
        onSwipeCancel: () => calls.push("swipe cancelled"),
        onVolumeStart: () => calls.push("volume start"),
        onVolumeChange: (change) => calls.push(`volume ${change.toFixed(2)}`),
        onVolumeEnd: () => calls.push("volume end"),
        onVolumeCancel: () => calls.push("volume cancelled"),
    });

    return { calls, presses, tracker };
}

// The page sinks in at the touch, not once the finger has moved far enough
// to say what it is doing, and comes back however the gesture ends.
test("a press is felt as the finger touches, and let go as it lifts", () => {
    const { calls, presses, tracker } = track();

    tracker.down(100, 100, 0);
    assert.deepEqual(presses, ["press"]);
    assert.deepEqual(calls, []);

    tracker.move(100 - SWIPE_MIN_PX, 100, 100);
    tracker.up(100 - SWIPE_MIN_PX, 100, 100);
    tracker.down(100, 100, 1000);
    tracker.up(100, 100, 1000 + TAP_MAX_MS + 1);
    tracker.down(100, 100, 2000);
    tracker.move(100, 100 - VOLUME_TRAVEL_PX / 2, 2100);
    tracker.cancel();

    assert.deepEqual(presses, ["press", "release", "press", "release", "press", "release"]);
});

test("a quick press that barely moves is a tap", () => {
    const { calls, tracker } = track();

    tracker.down(100, 100, 0);
    tracker.move(100 + TAP_SLOP_PX, 100, 100);
    tracker.up(100 + TAP_SLOP_PX, 100, TAP_MAX_MS);

    assert.deepEqual(calls, ["tap"]);
});

// A finger resting on the screen and lifted is not asking for anything.
test("a press held past the tap time does nothing", () => {
    const { calls, tracker } = track();

    tracker.down(100, 100, 0);
    tracker.up(100, 100, TAP_MAX_MS + 1);

    assert.deepEqual(calls, []);
});

test("a swipe left is next and a swipe right is previous, as pages turn", () => {
    const { calls, tracker } = track();

    tracker.down(200, 100, 0);
    tracker.move(200 - SWIPE_MIN_PX, 104, 150);
    tracker.up(200 - SWIPE_MIN_PX, 104, 150);
    tracker.down(200, 100, 1000);
    tracker.move(200 + SWIPE_MIN_PX, 96, 1150);
    tracker.up(200 + SWIPE_MIN_PX, 96, 1150);

    assert.deepEqual(calls, [`across ${-SWIPE_MIN_PX}`, "swipe next", `across ${SWIPE_MIN_PX}`, "swipe previous"]);
});

// Judged by where the finger was heading as it let go, so a quick flick needs
// little distance.
test("a quick flick changes soundscape though it is short", () => {
    const { calls, tracker } = track();

    tracker.down(200, 100, 0);
    tracker.move(185, 100, 20);
    tracker.move(180, 100, 40);
    tracker.up(180, 100, 40);

    assert.ok(Math.abs(-20 + -0.5 * SWIPE_PROJECTION_MS) >= SWIPE_MIN_PX);
    assert.deepEqual(calls, ["across -15", "across -20", "swipe next"]);
});

// Someone who drags across and then back has changed their mind.
test("a swipe that turns back as it is let go is cancelled, however far it got", () => {
    const { calls, tracker } = track();

    tracker.down(200, 100, 0);
    tracker.move(100, 100, 200);
    tracker.move(140, 100, 260);
    tracker.up(140, 100, 260);

    assert.deepEqual(calls, ["across -100", "across -60", "swipe cancelled"]);
});

// Past the slop but short of a swipe: a hesitation, not a request. What
// followed the finger goes back.
test("a short sideways movement is cancelled, and is not a tap", () => {
    const { calls, tracker } = track();

    tracker.down(200, 100, 0);
    tracker.move(200 - SWIPE_MIN_PX + 1, 100, 100);
    tracker.up(200 - SWIPE_MIN_PX + 1, 100, 100);

    assert.deepEqual(calls, [`across ${-SWIPE_MIN_PX + 1}`, "swipe cancelled"]);
});

test("a drag up is louder, a drag down quieter, measured from where it began", () => {
    const { calls, tracker } = track();

    tracker.down(100, 300, 0);
    tracker.move(100, 300 - VOLUME_TRAVEL_PX / 2, 200);
    tracker.move(100, 300 + VOLUME_TRAVEL_PX / 4, 400);
    tracker.up(100, 300 + VOLUME_TRAVEL_PX / 4, 600);

    assert.deepEqual(calls, ["volume start", "volume 0.50", "volume -0.25", "volume end"]);
});

// The first movement decides: setting the volume never turns into a swipe.
test("a volume drag that wanders sideways stays a volume drag", () => {
    const { calls, tracker } = track();

    tracker.down(100, 300, 0);
    tracker.move(100, 300 - 2 * TAP_SLOP_PX, 100);
    tracker.move(100 - 3 * SWIPE_MIN_PX, 300 - 2 * TAP_SLOP_PX, 200);
    tracker.up(100 - 3 * SWIPE_MIN_PX, 300 - 2 * TAP_SLOP_PX, 400);

    assert.deepEqual(calls, ["volume start", "volume 0.08", "volume 0.08", "volume end"]);
});

// A cancel is the system taking the touch for its own gesture: what the
// drag had done is undone, rather than kept as if it were meant.
test("a cancelled drag is undone, and a cancelled tap is nothing", () => {
    const { calls, tracker } = track();

    tracker.down(100, 300, 0);
    tracker.move(100, 300 - 2 * TAP_SLOP_PX, 100);
    tracker.cancel();
    tracker.down(100, 300, 1000);
    tracker.move(100 - 2 * TAP_SLOP_PX, 300, 1100);
    tracker.cancel();
    tracker.down(100, 300, 2000);
    tracker.cancel();

    assert.deepEqual(calls, ["volume start", "volume 0.08", "volume cancelled", `across ${-2 * TAP_SLOP_PX}`, "swipe cancelled"]);
});

// Back is a swipe in from the side, home and the shade a drag from the bottom
// and top. Begun there, that way is the system's, and the player neither moves
// with it nor acts on it; the other way, and a tap, are still the player's.
// Nothing is pressed in: it is most likely the system's.
test("the system's own gestures are left to it where they begin", () => {
    const { calls, presses, tracker } = track();
    const side = { across: true, upDown: false };
    const bottom = { across: false, upDown: true };

    tracker.down(2, 300, 0, side);
    tracker.move(2 + 2 * SWIPE_MIN_PX, 300, 100);
    tracker.up(2 + 2 * SWIPE_MIN_PX, 300, 150);
    tracker.down(200, 790, 1000, bottom);
    tracker.move(200, 790 - VOLUME_TRAVEL_PX / 2, 1100);
    tracker.up(200, 790 - VOLUME_TRAVEL_PX / 2, 1150);
    assert.deepEqual(calls, []);

    tracker.down(2, 300, 2000, side);
    tracker.move(2, 300 - VOLUME_TRAVEL_PX / 2, 2100);
    tracker.up(2, 300 - VOLUME_TRAVEL_PX / 2, 2200);
    tracker.down(2, 300, 3000, side);
    tracker.up(2, 300, 3100);

    assert.deepEqual(calls, ["volume start", "volume 0.50", "volume end", "tap"]);
    assert.deepEqual(presses, []);
});
