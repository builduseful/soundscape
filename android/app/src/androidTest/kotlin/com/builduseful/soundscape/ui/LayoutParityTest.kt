package com.builduseful.soundscape.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.playback.PlayerState
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized
import kotlin.math.abs

/**
 * Each part of the screen sits where the web puts it, within 2 dp, in every
 * window in shared/fixtures/layout.json (written from the web app by
 * web/scripts/capture-layout.mjs). Text is measured by what does not depend on
 * the font: where it starts, or where its centre is.
 */
/**
 * The screen as web/scripts/capture-layout.mjs renders the page: the first
 * track, paused, in [window], with no motion.
 */
internal fun ComposeContentTestRule.showAsTheWebIsCaptured(window: LayoutParityTest.Window, theme: ThemePreference) {
    val state = PlayerState(catalogTracks.first(), null, isPlaying = false, volume = 1f, isLoading = false, notice = null)
    setContent {
        DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(DpSize(window.width.dp, window.height.dp))) {
            // The web's viewport has no system bars: the insets are taken out of play.
            Box(Modifier.consumeWindowInsets(WindowInsets.safeDrawing)) {
                SoundscapeApp(state, LayoutParityTest.NoPlayer, theme, onTheme = {}, versionName = "1.2.3", reducedMotion = true)
            }
        }
    }
}

@RunWith(Parameterized::class)
class LayoutParityTest(private val window: Window) {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun matchesTheWeb() {
        rule.showAsTheWebIsCaptured(window, ThemePreference.Light)

        // A window smaller than the size asked for is drawn at a smaller density: in its pixels per unit.
        val page = bounds(UiTags.PAGE)
        val unit = page.width / window.width
        fun inDp(rect: Rect) = Rect(
            (rect.left - page.left) / unit,
            (rect.top - page.top) / unit,
            (rect.right - page.left) / unit,
            (rect.bottom - page.top) / unit,
        )

        // Every difference at once, not only the first.
        val differences = mutableListOf<String>()
        for ((part, web) in window.boxes) {
            val android = inDp(bounds(TAGS.getValue(part)))
            fun compare(edge: String, expected: Float, actual: Float) {
                if (abs(expected - actual) > TOLERANCE) differences += "$part $edge: web $expected, Android $actual"
            }
            when (part) {
                "byline" -> {
                    compare("left", web.left, android.left)
                    compare("top", web.top, android.top)
                }
                "title" -> {
                    compare("centre", web.center.x, android.center.x)
                    compare("top", web.top, android.top)
                }
                else -> {
                    compare("left", web.left, android.left)
                    compare("top", web.top, android.top)
                    compare("width", web.width, android.width)
                    compare("height", web.height, android.height)
                }
            }
        }
        assertTrue("In $window:\n" + differences.joinToString("\n"), differences.isEmpty())
    }

    private fun bounds(tag: String): Rect = rule.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot

    class Window(val width: Float, val height: Float, val boxes: Map<String, Rect>) {
        override fun toString() = "${width.toInt()}x${height.toInt()}"
    }

    internal object NoPlayer : PlayerActions {
        override fun playPause() = Unit

        override fun next() = Unit

        override fun previous() = Unit

        override fun setVolume(volume: Float, persist: Boolean) = Unit

        override fun setPresence(level: Float, millis: Long) = Unit

        override fun handOver(millis: Long) = Unit
    }

    companion object {
        private const val TOLERANCE = 2f

        private val TAGS = mapOf(
            "byline" to UiTags.BYLINE,
            "menuButton" to UiTags.MENU_BUTTON,
            "previous" to UiTags.PREVIOUS,
            "playPause" to UiTags.PLAY_PAUSE,
            "next" to UiTags.NEXT,
            "title" to UiTags.TITLE,
            "volumeButton" to UiTags.VOLUME_BUTTON,
        )

        @JvmStatic
        @Parameterized.Parameters(name = "{0}")
        fun windows(): List<Window> {
            val assets = InstrumentationRegistry.getInstrumentation().context.assets
            val fixture = JSONObject(assets.open("layout.json").bufferedReader().readText())
            val windows = fixture.getJSONArray("windows")
            return (0 until windows.length()).map { index ->
                val window = windows.getJSONObject(index)
                val boxes = window.getJSONObject("boxes")
                Window(
                    window.getDouble("width").toFloat(),
                    window.getDouble("height").toFloat(),
                    boxes.keys().asSequence().associateWith { name ->
                        val box = boxes.getJSONObject(name)
                        val left = box.getDouble("x").toFloat()
                        val top = box.getDouble("y").toFloat()
                        Rect(left, top, left + box.getDouble("width").toFloat(), top + box.getDouble("height").toFloat())
                    },
                )
            }
        }
    }
}
