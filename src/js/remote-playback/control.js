/**
 * The remote playback control: one button, and the announcement that goes with
 * it.
 *
 * @element remote-playback
 *
 * This owns everything a person sees and hears about playing the soundscape
 * somewhere else — the glyph and its three states, the wait pulse, the button's
 * label, the screen reader announcements, and the wording of all of it. It owns
 * none of the decisions. It cannot open a picker, it cannot tell whether a
 * device is connected, and it never moves audio; it is handed a small facade
 * that can do the first, and it is told the second.
 *
 * ## Attached, or not there at all
 *
 * The element renders hidden and stays that way until `attach()` is called, and
 * `detach()` removes it from the document outright. A browser with no way to
 * cast — Firefox, Samsung Internet — therefore ships no remote markup at all,
 * rather than markup kept permanently hidden. Nothing here is wired before
 * `attach()`: no listeners, no facade, nothing to press.
 *
 * That is also why the visibility is decided once. A browser either has a way to
 * cast or it does not, and that cannot change while the page is open — so there
 * is no path that re-hides an attached control, and a live connection can never
 * lose its stop button by construction rather than by a guard.
 *
 * ## Two states that look the same on purpose
 *
 * `connecting` and busy pulse the same glyph, because from the user's side they
 * are the same sentence: something is happening, wait. They are still distinct
 * attributes, because only one of them means a session exists — busy is the gap
 * between pressing the button and the browser's own picker appearing, which on
 * the Cast SDK path includes fetching a script, and claiming a connection during
 * it would make the glyph describe a session that does not exist.
 */

// Everything this control says. The keys below are the three connection states,
// and they are the vocabulary the rest of the file is written against — the
// glyph attribute, the announcement, the stylesheet. A contract test pins these
// keys against the selectors in the @scope block, because a rename that reached
// only one would leave a button that silently stops changing.
const BUTTON_LABEL_BY_STATE = {
    idle: "Play on another device",
    connecting: "Connecting to device",
    connected: "Casting — change device or stop",
};

// Neither platform tells a page which device was picked, so these stay generic
// on purpose rather than guessing a name.
const STATUS_BY_STATE = {
    connecting: "Connecting to a device.",
    connected: "Now playing on another device.",
};
const DISCONNECTED_STATUS = "Playback returned to this device.";

// Both platforms need the cast file's header read before they will show a device
// list, and Chromium reports a picker it never opened as an ordinary dismissal —
// so without this the press looks like nothing happened at all.
const REMOTE_UNAVAILABLE_MESSAGE =
    "Couldn't open the device list yet. Check your connection, then try again.";

/**
 * What to call the volume slider while a remote is driving it.
 *
 * Exported rather than kept here, because the control it labels is a sibling
 * this component does not own and must not reach for — `script.js` does the
 * labelling. But the *wording* is this feature's, and it belongs beside the
 * button's own labels: the two are read together, and "Casting — change device
 * or stop" beside a slider that said something else about the same connection
 * would be one feature speaking with two voices.
 */
export const REMOTE_VOLUME_LABEL = "Volume on the device you're casting to";

export class RemotePlayback extends HTMLElement {
    constructor() {
        super();
        this._facade = null;
        this._state = "idle";
        this._prepareHandler = () => this.handlePrepare();
    }

    connectedCallback() {
        this.render();
        this.hidden = true;
        // The idle glyph and label are established here rather than written into
        // the template, so the state names have one source and cannot drift
        // between the markup and the logic that replaces it. Announces nothing:
        // the state has not changed.
        this.setConnection({});
    }

    /**
     * Wire the control to a provider and show it.
     *
     * Called explicitly rather than resolved in the constructor: the element is
     * upgraded whenever the browser gets round to it, and a control that
     * discovered its own dependencies by timing would be a control whose
     * readiness the app cannot state. One call, at boot, from the one place that
     * knows whether there is a provider at all.
     *
     * @param {object} facade
     * @param {() => Promise<boolean>} facade.prompt Open the picker. True if it opened.
     * @param {() => boolean} facade.prepare Spend the wait early. True once it has been done.
     * @param {() => boolean} facade.isTransportReady Could a picker have opened at all.
     * @param {(message: string) => void} facade.onUnavailable A press that reached no picker.
     */
    attach(facade) {
        this._facade = facade;
        this.hidden = false;

        const button = this.button();

        button.addEventListener("click", () => this.handleClick());
        // Hover, focus, or the pointerdown that precedes a tap: the last moment
        // before the press at which the wait can still be spent instead of
        // shown. The provider decides whether that means anything.
        button.addEventListener("pointerenter", this._prepareHandler);
        button.addEventListener("pointerdown", this._prepareHandler);
        button.addEventListener("focus", this._prepareHandler);
    }

    /** No provider on this browser. Leave no markup behind. */
    detach() {
        this._facade = null;
        this.remove();
    }

    /**
     * Report what the connection is doing. The two signals collapse into one
     * name here and nowhere else, so the glyph, the label and the announcement
     * cannot disagree about what is happening.
     */
    setConnection({ connected = false, connecting = false } = {}) {
        const state = connected ? "connected" : (connecting ? "connecting" : "idle");
        const previousState = this._state;

        this._state = state;

        const button = this.button();

        button.dataset.remoteState = state;
        button.setAttribute("aria-label", BUTTON_LABEL_BY_STATE[state]);
        this.announce(state, previousState);
    }

    /** The current connection state, for tests and for the app's own reads. */
    get state() {
        return this._state;
    }

    // Reaching a Chromecast takes a few seconds, and the only sign of it is the
    // pulse and the changed label — neither of which a screen reader announces
    // on a control nobody is focused on. Idle is the one state with no wording
    // of its own: "returned to this device" is only true if the audio ever left,
    // and a connection abandoned at the picker never moved it. Writing an empty
    // string still clears whatever the previous state said, silently.
    announce(state, previousState) {
        if (state === previousState) return;

        this.status().textContent = STATUS_BY_STATE[state]
            ?? (previousState === "connected" ? DISCONNECTED_STATUS : "");
    }

    // A dismissed picker and a picker that never opened are the same `false`
    // here, and on Chromium they are the same DOMException too — so the
    // transport's own readiness is what separates them. Asked after the await,
    // it describes the state the press actually ran against.
    //
    // The message goes back to the app rather than on screen here: the app owns
    // the status strip under the title, and what may share it with a loading
    // indicator is its rule to keep.
    async handleClick() {
        const button = this.button();

        // Opening a picker is not instant, and until it appears the press has no
        // visible effect at all, which reads as a broken button. Deliberately
        // not routed through setConnection: no connection state has changed.
        button.dataset.remoteBusy = "true";
        button.setAttribute("aria-busy", "true");

        try {
            const opened = await this._facade.prompt();

            if (opened || this._facade.isTransportReady()) return;

            this._facade.onUnavailable(REMOTE_UNAVAILABLE_MESSAGE);
        } finally {
            delete button.dataset.remoteBusy;
            button.removeAttribute("aria-busy");
        }
    }

    // One preparation is all there is, so all three listeners come off together.
    handlePrepare() {
        if (!this._facade.prepare()) return;

        const button = this.button();

        button.removeEventListener("pointerenter", this._prepareHandler);
        button.removeEventListener("pointerdown", this._prepareHandler);
        button.removeEventListener("focus", this._prepareHandler);
    }

    button() {
        return this.querySelector("button");
    }

    status() {
        return this.querySelector("p");
    }

    render() {
        this.innerHTML = /* html */ `
            <style>
                @scope (remote-playback) {
                    :scope {
                        display: contents;
                    }

                    /* The UA's [hidden] rule is display: none, but an author
                       display above beats it whatever the order — so hiding
                       this element needs saying here or it does nothing. */
                    :scope[hidden] {
                        display: none;
                    }

                    /* Overrides the global button reset the same way app-menu's
                       trigger does: this sits beside that button in the header
                       and reads as a peer of it, not as one of the app's
                       bordered transport buttons. */
                    button {
                        width: 40px;
                        height: 40px;
                        border: 0;
                        border-radius: 999px;
                        background: transparent;
                        box-shadow: none;
                        color: var(--color-text-muted);
                        transition:
                            color var(--color-change-duration),
                            background-color var(--color-change-duration);
                    }

                    button:hover {
                        color: var(--color-text);
                        background-color: var(--color-surface-muted);
                    }

                    button:focus-visible {
                        outline: 2px solid var(--color-focus);
                        outline-offset: 2px;
                        box-shadow: none;
                    }

                    /* Connected is the app's one persistent "audio is somewhere
                       else" signal, so it gets weight as well as a filled glyph
                       — a shape change alone is small to read at 22px.
                       Connecting takes the same weight but not the fill: the
                       screen stays empty until something is actually on it. Not
                       --color-primary: the palette is monochrome and defines it
                       as the same ink as --color-text, so the contrast has to
                       come from stepping off the muted idle colour. */
                    button[data-remote-state="connected"],
                    button[data-remote-state="connected"]:hover,
                    button[data-remote-state="connecting"],
                    button[data-remote-state="connecting"]:hover,
                    button[data-remote-busy],
                    button[data-remote-busy]:hover {
                        color: var(--color-text);
                    }

                    .button-icon {
                        width: 22px;
                        height: 22px;
                        fill: none;
                    }

                    .remote-icon-screen {
                        display: none;
                    }

                    button[data-remote-state="connected"] .remote-icon-screen {
                        display: block;
                    }

                    /* Reaching a Chromecast can take several seconds. A slow
                       pulse carries the wait without moving anything in the
                       header. Opening the picker is the same wait from the
                       user's side — a script may have to be fetched first — and
                       says the same thing, so it borrows the same pulse rather
                       than inventing a second one. */
                    button[data-remote-state="connecting"] .remote-icon,
                    button[data-remote-busy] .remote-icon {
                        animation: remote-connecting 1.4s ease-in-out infinite;
                    }

                    /* Announcement-only: the connection has no visible text of
                       its own, and the status strip under the title is spoken
                       for by loading and error messages. */
                    p {
                        position: absolute;
                        width: 1px;
                        height: 1px;
                        padding: 0;
                        margin: -1px;
                        overflow: hidden;
                        clip-path: inset(50%);
                        white-space: nowrap;
                        border: 0;
                    }

                    @media (prefers-reduced-motion: reduce) {
                        button {
                            transition: none;
                        }

                        /* The wait still needs saying, so the pulse settles into
                           the dimmed half of its own cycle rather than
                           disappearing. */
                        button[data-remote-state="connecting"] .remote-icon,
                        button[data-remote-busy] .remote-icon {
                            animation: none;
                            opacity: 0.55;
                        }
                    }
                }

                /* Outside the @scope block on purpose: @keyframes is not a style
                   rule and scoping it would leave the animation above naming
                   something that does not exist. */
                @keyframes remote-connecting {
                    50% {
                        opacity: 0.35;
                    }
                }
            </style>
            <!-- No state or label here: connectedCallback sets both, so the
                 three state names are written once, in one place. -->
            <button type="button">
                <svg class="button-icon remote-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M3 17.5a3.5 3.5 0 0 1 3.5 3.5M3 13.5A7.5 7.5 0 0 1 10.5 21M3 9.5A11.5 11.5 0 0 1 14.5 21" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
                    <path d="M3 6.5v-1a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>
                    <!-- The filled screen is the connected state. Drawing it on
                         top of the idle glyph rather than shipping a second copy
                         of the whole icon keeps the two from drifting apart. -->
                    <path class="remote-icon-screen" d="M7 7.75h10v8.5h-3.6A10.9 10.9 0 0 0 7 10.4V7.75Z" fill="currentColor" stroke="none"></path>
                </svg>
            </button>
            <p role="status"></p>
        `;
    }
}
