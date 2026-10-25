package com.builduseful.soundscape.e2e

import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Cold start, gated: the time the system reports from launch to the app's
 * first frame, the median of several launches each from a killed process.
 *
 * On an emulator, so it runs on every change in CI. Emulators draw in
 * software and vary from one machine to the next, so the budget catches a
 * design going wrong (work added to the start), not tens of milliseconds;
 * StartupBenchmark measures finely on a phone. Raise it only with the
 * maintainer's agreement.
 *
 * Gated on phones only. A tablet or an unfolded foldable runs the same start
 * with more pixels to draw in software, which on CI's emulators puts it at
 * the budget by chance; its time is logged, and the test is skipped there.
 */
@RunWith(AndroidJUnit4::class)
class StartupBudgetTest {
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @After
    fun leave() {
        device.executeShellCommand("am force-stop $APP")
        device.pressHome()
    }

    @Test
    fun coldStartIsQuick() {
        // The first launch after an install also verifies and compiles code; a listener's never does twice.
        coldStart()
        val times = List(LAUNCHES) { coldStart() }.sorted()
        val median = times[LAUNCHES / 2]
        Log.i(TAG, "API ${android.os.Build.VERSION.SDK_INT}: cold start median $median ms of $times")
        val phone = InstrumentationRegistry.getInstrumentation().context.resources.configuration.smallestScreenWidthDp < 600
        assumeTrue("cold start median $median ms of $times, on a large screen: logged, not gated", phone)
        assertTrue("cold start median $median ms of $times; the budget is $BUDGET_MS ms", median <= BUDGET_MS)
    }

    /** Kills the app, launches it, and answers the system's time to its first frame. */
    private fun coldStart(): Long {
        val output = device.executeShellCommand("am start -W -S -n $APP/.MainActivity")
        // Settled, so the next launch is not timed against this one's work.
        SystemClock.sleep(SETTLE_MS)
        val time = Regex("TotalTime: (\\d+)").find(output)?.groupValues?.get(1)
        return checkNotNull(time) { "no launch time in: $output" }.toLong()
    }

    private companion object {
        const val APP = "com.builduseful.soundscape"
        const val TAG = "StartupBudgetTest"
        const val LAUNCHES = 5
        const val SETTLE_MS = 2_000L
        const val BUDGET_MS = 3_000L
    }
}
