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

    // The last stretch of movement, which the release speed is taken over.
    private val times = LongArray(SAMPLES)
    private val xs = FloatArray(SAMPLES)
    private var samples = 0

    var active = false
        private set

    fun down(x: Float, y: Float, time: Long) {
        startX = x
        startY = y
        startTime = time
        axis = null
        active = true
        samples = 0
        sample(x, time)
        handlers.onPress()
    }

    fun move(x: Float, y: Float, time: Long) {
        if (!active) return
        sample(x, time)

        val dx = x - startX
        val dy = y - startY
        if (axis == null && max(abs(dx), abs(dy)) > Gesture.tapSlop) {
            axis = if (abs(dx) > abs(dy)) Axis.X else Axis.Y
            if (axis == Axis.Y) handlers.onVolumeStart()
        }
        when (axis) {
            Axis.Y -> handlers.onVolumeChange(-dy / Gesture.volumeTravel)
            Axis.X -> handlers.onSwipeMove(dx)
            null -> Unit
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
            null -> if (time - startTime <= Gesture.tapMaxMs) handlers.onTap()
        }
        handlers.onRelease()
    }

    fun cancel() {
        if (!active) return
        active = false
        when (axis) {
            Axis.Y -> handlers.onVolumeEnd()
            Axis.X -> handlers.onSwipeCancel()
            null -> Unit
        }
        handlers.onRelease()
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

    private enum class Axis { X, Y }

    private companion object {
        // Far more than arrive in the window at any touch rate a screen has.
        const val SAMPLES = 64
    }
}
