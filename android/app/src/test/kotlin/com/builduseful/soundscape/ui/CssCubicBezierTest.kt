package com.builduseful.soundscape.ui

import androidx.compose.animation.core.CubicBezierEasing
import com.builduseful.soundscape.core.contract.DesignTokens
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class CssCubicBezierTest {
    // The open road's approach, at the frame that crashed the app: Compose's
    // easing finds no root there and throws from inside a draw.
    @Test
    fun theCurveComposeCannotSolveIsSolved() {
        assertThrows(IllegalArgumentException::class.java) { CubicBezierEasing(0.55f, 0f, 0.9f, 0.6f).transform(0.9999999f) }
        assertEquals(1f, CssCubicBezier(0.55f, 0f, 0.9f, 0.6f).transform(0.9999999f), 1e-4f)
    }

    // Where Compose's does answer, the two agree: the curves are CSS's, not new ones.
    @Test
    fun itAgreesWithComposeWhereComposeAnswers() {
        for ((x1, y1, x2, y2) in CURVES) {
            val ours = CssCubicBezier(x1, y1, x2, y2)
            val compose = CubicBezierEasing(x1, y1, x2, y2)
            for (i in 0..1000) {
                val x = i / 1000f
                val expected = runCatching { compose.transform(x) }.getOrNull() ?: continue
                assertEquals("cubic-bezier($x1, $y1, $x2, $y2) at $x", expected, ours.transform(x), 1e-4f)
            }
        }
    }

    // Every float a frame could ask for near the ends, on the drawing's curves and the tokens'.
    @Test
    fun noCurveThrowsNearItsEnds() {
        for ((x1, y1, x2, y2) in CURVES) {
            val easing = CssCubicBezier(x1, y1, x2, y2)
            var x = 0.999f
            while (x < 1f) { easing.transform(x); x = Math.nextUp(x) }
            x = 0.001f
            while (x > 0f) { easing.transform(x); x = Math.nextDown(x) }
        }
    }

    private companion object {
        val CURVES = listOf(
            floatArrayOf(0.25f, 0.1f, 0.25f, 1f),
            floatArrayOf(0f, 0f, 0.58f, 1f),
            floatArrayOf(0.42f, 0f, 0.58f, 1f),
            floatArrayOf(0.45f, 0f, 0.55f, 1f),
            floatArrayOf(0.4f, 0f, 0.9f, 0.7f),
            floatArrayOf(0.45f, 0f, 0.9f, 0.5f),
            floatArrayOf(0.2f, 0.6f, 0.4f, 1f),
            floatArrayOf(0.55f, 0f, 0.9f, 0.6f),
        ) + with(DesignTokens.Motion) {
            listOf(emphasizedEasing, wipeEasing, swipeEasing, fadeEasing, pressEasing).map { floatArrayOf(it.x1, it.y1, it.x2, it.y2) }
        }
    }
}
