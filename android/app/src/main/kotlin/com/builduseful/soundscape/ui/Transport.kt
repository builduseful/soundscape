package com.builduseful.soundscape.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens

/**
 * The buttons, for whoever reaches for them with a keyboard or a screen
 * reader. The drawing is the play button and the skips are two marks either
 * side of it, in its line. Unseen until one has the keyboard's focus, and no
 * target for a finger, which has the gestures: a press here is a press on the
 * page.
 */
@Composable
internal fun TransportControls(
    isPlaying: Boolean,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalPalette.current
    val skip = DesignTokens.Size.skipButton.dp
    val skipIcon = DesignTokens.Size.skipIcon.dp
    val interactions = remember { List(3) { MutableInteractionSource() } }
    val focused = interactions.map { it.collectIsFocusedAsState().value }.any { it }
    val shown by animateFloatAsState(
        if (focused) 1f else 0f,
        if (LocalReducedMotion.current) snap() else tween(SHOW_MILLIS, easing = CssEase),
        label = "controls",
    )
    // The fade is on what each button draws, not on the buttons: a node
    // drawn at nothing is left out for TalkBack too.
    val alpha = { shown }
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Size.transportGap.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MarkButton(stringResource(R.string.previous_track), skip, round = true, interactions[0], alpha, onPrevious, Modifier.testTag(UiTags.PREVIOUS)) {
            GlyphIcon(Glyphs.previous, skipIcon, palette.textSoft)
        }
        // Over the drawing, which answers for it with its own marks.
        MarkButton(
            stringResource(if (isPlaying) R.string.pause else R.string.play),
            DesignTokens.Size.stage.dp,
            round = false,
            interactions[1],
            alpha,
            onPlayPause,
            Modifier.testTag(UiTags.PLAY_PAUSE),
        ) {}
        MarkButton(stringResource(R.string.next_track), skip, round = true, interactions[2], alpha, onNext, Modifier.testTag(UiTags.NEXT)) {
            GlyphIcon(Glyphs.next, skipIcon, palette.textSoft)
        }
    }
}

/**
 * A button by keyboard and screen reader only: focusable, pressed by Enter,
 * and a button to TalkBack, with the web's `0 0 0 2px` focus ring.
 */
@Composable
private fun MarkButton(
    label: String,
    size: Dp,
    round: Boolean,
    interaction: MutableInteractionSource,
    alpha: () -> Float,
    onClick: () -> Unit,
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    val focused by interaction.collectIsFocusedAsState()
    Box(
        modifier
            .size(size)
            .onKeyEvent {
                val press = it.key == Key.Enter || it.key == Key.NumPadEnter || it.key == Key.DirectionCenter
                if (press && it.type == KeyEventType.KeyUp) onClick()
                press
            }
            .focusable(interactionSource = interaction)
            .semantics {
                role = Role.Button
                contentDescription = label
                onClick { onClick(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer { this.alpha = alpha() }
                .then(if (focused) Modifier.ringOutside(palette.focus.copy(alpha = 0.6f), round) else Modifier),
            contentAlignment = Alignment.Center,
        ) { content() }
    }
}

/** CSS's `0 0 0 2px` box-shadow round a transparent button: a ring just outside it, not a disc behind it. */
private fun Modifier.ringOutside(color: androidx.compose.ui.graphics.Color, round: Boolean) = drawBehind {
    val ring = DesignTokens.Size.focusRing.dp.toPx()
    val radius = if (round) size.minDimension / 2 else PLAY_RADIUS.dp.toPx()
    drawRoundRect(
        color,
        topLeft = Offset(-ring / 2, -ring / 2),
        size = Size(size.width + ring, size.height + ring),
        cornerRadius = CornerRadius(radius + ring / 2),
        style = Stroke(ring),
    )
}

// As the web's: the controls' fade, and the play button's corners.
private const val SHOW_MILLIS = 400
private const val PLAY_RADIUS = 22
