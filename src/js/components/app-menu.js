/**
 * Top-right "more" menu: houses the theme selector and the version/source
 * link, both secondary controls that don't need permanent header space.
 *
 * Its content (theme-selector, version link) is authored in index.html
 * rather than built here, so component-contract.test.js — which greps the
 * raw markup for the ids script.js looks up — still finds them.
 *
 * @element app-menu
 */
export class AppMenu extends HTMLElement {
    constructor() {
        super();
        this._buttonId = `app-menu-button-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._panelId = `app-menu-panel-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._open = false;
        this._listenersAttached = false;
        this._documentPointerHandler = this.handleDocumentPointerDown.bind(this);
        this._focusoutHandler = this.handleFocusOut.bind(this);
    }

    connectedCallback() {
        const themeSelector = this.querySelector("theme-selector");
        const versionLink = this.querySelector(".app-version");
        this.render();
        if (themeSelector) this.querySelector(".menu-theme-row").append(themeSelector);
        if (versionLink) this.querySelector(".menu-panel").append(versionLink);
        this.addEventListeners();
    }

    disconnectedCallback() {
        this.removeEventListener("focusout", this._focusoutHandler);
        document.removeEventListener("pointerdown", this._documentPointerHandler, true);
        this._listenersAttached = false;
    }

    get open() {
        return this._open;
    }

    set open(value) {
        this._open = Boolean(value);
        this.toggleAttribute("open", this._open);
        const button = this.querySelector("button");
        if (button) {
            button.setAttribute("aria-expanded", String(this._open));
        }
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (app-menu) {
                    :scope {
                        display: block;
                        position: relative;
                        justify-self: end;
                    }

                    /* Overrides style.css's global button reset (border,
                       box-shadow, background-color) — this is a plain
                       transparent circle, not one of the app's bordered icon
                       buttons. */
                    :scope > button {
                        display: grid;
                        place-items: center;
                        width: 40px;
                        height: 40px;
                        margin: 0;
                        padding: 0;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        box-shadow: none;
                        color: var(--color-text-muted);
                        cursor: pointer;
                        position: relative;
                        z-index: 11;
                        -webkit-tap-highlight-color: transparent;
                        tap-highlight-color: transparent;
                        transition: color 0.18s ease, background-color 0.18s ease;
                    }

                    :scope > button:hover {
                        color: var(--color-text);
                        background-color: var(--color-surface-muted);
                    }

                    :scope > button:focus {
                        outline: none;
                    }

                    :scope > button:focus-visible {
                        outline: 2px solid var(--color-focus);
                        outline-offset: 2px;
                        box-shadow: none;
                    }

                    /* Fades to transparent once the panel is showing, so the
                       button sinks into the panel instead of floating as a
                       solid disc on top of it. Its z-index (above
                       .menu-anchor) keeps it the hit target for mouse,
                       keyboard, and touch — only its paint disappears. */
                    :scope[open] > button {
                        color: transparent;
                        background-color: transparent;
                    }

                    @media (hover: hover) and (pointer: fine) {
                        :scope:hover > button,
                        :scope:focus-within > button {
                            color: transparent;
                            background-color: transparent;
                        }
                    }

                    svg {
                        width: 22px;
                        height: 22px;
                        fill: currentColor;
                    }

                    /* The anchor (not the panel) owns position and pointer-
                       events, flush with the button's top so the open panel
                       covers the icon with no gap — which also means hover
                       never crosses a dead zone between button and panel
                       (mirrors volume-control's .popover-anchor). */
                    .menu-anchor {
                        position: absolute;
                        top: 0;
                        right: 0;
                        pointer-events: none;
                        z-index: 10;
                    }

                    :scope[open] .menu-anchor {
                        pointer-events: auto;
                    }

                    /* Hover-to-open on hover-capable devices, matching
                       volume-control; click-to-toggle ([open] above) still
                       covers touch and keyboard. */
                    @media (hover: hover) and (pointer: fine) {
                        :scope:hover .menu-anchor,
                        :scope:focus-within .menu-anchor {
                            pointer-events: auto;
                        }
                    }

                    .menu-panel {
                        display: grid;
                        gap: 14px;
                        width: max-content;
                        padding: 14px;
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 16px;
                        background: var(--color-surface);
                        box-shadow: var(--shadow-elevated);
                        opacity: 0;
                        transform: translateY(-4px) scale(0.98);
                        transform-origin: 100% 0;
                        transition: opacity 0.16s ease, transform 0.16s ease;
                    }

                    :scope[open] .menu-panel {
                        opacity: 1;
                        transform: none;
                    }

                    @media (hover: hover) and (pointer: fine) {
                        :scope:hover .menu-panel,
                        :scope:focus-within .menu-panel {
                            opacity: 1;
                            transform: none;
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

                    @media (prefers-reduced-motion: reduce) {
                        :scope > button,
                        .menu-panel {
                            transition: none;
                        }
                    }
                }
            </style>
            <button
                id="${this._buttonId}"
                type="button"
                aria-label="Menu"
                aria-haspopup="true"
                aria-controls="${this._panelId}"
                aria-expanded="false"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="5" r="2"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                    <circle cx="12" cy="19" r="2"></circle>
                </svg>
            </button>
            <div class="menu-anchor">
                <div id="${this._panelId}" class="menu-panel" role="menu">
                    <span class="menu-label">Theme</span>
                    <div class="menu-theme-row"></div>
                    <div class="menu-divider"></div>
                </div>
            </div>
        `;
    }

    addEventListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        const button = this.querySelector("button");

        button.addEventListener("click", () => {
            this.open = !this.open;
        });

        // Picking a theme with a pointer focuses its radio, and :focus-within
        // then pins the panel open even after the pointer leaves — so a mouse
        // user who opened via hover (this.open still false) sees it "stuck"
        // open until an outside click. Only released for that hover-only
        // case: an explicitly click-opened menu (this.open true) should stay
        // open regardless of focus, closing only via an outside click or the
        // toggle button. :focus-visible tells pointer and keyboard selection
        // apart, so keyboard users keep focus to keep navigating with arrows.
        this.addEventListener("change", (event) => {
            if (this.open) return;
            if (!event.target.matches('input[type="radio"]')) return;
            if (event.target.matches(":focus-visible")) return;

            setTimeout(() => {
                if (document.activeElement === event.target) {
                    event.target.blur();
                }
            }, 0);
        });

        this.addEventListener("focusout", this._focusoutHandler);
        document.addEventListener("pointerdown", this._documentPointerHandler, true);
    }

    handleDocumentPointerDown(event) {
        if (event.composedPath().includes(this)) return;
        this.open = false;
    }

    handleFocusOut() {
        // relatedTarget is unreliable: clicking a theme-selector label blurs
        // this button (relatedTarget null) before the browser forwards the
        // click to the hidden radio on mouseup. A macrotask lets that finish
        // before checking whether focus actually left.
        setTimeout(() => {
            if (this.contains(document.activeElement)) return;
            this.open = false;
        }, 0);
    }
}
