package com.builduseful.soundscape.playback

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.media.session.MediaSession
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.playback.PlayerState

/**
 * The media notification: the track, previous / play-pause / next, and stop.
 * Android 13 and later draw their media controls from the session instead,
 * and need no POST_NOTIFICATIONS for it: media-session notifications are
 * exempt.
 */
internal class PlaybackNotification(
    private val service: Service,
    private val session: MediaSession.Token,
    private val artwork: Bitmap,
    private val openApp: PendingIntent,
) {
    private val manager = service.getSystemService(NotificationManager::class.java)

    init {
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, service.getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) },
        )
    }

    fun build(state: PlayerState): Notification {
        val playPause = if (state.isPlaying) {
            action(R.drawable.ic_pause, R.string.pause, PlaybackService.ACTION_PLAY_PAUSE)
        } else {
            action(R.drawable.ic_play, R.string.play, PlaybackService.ACTION_PLAY_PAUSE)
        }
        return Notification.Builder(service, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setLargeIcon(artwork)
            .setContentTitle(state.track.title)
            .setContentText(service.getString(R.string.app_name))
            .setContentIntent(openApp)
            .setDeleteIntent(command(PlaybackService.ACTION_STOP))
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .addAction(action(R.drawable.ic_previous, R.string.previous_track, PlaybackService.ACTION_PREVIOUS))
            .addAction(playPause)
            .addAction(action(R.drawable.ic_next, R.string.next_track, PlaybackService.ACTION_NEXT))
            .addAction(action(R.drawable.ic_stop, R.string.stop, PlaybackService.ACTION_STOP))
            .setStyle(Notification.MediaStyle().setMediaSession(session).setShowActionsInCompactView(0, 1, 2))
            .build()
    }

    // Exempt from POST_NOTIFICATIONS, being a media-session notification;
    // PlaybackServiceTest holds it to showing without the permission.
    @SuppressLint("NotificationPermission")
    fun show(state: PlayerState) = manager.notify(ID, build(state))

    private fun action(icon: Int, label: Int, command: String) =
        Notification.Action.Builder(Icon.createWithResource(service, icon), service.getString(label), command(command)).build()

    // Delivered to the service, which is in the foreground whenever this
    // notification is up, so starting it is always allowed.
    private fun command(action: String): PendingIntent = PendingIntent.getService(
        service,
        action.hashCode(),
        Intent(service, PlaybackService::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE,
    )

    companion object {
        const val ID = 1
        private const val CHANNEL = "playback"
    }
}
