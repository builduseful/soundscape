package com.builduseful.soundscape.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ShortBuffer

class LoopReaderTest {
    // Rendering straight across the wrap must play each frame once, in order:
    // the frame after the last is the first one again.
    @Test
    fun theReaderWrapsWithoutAGapOrARepeat() {
        val pcm = ShortArray(14) { it.toShort() } // 7 stereo frames
        val reader = LoopReader(ShortBuffer.wrap(pcm), channels = 2)
        val out = ShortArray(2 * 25)

        reader.read(out)

        val expected = ShortArray(out.size) { i -> ((i / 2 % 7) * 2 + i % 2).toShort() }
        assertArrayEquals(expected, out)
        assertEquals(25 % 7, reader.position)
    }

    @Test
    fun readsInPiecesContinueWhereTheLastOneStopped() {
        val pcm = ShortArray(9) { it.toShort() }
        val whole = ShortArray(40).also { LoopReader(ShortBuffer.wrap(pcm), 1).read(it) }

        val reader = LoopReader(ShortBuffer.wrap(pcm), 1)
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

    // The engine hands over a view of a mapped file whose position it does not
    // promise: the loop is what remains from there, read independently of it.
    @Test
    fun theLoopIsTheBufferFromItsPosition() {
        val buffer = ShortBuffer.wrap(ShortArray(6) { it.toShort() }).position(2)
        val reader = LoopReader(buffer, 1)
        buffer.position(5)

        val out = ShortArray(6).also { reader.read(it) }
        assertArrayEquals(shortArrayOf(2, 3, 4, 5, 2, 3), out)
    }
}
