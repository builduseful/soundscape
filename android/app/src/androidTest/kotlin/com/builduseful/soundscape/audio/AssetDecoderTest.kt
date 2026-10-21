package com.builduseful.soundscape.audio

import android.os.Build
import android.os.SystemClock
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import kotlin.math.abs

// Gapless looping depends on the decoder handing back exactly the samples that
// were encoded: no pre-skip left in, no edit list ignored, no padding on the
// tail. shared/fixtures/decoded-audio.json says what each file decodes to
// (ffmpeg's reading); this decodes every bundled file on the device and holds
// it to that, on each API level in the test matrix.
@RunWith(AndroidJUnit4::class)
class AssetDecoderTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    // 16-bit output alone is ±3e-5; two Opus decoders may differ a little more.
    // A misalignment of even one sample is far larger on this material.
    private val tolerance = 2e-3f

    @Test
    fun everyBundledFileDecodesToItsReference() {
        val reference = JSONObject(instrumentation.context.assets.open("decoded-audio.json").bufferedReader().readText())
        val files = reference.getJSONObject("files")
        val problems = mutableListOf<String>()

        // The reference covers every published file; the app bundles one codec.
        val bundled = files.keys().asSequence().filter { path ->
            instrumentation.targetContext.assets.list(path.substringBeforeLast('/'))?.contains(path.substringAfterLast('/')) == true
        }.toList()
        assertTrue("no bundled audio found", bundled.isNotEmpty())

        for (path in bundled) {
            val expected = files.getJSONObject(path)
            val line = try {
                val started = SystemClock.elapsedRealtime()
                val decoded = decodeNow(instrumentation.targetContext.assets, path)
                val millis = SystemClock.elapsedRealtime() - started
                val issues = compare(decoded, expected)
                if (issues.isNotEmpty()) problems += "$path: ${issues.joinToString("; ")}"
                "$path frames=${decoded.frames} (expected ${expected.getInt("frames")}) " +
                    "rate=${decoded.sampleRate} ch=${decoded.channels} decoder=${decoded.decoderName} in $millis ms " +
                    if (issues.isEmpty()) "OK" else issues.joinToString("; ")
            } catch (error: Exception) {
                problems += "$path: ${error.javaClass.simpleName}: ${error.message}"
                "$path FAILED ${error.javaClass.simpleName}: ${error.message}"
            }
            Log.i(TAG, "API ${Build.VERSION.SDK_INT}: $line")
        }

        assertTrue("API ${Build.VERSION.SDK_INT}:\n${problems.joinToString("\n")}", problems.isEmpty())
    }

    private fun compare(decoded: DecodedAudio, expected: JSONObject): List<String> {
        val issues = mutableListOf<String>()
        if (decoded.sampleRate != expected.getInt("sampleRate")) issues += "sample rate ${decoded.sampleRate}"
        if (decoded.channels != expected.getInt("channels")) issues += "channels ${decoded.channels}"
        val frameDelta = decoded.frames - expected.getInt("frames")
        if (frameDelta != 0) issues += "frames off by $frameDelta"

        val head = expected.getJSONArray("head")
        val tail = expected.getJSONArray("tail")
        val pcm = decoded.pcm

        val headError = maxError(pcm, 0, head)
        if (headError > tolerance) issues += "head differs by $headError (best alignment ${bestOffset(pcm, head)} samples)"

        val tailStart = pcm.size - tail.length()
        if (tailStart >= 0) {
            val tailError = maxError(pcm, tailStart, tail)
            if (tailError > tolerance) issues += "tail differs by $tailError"
        }
        return issues
    }

    private fun maxError(pcm: ShortArray, start: Int, expected: JSONArray): Float {
        var worst = 0f
        for (i in 0 until expected.length()) {
            val index = start + i
            if (index !in pcm.indices) return Float.POSITIVE_INFINITY
            worst = maxOf(worst, abs(pcm[index] / 32768f - expected.getDouble(i).toFloat()))
        }
        return worst
    }

    /** Where the reference head actually starts in the decoded output, if near. */
    private fun bestOffset(pcm: ShortArray, head: JSONArray): Int =
        (0..4096).minByOrNull { maxError(pcm, it, head) } ?: 0

    private companion object {
        const val TAG = "AssetDecoderTest"
    }
}
