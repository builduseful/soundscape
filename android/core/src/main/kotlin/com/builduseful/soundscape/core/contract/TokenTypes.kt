package com.builduseful.soundscape.core.contract

/** The types DesignTokens is written in. Colours are ARGB. */
data class ThemedColor(val light: Long, val dark: Long) {
    fun resolve(dark: Boolean): Long = if (dark) this.dark else light
}

data class ShadowLayer(val y: Float, val blur: Float, val color: ThemedColor)

/** [lineHeight] is a multiple of [size], null to inherit the body's; [letterSpacing] is in em. */
data class TypeToken(val size: Float, val weight: Int, val lineHeight: Float?, val letterSpacing: Float, val uppercase: Boolean)

data class CubicBezier(val x1: Float, val y1: Float, val x2: Float, val y2: Float)
