package com.builduseful.soundscape

import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.playback.Cancellable
import com.builduseful.soundscape.core.playback.PlaybackController
import com.builduseful.soundscape.core.playback.PlayerState
import com.builduseful.soundscape.diagnostics.ScreenDiagnostics
import com.builduseful.soundscape.playback.AppShortcuts
import com.builduseful.soundscape.playback.PlaybackService
import com.builduseful.soundscape.playback.SharedPreferenceStore
import com.builduseful.soundscape.ui.PlayerActions
import com.builduseful.soundscape.ui.SoundscapeApp

class MainActivity : ComponentActivity() {
    private var controller: PlaybackController? = null
    private var subscription: Cancellable? = null
    private lateinit var playerState: MutableState<PlayerState>

    private val appearance by lazy { SharedPreferenceStore(this, "appearance") }
    private var theme by mutableStateOf(ThemePreference.System)

    /** A shortcut's track, held until the service is bound. */
    private var requestedTrack: String? = null

    // TEMPORARY
    private val diagnostics = ScreenDiagnostics(this)

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val player = (binder as PlaybackService.LocalBinder).service.controller
            diagnostics.connected()
            controller = player
            playerState.value = player.state
            subscription = player.observe { playerState.value = it }
            requestedTrack?.let(player::select)
            requestedTrack = null
        }

        override fun onServiceDisconnected(name: ComponentName) = disconnect()
    }

    private val actions = object : PlayerActions {
        override fun playPause() {
            diagnostics.action("play/pause")
            controller?.playPause()
        }

        override fun next() {
            diagnostics.action("next")
            controller?.next()
        }

        override fun previous() {
            diagnostics.action("previous")
            controller?.previous()
        }

        override fun setVolume(volume: Float, persist: Boolean) {
            if (persist) diagnostics.action("volume ${(volume * 100).toInt()}%")
            controller?.setVolume(volume, persist)
        }
    }

    // A link with nowhere to open (no browser) does nothing, rather than crash.
    private val links = object : UriHandler {
        override fun openUri(uri: String) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(uri)))
            } catch (missing: ActivityNotFoundException) {
                Log.w(TAG, "Nothing can open $uri", missing)
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        diagnostics.created(
            recreated = savedInstanceState != null,
            shortcut = intent.takeIf { it.action == BuildConfig.PLAY_TRACK_ACTION }?.getStringExtra(BuildConfig.TRACK_ID_EXTRA),
        )
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // The volume keys set the media volume here even while paused, not the
        // ringer's, as older releases otherwise do.
        volumeControlStream = AudioManager.STREAM_MUSIC
        theme = ThemePreference.load(appearance)
        // What the player will start as, so the first frame shows the saved
        // track and volume rather than waiting a frame for the service.
        playerState = mutableStateOf(PlayerState.restored(catalogTracks, SharedPreferenceStore(this, PlaybackService.PREFERENCES)))
        // Recreated: the shortcut was already acted on, unless it was still waiting for the player.
        if (savedInstanceState == null) handle(intent) else requestedTrack = savedInstanceState.getString(REQUESTED_TRACK)
        // For the next launch's splash screen, so not before this one's first frame.
        window.decorView.post { applyToSystem(theme) }
        setContent {
            val dark = theme.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(bars, bars)
            }
            CompositionLocalProvider(LocalUriHandler provides links) {
                SoundscapeApp(
                    state = playerState.value,
                    actions = actions,
                    theme = theme,
                    onTheme = ::chooseTheme,
                    versionName = BuildConfig.VERSION_NAME,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(REQUESTED_TRACK, requestedTrack)
    }

    override fun onStart() {
        super.onStart()
        diagnostics.started()
        bindService(Intent(this, PlaybackService::class.java), connection, BIND_AUTO_CREATE)
    }

    override fun onStop() {
        diagnostics.stopped(playerState.value.isPlaying)
        unbindService(connection)
        disconnect()
        super.onStop()
    }

    override fun onDestroy() {
        diagnostics.destroyed()
        super.onDestroy()
    }

    private fun disconnect() {
        subscription?.cancel()
        subscription = null
        controller = null
    }

    private fun chooseTheme(choice: ThemePreference) {
        if (choice == theme) return
        diagnostics.action("theme ${choice.name.lowercase()}")
        theme = choice
        ThemePreference.save(appearance, choice)
        applyToSystem(choice)
    }

    // On 12 and later the system keeps the app's theme, so its splash screen
    // and its own surfaces match the choice from the first frame of a launch.
    private fun applyToSystem(choice: ThemePreference) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        getSystemService(UiModeManager::class.java).setApplicationNightMode(
            when (choice) {
                ThemePreference.System -> UiModeManager.MODE_NIGHT_AUTO
                ThemePreference.Light -> UiModeManager.MODE_NIGHT_NO
                ThemePreference.Dark -> UiModeManager.MODE_NIGHT_YES
            },
        )
    }

    // An app shortcut: "play this soundscape" (see PlaybackController.select).
    private fun handle(intent: Intent) {
        if (intent.action != BuildConfig.PLAY_TRACK_ACTION) return
        val track = intent.getStringExtra(BuildConfig.TRACK_ID_EXTRA) ?: return
        window.decorView.post { AppShortcuts.used(this, track) }
        controller?.select(track) ?: run { requestedTrack = track }
    }

    private companion object {
        const val TAG = "MainActivity"
        const val REQUESTED_TRACK = "requestedTrack"
    }
}
