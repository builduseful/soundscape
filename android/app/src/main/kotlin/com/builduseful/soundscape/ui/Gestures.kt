package com.builduseful.soundscape.ui

import android.os.Build
import android.view.View
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEvent
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.SuspendingPointerInputModifierNode
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.node.CompositionLocalConsumerModifierNode
import androidx.compose.ui.node.DelegatingNode
import androidx.compose.ui.node.ModifierNodeElement
import androidx.compose.ui.node.PointerInputModifierNode
import androidx.compose.ui.node.currentValueOf
import androidx.compose.ui.node.requireLayoutCoordinates
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntSize
import com.builduseful.soundscape.core.gestures.GestureTracker
import com.builduseful.soundscape.core.gestures.SystemReach

/**
 * The page is the control: one finger's tap, swipe across and drag up or
 * down, read by [tracker] in dp and milliseconds. A press that lands on
 * something with a press of its own (the menu, a link, an open panel) is
 * that thing's: anything that handles a press takes it before this sees it.
 * The movement is taken, so nothing beneath also scrolls.
 */
internal fun Modifier.playerGestures(tracker: GestureTracker): Modifier = this then PlayerGesturesElement(tracker)

private data class PlayerGesturesElement(val tracker: GestureTracker) : ModifierNodeElement<PlayerGesturesNode>() {
    override fun create() = PlayerGesturesNode(tracker)

    override fun update(node: PlayerGesturesNode) = node.update(tracker)
}

private class PlayerGesturesNode(private var tracker: GestureTracker) :
    DelegatingNode(), PointerInputModifierNode, CompositionLocalConsumerModifierNode {
    private val input = delegate(SuspendingPointerInputModifierNode { gestures() })

    fun update(tracker: GestureTracker) {
        if (tracker === this.tracker) return
        this.tracker = tracker
        input.resetPointerInputHandler()
    }

    override fun onPointerEvent(pointerEvent: PointerEvent, pass: PointerEventPass, bounds: IntSize) =
        input.onPointerEvent(pointerEvent, pass, bounds)

    override fun onCancelPointerInput() = input.onCancelPointerInput()

    private suspend fun PointerInputScope.gestures() = awaitEachGesture {
        val down = awaitFirstDown()
        val id = down.id
        val reach = systemReach(requireLayoutCoordinates().localToWindow(down.position))
        tracker.down(down.position.x.toDp().value, down.position.y.toDp().value, down.uptimeMillis, reach)
        try {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Main)
                val change = event.changes.firstOrNull { it.id == id } ?: break
                if (!change.pressed) {
                    // Taken by the system for its own gesture, Compose reports
                    // the finger lifted with the lift already consumed: a
                    // cancel, not a release, so a back swipe is not a swipe.
                    if (change.isConsumed) break
                    tracker.up(change.position.x.toDp().value, change.position.y.toDp().value, change.uptimeMillis)
                    change.consume()
                    break
                }
                if (change.positionChanged()) {
                    tracker.move(change.position.x.toDp().value, change.position.y.toDp().value, change.uptimeMillis)
                    change.consume()
                }
            }
        } finally {
            // Ended any other way than lifted: by the system, or by the page going.
            tracker.cancel()
        }
    }

    // The window's edges where the system's own gestures begin, as it reports
    // them, so they match the navigation mode and the phone's own settings.
    // Asked at each touch rather than kept: they change with the mode.
    private fun systemReach(at: Offset): SystemReach {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return SystemReach.None
        val view = currentValueOf(LocalView)
        val insets = view.rootWindowInsets ?: return SystemReach.None
        val edges = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            insets.getInsets(android.view.WindowInsets.Type.systemGestures()).let { Edges(it.left, it.top, it.right, it.bottom) }
        } else {
            @Suppress("DEPRECATION")
            insets.systemGestureInsets.let { Edges(it.left, it.top, it.right, it.bottom) }
        }
        return edges.of(at, view.rootView)
    }

    private class Edges(val left: Int, val top: Int, val right: Int, val bottom: Int) {
        fun of(at: Offset, window: View) = SystemReach(
            across = at.x < left || at.x > window.width - right,
            upDown = at.y < top || at.y > window.height - bottom,
        )
    }
}
