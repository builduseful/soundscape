import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The volume control's logic, tested against a DOM stand-in.
 *
 * The same split, and the same reason, as `app-menu.test.js`: what is left in
 * this component once the platform owns dismissing the panel is a handful of
 * small things that were only ever checked by opening a browser and looking.
 * They reflect the popover's state into the markup that has to agree with it,
 * place the panel on the button, and close it in the three cases the browser
 * will not — focus gone elsewhere, the control disabled, the control hidden.
 *
 * Every one of those closes calls `hidePopover`, which throws on a popover that
 * is already hidden, so the guard in front of each is the thing under test as
 * much as the close itself. The fake panel throws exactly where a real one does.
 *
 * The markup and CSS `render()` writes are not covered here, because a fake DOM
 * that parsed HTML would be a browser. That half is checked as source by
 * component-contract.test.js.
 */

const originalHTMLElement = globalThis.HTMLElement;
const originalScrollX = globalThis.scrollX;
const originalScrollY = globalThis.scrollY;
const originalGetComputedStyle = globalThis.getComputedStyle;

// placePanel reads the panel's declared height and the gap off the element,
// because a display:none popover reports no box of its own. These are the two
// values the stylesheet gives it.
const PANEL_HEIGHT = 158;
const PANEL_GAP = 8;

/** A popover that records what was asked of it, and refuses what a real one refuses. */
class FakePanel {
    constructor({ connected = true } = {}) {
        this.isConnected = connected;
        this.showing = false;
        this.style = {};
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

class FakeControl {
    constructor(rect) {
        this.rect = rect;
        this.attributes = new Map();
        this.disabled = false;
        this.value = "1";
        this.listeners = new Map();
    }

    getBoundingClientRect() {
        return this.rect;
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

class FakeHost {
    constructor() {
        this.attributes = new Map();
        this.listeners = new Map();
        this.contained = new Set();
        this.dispatched = [];
        this.panelNode = new FakePanel();
        this.buttonNode = new FakeControl({ left: 100, top: 400, right: 150, bottom: 450 });
        this.sliderNode = new FakeControl({});
        this.labelNode = { textContent: "" };
    }

    set innerHTML(value) {
        this.markup = value;
    }

    querySelector(selector) {
        if (selector === ".volume-panel") return this.panelNode;
        if (selector === "button") return this.buttonNode;
        if (selector === 'input[type="range"]') return this.sliderNode;
        if (selector === "label") return this.labelNode;

        return null;
    }

    addEventListener(type, handler) {
        this.listeners.set(type, handler);
    }

    removeEventListener(type) {
        this.listeners.delete(type);
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

async function loadComponent() {
    globalThis.HTMLElement = FakeHost;

    const url = new URL("../src/js/components/volume-control.js", import.meta.url);

    url.search = `?test=${Date.now()}-${Math.random()}`;

    try {
        return await import(url.href);
    } finally {
        globalThis.HTMLElement = originalHTMLElement;
    }
}

/**
 * A control with its listeners actually attached.
 *
 * `globalThis` is not an EventTarget in Node, so the one window listener the
 * component takes has to be absorbed. What this buys is the handlers as the
 * component itself wired them, rather than as a test guessed they were wired.
 */
async function createWiredControl() {
    const control = await createControl();
    const originalAdd = globalThis.addEventListener;

    globalThis.addEventListener = () => {};
    try {
        control.addEventListeners();
    } finally {
        globalThis.addEventListener = originalAdd;
    }

    return control;
}

/** A control with `render()` stubbed out, since a fake DOM cannot parse its template. */
async function createControl() {
    const { VolumeControl } = await loadComponent();
    const control = new VolumeControl();

    control.render = () => {};

    return control;
}

// beforetoggle is the only place the component learns the panel moved, and both
// sides move it: the invoker on a click, the browser on Escape or an outside
// press. Whatever moved it, the markup beside it has to end up agreeing.
test("the host and the button follow the popover, whichever side moved it", async () => {
    const control = await createControl();

    control.handleBeforeToggle({ newState: "open" });
    assert.equal(control.hasAttribute("open"), true, "the host should be marked open.");
    assert.equal(control.buttonNode.getAttribute("aria-expanded"), "true");

    control.handleBeforeToggle({ newState: "closed" });
    assert.equal(control.hasAttribute("open"), false);
    assert.equal(control.buttonNode.getAttribute("aria-expanded"), "false", "and told so to a screen reader.");
});

// Placed before the state flips, so the first frame the panel is painted in is
// already the right one.
test("an opening panel is placed before it is painted", async () => {
    const control = await createControl();
    const placed = [];

    control.placePanel = () => placed.push(control.panel.matches(":popover-open"));

    control.handleBeforeToggle({ newState: "open" });
    assert.deepEqual(placed, [false], "placed while the panel had not yet been shown.");

    control.handleBeforeToggle({ newState: "closed" });
    assert.equal(placed.length, 1, "a closing panel needs no placing.");
});

// Page coordinates, so a scroll carries the panel with the footer instead of
// leaving it behind — and the panel's own height and the gap come off it, so
// that nothing depends on a percentage translate resolving against a box the
// popover does not have while it is still display:none. That is what put the
// panel a few pixels out of line with its button on every open.
test("the panel is placed a whole panel and a gap above the button", async () => {
    const control = await createControl();

    globalThis.scrollX = 5;
    globalThis.scrollY = 30;
    globalThis.getComputedStyle = () => ({
        height: `${PANEL_HEIGHT}px`,
        getPropertyValue: (name) => (name === "--volume-panel-gap" ? `${PANEL_GAP}px` : ""),
    });
    try {
        control.placePanel();
    } finally {
        globalThis.scrollX = originalScrollX;
        globalThis.scrollY = originalScrollY;
        globalThis.getComputedStyle = originalGetComputedStyle;
    }

    // The button's top is 400, the scroll adds 30, and the panel clears it by
    // its own height and the gap.
    assert.equal(control.panel.style.top, `${400 + 30 - PANEL_HEIGHT - PANEL_GAP}px`);
    assert.equal(control.panel.style.left, "105px", "its leading edge, plus the scroll.");
});

// A browser that tells us nothing must not put the panel somewhere absurd. It
// lands on the button rather than above it, which is wrong but bounded — and it
// cannot happen in a browser that has getComputedStyle at all.
test("a panel whose height cannot be read is still placed on its button", async () => {
    const control = await createControl();

    globalThis.scrollX = 0;
    globalThis.scrollY = 0;
    globalThis.getComputedStyle = undefined;
    try {
        control.placePanel();
    } finally {
        globalThis.scrollX = originalScrollX;
        globalThis.scrollY = originalScrollY;
        globalThis.getComputedStyle = originalGetComputedStyle;
    }

    assert.equal(control.panel.style.top, "400px");
});

// A popover holds its ground while focus walks out of it, so this is one of the
// three dismissals left to the component. The null case is the one that matters:
// focus going nowhere is not a reader leaving, and closing there would shut the
// panel mid-click.
test("only a caret that has actually landed elsewhere closes the panel", async () => {
    const control = await createControl();
    const inside = { name: "the slider" };
    const outside = { name: "the play button" };

    control.contained.add(inside);
    control.panel.showPopover();

    control.handleFocusOut({ relatedTarget: null });
    assert.equal(control.panel.showing, true, "focus going nowhere is not a reader leaving.");

    control.handleFocusOut({ relatedTarget: inside });
    assert.equal(control.panel.showing, true, "nor is focus moving within the control.");

    control.handleFocusOut({ relatedTarget: outside });
    assert.equal(control.panel.showing, false, "a caret that has landed outside is.");
});

// hidePopover throws on a popover that is already hidden, and focus leaves a
// closed control every time the button is tabbed away from.
test("focus leaving a closed control is not a dismissal", async () => {
    const control = await createControl();

    assert.doesNotThrow(() => {
        control.handleFocusOut({ relatedTarget: { name: "somewhere else" } });
    });
    assert.equal(control.panel.calls.hide, 0);
});

// Disabled means another output owns the level, so the panel is closed as well
// as inert — a slider on screen that moves nothing is a control that lies.
test("disabling the control closes an open panel", async () => {
    const control = await createControl();

    control.panel.showPopover();
    control.setAttribute("disabled", "");
    control.syncDisabled();

    assert.equal(control.panel.showing, false, "the panel should not outlive the control's use.");
    assert.equal(control.buttonNode.disabled, true);
    assert.equal(control.sliderNode.disabled, true);
});

test("disabling a control whose panel is already closed does not throw", async () => {
    const control = await createControl();

    control.setAttribute("disabled", "");

    assert.doesNotThrow(() => control.syncDisabled());
    assert.equal(control.panel.calls.hide, 0);
});

// Hiding has to take the panel with it. The subtree stops rendering either way,
// so nothing is left on screen — but the popover stays open underneath, and the
// control comes back open at a place measured for a layout that has since moved.
// The app hides this when a transport cannot carry volume, which is exactly when
// the footer is being rearranged.
test("hiding the control closes an open panel", async () => {
    const control = await createControl();

    control.panel.showPopover();
    control.setAttribute("hidden", "");
    control.attributeChangedCallback("hidden", null, "");

    assert.equal(control.panel.showing, false);

    control.removeAttribute("hidden");
    assert.doesNotThrow(() => control.attributeChangedCallback("hidden", "", null), "and showing it again asks nothing of a closed panel.");
    assert.equal(control.panel.calls.hide, 1);
});

// The level the app is told about, and the level a screen reader is told about,
// both come off this attribute — so a value from storage that is out of range,
// or not a number at all, has to be made safe here rather than trusted.
test("the value is clamped to a level the slider can actually hold", async () => {
    const control = await createControl();

    for (const [given, expected] of [["1.4", "1"], ["-0.2", "0"], ["nonsense", "1"], ["0.5", "0.5"]]) {
        control.syncValue(given);
        assert.equal(control.getAttribute("value"), expected, `${given} should land on ${expected}.`);
    }
});

// The mute glyph is drawn off this attribute rather than off a second piece of
// state, so silence and the slash cannot disagree.
test("silence marks the control muted", async () => {
    const control = await createControl();

    control.syncValue("0");
    assert.equal(control.hasAttribute("muted"), true);

    control.syncValue("0.3");
    assert.equal(control.hasAttribute("muted"), false);
});

// Sign only, and one step per event. The same flick reports a notch of 100, a
// pixel-precise 3, or a trackpad's fractional glide, in three different
// deltaMode units — so a level scaled by the delta would travel a different
// distance on every pointing device a reader owns.
test("a scroll moves the level one step, however hard it was scrolled", async () => {
    const control = await createControl();

    control.syncValue("0.5");

    control.handleWheel({ deltaY: -1, preventDefault() {} });
    assert.equal(control.value, "0.55", "scrolling up raises it.");

    control.handleWheel({ deltaY: 240, preventDefault() {} });
    assert.equal(control.value, "0.5", "and down lowers it, by the same step.");

    control.handleWheel({ deltaY: -0.01, preventDefault() {} });
    assert.equal(control.value, "0.55", "a trackpad's smallest report is still a step.");
});

// The app applies and saves the level off `input`, exactly as it does for a
// drag, so a scrolled change that dispatched nothing would move the slider and
// leave the audio where it was.
test("a scrolled level is announced the way a dragged one is", async () => {
    const control = await createControl();

    control.syncValue("0.5");
    control.handleWheel({ deltaY: -1, preventDefault() {} });

    assert.deepEqual(control.dispatched, ["input", "change"], "the level moved and settled in one event.");
});

// The window is short enough to scroll and the panel sits over it, so one
// gesture would otherwise move the level and the page behind it together.
test("a scroll that moves the level does not also scroll the page", async () => {
    const control = await createControl();
    let prevented = 0;

    control.syncValue("0.5");
    control.handleWheel({ deltaY: -1, preventDefault: () => { prevented += 1; } });

    assert.equal(prevented, 1);
});

// Repeated addition of 0.05 in binary floating point arrives at
// 0.30000000000000004, and this value is written to an attribute and saved as
// text. The arithmetic is done in the slider's own hundredths for that reason.
test("scrolling the range end to end leaves the level a number a reader would write", async () => {
    const control = await createControl();
    const seen = [];

    for (let index = 0; index < 20; index += 1) {
        control.handleWheel({ deltaY: 1, preventDefault() {} });
        seen.push(control.value);
    }

    assert.equal(seen[0], "0.95", "a step down from the default.");
    assert.equal(seen.at(-1), "0", "twenty of them reach silence exactly.");
    for (const value of seen) {
        assert.ok(value.length <= 4, `${value} should be a level, not a floating point artefact.`);
    }
});

// An `input` per notch at an end would have the app applying and saving a level
// that never moved, for as long as the reader keeps scrolling.
test("a scroll at either end of the range says nothing", async () => {
    const control = await createControl();

    control.handleWheel({ deltaY: -1, preventDefault() {} });
    assert.equal(control.value, "1", "there is nothing above the top.");
    assert.deepEqual(control.dispatched, []);

    control.syncValue("0");
    control.handleWheel({ deltaY: 1, preventDefault() {} });
    assert.equal(control.value, "0");
    assert.deepEqual(control.dispatched, [], "nor below silence.");
});

// A wheel event with no vertical component is a horizontal gesture, and this
// slider has no horizontal meaning — so it is left to the page rather than
// swallowed by a preventDefault that stops a scroll the reader did want.
test("a purely sideways scroll is not the volume's to take", async () => {
    const control = await createControl();
    let prevented = 0;

    control.handleWheel({ deltaY: 0, deltaX: 40, preventDefault: () => { prevented += 1; } });

    assert.equal(prevented, 0);
    assert.deepEqual(control.dispatched, []);
});

// The same rule the slider and the button follow: when another output owns the
// level, nothing here moves it.
test("a disabled control does not scroll", async () => {
    const control = await createControl();

    control.setAttribute("disabled", "");
    control.handleWheel({ deltaY: -1, preventDefault() {} });

    assert.equal(control.value, "1");
    assert.deepEqual(control.dispatched, []);
});

test("the panel is what listens for the scroll, and not passively", async () => {
    const control = await createWiredControl();

    assert.equal(typeof control.panelNode.listeners.get("wheel"), "function", "the whole pill should answer, not just the track.");
    assert.equal(control.panelNode.passive.wheel, false, "a passive listener cannot stop the page scrolling.");
});

// The flag means "this press opened the panel", not the looser "this press came
// from the keyboard". A keyboard press that *closes* it reports the same detail
// of 0, and reading the click alone would leave the flag raised behind it.
// Nothing reads it in that state today — every open arrives through the same
// listener, which sets it afresh — so what this pins is the flag's meaning
// rather than any behaviour a reader could see. The reason it is worth pinning
// is that the toggle handler acts on the flag alone, and would be right to.
test("only a keyboard press that opens the panel arms the focus move", async () => {
    const control = await createWiredControl();
    const click = control.buttonNode.listeners.get("click");

    click({ detail: 0 });
    assert.equal(control._openedByKey, true, "opened from the keyboard.");

    control.panel.showPopover();
    click({ detail: 0 });
    assert.equal(control._openedByKey, false, "the same press closing it arms nothing.");

    control.panel.hidePopover();
    click({ detail: 1 });
    assert.equal(control._openedByKey, false, "and a pointer is already where it wants to be.");
});
