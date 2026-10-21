package com.builduseful.soundscape.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp

/**
 * The web's inline SVG icons, path for path, on its 24-unit grid. Circles and
 * rectangles are written as the paths they draw.
 */
@Immutable
internal class Glyph(val paths: List<String>, val style: GlyphStyle)

internal enum class GlyphStyle {
    /** `fill: currentColor`, with a 1-unit round-joined stroke: the transport icons. */
    Solid,

    /** `fill: none`, a 2-unit round stroke: the menu's, theme and volume icons. */
    Outline,

    /** Fill only: the menu's dots. */
    Filled,
}

internal object Glyphs {
    val previous = Glyph(listOf("M6 6.75h2.5v10.5H6V6.75Zm12.5 0v10.5L9.5 12l9-5.25Z"), GlyphStyle.Solid)
    val play = Glyph(listOf("M6.75 5.5v13l11-6.5-11-6.5Z"), GlyphStyle.Solid)
    val pause = Glyph(
        listOf(
            "M7 5.5h3a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z",
            "M14 5.5h3a.5.5 0 0 1 .5.5v12a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5V6a.5.5 0 0 1 .5-.5Z",
        ),
        GlyphStyle.Solid,
    )
    val next = Glyph(listOf("M5.5 6.75v10.5l9-5.25-9-5.25Zm10 0H18v10.5h-2.5V6.75Z"), GlyphStyle.Solid)

    val menu = Glyph(
        listOf("M10 5a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z", "M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z", "M10 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0Z"),
        GlyphStyle.Filled,
    )

    val themeSystem = Glyph(
        listOf("M6 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M8 20h8", "M12 16v4"),
        GlyphStyle.Outline,
    )
    val themeLight = Glyph(
        listOf(
            "M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0Z",
            "M12 2v2", "M12 20v2", "M4.93 4.93l1.41 1.41", "M17.66 17.66l1.41 1.41",
            "M2 12h2", "M20 12h2", "M6.34 17.66l-1.41 1.41", "M19.07 4.93l-1.41 1.41",
        ),
        GlyphStyle.Outline,
    )
    val themeDark = Glyph(listOf("M20 14.4A7.7 7.7 0 0 1 9.6 4a8 8 0 1 0 10.4 10.4z"), GlyphStyle.Outline)

    // The volume icon's parts, which the mute state fades separately.
    val speaker = Glyph(listOf("M4 9v6h4l5 4V5L8 9H4z"), GlyphStyle.Outline)
    val waves = Glyph(listOf("M16 9.5a4 4 0 0 1 0 5", "M18.5 7a7.5 7.5 0 0 1 0 10"), GlyphStyle.Outline)
    val muteSlash = Glyph(listOf("M6 18L19 6"), GlyphStyle.Outline)
}

/**
 * Draws [glyphs] over each other at [size], each with its own alpha. The paths
 * are scaled to the icon's pixels once, not drawn under a canvas scale, which
 * Android before 9 rasterises at the 24-unit size and stretches, blurred.
 */
@Composable
internal fun GlyphIcon(
    glyphs: List<Pair<Glyph, Float>>,
    size: Dp,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val pixels = with(LocalDensity.current) { size.toPx() }
    val unit = pixels / 24f
    val scaled = remember(glyphs.map { it.first }, unit) {
        val toPixels = Matrix().apply { scale(unit, unit) }
        glyphs.map { (glyph, _) -> glyph.paths.map { PathParser().parsePathString(it).toPath().apply { transform(toPixels) } } }
    }
    Canvas(modifier.size(size)) {
        scaled.forEachIndexed { index, paths ->
            val (glyph, alpha) = glyphs[index]
            if (alpha <= 0f) return@forEachIndexed
            for (path in paths) {
                when (glyph.style) {
                    GlyphStyle.Solid -> {
                        drawPath(path, color, alpha, Fill)
                        drawPath(path, color, alpha, Stroke(width = unit, join = StrokeJoin.Round))
                    }
                    GlyphStyle.Outline ->
                        drawPath(path, color, alpha, Stroke(width = 2 * unit, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    GlyphStyle.Filled -> drawPath(path, color, alpha, Fill)
                }
            }
        }
    }
}

@Composable
internal fun GlyphIcon(glyph: Glyph, size: Dp, color: Color, modifier: Modifier = Modifier) =
    GlyphIcon(listOf(glyph to 1f), size, color, modifier)
