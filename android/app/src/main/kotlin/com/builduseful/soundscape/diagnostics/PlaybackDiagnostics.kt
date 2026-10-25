package com.builduseful.soundscape.diagnostics

import android.media.AudioManager
import android.os.SystemClock
import com.builduseful.soundscape.audio.LoopingAudioEngine
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState
import java.util.Locale

/**
 * TEMPORARY: the player's side of [Diagnostics]: what was asked of it and from
 * where, each play session and what it cost, and how long each track was
 * listened to.
 */
internal class PlaybackDiagnostics(private val engine: LoopingAudioEngine) {
    private var logged: PlayerState? = null
    private var session: Session? = null
    private var trackSince = 0L
    private var listenedInProcess = 0L

    private class Session(val at: Long, val underruns: Int, val cpu: Long, val sleeps: Long)

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
            val stats = Diagnostics.threadStats(engine.renderThreadId)
            session = Session(now, engine.underrunCount, stats?.first ?: 0, stats?.second ?: 0)
            trackSince = now
            Diagnostics.log("play", "${state.track.id} at ${percent(state.volume)}; ${Diagnostics.power()}")
            return
        }
        val start = session ?: return
        session = null
        listened(state, now)
        val seconds = (now - start.at) / 1000.0
        val stats = Diagnostics.threadStats(engine.renderThreadId)
        val cpu = stats?.let { "${it.first - start.cpu} ms" } ?: "?"
        val wakeups = stats?.takeIf { seconds > 0 }?.let { String.format(Locale.ROOT, "%.1f", (it.second - start.sleeps) / seconds) } ?: "?"
        listenedInProcess += now - start.at
        Diagnostics.log(
            "pause",
            String.format(
                Locale.ROOT,
                "after %.0f s (%.0f min listened since the process started); underruns %d, render CPU %s, " +
                    "wake-ups %s a second; %s; %s",
                seconds, listenedInProcess / 60_000.0, engine.underrunCount - start.underruns, cpu, wakeups,
                Diagnostics.power(), Diagnostics.memory(),
            ),
        )
    }

    /** From a stop being asked for to the service gone. */
    fun stopping(reason: String) = Diagnostics.log("shutdown", "stop: $reason")

    fun destroyed(tookMs: Long, releaseMs: Long) =
        Diagnostics.log("shutdown", "service destroyed in $tookMs ms, of which releasing the audio output $releaseMs ms")

    private fun listened(state: PlayerState, now: Long) {
        Diagnostics.log("listened", "${state.track.id} for ${(now - trackSince) / 1000} s")
        trackSince = now
    }

    private fun percent(volume: Float) = "${(volume * 100).toInt()}%"
}
