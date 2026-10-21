package com.builduseful.soundscape.audio

import android.content.res.AssetManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.Process
import android.util.Log
import com.builduseful.soundscape.core.LoopMixer
import com.builduseful.soundscape.core.LoopReader
import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.loopCrossfadeInPlace
import com.builduseful.soundscape.core.playback.AudioEngine
import java.util.concurrent.CancellationException
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** What the sound is, for the output and for audio focus alike. */
internal val mediaAttributes: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
    .build()

/**
 * The [AudioEngine] on the platform: bundled Opus decoded whole, looped
 * gaplessly, and streamed to one AudioTrack. See this directory's AGENTS.md.
 *
 * Three threads, each with one job. The main thread makes every call and gets
 * every callback. One decode thread loads tracks, one at a time, from the
 * codec's callbacks; a newer load cancels an older one mid-decode. One render thread owns the AudioTrack: it
 * mixes a chunk, blocks on write(), and while paused waits on [lock] — no
 * timers, and nothing runs at all.
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
    private val decodeThread = HandlerThread("soundscape-decode").apply { start() }
    private val decodeHandler = Handler(decodeThread.looper)

    // --- Decode thread only ---
    /** The one decode in progress; a newer load cancels it. */
    private var decoding: Decoding? = null

    // --- Shared with the render thread, guarded by [lock] ---
    private val lock = ReentrantLock()
    private val changed = lock.newCondition()
    private var output: Output? = null
    private var wantPlaying = false
    /** Counts requests to play, so news that the output failed is not applied to a later one. */
    private var playRequest = 0
    private var released = false

    /** The render thread's id, for tests that measure it. 0 until it starts. */
    @Volatile internal var renderThreadId = 0
        private set

    override fun load(track: Track, play: Boolean, done: (Throwable?) -> Unit) {
        val id = ++loadId
        pendingPlay = play
        if (track == loadedTrack) {
            setPlaying(play)
            main.post { done(if (id == loadId) null else CancellationException("load superseded")) }
            return
        }
        decodeHandler.post {
            decoding?.cancel()
            decoding = AssetDecoder.decode(assets, "opus/${track.id}.opus", decodeHandler) { decoded ->
                decoding = null
                val result = decoded.mapCatching { audio ->
                    audio to loopCrossfadeInPlace(
                        audio.pcm, audio.channels, audio.sampleRate, DesignTokens.Duration.loopCrossfade.toInt(),
                    )
                }
                main.post {
                    if (id != loadId) {
                        done(result.exceptionOrNull() ?: CancellationException("load superseded"))
                        return@post
                    }
                    done(result.mapCatching { (audio, loopEnd) -> install(track, audio, loopEnd) }.exceptionOrNull())
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
        decodeHandler.post {
            decoding?.cancel()
            decoding = null
        }
        decodeThread.quitSafely()
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

    private fun install(track: Track, audio: DecodedAudio, loopEnd: Int) {
        lock.withLock {
            val out = output ?: Output(audio.sampleRate, audio.channels).also {
                it.track.setVolume(volume)
                output = it
            }
            check(out.sampleRate == audio.sampleRate && out.channels == audio.channels) {
                "${track.id} is ${audio.sampleRate} Hz × ${audio.channels}; the output is ${out.sampleRate} Hz × ${out.channels}"
            }
            out.mixer.switchTo(LoopReader(audio.pcm, audio.channels, loopEnd), crossfade = wantPlaying && pendingPlay)
            out.start()
        }
        loadedTrack = track
        setPlaying(pendingPlay)
    }

    private fun setPlaying(playing: Boolean) {
        isPlaying = playing && loadedTrack != null
        lock.withLock {
            if (isPlaying && !wantPlaying) playRequest++
            wantPlaying = isPlaying
            // Nothing is heard while paused, so a change still fading out can
            // end now, and its audio be let go.
            if (!wantPlaying) output?.mixer?.finishCrossfade()
            changed.signalAll()
        }
    }

    /** The AudioTrack, its format, and the thread that feeds it. Created once, by the first load. */
    private inner class Output(val sampleRate: Int, val channels: Int) {
        private val chunkFrames = sampleRate / 50 // 20 ms between writes
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
            // About a tenth of a second: short enough that a skip is heard
            // promptly, with room for the writer to be late now and then.
            val bytes = maxOf(minBytes, sampleRate / 10 * channels * 2)
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
            return track
        }

        // The AudioTrack is only paused, flushed and started here, between
        // writes, so a blocking write never waits on a paused track.
        private fun render() {
            Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
            renderThreadId = Process.myTid()
            val chunk = ShortArray(chunkFrames * channels)
            var running = false
            while (true) {
                lock.withLock {
                    while (!wantPlaying && !released) {
                        if (running) {
                            // Flushed, so a track changed while paused does not
                            // begin with the old one's last tenth of a second.
                            track.pause()
                            track.flush()
                            running = false
                        }
                        changed.await()
                    }
                    if (released) {
                        if (running) track.stop()
                        return
                    }
                    if (!running) running = startTrack(chunk)
                    mixer.render(chunk, chunkFrames)
                }
                if (running) track.write(chunk, 0, chunk.size, AudioTrack.WRITE_BLOCKING)
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

    private fun outputStopped(request: Int) {
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
