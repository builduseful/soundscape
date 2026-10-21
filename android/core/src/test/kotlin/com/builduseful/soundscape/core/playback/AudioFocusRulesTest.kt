package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioFocusRulesTest {
    private val engine = FakeEngine()
    private val focus = FakeFocus()
    private val controller = PlaybackController(listOf(Track("rain", "Rain")), engine, MemoryPreferences(), FakeScheduler())
    private val rules = AudioFocusRules(controller, focus)

    private fun playing() {
        controller.play()
        engine.succeed()
    }

    @Test
    fun focusIsHeldWhilePlayingAndGivenUpOnPause() {
        playing()
        assertTrue(focus.held)

        controller.pause()
        assertFalse(focus.held)
    }

    // During a call the request is refused: the button must not claim sound
    // the listener cannot hear.
    @Test
    fun aRefusedRequestPauses() {
        focus.granted = false
        controller.play()

        assertFalse(controller.state.isPlaying)
        assertFalse(engine.loads.last().play)
    }

    @Test
    fun aLossForGoodPausesAndDoesNotResume() {
        playing()
        rules.onLoss()
        assertFalse(controller.state.isPlaying)
        assertFalse(focus.held)

        rules.onGain()
        assertFalse(controller.state.isPlaying)
    }

    @Test
    fun aBriefLossPausesAndResumesAfterwards() {
        playing()
        rules.onTransientLoss()
        assertFalse(controller.state.isPlaying)
        assertTrue("our place is kept", focus.held)

        rules.onGain()
        assertTrue(controller.state.isPlaying)
        assertTrue(engine.isPlaying)
    }

    // Resuming is only for what the interruption paused. Something the
    // listener had paused stays paused.
    @Test
    fun aBriefLossWhilePausedResumesNothing() {
        playing()
        controller.pause()

        rules.onTransientLoss()
        rules.onGain()

        assertFalse(controller.state.isPlaying)
    }

    // Pressing play during the interruption asks again, rather than assuming
    // the place it kept is still the speaker.
    @Test
    fun playDuringABriefLossAsksAgain() {
        playing()
        rules.onTransientLoss()
        val before = focus.requests

        focus.granted = false
        controller.play()

        assertEquals(before + 1, focus.requests)
        assertFalse(controller.state.isPlaying)
        assertFalse(focus.held)
    }

    @Test
    fun anOutputThatStopsByItselfGivesFocusUp() {
        playing()
        engine.stopByItself()
        assertFalse(focus.held)
    }

    @Test
    fun releaseGivesFocusUpAndStopsFollowing() {
        playing()
        rules.release()
        assertFalse(focus.held)

        controller.pause()
        controller.play()
        assertFalse(focus.held)
    }
}
