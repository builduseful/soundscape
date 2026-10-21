package com.builduseful.soundscape.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** A decoded loop: play `[0, loopEnd)` of each channel, forever. */
class Loop(val channels: List<FloatArray>, val sampleRate: Int, val loopEnd: Int)

/**
 * Builds a seamless loop by mixing the file's tail into its head and shortening
 * the loop by the overlap — the formula in shared/AGENTS.md, which every
 * platform follows and shared/fixtures/loop-crossfade.json checks.
 *
 * The trim is what makes it work: the sample before the wrap and the sample
 * after it are adjacent in the source. Keeping the full length instead jumps
 * backwards by the overlap at every wrap.
 */
fun loopCrossfade(channels: List<FloatArray>, sampleRate: Int, crossfadeMs: Int): Loop {
    require(channels.isNotEmpty()) { "No channels" }
    val length = channels.first().size
    require(channels.all { it.size == length }) { "Channels differ in length" }
    require(length >= 2) { "A loop needs at least two samples" }

    val overlap = (crossfadeMs.toDouble() * sampleRate / 1000).roundToInt()
        .coerceAtLeast(1)
        .coerceAtMost(length / 2)
    val loopEnd = length - overlap

    val output = channels.map { source ->
        source.copyOf().also { target ->
            for (i in 0 until overlap) {
                val t = i.toDouble() / overlap
                // Equal-power: a linear fade dips in loudness on noise-like sound.
                target[i] = (source[loopEnd + i] * cos(t * PI / 2) + source[i] * sin(t * PI / 2)).toFloat()
            }
        }
    }
    return Loop(output, sampleRate, loopEnd)
}
