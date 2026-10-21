package com.builduseful.soundscape.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.input.pointer.PointerIcon
import androidx.compose.ui.input.pointer.pointerHoverIcon
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.collapse
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.expand
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.builduseful.soundscape.R
import com.builduseful.soundscape.core.appearance.ThemePreference
import com.builduseful.soundscape.core.contract.DesignTokens
import com.builduseful.soundscape.core.contract.TypeToken

/**
 * The header's menu: the theme, and the version linking to the source. A
 * disclosure, as on the web, not a menu of items.
 */
@Composable
internal fun AppMenu(
    panels: Panels,
    theme: ThemePreference,
    onTheme: (ThemePreference) -> Unit,
    versionName: String,
    modifier: Modifier = Modifier,
) {
    val open = panels.open == Panel.Menu
    val reduced = LocalReducedMotion.current
    val offset = with(LocalDensity.current) { DesignTokens.Size.popoverOffset.dp.roundToPx() }
    val origin = TransformOrigin(1f, 0f)
    val fade: FiniteAnimationSpec<Float> = motion(reduced, DesignTokens.Duration.popoverFade)
    val move: FiniteAnimationSpec<IntOffset> = motion(reduced, DesignTokens.Duration.popoverFade)

    // The panel hangs below the button, their trailing edges in line, and
    // takes no room in the header.
    Layout(
        content = {
            with(panels) {
                MenuButton(open, onClick = { panels.toggle(Panel.Menu) }, Modifier.partOf(Panel.Menu, "button"))
            }
            AnimatedVisibility(
                visible = open,
                enter = fadeIn(fade) + scaleIn(fade, DesignTokens.Motion.popoverScale, origin) + slideInVertically(move) { -offset },
                exit = fadeOut(fade) + scaleOut(fade, DesignTokens.Motion.popoverScale, origin) + slideOutVertically(move) { -offset },
            ) {
                with(panels) {
                    MenuPanel(theme, onTheme, versionName, Modifier.partOf(Panel.Menu, "panel"))
                }
            }
        },
        modifier = with(panels) { modifier.closesWhenFocusLeaves(Panel.Menu) },
    ) { measurables, constraints ->
        val button = measurables[0].measure(constraints)
        val panel = measurables.getOrNull(1)?.measure(Constraints())
        layout(button.width, button.height) {
            button.place(0, 0)
            panel?.place(button.width - panel.width, button.height)
        }
    }
}

@Composable
private fun MenuButton(open: Boolean, onClick: () -> Unit, modifier: Modifier) {
    val palette = LocalPalette.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    // Lit while the panel is open, and only then: no hover state, as on the web.
    val lit = animateOn(open, DesignTokens.Duration.colorChange, "menu")
    val color = mix(palette.textMuted, palette.text, lit)
    val ground = palette.surfaceMuted.shownBy(lit)
    val label = stringResource(R.string.menu)
    Box(
        modifier
            .testTag(UiTags.MENU_BUTTON)
            .size(DesignTokens.Size.menuButton.dp)
            .then(if (focused) Modifier.focusOutline(palette.focus) else Modifier)
            .clip(CircleShape)
            .background(ground)
            .clickable(interaction, indication = null, role = Role.Button, onClick = onClick)
            .pointerHoverIcon(PointerIcon.Hand)
            .semantics {
                contentDescription = label
                if (open) collapse { onClick(); true } else expand { onClick(); true }
            },
        contentAlignment = Alignment.Center,
    ) { GlyphIcon(Glyphs.menu, DesignTokens.Size.menuIcon.dp, color) }
}

@Composable
private fun MenuPanel(theme: ThemePreference, onTheme: (ThemePreference) -> Unit, versionName: String, modifier: Modifier) {
    val palette = LocalPalette.current
    val shape = RoundedCornerShape(DesignTokens.Size.menuPanelRadius.dp)
    val title = stringResource(R.string.menu)
    Column(
        modifier
            .testTag(UiTags.MENU_PANEL)
            .width(IntrinsicSize.Max)
            .tokenShadow(palette.shadow(DesignTokens.Shadow.elevated), shape)
            .clip(shape)
            .background(palette.surface)
            .border(1.dp, palette.borderSubtle, shape)
            // The border takes room on the web (border-box); in Compose it is drawn over the padding.
            .padding((DesignTokens.Size.menuPanelPadding + 1).dp)
            .semantics { paneTitle = title },
        verticalArrangement = Arrangement.spacedBy(DesignTokens.Size.menuPanelGap.dp),
    ) {
        BasicText(
            stringResource(R.string.theme).let { if (DesignTokens.Type.menuLabel.uppercase) it.uppercase() else it },
            style = DesignTokens.Type.menuLabel.style(palette.textSoft),
        )
        ThemeSelector(theme, onTheme, Modifier.align(Alignment.CenterHorizontally))
        Box(Modifier.fillMaxWidth().height(1.dp).background(palette.borderSubtle))
        Link(
            text = versionName,
            url = stringResource(R.string.source_url),
            type = DesignTokens.Type.version,
            modifier = Modifier.fillMaxWidth().testTag(UiTags.VERSION),
        )
    }
}

private val themeOptions = listOf(
    Triple(ThemePreference.System, R.string.theme_system, Glyphs.themeSystem),
    Triple(ThemePreference.Light, R.string.theme_light, Glyphs.themeLight),
    Triple(ThemePreference.Dark, R.string.theme_dark, Glyphs.themeDark),
)

/** Three options in a pill, with a thumb that slides to the one chosen. */
@Composable
private fun ThemeSelector(theme: ThemePreference, onTheme: (ThemePreference) -> Unit, modifier: Modifier) {
    val palette = LocalPalette.current
    val reduced = LocalReducedMotion.current
    val option = DesignTokens.Size.themeOption.dp
    val gap = DesignTokens.Size.themeSelectorPadding.dp
    val index = themeOptions.indexOfFirst { it.first == theme }
    val thumb by animateDpAsState(
        (option + gap) * index,
        if (reduced) snap() else tween(DesignTokens.Duration.themeThumb.toInt(), easing = DesignTokens.Motion.emphasizedEasing.easing()),
        label = "thumb",
    )
    val groupLabel = stringResource(R.string.theme)
    Box(
        modifier
            .testTag(UiTags.THEME_SELECTOR)
            .clip(CircleShape)
            .background(palette.surfaceMuted)
            .border(1.dp, palette.borderSubtle, CircleShape)
            .padding(gap + 1.dp)
            .selectableGroup()
            .semantics { contentDescription = groupLabel },
    ) {
        Box(
            Modifier
                .offset { IntOffset(thumb.roundToPx(), 0) }
                .size(option)
                .tokenShadow(palette.shadow(DesignTokens.Shadow.surface), CircleShape)
                .clip(CircleShape)
                .background(palette.surface),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
            for ((preference, label, glyph) in themeOptions) {
                ThemeOption(stringResource(label), glyph, selected = preference == theme, onClick = { onTheme(preference) })
            }
        }
    }
}

@Composable
private fun ThemeOption(label: String, glyph: Glyph, selected: Boolean, onClick: () -> Unit) {
    val palette = LocalPalette.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    val color = mix(palette.textMuted, palette.text, animateOn(selected, DesignTokens.Duration.colorChange, "option"))
    Box(
        Modifier
            .testTag(UiTags.themeOption(label))
            .size(DesignTokens.Size.themeOption.dp)
            .then(if (focused) Modifier.focusOutline(palette.focus) else Modifier)
            .selectable(selected, interaction, indication = null, role = Role.RadioButton, onClick = onClick)
            .pointerHoverIcon(PointerIcon.Hand)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { GlyphIcon(glyph, DesignTokens.Size.themeIcon.dp, color) }
}

/** A text link: soft, and muted while hovered or focused, as the web's byline and version are. */
@Composable
internal fun Link(text: String, url: String, type: TypeToken, modifier: Modifier = Modifier, textAlign: TextAlign = TextAlign.Center) {
    val palette = LocalPalette.current
    val emphasis = SpanStyle(color = palette.textMuted)
    BasicText(
        buildAnnotatedString {
            withLink(LinkAnnotation.Url(url, TextLinkStyles(hoveredStyle = emphasis, focusedStyle = emphasis))) { append(text) }
        },
        modifier.pointerHoverIcon(PointerIcon.Hand),
        style = type.style(palette.textSoft).copy(textAlign = textAlign),
    )
}

/** A timing from the tokens, or none at all where motion is off. */
internal fun <T> motion(reduced: Boolean, millis: Long): FiniteAnimationSpec<T> =
    if (reduced) snap() else tween(millis.toInt(), easing = CssEase)
