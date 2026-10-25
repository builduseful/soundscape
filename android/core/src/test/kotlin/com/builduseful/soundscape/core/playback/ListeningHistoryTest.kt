package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.playback.ListeningHistory.Companion.COUNTS_AFTER_MS
import com.builduseful.soundscape.core.playback.ListeningHistory.Companion.SAVE_EVERY_MS
import com.builduseful.soundscape.core.playback.ListeningHistory.Totals
import org.junit.Assert.assertEquals
import org.junit.Test

class ListeningHistoryTest {
    private val rain = Track("rain", "Rain")
    private val fire = Track("fire", "Fire")
    private val road = Track("road", "Road")
    private val tracks = listOf(rain, fire, road)

    private val scheduler = FakeScheduler()
    private val store = MemoryPreferences()
    private var wallClock = 1_000_000L
    private var recentChanges = 0

    private fun history(store: PreferenceStore = this.store) =
        ListeningHistory(store, scheduler, { scheduler.now }, { wallClock + scheduler.now }) { recentChanges++ }

    private val stopped = PlayerState.restored(tracks, MemoryPreferences())

    private fun playing(track: Track) = stopped.copy(track = track, isPlaying = true)

    @Test
    fun aListenCountsAsAPlayOnceItReachesThirtySeconds() {
        val history = history()
        history.onState(playing(rain))
        scheduler.advance(COUNTS_AFTER_MS - 1)
        assertEquals(Totals(0, 0, null), history.totals(rain))

        scheduler.advance(1)
        assertEquals(Totals(1, COUNTS_AFTER_MS, wallClock + COUNTS_AFTER_MS), history.totals(rain))
        assertEquals(1, recentChanges)
    }

    // Skipping through tracks adds their time but neither counts nor reorders.
    @Test
    fun aShortListenAddsItsTimeOnly() {
        val history = history()
        history.onState(playing(rain))
        scheduler.advance(5_000)
        history.onState(playing(fire))

        assertEquals(Totals(0, 5_000, null), history.totals(rain))
        assertEquals(0, recentChanges)
    }

    @Test
    fun timeAndPlaysAddUpAcrossListens() {
        val history = history()
        repeat(2) {
            history.onState(playing(rain))
            scheduler.advance(45_000)
            history.onState(stopped)
        }
        assertEquals(Totals(2, 90_000, wallClock + 75_000), history.totals(rain))
    }

    // A forced close runs no code: what was saved before it is what is kept.
    @Test
    fun aLongListenIsSavedEveryMinuteSoAForcedCloseLosesLittle() {
        val history = history()
        history.onState(playing(rain))
        scheduler.advance(COUNTS_AFTER_MS + 2 * SAVE_EVERY_MS + 59_000)

        assertEquals(COUNTS_AFTER_MS + 2 * SAVE_EVERY_MS, history.totals(rain).listenedMillis)
        assertEquals(1, history.totals(rain).plays)
    }

    @Test
    fun loadingIsNotListening() {
        val history = history()
        history.onState(playing(rain).copy(isLoading = true))
        scheduler.advance(COUNTS_AFTER_MS)
        history.onState(stopped)
        assertEquals(Totals(0, 0, null), history.totals(rain))
    }

    @Test
    fun closingEndsTheListen() {
        val history = history()
        history.onState(playing(rain))
        scheduler.advance(10_000)
        history.close()
        scheduler.advance(SAVE_EVERY_MS * 5)
        assertEquals(10_000, history.totals(rain).listenedMillis)
    }

    @Test
    fun shortcutsPutTheMostRecentlyListenedFirstThenTheDefaults() {
        val history = history()
        assertEquals(listOf(fire, road), history.shortcuts(tracks, defaults = listOf(fire, road), count = 2))

        for (track in listOf(road, rain)) {
            history.onState(playing(track))
            scheduler.advance(COUNTS_AFTER_MS)
        }
        history.onState(stopped)
        assertEquals(listOf(rain, road, fire), history.shortcuts(tracks, defaults = listOf(fire, road), count = 3))
        assertEquals(listOf(rain), history.shortcuts(tracks, defaults = listOf(fire, road), count = 1))
    }

    @Test
    fun aDamagedEntryReadsAsNothingListened() {
        val history = history(MemoryPreferences("track.rain" to "garbage"))
        assertEquals(Totals(0, 0, null), history.totals(rain))
    }
}
