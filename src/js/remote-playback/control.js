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
 * cast therefore ships no remote markup at all,
 * rather than markup kept permanently hidden. Nothing here is wired before
 * `attach()`: no listeners, no facade, nothing to press.
 *
 * That is also why the visibility is decided once. A browser either has a way to
 * cast or it does not, and that cannot change while the page is open — so there
 * is no path that re-hides an attached control, and a live connection can never
 * lose its stop button by construction rather than by a guard.
 *
 * ## The glyph belongs to the provider
 *
 * The button draws the technology it will open, and this file knows the name of
 * none of them: the provider hands over its own mark as markup, and the button
 * shows it at the one size the stylesheet sets. So adding a provider never means
 * editing this file.
 *
 * An icon is two drawings, `idle` and `connected` — sometimes the same one.
 * Both go up at once and CSS shows one, so a state change never re-renders
 * markup the provider owns.
 *
 * ## Two states that look the same on purpose
 *
 * `connecting` and busy pulse the same glyph, because from the user's side they
 * are the same sentence: something is happening, wait. They are still distinct
 * attributes, because only one of them means a session exists — busy is the gap
 * between pressing the button and the browser's own picker appearing, which for
 * some providers includes fetching a script, and claiming a connection during it
 * would make the glyph describe a session that does not exist.
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

// No provider tells a page which device was picked, so these stay generic on
// purpose rather than guessing a name.
const STATUS_BY_STATE = {
    connecting: "Connecting to a device.",
    connected: "Now playing on another device.",
};
const DISCONNECTED_STATUS = "Playback returned to this device.";

// A provider may need the cast file's header read before it will show a device
// list, and a browser can report a picker it never opened as an ordinary
// dismissal — so without this the press looks like nothing happened at all.
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
     * @param {{idle: string, connected: string}} facade.icon The provider's own mark.
     * @param {() => Promise<boolean>} facade.prompt Open the picker. True if it opened.
     * @param {() => boolean} facade.prepare Spend the wait early. True once it has been done.
     * @param {() => boolean} facade.isTransportReady Could a picker have opened at all.
     * @param {(message: string) => void} facade.onUnavailable A press that reached no picker.
     */
    attach(facade) {
        this._facade = facade;
        this.hidden = false;

        const button = this.button();

        // Written once: a browser cannot change cast technology while the page is
        // open, so the glyph is as settled as the control's visibility.
        this.querySelector(".glyph-idle").innerHTML = facade.icon.idle;
        this.querySelector(".glyph-connected").innerHTML = facade.icon.connected;

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

    // Reaching a device takes a few seconds, and the only sign of it is the
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
                       else" signal, so it carries weight here rather than
                       leaning on the provider's connected drawing — a mark may
                       be the same in both states, and a shape change alone is
                       small to read at 22px. Connecting takes the weight but
                       keeps the
                       idle drawing: nothing is playing elsewhere yet. Not
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

                    /* One size for every mark, so an icon only has to be a
                       drawing — its viewBox is its own business. */
                    .glyph svg {
                        display: block;
                        width: 22px;
                        height: 22px;
                        pointer-events: none;
                    }

                    .glyph-connected {
                        display: none;
                    }

                    button[data-remote-state="connected"] .glyph-idle {
                        display: none;
                    }

                    button[data-remote-state="connected"] .glyph-connected {
                        display: block;
                    }

                    /* Reaching a device can take several seconds. A slow
                       pulse carries the wait without moving anything in the
                       header. Opening the picker is the same wait from the
                       user's side — a script may have to be fetched first — and
                       says the same thing, so it borrows the same pulse rather
                       than inventing a second one. */
                    button[data-remote-state="connecting"] .glyph,
                    button[data-remote-busy] .glyph {
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
                        button[data-remote-state="connecting"] .glyph,
                        button[data-remote-busy] .glyph {
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
                 three state names are written once. The glyph slots stay empty
                 until attach() fills them, which is safe because an unattached
                 control is hidden. -->
            <button type="button">
                <span class="glyph glyph-idle"></span>
                <span class="glyph glyph-connected"></span>
            </button>
            <p role="status"></p>
        `;
    }
}
