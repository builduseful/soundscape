const THEME_OPTIONS = [
    {
        value: "system",
        label: "System",
        icon: /* html */ `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="16" height="11" rx="2"></rect>
                <path d="M8 20h8"></path>
                <path d="M12 16v4"></path>
            </svg>
        `,
    },
    {
        value: "light",
        label: "Light",
        icon: /* html */ `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M12 2v2"></path>
                <path d="M12 20v2"></path>
                <path d="M4.93 4.93l1.41 1.41"></path>
                <path d="M17.66 17.66l1.41 1.41"></path>
                <path d="M2 12h2"></path>
                <path d="M20 12h2"></path>
                <path d="M6.34 17.66l-1.41 1.41"></path>
                <path d="M19.07 4.93l-1.41 1.41"></path>
            </svg>
        `,
    },
    {
        value: "dark",
        label: "Dark",
        icon: /* html */ `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 14.4A7.7 7.7 0 0 1 9.6 4a8 8 0 1 0 10.4 10.4z"></path>
            </svg>
        `,
    },
];

/**
 * Three-way theme preference selector.
 *
 * @element theme-selector
 * @attr {string} value - Selected theme preference: system, light, or dark.
 * @fires theme-change - When the user selects a different preference.
 */
export class ThemeSelector extends HTMLElement {
    constructor() {
        super();
        this._value = "system";
        this._listenersAttached = false;
        this._idPrefix = `theme-${globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    }

    static get observedAttributes() {
        return ["value"];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name !== "value" || oldValue === newValue) return;

        this._value = this.normalizeValue(newValue);
        this.updateCheckedOption();
    }

    connectedCallback() {
        this.render();
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (theme-selector) {
                    :scope {
                        display: block;
                    }

                    .theme-selector {
                        position: relative;
                        display: grid;
                        grid-template-columns: repeat(3, 28px);
                        gap: 3px;
                        padding: 3px;
                        background: var(--color-surface-muted);
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 999px;
                    }

                    .theme-selector::before {
                        content: "";
                        position: absolute;
                        inset: 3px auto 3px 3px;
                        width: 28px;
                        border-radius: 999px;
                        background: var(--color-surface);
                        box-shadow: var(--shadow-surface);
                        transform: translateX(calc(var(--theme-index, 0) * 31px));
                        transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
                        pointer-events: none;
                    }

                    input {
                        position: absolute;
                        opacity: 0;
                        pointer-events: none;
                    }

                    label {
                        position: relative;
                        z-index: 1;
                        display: grid;
                        place-items: center;
                        min-width: 0;
                        width: 28px;
                        height: 28px;
                        border-radius: 999px;
                        color: var(--color-text-muted);
                        cursor: pointer;
                        transition: color 0.16s ease;
                        user-select: none;
                    }

                    svg {
                        width: 15px;
                        height: 15px;
                        fill: none;
                        stroke: currentColor;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 2;
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

                    input:checked + label {
                        color: var(--color-text);
                    }

                    input:focus-visible + label {
                        outline: 2px solid var(--color-focus);
                        outline-offset: 2px;
                    }

                    @media (prefers-reduced-motion: reduce) {
                        .theme-selector::before,
                        label {
                            transition: none;
                        }
                    }
                }
            </style>
            <div class="theme-selector" role="radiogroup" aria-label="Theme">
                ${THEME_OPTIONS.map((option) => {
                    const id = `${this._idPrefix}-${option.value}`;
                    const checked = option.value === this._value ? "checked" : "";
                    return /* html */ `
                        <input type="radio" id="${id}" name="${this._idPrefix}" value="${option.value}" ${checked}>
                        <label for="${id}" title="${option.label}" aria-label="${option.label}">
                            ${option.icon}
                            <span class="sr-only">${option.label}</span>
                        </label>
                    `;
                }).join("")}
            </div>
        `;

        this.syncThemeIndex();
        this.setupEventListeners();
    }

    normalizeValue(value) {
        return THEME_OPTIONS.some((option) => option.value === value) ? value : "system";
    }

    updateCheckedOption() {
        const input = this.querySelector(`input[value="${this._value}"]`);
        if (input) input.checked = true;
        this.syncThemeIndex();
    }

    syncThemeIndex() {
        const index = THEME_OPTIONS.findIndex((option) => option.value === this._value);
        this.querySelector(".theme-selector")?.style.setProperty("--theme-index", String(Math.max(index, 0)));
    }

    setupEventListeners() {
        if (this._listenersAttached) return;
        this._listenersAttached = true;

        this.addEventListener("change", (event) => {
            if (!event.target.matches('input[type="radio"]')) return;

            this._value = this.normalizeValue(event.target.value);
            this.syncThemeIndex();
            this.dispatchEvent(new CustomEvent("theme-change", {
                detail: { theme: this._value },
                bubbles: true,
            }));
        });
    }
}
