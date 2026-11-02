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
    /** `fill: none`, a 2-unit round stroke: the theme icons. */
    Outline,

    /** Fill only: the menu's dots. */
    Filled,
}

internal object Glyphs {
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
