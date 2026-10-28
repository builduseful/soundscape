package com.builduseful.soundscape.audio

import android.os.Process
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.catalogTracks
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Drives a [LoopingAudioEngine] from a test thread, keeping to its rule that every call is on the main thread. */
class EngineHarness : AutoCloseable {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    val engine: LoopingAudioEngine = onMain { LoopingAudioEngine(instrumentation.targetContext.assets) }

    fun track(id: String): Track = catalogTracks.first { it.id == id }

    fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return result!!.getOrThrow()
    }

    /** Starts a load from the test thread and returns a handle to wait on its result. */
    fun load(id: String, play: Boolean, cut: Boolean = false): PendingLoad = onMain { startLoad(id, play, cut) }

    /** [load], for use inside [onMain]. */
    fun startLoad(id: String, play: Boolean, cut: Boolean = false): PendingLoad {
        val pending = PendingLoad()
        engine.load(track(id), play, cut) { pending.finish(it) }
        return pending
    }

    /** Loads and waits; fails the test if the load fails. */
    fun loaded(id: String, play: Boolean) {
        load(id, play).await()?.let { throw AssertionError("loading $id failed", it) }
    }

    /** CPU time the render thread has used, in milliseconds (10 ms resolution). */
    fun renderCpuMillis(): Long {
        val tid = engine.renderThreadId
        check(tid != 0) { "the render thread has not started" }
        // /proc/<pid>/task/<tid>/stat: utime and stime are fields 14 and 15, in
        // clock ticks of 10 ms; counted from after the ')' closing the name.
        val fields = File("/proc/${Process.myPid()}/task/$tid/stat").readText().substringAfterLast(')').trim().split(' ')
        return (fields[11].toLong() + fields[12].toLong()) * 10
    }

    /** How often the render thread has gone to sleep: each one is a wake-up later. */
    fun renderSleeps(): Long {
        val tid = engine.renderThreadId
        check(tid != 0) { "the render thread has not started" }
        val status = File("/proc/${Process.myPid()}/task/$tid/status").readLines()
        return status.first { it.startsWith("voluntary_ctxt_switches:") }.substringAfter(':').trim().toLong()
    }

    fun renderThreadState(): Thread.State =
        Thread.getAllStackTraces().keys.first { it.name == "soundscape-render" }.state

    fun sleep(millis: Long) = SystemClock.sleep(millis)

    override fun close() = onMain { engine.release() }

    class PendingLoad {
        private val latch = CountDownLatch(1)
        private var error: Throwable? = null

        fun finish(error: Throwable?) {
            this.error = error
            latch.countDown()
        }

        /** The load's failure, or null once it succeeded. */
        fun await(): Throwable? {
            // A ceiling for a broken engine, not a budget: a load is a file mapped.
            check(latch.await(10, TimeUnit.SECONDS)) { "the load never finished" }
            return error
        }
    }
}
