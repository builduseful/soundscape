package com.builduseful.soundscape.core

import com.builduseful.soundscape.core.testing.readShared
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs
import kotlin.math.roundToInt

class LoopPcmTest {
    // The engine's 16-bit, in-place crossfade must be the same loop the spec
    // describes: the shared fixture, within 16-bit quantisation.
    @Test
    fun inPlaceCrossfadeMatchesTheSharedFixture() {
        val fixture = readShared("fixtures/loop-crossfade.json") as Map<*, *>

        for (case in fixture["cases"] as List<*>) {
            case as Map<*, *>
            val input = case["input"] as Map<*, *>
            val expected = case["expected"] as Map<*, *>
            val channels = (input["channels"] as List<*>).map { samples -> (samples as List<*>).map { it as Double } }
            val expectedChannels = (expected["channels"] as List<*>).map { samples -> (samples as List<*>).map { it as Double } }
            val frames = channels.first().size

            val pcm = ShortArray(frames * channels.size) { toShort(channels[it % channels.size][it / channels.size]) }
            val loopEnd = loopCrossfadeInPlace(
                pcm,
                channels = channels.size,
                sampleRate = (input["sampleRate"] as Double).toInt(),
                crossfadeMs = (input["crossfadeMs"] as Double).toInt(),
            )

            assertEquals("${case["name"]}: loop end", (expected["loopEndSamples"] as Double).toInt(), loopEnd)
            for (i in pcm.indices) {
                val want = expectedChannels[i % channels.size][i / channels.size]
                // Rounding the input and the output each cost half a step.
                assertEquals("${case["name"]}: sample $i", want, pcm[i] / 32768.0, 1.5 / 32768)
            }
        }
    }

    // Rendering straight across the wrap must play each loop frame once, in
    // order: the sample after the last loop frame is the first one again.
    @Test
    fun theReaderWrapsWithoutAGapOrARepeat() {
        val pcm = ShortArray(20) { it.toShort() } // 10 stereo frames
        val reader = LoopReader(pcm, channels = 2, loopFrames = 7)
        val out = ShortArray(2 * 25)

        reader.read(out)

        val expected = ShortArray(out.size) { i -> ((i / 2 % 7) * 2 + i % 2).toShort() }
        assertArrayEquals(expected, out)
        assertEquals(25 % 7, reader.position)
    }

    @Test
    fun readsInPiecesContinueWhereTheLastOneStopped() {
        val pcm = ShortArray(9) { it.toShort() }
        val whole = ShortArray(40).also { LoopReader(pcm, 1, 9).read(it) }

        val reader = LoopReader(pcm, 1, 9)
        val pieces = ShortArray(40)
        var at = 0
        for (size in listOf(4, 9, 1, 13, 13)) {
            val piece = ShortArray(size)
            reader.read(piece)
            piece.copyInto(pieces, at)
            at += size
        }
        assertArrayEquals(whole, pieces)
    }

    // The point of all of it, on real-shaped material: a noise-like signal whose
    // ends do not meet. Looped as-is, the wrap is a jump; crossfaded, the step
    // across the seam is no bigger than the signal's own steps.
    @Test
    fun theSeamIsNoRougherThanTheSignal() {
        val sampleRate = 48_000
        var seed = 1L
        val pcm = ShortArray(sampleRate) {
            seed = (seed * 6364136223846793005L + 1442695040888963407L)
            ((seed ushr 40).toInt() % 2000 - 1000 + 8000 * kotlin.math.sin(it * 0.01)).roundToInt().toShort()
        }
        val untreatedJump = abs(pcm.last() - pcm.first())

        val loopEnd = loopCrossfadeInPlace(pcm, channels = 1, sampleRate = sampleRate, crossfadeMs = 10)
        val rendered = ShortArray(3 * loopEnd).also { LoopReader(pcm, 1, loopEnd).read(it) }

        val largestStep = (1 until loopEnd).maxOf { abs(rendered[it] - rendered[it - 1]) }
        for (wrap in listOf(loopEnd, 2 * loopEnd)) {
            val seam = abs(rendered[wrap] - rendered[wrap - 1])
            assertTrue("seam $seam vs largest natural step $largestStep", seam <= largestStep)
        }
        assertTrue("the untreated loop should jump ($untreatedJump)", untreatedJump > largestStep)
    }

    private fun toShort(sample: Double): Short = (sample * 32768).roundToInt().coerceIn(-32768, 32767).toShort()
}
