package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track

/** Everything the screen and the OS controls show, in one value. */
data class PlayerState(
    /** The track on screen: the one the listener picked, which may still be loading. */
    val track: Track,
    /** How [track] arrived: a direction slides the title in; null sets it outright. */
    val trackChange: Direction?,
    /** What the play/pause button shows: the listener's intent, not the speaker's state. */
    val isPlaying: Boolean,
    /** 0 to 1. */
    val volume: Float,
    /** A load has run long enough to notice: the title dims. */
    val isLoading: Boolean,
    /**
     * The one line under the title. Loading and a failure share it, so the two
     * can never be shown together; whichever came later holds it.
     */
    val notice: Notice?,
) {
    companion object {
        /**
         * Where a player starts: stopped, on the saved track (the first, if
         * that is gone) at the saved volume. The screen draws this before the
         * player is connected, so the first frame is already the right one.
         */
        fun restored(tracks: List<Track>, preferences: PreferenceStore): PlayerState {
            require(tracks.isNotEmpty()) { "The catalog is empty" }
            val saved = preferences.read(PlaybackController.TRACK_KEY)
            return PlayerState(
                track = tracks.firstOrNull { it.id == saved } ?: tracks.first(),
                trackChange = null,
                isPlaying = false,
                volume = preferences.read(PlaybackController.VOLUME_KEY)?.toFloatOrNull()?.takeIf { it in 0f..1f } ?: 1f,
                isLoading = false,
                notice = null,
            )
        }
    }
}

enum class Direction { Next, Previous }

sealed interface Notice {
    data object Loading : Notice

    /** [track] could not be played, and nothing is playing. */
    data class Failed(val track: Track) : Notice
}
