package com.builduseful.soundscape.audio

import android.content.res.AssetManager
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import com.builduseful.soundscape.core.oggOpusFrameCount
import java.nio.ByteOrder
import java.nio.ShortBuffer
import java.util.concurrent.CancellationException
import kotlin.math.roundToInt

/** A whole file decoded to 16-bit PCM, interleaved, at its own sample rate. */
class DecodedAudio(val sampleRate: Int, val channels: Int, val pcm: ShortArray, val decoderName: String) {
    val frames: Int get() = pcm.size / channels
}

/**
 * Decodes a bundled Ogg Opus asset completely, with the platform's own
 * extractor and codec. The loop is built from the whole buffer, so it decodes up
 * front rather than streaming. Opus is the only format the app bundles; see
 * this directory's AGENTS.md for why.
 *
 * 16-bit, not float: the longest soundscape is over a minute, and as float it
 * is 12 MB before a second one is decoded for the crossfade. Older Opus
 * decoders only produce 16-bit anyway.
 *
 * The asset must be stored uncompressed (`noCompress` in app/build.gradle.kts):
 * the extractor reads it through a file descriptor.
 */
object AssetDecoder {
    /**
     * Starts decoding [path]; call it on [handler]'s thread. [done] is called
     * there, once, with the audio or the failure.
     */
    fun decode(assets: AssetManager, path: String, handler: Handler, done: (Result<DecodedAudio>) -> Unit): Decoding =
        Decoding(assets, path, handler, done)
}

/**
 * One decode in progress, driven by the codec's callbacks: MediaCodec's
 * asynchronous mode, which hands over each buffer as it is ready. Every packet
 * is a round trip to the media process, and polling for them (the synchronous
 * mode) took about twice as long on the emulators. Confined to the handler's
 * thread.
 */
class Decoding internal constructor(
    assets: AssetManager,
    path: String,
    handler: Handler,
    private val done: (Result<DecodedAudio>) -> Unit,
) : MediaCodec.Callback() {
    private val extractor = MediaExtractor()
    private var codec: MediaCodec? = null
    private var sink = PcmSink(0)
    private var sampleRate = 0
    private var channels = 0
    private var float = false
    private var finished = false

    init {
        try {
            assets.openFd(path).use { fd -> extractor.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length) }

            val track = (0 until extractor.trackCount).firstOrNull { index ->
                extractor.getTrackFormat(index).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IllegalArgumentException("$path has no audio track")
            extractor.selectTrack(track)

            val format = extractor.getTrackFormat(track)
            val mime = requireNotNull(format.getString(MediaFormat.KEY_MIME))
            require(mime == MediaFormat.MIMETYPE_AUDIO_OPUS) { "$path is $mime, not Opus" }
            sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)

            // The extractor ignores Opus's end-trim, so the decode would carry the
            // encoder's padding onto the loop seam; see oggOpusFrameCount. Knowing
            // the length up front also sizes the buffer exactly, once.
            val exactFrames = requireNotNull(assets.open(path).use { oggOpusFrameCount(it.readBytes()) }) {
                "$path has no readable Ogg Opus length"
            }
            sink = PcmSink((exactFrames * channels).toInt())

            val codec = MediaCodec.createDecoderByType(mime)
            this.codec = codec
            codec.setCallback(this, handler)
            codec.configure(format, null, null, 0)
            codec.start()
        } catch (error: Exception) {
            finish(Result.failure(error))
        }
    }

    /** Stops the decode and frees the codec; [done] gets a [CancellationException]. */
    fun cancel() = finish(Result.failure(CancellationException("decode superseded")))

    override fun onInputBufferAvailable(codec: MediaCodec, index: Int) = step {
        val buffer = requireNotNull(codec.getInputBuffer(index))
        val size = extractor.readSampleData(buffer, 0)
        if (size < 0) {
            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        } else {
            codec.queueInputBuffer(index, 0, size, extractor.sampleTime, 0)
            extractor.advance()
        }
    }

    override fun onOutputFormatChanged(codec: MediaCodec, format: MediaFormat) = step {
        sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        // 16-bit is the default and what is asked for, but a decoder may still
        // choose float.
        float = format.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
            format.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
    }

    override fun onOutputBufferAvailable(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo) = step {
        val buffer = requireNotNull(codec.getOutputBuffer(index))
        buffer.position(info.offset).limit(info.offset + info.size)
        buffer.order(ByteOrder.nativeOrder())
        if (float) {
            val floats = buffer.asFloatBuffer()
            while (floats.hasRemaining()) sink.add(toShort(floats.get()))
        } else {
            sink.add(buffer.asShortBuffer())
        }
        codec.releaseOutputBuffer(index, false)
        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) {
            finish(Result.success(DecodedAudio(sampleRate, channels, sink.toArray(), codecName(codec))))
        }
    }

    override fun onError(codec: MediaCodec, error: MediaCodec.CodecException) = finish(Result.failure(error))

    /** Runs one callback's work; a callback that arrives after the end, or throws, ends the decode. */
    private inline fun step(work: () -> Unit) {
        if (finished) return
        try {
            work()
        } catch (error: Exception) {
            finish(Result.failure(error))
        }
    }

    private fun finish(result: Result<DecodedAudio>) {
        if (finished) return
        finished = true
        release()
        done(result)
    }

    private fun release() {
        codec?.release()
        codec = null
        extractor.release()
    }

    private fun toShort(sample: Float): Short = (sample * 32768f).roundToInt().coerceIn(-32768, 32767).toShort()

    private fun codecName(codec: MediaCodec): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) codec.canonicalName else codec.name
}

/**
 * Where decoded samples collect: sized exactly, so anything past the length —
 * the padding the end-trim removes — is dropped, and the array is handed over
 * without a copy.
 */
private class PcmSink(capacity: Int) {
    private val data = ShortArray(capacity)
    private var size = 0

    fun add(sample: Short) {
        if (size < data.size) data[size++] = sample
    }

    fun add(samples: ShortBuffer) {
        val count = minOf(samples.remaining(), data.size - size)
        samples.get(data, size, count)
        size += count
    }

    fun toArray(): ShortArray = if (size == data.size) data else data.copyOf(size)
}
