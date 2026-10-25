package com.builduseful.soundscape.audio

import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// Performance budgets for the audio path, so a regression in memory or CPU
// fails a test instead of shipping. The budgets are deliberately loose against
// what is measured today (see android/AGENTS.md) — they catch a design going
// wrong, not emulator noise. Raise one only with the maintainer's agreement.
@RunWith(AndroidJUnit4::class)
class AudioBudgetTest {
    // A loop is mapped from the APK, not copied: loading the longest track,
    // 6 MB of PCM, keeps next to nothing on the heap.
    @Test
    fun loadingKeepsTheAudioOffTheHeap() = EngineHarness().use { harness ->
        harness.loaded("rain", play = false) // the output, made once
        val before = usedHeap()
        harness.loaded("heavy-thunderstorm", play = false)
        val kept = usedHeap() - before

        Log.i(TAG, "API ${Build.VERSION.SDK_INT}: heap kept by a load ${kb(kept)}")
        assertTrue("a load kept ${kb(kept)}", kept <= HEAP_SLACK_BYTES)
    }

    // Playing is a copy per 100 ms chunk and a blocking write: the render
    // thread should be asleep nearly all the time.
    @Test
    fun playingCostsAlmostNoCpu() = EngineHarness().use { harness ->
        harness.loaded("rain", play = true)
        harness.sleep(500) // past start-up

        val cpuStart = harness.renderCpuMillis()
        val wallStart = SystemClock.elapsedRealtime()
        harness.sleep(3_000)
        val cpu = harness.renderCpuMillis() - cpuStart
        val wall = SystemClock.elapsedRealtime() - wallStart

        Log.i(TAG, "API ${Build.VERSION.SDK_INT}: render CPU $cpu ms of $wall ms while playing")
        assertTrue("render thread used $cpu ms of CPU in $wall ms", cpu <= wall * RENDER_CPU_SHARE)
    }

    // Each wake-up keeps the CPU out of its deepest sleep, for as long as
    // sound plays: the render thread wakes when the output has room for a
    // chunk, and no more often.
    @Test
    fun playingWakesRarely() = EngineHarness().use { harness ->
        harness.loaded("rain", play = true)
        harness.sleep(500) // past start-up

        val sleepsStart = harness.renderSleeps()
        val wallStart = SystemClock.elapsedRealtime()
        harness.sleep(3_000)
        val perSecond = (harness.renderSleeps() - sleepsStart) * 1000 / (SystemClock.elapsedRealtime() - wallStart)

        Log.i(TAG, "API ${Build.VERSION.SDK_INT}: render wake-ups $perSecond a second while playing")
        assertTrue("render thread woke $perSecond times a second", perSecond <= WAKEUPS_PER_SECOND)
    }

    // Paused means nothing runs: the render thread waits on a condition, so it
    // is never woken and costs no CPU and no battery.
    @Test
    fun nothingRunsWhilePaused() = EngineHarness().use { harness ->
        harness.loaded("rain", play = true)
        harness.sleep(300)
        harness.onMain { harness.engine.pause() }
        harness.sleep(200)

        val cpuStart = harness.renderCpuMillis()
        harness.sleep(2_000)
        val cpu = harness.renderCpuMillis() - cpuStart

        Log.i(TAG, "API ${Build.VERSION.SDK_INT}: render CPU $cpu ms in 2 s paused")
        assertEquals(Thread.State.WAITING, harness.renderThreadState())
        assertEquals("render CPU while paused", 0L, cpu)
    }

    private fun usedHeap(): Long {
        val runtime = Runtime.getRuntime()
        repeat(3) {
            runtime.gc()
            System.runFinalization()
        }
        return runtime.totalMemory() - runtime.freeMemory()
    }

    private fun kb(bytes: Long) = "${bytes / 1024} KB"

    private companion object {
        const val TAG = "AudioBudgetTest"
        const val HEAP_SLACK_BYTES = 512 * 1024L
        const val RENDER_CPU_SHARE = 0.05
        const val WAKEUPS_PER_SECOND = 20L
    }
}
