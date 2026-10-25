package com.builduseful.soundscape.core

import com.builduseful.soundscape.core.contract.catalogTracks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs

/** The masters the app bundles as they are (masters/AGENTS.md): each must already be a finished loop. */
class MastersTest {
    private val masters = File(requireNotNull(System.getProperty("soundscape.masters")) { "soundscape.masters is not set" })

    // What the engine plays without conversion, and nothing else in the file: a
    // tag is a name or a path shipped in the APK and in git.
    @Test
    fun eachIsSixteenBitMonoWithNothingButItsSamples() {
        for (track in catalogTracks) {
            val file = masters.resolve("${track.id}.wav")
            val layout = readWavLayout(file.readBytes().copyOf(HEADER), file.length())
            assertEquals("${track.id} sample rate", 48_000, layout.sampleRate)
            assertEquals("${track.id} channels", 1, layout.channels)
            assertEquals("${track.id} has chunks besides fmt and data", HEADER.toLong(), layout.dataOffset)
            assertEquals("${track.id} has bytes past its samples", file.length() - HEADER, layout.dataBytes)
        }
    }

    // The app wraps from the last sample straight to the first, so the seam must
    // be no rougher than the audio itself. A master that is not loop-ready
    // clicks there, every time round.
    @Test
    fun eachLoopsWithoutAStepAtTheSeam() {
        for (track in catalogTracks) {
            val bytes = masters.resolve("${track.id}.wav").readBytes()
            val pcm = ByteBuffer.wrap(bytes, HEADER, bytes.size - HEADER).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
            val samples = IntArray(pcm.remaining()) { pcm.get(it).toInt() }
            val steps = IntArray(samples.size - 1) { abs(samples[it + 1] - samples[it]) }.also { it.sort() }
            val typical = steps[steps.size * 99 / 100]
            val seam = abs(samples.first() - samples.last())
            assertTrue("${track.id}: a step of $seam at the seam, against $typical in the audio", seam <= typical)
        }
    }

    private companion object {
        /** RIFF, fmt and the data chunk's own header: a WAV with nothing else in it. */
        const val HEADER = 44
    }
}
