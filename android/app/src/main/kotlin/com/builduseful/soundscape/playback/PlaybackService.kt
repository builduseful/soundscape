package com.builduseful.soundscape.playback

import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.media.AudioManager
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Binder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import com.builduseful.soundscape.BuildConfig
import com.builduseful.soundscape.MainActivity
import com.builduseful.soundscape.R
import com.builduseful.soundscape.audio.LoopingAudioEngine
import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.playback.AudioFocusRules
import com.builduseful.soundscape.core.playback.PlaybackController
import com.builduseful.soundscape.core.playback.PlayerState

/**
 * Owns the player, so sound outlives the screen, and joins it to the OS: the
 * media session (notification, lock screen, headset and Bluetooth buttons),
 * audio focus, and pausing when headphones come out.
 *
 * Bound by the activity while it is visible. Started, and in the foreground,
 * from the first play until the listener stops it — paused included: on
 * Android 17 a paused app outside the foreground could not be resumed from
 * its notification or a headset.
 */
class PlaybackService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var engine: LoopingAudioEngine
    lateinit var controller: PlaybackController
        private set
    private lateinit var focus: AudioFocusRules
    private lateinit var session: MediaSession
    private lateinit var notification: PlaybackNotification

    private lateinit var artwork: Bitmap

    private var inForeground = false
    private var destroyed = false
    private var listeningForNoisy = false
    private var published: PlayerState? = null

    // Headphones unplugged, or a Bluetooth headset gone: the sound would
    // otherwise move to the speaker.
    internal val noisy = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) controller.pause()
        }
    }

    override fun onCreate() {
        super.onCreate()
        engine = LoopingAudioEngine(assets, main)
        controller = PlaybackController(catalogTracks, engine, SharedPreferenceStore(this, "playback"), HandlerScheduler(main))

        val openApp = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        session = MediaSession(this, "Soundscape").apply {
            setCallback(SessionCallback(), main)
            setSessionActivity(openApp)
        }
        artwork = drawArtwork()
        notification = PlaybackNotification(this, session.sessionToken, artwork, openApp)

        // Before focus, so the service is in the foreground before focus is asked for.
        controller.observe(::onState)
        focus = AudioFocusRules(controller, SystemAudioFocus(this, main, ::onFocusChange))
        onState(controller.state)
        session.isActive = true
    }

    override fun onBind(intent: Intent): IBinder = LocalBinder()

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> controller.playPause()
            ACTION_NEXT -> controller.next()
            ACTION_PREVIOUS -> controller.previous()
            ACTION_STOP -> stop()
            BuildConfig.PLAY_TRACK_ACTION -> intent.getStringExtra(BuildConfig.TRACK_ID_EXTRA)?.let(controller::select)
        }
        // A command that did not start playback leaves nothing to keep running for.
        if (!inForeground) stopSelf(startId)
        return START_NOT_STICKY
    }

    // Swiped away from recents: playing carries on, as for any media app;
    // paused, there is nothing left to come back to.
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!controller.state.isPlaying) stop()
    }

    override fun onDestroy() {
        destroyed = true
        focus.release()
        listenForNoisy(false)
        session.release()
        engine.release()
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    /** Pauses, takes the notification down and lets the service end. */
    fun stop() {
        controller.pause()
        if (inForeground) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            inForeground = false
        }
        stopSelf()
    }

    /** Whether sound is coming out, for tests: [PlayerState.isPlaying] is the listener's intent. */
    internal val isSounding get() = engine.isPlaying

    private fun onState(state: PlayerState) {
        val wasInForeground = inForeground
        if (state.isPlaying && !inForeground) enterForeground(state)
        listenForNoisy(state.isPlaying)
        publish(state, updateNotification = wasInForeground)
    }

    private fun enterForeground(state: PlayerState) {
        try {
            startForegroundService(Intent(this, PlaybackService::class.java))
            val built = notification.build(state)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(PlaybackNotification.ID, built, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(PlaybackNotification.ID, built)
            }
            inForeground = true
        } catch (refused: IllegalStateException) {
            // From the background, Android 12 and later refuse. Sound that
            // could be cut off at any moment is not started at all.
            Log.w(TAG, "Not allowed into the foreground; not playing", refused)
            controller.pause()
        }
    }

    // Only what the session and notification show changes them; volume and
    // the notice are the screen's.
    private fun publish(state: PlayerState, updateNotification: Boolean) {
        val before = published
        published = state
        val trackChanged = before?.track != state.track
        val playingChanged = before?.isPlaying != state.isPlaying
        val loadingChanged = before?.isLoading != state.isLoading
        if (trackChanged) session.setMetadata(metadata(state))
        if (playingChanged || loadingChanged) session.setPlaybackState(playbackState(state))
        if (updateNotification && inForeground && (trackChanged || playingChanged)) notification.show(state)
    }

    private fun metadata(state: PlayerState) = MediaMetadata.Builder()
        .putString(MediaMetadata.METADATA_KEY_TITLE, state.track.title)
        .putString(MediaMetadata.METADATA_KEY_ARTIST, getString(R.string.app_name))
        .putString(MediaMetadata.METADATA_KEY_ALBUM, getString(R.string.app_name))
        .putBitmap(MediaMetadata.METADATA_KEY_ART, artwork)
        .build()

    private fun playbackState(state: PlayerState) = PlaybackState.Builder()
        .setActions(
            PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_STOP or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS,
        )
        .setState(
            when {
                !state.isPlaying -> PlaybackState.STATE_PAUSED
                state.isLoading -> PlaybackState.STATE_BUFFERING
                else -> PlaybackState.STATE_PLAYING
            },
            // A loop has no position worth showing; unknown hides the seek bar.
            PlaybackState.PLAYBACK_POSITION_UNKNOWN,
            if (state.isPlaying) 1f else 0f,
        )
        .build()

    private fun onFocusChange(change: Int) {
        when (change) {
            AudioManager.AUDIOFOCUS_GAIN -> focus.onGain()
            AudioManager.AUDIOFOCUS_LOSS -> focus.onLoss()
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> focus.onTransientLoss()
            // AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK: the system lowers us itself.
        }
    }

    private fun listenForNoisy(listen: Boolean) {
        if (listen == listeningForNoisy) return
        listeningForNoisy = listen
        if (listen) {
            registerReceiver(noisy, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY))
        } else {
            unregisterReceiver(noisy)
        }
    }

    // The launcher icon, as the web gives its icon as artwork. Drawn once.
    private fun drawArtwork(): Bitmap {
        val size = ARTWORK_PX
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        getDrawable(R.mipmap.ic_launcher)!!.apply { setBounds(0, 0, size, size) }.draw(Canvas(bitmap))
        return bitmap
    }

    // A key pressed as the service ends can arrive after onDestroy: the
    // session had already queued it. It is dropped — acting on it would start
    // a service that is going away (on Android 8, a crash).
    private inner class SessionCallback : MediaSession.Callback() {
        override fun onPlay() = unlessDestroyed { controller.play() }

        override fun onPause() = unlessDestroyed { controller.pause() }

        override fun onStop() = unlessDestroyed { stop() }

        override fun onSkipToNext() = unlessDestroyed { controller.next() }

        override fun onSkipToPrevious() = unlessDestroyed { controller.previous() }

        private inline fun unlessDestroyed(action: () -> Unit) {
            if (!destroyed) action()
        }
    }

    inner class LocalBinder : Binder() {
        val service: PlaybackService get() = this@PlaybackService
    }

    companion object {
        const val ACTION_PLAY_PAUSE = "com.builduseful.soundscape.action.PLAY_PAUSE"
        const val ACTION_NEXT = "com.builduseful.soundscape.action.NEXT"
        const val ACTION_PREVIOUS = "com.builduseful.soundscape.action.PREVIOUS"
        const val ACTION_STOP = "com.builduseful.soundscape.action.STOP"
        private const val ARTWORK_PX = 192
        private const val TAG = "PlaybackService"
    }
}
