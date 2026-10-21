package com.builduseful.soundscape.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * [loopCrossfade] for the engine: on interleaved 16-bit PCM, in place, so a
 * minute-long loop needs no second copy. Returns the loop length in frames;
 * play `[0, result)`.
 *
 * In place is safe because the overlap writes only the head, and each head
 * sample is read before it is written, while the tail it blends in is never
 * written at all.
 */
fun loopCrossfadeInPlace(pcm: ShortArray, channels: Int, sampleRate: Int, crossfadeMs: Int): Int {
    require(channels > 0 && pcm.size % channels == 0) { "PCM is not whole frames of $channels channels" }
    val length = pcm.size / channels
    require(length >= 2) { "A loop needs at least two frames" }

    val overlap = (crossfadeMs.toDouble() * sampleRate / 1000).roundToInt()
        .coerceAtLeast(1)
        .coerceAtMost(length / 2)
    val loopEnd = length - overlap

    for (i in 0 until overlap) {
        val t = i.toDouble() / overlap
        val fadeOut = cos(t * PI / 2)
        val fadeIn = sin(t * PI / 2)
        for (c in 0 until channels) {
            val head = i * channels + c
            val tail = (loopEnd + i) * channels + c
            pcm[head] = (pcm[tail] * fadeOut + pcm[head] * fadeIn).roundToInt().coerceIn(-32768, 32767).toShort()
        }
    }
    return loopEnd
}

/**
 * Reads a loop forever: `[0, loopFrames)` of [pcm], wrapping at the end with no
 * gap and no repeated frame. The engine pulls from this into the output.
 */
class LoopReader(private val pcm: ShortArray, private val channels: Int, private val loopFrames: Int) {
    init {
        require(loopFrames in 1..pcm.size / channels) { "Loop of $loopFrames frames does not fit the PCM" }
    }

    /** The next frame to be read. */
    var position: Int = 0
        private set

    /** Fills [out] with [frames] frames, wrapping as often as it takes. */
    fun read(out: ShortArray, frames: Int = out.size / channels) {
        require(frames * channels <= out.size) { "$frames frames do not fit the buffer" }
        var written = 0
        while (written < frames) {
            val run = minOf(frames - written, loopFrames - position)
            System.arraycopy(pcm, position * channels, out, written * channels, run * channels)
            written += run
            position = (position + run) % loopFrames
        }
    }
}
