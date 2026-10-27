package com.builduseful.soundscape.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.gestures.Gesture
import com.builduseful.soundscape.core.gestures.GestureGuide
import kotlinx.coroutines.delay

/**
 * The first-run guide's state for the screen: [GestureGuide]'s steps, made
 * observable, and the card's showing, which outlasts the steps by its fade.
 */
@Stable
internal class GuideState(private val guide: GestureGuide?) {
    var step: Int? by mutableStateOf(null)
        private set

    /** Whether the card is showing; the screen does not rest while it is. */
    var open by mutableStateOf(false)
        private set

    val isOffered get() = guide?.isOffered == true

    fun start() {
        val guide = guide ?: return
        guide.start()
        step = guide.step
        open = true
    }

    fun completed(gesture: Gesture) {
        val guide = guide ?: return
        if (guide.completed(gesture)) step = guide.step
    }

    /** Finished or skipped: either way it is not offered again. */
    fun finish() {
        guide?.finish()
        open = false
    }
}

/**
 * A first-run guide to the gestures, learnt by doing (the web's
 * `gesture-tutorial.js`): each step names one gesture and moves on when the
 * listener makes it, and the gesture does its real work as it goes. The card
 * takes no press of its own but Skip's, so the gestures work through it.
 */
@Composable
internal fun GuideCard(guide: GuideState, modifier: Modifier = Modifier) {
    val reduced = LocalReducedMotion.current
    val shown = remember { Animatable(0f) }
    var step by remember { mutableStateOf(guide.step) }
    val visible = guide.open
    LaunchedEffect(visible) {
        val spec = if (reduced) snap() else tween<Float>(DesignTokens.Duration.tutorialFade.toInt(), easing = LinearEasing)
        shown.animateTo(if (visible) 1f else 0f, spec)
    }
    // The step shown holds through the fade out, rather than going blank.
    if (guide.step != null) step = guide.step
    val done = step == Gesture.entries.size
    LaunchedEffect(done) {
        if (!done) return@LaunchedEffect
        delay(DesignTokens.Duration.tutorialDoneHold)
        guide.finish()
    }
    if (!visible && shown.value == 0f) return

    val palette = LocalPalette.current
    val current = step ?: return
    val text = stringResource(
        when (Gesture.entries.getOrNull(current)) {
            Gesture.Tap -> R.string.gesture_tap
            Gesture.Swipe -> R.string.gesture_swipe
            Gesture.Volume -> R.string.gesture_volume
            null -> R.string.gesture_done
        },
    )
    val card = RoundedCornerShape(DesignTokens.Size.tutorialRadius.dp)
    Column(
        modifier
            .testTag(UiTags.GUIDE)
            .graphicsLayer {
                // Opacity on CSS's ease; the rise on the emphasized curve.
                alpha = CssEase.transform(shown.value)
                translationY = (1 - Emphasized.transform(shown.value)) * RISE.dp.toPx()
            }
            .tokenShadow(palette.shadow(DesignTokens.Shadow.elevated), card)
            .clip(card)
            .background(palette.surface)
            .border(1.dp, palette.borderSubtle, card)
            .padding(start = 14.dp, top = 16.dp, end = 18.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Hint(Gesture.entries.getOrNull(current))
            Spacer(Modifier.width(12.dp))
            BasicText(
                text,
                Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                style = TextStyle(color = palette.text, fontSize = 15.2.sp, fontWeight = FontWeight(600), lineHeight = 1.3.em),
            )
        }
        Row(Modifier.fillMaxWidth().heightIn(min = 32.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.padding(start = 4.dp).weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                repeat(Gesture.entries.size) { index ->
                    Box(Modifier.size(6.dp).clip(CircleShape).background(if (index <= current) palette.textMuted else palette.border))
                }
            }
            if (!done) SkipButton(guide::finish)
        }
    }
}

@Composable
private fun SkipButton(onClick: () -> Unit) {
    val palette = LocalPalette.current
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val focused by interaction.collectIsFocusedAsState()
    val lit = pressed || focused
    BasicText(
        stringResource(R.string.skip),
        Modifier
            .testTag(UiTags.GUIDE_SKIP)
            .clip(RoundedCornerShape(percent = 50))
            .background(if (lit) palette.surfaceMuted else palette.surface.copy(alpha = 0f))
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        style = TextStyle(color = if (lit) palette.textMuted else palette.textSoft, fontSize = 13.6.sp, fontWeight = FontWeight(600)),
    )
}

/**
 * A fingertip showing the gesture: a press, a sweep across, a stroke up and
 * down; and at the end, a tick. Drawn on the web's 56 × 44 box, its motion
 * read in the draw phase alone.
 */
@Composable
private fun Hint(gesture: Gesture?) {
    val color = LocalPalette.current.textMuted
    val reduced = LocalReducedMotion.current
    val millis = when (gesture) {
        Gesture.Tap -> 1400
        Gesture.Swipe -> 1600
        Gesture.Volume -> 1800
        null -> 0
    }
    // Still, under reduced motion and once it is a tick, nothing runs.
    val cycle = if (millis > 0 && !reduced) {
        rememberInfiniteTransition(label = "hint").animateFloat(
            0f, 1f, infiniteRepeatable(tween(millis, easing = LinearEasing), RepeatMode.Restart), label = "cycle",
        )
    } else {
        null
    }
    Canvas(Modifier.size(56.dp, 44.dp)) {
        val unit = 1.dp.toPx()
        val centre = Offset(28 * unit, 22 * unit)
        if (gesture == null) {
            // The web's tick: the right and bottom borders of an 8 × 16 box, turned 45°.
            val tick = Path().apply {
                moveTo(centre.x - 4 * unit, centre.y + 8 * unit)
                lineTo(centre.x + 4 * unit, centre.y + 8 * unit)
                lineTo(centre.x + 4 * unit, centre.y - 8 * unit)
            }
            rotate(45f, centre) { drawPath(tick, color, style = Stroke(2.5f * unit, cap = StrokeCap.Butt, join = StrokeJoin.Miter)) }
            return@Canvas
        }
        var x = 0f
        var y = 0f
        var scale = 1f
        var alpha = 0.8f
        cycle?.value?.let { p ->
            when (gesture) {
                Gesture.Tap -> {
                    scale = TapScale.at(p, InOut)
                    alpha = TapAlpha.at(p, InOut)
                }
                Gesture.Swipe -> {
                    x = SwipeX.at(p, Sweep)
                    alpha = SwipeAlpha.at(p, Sweep)
                }
                Gesture.Volume -> y = VolumeY.at(p, Sweep)
            }
        }
        drawCircle(color, radius = 8 * unit * scale, center = centre + Offset(x * unit, y * unit), alpha = alpha)
    }
}

private val Emphasized = DesignTokens.Motion.emphasizedEasing.easing()
private val InOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)
private val Sweep = CubicBezierEasing(0.45f, 0f, 0.55f, 1f)

// The web's tutorial-tap, tutorial-swipe and tutorial-volume keyframes.
private val TapScale = Keyframes(floatArrayOf(0f, 0.45f, 0.6f, 1f), floatArrayOf(1f, 0.7f, 1.25f, 1f))
private val TapAlpha = Keyframes(floatArrayOf(0f, 0.45f, 0.6f, 1f), floatArrayOf(0.8f, 1f, 0.35f, 0.8f))
private val SwipeX = Keyframes(floatArrayOf(0f, 0.7f, 0.85f, 1f), floatArrayOf(14f, -14f, -14f, 14f))
private val SwipeAlpha = Keyframes(floatArrayOf(0f, 0.15f, 0.7f, 0.85f, 1f), floatArrayOf(0f, 0.8f, 0.8f, 0f, 0f))
private val VolumeY = Keyframes(floatArrayOf(0f, 0.5f, 1f), floatArrayOf(12f, -12f, 12f))

// The card rises this far as it fades in.
private const val RISE = 8
