package com.builduseful.soundscape.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WavTest {
    // The engine maps the samples straight from the file, so the offset must
    // be exact whatever chunks an editor put before them.
    @Test
    fun findsTheSamplesPastOtherChunks() {
        val file = wav(
            chunk("fmt ", fmt(encoding = 1, channels = 1, sampleRate = 48_000, bits = 16)),
            chunk("LIST", ByteArray(5)), // odd: padded to 6
            chunk("data", ByteArray(20)),
        )

        val layout = readWavLayout(file, file.size.toLong())

        assertEquals(48_000, layout.sampleRate)
        assertEquals(1, layout.channels)
        assertEquals(12L + 24 + 14 + 8, layout.dataOffset)
        assertEquals(20L, layout.dataBytes)
    }

    // A data chunk that claims more than the file holds is read to the file's end.
    @Test
    fun aDataChunkLongerThanTheFileStopsAtItsEnd() {
        val file = wav(chunk("fmt ", fmt(1, 2, 44_100, 16)), chunk("data", ByteArray(8), declaredSize = 1_000))
        assertEquals(8L, readWavLayout(file, file.size.toLong()).dataBytes)
    }

    // Anything the output cannot play sample for sample is refused, not converted.
    @Test
    fun onlySixteenBitPcmIsAccepted() {
        for (format in listOf(fmt(1, 1, 48_000, 24), fmt(3, 1, 48_000, 32))) {
            val file = wav(chunk("fmt ", format), chunk("data", ByteArray(12)))
            assertThrows(IllegalArgumentException::class.java) { readWavLayout(file, file.size.toLong()) }
        }
        assertThrows(IllegalArgumentException::class.java) { readWavLayout(ByteArray(44), 44) }
    }

    private fun fmt(encoding: Int, channels: Int, sampleRate: Int, bits: Int): ByteArray =
        ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN)
            .putShort(encoding.toShort()).putShort(channels.toShort()).putInt(sampleRate)
            .putInt(sampleRate * channels * bits / 8).putShort((channels * bits / 8).toShort()).putShort(bits.toShort())
            .array()

    private fun chunk(id: String, body: ByteArray, declaredSize: Int = body.size): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(id.toByteArray(Charsets.US_ASCII))
        out.write(ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(declaredSize).array())
        out.write(body)
        if (body.size % 2 == 1) out.write(0)
        return out.toByteArray()
    }

    private fun wav(vararg chunks: ByteArray): ByteArray {
        val body = chunks.fold(ByteArray(0)) { all, next -> all + next }
        val size = ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(4 + body.size).array()
        return "RIFF".toByteArray(Charsets.US_ASCII) + size + "WAVE".toByteArray(Charsets.US_ASCII) + body
    }
}
