package com.builduseful.soundscape.playback

import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ShortcutManager
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.SystemClock
import android.view.KeyEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import com.builduseful.soundscape.audio.mediaAttributes
import com.builduseful.soundscape.core.contract.catalogTracks
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

// The service as the OS sees it: the notification, media keys, audio focus,
// unplugging, shortcuts, and playing on without the screen. What each rule
// decides is proven on the JVM (PlaybackControllerTest, AudioFocusRulesTest);
// this proves the platform delivers to them.
@RunWith(AndroidJUnit4::class)
class PlaybackServiceTest {
    private val harness = ServiceHarness()
    private val context = harness.context
    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private val audio = context.getSystemService(AudioManager::class.java)
    private val notifications = context.getSystemService(NotificationManager::class.java)

    @After
    fun stop() {
        harness.close()
        device.pressHome()
    }

    // Without POST_NOTIFICATIONS, which the app does not ask for: a
    // media-session notification is exempt on Android 13 and later.
    @Test
    fun theNotificationShowsTheTrack() {
        harness.playing("fireplace")
        assertTrue(notifications.activeNotifications.any { it.id == PlaybackNotification.ID })

        device.openNotification()
        assertNotNull("the track's title in the notification shade", device.wait(Until.findObject(By.text(title("fireplace"))), 5_000))
        device.pressBack()
    }

    @Test
    fun mediaKeysControlPlayback() {
        harness.playing("rain")

        press(KeyEvent.KEYCODE_MEDIA_NEXT)
        harness.waitUntil("next") { harness.controller { state.track.id } == catalogTracks[1].id }

        press(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
        harness.waitUntil("previous") { harness.controller { state.track.id } == "rain" }

        press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        harness.waitUntil("pause") { !harness.isSounding }
        press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        harness.waitUntil("resume") { harness.isSounding }
    }

    @Test
    fun aShortcutOpensTheAppAndPlaysItsTrack() {
        val shortcuts = context.getSystemService(ShortcutManager::class.java).manifestShortcuts.sortedBy { it.rank }
        assertEquals(listOf("garden-rain", "fireplace", "rain-thunder"), shortcuts.map { it.id })

        val shortcut = shortcuts.first { it.id == "rain-thunder" }
        assertEquals(title("rain-thunder"), shortcut.shortLabel)
        context.startActivity(Intent(shortcut.intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))

        harness.waitUntil("the shortcut's track to be heard") {
            harness.isSounding && harness.controller { state.track.id } == "rain-thunder"
        }
    }

    // With the activity gone and nothing bound, the service alone keeps the
    // sound going: it is in the foreground.
    @Test
    fun playbackOutlivesTheScreen() {
        val shortcut = context.getSystemService(ShortcutManager::class.java).manifestShortcuts.first()
        context.startActivity(Intent(shortcut.intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        harness.waitUntil("the app to start playing") { audio.isMusicActive }
        harness.unbind()

        device.pressHome()
        SystemClock.sleep(3_000)

        assertTrue("still heard after leaving the app", audio.isMusicActive)
        assertTrue(harness.isSounding)
    }

    @Test
    fun unpluggingHeadphonesPauses() {
        harness.playing("rain")

        // The broadcast is the system's alone to send; this is what it delivers.
        val service = harness.service
        harness.onMain { service.noisy.onReceive(context, Intent(AudioManager.ACTION_AUDIO_BECOMING_NOISY)) }

        assertFalse(harness.controller { state.isPlaying })
        harness.waitUntil("silence") { !harness.isSounding }
    }

    @Test
    fun aBriefInterruptionPausesAndThenResumes() {
        harness.playing("rain")

        val interruption = focusRequest(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        assertEquals(AudioManager.AUDIOFOCUS_REQUEST_GRANTED, audio.requestAudioFocus(interruption))
        harness.waitUntil("a pause for the interruption") { !harness.isSounding }

        audio.abandonAudioFocusRequest(interruption)
        harness.waitUntil("a resume after it") { harness.isSounding }
    }

    @Test
    fun anotherPlayerTakingOverPausesForGood() {
        harness.playing("rain")

        val other = focusRequest(AudioManager.AUDIOFOCUS_GAIN)
        audio.requestAudioFocus(other)
        harness.waitUntil("a pause") { !harness.isSounding }

        audio.abandonAudioFocusRequest(other)
        SystemClock.sleep(1_000)
        assertFalse("not resumed", harness.isSounding)
    }

    // Stop ends the service. A media key afterwards finds nothing to resume and
    // must do nothing — not crash, and not start sound it could not keep. Sent
    // at once, it reaches the session as the service is destroyed: on API 26
    // that crashed the app until late callbacks were dropped.
    @Test
    fun stopTakesTheNotificationDownAndLaterKeysDoNothing() {
        harness.playing("rain")
        press(KeyEvent.KEYCODE_MEDIA_STOP)
        harness.waitUntil("the notification to go") { notifications.activeNotifications.none { it.id == PlaybackNotification.ID } }
        assertFalse(harness.isSounding)
        harness.unbind()

        press(KeyEvent.KEYCODE_MEDIA_PLAY)
        SystemClock.sleep(1_500)
        assertFalse(audio.isMusicActive)
    }

    private fun press(code: Int) {
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    private fun focusRequest(gain: Int) = AudioFocusRequest.Builder(gain)
        .setAudioAttributes(mediaAttributes)
        .setOnAudioFocusChangeListener { }
        .build()

    private fun title(id: String) = catalogTracks.first { it.id == id }.title
}
