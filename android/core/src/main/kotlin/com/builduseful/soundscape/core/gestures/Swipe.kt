package com.builduseful.soundscape.core.gestures

import com.builduseful.soundscape.core.contract.DesignTokens
import kotlin.math.abs

/**
 * How long a swipe let go [remaining] dp short of its neighbour takes to carry
 * on there, given the finger's [velocity] in dp/ms toward it. The swipe's
 * easing is an ease-out cubic, which starts at three times its average speed,
 * so this is the time that leaves at the finger's own speed; held between
 * bounds, so a flick is not instant and a still finger not slow.
 */
fun swipeDurationMillis(remaining: Float, velocity: Float): Long {
    val speed = maxOf(velocity, DesignTokens.Gesture.swipeMinSpeed)
    return (3 * abs(remaining) / speed).toLong()
        .coerceIn(DesignTokens.Duration.swipeMin, DesignTokens.Duration.swipeMax)
}
