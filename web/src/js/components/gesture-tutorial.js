/**
 * A first-run guide to the gestures, learnt by doing: each step names one
 * gesture and moves on when the listener makes it, and the gesture does its
 * real work as it goes. The first tap starts the sound.
 *
 * It only shows and steps; whether to show it, and remembering that it was
 * finished, are script.js's. Taps pass through the card to the player beneath,
 * so only Skip is a target of its own.
 *
 * @element gesture-tutorial
 * @fires tutorial-done - Finished or skipped; either way it should not return.
 */
const STEPS = [
    { gesture: "tap", text: "Tap anywhere to play or pause" },
    { gesture: "swipe", text: "Swipe left or right to change sound" },
    { gesture: "volume", text: "Slide up or down to set the volume" },
];
const DONE_TEXT = "You're all set";
/** How long the closing line stays before the card fades. */
const DONE_HOLD_MS = 1400;
/** Matches the fade in the styles below, so the card is hidden once it has gone. */
const FADE_MS = 320;

export class GestureTutorial extends HTMLElement {
    constructor() {
        super();
        this._step = -1;
        this._timer = 0;
    }

    connectedCallback() {
        if (!this.querySelector(".tutorial-card")) this.render();
        this.hidden = true;
        this.querySelector(".tutorial-skip").addEventListener("click", () => this.finish(false));
    }

    /** Opens at the first step. */
    start() {
        clearTimeout(this._timer);
        this.hidden = false;
        this.showStep(0);
        // A frame in the hidden state first, or the fade has nothing to fade from.
        requestAnimationFrame(() => requestAnimationFrame(() => this.setAttribute("data-open", "")));
    }

    /**
     * Tells the guide a gesture happened; it moves on if that was the one asked for.
     * @param {"tap" | "swipe" | "volume"} gesture
     */
    completed(gesture) {
        if (STEPS[this._step]?.gesture !== gesture) return;

        if (this._step + 1 < STEPS.length) {
            this.showStep(this._step + 1);
            return;
        }

        this._step = STEPS.length;
        this.querySelector(".tutorial-text").textContent = DONE_TEXT;
        this.querySelector(".tutorial-hint").dataset.gesture = "done";
        this.querySelector(".tutorial-skip").hidden = true;
        this.updateDots();
        this._timer = setTimeout(() => this.finish(true), DONE_HOLD_MS);
    }

    showStep(index) {
        this._step = index;
        this.querySelector(".tutorial-text").textContent = STEPS[index].text;
        this.querySelector(".tutorial-hint").dataset.gesture = STEPS[index].gesture;
        this.updateDots();
    }

    updateDots() {
        this.querySelectorAll(".tutorial-dot").forEach((dot, index) => {
            dot.toggleAttribute("data-reached", index <= this._step);
        });
    }

    finish(completed) {
        clearTimeout(this._timer);
        this._step = -1;
        this.removeAttribute("data-open");
        this._timer = setTimeout(() => { this.hidden = true; }, FADE_MS);
        this.dispatchEvent(new CustomEvent("tutorial-done", { detail: { completed } }));
    }

    render() {
        const dots = STEPS.map(() => "<span class=\"tutorial-dot\"></span>").join("");

        this.innerHTML = /* html */ `
            <style>
                @scope (gesture-tutorial) {
                    :scope {
                        bottom: calc(96px + env(safe-area-inset-bottom));
                        display: block;
                        left: 50%;
                        opacity: 0;
                        pointer-events: none;
                        position: fixed;
                        transform: translate(-50%, 8px);
                        transition: opacity 0.32s ease, transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
                        width: min(320px, calc(100% - 36px));
                        z-index: 2;
                    }

                    :scope[hidden] {
                        display: none;
                    }

                    :scope[data-open] {
                        opacity: 1;
                        transform: translate(-50%, 0);
                    }

                    .tutorial-card {
                        align-items: center;
                        background-color: var(--color-surface);
                        border: 1px solid var(--color-border-subtle);
                        border-radius: 18px;
                        box-shadow: var(--shadow-elevated);
                        display: grid;
                        gap: 12px;
                        grid-template-columns: 56px 1fr;
                        padding: 16px 18px 12px 14px;
                    }

                    .tutorial-text {
                        color: var(--color-text);
                        font-size: 0.95rem;
                        font-weight: 600;
                        line-height: 1.3;
                        margin: 0;
                    }

                    .tutorial-footer {
                        align-items: center;
                        display: flex;
                        grid-column: 1 / -1;
                        justify-content: space-between;
                        min-height: 32px;
                    }

                    .tutorial-dots {
                        display: flex;
                        gap: 6px;
                        padding-inline-start: 4px;
                    }

                    .tutorial-dot {
                        background-color: var(--color-border);
                        border-radius: 50%;
                        height: 6px;
                        width: 6px;
                    }

                    .tutorial-dot[data-reached] {
                        background-color: var(--color-text-muted);
                    }

                    .tutorial-skip {
                        background: none;
                        border: 0;
                        border-radius: 999px;
                        box-shadow: none;
                        color: var(--color-text-soft);
                        font-size: 0.85rem;
                        font-weight: 600;
                        padding: 6px 10px;
                        pointer-events: auto;
                    }

                    .tutorial-skip:hover {
                        background-color: var(--color-surface-muted);
                        color: var(--color-text-muted);
                    }

                    .tutorial-skip[hidden] {
                        display: none;
                    }

                    /* A fingertip showing the gesture: a press, a sweep across,
                       a stroke up and down. */
                    .tutorial-hint {
                        display: block;
                        height: 44px;
                        position: relative;
                        width: 56px;
                    }

                    .tutorial-hint::after {
                        background-color: var(--color-text-muted);
                        border-radius: 50%;
                        content: "";
                        height: 16px;
                        left: 20px;
                        opacity: 0.8;
                        position: absolute;
                        top: 14px;
                        width: 16px;
                    }

                    /* The fingertip turns into a tick. */
                    .tutorial-hint[data-gesture="done"]::after {
                        background: none;
                        border: solid var(--color-text-muted);
                        border-radius: 0;
                        border-width: 0 2.5px 2.5px 0;
                        height: 16px;
                        left: 23px;
                        top: 11px;
                        transform: rotate(45deg);
                        width: 8px;
                    }

                    @media (prefers-reduced-motion: no-preference) {
                        .tutorial-hint[data-gesture="tap"]::after {
                            animation: tutorial-tap 1.4s ease-in-out infinite;
                        }

                        .tutorial-hint[data-gesture="swipe"]::after {
                            animation: tutorial-swipe 1.6s cubic-bezier(0.45, 0, 0.55, 1) infinite;
                        }

                        .tutorial-hint[data-gesture="volume"]::after {
                            animation: tutorial-volume 1.8s cubic-bezier(0.45, 0, 0.55, 1) infinite;
                        }
                    }

                    @keyframes tutorial-tap {
                        0%, 100% { transform: scale(1); opacity: 0.8; }
                        45% { transform: scale(0.7); opacity: 1; }
                        60% { transform: scale(1.25); opacity: 0.35; }
                    }

                    @keyframes tutorial-swipe {
                        0%, 100% { transform: translateX(14px); opacity: 0; }
                        15% { opacity: 0.8; }
                        70% { transform: translateX(-14px); opacity: 0.8; }
                        85% { transform: translateX(-14px); opacity: 0; }
                    }

                    @keyframes tutorial-volume {
                        0%, 100% { transform: translateY(12px); }
                        50% { transform: translateY(-12px); }
                    }
                }
            </style>
            <div class="tutorial-card" role="status">
                <span class="tutorial-hint" aria-hidden="true"></span>
                <p class="tutorial-text"></p>
                <div class="tutorial-footer">
                    <span class="tutorial-dots" aria-hidden="true">${dots}</span>
                    <button type="button" class="tutorial-skip">Skip</button>
                </div>
            </div>
        `;
    }
}
