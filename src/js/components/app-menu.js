/**
 * Top-right "more" menu: houses the theme selector, the install offer and the
 * version/source link, all secondary controls that don't need permanent header
 * space.
 *
 * The panel is a native `popover`. That hands the browser the part of this no
 * specification used to settle, and every engine answered differently:
 * dismissing it. A press anywhere else closes it, Escape closes it, focus comes
 * back to the button, and it draws in the top layer, so nothing above it in the
 * page can clip it or swallow a click meant for it. CSS anchor positioning hangs
 * it off the button, so nothing here measures anything either.
 *
 * A click is the only way it opens. It was hover-to-open as well for a while,
 * on the theory that a menu you can graze is quicker than one you have to hit,
 * and that cost far more than it bought: a pointer crossing the corner dragged
 * it open over what the reader was aiming at, a wait long enough to stop that
 * made it feel reluctant, and a repaint anywhere under the pointer — a theme
 * change is one — reads to the browser as the pointer leaving, which shut the
 * panel under the reader mid-use. All of it was machinery answering a question
 * the platform does not ask. Opening is the invoker's, closing is the
 * browser's, and this file holds no pointer state at all.
 *
 * A disclosure rather than a `role="menu"`: what is inside is a radio group, a
 * button and a link, none of which is a menu item, and a screen reader told
 * "menu" would promise arrow-key navigation between them that they do not have.
 * The browser already reports the button as expanded or collapsed from
 * `popovertarget` alone, so the button carries no `aria-expanded` — a static one
 * would override the live state.
 *
 * Its content (theme-selector, install button, version link) is authored in
 * index.html rather than built here, so component-contract.test.js — which
 * greps the raw markup for the ids script.js looks up — still finds them.
 *
 * @element app-menu
 */
export class AppMenu extends HTMLElement {
    constructor() {
        super();
        const unique = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

        this._buttonId = `app-menu-button-${unique()}`;
        this._panelId = `app-menu-panel-${unique()}`;
        // On the element itself rather than on a rendered node, so it outlives
        // the render a reconnection redoes and never needs attaching twice.
        this.addEventListener("focusout", this.handleFocusOut.bind(this));
    }

    connectedCallback() {
        const themeSelector = this.querySelector("theme-selector");
        const installButton = this.querySelector(".menu-install");
        const versionLink = this.querySelector(".app-version");
        this.render();
        const panel = this.panel;
        if (themeSelector) this.querySelector(".menu-theme-row").append(themeSelector);
        if (installButton) {
            // Visibility follows the button via .menu-install[hidden] + .menu-divider below.
            const installDivider = document.createElement("div");

            installDivider.className = "menu-divider";
            panel.append(installButton, installDivider);
        }
        if (versionLink) panel.append(versionLink);
    }

    /** @returns {HTMLElement|null} The popover itself. */
    get panel() {
        return this.querySelector(".menu-panel");
    }

    /** @returns {boolean} Whether the panel is open, however it got there. */
    get open() {
        return this.panel?.matches(":popover-open") === true;
    }

    set open(value) {
        const panel = this.panel;
        if (!panel || Boolean(value) === this.open) return;
        // showPopover throws on an element that is not in the document, which a
        // menu being asked to open is not always going to be.
        if (!panel.isConnected) return;

        if (value) panel.showPopover();
        else panel.hidePopover();
    }

    /**
     * Close the menu when focus has gone somewhere else.
     *
     * A popover stays open while focus leaves it, so a reader who tabs past the
     * version link would otherwise leave the menu hanging open behind them.
     *
     * Only a real destination counts. Pressing a theme label blurs with no
     * `relatedTarget` before the click reaches its radio, and closing then would
     * shut the menu mid-click; a press that truly landed outside is the
     * browser's to dismiss.
     * @param {FocusEvent} event - The focusout.
     */
    handleFocusOut(event) {
        // hidePopover throws on a closed popover. Focus leaves a closed menu
        // whenever its button is tabbed away from, and a press on another
        // popover's button can reach here after the browser has closed this one.
        if (!this.open) return;
        if (!event.relatedTarget || this.contains(event.relatedTarget)) return;

        this.panel.hidePopover();
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (app-menu) {
                    /* Nothing is positioned against this element — the panel is
                       in the top layer, anchored to the button — so this is only
                       the button's slot in the header row. */
                    :scope {
                        --menu-button-size: 40px;
                        display: block;
                        justify-self: end;
                    }

                    /* Overrides style.css's global button reset (border,
                       box-shadow, background-color) — this is a plain
                       transparent circle, not one of the app's bordered icon
                       buttons. It is also what the panel is anchored to; one
                       menu per page, so one anchor name is enough. */
                    :scope > button {
                        display: grid;
                        place-items: center;
                        width: var(--menu-button-size);
                        height: var(--menu-button-size);
                        margin: 0;
                        padding: 0;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        box-shadow: none;
                        color: var(--color-text-muted);
                        cursor: pointer;
                        anchor-name: --app-menu-button;
                        -webkit-tap-highlight-color: transparent;
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    /* No hover state, deliberately: the lit state below means
                       the panel is open and nothing else, so a reader glancing
                       at the header can trust it. */

                    :scope > button:focus {
                        outline: none;
                    }

                    :scope > button:focus-visible {
                        outline: 2px solid var(--color-focus);
                        outline-offset: 2px;
                        box-shadow: none;
                    }

                    /* Held down for as long as the panel is: the button is what
                       the panel belongs to, and a reader glancing back at the
                       header should see where it came from. Asked of
                       :popover-open rather than of focus or an attribute kept
                       beside it, because that is the state itself.

                       The panel drops flush *beneath* a button that stays
                       visible. Covering the button meant painting it
                       transparent underneath, and that is where both of this
                       file's pointer bugs came from. */
                    :scope:has(.menu-panel:popover-open) > button {
                        color: var(--color-text);
                        background-color: var(--color-surface-muted);
                    }

                    :scope > button svg {
                        width: 22px;
                        height: 22px;
                        fill: currentColor;
                    }

                    /* Undoing the UA's popover box, which arrives centred in the
                       viewport with a border and padding of its own, and hanging
                       it off the button instead: flush below it, spanning back
                       leftward so the two trailing edges line up and the panel
                       opens across the header rather than off the side of the
                       page. bottom and span-left are physical, so a right-to-left
                       page would need them mirrored; the app has never set a
                       dir. */
                    .menu-panel {
                        /* Reused by .menu-install to bleed back out to the panel edge. */
                        --menu-panel-inset: 14px;
                        position-anchor: --app-menu-button;
                        position-area: bottom span-left;
                        inset: auto;
                        /* Same gap for every item, including both dividers, so the
                           vertical rhythm is even. */
                        gap: 10px;
                        width: max-content;
                        /* Stated outright rather than left to the UA popover
                           rule. An older iPad Safari drew this panel from under
                           the button to the bottom of the screen — its height
                           grown to fill its insets instead of fitting its
                           content — and the fallback below sets every inset to
                           zero on purpose. A declared height cannot be stretched,
                           whichever insets apply. */
                        height: max-content;
                        margin: 0;
                        padding: var(--menu-panel-inset);
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 16px;
                        overflow: visible;
                        color: inherit;
                        background: var(--color-surface);
                        box-shadow: var(--shadow-elevated);
                        opacity: 0;
                        transform: translateY(-4px) scale(0.98);
                        transform-origin: 100% 0;
                        /* display and overlay are discrete, so without these the
                           panel leaves the top layer on the first frame of the
                           close and the fade plays to an empty box. */
                        transition:
                            opacity 0.16s ease,
                            transform 0.16s ease,
                            display 0.16s allow-discrete,
                            overlay 0.16s allow-discrete;
                    }

                    /* The display belongs to this rule and nowhere else. A
                       closed popover is display:none by the UA stylesheet, and
                       any author declaration at all outranks that whatever its
                       specificity — so a display:grid sitting in the rule above
                       would leave the panel laid out and its controls tabbable
                       while it was nominally shut, invisible at opacity 0 over
                       the header. Declared only here, the UA's rule stands
                       whenever the panel is closed. */
                    .menu-panel:popover-open {
                        display: grid;
                        opacity: 1;
                        transform: none;

                        /* Where the open transition starts from. A popover is
                           display:none until it is shown, and a style change in
                           the same frame as that has nothing to animate from
                           unless it is written here. */
                        @starting-style {
                            opacity: 0;
                            transform: translateY(-4px) scale(0.98);
                        }
                    }

                    /* A browser without anchor positioning (Safari before 26)
                       keeps the UA's own placement: centred in the viewport, a
                       whole and usable panel, just not hung off the button. */
                    @supports not (anchor-name: --app-menu-button) {
                        .menu-panel {
                            inset: 0;
                            margin: auto;
                        }
                    }

                    .menu-label {
                        color: var(--color-text-soft);
                        font-size: 0.7rem;
                        font-weight: 600;
                        letter-spacing: 0.04em;
                        text-transform: uppercase;
                    }

                    .menu-theme-row {
                        display: flex;
                        justify-content: center;
                    }

                    .menu-divider {
                        height: 1px;
                        background: var(--color-border-subtle);
                    }

                    .app-version {
                        color: var(--color-text-soft);
                        font-size: 0.75rem;
                        font-weight: 500;
                        letter-spacing: 0.02em;
                        text-align: center;
                        text-decoration: none;
                        -webkit-tap-highlight-color: transparent;
                    }

                    .app-version:hover,
                    .app-version:focus-visible {
                        color: var(--color-text-muted);
                    }

                    /* Same button-reset override as the toggle button above. Hidden
                       until pwa.js's registerInstallPrompt reveals it. border-radius
                       and hover background are set explicitly — the global button
                       reset is circular, which on a full-width row becomes a bulging
                       pill. margin and padding both reference --menu-item-inset so
                       they cancel out and the icon stays aligned with the theme row
                       and version link. */
                    .menu-install {
                        --menu-item-inset: 4px;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        width: calc(100% + var(--menu-item-inset) * 2);
                        margin: 0 calc(var(--menu-item-inset) * -1);
                        padding: var(--menu-item-inset);
                        border: 0;
                        border-radius: 6px;
                        background: transparent;
                        box-shadow: none;
                        color: var(--color-text-soft);
                        font: inherit;
                        font-size: 0.75rem;
                        font-weight: 500;
                        letter-spacing: 0.02em;
                        text-align: left;
                        cursor: pointer;
                        -webkit-tap-highlight-color: transparent;
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    .menu-install svg {
                        width: 16px;
                        height: 16px;
                        fill: none;
                        stroke: currentColor;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 2;
                        flex-shrink: 0;
                    }

                    /* The author display above beats the UA's [hidden] rule; see volume-control. */
                    .menu-install[hidden] {
                        display: none;
                    }

                    /* Keeps the divider hidden along with the button — see connectedCallback. */
                    .menu-install[hidden] + .menu-divider {
                        display: none;
                    }

                    .menu-install:active {
                        transform: none;
                    }

                    @media (hover: hover) and (pointer: fine) {
                        .menu-install:hover {
                            color: var(--color-text-muted);
                            background-color: var(--color-surface-muted);
                        }
                    }

                    .menu-install:focus-visible {
                        outline: 2px solid var(--color-focus);
                        outline-offset: 2px;
                        box-shadow: none;
                    }

                    /* The panel's own choreography, and all of it: nothing in
                       here eases a colour. A theme change is animated once, for
                       the whole surface, by the cross-fade in style.css. */
                    @media (prefers-reduced-motion: reduce) {
                        .menu-panel {
                            transition: none;
                        }
                    }
                }
            </style>
            <button
                id="${this._buttonId}"
                type="button"
                popovertarget="${this._panelId}"
                aria-label="Menu"
                aria-controls="${this._panelId}"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="5" r="2"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                    <circle cx="12" cy="19" r="2"></circle>
                </svg>
            </button>
            <div id="${this._panelId}" class="menu-panel" popover role="group" aria-label="Menu">
                <span class="menu-label">Theme</span>
                <div class="menu-theme-row"></div>
                <div class="menu-divider"></div>
            </div>
        `;
    }
}
