package com.builduseful.soundscape.core.playback

/**
 * Sharing the speaker with other apps: hold focus while playing, give it up on
 * pause, stop when another app takes it, and resume after a brief interruption
 * (a call, a navigation prompt) only if that is what paused us.
 *
 * Being asked to duck is not here: the OS lowers the volume itself, which
 * suits ambient sound.
 *
 * Confined to the controller's thread, as are the focus callbacks.
 */
class AudioFocusRules(
    private val controller: PlaybackController,
    private val focus: AudioFocus,
) {
    private enum class Focus { None, Held, LostForNow }

    private var current = Focus.None
    private val subscription = controller.observe(::onState)

    /** Another app has the speaker for good. */
    fun onLoss() {
        if (current == Focus.None) return
        focus.abandon()
        current = Focus.None
        controller.pause()
    }

    /** Another app has the speaker for a while. */
    fun onTransientLoss() {
        if (current != Focus.Held) return
        current = Focus.LostForNow
        controller.pause()
    }

    fun onGain() {
        if (current != Focus.LostForNow) return
        current = Focus.Held
        controller.play()
    }

    /** Gives focus up and stops following the controller. */
    fun release() {
        subscription.cancel()
        if (current != Focus.None) focus.abandon()
        current = Focus.None
    }

    private fun onState(state: PlayerState) {
        when {
            state.isPlaying && current != Focus.Held ->
                if (focus.request()) {
                    current = Focus.Held
                } else {
                    // Refused, as during a call: playing over it is not ours to do.
                    if (current != Focus.None) focus.abandon()
                    current = Focus.None
                    controller.pause()
                }
            // Paused by the listener or by a failure: let other apps have it.
            // Paused for a brief interruption: keep our place to resume.
            !state.isPlaying && current == Focus.Held -> {
                focus.abandon()
                current = Focus.None
            }
        }
    }
}
