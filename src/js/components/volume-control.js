/**
 * Volume trigger plus hover/focus popover.
 *
 * @element volume-control
 * @attr {string} value - Slider value between 0 and 1.
 * @fires input - Mirrors the internal range input's current value.
 * @fires change - Mirrors committed range changes.
 */
export class VolumeControl extends HTMLElement {
    constructor() {
        super();
        this._buttonId = `volume-button-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._sliderId = `volume-slider-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._open = false;
        this._listenersAttached = false;
        this._documentPointerHandler = this.handleDocumentPointerDown.bind(this);
        this._focusoutHandler = this.handleFocusOut.bind(this);
    }

    static get observedAttributes() {
        return ["value"];
    }

    connectedCallback() {
        this.render();
        this.syncValue(this.getAttribute("value") ?? "1");
        this.addEventListeners();
    }

    disconnectedCallback() {
        this.removeEventListener("focusout", this._focusoutHandler);
        document.removeEventListener("pointerdown", this._documentPointerHandler, true);
        this._listenersAttached = false;
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name !== "value" || oldValue === newValue) return;
        this.syncValue(newValue ?? "1");
    }

    get value() {
        return this.getAttribute("value") ?? "1";
    }

    set value(value) {
        this.setAttribute("value", String(value));
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
                @scope (volume-control) {
                    :scope {
                        display: block;
                        position: relative;
                        justify-self: end;
                    }

                    *,
                    *::before,
                    *::after {
                        box-sizing: border-box;
                    }

                    .volume-control {
                        position: relative;
                        display: grid;
                        place-items: center;
                    }

                    button {
                        position: relative;
                        z-index: 2;
                        display: grid;
                        place-items: center;
                        width: 50px;
                        height: 50px;
                        margin: 0;
                        padding: 0;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        background-color: transparent;
                        box-shadow: none;
                        color: var(--color-text-muted);
                        cursor: pointer;
                        -webkit-tap-highlight-color: transparent;
                        tap-highlight-color: transparent;
                        transition:
                            color 0.18s ease,
                            transform 0.12s ease;
                    }

                    button:hover,
                    :scope:hover button,
                    :scope:focus-within button,
                    :scope[open] button {
                        color: var(--color-text);
                        background-color: transparent;
                    }

                    .popover:has(input[type="range"]:focus-visible) {
                        box-shadow: var(--shadow-surface), 0 0 0 2px color-mix(in srgb, var(--color-focus) 60%, transparent);
                    }

                    button:focus {
                        outline: none;
                    }

                    button:focus-visible {
                        color: var(--color-text);
                    }

                    svg {
                        width: 22px;
                        height: 22px;
                        fill: none;
                        stroke: currentColor;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 2;
                    }

                    .mute-slash {
                        opacity: 0;
                        transition: opacity 0.16s ease;
                    }

                    :scope[muted] .wave,
                    :scope[muted] .wave-small {
                        opacity: 0.22;
                    }

                    :scope[muted] .mute-slash {
                        opacity: 1;
                    }

                    .popover-anchor {
                        position: absolute;
                        bottom: 0;
                        left: 50%;
                        display: grid;
                        align-items: start;
                        justify-items: center;
                        width: 50px;
                        height: 188px;
                        pointer-events: none;
                        transform: translateX(-50%);
                        transform-origin: 50% 100%;
                        z-index: 1;
                    }

                    :scope:hover .popover-anchor,
                    :scope:focus-within .popover-anchor,
                    :scope[open] .popover-anchor {
                        pointer-events: auto;
                    }

                    .popover {
                        display: grid;
                        place-items: center;
                        width: 50px;
                        height: 188px;
                        padding: 18px 0 58px;
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 999px;
                        background: var(--color-surface);
                        box-shadow: var(--shadow-surface);
                        clip-path: inset(140px 0 0 round 999px);
                        opacity: 0;
                        transform-origin: 50% 100%;
                        user-select: none;
                        transition:
                            clip-path 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
                            opacity 0.16s ease;
                    }

                    :scope:hover .popover,
                    :scope:focus-within .popover,
                    :scope[open] .popover {
                        clip-path: inset(0 0 0 round 999px);
                        opacity: 1;
                    }

                    input[type="range"] {
                        height: 120px;
                        margin: 0;
                        accent-color: var(--color-primary);
                        cursor: pointer;
                        direction: rtl;
                        touch-action: none;
                        user-select: none;
                        -webkit-user-drag: none;
                        -webkit-tap-highlight-color: transparent;
                        tap-highlight-color: transparent;
                        writing-mode: vertical-lr;
                    }

                    input[type="range"]:focus {
                        outline: none;
                    }

                    .sr-only {
                        position: absolute;
                        width: 1px;
                        height: 1px;
                        padding: 0;
                        margin: -1px;
                        overflow: hidden;
                        clip: rect(0, 0, 0, 0);
                        white-space: nowrap;
                        border: 0;
                    }

                    @media (prefers-reduced-motion: reduce) {
                        button,
                        .mute-slash,
                        .popover {
                            transition: none;
                        }
                    }
                }
            </style>
            <div class="volume-control">
                <button
                    id="${this._buttonId}"
                    type="button"
                    aria-label="Volume"
                    aria-controls="${this._sliderId}"
                    aria-expanded="false"
                >
                    <!-- Volume icon paths are kept inline so the component template stays self-contained. -->
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
                        <path class="wave wave-small" d="M16 9.5a4 4 0 0 1 0 5"></path>
                        <path class="wave wave-large" d="M18.5 7a7.5 7.5 0 0 1 0 10"></path>
                        <path class="mute-slash" d="M6 18L19 6"></path>
                    </svg>
                </button>
                <div class="popover-anchor">
                    <div class="popover">
                        <label class="sr-only" for="${this._sliderId}">Volume</label>
                        <input
                            id="${this._sliderId}"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value="1"
                            aria-label="Volume"
                        >
                    </div>
                </div>
            </div>
        `;
    }

    addEventListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        const button = this.querySelector("button");
        const slider = this.querySelector('input[type="range"]');

        button.addEventListener("click", (event) => {
            this.open = !this.open;

            if (this.open && event.detail === 0) {
                slider.focus();
            }
        });

        this.addEventListener("focusout", this._focusoutHandler);

        slider.addEventListener("input", (event) => {
            event.stopPropagation();
            this.syncValue(slider.value);
            this.dispatchEvent(new Event("input", { bubbles: true }));
        });

        slider.addEventListener("change", (event) => {
            event.stopPropagation();
            this.dispatchEvent(new Event("change", { bubbles: true }));
        });

        document.addEventListener("pointerdown", this._documentPointerHandler, true);
    }

    handleDocumentPointerDown(event) {
        if (event.composedPath().includes(this)) return;
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && this.contains(activeElement)) {
            activeElement.blur();
        }
        this.open = false;
    }

    handleFocusOut(event) {
        if (this.contains(event.relatedTarget)) return;
        this.open = false;
    }

    syncValue(value) {
        const normalized = Number(value);
        const safeValue = Number.isFinite(normalized)
            ? String(Math.min(1, Math.max(0, normalized)))
            : "1";
        const slider = this.querySelector('input[type="range"]');

        if (slider && slider.value !== safeValue) {
            slider.value = safeValue;
        }

        this.setAttribute("value", safeValue);
        this.toggleAttribute("muted", Number(safeValue) <= 0.001);
    }
}
