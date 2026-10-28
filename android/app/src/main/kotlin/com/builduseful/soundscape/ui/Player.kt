package com.builduseful.soundscape.ui

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.core.Track
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.contract.catalogTracks
import com.builduseful.soundscape.core.gestures.SwipeDirection
import com.builduseful.soundscape.core.gestures.swipeDurationMillis
import com.builduseful.soundscape.core.playback.PlayerState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs

/**
 * The soundscapes lie side by side, a screen's width apart, and a swipe turns
 * from one to the next as a page does: the name and drawing are under the
 * finger, the neighbour coming in beside them. Let go heading on and they
 * carry on at the finger's speed until the neighbour is in place; let go
 * short, or heading back, and they settle home.
 *
 * Each page is keyed, and the neighbour's key is the next one along, so when
 * a swipe lands the neighbour simply becomes the page: its drawing keeps its
 * motion and its name stays put, with nothing handed over to be seen.
 */
@Stable
internal class Pager(private val scope: CoroutineScope) {
    /** How far across the current page is, in px. */
    var offset by mutableFloatStateOf(0f)
        private set

    /** Under a finger, from the moment it touches: the pages sink in a little. */
    var pressed by mutableStateOf(false)

    /** The neighbour coming in, and which side: 1 the next, to the right; -1 the previous, to the left. */
    var peek: Track? by mutableStateOf(null)
        private set
    var side by mutableIntStateOf(0)
        private set

    /** The current page's key; the neighbour's is the next. */
    var key by mutableIntStateOf(0)
        private set

    /** The track the page shows: ahead of the player's state for the moment after a swipe lands. */
    var shown: Track? by mutableStateOf(null)
        private set
    private var lastState: Track? = null

    /** The page's width in px, and px per dp: the pages are this far apart. */
    var width = 0f
    var density = 1f

    private var dragging = false
    private var slide: Slide? = null

    /** Keeps up with the player: a change it made itself (a key, the notification) is shown at once. */
    fun follow(track: Track) {
        if (track == lastState) return
        lastState = track
        shown = track
    }

    fun drag(dx: Float) {
        // A drag that starts while the last swipe is still moving takes over
        // from where that would have ended.
        if (!dragging) slide?.end()
        dragging = true
        show(if (dx < 0) 1 else -1)
        offset = dx
    }

    /** [velocity] is the finger's as it let go, in dp/ms. */
    /** Returns how long the slide takes, in ms. */
    fun swipe(direction: SwipeDirection, velocity: Float, reduced: Boolean, change: (SwipeDirection) -> Unit): Int {
        val to = if (direction == SwipeDirection.Next) 1 else -1
        release()
        show(to)
        val millis = if (reduced) 0 else swipeDurationMillis((width - abs(offset)) / density, -velocity * to).toInt()
        Slide(-to * width) {
            val arrived = peek
            key++
            offset = 0f
            peek = null
            side = 0
            shown = arrived
            change(direction)
        }.start(millis)
        return millis
    }

    fun cancel() {
        release()
        Slide(0f) {
            peek = null
            side = 0
        }.start(DesignTokens.Duration.swipeSettle.toInt())
    }

    private fun release() {
        dragging = false
    }

    private fun show(to: Int) {
        if (to == side) return
        val current = shown ?: return
        val index = catalogTracks.indexOf(current)
        side = to
        peek = catalogTracks[(index + to + catalogTracks.size) % catalogTracks.size]
    }

    /** The pages moving from where they are to [to]; [then] once they are there, or at once if a new drag cuts in. */
    private inner class Slide(private val to: Float, private val then: () -> Unit) {
        private var job: Job? = null

        fun start(millis: Int) {
            slide = this
            job = scope.launch {
                animate(offset, to, animationSpec = tween(millis, easing = SwipeEasing)) { value, _ -> offset = value }
                end()
            }
        }

        fun end() {
            if (slide !== this) return
            slide = null
            job?.cancel()
            offset = to
            then()
        }
    }
}

private val SwipeEasing = DesignTokens.Motion.swipeEasing.easing()

/**
 * The level a drag set, shown under the name until the screen rests, when it
 * goes with the words; any other gesture is about something else, and clears it.
 */
@Stable
internal class DragVolume {
    var active by mutableStateOf(false)
        private set

    /** Whether it was cleared by the screen resting, and so fades at the words' pace. */
    var rested by mutableStateOf(false)
        private set
    var level by mutableFloatStateOf(1f)
        private set
    private var from = 1f

    fun start(volume: Float) {
        from = volume
        level = volume
        active = true
        rested = false
    }

    /** [change] is since the drag began, as a fraction of the range. Returns the level. */
    fun change(change: Float): Float {
        level = (from + change).coerceIn(0f, 1f)
        return level
    }

    fun hide() {
        active = false
    }

    /** Back to where the drag found it, and gone. Returns that level. */
    fun cancel(): Float {
        level = from
        active = false
        return from
    }

    fun rest() {
        if (!active) return
        active = false
        rested = true
    }
}

/** The pages: the current one, and while a swipe moves, its neighbour beside it. */
@Composable
internal fun Pages(
    state: PlayerState,
    pager: Pager,
    volume: DragVolume,
    narrow: Boolean,
    actions: PlayerActions,
    words: () -> Float,
    modifier: Modifier = Modifier,
) {
    SideEffect { pager.follow(state.track) }
    val reduced = LocalReducedMotion.current
    val press = animateFloatAsState(
        if (pager.pressed) DesignTokens.Motion.dragPressScale else 1f,
        when {
            reduced -> snap()
            pager.pressed -> tween(DesignTokens.Duration.dragPress.toInt(), easing = DesignTokens.Motion.pressEasing.easing())
            else -> tween(DesignTokens.Duration.dragRelease.toInt(), easing = DesignTokens.Motion.emphasizedEasing.easing())
        },
        label = "press",
    )
    val shown = pager.shown ?: state.track
    val pages = listOfNotNull(
        Page(pager.key, if (shown == state.track) state else state.asPeek(shown), centre = true),
        pager.peek?.let { Page(pager.key + 1, state.asPeek(it), centre = false) },
    )
    Box(modifier, contentAlignment = Alignment.Center) {
        for (page in pages) {
            key(page.key) {
                TrackPage(
                    page.state,
                    page.centre,
                    narrow,
                    actions,
                    volume,
                    words,
                    Modifier.graphicsLayer {
                        translationX = pager.offset + if (page.centre) 0f else pager.side * pager.width
                        scaleX = press.value
                        scaleY = press.value
                    },
                )
            }
        }
    }
}

private class Page(val key: Int, val state: PlayerState, val centre: Boolean)

// A neighbour shows its name and drawing, and nothing of the player's comings and goings.
private fun PlayerState.asPeek(track: Track) = copy(track = track, trackChange = null, isLoading = false, notice = null)

/**
 * One soundscape: its drawing above its name (the web's `.track-status`), and
 * on the current page the buttons over the drawing and the level a drag sets
 * hung below the name.
 */
@Composable
private fun TrackPage(
    state: PlayerState,
    centre: Boolean,
    narrow: Boolean,
    actions: PlayerActions,
    volume: DragVolume,
    words: () -> Float,
    modifier: Modifier,
) {
    Layout(
        content = {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(DesignTokens.Size.stageGap.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Stage(state.track.id, state.isPlaying)
                    if (centre) {
                        TransportControls(
                            isPlaying = state.isPlaying,
                            narrow = narrow,
                            onPrevious = actions::previous,
                            onPlayPause = actions::playPause,
                            onNext = actions::next,
                        )
                    }
                }
                TrackStatus(state, words, peek = !centre)
            }
            if (centre) DragVolumeBar(volume)
        },
        modifier = modifier,
    ) { measurables, constraints ->
        val page = measurables[0].measure(constraints)
        val bar = measurables.getOrNull(1)?.measure(Constraints())
        layout(page.width, page.height) {
            page.place(0, 0)
            bar?.place((page.width - bar.width) / 2, page.height + DesignTokens.Size.gestureVolumeOffset.dp.roundToPx())
        }
    }
}

@Composable
private fun DragVolumeBar(volume: DragVolume) {
    val palette = LocalPalette.current
    val shown = animateFloatAsState(
        if (volume.active) 1f else 0f,
        when {
            LocalReducedMotion.current -> snap()
            volume.rested -> tween(DesignTokens.Duration.restFade.toInt(), easing = FadeEasing)
            else -> tween(BAR_FADE_MILLIS, easing = CssEase)
        },
        label = "drag volume",
    )
    Canvas(
        Modifier
            .testTag(UiTags.DRAG_VOLUME)
            .size(DesignTokens.Size.gestureVolumeWidth.dp, DesignTokens.Size.gestureVolumeHeight.dp)
            .graphicsLayer { alpha = shown.value },
    ) {
        val radius = CornerRadius(size.height / 2)
        val track = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, radius)) }
        drawRoundRect(palette.border, cornerRadius = radius)
        clipPath(track) { drawRect(palette.textMuted, size = Size(size.width * volume.level, size.height)) }
    }
}

// As the web's: the bar's fade.
private const val BAR_FADE_MILLIS = 250
