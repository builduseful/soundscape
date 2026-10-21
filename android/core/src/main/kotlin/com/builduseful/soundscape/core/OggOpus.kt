package com.builduseful.soundscape.core

/**
 * How many frames an Ogg Opus file really holds: the last page's granule
 * position less the pre-skip, which is how Opus marks the end of a stream that
 * does not fill its final 20 ms frame.
 *
 * Android's extractor honours the pre-skip but not this end-trim, so its decode
 * runs on with the encoder's padding — up to a frame of it, landing exactly on
 * the loop seam. The decoder cuts its output to this length.
 *
 * Returns null if [file] is not Ogg Opus.
 */
fun oggOpusFrameCount(file: ByteArray): Long? {
    val head = indexOf(file, OPUS_HEAD, 0)
    if (head < 0 || head + 12 > file.size) return null
    val preSkip = (file[head + 10].toInt() and 0xFF) or ((file[head + 11].toInt() and 0xFF) shl 8)

    var page = lastIndexOf(file, CAPTURE_PATTERN)
    while (page >= 0) {
        if (page + 14 <= file.size) {
            val granule = (0 until 8).fold(0L) { value, i -> value or ((file[page + 6 + i].toLong() and 0xFF) shl (8 * i)) }
            // -1 marks a page on which no packet ends; the one before it decides.
            if (granule != -1L) return (granule - preSkip).takeIf { it >= 0 }
        }
        page = lastIndexOf(file, CAPTURE_PATTERN, page - 1)
    }
    return null
}

private val OPUS_HEAD = "OpusHead".toByteArray(Charsets.US_ASCII)
private val CAPTURE_PATTERN = "OggS".toByteArray(Charsets.US_ASCII)

private fun indexOf(data: ByteArray, pattern: ByteArray, from: Int): Int {
    for (i in from..data.size - pattern.size) {
        if (pattern.indices.all { data[i + it] == pattern[it] }) return i
    }
    return -1
}

private fun lastIndexOf(data: ByteArray, pattern: ByteArray, from: Int = data.size - pattern.size): Int {
    for (i in minOf(from, data.size - pattern.size) downTo 0) {
        if (pattern.indices.all { data[i + it] == pattern[it] }) return i
    }
    return -1
}
