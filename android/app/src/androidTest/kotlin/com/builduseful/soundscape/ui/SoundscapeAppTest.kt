package com.builduseful.soundscape.ui

import androidx.activity.ComponentActivity
import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.nativeKeyCode
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.ForcedSize
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The screen against a recorded player: what each control asks for, what each
 * state shows, the keyboard, and the layout in every shape of window. The
 * player's own rules are core's tests; these hold the UI to its half.
 */
@RunWith(AndroidJUnit4::class)
class SoundscapeAppTest {
    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val rain = catalogTracks.first()
    private var state by mutableStateOf(PlayerState(rain, null, isPlaying = false, volume = 1f, isLoading = false, notice = null))
    private var theme by mutableStateOf(ThemePreference.System)
    private val player = RecordingPlayer()

    private fun show(size: DpSize? = null, reducedMotion: Boolean = true) = rule.setContent {
        val app = @Composable {
            SoundscapeApp(state, player, theme, onTheme = { theme = it }, versionName = "1.2.3", reducedMotion = reducedMotion)
        }
        if (size == null) app() else DeviceConfigurationOverride(DeviceConfigurationOverride.ForcedSize(size)) { app() }
    }

    private fun string(@StringRes id: Int, vararg args: Any) = rule.activity.getString(id, *args)

    private fun tag(tag: String) = rule.onNodeWithTag(tag, useUnmergedTree = true)

    // Through the system, as a keyboard's keys arrive: the window's own focus
    // navigation is part of what Tab does.
    private fun press(key: Key, times: Int = 1) {
        repeat(times) { device.pressKeyCode(key.nativeKeyCode) }
        rule.waitForIdle()
    }

    private val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())

    @Test
    fun eachTransportButtonAsksThePlayer() {
        show()
        tag(UiTags.PLAY_PAUSE).performClick()
        tag(UiTags.NEXT).performClick()
        tag(UiTags.PREVIOUS).performClick()
        assertEquals(listOf("playPause", "next", "previous"), player.calls)
    }

    // The button names what it will do, as the web's aria-label does.
    @Test
    fun thePlayButtonNamesItsAction() {
        show()
        tag(UiTags.PLAY_PAUSE).assertContentDescriptionEquals(string(R.string.play))
        state = state.copy(isPlaying = true)
        tag(UiTags.PLAY_PAUSE).assertContentDescriptionEquals(string(R.string.pause))
    }

    @Test
    fun theTitleIsTheTrackOnScreen() {
        show()
        rule.onNodeWithText(rain.title).assertIsDisplayed()
        state = state.copy(track = catalogTracks[1])
        rule.onNodeWithText(catalogTracks[1].title).assertIsDisplayed()
    }

    // Loading and a failure share one line: whichever came later holds it.
    @Test
    fun loadingAndFailureNeverShowTogether() {
        show()
        state = state.copy(isLoading = true, notice = Notice.Loading)
        tag(UiTags.LOADING).assertExists()
        tag(UiTags.ERROR).assertDoesNotExist()

        state = state.copy(isLoading = false, notice = Notice.Failed(rain))
        tag(UiTags.LOADING).assertDoesNotExist()
        rule.onNodeWithText(string(R.string.playback_failed, rain.title)).assertIsDisplayed()
    }

    // Where motion is off a frozen sweep would read as stalled, so the words show.
    @Test
    fun withoutMotionLoadingIsSaidInWords() {
        state = state.copy(isLoading = true, notice = Notice.Loading)
        show(reducedMotion = true)
        rule.onNodeWithText(string(R.string.loading), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun theMenuChoosesTheTheme() {
        show()
        tag(UiTags.MENU_PANEL).assertDoesNotExist()
        tag(UiTags.MENU_BUTTON).performClick()
        tag(UiTags.themeOption(string(R.string.theme_system))).assertIsSelected()
        rule.onNodeWithText("1.2.3").assertIsDisplayed()

        tag(UiTags.themeOption(string(R.string.theme_dark))).performClick()
        assertEquals(ThemePreference.Dark, theme)
        tag(UiTags.themeOption(string(R.string.theme_dark))).assertIsSelected()
    }

    // A press outside a panel closes it, and still reaches what it landed on.
    @Test
    fun aPressOutsideClosesThePanelAndStillCounts() {
        show()
        tag(UiTags.MENU_BUTTON).performClick()
        tag(UiTags.MENU_PANEL).assertExists()
        tag(UiTags.NEXT).performClick()
        tag(UiTags.MENU_PANEL).assertDoesNotExist()
        assertEquals(listOf("next"), player.calls)
    }

    // At most one panel is open, as with the web's popover="auto".
    @Test
    fun openingOnePanelClosesTheOther() {
        show()
        tag(UiTags.MENU_BUTTON).performClick()
        tag(UiTags.VOLUME_BUTTON).performClick()
        tag(UiTags.MENU_PANEL).assertDoesNotExist()
        tag(UiTags.VOLUME_PANEL).assertExists()
    }

    @Test
    fun backClosesAnOpenPanelFirst() {
        show()
        tag(UiTags.VOLUME_BUTTON).performClick()
        tag(UiTags.VOLUME_PANEL).assertExists()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        tag(UiTags.VOLUME_PANEL).assertDoesNotExist()
        assertFalse(rule.activity.isFinishing)
    }

    @Test
    fun theSliderSetsAndSavesTheVolume() {
        show()
        tag(UiTags.VOLUME_BUTTON).performClick()
        tag(UiTags.VOLUME_SLIDER).performSemanticsAction(SemanticsActions.SetProgress) { it(0.25f) }
        assertEquals(listOf("volume 0.25 saved"), player.calls)
    }

    // Space plays and pauses and the arrows skip, from the page and the transport.
    @Test
    fun thePageKeysDriveThePlayer() {
        show()
        press(Key.Spacebar)
        press(Key.DirectionRight)
        press(Key.DirectionLeft)
        assertEquals(listOf("playPause", "next", "previous"), player.calls)
    }

    // A focused button takes Space for itself only through the page's rule: once.
    @Test
    fun spaceOnAFocusedTransportButtonActsOnce() {
        show()
        press(Key.Tab, times = 3)
        tag(UiTags.PREVIOUS).assertIsFocused()
        press(Key.Spacebar)
        assertEquals(listOf("playPause"), player.calls)
    }

    // Tab follows reading order, as on the web: byline, menu, transport, volume.
    @Test
    fun tabFollowsReadingOrder() {
        show()
        press(Key.Tab, times = 2)
        tag(UiTags.MENU_BUTTON).assertIsFocused()
        press(Key.Tab)
        tag(UiTags.PREVIOUS).assertIsFocused()
        press(Key.Tab, times = 3)
        tag(UiTags.VOLUME_BUTTON).assertIsFocused()
    }

    // Moving between a panel's own controls is not leaving it.
    @Test
    fun theKeyboardWorksInsideTheMenu() {
        show()
        press(Key.Tab, times = 2)
        press(Key.Enter)
        tag(UiTags.MENU_PANEL).assertExists()
        press(Key.Tab)
        tag(UiTags.themeOption(string(R.string.theme_system))).assertIsFocused()
        tag(UiTags.MENU_PANEL).assertExists()

        press(Key.DirectionRight)
        press(Key.Enter)
        assertEquals(ThemePreference.Light, theme)
        // Arrows inside a control of another kind are its own, not a skip.
        assertTrue(player.calls.isEmpty())

        press(Key.Escape)
        tag(UiTags.MENU_PANEL).assertDoesNotExist()
    }

    @Test
    fun focusLeavingAPanelClosesIt() {
        show()
        press(Key.Tab, times = 2)
        press(Key.Enter)
        press(Key.Tab, times = 5)
        tag(UiTags.MENU_PANEL).assertDoesNotExist()
    }

    // Opened from the keyboard, the slider takes focus and the arrows step it.
    @Test
    fun theKeyboardOpensAndStepsTheSlider() {
        state = state.copy(volume = 0.5f)
        show()
        press(Key.Tab, times = 6)
        press(Key.Enter)
        tag(UiTags.VOLUME_SLIDER).assertIsFocused()
        press(Key.DirectionUp)
        assertEquals(listOf("volume 0.51 saved"), player.calls)
    }

    @Test
    fun aPhoneFitsTheWholePage() = fitsTheWindow(DpSize(360.dp, 640.dp), narrow = true)

    @Test
    fun aLandscapePhoneFitsTheWholePage() = fitsTheWindow(DpSize(800.dp, 360.dp), narrow = false)

    @Test
    fun aTabletFitsTheWholePage() = fitsTheWindow(DpSize(1280.dp, 800.dp), narrow = false)

    @Test
    fun aFoldablesInnerScreenFitsTheWholePage() = fitsTheWindow(DpSize(673.dp, 841.dp), narrow = false)

    // Shorter than the page: it scrolls rather than overlap.
    @Test
    fun aShortWindowScrollsRatherThanOverlap() = fitsTheWindow(DpSize(360.dp, 300.dp), narrow = true)

    /**
     * Every control is reachable and none overlaps another; the header and the
     * volume button keep to the page's padding; the play button is sized for
     * the width, as the web's breakpoint does.
     */
    private fun fitsTheWindow(size: DpSize, narrow: Boolean) {
        show(size)

        val parts = listOf(UiTags.BYLINE, UiTags.MENU_BUTTON, UiTags.PREVIOUS, UiTags.PLAY_PAUSE, UiTags.NEXT, UiTags.TITLE, UiTags.VOLUME_BUTTON)
        // Laid out, before any scrolling moves them.
        val bounds = parts.associateWith { tag(it).bounds() }
        for ((a, first) in bounds) for ((b, second) in bounds) {
            if (a < b) assertFalse("$a overlaps $b in $size", first.overlaps(second))
        }

        // A window smaller than the size asked for is drawn at a smaller density: in its pixels per unit.
        val page = tag(UiTags.PAGE).bounds()
        val unit = page.width / size.width.value
        val play = unit * if (narrow) DesignTokens.Size.playButtonNarrow else DesignTokens.Size.playButton
        assertEquals("play button for this width", play, bounds.getValue(UiTags.PLAY_PAUSE).width, 1.5f)
        val padding = unit * if (narrow) DesignTokens.Size.pagePaddingNarrow else DesignTokens.Size.pagePadding
        assertEquals("menu at the trailing padding", page.right - padding, bounds.getValue(UiTags.MENU_BUTTON).right, 1.5f)
        assertEquals("volume at the trailing padding", page.right - padding, bounds.getValue(UiTags.VOLUME_BUTTON).right, 1.5f)
        assertEquals("transport centred", page.center.x, bounds.getValue(UiTags.PLAY_PAUSE).center.x, 1.5f)

        for (part in parts) tag(part).performScrollTo().assertIsDisplayed()
    }

    private fun SemanticsNodeInteraction.bounds(): Rect = fetchSemanticsNode().boundsInRoot
}

private class RecordingPlayer : PlayerActions {
    val calls = mutableListOf<String>()

    override fun playPause() {
        calls += "playPause"
    }

    override fun next() {
        calls += "next"
    }

    override fun previous() {
        calls += "previous"
    }

    override fun setVolume(volume: Float, persist: Boolean) {
        calls += "volume $volume" + if (persist) " saved" else ""
    }
}
