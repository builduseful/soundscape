package com.builduseful.soundscape.ui

import android.animation.ValueAnimator
import android.os.Build
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.builduseful.soundscape.core.contract.CubicBezier
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.contract.ShadowLayer
import com.builduseful.soundscape.core.contract.ThemedColor
import com.builduseful.soundscape.core.contract.TypeToken

/**
 * The design tokens' colours at a point between the themes: [darkness] 0 is
 * light, 1 dark. A change of theme moves every colour together, mixed in sRGB,
 * which on the page's flat colours is the web's crossfade of the whole surface;
 * and the screen itself stays, with its focus and open panels.
 */
@Immutable
class Palette(val darkness: Float) {
    val dark get() = darkness >= 0.5f

    private fun ThemedColor.get() = mix(Color(light), Color(dark), darkness)

    val page = DesignTokens.Color.page.get()
    val surface = DesignTokens.Color.surface.get()
    val surfaceMuted = DesignTokens.Color.surfaceMuted.get()
    val text = DesignTokens.Color.text.get()
    val textMuted = DesignTokens.Color.textMuted.get()
    val textSoft = DesignTokens.Color.textSoft.get()
    val border = DesignTokens.Color.border.get()
    val borderSubtle = DesignTokens.Color.borderSubtle.get()
    val primary = DesignTokens.Color.primary.get()
    val primaryText = DesignTokens.Color.primaryText.get()
    val secondary = DesignTokens.Color.secondary.get()
    val secondaryText = DesignTokens.Color.secondaryText.get()
    val focus = DesignTokens.Color.focus.get()

    // Chrome's own colours for a range's empty track, which the web inherits rather than sets.
    val sliderTrack = ThemedColor(light = 0xFFEFEFEF, dark = 0xFF3B3B3B).get()
    val sliderTrackEdge = ThemedColor(light = 0xFFB2B2B2, dark = 0xFF858585).get()

    fun shadow(layers: List<ShadowLayer>): List<Pair<ShadowLayer, Color>> = layers.map { it to it.color.get() }
}

internal fun mix(from: Color, to: Color, t: Float): Color = when (t) {
    0f -> from
    1f -> to
    else -> Color(
        red = from.red + (to.red - from.red) * t,
        green = from.green + (to.green - from.green) * t,
        blue = from.blue + (to.blue - from.blue) * t,
        alpha = from.alpha + (to.alpha - from.alpha) * t,
    )
}

/** The colour at [t] of its fade in from nothing, as CSS fades from `transparent`. */
internal fun Color.shownBy(t: Float): Color = copy(alpha = alpha * t)

/**
 * 0 to 1 as [on] changes, over [millis]. A control's colours are mixed from
 * the palette by this, so they follow a theme fade in step with the page.
 */
@Composable
internal fun animateOn(on: Boolean, millis: Long, label: String): Float {
    val progress by animateFloatAsState(if (on) 1f else 0f, motion(LocalReducedMotion.current, millis), label = label)
    return progress
}

internal val LocalPalette = staticCompositionLocalOf { Palette(darkness = 0f) }

/** True when the listener has asked for no motion: animator duration scale 0 ("Remove animations"). */
internal val LocalReducedMotion = staticCompositionLocalOf { false }

/**
 * Whether animations are off, kept current where the platform reports the
 * change (13+); below that it is read when the screen is first composed.
 */
@Composable
internal fun rememberReducedMotion(): Boolean {
    var reduced by remember { mutableStateOf(!ValueAnimator.areAnimatorsEnabled()) }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        DisposableEffect(Unit) {
            val listener = ValueAnimator.DurationScaleChangeListener { scale -> reduced = scale == 0f }
            ValueAnimator.registerDurationScaleChangeListener(listener)
            onDispose { ValueAnimator.unregisterDurationScaleChangeListener(listener) }
        }
    }
    return reduced
}

/** CSS's `ease`, which a web transition uses when it names no timing function. */
internal val CssEase: Easing = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

internal fun CubicBezier.easing(): Easing = CubicBezierEasing(x1, y1, x2, y2)

/** A type token as a style. Text with no line height of its own inherits the body's, as on the web. */
internal fun TypeToken.style(color: Color) = TextStyle(
    color = color,
    fontSize = size.sp,
    fontWeight = FontWeight(weight),
    lineHeight = lineBox,
    // CSS spreads the extra line height evenly above and below the text.
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    letterSpacing = letterSpacing.em,
)

private val TypeToken.lineBox get() = (size * (lineHeight ?: DesignTokens.Type.body.lineHeight!!)).sp

/**
 * One line of text exactly its token's line height, centred, as CSS lays it
 * out. Needed only where that is less than the font's own height, as the app
 * name's is: Android never lays a line out shorter than its font.
 */
internal fun Modifier.lineBox(type: TypeToken): Modifier = layout { measurable, constraints ->
    val text = measurable.measure(constraints)
    val height = type.lineBox.roundToPx()
    layout(text.width, height) { text.place(0, (height - text.height) / 2) }
}

/** A CSS `box-shadow` from the tokens: every layer, in order. */
internal fun Modifier.tokenShadow(layers: List<Pair<ShadowLayer, Color>>, shape: Shape): Modifier =
    layers.fold(this) { modifier, (layer, color) ->
        modifier.dropShadow(shape, Shadow(radius = layer.blur.dp, color = color, offset = DpOffset(0.dp, layer.y.dp)))
    }
