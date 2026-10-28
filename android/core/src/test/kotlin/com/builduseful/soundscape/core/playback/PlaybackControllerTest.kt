package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.DesignTokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackControllerTest {
    private val rain = Track("rain", "Rain")
    private val fire = Track("fire", "Fire")
    private val road = Track("road", "Road")
    private val tracks = listOf(rain, fire, road)

    private val engine = FakeEngine()
    private val scheduler = FakeScheduler()
    private val delay = DesignTokens.Duration.loadingIndicatorDelay

    private fun controller(preferences: PreferenceStore = MemoryPreferences()) =
        PlaybackController(tracks, engine, preferences, scheduler)

    /** A controller already playing [track]. */
    private fun playing(track: Track = rain): PlaybackController {
        val controller = controller(MemoryPreferences(PlaybackController.TRACK_KEY to track.id))
        controller.play()
        engine.succeed()
        return controller
    }

    // --- Track navigation ---------------------------------------------------

    @Test
    fun nextAndPreviousWrapAround() {
        val controller = controller(MemoryPreferences(PlaybackController.TRACK_KEY to road.id))

        controller.next()
        assertEquals(rain, controller.state.track)
        assertEquals(Direction.Next, controller.state.trackChange)

        controller.previous()
        assertEquals(road, controller.state.track)
        assertEquals(Direction.Previous, controller.state.trackChange)
    }

    @Test
    fun aTrackChangeKeepsPlayingIfItWasPlayingAndPausedIfNot() {
        val controller = playing()
        controller.next()
        assertTrue(engine.loads.last().play)

        controller.pause()
        controller.next()
        assertFalse(engine.loads.last().play)
    }

    // Two quick skips leave two loads in flight, and the first can finish
    // last. It must not decide what is on screen.
    @Test
    fun aSupersededLoadIsIgnoredWhenItFinishes() {
        val controller = playing()
        controller.next() // fire
        controller.next() // road

        engine.succeed(2)
        engine.succeed(1) // the stale fire load finishes last

        assertEquals(road, controller.state.track)
        assertEquals(road, engine.loadedTrack)
        assertNull(controller.state.notice)
    }

    @Test
    fun aSupersededLoadThatFailsReportsNothing() {
        val controller = controller()
        controller.next()
        controller.next()

        engine.fail(0)

        assertEquals(road, controller.state.track)
        assertNull(controller.state.notice)
    }

    // --- Failures -------------------------------------------------------------

    // The title names the sound in the room: a failed change goes back to the
    // track the engine is still playing, and the notice names the one that failed.
    @Test
    fun aFailedChangeRollsBackToWhatTheEngineHolds() {
        val preferences = MemoryPreferences()
        val controller = controller(preferences)
        controller.play()
        engine.succeed()
        controller.pause()

        controller.next()
        engine.fail()

        assertEquals(rain, controller.state.track)
        assertNull("a rollback sets the title, it does not slide it", controller.state.trackChange)
        assertEquals(rain.id, preferences.values[PlaybackController.TRACK_KEY])
        assertEquals(Notice.Failed(fire), controller.state.notice)
    }

    // Rolling back to the track before this change would be wrong after
    // several skips: that track may never have loaded.
    @Test
    fun aRollbackAfterSeveralSkipsGoesToTheHeldTrackNotThePreviousTitle() {
        val controller = playing()
        controller.pause()
        controller.next() // fire, superseded
        controller.next() // road, fails

        engine.fail(2)

        assertEquals(rain, controller.state.track)
    }

    @Test
    fun withNothingLoadedAFailedChangeGoesBackToTheTrackBeforeIt() {
        val controller = controller()
        controller.next()
        engine.fail()

        assertEquals(rain, controller.state.track)
        assertEquals(Notice.Failed(fire), controller.state.notice)
    }

    // Failed, but the engine is on the attempted track anyway (it loaded and
    // would not start): stay there, since rolling back would name a track that
    // is no longer loaded.
    @Test
    fun aFailureThatStillLeftTheTrackLoadedStaysOnIt() {
        val controller = controller()
        controller.next()
        engine.loadedTrack = fire
        engine.fail()

        assertEquals(fire, controller.state.track)
        assertEquals(Notice.Failed(fire), controller.state.notice)
    }

    // Only a failure that leaves silence is shown. One while something plays
    // is absorbed: the music never stopped.
    @Test
    fun aFailureWhileSoundPlaysIsNotShown() {
        val controller = playing()
        controller.next()
        engine.fail()

        assertEquals(rain, controller.state.track)
        assertTrue(controller.state.isPlaying)
        assertNull(controller.state.notice)
    }

    @Test
    fun aFailedFirstPlayShowsTheFailureAndThePlayButton() {
        val controller = controller()
        controller.play()
        assertTrue("the button answers at once", controller.state.isPlaying)

        engine.fail()

        assertFalse(controller.state.isPlaying)
        assertEquals(Notice.Failed(rain), controller.state.notice)
    }

    @Test
    fun aResumeTheOutputRefusesIsShown() {
        val controller = playing()
        controller.pause()
        engine.playFails = true

        controller.play()

        assertFalse(controller.state.isPlaying)
        assertEquals(Notice.Failed(rain), controller.state.notice)
    }

    // The output can stop with nobody asking (it would not start). The button
    // must not go on claiming sound, and the silence is explained.
    @Test
    fun anOutputThatStopsByItselfShowsPlayAndTheFailure() {
        val controller = playing()

        engine.stopByItself()

        assertFalse(controller.state.isPlaying)
        assertEquals(Notice.Failed(rain), controller.state.notice)
    }

    @Test
    fun aSuccessfulChangeOrPlayClearsAnEarlierFailure() {
        val controller = controller()
        controller.play()
        engine.fail()

        controller.next()
        engine.succeed()
        assertNull(controller.state.notice)

        controller.next()
        engine.fail()
        assertEquals(Notice.Failed(road), controller.state.notice)
        controller.play()
        assertNull(controller.state.notice)
    }

    // --- Play and pause -------------------------------------------------------

    @Test
    fun playResumesTheHeldTrackWithoutLoadingIt() {
        val controller = playing()
        controller.pause()
        val loads = engine.loads.size

        controller.play()

        assertEquals(loads, engine.loads.size)
        assertTrue(engine.isPlaying)
        assertTrue(controller.state.isPlaying)
    }

    // Changing track while paused loads the new one paused; play must then
    // load the track on screen, never resume the one held from before.
    @Test
    fun playNeverResumesADifferentTrackUnderTheTitle() {
        val controller = playing()
        controller.pause()
        controller.next() // fire, still loading

        controller.play()

        assertEquals(fire, engine.loads.last().track)
        assertTrue(engine.loads.last().play)
        assertFalse("rain must not be resumed under fire's title", engine.isPlaying)
    }

    @Test
    fun pausingWhileAPlayIsLoadingLandsItPaused() {
        val controller = controller()
        controller.play()
        controller.pause()
        engine.succeed()

        assertFalse(engine.isPlaying)
        assertFalse(controller.state.isPlaying)
        assertEquals(rain, engine.loadedTrack)
    }

    @Test
    fun playPauseToggles() {
        val controller = playing()
        controller.playPause()
        assertFalse(controller.state.isPlaying)
        controller.playPause()
        assertTrue(controller.state.isPlaying)
    }

    // --- The loading indicator ------------------------------------------------

    // A fast load never flashes the indicator.
    @Test
    fun aLoadFasterThanTheDelayShowsNoIndicator() {
        val controller = controller()
        controller.play()
        scheduler.advance(delay - 1)
        engine.succeed()
        scheduler.advance(delay)

        assertFalse(controller.state.isLoading)
        assertNull(controller.state.notice)
        assertEquals(0, scheduler.pending)
    }

    @Test
    fun aSlowLoadShowsTheIndicatorAfterTheDelayUntilItEnds() {
        val controller = controller()
        controller.play()
        scheduler.advance(delay)

        assertTrue(controller.state.isLoading)
        assertEquals(Notice.Loading, controller.state.notice)

        engine.succeed()
        assertFalse(controller.state.isLoading)
        assertNull(controller.state.notice)
    }

    // Skipping mid-load hands the state on: the delay runs from the first
    // press, not the latest, and the indicator never blinks off between tracks.
    @Test
    fun skippingMidLoadHandsTheIndicatorOn() {
        val controller = controller()
        controller.next()
        scheduler.advance(delay - 100)
        controller.next()
        scheduler.advance(100)
        assertTrue("the delay is not restarted", controller.state.isLoading)

        val seen = mutableListOf<Boolean>()
        controller.observe { seen += it.isLoading }
        controller.next()
        engine.succeed(1) // superseded
        assertTrue("the indicator stayed up", seen.all { it })
        engine.succeed()
        assertFalse(controller.state.isLoading)
    }

    // The two never stand together; whichever arrives later holds the line.
    @Test
    fun theIndicatorAndAFailureAreNeverShownTogether() {
        val controller = controller()
        controller.play()
        scheduler.advance(delay)
        engine.fail()
        assertEquals(Notice.Failed(rain), controller.state.notice)
        assertFalse(controller.state.isLoading)

        controller.play()
        scheduler.advance(delay)
        assertEquals("a running attempt replaces the old failure", Notice.Loading, controller.state.notice)
    }

    // The title's accessible text settles only when its slide ends; announcing
    // loading sooner would reach a screen reader before the track's name.
    @Test
    fun theIndicatorDelayOutlastsTheTitleChange() {
        assertTrue(DesignTokens.Duration.loadingIndicatorDelay > DesignTokens.Duration.titleChange)
    }

    // --- Shortcuts -------------------------------------------------------------

    @Test
    fun selectingAnotherTrackChangesToItAndPlays() {
        val controller = controller()
        controller.select(road.id)

        assertEquals(road, controller.state.track)
        assertTrue(engine.loads.last().play)
        engine.succeed()
        assertTrue(engine.isPlaying)
    }

    @Test
    fun selectingTheCurrentTrackPlaysIt() {
        val controller = playing()
        controller.pause()
        controller.select(rain.id)
        assertTrue(engine.isPlaying)

        val loads = engine.loads.size
        controller.select(rain.id)
        assertEquals("already playing: nothing to do", loads, engine.loads.size)
    }

    @Test
    fun aSelectionThatFailsDoesNotPlayWhatWasThere() {
        val controller = playing()
        controller.pause()
        controller.select(road.id)
        engine.fail()

        assertEquals(rain, controller.state.track)
        assertFalse(engine.isPlaying)
        assertEquals(Notice.Failed(road), controller.state.notice)
    }

    @Test
    fun anUnknownSelectionIsIgnored() {
        val controller = controller()
        val before = controller.state
        controller.select("no-such-track")
        assertEquals(before, controller.state)
        assertTrue(engine.loads.isEmpty())
    }

    // --- Preferences -----------------------------------------------------------

    @Test
    fun theSavedTrackIsRestoredAndAnUnknownOneFallsBackToTheFirst() {
        assertEquals(fire, controller(MemoryPreferences(PlaybackController.TRACK_KEY to fire.id)).state.track)
        assertEquals(rain, controller(MemoryPreferences(PlaybackController.TRACK_KEY to "retired")).state.track)
        assertEquals(rain, controller().state.track)
    }

    @Test
    fun aChangeIsSavedAsItIsAttempted() {
        val preferences = MemoryPreferences()
        val controller = controller(preferences)
        controller.next()
        assertEquals(fire.id, preferences.values[PlaybackController.TRACK_KEY])
    }

    @Test
    fun volumeIsClampedAppliedAndSaved() {
        val preferences = MemoryPreferences()
        val controller = controller(preferences)

        controller.setVolume(1.5f)
        assertEquals(1f, controller.state.volume)
        controller.setVolume(-0.2f)
        assertEquals(0f, controller.state.volume)
        controller.setVolume(0.4f)
        assertEquals(0.4f, engine.appliedVolume)
        assertEquals("0.4", preferences.values[PlaybackController.VOLUME_KEY])

        controller.setVolume(Float.NaN)
        assertEquals(0.4f, controller.state.volume)
    }

    // A slider writes on release, not on every step of a drag.
    @Test
    fun volumeIsSavedOnlyWhenAskedTo() {
        val preferences = MemoryPreferences()
        val controller = controller(preferences)
        controller.setVolume(0.3f, persist = false)
        controller.setVolume(0.2f, persist = false)
        assertEquals(0, preferences.writes)
        assertEquals(0.2f, engine.appliedVolume)
    }

    @Test
    fun theSavedVolumeIsRestoredAndAnInvalidOneIsFull() {
        assertEquals(0.25f, controller(MemoryPreferences(PlaybackController.VOLUME_KEY to "0.25")).state.volume)
        assertEquals(0.25f, engine.appliedVolume)
        for (bad in listOf("2", "-1", "loud", "NaN")) {
            assertEquals(bad, 1f, controller(MemoryPreferences(PlaybackController.VOLUME_KEY to bad)).state.volume)
        }
    }

    // --- A swipe's fade ------------------------------------------------------------

    // The finger thins the sound under the listener's own volume, and a swipe
    // let go of brings it back smoothly rather than in a step.
    @Test
    fun aSwipeThinsTheSoundAndACancelBringsItBack() {
        val controller = playing()
        controller.setVolume(0.5f)
        controller.setPresence(0.4f)
        assertEquals(0.2f, engine.appliedVolume, 1e-6f)

        controller.setPresence(1f, DesignTokens.Duration.swipeSettle)
        scheduler.advance(DesignTokens.Duration.swipeSettle / 2)
        assertEquals(0.35f, engine.appliedVolume, 0.02f)
        scheduler.advance(DesignTokens.Duration.swipeSettle)
        assertEquals(0.5f, engine.appliedVolume, 1e-6f)
        assertEquals(0, scheduler.pending)
    }

    // By the time the next page is in, the last sound is gone; the next one
    // rises only once it is playing, and nothing the finger does meanwhile
    // brings the old one back.
    @Test
    fun aCommittedSwipeHandsTheSoundOverToTheNextTrack() {
        val controller = playing()
        controller.handOver(300)
        scheduler.advance(300)
        assertEquals(0f, engine.appliedVolume)

        controller.setPresence(1f)
        controller.next()
        scheduler.advance(DesignTokens.Duration.swipeFadeIn)
        assertEquals("held until the track is in", 0f, engine.appliedVolume)

        engine.succeed()
        scheduler.advance(DesignTokens.Duration.swipeFadeIn / 2)
        assertEquals("heard at once, not eased in", 0.707f, engine.appliedVolume, 0.02f)
        scheduler.advance(DesignTokens.Duration.swipeFadeIn)
        assertEquals(1f, engine.appliedVolume)
    }

    // Once a hand-over has taken the sound away there is nothing to crossfade
    // from: the change is a cut, so none of the old track is heard as the new
    // one rises.
    @Test
    fun onlyAChangeAfterAHandOverIsACut() {
        val controller = playing()
        controller.next()
        assertFalse(engine.loads.last().cut)

        controller.handOver(300)
        controller.next()
        assertTrue(engine.loads.last().cut)
    }

    @Test
    fun aHandOverIsReleasedByAFailedLoadAPauseOrNoLoadAtAll() {
        val controller = playing()
        controller.handOver(300)
        controller.next()
        engine.fail()
        scheduler.advance(DesignTokens.Duration.swipeFadeIn)
        assertEquals("failed", 1f, engine.appliedVolume)

        controller.handOver(300)
        controller.pause()
        assertEquals("paused: at once", 1f, engine.appliedVolume)

        controller.play()
        controller.handOver(300)
        scheduler.advance(300 + DesignTokens.Duration.swipeSettle + DesignTokens.Duration.swipeFadeIn)
        assertEquals("no load followed", 1f, engine.appliedVolume)
        assertEquals(0, scheduler.pending)
    }

    // Swiping again before the last swipe's track is in: that load finishing
    // must not bring in the sound this swipe is taking away.
    @Test
    fun aHandOverWaitsForItsOwnTrack() {
        val controller = playing()
        controller.handOver(300)
        controller.next()
        controller.handOver(300)
        engine.succeed()
        scheduler.advance(300)
        assertEquals(0f, engine.appliedVolume)

        controller.next()
        engine.succeed()
        scheduler.advance(DesignTokens.Duration.swipeFadeIn)
        assertEquals(1f, engine.appliedVolume)
    }

    // --- Observing ---------------------------------------------------------------

    // A listener may act on what it is told — audio focus pauses when its
    // request is refused. That pause must reach the load just issued.
    @Test
    fun aListenerThatPausesOnPlayPausesTheLoad() {
        val controller = controller()
        controller.observe { if (it.isPlaying) controller.pause() }

        controller.play()
        engine.succeed()

        assertFalse(controller.state.isPlaying)
        assertFalse(engine.isPlaying)
    }

    // When one listener changes the state, a later one must end on the newest
    // state, never be handed the one it replaced afterwards.
    @Test
    fun everyListenerEndsOnTheNewestState() {
        val controller = controller()
        controller.observe { if (it.isPlaying) controller.pause() }
        val heard = mutableListOf<Boolean>()
        controller.observe { heard += it.isPlaying }

        controller.play()

        assertEquals(false, heard.last())
    }

    // Nothing redraws when nothing changed.
    @Test
    fun observersHearOnlyRealChanges() {
        val controller = playing()
        var calls = 0
        val handle = controller.observe { calls++ }

        controller.setVolume(controller.state.volume, persist = false)
        controller.play()
        assertEquals(0, calls)

        controller.pause()
        assertEquals(1, calls)

        handle.cancel()
        controller.play()
        assertEquals(1, calls)
    }
}
