package com.builduseful.soundscape.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens

@Composable
internal fun TransportControls(
    isPlaying: Boolean,
    narrow: Boolean,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalPalette.current
    val skip = DesignTokens.Size.skipButton.dp
    val skipIcon = DesignTokens.Size.skipIcon.dp
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Size.transportGap.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CircleButton(
            label = stringResource(R.string.previous_track),
            size = skip,
            background = palette.secondary,
            border = palette.borderSubtle,
            onClick = onPrevious,
            modifier = Modifier.testTag(UiTags.PREVIOUS),
        ) { GlyphIcon(Glyphs.previous, skipIcon, palette.secondaryText) }
        CircleButton(
            label = stringResource(if (isPlaying) R.string.pause else R.string.play),
            size = (if (narrow) DesignTokens.Size.playButtonNarrow else DesignTokens.Size.playButton).dp,
            background = palette.primary,
            border = palette.primary,
            onClick = onPlayPause,
            modifier = Modifier.testTag(UiTags.PLAY_PAUSE),
        ) {
            GlyphIcon(
                if (isPlaying) Glyphs.pause else Glyphs.play,
                (if (narrow) DesignTokens.Size.playIconNarrow else DesignTokens.Size.playIcon).dp,
                palette.primaryText,
            )
        }
        CircleButton(
            label = stringResource(R.string.next_track),
            size = skip,
            background = palette.secondary,
            border = palette.borderSubtle,
            onClick = onNext,
            modifier = Modifier.testTag(UiTags.NEXT),
        ) { GlyphIcon(Glyphs.next, skipIcon, palette.secondaryText) }
    }
}

/**
 * The web's round button: a 1-unit border, the surface shadow, a press-in to
 * 0.95 that drops the shadow, and a focus ring for the keyboard only. No ripple
 * and no hover colour, as on the web.
 */
@Composable
private fun CircleButton(
    label: String,
    size: Dp,
    background: Color,
    border: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val palette = LocalPalette.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val focused by interaction.collectIsFocusedAsState()
    val scale by animateFloatAsState(
        if (pressed) DesignTokens.Motion.pressScale else 1f,
        if (LocalReducedMotion.current) snap() else tween(DesignTokens.Duration.press.toInt(), easing = CssEase),
        label = "press",
    )
    Box(
        modifier
            .size(size)
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .then(if (pressed) Modifier else Modifier.tokenShadow(palette.shadow(DesignTokens.Shadow.surface), CircleShape))
            .then(if (focused) Modifier.focusRing(palette.focus.copy(alpha = 0.6f)) else Modifier)
            .clip(CircleShape)
            .background(background)
            .border(1.dp, border, CircleShape)
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .pointerHoverIcon(PointerIcon.Hand)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { content() }
}

