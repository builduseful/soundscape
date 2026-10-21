package com.builduseful.soundscape.core

import com.builduseful.soundscape.core.testing.readShared
import org.junit.Assert.assertEquals
import org.junit.Test

class LoopCrossfadeTest {
    // The gapless loop is the product's core promise, and the web builds it the
    // same way. The fixture is computed from the formula, not from either
    // platform, so this holds Android to the spec rather than to the web.
    @Test
    fun matchesTheSharedFixture() {
        val fixture = readShared("fixtures/loop-crossfade.json") as Map<*, *>
        val tolerance = (fixture["tolerance"] as Double).toFloat()

        for (case in fixture["cases"] as List<*>) {
            case as Map<*, *>
            val name = case["name"]
            val input = case["input"] as Map<*, *>
            val expected = case["expected"] as Map<*, *>

            val loop = loopCrossfade(
                channels = (input["channels"] as List<*>).map(::floats),
                sampleRate = (input["sampleRate"] as Double).toInt(),
                crossfadeMs = (input["crossfadeMs"] as Double).toInt(),
            )

            assertEquals("$name: loop end", (expected["loopEndSamples"] as Double).toInt(), loop.loopEnd)
            (expected["channels"] as List<*>).forEachIndexed { channel, samples ->
                floats(samples).forEachIndexed { i, sample ->
                    assertEquals("$name: channel $channel, sample $i", sample, loop.channels[channel][i], tolerance)
                }
            }
        }
    }

    // The decoded buffer may be reused, so building the loop must not write to it.
    @Test
    fun leavesTheSourceUntouched() {
        val source = floatArrayOf(0.1f, 0.2f, 0.3f, 0.4f, 0.5f, 0.6f)
        val before = source.toList()
        loopCrossfade(listOf(source), sampleRate = 100, crossfadeMs = 10)
        assertEquals(before, source.toList())
    }

    private fun floats(value: Any?) = (value as List<*>).map { (it as Double).toFloat() }.toFloatArray()
}
