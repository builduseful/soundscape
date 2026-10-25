package com.builduseful.soundscape.core

import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Where a 16-bit PCM WAV file keeps its samples: [dataBytes] of them from [dataOffset]. */
class WavLayout(val sampleRate: Int, val channels: Int, val dataOffset: Long, val dataBytes: Long)

/**
 * Reads [header], the start of a WAV file [fileLength] bytes long, as far as its
 * data chunk. Only 16-bit integer PCM is accepted: it is what the output plays,
 * so the samples can be read where they lie.
 */
fun readWavLayout(header: ByteArray, fileLength: Long): WavLayout {
    val bytes = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN)
    require(header.size >= 12 && tag(bytes, 0) == "RIFF" && tag(bytes, 8) == "WAVE") { "Not a WAV file" }

    var format: Pair<Int, Int>? = null
    var at = 12
    while (at + 8 <= header.size) {
        val id = tag(bytes, at)
        val size = bytes.getInt(at + 4).toLong() and 0xFFFFFFFFL
        val body = at + 8
        if (id == "fmt ") {
            require(body + 16 <= header.size) { "The fmt chunk is cut short" }
            val encoding = bytes.getShort(body).toInt() and 0xFFFF
            val bits = bytes.getShort(body + 14).toInt()
            require(encoding == PCM && bits == 16) { "Not 16-bit PCM (format $encoding, $bits bits)" }
            format = bytes.getInt(body + 4) to bytes.getShort(body + 2).toInt()
        } else if (id == "data") {
            val (sampleRate, channels) = requireNotNull(format) { "The data chunk comes before fmt" }
            return WavLayout(sampleRate, channels, body.toLong(), minOf(size, fileLength - body))
        }
        // Chunks are padded to an even length.
        val next = body + size + (size and 1)
        if (next > header.size) break
        at = next.toInt()
    }
    throw IllegalArgumentException("No data chunk in the first ${header.size} bytes")
}

private const val PCM = 1

private fun tag(bytes: ByteBuffer, at: Int): String = String(CharArray(4) { bytes.get(at + it).toInt().toChar() })
