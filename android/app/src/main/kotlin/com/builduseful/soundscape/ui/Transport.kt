package com.builduseful.soundscape.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.contract.DesignTokens

/**
 * The buttons, for a screen reader alone. There are none to see, as on the
 * web's touch screens: the gestures are the way in, and a keyboard has its
 * keys. The drawing is the play button and the skips sit either side of it, in
 * its line, so TalkBack finds each where it would be; a press here is a press
 * on the page.
 */
@Composable
internal fun TransportControls(
    isPlaying: Boolean,
    onPrevious: () -> Unit,
    onPlayPause: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val skip = DesignTokens.Size.skipButton.dp
    Row(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Size.transportGap.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        SpokenButton(stringResource(R.string.previous_track), skip, onPrevious, Modifier.testTag(UiTags.PREVIOUS))
        SpokenButton(
            stringResource(if (isPlaying) R.string.pause else R.string.play),
            DesignTokens.Size.stage.dp,
            onPlayPause,
            Modifier.testTag(UiTags.PLAY_PAUSE),
        )
        SpokenButton(stringResource(R.string.next_track), skip, onNext, Modifier.testTag(UiTags.NEXT))
    }
}

/** A button to TalkBack, and nothing on screen: not a stop for the keyboard, which has its keys. */
@Composable
private fun SpokenButton(label: String, size: Dp, onClick: () -> Unit, modifier: Modifier) {
    Box(
        modifier
            .size(size)
            .semantics {
                role = Role.Button
                contentDescription = label
                onClick { onClick(); true }
            },
    )
}
