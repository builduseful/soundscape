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
        this.attachShadow({ mode: "open" });
        this._buttonId = `volume-button-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._sliderId = `volume-slider-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
        this._open = false;
        this._documentPointerHandler = this.handleDocumentPointerDown.bind(this);
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
        document.removeEventListener("pointerdown", this._documentPointerHandler, true);
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name !== "value" || oldValue === newValue || !this.shadowRoot) return;
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
        const button = this.shadowRoot?.querySelector("button");
        if (button) {
            button.setAttribute("aria-expanded", String(this._open));
        }
    }

    render() {
        this.shadowRoot.innerHTML = /* html */ `
            <style>
                :host {
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
                    width: 42px;
                    height: 42px;
                    margin: 0;
                    padding: 0;
                    border: 0;
                    border-radius: 999px;
                    background: transparent;
                    color: var(--color-text-muted);
                    cursor: pointer;
                    transition:
                        color 0.18s ease,
                        transform 0.12s ease;
                }

                button:hover,
                :host(:hover) button,
                :host(:focus-within) button,
                :host([open]) button {
                    color: var(--color-text);
                }

                .volume-control:has(button:focus-visible) .popover,
                .popover:has(input[type="range"]:focus-visible) {
                    box-shadow: var(--shadow-surface), 0 0 0 2px color-mix(in srgb, var(--color-focus) 60%, transparent);
                }

                button:focus {
                    outline: none;
                }

                button:focus-visible {
                    color: var(--color-text);
                }

                button:active {
                    transform: scale(0.95);
                }

                svg {
                    width: 18px;
                    height: 18px;
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

                :host([muted]) .wave,
                :host([muted]) .wave-large {
                    opacity: 0.22;
                }

                :host([muted]) .mute-slash {
                    opacity: 1;
                }

                .popover-anchor {
                    position: absolute;
                    bottom: 0;
                    left: 50%;
                    display: grid;
                    align-items: start;
                    justify-items: center;
                    width: 42px;
                    height: 164px;
                    pointer-events: none;
                    transform: translateX(-50%);
                    transform-origin: 50% 100%;
                    z-index: 1;
                }

                :host(:hover) .popover-anchor,
                :host(:focus-within) .popover-anchor,
                :host([open]) .popover-anchor {
                    pointer-events: auto;
                }

                .popover {
                    display: grid;
                    place-items: center;
                    width: 42px;
                    height: 164px;
                    padding: 16px 0 50px;
                    border: 1px solid var(--color-border-subtle);
                    border-radius: 999px;
                    background: var(--color-surface);
                    box-shadow: var(--shadow-surface);
                    clip-path: inset(122px 0 0 round 999px);
                    opacity: 0;
                    transform-origin: 50% 100%;
                    user-select: none;
                    transition:
                        clip-path 0.24s cubic-bezier(0.2, 0.8, 0.2, 1),
                        opacity 0.16s ease;
                }

                :host(:hover) .popover,
                :host(:focus-within) .popover,
                :host([open]) .popover {
                    clip-path: inset(0 0 0 round 999px);
                    opacity: 1;
                }

                input[type="range"] {
                    height: 106px;
                    margin: 0;
                    accent-color: var(--color-primary);
                    cursor: pointer;
                    direction: rtl;
                    touch-action: none;
                    user-select: none;
                    -webkit-user-drag: none;
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

            </style>
            <div class="volume-control">
                <button
                    id="${this._buttonId}"
                    type="button"
                    aria-label="Volume"
                    aria-controls="${this._sliderId}"
                    aria-expanded="false"
                >
                    <!-- Volume icon paths are kept inline so the shadow DOM template stays self-contained. -->
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
                        <path class="wave wave-small" d="M16 9.5a4 4 0 0 1 0 5"></path>
                        <path class="wave wave-large" d="M18.5 7a7.5 7.5 0 0 1 0 10"></path>
                        <path class="mute-slash" d="M6 18L19 6"></path>
                    </svg>
                </button>
                <div class="popover-anchor">
                    <div class="popover" part="popover">
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
        const button = this.shadowRoot.querySelector("button");
        const slider = this.shadowRoot.querySelector('input[type="range"]');

        button.addEventListener("click", (event) => {
            this.open = !this.open;

            if (this.open && event.detail === 0) {
                slider.focus();
            }
        });

        this.addEventListener("focusout", (event) => {
            if (this.contains(event.relatedTarget) || this.shadowRoot.contains(event.relatedTarget)) return;
            this.open = false;
        });

        slider.addEventListener("input", () => {
            this.syncValue(slider.value);
            this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        });

        slider.addEventListener("change", () => {
            this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        });

        document.addEventListener("pointerdown", this._documentPointerHandler, true);
    }

    handleDocumentPointerDown(event) {
        if (event.composedPath().includes(this)) return;
        const activeElement = this.shadowRoot?.activeElement;
        if (activeElement instanceof HTMLElement) {
            activeElement.blur();
        }
        this.open = false;
    }

    syncValue(value) {
        const normalized = Number(value);
        const safeValue = Number.isFinite(normalized)
            ? String(Math.min(1, Math.max(0, normalized)))
            : "1";
        const slider = this.shadowRoot?.querySelector('input[type="range"]');

        if (slider && slider.value !== safeValue) {
            slider.value = safeValue;
        }

        this.setAttribute("value", safeValue);
        this.toggleAttribute("muted", Number(safeValue) <= 0.001);
    }
}
