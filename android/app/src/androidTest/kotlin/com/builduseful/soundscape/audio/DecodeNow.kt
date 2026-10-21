package com.builduseful.soundscape.audio

import android.content.res.AssetManager
import android.os.Handler
import android.os.HandlerThread
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Decodes [path] on a thread of its own and waits for it, for tests that need the audio itself. */
fun decodeNow(assets: AssetManager, path: String): DecodedAudio {
    val thread = HandlerThread("test-decode").apply { start() }
    try {
        val finished = CountDownLatch(1)
        var result: Result<DecodedAudio>? = null
        Handler(thread.looper).post {
            AssetDecoder.decode(assets, path, Handler(thread.looper)) {
                result = it
                finished.countDown()
            }
        }
        check(finished.await(60, TimeUnit.SECONDS)) { "decoding $path took over a minute" }
        return result!!.getOrThrow()
    } finally {
        thread.quitSafely()
    }
}
