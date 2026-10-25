package com.builduseful.soundscape.playback

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import com.builduseful.soundscape.BuildConfig
import com.builduseful.soundscape.MainActivity
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.Track

/**
 * The launcher's long-press shortcuts, one a track, each playing its track.
 * Dynamic rather than in the manifest so their order can follow listening.
 */
internal class AppShortcuts(private val context: Context) {
    private val manager = context.getSystemService(ShortcutManager::class.java)

    /** Shows [tracks], in order, unless they are already what is shown. */
    fun show(tracks: List<Track>) {
        val shown = manager.dynamicShortcuts.sortedBy { it.rank }.map { it.id }
        if (shown == tracks.map { it.id }) return
        manager.dynamicShortcuts = tracks.mapIndexed { rank, track ->
            ShortcutInfo.Builder(context, track.id)
                .setShortLabel(track.title)
                .setIcon(Icon.createWithResource(context, R.mipmap.ic_launcher))
                .setIntent(
                    Intent(context, MainActivity::class.java)
                        .setAction(BuildConfig.PLAY_TRACK_ACTION)
                        .putExtra(BuildConfig.TRACK_ID_EXTRA, track.id),
                )
                .setRank(rank)
                .build()
        }
    }

    companion object {
        /** Tells the launcher a shortcut was used, which it may weigh in what it suggests. */
        fun used(context: Context, trackId: String) =
            context.getSystemService(ShortcutManager::class.java).reportShortcutUsed(trackId)
    }
}
