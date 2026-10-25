package com.builduseful.soundscape.diagnostics

import android.app.Activity
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window

/**
 * TEMPORARY: the screen's side of [Diagnostics]: how each launch went, and
 * how smoothly frames were drawn while it was visible.
 */
internal class ScreenDiagnostics(private val activity: Activity) {
    private var createdAt = 0L
    /** When the screen was last asked for: created, or brought back to the front. */
    private var launchedAt = 0L
    private var startedByCreate = false
    private var connected = false
    private var visibleSince = 0L

    // Counted on the frames thread, read on the main thread at onStop.
    @Volatile private var frames = 0
    @Volatile private var janky = 0
    @Volatile private var slow = 0
    @Volatile private var worstMs = 0L
    private var frameBudgetMs = 16L

    private val frameListener = Window.OnFrameMetricsAvailableListener { _, metrics, _ -> onFrame(metrics) }

    fun created(recreated: Boolean, shortcut: String?) {
        if (!Diagnostics.ENABLED) return
        createdAt = SystemClock.uptimeMillis()
        launchedAt = createdAt
        startedByCreate = true
        Diagnostics.start(activity)
        val kind = when {
            firstInProcess -> "cold"
            recreated -> "warm (recreated)"
            else -> "warm"
        }
        firstInProcess = false
        val refreshRate = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            activity.display?.refreshRate
        } else {
            @Suppress("DEPRECATION")
            activity.windowManager.defaultDisplay.refreshRate
        } ?: 60f
        frameBudgetMs = (1000 / refreshRate).toLong()
        Diagnostics.log(
            "launch",
            "$kind, onCreate ${Diagnostics.sinceProcessStart()} ms after the process started, display $refreshRate Hz" +
                (shortcut?.let { ", from the shortcut for $it" } ?: ""),
        )
        activity.window.addOnFrameMetricsAvailableListener(frameListener, frameHandler)
    }

    fun connected() {
        if (!Diagnostics.ENABLED || connected) return
        connected = true
        Diagnostics.log("launch", "player connected ${SystemClock.uptimeMillis() - createdAt} ms after onCreate")
    }

    fun started() {
        if (!Diagnostics.ENABLED) return
        visibleSince = SystemClock.uptimeMillis()
        frames = 0
        janky = 0
        slow = 0
        worstMs = 0
        if (!startedByCreate) {
            launchedAt = visibleSince
            Diagnostics.log("launch", "hot, brought back to the front")
        }
        startedByCreate = false
    }

    fun stopped(playing: Boolean) {
        if (!Diagnostics.ENABLED) return
        val seconds = (SystemClock.uptimeMillis() - visibleSince) / 1000
        Diagnostics.log(
            "screen",
            "hidden after $seconds s, ${if (playing) "still playing" else "paused"}; " +
                "$frames frames drawn, $janky over budget, $slow over 50 ms, worst $worstMs ms",
        )
    }

    fun destroyed() {
        if (!Diagnostics.ENABLED) return
        activity.window.removeOnFrameMetricsAvailableListener(frameListener)
        Diagnostics.log("screen", "destroyed${if (activity.isFinishing) ", finishing" else ", to be recreated"}")
    }

    fun action(what: String) = Diagnostics.log("action", "$what (screen)")

    private fun onFrame(metrics: FrameMetrics) {
        val totalMs = metrics.getMetric(FrameMetrics.TOTAL_DURATION) / 1_000_000
        if (metrics.getMetric(FrameMetrics.FIRST_DRAW_FRAME) == 1L) {
            // In System.nanoTime, which is uptime too: when the frame was due, plus how long it took.
            val doneAt = (metrics.getMetric(FrameMetrics.INTENDED_VSYNC_TIMESTAMP) + metrics.getMetric(FrameMetrics.TOTAL_DURATION)) / 1_000_000
            Diagnostics.log(
                "launch",
                "first frame done ${doneAt - launchedAt} ms after ${if (launchedAt == createdAt) "onCreate" else "onStart"}, " +
                    "${doneAt - SystemClock.uptimeMillis() + Diagnostics.sinceProcessStart()} ms after the process started; " +
                    "drawing it took $totalMs ms",
            )
            return
        }
        frames++
        if (totalMs > frameBudgetMs) janky++
        if (totalMs > 50) {
            slow++
            Diagnostics.log("jank", "a frame took $totalMs ms")
        }
        if (totalMs > worstMs) worstMs = totalMs
    }

    private companion object {
        /** No activity has been created in this process yet. */
        var firstInProcess = true

        val frameHandler: Handler by lazy { Handler(HandlerThread("soundscape-frames").apply { start() }.looper) }
    }
}
