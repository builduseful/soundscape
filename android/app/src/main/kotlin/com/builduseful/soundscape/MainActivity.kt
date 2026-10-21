package com.builduseful.soundscape

import android.app.UiModeManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.Color
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.playback.Cancellable
import com.builduseful.soundscape.core.playback.PlaybackController
import com.builduseful.soundscape.core.playback.PlayerState
import com.builduseful.soundscape.playback.PlaybackService
import com.builduseful.soundscape.playback.SharedPreferenceStore
import com.builduseful.soundscape.ui.PlayerActions
import com.builduseful.soundscape.ui.SoundscapeApp

class MainActivity : ComponentActivity() {
    private var controller: PlaybackController? = null
    private var subscription: Cancellable? = null
    private var playerState by mutableStateOf<PlayerState?>(null)

    private val appearance by lazy { SharedPreferenceStore(this, "appearance") }
    private var theme by mutableStateOf(ThemePreference.System)

    /** A shortcut's track, held until the service is bound. */
    private var requestedTrack: String? = null

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName, binder: IBinder) {
            val player = (binder as PlaybackService.LocalBinder).service.controller
            controller = player
            playerState = player.state
            subscription = player.observe { playerState = it }
            requestedTrack?.let(player::select)
            requestedTrack = null
        }

        override fun onServiceDisconnected(name: ComponentName) = disconnect()
    }

    private val actions = object : PlayerActions {
        override fun playPause() {
            controller?.playPause()
        }

        override fun next() {
            controller?.next()
        }

        override fun previous() {
            controller?.previous()
        }

        override fun setVolume(volume: Float, persist: Boolean) {
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
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        theme = ThemePreference.load(appearance)
        applyToSystem(theme)
        // Recreated (the process was reclaimed): the shortcut was already acted on.
        if (savedInstanceState == null) handle(intent)
        setContent {
            val dark = theme.isDark(isSystemInDarkTheme())
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(bars, bars)
            }
            CompositionLocalProvider(LocalUriHandler provides links) {
                SoundscapeApp(
                    state = playerState,
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

    override fun onStart() {
        super.onStart()
        bindService(Intent(this, PlaybackService::class.java), connection, BIND_AUTO_CREATE)
    }

    override fun onStop() {
        unbindService(connection)
        disconnect()
        super.onStop()
    }

    private fun disconnect() {
        subscription?.cancel()
        subscription = null
        controller = null
    }

    private fun chooseTheme(choice: ThemePreference) {
        if (choice == theme) return
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
        controller?.select(track) ?: run { requestedTrack = track }
    }

    private companion object {
        const val TAG = "MainActivity"
    }
}
