package com.builduseful.soundscape.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
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
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.gestures.Gesture
import com.builduseful.soundscape.core.gestures.GestureGuide
import com.builduseful.soundscape.core.gestures.GestureHandlers
import com.builduseful.soundscape.core.gestures.GestureTracker
import com.builduseful.soundscape.core.gestures.SwipeDirection
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** What the screen asks of the player. Every action goes through the controller. */
interface PlayerActions {
    fun playPause()
    fun next()
    fun previous()

    /** [persist] is false while a slider is still moving. */
    fun setVolume(volume: Float, persist: Boolean)

    /** How much of the sound a swipe leaves, 0 to 1, reached over [millis]. */
    fun setPresence(level: Float, millis: Long)

    /** A swipe has committed: the sound leaves over [millis] until the next track rises in its place. */
    fun handOver(millis: Long)
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
    guide: GestureGuide? = null,
    reducedMotion: Boolean = rememberReducedMotion(),
) {
    val dark = theme.isDark(isSystemInDarkTheme())
    val panels = remember { Panels() }
    val keys = remember { Keys() }
    val root = remember { FocusRequester() }
    val guideState = remember(guide) { GuideState(guide) }
    val rest = remember { Rest() }

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
                state, actions, theme, onTheme, versionName, panels, keys, guideState, rest,
                modifier = Modifier
                    .then(with(panels) { Modifier.dismissOnPressOutside() })
                    .then(with(rest) { Modifier.wakesOnPress() })
                    .focusRequester(root)
                    .onFocusChanged { keys.rootFocused = it.isFocused }
                    .onPreviewKeyEvent {
                        rest.wake()
                        keys.handle(it, panels, actions)
                    }
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
    guide: GuideState,
    rest: Rest,
    modifier: Modifier,
) {
    val palette = LocalPalette.current
    val reduced = LocalReducedMotion.current
    val scope = rememberCoroutineScope()
    val pager = remember { Pager(scope) }
    val volume = remember { DragVolume() }
    val current by rememberUpdatedState(state)
    val currentActions by rememberUpdatedState(actions)
    val currentReduced by rememberUpdatedState(reduced)
    val tracker = remember {
        GestureTracker(PlayerGestures(pager, volume, guide, { current }, { currentActions }, { currentReduced }))
    }

    // Left alone, the screen rests: the words fade away and leave the
    // drawing, so the sound has the room rather than the screen. Not while the
    // guide is still talking, nor with a panel open; nor under a screen
    // reader, which would lose what faded to nothing.
    val exploring = rememberTouchExploration()
    val canRest = !guide.open && panels.open == null && !exploring
    LaunchedEffect(rest.activity, canRest) {
        rest.resting = false
        if (!canRest) return@LaunchedEffect
        delay(DesignTokens.Duration.restAfter)
        rest.resting = true
        volume.rest()
    }
    val words = animateFloatAsState(
        if (rest.resting) 0f else 1f,
        when {
            reduced -> snap()
            rest.resting -> tween(DesignTokens.Duration.restFade.toInt(), easing = FadeEasing)
            else -> tween(DesignTokens.Duration.wake.toInt(), easing = FadeEasing)
        },
        label = "rest",
    )

    // Offered once, after the page has arrived, so the guide comes into a settled screen.
    LaunchedEffect(guide) {
        if (!guide.isOffered) return@LaunchedEffect
        delay(DesignTokens.Duration.tutorialDelay)
        guide.start()
    }

    // The page arrives rather than appears: each part rises a little into
    // place as it fades in, top to bottom.
    val arrival = remember { List(3) { Animatable(if (reduced) 1f else 0f) } }
    LaunchedEffect(Unit) {
        arrival.forEachIndexed { index, part ->
            launch {
                delay(index * DesignTokens.Duration.appEnterStagger)
                part.animateTo(1f, tween(DesignTokens.Duration.appEnter.toInt(), easing = LinearEasing))
            }
        }
    }

    BoxWithConstraints(Modifier.testTag(UiTags.PAGE).fillMaxSize().background(palette.page)) {
        val narrow = maxWidth <= DesignTokens.Size.narrowBreakpoint.dp
        val padding = (if (narrow) DesignTokens.Size.pagePaddingNarrow else DesignTokens.Size.pagePadding).dp
        val density = LocalDensity.current
        pager.width = with(density) { maxWidth.toPx() }
        pager.density = density.density
        PageLayout(
            header = {
                Box(Modifier.arrives(arrival[0]).graphicsLayer { alpha = words.value }) {
                    Header(narrow, panels, theme, onTheme, versionName)
                }
            },
            player = {
                Column(
                    Modifier.widthIn(max = DesignTokens.Size.playerMaxWidth.dp).arrives(arrival[1]),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Size.playerGap.dp),
                ) {
                    Pages(
                        state, pager, volume, actions, { words.value }, { rest.resting },
                        Modifier.onFocusChanged { keys.transportFocused = it.hasFocus },
                    )
                    (state.notice as? Notice.Failed)?.let { PlaybackError(it.track.title) }
                }
            },
            footer = {
                Row(Modifier.fillMaxWidth().arrives(arrival[2]), horizontalArrangement = Arrangement.End) {
                    // A drag up or down sets the volume: the button is for the keyboard and TalkBack.
                    VolumeControl(panels, state.volume, actions::setVolume, concealed = true)
                }
            },
            // Scrolls only when the window is too short to hold the page. The page's
            // focus and keys are on this, inside the subcomposition: Tab does not
            // search past one from a focused node directly above it. The gestures
            // are inside the scroll, so they take a drag before it can.
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .playerGestures(tracker)
                .heightIn(min = maxHeight)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(padding),
        )
        GuideCard(
            guide,
            Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                .padding(bottom = DesignTokens.Size.tutorialBottom.dp)
                .padding(horizontal = GUIDE_MARGIN.dp)
                .widthIn(max = DesignTokens.Size.tutorialMaxWidth.dp),
        )
    }
}

// The rise settles on the emphasized curve, the fade on the softer one, as the web's two animations do.
private fun Modifier.arrives(part: Animatable<Float, *>) = graphicsLayer {
    alpha = FadeEasing.transform(part.value)
    translationY = (1 - ArrivalRise.transform(part.value)) * ARRIVAL_RISE.dp.toPx()
}

private val ArrivalRise = DesignTokens.Motion.emphasizedEasing.easing()

// As the web's: how far each part rises as it arrives, and the guide's margin from the window's sides.
private const val ARRIVAL_RISE = 8
private const val GUIDE_MARGIN = 18

/** Whether the screen is resting, and the touches and keys that wake it. */
@Stable
private class Rest {
    var resting by mutableStateOf(false)
    var activity by mutableIntStateOf(0)
        private set

    fun wake() {
        activity++
    }

    /** On the root: every press wakes the screen, before anything handles it, and none is consumed. */
    fun Modifier.wakesOnPress(): Modifier = pointerInput(this@Rest) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            wake()
        }
    }
}

/** What the gestures do: through the pager, the drag's volume and the guide, to the player. */
private class PlayerGestures(
    private val pager: Pager,
    private val volume: DragVolume,
    private val guide: GuideState,
    private val state: () -> PlayerState,
    private val actions: () -> PlayerActions,
    private val reduced: () -> Boolean,
) : GestureHandlers {
    override fun onPress() {
        pager.pressed = true
    }

    override fun onRelease() {
        pager.pressed = false
    }

    override fun onTap() {
        volume.hide()
        guide.completed(Gesture.Tap)
        actions().playPause()
    }

    override fun onSwipeMove(dx: Float) {
        volume.hide()
        pager.drag(dx * pager.density)
        // The sound thins as the page turns, and is gone by half a page.
        if (state().isPlaying && pager.width > 0) {
            val turned = min(1f, abs(dx * pager.density) / (pager.width * DesignTokens.Gesture.swipeFadeDistance))
            actions().setPresence(cos(turned * PI.toFloat() / 2), 0)
        }
    }

    override fun onSwipe(direction: SwipeDirection, velocity: Float) {
        guide.completed(Gesture.Swipe)
        val millis = pager.swipe(direction, velocity, reduced()) {
            if (it == SwipeDirection.Next) actions().next() else actions().previous()
        }
        if (state().isPlaying) actions().handOver(millis.toLong())
    }

    override fun onSwipeCancel() {
        actions().setPresence(1f, DesignTokens.Duration.swipeSettle)
        pager.cancel()
    }

    override fun onVolumeStart() = volume.start(state().volume)

    override fun onVolumeChange(change: Float) = actions().setVolume(volume.change(change), false)

    override fun onVolumeEnd() {
        actions().setVolume(volume.level, true)
        guide.completed(Gesture.Volume)
    }

    override fun onVolumeCancel() = actions().setVolume(volume.cancel(), false)
}

/**
 * The web's `.container` grid: header and footer at their own heights, the
 * player centred across the whole, not just the room between them, which
 * differ in height; the whole at least the window's height. The header and
 * footer draw above the player, so their panels cover it.
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
        val height = maxOf(constraints.minHeight, top.height + bottom.height, middle.height)
        // Placed in reading order, which is the keyboard's order too.
        layout(constraints.maxWidth, height) {
            top.place(0, 0, zIndex = 1f)
            middle.place((constraints.maxWidth - middle.width) / 2, (height - middle.height) / 2)
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
    const val PEEK = "peek"
    const val DRAG_VOLUME = "dragVolume"
    const val GUIDE = "guide"
    const val GUIDE_SKIP = "guideSkip"

    fun themeOption(label: String) = "theme-$label"
}
