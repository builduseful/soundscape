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
// (LoopMixerTest, LoopPcmTest); this proves the device side: the output is fed
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

    // Loads finish out of order: a long track asked for first and a short one
    // second must still end on the second, whichever decode is quicker.
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

    // The most audio the engine ever holds is the track playing, the one fading
    // out, and one decoding. Skipping fast between the two longest tracks while
    // playing reaches that, and must fit the smallest heap in the matrix.
    @Test
    fun rapidChangesBetweenTheLongestTracksFitInMemory() {
        harness.loaded("heavy-thunderstorm", play = true)
        repeat(6) { round ->
            harness.loaded(if (round % 2 == 0) "rain-thunder" else "heavy-thunderstorm", play = true)
            harness.sleep(100) // inside the crossfade
        }
        val runtime = Runtime.getRuntime()
        Log.i(
            TAG,
            "API ${Build.VERSION.SDK_INT}: heap limit ${runtime.maxMemory() / 1048576} MB, " +
                "in use ${(runtime.totalMemory() - runtime.freeMemory()) / 1048576} MB",
        )
        assertEquals(0, engine.underrunCount)
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
        harness.onMain { engine.load(harness.track("rain").copy(id = "no-such-track"), play = true) { pending.finish(it) } }
        val error = pending.await()

        assertTrue(error != null && error !is CancellationException)
        assertEquals("rain", harness.onMain { engine.loadedTrack?.id })
        assertFalse(harness.onMain { engine.isPlaying })
    }

    private companion object {
        const val TAG = "LoopingAudioEngineTest"
    }
}
