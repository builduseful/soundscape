package com.builduseful.soundscape.core.gestures

import com.builduseful.soundscape.core.contract.DesignTokens.Gesture
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.sign

/** What one finger's movement over the player means. Distances in dp, times in ms. */
interface GestureHandlers {
    /** The finger is down: felt at once, before it is known what it will do. */
    fun onPress()

    /** The finger is up, or taken away, after whatever it did. */
    fun onRelease()

    fun onTap()

    /** How far across the finger is, while it moves. */
    fun onSwipeMove(dx: Float)

    /** Released far enough across, at [velocity] dp/ms (negative is leftward). */
    fun onSwipe(direction: SwipeDirection, velocity: Float)

    /** Released short, heading back, or taken away by the system. */
    fun onSwipeCancel()

    fun onVolumeStart()

    /** The change since the drag began, as a fraction of the range; up is louder. */
    fun onVolumeChange(change: Float)

    fun onVolumeEnd()

    /** Taken away by the system before it ended: the level goes back to where the drag found it. */
    fun onVolumeCancel()
}

/**
 * Where a touch began, as far as the system's own gestures are concerned.
 * From the sides the system swipes across (back); from the top and bottom it
 * drags up and down (the shade, home). Each is left to it there; the other
 * way, and a tap, are still the player's.
 */
data class SystemReach(val across: Boolean, val upDown: Boolean) {
    companion object {
        val None = SystemReach(across = false, upDown = false)
    }
}

/** Leftward is next and rightward previous, as pages turn. */
enum class SwipeDirection { Next, Previous }

/**
 * Classifies one finger's movement: a tap plays or pauses, a swipe across
 * changes soundscape, a drag up or down sets the volume. The web's
 * `createGestureTracker` is the reference, threshold for threshold.
 *
 * The first movement past the slop settles the axis for the rest of the
 * gesture, so a drag that wanders sideways while setting the volume does not
 * also change the soundscape. A release is judged by where the finger would be
 * [Gesture.swipeProjectionMs] later at the speed it let go: a quick flick
 * counts though it moved only a little, and a drag turning back toward where
 * it began is let go, however far it got.
 */
class GestureTracker(private val handlers: GestureHandlers) {
    private var startX = 0f
    private var startY = 0f
    private var startTime = 0L
    private var axis: Axis? = null
    private var reach = SystemReach.None

    // The last stretch of movement, which the release speed is taken over.
    private val times = LongArray(SAMPLES)
    private val xs = FloatArray(SAMPLES)
    private var samples = 0

    var active = false
        private set

    /**
     * A touch in the system's reach is not pressed in: it is most likely the
     * system's, and the press would only flicker as the system takes it.
     */
    fun down(x: Float, y: Float, time: Long, reach: SystemReach = SystemReach.None) {
        startX = x
        startY = y
        startTime = time
        axis = null
        this.reach = reach
        active = true
        samples = 0
        sample(x, time)
        if (reach == SystemReach.None) handlers.onPress()
    }

    fun move(x: Float, y: Float, time: Long) {
        if (!active) return
        sample(x, time)

        val dx = x - startX
        val dy = y - startY
        if (axis == null && max(abs(dx), abs(dy)) > Gesture.tapSlop) {
            axis = when {
                abs(dx) > abs(dy) -> if (reach.across) Axis.System else Axis.X
                else -> if (reach.upDown) Axis.System else Axis.Y
            }
            if (axis == Axis.Y) handlers.onVolumeStart()
        }
        when (axis) {
            Axis.Y -> handlers.onVolumeChange(-dy / Gesture.volumeTravel)
            Axis.X -> handlers.onSwipeMove(dx)
            Axis.System, null -> Unit
        }
    }

    fun up(x: Float, y: Float, time: Long) {
        if (!active) return
        active = false
        sample(x, time)

        val dx = x - startX
        when (axis) {
            Axis.Y -> handlers.onVolumeEnd()
            Axis.X -> {
                val speed = velocity()
                val projected = dx + speed * Gesture.swipeProjectionMs
                if (abs(projected) >= Gesture.swipeMin && sign(projected) == sign(dx)) {
                    handlers.onSwipe(if (dx < 0) SwipeDirection.Next else SwipeDirection.Previous, speed)
                } else {
                    handlers.onSwipeCancel()
                }
            }
            Axis.System -> Unit
            null -> if (time - startTime <= Gesture.tapMaxMs) handlers.onTap()
        }
        if (reach == SystemReach.None) handlers.onRelease()
    }

    /** Taken away before it ended, most often by the system claiming it as its own gesture: undone. */
    fun cancel() {
        if (!active) return
        active = false
        when (axis) {
            Axis.Y -> handlers.onVolumeCancel()
            Axis.X -> handlers.onSwipeCancel()
            Axis.System, null -> Unit
        }
        if (reach == SystemReach.None) handlers.onRelease()
    }

    private fun sample(x: Float, time: Long) {
        // Only the window is kept, oldest first.
        var keep = 0
        for (i in 0 until samples) {
            if (time - times[i] <= Gesture.velocityWindowMs) {
                times[keep] = times[i]
                xs[keep] = xs[i]
                keep++
            }
        }
        if (keep == SAMPLES) {
            System.arraycopy(times, 1, times, 0, SAMPLES - 1)
            System.arraycopy(xs, 1, xs, 0, SAMPLES - 1)
            keep--
        }
        times[keep] = time
        xs[keep] = x
        samples = keep + 1
    }

    private fun velocity(): Float {
        val last = samples - 1
        val first = (0..last).first { times[last] - times[it] <= Gesture.velocityWindowMs }
        return if (times[last] > times[first]) (xs[last] - xs[first]) / (times[last] - times[first]) else 0f
    }

    // System: the way the system's own gesture goes, from where it began; left to it.
    private enum class Axis { X, Y, System }

    private companion object {
        // Far more than arrive in the window at any touch rate a screen has.
        const val SAMPLES = 64
    }
}
