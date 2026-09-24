/**
 * Volume trigger plus the slider that opens above it.
 *
 * The panel is a native `popover`, as `app-menu`'s is, which hands the browser
 * the part every hand-rolled version of this got wrong: dismissing it. A press
 * anywhere else closes it, Escape closes it, focus comes back to the button, and
 * it draws in the top layer, so nothing in the page can clip it or swallow a
 * click meant for it. CSS anchor positioning holds it above the button, and the
 * browser reports the button as expanded or collapsed from `popovertarget`
 * alone, so the button carries no `aria-expanded` of its own.
 *
 * It opens on a click and on nothing else. Resting on the speaker used to reveal
 * it, and that cost nothing while the reveal was pure CSS `:hover` — a repaint
 * under a still pointer just re-evaluates it. But a popover can only be opened
 * from script, so keeping the hover would have meant this file owning "is the
 * pointer still here?", and that question has never once been answered
 * correctly: a pointer that has not moved is reported as having left whenever
 * something repaints under it, and a wait long enough to absorb that is a wait
 * racing an animation. The slider is not worth that class of bug.
 *
 * Once it is open, a scroll over it moves the level — see handleWheel.
 *
 * @element volume-control
 * @attr {string} value - Slider value between 0 and 1.
 * @attr {string} label - Accessible name for the control. Defaults to "Volume".
 * @attr {boolean} disabled - Inert and dimmed, with the panel closed. Unused by
 *   the app: a cast either drives the device through this slider or hides the
 *   control, because a disabled slider reads as broken rather than absent.
 * @fires input - Mirrors the internal range input's current value.
 * @fires change - Mirrors committed range changes.
 */
const DEFAULT_LABEL = "Volume";
/**
 * How far one scroll event moves the level, as a fraction of the whole.
 *
 * Five of the slider's own hundredth-of-a-range steps: small enough to land on
 * a level deliberately, large enough that crossing the range is a gesture
 * rather than a chore. The slider's step is the unit so a scrolled level and a
 * dragged one are always values of the same kind.
 */
const WHEEL_STEP = 0.05;

export class VolumeControl extends HTMLElement {
    constructor() {
        super();
        const unique = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);

        this._buttonId = `volume-button-${unique()}`;
        this._panelId = `volume-panel-${unique()}`;
        this._sliderId = `volume-slider-${unique()}`;
        // Set on the way in by the click that opened the panel, read on the way
        // out by the toggle that confirms it — see addEventListeners.
        this._openedByKey = false;
        // On the element itself rather than on a rendered node, so it outlives
        // the render a reconnection redoes and never needs attaching twice.
        this.addEventListener("focusout", this.handleFocusOut.bind(this));
    }

    static get observedAttributes() {
        return ["value", "label", "disabled", "hidden"];
    }

    connectedCallback() {
        this.render();
        this.syncValue(this.getAttribute("value") ?? "1");
        this.syncLabel();
        this.syncDisabled();
        this.addEventListeners();
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;

        if (name === "value") {
            this.syncValue(newValue ?? "1");
            return;
        }

        if (name === "label") {
            this.syncLabel();
            return;
        }

        // Hiding the control has to take the panel with it. Its own subtree
        // stops rendering, so nothing is left on screen either way, but the
        // popover stays open underneath — and the control would come back with
        // its panel already up. The app hides this when a transport cannot carry
        // volume, which is not a moment anyone asked for a slider.
        if (name === "hidden") {
            if (this.hasAttribute("hidden") && this.showing) this.panel.hidePopover();
            return;
        }

        this.syncDisabled();
    }

    get value() {
        return this.getAttribute("value") ?? "1";
    }

    set value(value) {
        this.setAttribute("value", String(value));
    }

    /** @returns {HTMLElement|null} The popover itself. */
    get panel() {
        return this.querySelector(".volume-panel");
    }

    /** @returns {boolean} Whether the slider is on screen, however it got there. */
    get showing() {
        return this.panel?.matches(":popover-open") === true;
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (volume-control) {
                    :scope {
                        /* The button's own size, and the width the panel above
                           it is cut to. One number, asked for in two places. */
                        --volume-button-size: 50px;
                        /* Clear air between the two. They are separate objects —
                           a button, and the slider it summons — so the gap is
                           what says so, and it is what keeps a pixel of
                           misplacement from reading as a broken join. */
                        --volume-panel-gap: 8px;
                        /* The slider's length and the air around it, which
                           between them are the panel's whole height. */
                        --volume-slider-length: 120px;
                        --volume-panel-padding: 18px;
                        display: block;
                        justify-self: end;
                    }

                    /* The UA's [hidden] rule is display: none, but an author
                       display above beats it whatever the order — so hiding
                       this element needs saying here or it does nothing. */
                    :scope[hidden] {
                        display: none;
                    }

                    *,
                    *::before,
                    *::after {
                        box-sizing: border-box;
                    }

                    /* Overrides style.css's global button reset (border,
                       box-shadow, background-color) — this is a plain
                       transparent circle, not one of the app's bordered icon
                       buttons. A circle in every state: it stays exactly this
                       shape while the panel is open, and only its colours
                       change. It is also what the panel is anchored to; one
                       volume control per page, so one anchor name is enough. */
                    :scope > button {
                        display: grid;
                        place-items: center;
                        width: var(--volume-button-size);
                        height: var(--volume-button-size);
                        margin: 0;
                        padding: 0;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        box-shadow: none;
                        color: var(--color-text-muted);
                        cursor: pointer;
                        anchor-name: --volume-button;
                        -webkit-tap-highlight-color: transparent;
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    /* No hover state, deliberately, as the app-menu button has
                       none: the lit state below means the panel is open and
                       nothing else, which a hover would blur. */

                    :scope > button:focus {
                        outline: none;
                    }

                    :scope > button:focus-visible {
                        color: var(--color-text);
                    }

                    /* Lit for as long as the panel is, the way app-menu's button
                       is: the panel belongs to this button, and a reader glancing
                       back should see where it came from. Colour only — the
                       button and panel are two objects, so they look like two;
                       the contract test says what a shared shape cost.

                       Asked of :popover-open rather than of an attribute kept
                       beside it, because that is the state itself. */
                    :scope:has(.volume-panel:popover-open) > button {
                        color: var(--color-text);
                        background-color: var(--color-surface-muted);
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

                    /* Undoing the UA's popover box, which arrives centred in the
                       viewport with a border and padding of its own, and holding
                       it above the button instead: its left edge on the button's,
                       with the gap as clear air between them. No transform moves
                       it — a percentage translate reads against a box that does
                       not exist yet while the popover is still display:none, and
                       it left the panel a few pixels out of line on every open.

                       It carries no ground of its own. box-shadow lives out here
                       rather than on the surface below because clip-path
                       restricts painting to exactly its own region: a shadow
                       clipped alongside the reveal would render invisible once
                       fully open, inset(0) matching the border box exactly and
                       leaving no room for anything painted outside it. */
                    .volume-panel {
                        position-anchor: --volume-button;
                        position-area: top span-right;
                        /* Bottom-aligned even when the panel is taller than the
                           room above the button, as in a very short window. The
                           default alignment is safe, which shifts an overflowing
                           panel down over its own button; unsafe lets it run off
                           the top of the window instead, keeping the gap. */
                        align-self: unsafe end;
                        inset: auto;
                        place-items: center;
                        width: var(--volume-button-size);
                        /* Declared for the same reason as app-menu's panel: an
                           older iPad Safari stretched that one to fill its insets
                           rather than fit its content, and the fallback below
                           sets every inset to zero. */
                        height: max-content;
                        margin: 0 0 var(--volume-panel-gap);
                        padding: 0;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        color: inherit;
                        overflow: visible;
                        box-shadow: var(--shadow-elevated);
                        opacity: 0;
                        user-select: none;
                        /* display and overlay are discrete, so without these the
                           panel leaves the top layer on the first frame of the
                           close and the wipe plays to an empty box. */
                        transition:
                            opacity 0.16s ease,
                            display 0.24s allow-discrete,
                            overlay 0.24s allow-discrete;
                    }

                    /* The display belongs to this rule and nowhere else. A
                       closed popover is display:none by the UA stylesheet, and
                       any author declaration at all outranks that whatever its
                       specificity — so a display:grid sitting in the rule above
                       would leave the slider laid out and tabbable while the
                       panel was nominally shut. */
                    .volume-panel:popover-open {
                        display: grid;
                        opacity: 1;

                        /* Where the open transition starts from. A popover is
                           display:none until it is shown, and a style change in
                           the same frame as that has nothing to animate from
                           unless it is written here. */
                        @starting-style {
                            opacity: 0;
                        }
                    }

                    /* A browser without anchor positioning (Safari before 26)
                       keeps the UA's own placement: centred in the viewport, a
                       whole and usable slider, just not held above the button. */
                    @supports not (anchor-name: --volume-button) {
                        .volume-panel {
                            align-self: normal;
                            inset: 0;
                            margin: auto;
                        }
                    }

                    /* The slider's focus ring goes round the whole panel. */
                    .volume-panel:has(input[type="range"]:focus-visible) {
                        box-shadow: var(--shadow-elevated), 0 0 0 2px color-mix(in srgb, var(--color-focus) 60%, transparent);
                    }

                    /* The slider's ground, and nothing else — a self-contained
                       pill with the same padding top and bottom. The wipe runs
                       from the bottom edge upward, so it still grows out of the
                       button that summoned it. */
                    .volume-panel-surface {
                        display: grid;
                        place-items: center;
                        width: 100%;
                        padding: var(--volume-panel-padding) 0;
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 999px;
                        background: var(--color-surface);
                        clip-path: inset(100% 0 0 round 999px);
                        transition: clip-path 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
                    }

                    .volume-panel:popover-open .volume-panel-surface {
                        clip-path: inset(0 0 0 round 999px);

                        @starting-style {
                            clip-path: inset(100% 0 0 round 999px);
                        }
                    }

                    input[type="range"] {
                        height: var(--volume-slider-length);
                        margin: 0;
                        accent-color: var(--color-primary);
                        cursor: pointer;
                        direction: rtl;
                        touch-action: none;
                        user-select: none;
                        -webkit-user-drag: none;
                        -webkit-tap-highlight-color: transparent;
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

                    /* Placed after the states above so it wins the cascade at
                       equal specificity. Nothing has to stop the panel opening
                       from here: a disabled invoker toggles nothing, and
                       syncDisabled closes one already up. */
                    :scope[disabled] > button {
                        color: var(--color-text-muted);
                        cursor: default;
                        opacity: 0.4;
                    }

                    /* Motion only. Nothing in here eases a colour: a theme
                       change is animated once, for the whole surface, by the
                       cross-fade in style.css, and --color-change-duration is
                       already 0s under this preference. */
                    @media (prefers-reduced-motion: reduce) {
                        :scope > button,
                        .mute-slash,
                        .volume-panel,
                        .volume-panel-surface {
                            transition: none;
                        }
                    }
                }
            </style>
            <button
                id="${this._buttonId}"
                type="button"
                popovertarget="${this._panelId}"
                aria-label="${DEFAULT_LABEL}"
                aria-controls="${this._panelId}"
            >
                <!-- Volume icon paths are kept inline so the component template stays self-contained. -->
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 9v6h4l5 4V5L8 9H4z"></path>
                    <path class="wave wave-small" d="M16 9.5a4 4 0 0 1 0 5"></path>
                    <path class="wave wave-large" d="M18.5 7a7.5 7.5 0 0 1 0 10"></path>
                    <path class="mute-slash" d="M6 18L19 6"></path>
                </svg>
            </button>
            <div id="${this._panelId}" class="volume-panel" popover>
                <div class="volume-panel-surface">
                    <label class="sr-only" for="${this._sliderId}">${DEFAULT_LABEL}</label>
                    <input
                        id="${this._sliderId}"
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value="1"
                        aria-label="${DEFAULT_LABEL}"
                    >
                </div>
            </div>
        `;
    }

    /**
     * Listeners on the nodes this render built. A reconnection renders fresh
     * nodes, so these go on again each time with nothing left to double up.
     */
    addEventListeners() {
        const button = this.querySelector("button");
        const slider = this.querySelector('input[type="range"]');

        // A keyboard activation reports no click count. Recorded rather than
        // acted on, because the popover has not opened yet: the invoker's
        // default action runs after this listener, so `showing` still reads the
        // state this press is about to reverse.
        //
        // Which is what rules out a keyboard press that *closes* the panel. It
        // reports the same detail of 0, and reading the click alone would leave
        // the flag raised behind it, claiming a keyboard open was waiting to be
        // honoured when none was. Nothing reads it in that state today, because
        // every open arrives through this same listener and sets it afresh — so
        // this holds the flag to its meaning rather than fixing anything a
        // reader could see.
        button.addEventListener("click", (event) => {
            this._openedByKey = event.detail === 0 && !this.showing;
        });

        // On the panel because toggle events do not bubble, and read after the
        // state has flipped, because a display:none slider cannot take focus.
        // Only for a reader who opened the panel from the keyboard: a pointer
        // that opened it is already where it wants to be, and pulling focus
        // would put a ring on the slider nobody asked for.
        this.panel?.addEventListener("toggle", (event) => {
            if (event.newState !== "open") return;
            if (!this._openedByKey) return;

            this._openedByKey = false;
            this.querySelector('input[type="range"]')?.focus();
        });

        // Not passive: this has a page scroll to prevent. Listened for on the
        // panel rather than the slider so the whole pill answers, the padding
        // around the track included — a gesture aimed at a control a finger wide
        // should not depend on hitting it.
        this.panel?.addEventListener("wheel", this.handleWheel.bind(this), { passive: false });

        slider.addEventListener("input", (event) => {
            event.stopPropagation();
            this.syncValue(slider.value);
            this.dispatchEvent(new Event("input", { bubbles: true }));
        });

        slider.addEventListener("change", (event) => {
            event.stopPropagation();
            this.dispatchEvent(new Event("change", { bubbles: true }));
        });
    }

    /**
     * Close the panel when focus has gone somewhere else.
     *
     * A popover stays open while focus leaves it, so a reader who tabs past the
     * slider would otherwise leave it floating over the footer behind them.
     *
     * Only a real destination counts. Focus that goes nowhere is not a reader
     * leaving, and a press that truly landed outside is the browser's to
     * dismiss.
     * @param {FocusEvent} event - The focusout.
     */
    handleFocusOut(event) {
        // hidePopover throws on a closed popover. Focus leaves a closed panel
        // whenever its button is tabbed away from, and a press on another
        // popover's button can reach here after the browser has closed this one.
        if (!this.showing) return;
        if (!event.relatedTarget || this.contains(event.relatedTarget)) return;

        this.panel.hidePopover();
    }

    /**
     * A scroll over the open panel moves the level.
     *
     * A range input ignores the wheel on every engine, which is right for one
     * sitting in a scrolling form and wrong for one that is the whole of a
     * panel: there is nothing else here to scroll, and reaching for a slider
     * already under the pointer is what a wheel is for.
     *
     * The delta's *sign* is all that is read. The same gesture reports wildly
     * different magnitudes across a notched mouse, a free-spinning one and a
     * trackpad, in three different `deltaMode` units, so anything scaled by it
     * would move the level a different distance on every pointing device. One
     * fixed step per event is the same everywhere. Up raises, which is the
     * direction the slider itself fills.
     *
     * The arithmetic is done in the slider's own hundredths and rounded back,
     * because a level is read as text: repeated addition of 0.05 in binary
     * floating point reaches 0.30000000000000004, and that would be written to
     * the attribute and saved.
     * @param {WheelEvent} event - The wheel over the panel.
     */
    handleWheel(event) {
        if (this.hasAttribute("disabled")) return;

        const direction = Math.sign(event.deltaY);
        if (!direction) return;

        // A short enough window scrolls, and this panel is over it. Without
        // this the level and the page behind it move on the one gesture.
        event.preventDefault();

        const steps = Math.round((Number(this.value) - direction * WHEEL_STEP) * 100);
        const next = String(Math.min(100, Math.max(0, steps)) / 100);

        // Silent at either end. A slider already at zero has nothing to report,
        // and an `input` event per notch there would have the app saving a
        // level that never changed.
        if (next === this.value) return;

        this.syncValue(next);
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
    }

    syncLabel() {
        const label = this.getAttribute("label") || DEFAULT_LABEL;
        const button = this.querySelector("button");
        const slider = this.querySelector('input[type="range"]');
        const sliderLabel = this.querySelector("label");

        button?.setAttribute("aria-label", label);
        slider?.setAttribute("aria-label", label);

        if (sliderLabel) sliderLabel.textContent = label;
    }

    // Closed as well as inert: a slider left on screen that moves nothing would
    // be a control that lies.
    syncDisabled() {
        const disabled = this.hasAttribute("disabled");
        const button = this.querySelector("button");
        const slider = this.querySelector('input[type="range"]');

        if (button) button.disabled = disabled;
        if (slider) slider.disabled = disabled;

        if (disabled && this.showing) this.panel.hidePopover();
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
