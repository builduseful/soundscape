package com.builduseful.soundscape.core

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * The engine's output: the current loop, and while a track change is fading,
 * the outgoing one under it. Interleaved 16-bit PCM in, the same out.
 *
 * The change is the web's equal-power crossfade: the incoming loop rises on
 * `sin(t·π/2)` while the outgoing one falls on `cos(t·π/2)`, from whatever level
 * it had — so a change that interrupts a change never jumps. Renders without
 * allocating.
 */
class LoopMixer(private val channels: Int, private val crossfadeFrames: Int, maxFrames: Int) {
    init {
        require(channels > 0 && crossfadeFrames > 0 && maxFrames > 0)
    }

    private val under = ShortArray(maxFrames * channels)

    private var current: LoopReader? = null
    private var outgoing: LoopReader? = null
    private var outgoingStartGain = 1.0
    private var fadedFrames = 0

    val isCrossfading: Boolean get() = outgoing != null

    /** Makes [reader] the current loop: at once, or by crossfading out of the one playing. */
    fun switchTo(reader: LoopReader, crossfade: Boolean) {
        val from = current
        if (crossfade && from != null) {
            outgoingStartGain = if (isCrossfading) incomingGain() else 1.0
            outgoing = from
        } else {
            outgoing = null
        }
        current = reader
        fadedFrames = 0
    }

    /** Ends any crossfade now, at the incoming loop's full level. */
    fun finishCrossfade() {
        outgoing = null
    }

    /** Fills [out] with [frames] frames: silence if there is no loop yet. */
    fun render(out: ShortArray, frames: Int) {
        require(frames * channels <= out.size && frames * channels <= under.size) { "$frames frames do not fit" }
        val loop = current
        if (loop == null) {
            out.fill(0, 0, frames * channels)
            return
        }
        loop.read(out, frames)

        val fading = outgoing ?: return
        fading.read(under, frames)
        for (frame in 0 until frames) {
            if (fadedFrames >= crossfadeFrames) {
                // Past the end the outgoing gain is exactly zero: drop it.
                outgoing = null
                return
            }
            val gainIn = incomingGain()
            val gainOut = cos(fadedFrames.toDouble() / crossfadeFrames * PI / 2) * outgoingStartGain
            for (c in 0 until channels) {
                val i = frame * channels + c
                out[i] = (out[i] * gainIn + under[i] * gainOut).roundToInt().coerceIn(-32768, 32767).toShort()
            }
            fadedFrames++
        }
        if (fadedFrames >= crossfadeFrames) outgoing = null
    }

    private fun incomingGain() = sin(fadedFrames.toDouble() / crossfadeFrames * PI / 2)
}
