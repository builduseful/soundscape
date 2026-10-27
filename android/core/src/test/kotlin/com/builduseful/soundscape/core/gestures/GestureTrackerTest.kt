package com.builduseful.soundscape.core.gestures

import com.builduseful.soundscape.core.contract.DesignTokens.Gesture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

// The web's tests/gestures.test.js, case for case.
class GestureTrackerTest {
    private val calls = mutableListOf<String>()
    private val presses = mutableListOf<String>()
    private val tracker = GestureTracker(
        object : GestureHandlers {
            override fun onPress() {
                presses += "press"
            }

            override fun onRelease() {
                presses += "release"
            }

            override fun onTap() {
                calls += "tap"
            }

            override fun onSwipeMove(dx: Float) {
                calls += "across ${dx.toInt()}"
            }

            override fun onSwipe(direction: SwipeDirection, velocity: Float) {
                calls += "swipe ${direction.name.lowercase()}"
            }

            override fun onSwipeCancel() {
                calls += "swipe cancelled"
            }

            override fun onVolumeStart() {
                calls += "volume start"
            }

            override fun onVolumeChange(change: Float) {
                calls += "volume ${"%.2f".format(change)}"
            }

            override fun onVolumeEnd() {
                calls += "volume end"
            }
        },
    )

    private val slop = Gesture.tapSlop
    private val swipe = Gesture.swipeMin
    private val travel = Gesture.volumeTravel

    // The page sinks in at the touch, not once the finger has moved far enough
    // to say what it is doing, and comes back however the gesture ends.
    @Test
    fun aPressIsFeltAsTheFingerTouchesAndLetGoAsItLifts() {
        tracker.down(100f, 100f, 0)
        assertEquals(listOf("press"), presses)
        assertEquals(emptyList<String>(), calls)

        tracker.move(100f - swipe, 100f, 100)
        tracker.up(100f - swipe, 100f, 100)
        tracker.down(100f, 100f, 1000)
        tracker.up(100f, 100f, 1000 + Gesture.tapMaxMs.toLong() + 1)
        tracker.down(100f, 100f, 2000)
        tracker.move(100f, 100f - travel / 2, 2100)
        tracker.cancel()

        assertEquals(listOf("press", "release", "press", "release", "press", "release"), presses)
    }

    @Test
    fun aQuickPressThatBarelyMovesIsATap() {
        tracker.down(100f, 100f, 0)
        tracker.move(100f + slop, 100f, 100)
        tracker.up(100f + slop, 100f, Gesture.tapMaxMs.toLong())

        assertEquals(listOf("tap"), calls)
    }

    // A finger resting on the screen and lifted is not asking for anything.
    @Test
    fun aPressHeldPastTheTapTimeDoesNothing() {
        tracker.down(100f, 100f, 0)
        tracker.up(100f, 100f, Gesture.tapMaxMs.toLong() + 1)

        assertEquals(emptyList<String>(), calls)
    }

    @Test
    fun aSwipeLeftIsNextAndASwipeRightIsPreviousAsPagesTurn() {
        tracker.down(200f, 100f, 0)
        tracker.move(200f - swipe, 104f, 150)
        tracker.up(200f - swipe, 104f, 150)
        tracker.down(200f, 100f, 1000)
        tracker.move(200f + swipe, 96f, 1150)
        tracker.up(200f + swipe, 96f, 1150)

        assertEquals(listOf("across ${-swipe.toInt()}", "swipe next", "across ${swipe.toInt()}", "swipe previous"), calls)
    }

    // Judged by where the finger was heading as it let go, so a quick flick
    // needs little distance.
    @Test
    fun aQuickFlickChangesSoundscapeThoughItIsShort() {
        tracker.down(200f, 100f, 0)
        tracker.move(185f, 100f, 20)
        tracker.move(180f, 100f, 40)
        tracker.up(180f, 100f, 40)

        assertTrue(abs(-20 + -0.5f * Gesture.swipeProjectionMs) >= swipe)
        assertEquals(listOf("across -15", "across -20", "swipe next"), calls)
    }

    // Someone who drags across and then back has changed their mind.
    @Test
    fun aSwipeThatTurnsBackAsItIsLetGoIsCancelledHoweverFarItGot() {
        tracker.down(200f, 100f, 0)
        tracker.move(100f, 100f, 200)
        tracker.move(140f, 100f, 260)
        tracker.up(140f, 100f, 260)

        assertEquals(listOf("across -100", "across -60", "swipe cancelled"), calls)
    }

    // Past the slop but short of a swipe: a hesitation, not a request. What
    // followed the finger goes back.
    @Test
    fun aShortSidewaysMovementIsCancelledAndIsNotATap() {
        tracker.down(200f, 100f, 0)
        tracker.move(200f - swipe + 1, 100f, 100)
        tracker.up(200f - swipe + 1, 100f, 100)

        assertEquals(listOf("across ${(-swipe + 1).toInt()}", "swipe cancelled"), calls)
    }

    @Test
    fun aDragUpIsLouderADragDownQuieterMeasuredFromWhereItBegan() {
        tracker.down(100f, 300f, 0)
        tracker.move(100f, 300f - travel / 2, 200)
        tracker.move(100f, 300f + travel / 4, 400)
        tracker.up(100f, 300f + travel / 4, 600)

        assertEquals(listOf("volume start", "volume 0.50", "volume -0.25", "volume end"), calls)
    }

    // The first movement decides: setting the volume never turns into a swipe.
    @Test
    fun aVolumeDragThatWandersSidewaysStaysAVolumeDrag() {
        tracker.down(100f, 300f, 0)
        tracker.move(100f, 300f - 2 * slop, 100)
        tracker.move(100f - 3 * swipe, 300f - 2 * slop, 200)
        tracker.up(100f - 3 * swipe, 300f - 2 * slop, 400)

        assertEquals(listOf("volume start", "volume 0.08", "volume 0.08", "volume end"), calls)
    }

    @Test
    fun aCancelledDragStillEndsWhatItBeganAndACancelledTapIsNothing() {
        tracker.down(100f, 300f, 0)
        tracker.move(100f, 300f - 2 * slop, 100)
        tracker.cancel()
        tracker.down(100f, 300f, 1000)
        tracker.move(100f - 2 * slop, 300f, 1100)
        tracker.cancel()
        tracker.down(100f, 300f, 2000)
        tracker.cancel()

        assertEquals(
            listOf("volume start", "volume 0.08", "volume end", "across ${(-2 * slop).toInt()}", "swipe cancelled"),
            calls,
        )
    }

    // The speed is the finger's as it let go, over its last stretch only: a
    // long slow drag ended with a flick is a flick.
    @Test
    fun theReleaseSpeedIsTakenOverTheLastStretchOnly() {
        var speed = 0f
        val flick = GestureTracker(
            object : GestureHandlers {
                override fun onPress() = Unit
                override fun onRelease() = Unit
                override fun onTap() = Unit
                override fun onSwipeMove(dx: Float) = Unit
                override fun onSwipe(direction: SwipeDirection, velocity: Float) {
                    speed = velocity
                }
                override fun onSwipeCancel() = Unit
                override fun onVolumeStart() = Unit
                override fun onVolumeChange(change: Float) = Unit
                override fun onVolumeEnd() = Unit
            },
        )
        flick.down(300f, 100f, 0)
        for (step in 1..100) flick.move(300f - step, 100f, step * 10L)
        flick.move(150f, 100f, 1040)
        flick.up(150f, 100f, 1040)

        // From the first sample in the window, a 10 ms step of the slow drag.
        val from = 1040 - Gesture.velocityWindowMs.toLong()
        assertEquals((150f - (300f - from / 10)) / (1040 - from), speed, 0.001f)
    }
}
