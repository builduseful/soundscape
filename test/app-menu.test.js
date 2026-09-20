import assert from "node:assert/strict";
import { test } from "node:test";

import { loadComponent } from "./helpers/popover-fakes.js";

/**
 * The header menu's logic, tested against a DOM stand-in.
 *
 * What the platform leaves to this component was only ever checked by opening a
 * browser and looking — which is not a check that runs, and CI has no browser
 * suite. The browser opens, dismisses and places the panel; what is left here
 * is opening or closing it when asked, and closing it when focus leaves.
 *
 * The markup and CSS `render()` writes are not covered here, because a fake DOM
 * that parsed HTML would be a browser. That half is checked as source by
 * component-contract.test.js, the same split `remote-playback-control.test.js`
 * uses and for the same reason.
 */

/** A menu with `render()` stubbed out, since a fake DOM cannot parse its template. */
async function createMenu() {
    const { AppMenu } = await loadComponent("app-menu.js");
    const menu = new AppMenu();

    menu.render = () => {};

    return menu;
}

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

// showPopover also throws on an element that is not in the document, and the
// setter is reachable before connectedCallback has put one there. The guard is
// what lets a caller set `open` without first knowing whether the menu has been
// connected yet.
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

    menu.listeners.get("focusout")({ relatedTarget: null });
    assert.equal(menu.open, true, "focus going nowhere is not a reader leaving.");

    menu.listeners.get("focusout")({ relatedTarget: inside });
    assert.equal(menu.open, true, "nor is focus moving within the menu.");

    menu.listeners.get("focusout")({ relatedTarget: outside });
    assert.equal(menu.open, false, "a caret that has landed outside is.");
});

// hidePopover throws on a popover that is already hidden, and focus leaves a
// closed menu every time the button is tabbed away from.
test("focus leaving a closed menu is not a dismissal", async () => {
    const menu = await createMenu();

    assert.doesNotThrow(() => menu.listeners.get("focusout")({ relatedTarget: { name: "the play button" } }));
    assert.equal(menu.panel.calls.hide, 0);
});
