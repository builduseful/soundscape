package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track

/** An engine whose loads finish only when a test says so, honouring the [AudioEngine] contract. */
class FakeEngine : AudioEngine {
    class Load(val track: Track, var play: Boolean, val cut: Boolean, val done: (Throwable?) -> Unit)

    val loads = mutableListOf<Load>()
    var appliedVolume = -1f
    var playFails = false

    override var loadedTrack: Track? = null
    override var isPlaying = false
    private var onStopped: () -> Unit = {}

    override fun load(track: Track, play: Boolean, cut: Boolean, done: (Throwable?) -> Unit) {
        loads += Load(track, play, cut, done)
    }

    override fun play() {
        check(loadedTrack != null) { "play() with nothing loaded" }
        if (playFails) throw IllegalStateException("output refused")
        isPlaying = true
    }

    override fun pause() {
        isPlaying = false
        loads.lastOrNull()?.play = false
    }

    override fun setVolume(volume: Float) {
        appliedVolume = volume
    }

    /** Finishes the [n]th load. Only the latest load may become the engine's track. */
    fun succeed(n: Int = loads.lastIndex) {
        val load = loads[n]
        if (n == loads.lastIndex) {
            loadedTrack = load.track
            isPlaying = load.play
        }
        load.done(null)
    }

    fun fail(n: Int = loads.lastIndex) = loads[n].done(IllegalStateException("decode failed"))

    override fun setOnStopped(listener: () -> Unit) {
        onStopped = listener
    }

    /** The output stops by itself. */
    fun stopByItself() {
        isPlaying = false
        onStopped()
    }
}

class FakeFocus : AudioFocus {
    var granted = true
    var held = false
    var requests = 0

    override fun request(): Boolean {
        requests++
        held = granted
        return granted
    }

    override fun abandon() {
        held = false
    }
}

class MemoryPreferences(vararg initial: Pair<String, String>) : PreferenceStore {
    val values = mutableMapOf(*initial)
    var writes = 0

    override fun read(key: String) = values[key]

    override fun write(key: String, value: String) {
        writes++
        values[key] = value
    }
}

/** A virtual clock: scheduled work runs only when [advance] passes its time. */
class FakeScheduler : Scheduler {
    private class Task(val at: Long, val action: () -> Unit, var cancelled: Boolean = false)

    private val tasks = mutableListOf<Task>()
    var now = 0L
        private set

    override fun schedule(delayMillis: Long, action: () -> Unit): Cancellable {
        val task = Task(now + delayMillis, action)
        tasks += task
        return Cancellable { task.cancelled = true }
    }

    fun advance(millis: Long) {
        val until = now + millis
        while (true) {
            val next = tasks.filter { !it.cancelled && it.at <= until }.minByOrNull { it.at } ?: break
            tasks -= next
            now = next.at
            next.action()
        }
        now = until
    }

    val pending get() = tasks.count { !it.cancelled }
}
