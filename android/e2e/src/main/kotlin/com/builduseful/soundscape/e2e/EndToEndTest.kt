package com.builduseful.soundscape.e2e

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.media.AudioManager
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.contract.catalogTracks
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The installed app, driven as a person would: launched from scratch, its
 * controls found by the names TalkBack reads, the sound checked as the system
 * hears it, and the app killed between launches. Each rule is proven in core
 * and in the app's own tests; this proves they are joined up.
 */
@RunWith(AndroidJUnit4::class)
class EndToEndTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val device = UiDevice.getInstance(instrumentation)
    private val context = instrumentation.context
    private val copy = JSONObject(context.assets.open("copy.json").bufferedReader().readText())
    private val audio = context.getSystemService(AudioManager::class.java)

    @Before
    fun freshInstall() {
        clear()
    }

    @After
    fun leave() {
        device.pressHome()
        clear()
    }

    @Test
    fun playsSkipsAndPauses() {
        launch()
        title(catalogTracks[0].title)

        control("play").click()
        waitUntil("the sound") { audio.isMusicActive }
        control("pause")

        control("nextTrack").click()
        title(catalogTracks[1].title)
        control("previousTrack").click()
        title(catalogTracks[0].title)

        control("pause").click()
        waitUntil("silence") { !audio.isMusicActive }
        control("play")
    }

    @Test
    fun playsOnInTheBackgroundUnderTheNotificationsControls() {
        launch()
        control("play").click()
        waitUntil("the sound") { audio.isMusicActive }

        device.pressHome()
        SystemClock.sleep(2_000)
        assertTrue("still heard after leaving the app", audio.isMusicActive)

        device.openNotification()
        shade("pause").click()
        waitUntil("a pause from the notification") { !audio.isMusicActive }
        shade("play").click()
        waitUntil("a resume from the notification") { audio.isMusicActive }
        device.pressBack()
    }

    @Test
    fun aRestartRestoresTheTrackVolumeAndTheme() {
        launch()
        control("nextTrack").click()
        title(catalogTracks[1].title)

        control("volume").click()
        val before = volume()
        val slider = slider().visibleBounds
        device.click(slider.centerX(), slider.bottom - slider.height() * 3 / 10)
        waitUntil("the volume to change") { volume() != before }
        val chosen = volume()
        device.pressBack()

        // Whichever theme the system is not in, so only the saved choice can explain the page after the restart.
        val systemDark = pageColour() == DesignTokens.Color.page.dark.toInt()
        val theme = if (systemDark) "themeLight" else "themeDark"
        val page = (if (systemDark) DesignTokens.Color.page.light else DesignTokens.Color.page.dark).toInt()
        control("menu").click()
        option(theme).click()
        waitUntil("${string(theme)} to be chosen") { option(theme).isChecked }
        device.pressBack()

        // Left, then reclaimed by the system, as an app in the background is.
        device.pressHome()
        device.executeShellCommand("am force-stop $APP")
        launch()

        title(catalogTracks[1].title)
        waitUntil("the page in ${string(theme)}") { pageColour() == page }
        control("volume").click()
        assertEquals(chosen, volume(), 0.001f)
        device.pressBack()
        control("menu").click()
        assertTrue(option(theme).isChecked)
        assertNotEquals(before, chosen)
    }

    // `pm clear` answers before the clear is done: its last step, a force stop,
    // has killed a launch made straight after. The broadcast comes after that.
    // Even then, an activity the force stop left exiting is timed out about half
    // a second on, and the system kills whatever process has the app's name
    // (seen on API 34). Nothing marks that timeout, so its window is waited out.
    private fun clear() {
        val cleared = CountDownLatch(1)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.data?.schemeSpecificPart == APP) cleared.countDown()
            }
        }
        context.registerReceiver(receiver, IntentFilter(Intent.ACTION_PACKAGE_DATA_CLEARED).apply { addDataScheme("package") })
        try {
            device.executeShellCommand("pm clear $APP")
            assertTrue("the app's data cleared", cleared.await(TIMEOUT, TimeUnit.MILLISECONDS))
        } finally {
            context.unregisterReceiver(receiver)
        }
        SystemClock.sleep(2_000)
    }

    private fun launch() {
        val intent = context.packageManager.getLaunchIntentForPackage(APP)!!
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
        val shown = device.wait(Until.findObject(By.pkg(APP).desc(string("menu"))), TIMEOUT)
        assertNotNull("the app on screen, not ${device.currentPackageName}", shown)
    }

    private fun string(key: String): String = copy.getString(key)

    private fun control(label: String): UiObject2 = find("“${string(label)}”", By.pkg(APP).desc(string(label)).clickable(true))

    private fun option(label: String): UiObject2 = find("the option “${string(label)}”", By.pkg(APP).desc(string(label)).checkable(true))

    private fun title(text: String) = find("the title $text", By.pkg(APP).text(text))

    // The slider shares the button's name; it is the one that is not a button.
    private fun slider() = find("the volume slider", By.pkg(APP).desc(string("volume")).clickable(false))

    // The notification's own buttons, or from Android 13 the media controls the system draws from the session.
    private fun shade(label: String) = find("“${string(label)}” in the notification shade", By.desc(string(label)))

    private fun find(what: String, selector: BySelector): UiObject2 {
        val found = device.wait(Until.findObject(selector), TIMEOUT)
        assertNotNull("$what on screen", found)
        return found
    }

    /** The slider's value, as TalkBack reads it: the one node on screen with a range. */
    private fun volume(): Float {
        slider()
        fun ranged(node: AccessibilityNodeInfo): AccessibilityNodeInfo? =
            if (node.rangeInfo != null) node else (0 until node.childCount).firstNotNullOfOrNull { i -> node.getChild(i)?.let(::ranged) }
        val slider = checkNotNull(ranged(instrumentation.uiAutomation.rootInActiveWindow)) { "no slider on screen" }
        return slider.rangeInfo.current
    }

    // Beside the page's left edge, halfway down: nothing but the page is drawn there.
    private fun pageColour(): Int {
        val screen = instrumentation.uiAutomation.takeScreenshot()
        return screen.getPixel(screen.width / 40, screen.height / 2).also { screen.recycle() } or Color.BLACK
    }

    private fun waitUntil(what: String, condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + TIMEOUT
        while (!condition()) {
            check(SystemClock.elapsedRealtime() < deadline) { "timed out waiting for $what" }
            SystemClock.sleep(100)
        }
    }

    private companion object {
        const val APP = "com.builduseful.soundscape"

        // A ceiling for an emulator still busy after its boot, not a budget: time to
        // first frame and first sound have their own.
        const val TIMEOUT = 60_000L
    }
}
