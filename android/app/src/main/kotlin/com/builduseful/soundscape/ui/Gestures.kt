package com.builduseful.soundscape.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import com.builduseful.soundscape.core.gestures.GestureTracker

/**
 * The page is the control: one finger's tap, swipe across and drag up or
 * down, read by [tracker] in dp and milliseconds. A press that lands on
 * something with a press of its own (the menu, a link, an open panel) is
 * that thing's: anything that handles a press takes it before this sees it.
 * The movement is taken, so nothing beneath also scrolls.
 */
internal fun Modifier.playerGestures(tracker: GestureTracker): Modifier = pointerInput(tracker) {
    awaitEachGesture {
        val down = awaitFirstDown()
        val id = down.id
        tracker.down(down.position.x.toDp().value, down.position.y.toDp().value, down.uptimeMillis)
        try {
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Main)
                val change = event.changes.firstOrNull { it.id == id } ?: break
                val x = change.position.x.toDp().value
                val y = change.position.y.toDp().value
                if (!change.pressed) {
                    tracker.up(x, y, change.uptimeMillis)
                    change.consume()
                    break
                }
                if (change.positionChanged()) {
                    tracker.move(x, y, change.uptimeMillis)
                    change.consume()
                }
            }
        } finally {
            // Taken away before it ended: by the system, or by the page going.
            tracker.cancel()
        }
    }
}
