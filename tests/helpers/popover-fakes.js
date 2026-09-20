/**
 * DOM stand-ins for testing the popover panels, `app-menu` and `volume-control`.
 *
 * None of these parses HTML — one that did would be a browser — so tests stub
 * `render()`, and `FakeHost` hands back the nodes a render would have built.
 * `FakePanel` throws wherever a real popover throws, so the guard in front of
 * every open and close is under test along with it.
 */

/** A popover that records what was asked of it, and refuses what a real one refuses. */
export class FakePanel {
    constructor() {
        this.isConnected = true;
        this.showing = false;
        this.calls = { show: 0, hide: 0 };
        this.listeners = new Map();
        // Recorded raw rather than defaulted, so a listener that never states
        // its passivity reads as undefined here instead of quietly as false.
        this.passive = {};
    }

    addEventListener(type, handler, options) {
        this.listeners.set(type, handler);
        this.passive[type] = options?.passive;
    }

    showPopover() {
        // The two states a real showPopover throws InvalidStateError for. The
        // component must never reach either.
        if (!this.isConnected) throw new Error("InvalidStateError: not connected");
        if (this.showing) throw new Error("InvalidStateError: already showing");

        this.calls.show += 1;
        this.showing = true;
    }

    hidePopover() {
        if (!this.showing) throw new Error("InvalidStateError: already hidden");

        this.calls.hide += 1;
        this.showing = false;
    }

    matches(selector) {
        return selector === ":popover-open" ? this.showing : false;
    }
}

/** A button or a slider: attributes, a value, listeners, and whether it was focused. */
export class FakeControl {
    constructor() {
        this.attributes = new Map();
        this.disabled = false;
        this.value = "1";
        this.listeners = new Map();
        this.focused = 0;
    }

    focus() {
        this.focused += 1;
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }
}

/** The element itself, with every node either component asks for. */
export class FakeHost {
    constructor() {
        this.attributes = new Map();
        this.listeners = new Map();
        this.contained = new Set();
        this.dispatched = [];
        this.panelNode = new FakePanel();
        this.buttonNode = new FakeControl();
        this.sliderNode = new FakeControl();
        this.labelNode = { textContent: "" };
    }

    set innerHTML(value) {
        this.markup = value;
    }

    querySelector(selector) {
        if (selector === ".menu-panel" || selector === ".volume-panel") return this.panelNode;
        if (selector === "button") return this.buttonNode;
        if (selector === 'input[type="range"]') return this.sliderNode;
        if (selector === "label") return this.labelNode;

        return null;
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    toggleAttribute(name, force) {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    contains(node) {
        return this.contained.has(node);
    }

    dispatchEvent(event) {
        this.dispatched.push(event.type);

        return true;
    }
}

/**
 * Import a component fresh, against the stand-in.
 * @param {string} fileName - Its file in src/js/components/.
 * @returns {Promise<object>} The module.
 */
export async function loadComponent(fileName) {
    const originalHTMLElement = globalThis.HTMLElement;
    const url = new URL(`../../src/js/components/${fileName}`, import.meta.url);

    url.search = `?test=${Date.now()}-${Math.random()}`;
    globalThis.HTMLElement = FakeHost;

    try {
        return await import(url.href);
    } finally {
        globalThis.HTMLElement = originalHTMLElement;
    }
}
