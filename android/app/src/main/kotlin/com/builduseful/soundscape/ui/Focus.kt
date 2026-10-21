package com.builduseful.soundscape.ui

import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.core.contract.DesignTokens

// The web's two focus indicators, both drawn only while focus came from the
// keyboard: Compose does not focus a control that is tapped.

/** CSS's `0 0 0 2px` ring round a filled circle: drawn behind, so the circle covers all but the ring. */
internal fun Modifier.focusRing(color: Color) = drawBehind {
    drawCircle(color, radius = size.minDimension / 2 + DesignTokens.Size.focusRing.dp.toPx())
}

/** CSS's `outline: 2px` with `outline-offset: 2px` round a circle. */
internal fun Modifier.focusOutline(color: Color) = drawWithContent {
    drawContent()
    val width = DesignTokens.Size.focusRing.dp.toPx()
    drawCircle(color, radius = size.minDimension / 2 + width * 1.5f, style = Stroke(width))
}

/** The `0 0 0 2px` ring round a pill: the volume panel's, while its slider has focus. */
internal fun Modifier.focusRingAround(color: Color) = drawBehind {
    val ring = DesignTokens.Size.focusRing.dp.toPx()
    drawRoundRect(
        color,
        topLeft = Offset(-ring, -ring),
        size = Size(size.width + 2 * ring, size.height + 2 * ring),
        cornerRadius = CornerRadius(size.width / 2 + ring),
    )
}
