package com.builduseful.soundscape.audio

import android.content.res.AssetManager
import com.builduseful.soundscape.core.readWavLayout
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.ShortBuffer
import java.nio.channels.FileChannel

/** A bundled loop's samples, 16-bit and interleaved, where they lie in the APK. */
class LoopAsset(val sampleRate: Int, val channels: Int, val pcm: ShortBuffer)

/**
 * Maps the WAV at [path] straight from the APK: nothing is read up front or
 * copied onto the heap, and the system pages the samples in as they play, and
 * may drop them again, as it would any file.
 *
 * The asset must be stored uncompressed (`noCompress` in app/build.gradle.kts).
 */
fun mapLoop(assets: AssetManager, path: String): LoopAsset =
    assets.openFd(path).use { file ->
        file.createInputStream().use { stream ->
            val channel = stream.channel
            val header = ByteBuffer.allocate(HEADER_BYTES)
            channel.read(header, file.startOffset)
            val layout = readWavLayout(header.array().copyOf(header.position()), file.length)
            val pcm = channel.map(FileChannel.MapMode.READ_ONLY, file.startOffset + layout.dataOffset, layout.dataBytes)
                .order(ByteOrder.LITTLE_ENDIAN)
                .asShortBuffer()
            LoopAsset(layout.sampleRate, layout.channels, pcm)
        }
    }

// Far more than a WAV header from the audio build needs; an editor's extra chunks fit too.
private const val HEADER_BYTES = 4096
