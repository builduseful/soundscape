package com.builduseful.soundscape.core

import com.builduseful.soundscape.core.testing.readShared
import com.builduseful.soundscape.core.testing.sharedDir
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class OggOpusTest {
    // The trim is only right if it lands on the length the encoder meant, which
    // is what ffmpeg decodes. Checked against every published file, not a
    // made-up one, since those are what the app plays.
    @Test
    fun everyPublishedFileTrimsToItsReferenceLength() {
        val files = (readShared("fixtures/decoded-audio.json") as Map<*, *>)["files"] as Map<*, *>
        val soundscapes = sharedDir.resolve("../web/src/resources/soundscapes")
        val opus = files.filterKeys { (it as String).startsWith("opus/") }

        check(opus.isNotEmpty())
        for ((path, reference) in opus) {
            val expected = ((reference as Map<*, *>)["frames"] as Double).toLong()
            assertEquals(path as String, expected, oggOpusFrameCount(soundscapes.resolve(path).readBytes()))
        }
    }

    @Test
    fun anythingElseIsNotOggOpus() {
        assertNull(oggOpusFrameCount(ByteArray(0)))
        assertNull(oggOpusFrameCount("OggS but no head".toByteArray()))
    }
}
