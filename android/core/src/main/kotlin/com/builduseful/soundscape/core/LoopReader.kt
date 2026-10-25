package com.builduseful.soundscape.core

import java.nio.Buffer
import java.nio.ShortBuffer

/**
 * Plays a loop forever: all of [pcm], interleaved 16-bit, start to end and round
 * again, with no gap and no repeated frame. The file is the loop — its seam is
 * made in the audio, not here — so this only has to wrap. The engine pulls from
 * this into the output.
 */
class LoopReader(pcm: ShortBuffer, private val channels: Int) {
    private val samples = pcm.slice()
    // Through Buffer: ShortBuffer's own position(Int) is newer than Android 8.
    private val cursor: Buffer = samples

    init {
        require(channels > 0 && samples.remaining() % channels == 0) { "PCM is not whole frames of $channels channels" }
        require(samples.hasRemaining()) { "A loop needs at least one frame" }
    }

    private val frames = samples.remaining() / channels

    /** The next frame to be read. */
    var position: Int = 0
        private set

    /** Fills [out] with [count] frames, wrapping as often as it takes. */
    fun read(out: ShortArray, count: Int = out.size / channels) {
        require(count * channels <= out.size) { "$count frames do not fit the buffer" }
        var written = 0
        while (written < count) {
            val run = minOf(count - written, frames - position)
            cursor.position(position * channels)
            samples.get(out, written * channels, run * channels)
            written += run
            position = (position + run) % frames
        }
    }
}
