package com.builduseful.soundscape.core.playback

import com.builduseful.soundscape.core.Track

/**
 * How much each track has been listened to, as totals only: one small entry a
 * track, never a record of each listen.
 *
 * A listen is a track heard without a break. Every second of it adds to the
 * track's time; once it reaches [COUNTS_AFTER_MS] it also counts as a play
 * and makes the track the most recently listened to, so skipping past a track
 * changes nothing but its time.
 *
 * Saved when the listen reaches a play, every [SAVE_EVERY_MS] after, and when
 * it ends, so a forced close loses at most that much.
 *
 * Confined to the controller's thread, as [scheduler] is.
 */
class ListeningHistory(
    private val store: PreferenceStore,
    private val scheduler: Scheduler,
    /** A clock that never jumps, for how long a listen lasted. */
    private val elapsedMillis: () -> Long,
    /** The wall clock, for when a track was last listened to. */
    private val wallClockMillis: () -> Long,
    /** Called when a play has changed which track was listened to most recently. */
    private val onRecentChanged: () -> Unit,
) {
    data class Totals(val plays: Int, val listenedMillis: Long, val lastListenedAt: Long?)

    private var track: Track? = null
    private var since = 0L
    private var saved = 0L
    private var counted = false
    private var nextSave: Cancellable? = null

    /** Follows the player: a listen lasts while its track plays, a load shown as loading aside. */
    fun onState(state: PlayerState) {
        val heard = state.track.takeIf { state.isPlaying && !state.isLoading }
        if (heard == track) return
        end()
        if (heard != null) begin(heard)
    }

    /** Ends a listen still going, as the player goes away. */
    fun close() = end()

    fun totals(track: Track): Totals {
        val fields = store.read(KEY_PREFIX + track.id)?.split(',')
        return Totals(
            plays = fields?.getOrNull(0)?.toIntOrNull() ?: 0,
            listenedMillis = fields?.getOrNull(1)?.toLongOrNull() ?: 0L,
            lastListenedAt = fields?.getOrNull(2)?.toLongOrNull(),
        )
    }

    /**
     * Up to [count] tracks for the app shortcuts: the most recently listened
     * to first, then [defaults] in their order.
     */
    fun shortcuts(tracks: List<Track>, defaults: List<Track>, count: Int): List<Track> {
        val listened = tracks
            .mapNotNull { track -> totals(track).lastListenedAt?.let { track to it } }
            .sortedByDescending { it.second }
            .map { it.first }
        return (listened + defaults).distinct().take(count)
    }

    private fun begin(heard: Track) {
        track = heard
        since = elapsedMillis()
        saved = 0
        counted = false
        nextSave = scheduler.schedule(COUNTS_AFTER_MS, ::saveAndRepeat)
    }

    private fun end() {
        nextSave?.cancel()
        nextSave = null
        save()
        track = null
    }

    private fun saveAndRepeat() {
        save()
        nextSave = scheduler.schedule(SAVE_EVERY_MS, ::saveAndRepeat)
    }

    private fun save() {
        val heard = track ?: return
        val listened = elapsedMillis() - since
        val countsNow = !counted && listened >= COUNTS_AFTER_MS
        if (listened == saved && !countsNow) return
        val before = totals(heard)
        val after = Totals(
            plays = before.plays + if (countsNow) 1 else 0,
            listenedMillis = before.listenedMillis + (listened - saved),
            lastListenedAt = if (countsNow) wallClockMillis() else before.lastListenedAt,
        )
        store.write(KEY_PREFIX + heard.id, "${after.plays},${after.listenedMillis},${after.lastListenedAt ?: ""}")
        saved = listened
        if (countsNow) {
            counted = true
            onRecentChanged()
        }
    }

    companion object {
        const val COUNTS_AFTER_MS = 30_000L
        const val SAVE_EVERY_MS = 60_000L
        private const val KEY_PREFIX = "track."
    }
}
