/**
 * Top-right "more" menu: houses the theme selector, the install offer and the
 * version/source link, all secondary controls that don't need permanent header
 * space.
 *
 * The panel is a native `popover`. That hands the browser the part of this no
 * specification used to settle, and every engine answered differently:
 * dismissing it. A press anywhere else closes it, Escape closes it, focus comes
 * back to the button, and it draws in the top layer, so nothing above it in the
 * page can clip it or swallow a click meant for it.
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
 * `aria-expanded` on the button says the true thing instead.
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
        this._listenersAttached = false;
        this._focusoutHandler = this.handleFocusOut.bind(this);
        // A resize is the one thing that moves the button out from under an
        // open panel — see placePanel.
        this._resizeHandler = () => {
            if (this.showing) this.placePanel();
        };
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
        this.addEventListeners();
    }

    disconnectedCallback() {
        this.removeEventListener("focusout", this._focusoutHandler);
        globalThis.removeEventListener("resize", this._resizeHandler);
        this._listenersAttached = false;
    }

    /** @returns {HTMLElement|null} The popover itself. */
    get panel() {
        return this.querySelector(".menu-panel");
    }

    /** @returns {boolean} Whether the panel is on screen, however it got there. */
    get showing() {
        return this.panel?.matches(":popover-open") === true;
    }

    /**
     * Whether the panel is open — the same question as `showing`, under the
     * name the app has always used to ask a menu.
     * @returns {boolean} True while the panel is on screen.
     */
    get open() {
        return this.showing;
    }

    set open(value) {
        const panel = this.panel;
        if (!panel || Boolean(value) === this.showing) return;
        // showPopover throws on an element that is not in the document, which a
        // menu being asked to open is not always going to be.
        if (!panel.isConnected) return;

        if (value) panel.showPopover();
        else panel.hidePopover();
    }

    /**
     * Follow the popover's own state, whichever side moved it.
     *
     * Every open and every close comes through here, ours and the browser's
     * alike: the button's `popovertarget` toggles it without asking us, and so
     * do Escape and a press anywhere outside. Nothing here decides anything —
     * the popover is the state, and this only reflects it into the markup that
     * has to agree with it.
     * @param {ToggleEvent} event - The panel's beforetoggle.
     */
    handleBeforeToggle(event) {
        const showing = event.newState === "open";

        // Before the state flips, so the first frame the panel is painted in is
        // already the right one.
        if (showing) this.placePanel();

        this.toggleAttribute("open", showing);
        this.querySelector("button")?.setAttribute("aria-expanded", String(showing));
    }

    /**
     * Put the panel under the button.
     *
     * The one thing a popover does not bring with it. A box in the top layer
     * does not keep its place in the page: its containing block is the viewport
     * and Chrome lays it out at the origin of that, not at the static position
     * the div would have had in flow. CSS anchor positioning exists for exactly
     * this and would say it in two declarations, but it is Chrome and Safari and
     * not yet Firefox, and this is a public site rather than an extension that
     * can name a minimum browser. So the button is measured, once per open.
     *
     * Page coordinates rather than viewport ones, so a scroll carries the panel
     * along with the header instead of leaving it behind. A resize is then the
     * only thing that can move the button out from under an open panel, and
     * that is listened for while one is open.
     *
     * Flush with the button's bottom, so the panel reads as belonging to the
     * button rather than floating near it.
     */
    placePanel() {
        const button = this.querySelector("button");
        const panel = this.panel;
        if (!button || !panel) return;

        const rect = button.getBoundingClientRect();

        panel.style.top = `${rect.bottom + globalThis.scrollY}px`;
        panel.style.left = `${rect.left + globalThis.scrollX}px`;
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (app-menu) {
                    /* Nothing is positioned against this element any more — the
                       panel is in the top layer — so this is only the button's
                       slot in the header row. */
                    :scope {
                        /* The button's own size, and the distance the panel has
                           to be pulled back by to line their trailing edges up.
                           One number, asked for in two places. */
                        --menu-button-size: 40px;
                        display: block;
                        justify-self: end;
                    }

                    /* Overrides style.css's global button reset (border,
                       box-shadow, background-color) — this is a plain
                       transparent circle, not one of the app's bordered icon
                       buttons. */
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
                        -webkit-tap-highlight-color: transparent;
                        tap-highlight-color: transparent;
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    /* No hover state, deliberately, and it outlived the reason
                       it was first given. A filled circle appearing the instant
                       the pointer touched the button flashed on for whoever was
                       only passing through; that mattered most while hovering
                       also opened the panel, and it still reads as noise on a
                       button that is one of two things in a header. The lit
                       state below means the panel is open and nothing else, so
                       a reader glancing at the header can trust it. */

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
                       :popover-open rather than of an attribute kept beside it,
                       because that is the state itself — the rule this replaced
                       asked whether anything inside had focus, which is a
                       proxy, and it painted a panel the component believed was
                       closed.

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
                       viewport with a border and padding of its own. Where it
                       goes instead is half here and half in placePanel: the
                       leading edge and the top are measured off the button
                       there, and the pull-back below is what lines the two
                       trailing edges up, so the panel opens back across the
                       header rather than off the side of the page. Keeping that
                       half in CSS means nothing has to measure the panel's own
                       width — a percentage in a translate is already the
                       element's own. Both halves are physical, left and
                       translateX, so this places the panel for a left-to-right
                       page and would need mirroring for a right-to-left one;
                       nothing here sets a dir, and the app has never had one. */
                    .menu-panel {
                        /* Reused by .menu-install to bleed back out to the panel edge. */
                        --menu-panel-inset: 14px;
                        /* Everything the panel is wider than the button by,
                           negated: the panel's own width, less the button's. */
                        --menu-panel-pull: calc(var(--menu-button-size) - 100%);
                        position: absolute;
                        inset: auto;
                        /* Same gap for every item, including both dividers, so the
                           vertical rhythm is even. */
                        gap: 10px;
                        width: max-content;
                        margin: 0;
                        padding: var(--menu-panel-inset);
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 16px;
                        overflow: visible;
                        color: inherit;
                        background: var(--color-surface);
                        box-shadow: var(--shadow-elevated);
                        opacity: 0;
                        transform: translateX(var(--menu-panel-pull)) translateY(-4px) scale(0.98);
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
                        transform: translateX(var(--menu-panel-pull));

                        /* Where the open transition starts from. A popover is
                           display:none until it is shown, and a style change in
                           the same frame as that has nothing to animate from
                           unless it is written here. */
                        @starting-style {
                            opacity: 0;
                            transform: translateX(var(--menu-panel-pull)) translateY(-4px) scale(0.98);
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
                        tap-highlight-color: transparent;
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
                        tap-highlight-color: transparent;
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    /* Overrides the generic svg rule above, sized for the toggle glyph. */
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
                aria-expanded="false"
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

        // Wired here rather than beside the rest: toggle events do not bubble,
        // so this one belongs to the panel this render just built.
        this.panel?.addEventListener("beforetoggle", this.handleBeforeToggle.bind(this));
    }

    /**
     * The listeners that belong to the element rather than to a render.
     *
     * There is no click handler among them: `popovertarget` on the button is
     * the whole of opening and closing by click, and it is worth having as
     * markup rather than as code. A press on an invoker is the one press the
     * browser will not dismiss a popover for, so it cannot close the panel on
     * the way down and reopen it on the way up — the double-toggle every
     * hand-rolled version of this has to defend against.
     */
    addEventListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        this.addEventListener("focusout", this._focusoutHandler);
        globalThis.addEventListener("resize", this._resizeHandler);
    }

    /**
     * A caret that has gone somewhere else closes the menu.
     *
     * The only dismissal left to us: a popover holds its ground while focus
     * walks out of it, and a reader who has tabbed past the version link is
     * done with the menu whether or not they ever pressed Escape.
     *
     * `relatedTarget` is the whole test, and the null case is the one that
     * matters: pressing a theme label blurs the button with nowhere to send the
     * caret, and only forwards the click to the hidden radio on the way up.
     * Focus going nowhere is not a reader leaving, so nothing happens here —
     * and a press that really did land outside is the browser's to dismiss.
     * Between the two there is no moment where this has to guess, which is what
     * the deferred `activeElement` check it replaced was doing when it shut the
     * panel mid-click on Chrome and not on Edge.
     * @param {FocusEvent} event - The focusout.
     */
    handleFocusOut(event) {
        // hidePopover throws on a popover that is already hidden, and focus
        // leaves a closed menu every time the button is tabbed away from.
        if (!this.showing) return;
        if (!event.relatedTarget) return;
        if (this.contains(event.relatedTarget)) return;

        this.panel.hidePopover();
    }
}
