// Gestures over the player: a tap plays or pauses, a swipe across changes
// soundscape, and a drag up or down sets the volume.
//
// A mouse clicks anywhere to play or pause, as a finger taps, and that is all:
// it has the controls, which show while it moves, for the rest. A click that
// focuses the window plays or pauses too, as it does on a video.

/** Movement under this is still a tap: a fingertip never lands perfectly still. */
export const TAP_SLOP_PX = 10;
/** Longer than this and a still finger is resting, not tapping. */
export const TAP_MAX_MS = 500;
/** How far across a slow swipe has to travel to change soundscape: far enough to be meant. */
export const SWIPE_MIN_PX = 80;
/**
 * How far ahead a release is judged: where the finger would be this much later
 * at the speed it let go. A quick flick counts though it moved only a little,
 * and a drag that turns back toward where it began is let go, however far it got.
 */
export const SWIPE_PROJECTION_MS = 150;
/** The finger's speed is taken over its last stretch of movement, not all of it. */
const VELOCITY_WINDOW_MS = 80;
/** How far a drag travels to cross the whole volume range: one easy thumb stroke. */
export const VOLUME_TRAVEL_PX = 240;
/**
 * How far in from the side a swipe across is the system's back gesture. A page
 * cannot ask where that begins, as Android's app does, so this is a little over
 * the phones' own: Android's 24dp by default, iOS's 20pt.
 */
export const SYSTEM_EDGE_PX = 32;

/** Where a touch began, as far as the system's own gestures are concerned (see down). */
const NO_REACH = { across: false, upDown: false };

/**
 * Classifies one pointer's movement into a gesture. Free of the DOM, so the
 * thresholds are tested on numbers; attachGestures feeds it events.
 *
 * The first movement past the slop settles the axis for the rest of the
 * gesture, so a drag that wanders sideways while setting the volume does not
 * also change the soundscape.
 * @param {object} handlers
 * @param {() => void} handlers.onPress - The finger is down: felt at once, before it is known what it will do.
 * @param {() => void} handlers.onRelease - The finger is up, or taken away, after whatever it did.
 * @param {() => void} handlers.onTap
 * @param {(dx: number) => void} handlers.onSwipeMove - How far across the finger is, while it moves.
 * @param {(direction: "next" | "previous", velocity: number) => void} handlers.onSwipe - Released far enough across, at velocity px/ms (negative is leftward).
 * @param {() => void} handlers.onSwipeCancel - Released short, or taken away by the browser.
 * @param {() => void} handlers.onVolumeStart
 * @param {(change: number) => void} handlers.onVolumeChange - The change since the drag began, as a fraction of the range; up is louder.
 * @param {() => void} handlers.onVolumeEnd
 * @param {() => void} handlers.onVolumeCancel - Taken away by the system before it ended: the level goes back to where the drag found it.
 */
export function createGestureTracker(handlers) {
    let start = null;
    let axis = null;
    let reach = NO_REACH;
    let samples = [];

    function isReached() {
        return reach.across || reach.upDown;
    }

    function velocity() {
        const last = samples.at(-1);
        const first = samples.find((sample) => last.time - sample.time <= VELOCITY_WINDOW_MS);

        return last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
    }

    return {
        get active() {
            return start !== null;
        },

        /**
         * From the sides the system swipes across (back); from the top and
         * bottom it drags up and down. Begun there, that way is left to it;
         * the other way, and a tap, are still the player's. Such a touch is not
         * pressed in: it is most likely the system's, and the press would only
         * flicker as the system takes it.
         * @param {{ across: boolean, upDown: boolean }} [systemReach]
         */
        down(x, y, time, systemReach = NO_REACH) {
            start = { x, y, time };
            axis = null;
            reach = systemReach;
            samples = [{ x, time }];
            if (!isReached()) handlers.onPress();
        },

        move(x, y, time) {
            if (!start) return;

            samples.push({ x, time });
            samples = samples.filter((sample) => time - sample.time <= VELOCITY_WINDOW_MS);

            const dx = x - start.x;
            const dy = y - start.y;

            if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > TAP_SLOP_PX) {
                // "system": the way the system's own gesture goes, from where it began.
                if (Math.abs(dx) > Math.abs(dy)) axis = reach.across ? "system" : "x";
                else axis = reach.upDown ? "system" : "y";
                if (axis === "y") handlers.onVolumeStart();
            }

            if (axis === "y") handlers.onVolumeChange(-dy / VOLUME_TRAVEL_PX);
            else if (axis === "x") handlers.onSwipeMove(dx);
        },

        up(x, y, time) {
            if (!start) return;

            const dx = x - start.x;
            const began = start;

            samples.push({ x, time });
            start = null;

            if (axis === "y") {
                handlers.onVolumeEnd();
            } else if (axis === "x") {
                const speed = velocity();
                const projected = dx + speed * SWIPE_PROJECTION_MS;

                if (Math.abs(projected) >= SWIPE_MIN_PX && Math.sign(projected) === Math.sign(dx)) {
                    handlers.onSwipe(dx < 0 ? "next" : "previous", speed);
                } else {
                    handlers.onSwipeCancel();
                }
            } else if (!axis && time - began.time <= TAP_MAX_MS) {
                handlers.onTap();
            }
            if (!isReached()) handlers.onRelease();
        },

        /** Taken away before it ended, most often by the system claiming it as its own gesture: undone. */
        cancel() {
            if (!start) return;

            start = null;
            if (axis === "y") handlers.onVolumeCancel();
            else if (axis === "x") handlers.onSwipeCancel();
            if (!isReached()) handlers.onRelease();
        },
    };
}

/**
 * Listens on `surface` for gestures, leaving alone any press that starts on
 * something interactive.
 * @param {HTMLElement} surface
 * @param {Parameters<typeof createGestureTracker>[0]} handlers
 */
export function attachGestures(surface, handlers) {
    const tracker = createGestureTracker(handlers);
    let pointerId = null;
    let click = null;

    surface.addEventListener("pointerdown", (event) => {
        const onControl = event.target instanceof Element && event.target.closest(INTERACTIVE);

        if (event.pointerType === "mouse") {
            // A click that closes an open panel is only that.
            const closing = document.querySelector(":popover-open");

            click = !onControl && !closing && event.button === 0 ? { x: event.clientX, y: event.clientY, time: event.timeStamp } : null;
            return;
        }
        if (onControl || !event.isPrimary || tracker.active) return;

        pointerId = event.pointerId;
        surface.setPointerCapture(pointerId);
        // Only the sides: a page stops short of the system's bars, where home and the shade begin.
        const edge = event.clientX < SYSTEM_EDGE_PX || event.clientX > document.documentElement.clientWidth - SYSTEM_EDGE_PX;
        tracker.down(event.clientX, event.clientY, event.timeStamp, { across: edge, upDown: false });
    });
    surface.addEventListener("pointermove", (event) => {
        if (event.pointerId === pointerId) tracker.move(event.clientX, event.clientY, event.timeStamp);
    });
    surface.addEventListener("pointerup", (event) => {
        if (event.pointerType === "mouse") {
            if (click && Math.hypot(event.clientX - click.x, event.clientY - click.y) <= TAP_SLOP_PX
                && event.timeStamp - click.time <= TAP_MAX_MS) handlers.onTap();
            click = null;
            return;
        }
        if (event.pointerId !== pointerId) return;

        pointerId = null;
        tracker.up(event.clientX, event.clientY, event.timeStamp);
    });
    surface.addEventListener("pointercancel", (event) => {
        if (event.pointerId !== pointerId) return;

        pointerId = null;
        tracker.cancel();
    });
}

const INTERACTIVE = "a, button, input, select, textarea, label, [popover], app-menu, volume-control";
