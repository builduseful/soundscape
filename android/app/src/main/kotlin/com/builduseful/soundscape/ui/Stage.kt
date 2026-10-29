package com.builduseful.soundscape.ui

import android.graphics.Matrix
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.core.contract.DesignTokens
import kotlin.math.tan
import kotlinx.coroutines.delay

/**
 * The soundscape, drawn, the centre of the screen (the web's `.track-stage`).
 * Paused it holds still, a little faint and breathing; playing it moves at
 * full strength. No play or pause mark: the drawing starting and stopping
 * says it.
 */
@Composable
internal fun Stage(trackId: String, playing: Boolean, resting: Boolean, modifier: Modifier = Modifier) {
    val reduced = LocalReducedMotion.current
    val dim by animateFloatAsState(
        if (playing) 1f else DesignTokens.Motion.pausedScene,
        if (reduced) snap() else tween(DesignTokens.Duration.sceneDim.toInt(), easing = FadeEasing),
        label = "dim",
    )
    // Paused, it breathes (the web's `scene-breath`): out, a little smaller
    // and fainter, and back in, slowly. How deep eases in and out with the
    // dim; the breath itself runs only while paused, so playing costs nothing.
    val depth by animateFloatAsState(
        if (playing || reduced) 0f else 1f,
        if (reduced) snap() else tween(DesignTokens.Duration.sceneDim.toInt(), easing = FadeEasing),
        label = "breath depth",
    )
    // It is slow enough that a step each sceneBreathStep moves it less than a
    // pixel, so it reads as smooth; drawn every frame instead, it would cost a
    // frame at each refresh of the screen. Each step waits for a frame, so an
    // app out of sight takes none.
    val breath = remember { mutableFloatStateOf(0f) }
    LaunchedEffect(playing, reduced) {
        if (playing || reduced) return@LaunchedEffect
        val period = DesignTokens.Duration.sceneBreath * 1_000_000f
        var last = withFrameNanos { it }
        while (true) {
            delay(DesignTokens.Duration.sceneBreathStep)
            withFrameNanos { now ->
                breath.floatValue = (breath.floatValue + (now - last) / period) % 1f
                last = now
            }
        }
    }
    val size = DesignTokens.Size.stage.dp
    TrackSceneView(
        trackId,
        playing,
        resting,
        modifier.size(size).graphicsLayer {
            // Out and back in over each breath, eased each way.
            val way = if (breath.floatValue < 0.5f) breath.floatValue * 2 else (1 - breath.floatValue) * 2
            val out = depth * FadeEasing.transform(way)
            alpha = dim * (1 - out * (1 - DesignTokens.Motion.pausedSceneBreath / DesignTokens.Motion.pausedScene))
            scaleX = 1 - out * (1 - DesignTokens.Motion.pausedSceneBreathScale)
            scaleY = scaleX
            // Drawn once and the picture scaled: redrawn at each size, the thin
            // strokes land on different pixels frame to frame and shimmer.
            if (out > 0f) compositingStrategy = CompositingStrategy.Offscreen
        },
    )
}

/**
 * [trackId]'s drawing, moving while [playing]. Its clock is its own and runs
 * only while it moves, read in the draw phase alone, so a frame redraws a few
 * strokes and recomposes nothing; still, nothing runs at all. [resting], it
 * runs down to a stop over the words' fade, and woken comes back up to speed.
 * It arrives rising a little as it fades in, as each new drawing does on the
 * web.
 */
@Composable
internal fun TrackSceneView(trackId: String, playing: Boolean, resting: Boolean, modifier: Modifier = Modifier) {
    val scene = scenes[trackId]
    val reduced = LocalReducedMotion.current
    val color = LocalPalette.current.textMuted
    val time = remember(trackId) { mutableFloatStateOf(0f) }
    val moving = playing && !reduced
    // Running down at an even rate, it comes to rest eased, as a coasting thing does.
    val speed = animateFloatAsState(
        if (resting) 0f else 1f,
        tween((if (resting) DesignTokens.Duration.restFade else DesignTokens.Duration.wake).toInt(), easing = LinearEasing),
        label = "scene speed",
    )
    LaunchedEffect(trackId, moving, resting) {
        if (!moving) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (!resting || speed.value > 0f) {
            withFrameNanos { now ->
                if (now - last >= SCENE_FRAME_NANOS) {
                    time.floatValue += (now - last) / 1_000_000_000f * speed.value
                    last = now
                }
            }
        }
    }
    val arrival = remember(trackId) { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(trackId) { arrival.animateTo(1f, tween(SCENE_IN_MILLIS, easing = sceneInEasing)) }

    if (scene == null) {
        Box(modifier)
        return
    }
    val drawer = remember(scene) { SceneDrawer(scene) }
    Canvas(
        modifier.graphicsLayer {
            alpha = arrival.value
            translationY = (1 - arrival.value) * SCENE_IN_RISE * size.minDimension / 48f
            // The mask works on what is drawn beneath it, so the scene is drawn apart first.
            if (scene.mask != SceneMask.None) compositingStrategy = CompositingStrategy.Offscreen
        },
    ) {
        with(drawer) { draw(time.floatValue, reduced, color) }
    }
}

// The motions are slow, so a step at sceneFrameRate reads as smooth, and a
// screen's own rate, 120 a second on many phones, would cost twice the frames
// for nothing seen. A step once three-quarters of one has passed keeps them
// even on any screen: every other frame at 120 Hz, every frame at 60.
private val SCENE_FRAME_NANOS = (750_000_000 / DesignTokens.Motion.sceneFrameRate).toLong()

/**
 * Draws a scene at one moment. Each element's path is moved into place by one
 * matrix, scale and all, so it is drawn as a path at its size: see GlyphIcon
 * for why not under a canvas scale. Nothing is allocated per frame.
 */
private class SceneDrawer(private val scene: Scene) {
    private val bases = scene.paths.map { it.asAndroidPath() }
    private val matrix = Matrix()
    private val moved = android.graphics.Path()
    private val drawn = moved.asComposePath()
    private var unit = 0f
    private var strokes: List<Stroke> = emptyList()
    private var mask: Brush? = null

    fun DrawScope.draw(time: Float, reduced: Boolean, color: Color) {
        val u = size.minDimension / 48f
        if (u != unit) {
            unit = u
            strokes = scene.elements.map { Stroke(it.width * it.placeScale * u, cap = StrokeCap.Round, join = StrokeJoin.Round) }
            mask = maskBrush(scene.mask, u)
        }
        scene.elements.forEachIndexed { index, element ->
            when (element.shows) {
                Shows.Moving -> if (reduced) return@forEachIndexed
                Shows.Still -> if (!reduced) return@forEachIndexed
                Shows.Always -> Unit
            }
            val motion = element.motion?.takeIf { !reduced }
            val progress = motion?.progress(time) ?: 0f
            val easing = motion?.easing
            val alpha = element.layer * (motion?.opacity?.at(progress, easing!!) ?: element.alpha)
            val fill = motion?.fill?.at(progress, easing!!) ?: element.fill
            if (alpha <= 0f) return@forEachIndexed

            matrix.reset()
            if (motion != null) {
                matrix.postTranslate(-motion.originX, -motion.originY)
                motion.skewX?.let { matrix.postSkew(tan(Math.toRadians(it.at(progress, easing!!).toDouble())).toFloat(), 0f) }
                matrix.postScale(motion.scaleX?.at(progress, easing!!) ?: 1f, motion.scaleY?.at(progress, easing!!) ?: 1f)
                matrix.postTranslate(
                    (motion.x?.at(progress, easing!!) ?: 0f) + motion.originX,
                    (motion.y?.at(progress, easing!!) ?: 0f) + motion.originY,
                )
            }
            matrix.postScale(element.placeScale, element.placeScale)
            matrix.postTranslate(element.placeX, element.placeY)
            matrix.postScale(u, u)
            bases[index].transform(matrix, moved)

            if (fill > 0f) drawPath(drawn, color, alpha * fill)
            if (element.filled) drawPath(drawn, color, alpha) else drawPath(drawn, color, alpha, strokes[index])
        }
        mask?.let { drawRect(it, blendMode = BlendMode.DstIn) }
    }
}

// The web's fade masks: a wave fades out at both ends rather than being cut
// off, and rain fades in at the top and out at the bottom.
private fun maskBrush(mask: SceneMask, unit: Float): Brush? = when (mask) {
    SceneMask.None -> null
    SceneMask.AcrossEdges -> Brush.horizontalGradient(
        0f to Color.Transparent, 0.22f to Color.Black, 0.78f to Color.Black, 1f to Color.Transparent,
        startX = 7 * unit, endX = 41 * unit,
    )
    SceneMask.DownEdges -> Brush.verticalGradient(
        0f to Color.Transparent, 0.25f to Color.Black, 0.75f to Color.Black, 1f to Color.Transparent,
        startY = 9 * unit, endY = 40 * unit,
    )
}
