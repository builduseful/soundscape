package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track

/**
 * The audio output, as the controller needs it. Every call is made, and every
 * callback delivered, on the controller's thread.
 */
interface AudioEngine {
    /** The track the engine is on — audible, or paused and ready to resume. Null until a load succeeds. */
    val loadedTrack: Track?

    /** Whether sound is coming out. */
    val isPlaying: Boolean

    /**
     * Switches to [track], playing iff [play], crossfading from whatever is
     * playing. Calls [done] exactly once: with null once the switch has
     * happened, or with the failure, in which case the engine is left as it
     * was. A later [load] supersedes this one, which must then never become
     * the engine's track; [pause] makes it land paused.
     */
    fun load(track: Track, play: Boolean, done: (Throwable?) -> Unit)

    /** Resumes [loadedTrack]. Throws if the output will not start. */
    fun play()

    fun pause()

    /** 0 to 1. The engine ramps to it rather than stepping. */
    fun setVolume(volume: Float)

    /**
     * Calls [listener] when sound stops without being asked to: the output
     * would not start. [isPlaying] is already false by then.
     */
    fun setOnStopped(listener: () -> Unit)
}

/**
 * The OS's audio focus: the right to be the sound the listener hears. A
 * request may be refused (during a call). See [AudioFocusRules].
 */
interface AudioFocus {
    /** True if focus is now held. */
    fun request(): Boolean

    fun abandon()
}

/** Small, string-valued, persistent settings. A failed read answers null; a failed write is dropped. */
interface PreferenceStore {
    fun read(key: String): String?

    fun write(key: String, value: String)
}

/** Delayed work on the controller's thread. */
fun interface Scheduler {
    fun schedule(delayMillis: Long, action: () -> Unit): Cancellable
}

fun interface Cancellable {
    fun cancel()
}
