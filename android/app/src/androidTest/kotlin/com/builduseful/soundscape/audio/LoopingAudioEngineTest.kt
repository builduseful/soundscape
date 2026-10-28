package com.builduseful.soundscape.audio

import android.os.Build
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CancellationException

// The engine on a real output. What the mixing does is proven on the JVM
// (LoopMixerTest, LoopReaderTest); this proves the device side: the output is fed
// without a gap through plays, changes and pauses, a superseded load never
// wins, and nothing runs while paused.
@RunWith(AndroidJUnit4::class)
class LoopingAudioEngineTest {
    private val harness = EngineHarness()
    private val engine get() = harness.engine

    @After
    fun release() = harness.close()

    @Test
    fun playsThroughChangesAndPausesWithoutUnderrun() {
        harness.loaded("rain", play = true)
        assertTrue(harness.onMain { engine.isPlaying })
        harness.sleep(1_500)

        harness.loaded("fireplace", play = true) // crossfades
        harness.sleep(1_500)

        val beforePause = engine.underrunCount
        harness.onMain { engine.pause() }
        harness.sleep(300)
        // API 29 counts pausing a stream with audio still queued as an
        // underrun; the pause is the silence, so only playing time is checked.
        val afterPause = engine.underrunCount
        harness.onMain { engine.play() }
        harness.sleep(1_000)
        val afterResume = engine.underrunCount - afterPause

        Log.i(TAG, "API ${Build.VERSION.SDK_INT}: underruns $beforePause playing, ${afterPause - beforePause} at pause, $afterResume after resuming")
        assertEquals("the output ran dry while playing and changing track", 0, beforePause)
        assertEquals("the output ran dry after resuming", 0, afterResume)
    }

    // Two loads in one turn — a skip and another before the first lands — must
    // end on the second, and the first must say it was superseded.
    @Test
    fun aSupersededLoadNeverReplacesTheNewerOne() {
        for ((first, second) in listOf("heavy-thunderstorm" to "rain", "rain" to "heavy-thunderstorm")) {
            // In one main-thread turn, so the first cannot finish in between.
            val (older, newer) = harness.onMain {
                harness.startLoad(first, play = false) to harness.startLoad(second, play = false)
            }

            assertTrue("the older load is reported as superseded", older.await() is CancellationException)
            assertNull(newer.await())
            assertEquals(second, harness.onMain { engine.loadedTrack?.id })
        }
    }

    // Skipping fast while playing, each change landing inside the last one's
    // crossfade, interrupts a change mid-fade every time: the output stays fed.
    @Test
    fun rapidChangesKeepTheOutputFed() {
        harness.loaded("heavy-thunderstorm", play = true)
        repeat(6) { round ->
            harness.loaded(if (round % 2 == 0) "rain-thunder" else "heavy-thunderstorm", play = true)
            harness.sleep(100) // inside the crossfade
        }
        assertEquals(0, engine.underrunCount)
    }

    // A cut is done only once the new track is being heard, however it ends:
    // played, superseded by another cut, or paused. Each is told exactly once.
    @Test
    fun aCutIsDoneOnceItsTrackIsHeard() {
        harness.loaded("rain", play = true)
        assertNull(harness.load("garden-rain", play = true, cut = true).await())
        assertTrue(harness.onMain { engine.isPlaying })

        // Each installed in its own turn, the second most likely while the
        // first still waits on the render thread.
        val first = harness.load("pink-noise", play = true, cut = true)
        val second = harness.load("brown-noise", play = true, cut = true)
        assertNull(first.await())
        assertNull(second.await())
        assertEquals("brown-noise", harness.onMain { engine.loadedTrack?.id })

        val paused = harness.onMain {
            harness.startLoad("rain", play = true, cut = true).also { engine.pause() }
        }
        assertNull(paused.await())
        assertFalse(harness.onMain { engine.isPlaying })
    }

    @Test
    fun pausingDuringALoadLandsItPaused() {
        val load = harness.load("garden-rain", play = true)
        harness.onMain { engine.pause() }

        assertNull(load.await())
        assertEquals("garden-rain", harness.onMain { engine.loadedTrack?.id })
        assertFalse(harness.onMain { engine.isPlaying })
    }

    @Test
    fun loadingTheTrackAlreadyLoadedOnlyAppliesPlay() {
        harness.loaded("pink-noise", play = false)
        harness.loaded("pink-noise", play = true)
        assertTrue(harness.onMain { engine.isPlaying })
    }

    @Test
    fun anUnknownTrackFailsItsLoadAndLeavesTheEngineAsItWas() {
        harness.loaded("rain", play = false)
        val pending = EngineHarness.PendingLoad()
        harness.onMain { engine.load(harness.track("rain").copy(id = "no-such-track"), play = true, cut = false) { pending.finish(it) } }
        val error = pending.await()

        assertTrue(error != null && error !is CancellationException)
        assertEquals("rain", harness.onMain { engine.loadedTrack?.id })
        assertFalse(harness.onMain { engine.isPlaying })
    }

    private companion object {
        const val TAG = "LoopingAudioEngineTest"
    }
}
