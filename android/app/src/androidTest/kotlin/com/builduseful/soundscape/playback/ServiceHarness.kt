package com.builduseful.soundscape.playback

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import com.builduseful.soundscape.core.playback.PlaybackController
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Binds to the [PlaybackService] from a test and drives it on the main thread, as the activity would. */
class ServiceHarness : AutoCloseable {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    val context: Context = instrumentation.targetContext
    private var connection: ServiceConnection? = null
    private var bound: PlaybackService? = null

    /** The service, bound on first use. Call from the test thread: binding completes on the main one. */
    val service: PlaybackService get() = bound ?: bind()

    fun bind(): PlaybackService {
        val connected = CountDownLatch(1)
        val connection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, binder: IBinder) {
                bound = (binder as PlaybackService.LocalBinder).service
                connected.countDown()
            }

            override fun onServiceDisconnected(name: ComponentName) {
                bound = null
            }
        }
        check(context.bindService(Intent(context, PlaybackService::class.java), connection, Context.BIND_AUTO_CREATE))
        check(connected.await(10, TimeUnit.SECONDS)) { "the service never bound" }
        this.connection = connection
        return bound!!
    }

    fun unbind() {
        connection?.let(context::unbindService)
        connection = null
        bound = null
    }

    fun <T> onMain(block: () -> T): T {
        var result: Result<T>? = null
        instrumentation.runOnMainSync { result = runCatching(block) }
        return result!!.getOrThrow()
    }

    fun <T> controller(block: PlaybackController.() -> T): T {
        val service = service
        return onMain { service.controller.block() }
    }

    val isSounding: Boolean get() {
        val service = service
        return onMain { service.isSounding }
    }

    /** Plays [trackId] and waits until it is heard. */
    fun playing(trackId: String) {
        controller { select(trackId) }
        waitUntil("$trackId to be heard") { isSounding && controller { state.track.id } == trackId }
    }

    // As long as EngineHarness allows a load: decoding a long track on the API 26
    // emulator takes several seconds.
    fun waitUntil(what: String, timeoutMillis: Long = 20_000, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + timeoutMillis
        while (!condition()) {
            check(SystemClock.elapsedRealtime() < deadline) { "timed out waiting for $what" }
            SystemClock.sleep(50)
        }
    }

    /** Stops playback and lets the service go, so each test starts from nothing. */
    override fun close() {
        bound?.let { service -> onMain { service.stop() } }
        unbind()
    }
}
