// Touch gestures over the player: a tap plays or pauses, a swipe across changes
// soundscape, and a drag up or down sets the volume.
//
// Touch and pen only. A mouse has the controls, which show while it moves, and
// a click on empty page that started the sound would surprise anyone who only
// meant to focus the window.

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
 */
export function createGestureTracker(handlers) {
    let start = null;
    let axis = null;
    let samples = [];

    function velocity() {
        const last = samples.at(-1);
        const first = samples.find((sample) => last.time - sample.time <= VELOCITY_WINDOW_MS);

        return last.time > first.time ? (last.x - first.x) / (last.time - first.time) : 0;
    }

    return {
        get active() {
            return start !== null;
        },

        down(x, y, time) {
            start = { x, y, time };
            axis = null;
            samples = [{ x, time }];
            handlers.onPress();
        },

        move(x, y, time) {
            if (!start) return;

            samples.push({ x, time });
            samples = samples.filter((sample) => time - sample.time <= VELOCITY_WINDOW_MS);

            const dx = x - start.x;
            const dy = y - start.y;

            if (!axis && Math.max(Math.abs(dx), Math.abs(dy)) > TAP_SLOP_PX) {
                axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
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
            } else if (time - began.time <= TAP_MAX_MS) {
                handlers.onTap();
            }
            handlers.onRelease();
        },

        cancel() {
            if (!start) return;

            start = null;
            if (axis === "y") handlers.onVolumeEnd();
            else if (axis === "x") handlers.onSwipeCancel();
            handlers.onRelease();
        },
    };
}

/**
 * Listens on `surface` for touch and pen gestures, leaving alone any press that
 * starts on something interactive.
 * @param {HTMLElement} surface
 * @param {Parameters<typeof createGestureTracker>[0]} handlers
 */
export function attachGestures(surface, handlers) {
    const tracker = createGestureTracker(handlers);
    let pointerId = null;

    surface.addEventListener("pointerdown", (event) => {
        if (event.pointerType === "mouse" || !event.isPrimary || tracker.active) return;
        if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;

        pointerId = event.pointerId;
        surface.setPointerCapture(pointerId);
        tracker.down(event.clientX, event.clientY, event.timeStamp);
    });
    surface.addEventListener("pointermove", (event) => {
        if (event.pointerId === pointerId) tracker.move(event.clientX, event.clientY, event.timeStamp);
    });
    surface.addEventListener("pointerup", (event) => {
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
