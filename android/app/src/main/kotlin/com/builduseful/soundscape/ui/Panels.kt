package com.builduseful.soundscape.ui

import androidx.compose.foundation.focusGroup
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned

/** The panel that floats over the page: the menu. */
internal enum class Panel { Menu }

/**
 * Which panel is open — at most one, as with the web's `popover="auto"` — and
 * how it closes. A press outside the panel and its button closes it, and the
 * page beneath takes nothing from that press; it still reaches a control it
 * landed on. So does Escape, back, and focus moving away.
 */
@Stable
internal class Panels {
    var open: Panel? by mutableStateOf(null)
        private set

    private val regions = mutableMapOf<Panel, MutableMap<String, Rect>>()
    private var closingPress = Long.MIN_VALUE

    fun toggle(panel: Panel) {
        open = if (open == panel) null else panel
    }

    fun close() {
        open = null
    }

    /** Whether [down] is the press that closed a panel, and so is not the page's to act on. */
    fun closedBy(down: PointerInputChange): Boolean = down.uptimeMillis == closingPress

    /** Marks this node as part of [panel] (its button or its panel), so a press on it is not "outside". */
    fun Modifier.partOf(panel: Panel, part: String): Modifier = onGloballyPositioned {
        regions.getOrPut(panel) { mutableMapOf() }[part] = it.boundsInRoot()
    }

    /**
     * Closes [panel] when focus leaves the node this wraps, which holds both its
     * button and the panel. One group, so a move between its children is not
     * seen as leaving.
     */
    fun Modifier.closesWhenFocusLeaves(panel: Panel): Modifier =
        onFocusChanged { if (!it.hasFocus && open == panel) close() }.focusGroup()

    /** On the root: watches every press, before anything handles it, and never consumes it. */
    fun Modifier.dismissOnPressOutside(): Modifier = pointerInput(this@Panels) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val panel = open ?: return@awaitEachGesture
            if (regions[panel].orEmpty().values.none { it.contains(down.position) }) {
                closingPress = down.uptimeMillis
                close()
            }
        }
    }
}
