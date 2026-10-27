package com.builduseful.soundscape.core.gestures

import com.builduseful.soundscape.core.playback.PreferenceStore

/** The gestures the guide teaches, in its order. */
enum class Gesture { Tap, Swipe, Volume }

/**
 * The first-run guide to the gestures, learnt by doing: each step names one
 * gesture and moves on when the listener makes it. Finished or skipped, it is
 * remembered and not offered again. The web's `gesture-tutorial.js` is the
 * reference.
 */
class GestureGuide(private val preferences: PreferenceStore) {
    /** The step showing; [Gesture.entries].size once all are done; null when closed. */
    var step: Int? = null
        private set

    val isOpen get() = step != null

    val isDone get() = step == Gesture.entries.size

    /** Whether it has yet to be finished or skipped. */
    val isOffered get() = preferences.read(KEY) == null

    fun start() {
        step = 0
    }

    /** A gesture happened; the guide moves on if it was the one asked for. Returns whether it did. */
    fun completed(gesture: Gesture): Boolean {
        if (step?.let { Gesture.entries.getOrNull(it) } != gesture) return false
        step = step!! + 1
        return true
    }

    /** Closes it for good, whether finished or skipped. */
    fun finish() {
        step = null
        preferences.write(KEY, "true")
    }

    private companion object {
        // The web's name for it, so the two read alike.
        const val KEY = "gestureTutorialDone"
    }
}
