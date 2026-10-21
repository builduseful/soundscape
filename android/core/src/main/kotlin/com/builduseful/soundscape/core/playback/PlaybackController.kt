package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.DesignTokens

/**
 * The player's rules, apart from any platform: which track is on, whether it
 * should be playing, and what the listener is told. The web app's `script.js`
 * is the reference; each rule here has a JVM test.
 *
 * Confined to one thread. The engine's callbacks and the scheduler's actions
 * must arrive on it.
 */
class PlaybackController(
    private val tracks: List<Track>,
    private val engine: AudioEngine,
    private val preferences: PreferenceStore,
    private val scheduler: Scheduler,
) {
    init {
        require(tracks.isNotEmpty()) { "The catalog is empty" }
    }

    private var index = savedTrackIndex()

    /**
     * Bumped by every load. A load's result is acted on only while its
     * generation is still the latest: loads can finish out of order, and an
     * older one must never decide what the listener sees.
     */
    private var generation = 0
    private var loadPending = false
    private var loadingIndicator: Cancellable? = null

    var state = PlayerState(
        track = tracks[index],
        trackChange = null,
        isPlaying = false,
        volume = savedVolume(),
        isLoading = false,
        notice = null,
    )
        private set(value) {
            if (field == value) return
            field = value
            // A listener may change the state again; that change reaches every
            // listener itself, so this older one stops rather than following it.
            for (listener in listeners.toList()) {
                if (field !== value) break
                listener(value)
            }
        }

    private val listeners = mutableListOf<(PlayerState) -> Unit>()

    init {
        engine.setVolume(state.volume)
        engine.setOnStopped(::outputStopped)
    }

    /** Calls [listener] on every change of [state], until the returned handle is cancelled. */
    fun observe(listener: (PlayerState) -> Unit): Cancellable {
        listeners += listener
        return Cancellable { listeners -= listener }
    }

    fun playPause() = if (state.isPlaying) pause() else play()

    fun play() {
        val track = tracks[index]
        // Asked as "holds *this* track", so a track held from before is never
        // resumed under a different title.
        if (engine.loadedTrack != track) {
            load(index, play = true, change = null)
            return
        }
        try {
            engine.play()
        } catch (error: Exception) {
            state = state.copy(isPlaying = engine.isPlaying)
            reportFailure(track)
            return
        }
        state = state.copy(isPlaying = true, notice = state.notice.withoutFailure())
    }

    fun pause() {
        engine.pause()
        state = state.copy(isPlaying = false)
    }

    fun next() = load((index + 1) % tracks.size, play = state.isPlaying, change = Direction.Next)

    fun previous() = load((index - 1 + tracks.size) % tracks.size, play = state.isPlaying, change = Direction.Previous)

    /**
     * "Play this soundscape", from a shortcut. It plays whichever track it
     * names, the current one included: the same request must not fill the room
     * for one track and only change the title for another. An unknown id is
     * ignored.
     */
    fun select(trackId: String) {
        val target = tracks.indexOfFirst { it.id == trackId }
        when {
            target == -1 -> return
            target == index -> if (!state.isPlaying) play()
            else -> load(target, play = true, change = if (target > index) Direction.Next else Direction.Previous)
        }
    }

    /** Applies [volume], clamped to 0..1, and saves it if [persist] — pass false while a slider is still moving. */
    fun setVolume(volume: Float, persist: Boolean = true) {
        if (volume.isNaN()) return
        val clamped = volume.coerceIn(0f, 1f)
        engine.setVolume(clamped)
        state = state.copy(volume = clamped)
        if (persist) preferences.write(VOLUME_KEY, clamped.toString())
    }

    private fun load(target: Int, play: Boolean, change: Direction?) {
        val previousIndex = index
        val attempted = tracks[target]
        val loadGeneration = ++generation

        index = target
        preferences.write(TRACK_KEY, attempted.id)
        beginLoading()

        // The engine is told before the listeners, so one that reacts by
        // pausing (focus refused) pauses this load rather than an older one.
        engine.load(attempted, play) { error ->
            if (loadGeneration != generation) return@load
            endLoading()
            if (error == null) {
                state = state.copy(isPlaying = engine.isPlaying, notice = state.notice.withoutFailure())
            } else {
                failed(attempted, previousIndex)
            }
        }
        state = state.copy(track = attempted, trackChange = change ?: state.trackChange, isPlaying = play)
    }

    // After a failed load the screen goes back to whatever the engine is
    // actually on, so the title always names the sound in the room — or, if the
    // engine is on nothing yet, to where it was before this change.
    private fun failed(attempted: Track, previousIndex: Int) {
        val held = engine.loadedTrack
        if (held != attempted) {
            index = if (held != null) tracks.indexOf(held) else previousIndex
            preferences.write(TRACK_KEY, tracks[index].id)
        }
        state = state.copy(track = tracks[index], trackChange = null, isPlaying = engine.isPlaying)
        reportFailure(attempted)
    }

    // The output stopped by itself: the button follows the speaker, and the
    // listener is told why it went quiet.
    private fun outputStopped() {
        state = state.copy(isPlaying = false)
        reportFailure(engine.loadedTrack ?: state.track)
    }

    // Only a failure that leaves silence is shown. One while something plays
    // is absorbed: that sound carries on, and trying again just works.
    private fun reportFailure(track: Track) {
        if (engine.isPlaying) return
        state = state.copy(notice = Notice.Failed(track))
    }

    // A skip mid-load hands the loading state on without ending it, so the
    // indicator neither blinks between tracks nor restarts its delay.
    private fun beginLoading() {
        if (loadPending) return
        loadPending = true
        loadingIndicator = scheduler.schedule(DesignTokens.Duration.loadingIndicatorDelay) {
            loadingIndicator = null
            // A failure notice is about an attempt that is over; this one is still running.
            state = state.copy(isLoading = true, notice = Notice.Loading)
        }
    }

    private fun endLoading() {
        loadPending = false
        loadingIndicator?.cancel()
        loadingIndicator = null
        state = state.copy(isLoading = false, notice = state.notice.takeUnless { it == Notice.Loading })
    }

    private fun Notice?.withoutFailure() = takeUnless { it is Notice.Failed }

    // An unknown or missing id falls back to the first track.
    private fun savedTrackIndex(): Int =
        tracks.indexOfFirst { it.id == preferences.read(TRACK_KEY) }.coerceAtLeast(0)

    private fun savedVolume(): Float =
        preferences.read(VOLUME_KEY)?.toFloatOrNull()?.takeIf { it in 0f..1f } ?: 1f

    companion object {
        const val TRACK_KEY = "currentTrackId"
        const val VOLUME_KEY = "volume"
    }
}
