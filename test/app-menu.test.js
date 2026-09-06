import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The header menu's logic, tested against a DOM stand-in.
 *
 * What is left in this component after the platform took the rest: it reflects
 * the popover's state into the markup that has to agree with it, it places the
 * panel under the button, it asks the popover to open or close, and it closes on
 * a caret that has gone elsewhere. Four small things, and every one of them was
 * only ever checked by opening a browser and looking — which is not a check that
 * runs, and CI has no browser suite to run it in.
 *
 * The markup and CSS `render()` writes are not covered here, because a fake DOM
 * that parsed HTML would be a browser. That half is checked as source by
 * component-contract.test.js, the same split `remote-playback-control.test.js`
 * uses and for the same reason.
 */

const originalHTMLElement = globalThis.HTMLElement;
const originalScrollX = globalThis.scrollX;
const originalScrollY = globalThis.scrollY;

/** A popover that records what was asked of it, and refuses what a real one refuses. */
class FakePanel {
    constructor({ connected = true } = {}) {
        this.isConnected = connected;
        this.showing = false;
        this.style = {};
        this.calls = { show: 0, hide: 0 };
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
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

class FakeButton {
    constructor(rect) {
        this.rect = rect;
        this.attributes = new Map();
    }

    getBoundingClientRect() {
        return this.rect;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }
}

class FakeHost {
    constructor() {
        this.attributes = new Map();
        this.listeners = new Map();
        this.contained = new Set();
        this.panelNode = new FakePanel();
        this.buttonNode = new FakeButton({ left: 100, right: 140, bottom: 60 });
    }

    set innerHTML(value) {
        this.markup = value;
    }

    querySelector(selector) {
        if (selector === ".menu-panel") return this.panelNode;
        if (selector === "button") return this.buttonNode;

        return null;
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    removeEventListener(type) {
        this.listeners.delete(type);
    }

    toggleAttribute(name, force) {
        if (force) this.attributes.set(name, "");
        else this.attributes.delete(name);
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    contains(node) {
        return this.contained.has(node);
    }
}

async function loadComponent() {
    globalThis.HTMLElement = FakeHost;

    const url = new URL("../src/js/components/app-menu.js", import.meta.url);

    url.search = `?test=${Date.now()}-${Math.random()}`;

    try {
        return await import(url.href);
    } finally {
        globalThis.HTMLElement = originalHTMLElement;
    }
}

/** A menu with `render()` stubbed out, since a fake DOM cannot parse its template. */
async function createMenu() {
    const { AppMenu } = await loadComponent();
    const menu = new AppMenu();

    menu.render = () => {};

    return menu;
}

// beforetoggle is the only place the component learns the panel moved, and both
// sides move it: the invoker on a click, the browser on Escape or an outside
// press. Whatever moved it, the markup beside it has to end up agreeing.
test("the host and the button follow the popover, whichever side moved it", async () => {
    const menu = await createMenu();

    menu.handleBeforeToggle({ newState: "open" });
    assert.equal(menu.hasAttribute("open"), true, "the host should be marked open.");
    assert.equal(menu.buttonNode.getAttribute("aria-expanded"), "true");

    menu.handleBeforeToggle({ newState: "closed" });
    assert.equal(menu.hasAttribute("open"), false);
    assert.equal(menu.buttonNode.getAttribute("aria-expanded"), "false", "and told so to a screen reader.");
});

// Placed before the state flips, so the first frame the panel is painted in is
// already the right one — which is only true if beforetoggle does the placing.
test("an opening panel is placed before it is painted", async () => {
    const menu = await createMenu();
    const placed = [];

    menu.placePanel = () => placed.push(menu.panel.matches(":popover-open"));

    menu.handleBeforeToggle({ newState: "open" });
    assert.deepEqual(placed, [false], "placed while the panel had not yet been shown.");

    menu.handleBeforeToggle({ newState: "closed" });
    assert.equal(placed.length, 1, "a closing panel needs no placing.");
});

// Page coordinates, not viewport ones, so a scroll carries the panel with the
// header instead of leaving it behind.
test("the panel is placed under the button in page coordinates", async () => {
    const menu = await createMenu();

    globalThis.scrollX = 5;
    globalThis.scrollY = 30;
    try {
        menu.placePanel();
    } finally {
        globalThis.scrollX = originalScrollX;
        globalThis.scrollY = originalScrollY;
    }

    assert.equal(menu.panel.style.top, "90px", "flush with the button's bottom, plus the scroll.");
    assert.equal(menu.panel.style.left, "105px", "and its leading edge, plus the scroll.");
});

// showPopover and hidePopover both throw when the popover is already in the
// state being asked for, so the setter has to know before it asks.
test("asking for the state the panel is already in does nothing", async () => {
    const menu = await createMenu();

    menu.open = true;
    menu.open = true;
    assert.equal(menu.panel.calls.show, 1, "the second ask should be a no-op, not a throw.");

    menu.open = false;
    menu.open = false;
    assert.equal(menu.panel.calls.hide, 1);
    assert.equal(menu.open, false);
});

// showPopover also throws on an element that is not in the document. The one
// caller that opens a menu rather than a reader is a redraw putting a fresh one
// back, so this is the guard that keeps that from depending on the order of two
// lines somewhere else.
test("a menu that is not in the document is not asked to open", async () => {
    const menu = await createMenu();

    menu.panelNode.isConnected = false;

    assert.doesNotThrow(() => {
        menu.open = true;
    });
    assert.equal(menu.panel.calls.show, 0);
    assert.equal(menu.open, false, "and it does not claim to have opened.");
});

// A popover holds its ground while focus walks out of it, so this is the one
// dismissal left to the component. The null case is the one that matters:
// pressing a theme label blurs the button with nowhere to send the caret, and
// only forwards the click to the hidden radio on the way up. Closing there would
// shut the panel mid-click.
test("only a caret that has actually landed elsewhere closes the menu", async () => {
    const menu = await createMenu();
    const inside = { name: "the version link" };
    const outside = { name: "the play button" };

    menu.contained.add(inside);

    menu.open = true;
    menu.handleFocusOut({ relatedTarget: null });
    assert.equal(menu.open, true, "focus going nowhere is not a reader leaving.");

    menu.handleFocusOut({ relatedTarget: inside });
    assert.equal(menu.open, true, "nor is focus moving within the menu.");

    menu.handleFocusOut({ relatedTarget: outside });
    assert.equal(menu.open, false, "a caret that has landed outside is.");
});

// hidePopover throws on a popover that is already hidden, and focus leaves a
// closed menu every time the button is tabbed away from.
test("focus leaving a closed menu is not a dismissal", async () => {
    const menu = await createMenu();
    const outside = { name: "the play button" };

    assert.equal(menu.open, false);
    assert.doesNotThrow(() => menu.handleFocusOut({ relatedTarget: outside }));
    assert.equal(menu.panel.calls.hide, 0);
});
