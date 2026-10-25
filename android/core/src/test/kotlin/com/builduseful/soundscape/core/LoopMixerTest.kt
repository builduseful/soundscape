package com.builduseful.soundscape.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ShortBuffer
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

class LoopMixerTest {
    private val fade = 1000

    /** A loop that is [level] throughout, so the output reads straight off as gain. */
    private fun constant(level: Int) = loop(ShortArray(100) { level.toShort() }, channels = 1)

    private fun loop(pcm: ShortArray, channels: Int) = LoopReader(ShortBuffer.wrap(pcm), channels)

    private fun render(mixer: LoopMixer, frames: Int) = ShortArray(frames).also { mixer.render(it, frames) }

    @Test
    fun withNothingLoadedItRendersSilence() {
        val mixer = LoopMixer(channels = 2, crossfadeFrames = fade, maxFrames = 64)
        val out = ShortArray(128) { 7 }
        mixer.render(out, 64)
        assertTrue(out.all { it == 0.toShort() })
    }

    @Test
    fun aSwitchWithoutCrossfadeIsTheNewLoopExactly() {
        val pcm = ShortArray(10) { (it * 100).toShort() }
        val mixer = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = 64)
        mixer.switchTo(constant(5000), crossfade = false)
        mixer.switchTo(loop(pcm, 1), crossfade = false)

        assertArrayEquals(ShortArray(25) { (it % 10 * 100).toShort() }, render(mixer, 25))
        assertFalse(mixer.isCrossfading)
    }

    // The ends of the change: all outgoing at its start, all incoming from its
    // end on, and the outgoing loop let go.
    @Test
    fun theCrossfadeStartsOnTheOldLoopAndEndsExactlyOnTheNew() {
        val mixer = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = 2 * fade)
        mixer.switchTo(constant(0), crossfade = false)
        mixer.switchTo(constant(10_000), crossfade = true)
        // Two loops at different levels would blur the two gains; one at zero
        // reads each gain on its own.
        val rising = render(mixer, 2 * fade)
        assertEquals(0, rising[0].toInt())
        assertEquals(10_000, rising[fade].toInt())
        assertTrue(rising.drop(fade).all { it == 10_000.toShort() })
        assertFalse(mixer.isCrossfading)

        val falling = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = 2 * fade)
        falling.switchTo(constant(10_000), crossfade = false)
        falling.switchTo(constant(0), crossfade = true)
        val out = render(falling, 2 * fade)
        assertEquals(10_000, out[0].toInt())
        assertTrue(out.drop(fade).all { it == 0.toShort() })
    }

    // Equal power: each side is at cos/sin of the same angle, so halfway both
    // are at 1/√2, not ½ — no dip in loudness on noise-like material.
    @Test
    fun theCurvesAreEqualPower() {
        val mixer = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = fade)
        mixer.switchTo(constant(0), crossfade = false)
        mixer.switchTo(constant(10_000), crossfade = true)
        val out = render(mixer, fade)

        for (frame in listOf(1, fade / 4, fade / 2, 3 * fade / 4, fade - 1)) {
            val expected = 10_000 * sin(frame.toDouble() / fade * PI / 2)
            assertEquals("frame $frame", expected, out[frame].toDouble(), 0.5)
        }
        assertEquals(10_000 / kotlin.math.sqrt(2.0), out[fade / 2].toDouble(), 0.5)
    }

    // A change that lands mid-change: the loop that was coming in fades out
    // from the level it had reached, so it never jumps.
    @Test
    fun anInterruptedCrossfadeContinuesFromWhereTheLevelWas() {
        val mixer = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = fade)
        mixer.switchTo(constant(0), crossfade = false)
        mixer.switchTo(constant(10_000), crossfade = true)
        val before = render(mixer, fade / 3)

        mixer.switchTo(constant(0), crossfade = true)
        val after = render(mixer, fade)

        val levelReached = 10_000 * sin((fade / 3).toDouble() / fade * PI / 2)
        assertEquals(levelReached, after[0].toDouble(), 0.5)
        assertTrue("no jump at the switch", kotlin.math.abs(after[0] - before.last()) < 50)
        assertEquals(levelReached * cos(0.5 * PI / 2), after[fade / 2].toDouble(), 0.5)
    }

    @Test
    fun aCrossfadeRenderedInPiecesIsTheSameAsInOne() {
        fun mixer() = LoopMixer(channels = 2, crossfadeFrames = fade, maxFrames = 3 * fade).apply {
            switchTo(loop(ShortArray(2 * 37) { (it * 300 - 9000).toShort() }, 2), crossfade = false)
            switchTo(loop(ShortArray(2 * 53) { (8000 - it * 200).toShort() }, 2), crossfade = true)
        }
        val whole = ShortArray(2 * 3 * fade).also { mixer().render(it, 3 * fade) }

        val pieces = ShortArray(whole.size)
        val chunked = mixer()
        var at = 0
        for (size in generateSequence(7) { it * 2 % 501 + 1 }) {
            val frames = minOf(size, 3 * fade - at)
            if (frames == 0) break
            val piece = ShortArray(2 * frames)
            chunked.render(piece, frames)
            piece.copyInto(pieces, 2 * at)
            at += frames
        }
        assertArrayEquals(whole, pieces)
    }

    @Test
    fun finishingACrossfadeLeavesTheNewLoopAtFullLevel() {
        val mixer = LoopMixer(channels = 1, crossfadeFrames = fade, maxFrames = 10)
        mixer.switchTo(constant(3000), crossfade = false)
        mixer.switchTo(constant(10_000), crossfade = true)
        mixer.finishCrossfade()

        assertFalse(mixer.isCrossfading)
        assertTrue(render(mixer, 10).all { it == 10_000.toShort() })
    }
}
