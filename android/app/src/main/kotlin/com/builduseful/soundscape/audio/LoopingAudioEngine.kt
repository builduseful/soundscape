package com.builduseful.soundscape.audio

import android.content.res.AssetManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.util.Log
import com.builduseful.soundscape.core.LoopMixer
import com.builduseful.soundscape.core.LoopReader
import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.playback.AudioEngine
import com.builduseful.soundscape.diagnostics.Diagnostics
import java.util.concurrent.CancellationException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What the sound is, for the output and for audio focus alike. */
internal val mediaAttributes: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()

/**
 * The [AudioEngine] on the platform: each bundled loop mapped from the APK as
 * 16-bit PCM and streamed to one AudioTrack. See this directory's AGENTS.md.
 *
 * Two threads. The main thread makes every call, loads every track and gets
 * every callback: a load only maps a file. One render thread owns the
 * AudioTrack: it mixes a chunk, blocks on write(), and while paused waits on
 * [lock] — no timers, and nothing runs at all.
 */
class LoopingAudioEngine(
    private val assets: AssetManager,
    private val main: Handler = Handler(Looper.getMainLooper()),
) : AudioEngine {
    // --- Main thread only ---
    override var loadedTrack: Track? = null
        private set
    override var isPlaying = false
        private set
    private var pendingPlay = false
    private var volume = 1f
    private var onStopped: () -> Unit = {}
    private var loadId = 0
    /** TEMPORARY diagnostics: when sound was last asked for. */
    private var playRequestedAt = 0L

    // --- Shared with the render thread, guarded by [lock] ---
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private var output: Output? = null
    private var wantPlaying = false
    /**
     * A cut's [load], waiting for its track to be heard: told once the render
     * thread has let go of the old track's queued audio and started afresh,
     * or once paused, when nothing is heard anyway.
     */
    private var cutHeard: (() -> Unit)? = null
    /** Counts requests to play, so news that the output failed is not applied to a later one. */
    private var playRequest = 0
    private var released = false

    /** The render thread's id, for tests that measure it. 0 until it starts. */
    @Volatile internal var renderThreadId = 0
        private set

    override fun load(track: Track, play: Boolean, cut: Boolean, done: (Throwable?) -> Unit) {
        val id = ++loadId
        pendingPlay = play
        val requestedAt = SystemClock.uptimeMillis()
        // On the next turn, as the port promises: the caller finishes its own
        // update first, and of two loads in one turn only the later is applied.
        main.post {
            when {
                id != loadId -> done(CancellationException("load superseded"))
                track == loadedTrack -> {
                    setPlaying(pendingPlay)
                    done(null)
                }
                else -> {
                    val startedAt = SystemClock.uptimeMillis()
                    val error = runCatching {
                        install(track, mapLoop(assets, "soundscapes/${track.id}.wav"), cut) { done(null) }
                    }.exceptionOrNull()
                    Diagnostics.log(
                        if (error == null) "load" else "issue",
                        "load ${track.id}: ${error ?: "mapped"} in ${SystemClock.uptimeMillis() - startedAt} ms, " +
                            "${startedAt - requestedAt} ms after it was asked for",
                    )
                    if (error != null) done(error)
                }
            }
        }
    }

    override fun play() {
        checkNotNull(loadedTrack) { "Nothing is loaded" }
        setPlaying(true)
    }

    override fun pause() {
        pendingPlay = false
        setPlaying(false)
    }

    override fun setVolume(volume: Float) {
        this.volume = volume
        // Applied by the system mixer as the audio leaves the buffer, so a
        // change is heard at once rather than a buffer later, and ramped there
        // so it never clicks.
        lock.withLock { output?.track?.setVolume(volume) }
    }

    override fun setOnStopped(listener: () -> Unit) {
        onStopped = listener
    }

    /** Stops playback for good and frees the output. The engine cannot be used again. */
    fun release() {
        loadId++
        val thread = lock.withLock {
            released = true
            changed.signalAll()
            output?.thread
        }
        thread?.join()
        lock.withLock {
            output?.track?.release()
            output = null
        }
    }

    /** Calls [switched] once the switch has happened: at once, or after a cut, once it is heard. */
    private fun install(track: Track, loop: LoopAsset, cut: Boolean, switched: () -> Unit) {
        val waits = lock.withLock {
            val out = output ?: Output(loop.sampleRate, loop.channels).also {
                it.track.setVolume(volume)
                output = it
            }
            check(out.sampleRate == loop.sampleRate && out.channels == loop.channels) {
                "${track.id} is ${loop.sampleRate} Hz × ${loop.channels}; the output is ${out.sampleRate} Hz × ${out.channels}"
            }
            out.mixer.switchTo(LoopReader(loop.pcm, loop.channels), crossfade = !cut && wantPlaying && pendingPlay)
            out.start()
            // Paused, the old track's audio is already let go of.
            if (!cut || !wantPlaying) return@withLock false
            // One this supersedes is past waiting: its switch has happened.
            tellCutHeard()
            cutHeard = switched
            true
        }
        loadedTrack = track
        setPlaying(pendingPlay)
        if (!waits) switched()
    }

    private fun setPlaying(playing: Boolean) {
        isPlaying = playing && loadedTrack != null
        lock.withLock {
            if (isPlaying && !wantPlaying) {
                playRequest++
                playRequestedAt = SystemClock.uptimeMillis()
            }
            wantPlaying = isPlaying
            // Nothing is heard while paused, so a change still fading out can
            // end now, and its audio be let go.
            if (!wantPlaying) output?.mixer?.finishCrossfade()
            changed.signalAll()
        }
    }

    /** The AudioTrack, its format, and the thread that feeds it. Created once, by the first load. */
    private inner class Output(val sampleRate: Int, val channels: Int) {
        // 100 ms between writes. The thread sleeps until there is room for a
        // whole chunk, so the larger it is the less often it wakes: half as
        // often as 20 ms chunks, measured on API 26 and 37.
        private val chunkFrames = sampleRate / 10
        val mixer = LoopMixer(
            channels,
            crossfadeFrames = (sampleRate * DesignTokens.Duration.trackCrossfade / 1000).toInt(),
            maxFrames = chunkFrames,
        )
        val track: AudioTrack = buildTrack()
        val thread = Thread(::render, "soundscape-render")
        private var started = false

        fun start() {
            if (started) return
            started = true
            thread.start()
        }

        private fun buildTrack(): AudioTrack {
            val mask = if (channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
            val minBytes = AudioTrack.getMinBufferSize(sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
            // About a quarter of a second: room for a chunk and a half besides
            // the one being written, and still short enough that a skip is
            // heard promptly.
            val bytes = maxOf(minBytes, sampleRate / 4 * channels * 2)
            val track = AudioTrack.Builder()
                .setAudioAttributes(mediaAttributes)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(sampleRate)
                        .setChannelMask(mask)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .build(),
                )
                .setBufferSizeInBytes(bytes)
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build()
            if (track.state != AudioTrack.STATE_INITIALIZED) {
                track.release()
                error("The audio output could not be opened")
            }
            Diagnostics.log(
                "output",
                "opened: $sampleRate Hz × $channels, buffer ${track.bufferSizeInFrames} frames " +
                    "(${bytes / (channels * 2)} asked for, ${minBytes / (channels * 2)} the least allowed), chunks of $chunkFrames",
            )
            return track
        }

        // The AudioTrack is only paused, flushed and started here, between
        // writes, so a blocking write never waits on a paused track.
        private fun render() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            renderThreadId = Process.myTid()
            val chunk = ShortArray(chunkFrames * channels)
            var running = false
            // TEMPORARY diagnostics: underruns so far, read afresh at each start as a flush may count as one.
            var underruns = 0

            // Stops the output and drops what is queued: none of it is heard.
            fun letGo() {
                if (!running) return
                track.pause()
                track.flush()
                running = false
            }

            while (true) {
                lock.withLock {
                    while (!wantPlaying && !released) {
                        // So a track changed while paused does not begin
                        // with the old one's last quarter of a second.
                        letGo()
                        tellCutHeard()
                        changed.await()
                    }
                    if (released) {
                        if (running) track.stop()
                        return
                    }
                    // A cut: what is queued is the old track.
                    if (cutHeard != null) letGo()
                    if (!running) {
                        running = startTrack(chunk)
                        underruns = track.underrunCount
                    }
                    tellCutHeard()
                    mixer.render(chunk, chunkFrames)
                }
                if (!running) continue
                val written = track.write(chunk, 0, chunk.size, AudioTrack.WRITE_BLOCKING)
                if (!Diagnostics.ENABLED) continue
                if (written != chunk.size) Diagnostics.log("glitch", "a write took $written of ${chunk.size} samples")
                val now = track.underrunCount
                if (now > underruns) {
                    Diagnostics.log("glitch", "underrun: the output ran dry ${now - underruns} time(s), $now since it opened")
                    underruns = now
                }
            }
        }

        // Filled before play(): starting on an empty buffer is an underrun on
        // older releases (seen on API 26), and an audible gap anywhere.
        private fun startTrack(chunk: ShortArray): Boolean {
            repeat(track.bufferSizeInFrames / chunkFrames - 1) {
                mixer.render(chunk, chunkFrames)
                track.write(chunk, 0, chunk.size, AudioTrack.WRITE_NON_BLOCKING)
            }
            return try {
                track.play()
                if (Diagnostics.ENABLED) {
                    val startedAt = SystemClock.uptimeMillis()
                    val device = Diagnostics.deviceName(track.routedDevice)
                    main.post { Diagnostics.log("output", "started ${startedAt - playRequestedAt} ms after play was asked for, to $device") }
                }
                true
            } catch (error: IllegalStateException) {
                Log.w(TAG, "The audio output would not start", error)
                wantPlaying = false
                val request = playRequest
                main.post { outputStopped(request) }
                false
            }
        }
    }

    // Under [lock].
    private fun tellCutHeard() {
        val heard = cutHeard ?: return
        cutHeard = null
        main.post { heard() }
    }

    private fun outputStopped(request: Int) {
        Diagnostics.log("issue", "the audio output would not start")
        if (request != lock.withLock { playRequest } || !isPlaying) return
        isPlaying = false
        pendingPlay = false
        onStopped()
    }

    internal val underrunCount: Int get() = lock.withLock { output?.track?.underrunCount ?: 0 }

    private companion object {
        const val TAG = "LoopingAudioEngine"
    }
}
