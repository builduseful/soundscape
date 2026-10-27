package com.builduseful.soundscape.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.vector.PathParser
import java.util.Locale
import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.sin

/*
 * The soundscapes, drawn: the web's track-scene.js, element for element and
 * keyframe for keyframe, on its 48-unit square. A scene is data; TrackSceneView
 * draws it.
 */

/** A property's keyframes: values at offsets from 0 to 1, eased between each pair as CSS eases them. */
internal class Keyframes(private val offsets: FloatArray, private val values: FloatArray) {
    fun at(progress: Float, easing: Easing): Float {
        var i = 0
        while (i < offsets.size - 2 && progress > offsets[i + 1]) i++
        val span = offsets[i + 1] - offsets[i]
        val t = if (span <= 0f) 1f else ((progress - offsets[i]) / span).coerceIn(0f, 1f)
        return values[i] + (values[i + 1] - values[i]) * easing.transform(t)
    }
}

private fun frames(vararg pairs: Pair<Number, Number>) =
    Keyframes(FloatArray(pairs.size) { pairs[it].first.toFloat() }, FloatArray(pairs.size) { pairs[it].second.toFloat() })

internal enum class Cycle { Normal, Alternate, AlternateReverse }

/**
 * A CSS animation: [duration] and [delay] in seconds, a delay at or below
 * zero. Transforms are about ([originX], [originY]) in CSS's order: translate,
 * scale, skew. Still, an element holds the pose its motion has reached, as
 * the web's paused animations do; before it first moves, its first frame.
 */
internal class Motion(
    val duration: Float,
    val delay: Float = 0f,
    val easing: Easing = LinearEasing,
    val cycle: Cycle = Cycle.Normal,
    val opacity: Keyframes? = null,
    val fill: Keyframes? = null,
    val x: Keyframes? = null,
    val y: Keyframes? = null,
    val scaleX: Keyframes? = null,
    val scaleY: Keyframes? = null,
    val skewX: Keyframes? = null,
    val originX: Float = 0f,
    val originY: Float = 0f,
) {
    /** How far through its cycle it is at [time] seconds, as CSS counts an infinite animation. */
    fun progress(time: Float): Float {
        val cycles = (time - delay) / duration
        val iteration = floor(cycles)
        val forward = cycles - iteration
        val odd = iteration.toInt() and 1 == 1
        return when (cycle) {
            Cycle.Normal -> forward
            Cycle.Alternate -> if (odd) 1 - forward else forward
            Cycle.AlternateReverse -> if (odd) forward else 1 - forward
        }
    }
}

/** Shown always, only where things move, or only where they cannot (reduced motion). */
internal enum class Shows { Always, Moving, Still }

/**
 * One element: a path on the 48-unit square, stroked [width] wide unless it is
 * [filled] only. [alpha] is its own opacity, which a motion's opacity replaces
 * as CSS's does; [layer] is its group's, which multiplies. [fill] is a fill's
 * opacity under the stroke. [placeX], [placeY] and [placeScale] are a group's
 * `translate(x y) scale(s)` around it.
 */
internal class SceneElement(
    val path: String,
    val width: Float = 1.5f,
    val alpha: Float = 1f,
    val layer: Float = 1f,
    val filled: Boolean = false,
    val fill: Float = 0f,
    val motion: Motion? = null,
    val shows: Shows = Shows.Always,
    val placeX: Float = 0f,
    val placeY: Float = 0f,
    val placeScale: Float = 1f,
)

/** Where a scene fades out at its edges: across the waves, or down the rain. */
internal enum class SceneMask { None, AcrossEdges, DownEdges }

internal class Scene(val elements: List<SceneElement>, val mask: SceneMask = SceneMask.None) {
    /** Each element's path, parsed once. */
    val paths: List<Path> by lazy { elements.map { PathParser().parsePathString(it.path).toPath() } }
}

private fun n(value: Double): String =
    if (value == floor(value) && kotlin.math.abs(value) < 1e9) value.toLong().toString()
    else String.format(Locale.ROOT, "%.4f", value).trimEnd('0').trimEnd('.')

private fun n(value: Float) = n(value.toDouble())

private val easeOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)
private val easeInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

// Three true circles, left, crown and right, joined where they cross and sat
// on one flat base, so every join is smooth.
private const val CLOUD = "M17 26H32.5A5 5 0 0 0 32.35 16 7.5 7.5 0 0 0 17.6 16.05 5 5 0 0 0 17 26Z"
private const val BOLT = "M25.6 27.5 22.4 33h4.2L23.4 39"
private const val FLAME =
    "M24 37c-4.4 0-7-2.9-7-6.5 0-4.2 3.6-6.6 4.5-11.3 2.4 2.2 3.3 4.6 3.3 6.6 1.2-.9 2.1-2.4 2.4-3.9 2.3 2.3 3.8 5.2 3.8 8.6 0 3.6-2.6 6.5-7 6.5Z"
private const val FLAME_INNER = "M24 37c-1.8 0-2.9-1.2-2.9-2.8 0-1.7 1.4-3 2.9-4.9 1.5 1.9 2.9 3.2 2.9 4.9 0 1.6-1.1 2.8-2.9 2.8Z"
private const val LOGS = "M15.5 41.5 32.5 38M15.5 38l17 3.5"

/**
 * Falling streaks. Each travels along its own direction, so a slanted streak
 * falls on its slant, and fades in below where it starts and out before it
 * ends, so none appears or vanishes whole. The cycle is entered partway, so the
 * still drawing catches its streaks falling rather than not yet begun.
 */
private fun streaks(
    list: List<Triple<Number, Number, Number>>,
    length: Float,
    slant: Float = 0f,
    travel: Float,
    duration: Float,
    layer: Float = 1f,
    width: Float = 1.5f,
): List<SceneElement> = list.map { (x, y, delay) ->
    val x1 = x.toFloat()
    val y1 = y.toFloat()
    SceneElement(
        "M${n(x1)} ${n(y1)}L${n(x1 - slant)} ${n(y1 + length)}",
        width = width,
        layer = layer,
        motion = Motion(
            duration, Math.round((delay.toFloat() - 0.45f * duration) * 100) / 100f, CubicBezierEasing(0.4f, 0f, 0.9f, 0.7f),
            opacity = frames(0 to 0, 0.25 to 1, 0.65 to 1, 1 to 0),
            x = frames(0 to 0, 1 to -travel * slant / length),
            y = frames(0 to 0, 1 to travel),
        ),
    )
}

// A wave longer than the box, so drifting it one wavelength loops seamlessly;
// a direction of -1 drifts it the other way.
private fun wave(
    wavelength: Float,
    amplitude: Float,
    y: Float,
    duration: Float,
    direction: Int = 1,
    alpha: Float = 1f,
    width: Float = 1.5f,
): SceneElement {
    val half = wavelength / 2
    val path = StringBuilder("M${n(-wavelength * 2)} ${n(y)}q${n(half / 2)} ${n(-amplitude * 2)} ${n(half)} 0")
    var x = -wavelength * 2 + half
    while (x < 48 + wavelength) {
        path.append("t${n(half)} 0")
        x += half
    }
    return SceneElement(path.toString(), width = width, alpha = alpha, motion = drift(wavelength * direction, duration))
}

private fun drift(by: Float, duration: Float) = Motion(duration, x = frames(0 to 0, 1 to by))

private fun embers(list: List<Triple<Number, Number, Number>>, placeY: Float = 0f) = list.map { (x, y, delay) ->
    SceneElement(
        circle(x.toFloat(), y.toFloat(), 0.8f),
        alpha = 0f,
        filled = true,
        placeY = placeY,
        motion = Motion(
            3.4f, delay.toFloat(), easeOut,
            opacity = frames(0 to 0, 0.2 to 0.9, 1 to 0),
            x = frames(0 to 0, 1 to 1.5),
            y = frames(0 to 0, 1 to -7),
        ),
    )
}

private fun circle(cx: Float, cy: Float, r: Float) = ellipse(cx, cy, r, r)

private fun ellipse(cx: Float, cy: Float, rx: Float, ry: Float) =
    "M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z"

private fun flames(outer: Float, inner: Float, placeX: Float = 0f, placeY: Float = 0f, placeScale: Float = 1f): List<SceneElement> {
    fun flicker(duration: Float, cycle: Cycle) = Motion(
        duration, easing = easeInOut, cycle = cycle,
        scaleX = frames(0 to 1, 0.4 to 0.98, 0.75 to 1.01, 1 to 0.99),
        scaleY = frames(0 to 1, 0.4 to 1.04, 0.75 to 0.97, 1 to 1.02),
        skewX = frames(0 to 0, 0.4 to -1.5, 0.75 to 1, 1 to -0.5),
        originX = 24f,
        originY = 37f,
    )
    return listOf(
        SceneElement(FLAME, motion = flicker(outer, Cycle.Alternate), placeX = placeX, placeY = placeY, placeScale = placeScale),
        SceneElement(FLAME_INNER, motion = flicker(inner, Cycle.AlternateReverse), placeX = placeX, placeY = placeY, placeScale = placeScale),
        SceneElement(LOGS, placeX = placeX, placeY = placeY, placeScale = placeScale),
    )
}

// The web's flash: the cycle starts on the flicker, so the still drawing has its bolt.
private fun bolt(duration: Float) = SceneElement(
    BOLT,
    motion = Motion(duration, opacity = frames(0 to 1, 0.02 to 0.15, 0.04 to 1, 0.11 to 0, 0.99 to 0, 1 to 1)),
)

/** A drop that falls to a surface and the ring it leaves there, kept in step: the ring starts as the drop lands. */
private fun landing(x: Float, from: Float, surface: Float, duration: Float, delay: Float = 0f, rx: Float, ry: Float): List<SceneElement> {
    val land = surface - from - 3
    // As the web rounds it.
    val ringDelay = Math.round((delay - 0.42f * duration) * 100) / 100f
    return listOf(
        SceneElement(
            "M${n(x)} ${n(from)}v3",
            motion = Motion(
                duration, delay, CubicBezierEasing(0.45f, 0f, 0.9f, 0.5f),
                opacity = frames(0 to 0, 0.12 to 1, 0.58 to 1, 0.62 to 0, 1 to 0),
                y = frames(0 to 0, 0.58 to land, 0.62 to land, 1 to land),
            ),
        ),
        SceneElement(
            ellipse(x, surface, rx, ry),
            motion = Motion(
                duration, ringDelay, CubicBezierEasing(0.2f, 0.6f, 0.4f, 1f),
                opacity = frames(0 to 0, 0.12 to 1, 1 to 0),
                scaleX = frames(0 to 0.15, 1 to 1),
                scaleY = frames(0 to 0.15, 1 to 1),
                originX = x,
                originY = surface,
            ),
        ),
    )
}

// A seedling: a stem and a leaf either side of its tip.
private fun sprout(x: Float, height: Float, base: Float = 37f): List<SceneElement> {
    val tip = base - height
    return listOf(
        SceneElement("M${n(x)} ${n(base)}v${n(-height)}"),
        SceneElement("M${n(x)} ${n(tip)}c-1.6-.3-2.7-1.5-2.7-3.2 1.7.2 2.7 1.4 2.7 3.2Z"),
        SceneElement("M${n(x)} ${n(tip + 0.8f)}c1.5-.5 2.5-1.7 2.5-3.4-1.6.3-2.5 1.5-2.5 3.4Z"),
    )
}

// The web's repeatable pseudo-random sequence (mulberry32), so the line is the
// same on every platform.
private fun random(start: Int): () -> Double {
    var seed = start
    return {
        seed += 0x6d2b79f5
        var t = (seed xor (seed ushr 15)) * (1 or seed)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL) / 4294967296.0
    }
}

/**
 * A line of noise made of sine harmonics that repeat every 48 units, so
 * drifting it 48 loops seamlessly. Every harmonic as strong as the next, as in
 * white noise.
 */
private fun noise(y: Float, scale: Float, harmonics: Int, seed: Int, duration: Float): SceneElement {
    val next = random(seed)
    val phases = DoubleArray(harmonics) { next() * PI * 2 }
    val path = StringBuilder()
    var x = -48.0
    while (x <= 96) {
        var value = 0.0
        for (i in 0 until harmonics) value += sin(2 * PI * (i + 1) * x / 48 + phases[i])
        val point = Math.round((y + value / harmonics * scale) * 100) / 100.0
        path.append(if (path.isEmpty()) "M" else "L").append(n(x)).append(' ').append(n(point))
        x += 0.5
    }
    return SceneElement(path.toString(), motion = drift(-48f, duration))
}

// The lane's markings, spread along one cycle; still, they lie where a
// photograph would catch them.
private val dashes = listOf(0f, -0.65f, -1.3f, -1.95f).map { delay ->
    SceneElement(
        "M24 20L24 21.4",
        width = 1.3f,
        shows = Shows.Moving,
        motion = Motion(
            2.6f, delay, CubicBezierEasing(0.55f, 0f, 0.9f, 0.6f),
            opacity = frames(0 to 0, 0.15 to 1, 0.85 to 1, 1 to 0),
            y = frames(0 to 0, 1 to 19),
            scaleX = frames(0 to 0.5, 1 to 1.6),
            scaleY = frames(0 to 0.6, 1 to 3.4),
            originX = 24f,
            originY = 20f,
        ),
    )
}

/** Each soundscape's drawing, by track id. One without a drawing shows nothing. */
internal val scenes: Map<String, Scene> = mapOf(
    // Drops into a puddle, each leaving its ring as it lands.
    "rain" to Scene(
        landing(17f, 12f, 33f, 3f, rx = 6f, ry = 1.6f) +
            landing(30f, 14f, 35f, 3f, delay = -1.1f, rx = 7f, ry = 1.9f) +
            landing(25f, 10f, 29f, 3f, delay = -2.1f, rx = 4.5f, ry = 1.2f),
    ),
    "garden-rain" to Scene(
        listOf(SceneElement("M12 37h24")) + sprout(17f, 4f) + sprout(24f, 7f) + sprout(31f, 3f) +
            streaks(listOf(Triple(14, 8, 0), Triple(20.5, 11, -0.5), Triple(27.5, 7, -1), Triple(34, 12, -0.3)), length = 3f, travel = 7f, duration = 1.5f),
    ),
    // Three depths of rain: the far drops small, faint and slow, the near ones long and quick.
    "heavy-rain" to Scene(
        streaks(
            listOf(Triple(12, 4, 0), Triple(19, 8, -0.6), Triple(26, 3, -1.2), Triple(33, 7, -0.3), Triple(39, 5, -0.9)),
            length = 2.5f, slant = 0.8f, travel = 30f, duration = 2.2f, layer = 0.25f, width = 1.1f,
        ) + streaks(
            listOf(Triple(10, 6, -0.4), Triple(17, 2, -0.1), Triple(24, 7, -0.8), Triple(31, 3, -0.5), Triple(38, 8, -0.2)),
            length = 4f, slant = 1.3f, travel = 30f, duration = 1.4f, layer = 0.45f,
        ) + streaks(
            listOf(Triple(14, 3, -0.3), Triple(28, 5, -0.7), Triple(21, 1, -0.05), Triple(36, 2, -0.5)),
            length = 6f, slant = 2f, travel = 30f, duration = 0.85f,
        ),
        SceneMask.DownEdges,
    ),
    "rain-thunder" to Scene(
        listOf(SceneElement(CLOUD), bolt(6.5f)) +
            streaks(listOf(Triple(18.5, 29, 0), Triple(30.5, 29.5, -0.7)), length = 3f, travel = 6f, duration = 1.5f),
    ),
    // The storm's cloud is heavy: shaded, not only drawn, and lit by the bolt.
    "heavy-thunderstorm" to Scene(
        listOf(
            SceneElement(
                CLOUD,
                fill = 0.14f,
                motion = Motion(4.3f, fill = frames(0 to 0.4, 0.04 to 0.4, 0.11 to 0.14, 0.99 to 0.14, 1 to 0.4)),
            ),
            bolt(4.3f),
        ) + streaks(
            listOf(Triple(16.5, 29, 0), Triple(20, 30.5, -0.4), Triple(29.5, 30.5, -0.2), Triple(33, 29, -0.55)),
            length = 5f, slant = 1.5f, travel = 7f, duration = 0.8f,
        ),
    ),
    "fireplace" to Scene(flames(2.2f, 1.3f, placeY = -3.5f) + embers(listOf(Triple(25.5, 16, 0)), placeY = -3.5f)),
    // The deep one burns in a hearth, slower.
    "deep-fireplace" to Scene(
        listOf(SceneElement("M12 40V24a12 12 0 0 1 24 0v16M9 40h30")) +
            flames(3.1f, 1.9f, placeX = 2.4f, placeY = 0.9f, placeScale = 0.9f) +
            embers(listOf(Triple(22, 19.5, 0), Triple(26, 18.5, -1.4))),
    ),
    // The road runs out between mountains; its edges stop short of them, as the eye loses them there.
    "the-open-road" to Scene(
        listOf(SceneElement("M9 20l6-6 3.5 3.5L25 11l9 9h5"), SceneElement("M13 39 22 21.5M35 39 26 21.5")) + dashes +
            SceneElement("M24 22.5v2M24 27.5v3.5M24 34v5", shows = Shows.Still),
    ),
    // Deep and slow: one bold swell between two fainter ones, the lowest running the other way.
    "brown-noise" to Scene(
        listOf(
            wave(40f, 1.4f, 19f, 14f, alpha = 0.45f),
            wave(34f, 2f, 25f, 11f, width = 2f),
            wave(30f, 1.4f, 31f, 16f, direction = -1, alpha = 0.45f),
        ),
        SceneMask.AcrossEdges,
    ),
    // Each layer half the last, as pink noise's power halves with each octave.
    "pink-noise" to Scene(
        listOf(wave(22f, 3.5f, 23f, 5.5f), wave(13f, 2f, 25f, 3.7f, alpha = 0.45f), wave(8f, 1.1f, 26.5f, 2.3f, alpha = 0.25f)),
        SceneMask.AcrossEdges,
    ),
    "white-noise" to Scene(listOf(noise(24f, 7f, 40, 5, 3f)), SceneMask.AcrossEdges),
)

/** The scene's own arrival on a new track: up 2 units as it fades in. */
internal val sceneInEasing: Easing = easeOut
internal const val SCENE_IN_MILLIS = 500
internal const val SCENE_IN_RISE = 2f
