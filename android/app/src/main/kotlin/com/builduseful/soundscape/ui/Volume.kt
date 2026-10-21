package com.builduseful.soundscape.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterExitState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens
import kotlin.math.roundToInt
import kotlin.math.sign

/**
 * The volume button and the slider that opens above it. [onVolume]'s second
 * argument says whether to save: false while a drag is still moving.
 */
@Composable
internal fun VolumeControl(
    panels: Panels,
    volume: Float,
    onVolume: (Float, Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    val open = panels.open == Panel.Volume
    val reduced = LocalReducedMotion.current
    val slider = remember { FocusRequester() }
    val buttonInteraction = remember { MutableInteractionSource() }
    val buttonFocused by buttonInteraction.collectIsFocusedAsState()

    // Opened from the keyboard (the button only takes focus from one), the
    // slider takes focus; a pointer that opened it is already where it wants to be.
    LaunchedEffect(open) {
        if (open && buttonFocused) slider.requestFocus()
    }

    Layout(
        content = {
            with(panels) {
                VolumeButton(
                    open,
                    muted = volume <= DesignTokens.Volume.mutedAtOrBelow,
                    interaction = buttonInteraction,
                    onClick = { panels.toggle(Panel.Volume) },
                    modifier = Modifier.partOf(Panel.Volume, "button"),
                )
            }
            AnimatedVisibility(
                visible = open,
                enter = fadeIn(motion(reduced, DesignTokens.Duration.popoverFade)),
                exit = fadeOut(motion(reduced, DesignTokens.Duration.popoverFade)),
            ) {
                // Revealed from the bottom edge up, so it grows out of its button.
                val reveal by transition.animateFloat(
                    transitionSpec = {
                        if (reduced) snap() else tween(DesignTokens.Duration.volumeWipe.toInt(), easing = DesignTokens.Motion.wipeEasing.easing())
                    },
                    label = "wipe",
                ) { if (it == EnterExitState.Visible) 1f else 0f }
                with(panels) {
                    VolumePanel(volume, onVolume, { reveal }, slider, Modifier.partOf(Panel.Volume, "panel"))
                }
            }
        },
        modifier = with(panels) { modifier.closesWhenFocusLeaves(Panel.Volume) },
    ) { measurables, constraints ->
        val button = measurables[0].measure(constraints)
        val panel = measurables.getOrNull(1)?.measure(Constraints())
        val gap = DesignTokens.Size.volumePanelGap.dp.roundToPx()
        layout(button.width, button.height) {
            button.place(0, 0)
            panel?.place(0, -gap - panel.height)
        }
    }
}

@Composable
private fun VolumeButton(open: Boolean, muted: Boolean, interaction: MutableInteractionSource, onClick: () -> Unit, modifier: Modifier) {
    val palette = LocalPalette.current
    val reduced = LocalReducedMotion.current
    val focused by interaction.collectIsFocusedAsState()
    val lit = open || focused
    val color = mix(palette.textMuted, palette.text, animateOn(lit, DesignTokens.Duration.colorChange, "volume"))
    val ground = palette.surfaceMuted.shownBy(animateOn(open, DesignTokens.Duration.colorChange, "volume-ground"))
    val slash by animateFloatAsState(if (muted) 1f else 0f, motion(reduced, DesignTokens.Duration.popoverFade), label = "slash")
    val label = stringResource(R.string.volume)
    Box(
        modifier
            .testTag(UiTags.VOLUME_BUTTON)
            .size(DesignTokens.Size.volumeButton.dp)
            .clip(CircleShape)
            .background(ground)
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .pointerHoverIcon(PointerIcon.Hand)
            .semantics {
                contentDescription = label
                if (open) collapse { onClick(); true } else expand { onClick(); true }
            },
        contentAlignment = Alignment.Center,
    ) {
        GlyphIcon(
            listOf(Glyphs.speaker to 1f, Glyphs.waves to if (muted) DesignTokens.Volume.mutedWaveOpacity else 1f, Glyphs.muteSlash to slash),
            DesignTokens.Size.volumeIcon.dp,
            color,
        )
    }
}

@Composable
private fun VolumePanel(
    volume: Float,
    onVolume: (Float, Boolean) -> Unit,
    reveal: () -> Float,
    focus: FocusRequester,
    modifier: Modifier,
) {
    val palette = LocalPalette.current
    val pill = RoundedCornerShape(percent = 50)
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val current by rememberUpdatedState(volume)
    val label = stringResource(R.string.volume)

    fun step(by: Float) {
        // In the slider's own hundredths, so a level is always one of its values.
        val next = ((current + by) * 100).roundToInt().coerceIn(0, 100) / 100f
        if (next != current) onVolume(next, true)
    }

    Box(
        modifier
            .testTag(UiTags.VOLUME_PANEL)
            .width(DesignTokens.Size.volumeButton.dp)
            .tokenShadow(palette.shadow(DesignTokens.Shadow.elevated), pill)
            .then(if (focused) Modifier.focusRingAround(palette.focus.copy(alpha = 0.6f)) else Modifier)
            // A scroll over the open panel moves the level; only its direction counts.
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        if (event.type != PointerEventType.Scroll) continue
                        val direction = event.changes.sumOf { it.scrollDelta.y.toDouble() }.sign.toFloat()
                        if (direction != 0f) step(-direction * DesignTokens.Volume.wheelStep)
                        event.changes.forEach { it.consume() }
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .drawWithContent {
                    val top = size.height * (1f - reveal())
                    val radius = CornerRadius(size.width / 2)
                    clipPath(Path().apply { addRoundRect(RoundRect(0f, top, size.width, size.height, radius)) }) {
                        this@drawWithContent.drawContent()
                    }
                }
                .clip(pill)
                .background(palette.surface)
                .border(1.dp, palette.borderSubtle, pill)
                .padding(vertical = (DesignTokens.Size.volumePanelPadding + 1).dp)
                .width(DesignTokens.Size.volumeButton.dp),
            contentAlignment = Alignment.Center,
        ) {
            Slider(
                volume,
                onVolume,
                step = ::step,
                interaction = interaction,
                modifier = Modifier
                    .focusRequester(focus)
                    .semantics {
                        contentDescription = label
                        progressBarRangeInfo = ProgressBarRangeInfo(volume, 0f..1f, steps = 99)
                        setProgress { onVolume(it.coerceIn(0f, 1f), true); true }
                    },
            )
        }
    }
}

/**
 * A vertical range, drawn as Chrome draws the web's: an 8 dp track, filled
 * from the bottom in the primary colour, and a 16 dp thumb.
 */
@Composable
private fun Slider(
    volume: Float,
    onVolume: (Float, Boolean) -> Unit,
    step: (Float) -> Unit,
    interaction: MutableInteractionSource,
    modifier: Modifier,
) {
    val palette = LocalPalette.current
    val latest by rememberUpdatedState(onVolume)
    val length = DesignTokens.Size.volumeSliderLength.dp
    val thumb = THUMB.dp

    Canvas(
        modifier
            .testTag(UiTags.VOLUME_SLIDER)
            .size(thumb, length)
            .focusable(interactionSource = interaction)
            .onKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                when (event.key) {
                    Key.DirectionUp, Key.DirectionRight -> step(0.01f)
                    Key.DirectionDown, Key.DirectionLeft -> step(-0.01f)
                    Key.PageUp -> step(0.1f)
                    Key.PageDown -> step(-0.1f)
                    Key.MoveHome -> step(-1f)
                    Key.MoveEnd -> step(1f)
                    else -> return@onKeyEvent false
                }
                true
            }
            .pointerInput(Unit) {
                val travel = size.height - thumb.toPx()
                fun level(y: Float) = (1f - (y - thumb.toPx() / 2) / travel).coerceIn(0f, 1f)
                detectTapGestures { latest(level(it.y), true) }
            }
            .pointerInput(Unit) {
                val travel = size.height - thumb.toPx()
                fun level(y: Float) = (1f - (y - thumb.toPx() / 2) / travel).coerceIn(0f, 1f)
                var last = 0f
                detectVerticalDragGestures(
                    onDragStart = { last = level(it.y); latest(last, false) },
                    onDragEnd = { latest(last, true) },
                    onDragCancel = { latest(last, true) },
                ) { change, _ ->
                    change.consume()
                    last = level(change.position.y)
                    latest(last, false)
                }
            }
            .pointerHoverIcon(PointerIcon.Hand),
    ) {
        val width = TRACK.dp.toPx()
        val radius = CornerRadius(width / 2)
        val left = (size.width - width) / 2
        val half = size.width / 2
        val y = half + (size.height - size.width) * (1f - volume)
        drawRoundRect(palette.sliderTrack, Offset(left, 0f), Size(width, size.height), radius)
        drawRoundRect(palette.sliderTrackEdge, Offset(left + 0.5f, 0.5f), Size(width - 1f, size.height - 1f), radius, style = Stroke(1.dp.toPx()))
        drawRoundRect(palette.primary, Offset(left, y), Size(width, size.height - y), radius)
        drawCircle(palette.primary, radius = half, center = Offset(half, y))
    }
}

private const val TRACK = 8f
private const val THUMB = 16f
