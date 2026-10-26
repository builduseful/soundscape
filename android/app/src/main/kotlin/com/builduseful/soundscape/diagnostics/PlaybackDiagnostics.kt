package com.builduseful.soundscape.diagnostics

import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import com.builduseful.soundscape.audio.LoopingAudioEngine
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState
import java.util.Locale

/**
 * TEMPORARY: the player's side of [Diagnostics]: what was asked of it and from
 * where, each play session and what it cost, and how long each track was
 * listened to, and every few minutes while it plays, the battery.
 */
internal class PlaybackDiagnostics(private val engine: LoopingAudioEngine) {
    private var logged: PlayerState? = null
    private var session: Mark? = null
    private var lastReading: Mark? = null
    private var trackSince = 0L
    private var listenedInProcess = 0L
    private val main = Handler(Looper.getMainLooper())
    private val reading = Runnable(::readBattery)

    /** Where the render thread and the battery stood at one moment. */
    private class Mark(val at: Long, val underruns: Int, val cpu: Long, val sleeps: Long, val battery: Diagnostics.Battery)

    private fun mark(): Mark {
        val stats = Diagnostics.threadStats(engine.renderThreadId)
        return Mark(SystemClock.uptimeMillis(), engine.underrunCount, stats?.first ?: 0, stats?.second ?: 0, Diagnostics.battery())
    }

    /** What the render thread did and the battery gave from [from] to [to]. */
    private fun cost(from: Mark, to: Mark): String {
        val seconds = (to.at - from.at) / 1000.0
        val wakeups = if (seconds > 0) String.format(Locale.ROOT, "%.1f", (to.sleeps - from.sleeps) / seconds) else "?"
        return "underruns ${to.underruns - from.underruns}, render CPU ${to.cpu - from.cpu} ms, wake-ups $wakeups a second; " +
            to.battery.since(from.battery)
    }

    // While playing the audio keeps the CPU awake, so this wakes nothing;
    // paused, it is not scheduled at all.
    private fun readBattery() {
        val previous = lastReading ?: return
        val now = mark()
        lastReading = now
        Diagnostics.log("battery", "${cost(previous, now)}; ${Diagnostics.power(now.battery)}")
        main.postDelayed(reading, READING_EVERY_MS)
    }

    fun action(what: String, source: String) = Diagnostics.log("action", "$what ($source)")

    fun focus(change: Int) = Diagnostics.log(
        "focus",
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> "gained"
            AudioManager.AUDIOFOCUS_LOSS -> "lost (another app is playing)"
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> "lost for a moment (a call or a notification)"
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> "ducked (something brief is speaking over)"
            else -> "change $change"
        },
    )

    fun state(state: PlayerState) {
        if (!Diagnostics.ENABLED) return
        val before = logged
        logged = state
        val now = SystemClock.uptimeMillis()
        if (before != null && before.track != state.track) {
            if (before.isPlaying) listened(before, now)
            Diagnostics.log("track", "${state.track.id} (${state.trackChange?.name?.lowercase(Locale.ROOT) ?: "set"})")
        }
        if (before?.notice != state.notice) {
            Diagnostics.log(
                "notice",
                when (val notice = state.notice) {
                    null -> "cleared"
                    Notice.Loading -> "loading shown"
                    is Notice.Failed -> "failed: ${notice.track.id}"
                },
            )
        }
        if ((before?.isPlaying ?: false) == state.isPlaying) return
        if (state.isPlaying) {
            val start = mark()
            session = start
            lastReading = start
            trackSince = now
            main.postDelayed(reading, READING_EVERY_MS)
            Diagnostics.log("play", "${state.track.id} at ${percent(state.volume)}; ${Diagnostics.power(start.battery)}")
            return
        }
        main.removeCallbacks(reading)
        val start = session ?: return
        session = null
        listened(state, now)
        val end = mark()
        listenedInProcess += end.at - start.at
        Diagnostics.log(
            "pause",
            String.format(
                Locale.ROOT,
                "after %.0f s (%.1f min listened since the process started); %s; %s; %s",
                (end.at - start.at) / 1000.0, listenedInProcess / 60_000.0, cost(start, end),
                Diagnostics.power(end.battery), Diagnostics.memory(),
            ),
        )
    }

    /** From a stop being asked for to the service gone. */
    fun stopping(reason: String) = Diagnostics.log("shutdown", "stop: $reason")

    fun destroyed(tookMs: Long, releaseMs: Long) {
        main.removeCallbacks(reading)
        Diagnostics.log("shutdown", "service destroyed in $tookMs ms, of which releasing the audio output $releaseMs ms")
    }

    private fun listened(state: PlayerState, now: Long) {
        Diagnostics.log("listened", "${state.track.id} for ${(now - trackSince) / 1000} s")
        trackSince = now
    }

    private fun percent(volume: Float) = "${(volume * 100).toInt()}%"

    private companion object {
        const val READING_EVERY_MS = 5 * 60_000L
    }
}
