package com.builduseful.soundscape.core.gestures

import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.playback.PreferenceStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GestureGuideTest {
    private class Store : PreferenceStore {
        val values = mutableMapOf<String, String>()
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) {
            values[key] = value
        }
    }

    private val store = Store()
    private val guide = GestureGuide(store)

    @Test
    fun itTeachesTapThenSwipeThenVolumeEachLearntByDoingIt() {
        guide.start()
        assertEquals(0, guide.step)

        assertFalse("Only the gesture asked for moves it on", guide.completed(Gesture.Swipe))
        assertTrue(guide.completed(Gesture.Tap))
        assertTrue(guide.completed(Gesture.Swipe))
        assertFalse(guide.isDone)
        assertTrue(guide.completed(Gesture.Volume))
        assertTrue(guide.isDone)
        assertFalse("Done is the last step", guide.completed(Gesture.Volume))
    }

    @Test
    fun finishedOrSkippedItIsNotOfferedAgain() {
        assertTrue(guide.isOffered)
        guide.start()
        guide.finish()

        assertNull(guide.step)
        assertFalse(guide.isOffered)
        assertFalse(GestureGuide(store).isOffered)
    }

    // Saved under the web's name, so the two read alike.
    @Test
    fun itIsRememberedAsTheWebRemembersIt() {
        guide.finish()
        assertEquals(mapOf("gestureTutorialDone" to "true"), store.values)
    }

    @Test
    fun closedItTakesNoNotice() {
        assertFalse(guide.completed(Gesture.Tap))
        assertNull(guide.step)
    }
}

class SwipeTest {
    private val min = DesignTokens.Duration.swipeMin
    private val max = DesignTokens.Duration.swipeMax

    // An ease-out cubic leaves at three times its average speed.
    @Test
    fun aSwipeCarriesOnAtTheFingersSpeed() {
        val millis = (min + max) / 2
        assertEquals(millis, swipeDurationMillis(remaining = millis.toFloat(), velocity = 3f))
    }

    @Test
    fun aFlickIsNotInstantAndAStillFingerNotSlow() {
        assertEquals(min, swipeDurationMillis(300f, 100f))
        assertEquals(max, swipeDurationMillis(300f, 0f))
        assertEquals("Heading away counts as still", max, swipeDurationMillis(300f, -2f))
    }
}
