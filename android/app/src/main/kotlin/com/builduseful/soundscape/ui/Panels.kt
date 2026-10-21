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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned

/** The two panels that float over the page: the menu and the volume slider. */
internal enum class Panel { Menu, Volume }

/**
 * Which panel is open — at most one, as with the web's `popover="auto"` — and
 * how it closes. A press outside the panel and its button closes it and still
 * reaches whatever it landed on; so does Escape, back, and focus moving away.
 */
@Stable
internal class Panels {
    var open: Panel? by mutableStateOf(null)
        private set

    private val regions = mutableMapOf<Panel, MutableMap<String, Rect>>()

    fun toggle(panel: Panel) {
        open = if (open == panel) null else panel
    }

    fun close() {
        open = null
    }

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
            if (regions[panel].orEmpty().values.none { it.contains(down.position) }) close()
        }
    }
}
