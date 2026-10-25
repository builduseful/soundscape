package com.builduseful.soundscape.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.playback.Direction
import com.builduseful.soundscape.core.playback.Notice
import com.builduseful.soundscape.core.playback.PlayerState

/**
 * The title, and the loading indicator hung below it without a row of its own,
 * so a slow change cannot nudge the controls (the web's `.track-status`).
 */
@Composable
internal fun TrackStatus(state: PlayerState, modifier: Modifier = Modifier) {
    val reduced = LocalReducedMotion.current
    val offset = (if (reduced) DesignTokens.Size.loadingOffsetReduced else DesignTokens.Size.loadingOffset).dp
    Layout(
        content = {
            TrackTitle(state.track.title, state.trackChange, dim = state.isLoading)
            if (state.notice == Notice.Loading) LoadingIndicator()
        },
        modifier = modifier,
    ) { measurables, constraints ->
        val title = measurables[0].measure(constraints)
        // As wide as the title (CSS `inset-inline: 0`), at least the bar.
        val loading = measurables.getOrNull(1)?.measure(Constraints(minWidth = title.width, maxWidth = maxOf(title.width, constraints.maxWidth)))
        layout(title.width, title.height) {
            title.place(0, 0)
            loading?.place((title.width - loading.width) / 2, title.height + offset.roundToPx())
        }
    }
}

@Composable
private fun TrackTitle(title: String, change: Direction?, dim: Boolean) {
    val palette = LocalPalette.current
    val reduced = LocalReducedMotion.current
    val style = DesignTokens.Type.title.style(palette.text).copy(textAlign = TextAlign.Center)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val minWidth = remember(style, density) { measurer.chars(style, density, DesignTokens.Size.titleMinWidthChars) }

    var current by remember { mutableStateOf(title) }
    var incoming by remember { mutableStateOf<String?>(null) }
    var direction by remember { mutableStateOf(Direction.Next) }
    val progress = remember { Animatable(1f) }

    LaunchedEffect(title) {
        if (title == current && incoming == null) return@LaunchedEffect
        if (change == null || reduced) {
            progress.snapTo(1f)
            current = title
            incoming = null
            return@LaunchedEffect
        }
        // A change during a change starts from the title already on its way in.
        incoming?.let { current = it }
        incoming = title
        direction = change
        progress.snapTo(0f)
        progress.animateTo(1f, tween(DesignTokens.Duration.titleChange.toInt(), easing = LinearEasing))
        current = title
        incoming = null
    }

    val alpha by animateFloatAsState(
        if (dim) DesignTokens.Motion.loadingDim else 1f,
        if (reduced) snap() else tween(DesignTokens.Duration.titleDim.toInt(), easing = CssEase),
        label = "dim",
    )
    val slide = with(density) { DesignTokens.Size.titleSlide.dp.toPx() }
    val exitX = if (direction == Direction.Next) -slide else slide
    val easing = DesignTokens.Motion.emphasizedEasing.easing()

    Box(
        Modifier
            .testTag(UiTags.TITLE)
            .widthIn(min = minWidth)
            .graphicsLayer { this.alpha = alpha }
            .clipToBounds()
            .semantics {
                heading()
                liveRegion = LiveRegionMode.Polite
            },
        contentAlignment = Alignment.Center,
    ) {
        // The web's keyframes: the old title leaves over the first 58%, the new
        // one arrives over the last 66%, each eased on its own stretch.
        BasicText(
            current,
            Modifier.graphicsLayer {
                val out = if (incoming == null) 0f else easing.transform((progress.value / 0.58f).coerceIn(0f, 1f))
                this.alpha = 1f - out
                translationX = exitX * out
            },
            style = style,
        )
        if (incoming != null) {
            BasicText(
                incoming.orEmpty(),
                Modifier
                    .clearAndSetSemantics {}
                    .graphicsLayer {
                        val into = easing.transform(((progress.value - 0.34f) / 0.66f).coerceIn(0f, 1f))
                        this.alpha = into
                        translationX = -exitX * (1f - into)
                    },
                style = style,
            )
        }
    }
}

/**
 * "Still coming": a short dash sweeping a 2 dp bar. Where motion is off, a
 * frozen sweep would read as stalled progress, so the words are shown instead.
 */
@Composable
private fun LoadingIndicator() {
    val palette = LocalPalette.current
    val label = stringResource(R.string.loading)
    val modifier = Modifier
        .testTag(UiTags.LOADING)
        .semantics { liveRegion = LiveRegionMode.Polite }
    if (LocalReducedMotion.current) {
        Box(modifier, contentAlignment = Alignment.Center) {
            BasicText(label, style = DesignTokens.Type.loading.style(palette.textMuted).copy(textAlign = TextAlign.Center))
        }
        return
    }
    // Animated in the draw phase alone: nothing recomposes while it sweeps.
    val sweep by rememberInfiniteTransition(label = "loading").animateFloat(
        initialValue = -DesignTokens.Motion.loadingDash,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(DesignTokens.Duration.loadingSweep.toInt(), easing = LinearEasing), RepeatMode.Restart),
        label = "sweep",
    )
    Box(modifier.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(DesignTokens.Size.loadingBarWidth.dp, DesignTokens.Size.loadingBarHeight.dp)) {
            val radius = CornerRadius(size.height / 2)
            val track = Path().apply { addRoundRect(RoundRect(0f, 0f, size.width, size.height, radius)) }
            drawRoundRect(palette.border, cornerRadius = radius)
            clipPath(track) {
                drawRoundRect(
                    palette.textMuted,
                    topLeft = Offset(size.width * sweep, 0f),
                    size = Size(size.width * DesignTokens.Motion.loadingDash, size.height),
                    cornerRadius = radius,
                )
            }
        }
    }
}

/** Muted, not alarming: it only appears when the listener asked for sound and got silence. */
@Composable
internal fun PlaybackError(trackTitle: String, modifier: Modifier = Modifier) {
    val palette = LocalPalette.current
    val style = DesignTokens.Type.error.style(palette.textMuted)
        .copy(textAlign = TextAlign.Center, lineBreak = LineBreak.Heading)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val maxWidth = remember(style, density) { measurer.chars(style, density, DesignTokens.Size.errorMaxWidthChars) }
    BasicText(
        stringResource(R.string.playback_failed, trackTitle),
        modifier
            .testTag(UiTags.ERROR)
            .widthIn(max = maxWidth)
            .semantics { liveRegion = LiveRegionMode.Polite },
        style = style,
    )
}

/** CSS's `ch`: [count] widths of the font's zero. */
private fun TextMeasurer.chars(style: TextStyle, density: Density, count: Float): Dp =
    with(density) { (measure("0", style).size.width * count).toDp() }
