import assert from "node:assert/strict";
import { test } from "node:test";

import { loadComponent } from "./helpers/popover-fakes.js";

/**
 * The volume control's logic, tested against a DOM stand-in.
 *
 * The same split, and the same reason, as `app-menu.test.js`. The browser
 * opens, dismisses and places the panel; what is left here is closing it when
 * focus leaves or the control is disabled or hidden, the level, and the scroll.
 *
 * Every one of those closes calls `hidePopover`, which throws on a popover that
 * is already hidden, so the guard in front of each is under test as much as the
 * close itself.
 *
 * The markup and CSS `render()` writes are not covered here, because a fake DOM
 * that parsed HTML would be a browser. That half is checked as source by
 * component-contract.test.js.
 */

/** A control with its listeners actually attached, as the component wires them. */
async function createWiredControl() {
    const control = await createControl();

    control.addEventListeners();

    return control;
}

/** A control with `render()` stubbed out, since a fake DOM cannot parse its template. */
async function createControl() {
    const { VolumeControl } = await loadComponent("volume-control.js");
    const control = new VolumeControl();

    control.render = () => {};

    return control;
}

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

    control.listeners.get("focusout")({ relatedTarget: null });
    assert.equal(control.panel.showing, true, "focus going nowhere is not a reader leaving.");

    control.listeners.get("focusout")({ relatedTarget: inside });
    assert.equal(control.panel.showing, true, "nor is focus moving within the control.");

    control.listeners.get("focusout")({ relatedTarget: outside });
    assert.equal(control.panel.showing, false, "a caret that has landed outside is.");
});

// hidePopover throws on a popover that is already hidden, and focus leaves a
// closed control every time the button is tabbed away from.
test("focus leaving a closed control is not a dismissal", async () => {
    const control = await createControl();

    assert.doesNotThrow(() => control.listeners.get("focusout")({ relatedTarget: { name: "somewhere else" } }));
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
// control would come back with its panel already up. The app hides this when a
// transport cannot carry volume, which is not a moment anyone asked for a slider.
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

// What the flag is for. A panel opened from the keyboard has to hand the caret
// on to the slider, or a reader who pressed Enter is left on the button with the
// control they asked for open and unreachable except by tabbing into it. Read on
// toggle rather than on the press, because the popover is display:none until the
// state flips and a hidden slider cannot take focus.
test("a panel opened from the keyboard hands focus to the slider", async () => {
    const control = await createWiredControl();

    control.buttonNode.listeners.get("click")({ detail: 0 });
    control.panelNode.listeners.get("toggle")({ newState: "open" });

    assert.equal(control.sliderNode.focused, 1, "the slider should be where the caret lands.");
    assert.equal(control._openedByKey, false, "and the flag is spent, not left armed.");
});

// A pointer is already where it wants to be, and the close has nothing to focus.
// Both arrive as the same toggle event, so the handler cannot read the event alone.
test("a panel opened by pointer, or closing, moves no focus", async () => {
    const control = await createWiredControl();

    control.buttonNode.listeners.get("click")({ detail: 1 });
    control.panelNode.listeners.get("toggle")({ newState: "open" });
    assert.equal(control.sliderNode.focused, 0, "a pointer open pulls no focus.");

    control.buttonNode.listeners.get("click")({ detail: 0 });
    control.panelNode.listeners.get("toggle")({ newState: "closed" });
    assert.equal(control.sliderNode.focused, 0, "and a close is not an open.");
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
