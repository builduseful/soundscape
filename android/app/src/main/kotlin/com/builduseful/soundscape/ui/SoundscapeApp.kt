package com.builduseful.soundscape.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState

/** What the screen asks of the player. Every action goes through the controller. */
interface PlayerActions {
    fun playPause()
    fun next()
    fun previous()

    /** [persist] is false while a slider is still moving. */
    fun setVolume(volume: Float, persist: Boolean)
}

/**
 * The whole screen: one layout for every window, as the web has one page for
 * every viewport.
 */
@Composable
fun SoundscapeApp(
    state: PlayerState,
    actions: PlayerActions,
    theme: ThemePreference,
    onTheme: (ThemePreference) -> Unit,
    versionName: String,
    reducedMotion: Boolean = rememberReducedMotion(),
) {
    val dark = theme.isDark(isSystemInDarkTheme())
    val panels = remember { Panels() }
    val keys = remember { Keys() }
    val root = remember { FocusRequester() }

    BackHandler(enabled = panels.open != null) { panels.close() }
    LaunchedEffect(Unit) { root.requestFocus() }

    CompositionLocalProvider(LocalReducedMotion provides reducedMotion) {
        val darkness by animateFloatAsState(
            if (dark) 1f else 0f,
            if (reducedMotion) snap() else tween(DesignTokens.Duration.themeFade.toInt(), easing = CssEase),
            label = "theme",
        )
        CompositionLocalProvider(LocalPalette provides remember(darkness) { Palette(darkness) }) {
            Page(
                state, actions, theme, onTheme, versionName, panels, keys,
                modifier = Modifier
                    .then(with(panels) { Modifier.dismissOnPressOutside() })
                    .focusRequester(root)
                    .onFocusChanged { keys.rootFocused = it.isFocused }
                    .onPreviewKeyEvent { keys.handle(it, panels, actions) }
                    .focusable(),
            )
        }
    }
}

@Composable
private fun Page(
    state: PlayerState,
    actions: PlayerActions,
    theme: ThemePreference,
    onTheme: (ThemePreference) -> Unit,
    versionName: String,
    panels: Panels,
    keys: Keys,
    modifier: Modifier,
) {
    val palette = LocalPalette.current
    BoxWithConstraints(Modifier.testTag(UiTags.PAGE).fillMaxSize().background(palette.page)) {
        val narrow = maxWidth <= DesignTokens.Size.narrowBreakpoint.dp
        val padding = (if (narrow) DesignTokens.Size.pagePaddingNarrow else DesignTokens.Size.pagePadding).dp
        PageLayout(
            header = { Header(narrow, panels, theme, onTheme, versionName) },
            player = {
                Column(
                    Modifier.widthIn(max = DesignTokens.Size.playerMaxWidth.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Size.playerGap.dp),
                ) {
                    TransportControls(
                        isPlaying = state.isPlaying,
                        narrow = narrow,
                        onPrevious = actions::previous,
                        onPlayPause = actions::playPause,
                        onNext = actions::next,
                        modifier = Modifier.onFocusChanged { keys.transportFocused = it.hasFocus },
                    )
                    TrackStatus(state)
                    (state.notice as? Notice.Failed)?.let { PlaybackError(it.track.title) }
                }
            },
            footer = {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    VolumeControl(panels, state.volume, actions::setVolume)
                }
            },
            // Scrolls only when the window is too short to hold the page. The page's
            // focus and keys are on this, inside the subcomposition: Tab does not
            // search past one from a focused node directly above it.
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(padding),
        )
    }
}

/**
 * The web's `.container` grid: header and footer at their own heights, the
 * player centred in the rest, the whole at least the window's height. The
 * header and footer draw above the player, so their panels cover it.
 */
@Composable
private fun PageLayout(
    header: @Composable () -> Unit,
    player: @Composable () -> Unit,
    footer: @Composable () -> Unit,
    modifier: Modifier,
) {
    Layout(contents = listOf(header, player, footer), modifier = modifier) { (h, p, f), constraints ->
        val loose = Constraints(maxWidth = constraints.maxWidth)
        val top = h.first().measure(loose)
        val bottom = f.first().measure(loose)
        val middle = p.first().measure(loose)
        val height = maxOf(constraints.minHeight, top.height + middle.height + bottom.height)
        val room = height - top.height - bottom.height
        // Placed in reading order, which is the keyboard's order too.
        layout(constraints.maxWidth, height) {
            top.place(0, 0, zIndex = 1f)
            middle.place((constraints.maxWidth - middle.width) / 2, top.height + (room - middle.height) / 2)
            bottom.place(0, height - bottom.height, zIndex = 1f)
        }
    }
}

@Composable
private fun Header(
    narrow: Boolean,
    panels: Panels,
    theme: ThemePreference,
    onTheme: (ThemePreference) -> Unit,
    versionName: String,
) {
    val palette = LocalPalette.current
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = if (narrow) Alignment.CenterVertically else Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(DesignTokens.Size.brandGap.dp)) {
            BasicText(
                stringResource(R.string.app_name),
                Modifier.lineBox(DesignTokens.Type.appName),
                style = DesignTokens.Type.appName.style(palette.textMuted),
            )
            Link(
                text = stringResource(R.string.byline),
                url = stringResource(R.string.byline_url),
                type = DesignTokens.Type.byline,
                modifier = Modifier.testTag(UiTags.BYLINE),
                textAlign = TextAlign.Start,
            )
        }
        Spacer(Modifier.width(DesignTokens.Size.headerGap.dp))
        AppMenu(panels, theme, onTheme, versionName)
    }
}

/**
 * Space plays and pauses, the arrows skip, as on the web — from anywhere but
 * a control of another kind, which keeps its keys. Escape closes a panel.
 */
@Stable
private class Keys {
    var rootFocused by mutableStateOf(false)
    var transportFocused by mutableStateOf(false)

    fun handle(event: KeyEvent, panels: Panels, actions: PlayerActions): Boolean {
        if (event.key == Key.Escape && panels.open != null) {
            if (event.type == KeyEventType.KeyDown) panels.close()
            return true
        }
        if (!rootFocused && !transportFocused) return false
        if (event.isAltPressed || event.isCtrlPressed || event.isMetaPressed) return false
        val action: (() -> Unit) = when (event.key) {
            Key.Spacebar -> actions::playPause
            Key.DirectionLeft -> actions::previous
            Key.DirectionRight -> actions::next
            else -> return false
        }
        // The key's release is taken too, so a focused button does not also click.
        if (event.type == KeyEventType.KeyDown && event.nativeKeyEvent.repeatCount == 0) action()
        return true
    }
}

/** Test tags: how the UI tests find what they press and check. */
object UiTags {
    const val PAGE = "page"
    const val PLAY_PAUSE = "playPause"
    const val PREVIOUS = "previous"
    const val NEXT = "next"
    const val TITLE = "title"
    const val LOADING = "loading"
    const val ERROR = "error"
    const val BYLINE = "byline"
    const val MENU_BUTTON = "menuButton"
    const val MENU_PANEL = "menuPanel"
    const val THEME_SELECTOR = "themeSelector"
    const val VERSION = "version"
    const val VOLUME_BUTTON = "volumeButton"
    const val VOLUME_PANEL = "volumePanel"
    const val VOLUME_SLIDER = "volumeSlider"

    fun themeOption(label: String) = "theme-$label"
}
