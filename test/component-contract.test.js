import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const COMPONENTS_DIR = new URL("../src/js/components/", import.meta.url);
const REMOTE_CONTROL = new URL("../src/js/remote-playback/control.js", import.meta.url);
const SCRIPT_URL = new URL("../src/js/script.js", import.meta.url);
const INDEX_URL = new URL("../src/index.html", import.meta.url);
const STYLE_URL = new URL("../src/style.css", import.meta.url);

// The app test harness fabricates every element script.js asks for, so a typo
// or a deleted element in index.html passes the whole suite and only fails in a
// browser, on the first click. This is the one check that reads the real markup.
test("every element script.js looks up exists in index.html", async () => {
    const script = await readFile(SCRIPT_URL, "utf8");
    const markup = await readFile(INDEX_URL, "utf8");
    const requiredIds = [...script.matchAll(/getElementById\("([^"]+)"\)/gu)].map(([, id]) => id);

    assert.notEqual(requiredIds.length, 0);

    for (const id of new Set(requiredIds)) {
        assert.match(markup, new RegExp(`id="${id}"`, "u"), `index.html should define #${id}.`);
    }
});

// The loading indicator and the failure notice are the app's only two status
// messages. Both have to reach a screen reader, not just the screen.
test("playback status messages are exposed as live regions", async () => {
    const markup = await readFile(INDEX_URL, "utf8");

    for (const id of ["trackLoading", "playbackError"]) {
        assert.match(
            markup,
            new RegExp(`<p id="${id}"[^>]*role="status"`, "u"),
            `#${id} should be announced as a status message.`,
        );
    }
});

// These two numbers live in different files but are one decision. The h1's
// accessible text only settles when the title animation ends, so an indicator
// that appeared sooner would announce "Loading soundscape" before the name of
// the track it refers to.
test("the loading indicator waits for the title change to settle", async () => {
    const script = await readFile(SCRIPT_URL, "utf8");
    const styles = await readFile(STYLE_URL, "utf8");
    const delayMs = Number(/LOADING_INDICATOR_DELAY_MS = (\d+)/u.exec(script)?.[1]);
    const animationSeconds = Number(/track-title-current-out ([\d.]+)s/u.exec(styles)?.[1]);

    assert.ok(Number.isFinite(delayMs), "script.js should define LOADING_INDICATOR_DELAY_MS.");
    assert.ok(Number.isFinite(animationSeconds), "style.css should define the title change animation.");
    assert.ok(
        delayMs >= animationSeconds * 1000,
        `The ${delayMs}ms indicator delay should not precede the ${animationSeconds * 1000}ms title change.`,
    );
});

// The connection states are written twice in one file — once as the names the
// logic sets, once as the attribute selectors that style them — and a rename
// that reached only one would leave a control whose glyph silently stops
// changing. Nothing at runtime would fail; the button would just look idle
// through a whole cast.
test("the remote control's connection states match its own stylesheet", async () => {
    const source = await readFile(REMOTE_CONTROL, "utf8");
    // The label map is the vocabulary: setConnection indexes it by the name it
    // computes, so a state missing from it has no label at all.
    const labels = /const BUTTON_LABEL_BY_STATE = \{([^}]+)\}/u.exec(source)?.[1];

    assert.ok(labels, "control.js should define BUTTON_LABEL_BY_STATE.");

    const states = [...labels.matchAll(/^\s{4}(\w+):/gmu)].map(([, state]) => state);
    const styled = new Set(
        [...source.matchAll(/data-remote-state="([^"]+)"\]/gu)].map(([, state]) => state),
    );

    assert.deepEqual(states, ["idle", "connecting", "connected"]);

    for (const state of styled) {
        assert.ok(states.includes(state), `The stylesheet styles an unknown state: ${state}.`);
    }

    // Idle is the base state and needs no rule of its own; the other two are the
    // entire visible difference a connection makes.
    for (const state of ["connecting", "connected"]) {
        assert.ok(styled.has(state), `The stylesheet should give "${state}" an appearance.`);
    }

    // The busy pulse borrows the connecting appearance rather than inventing a
    // second one, so its attribute has to be styled as well as set.
    assert.match(source, /dataset\.remoteBusy = "true"/u);
    assert.match(source, /button\[data-remote-busy\]/u);

    // @keyframes is not a style rule, so it cannot live inside @scope — and an
    // animation naming keyframes that were scoped away simply never runs.
    const animation = /animation:\s*([\w-]+)\s/u.exec(source)?.[1];

    assert.ok(animation, "The connecting pulse should name its keyframes.");
    assert.match(source, new RegExp(`@keyframes ${animation}\\b`, "u"));
});

// The control's announcement moved out of index.html and into the component, so
// the markup check above can no longer see it.
test("the remote control announces itself as a live region", async () => {
    const source = await readFile(REMOTE_CONTROL, "utf8");

    assert.match(source, /<p role="status">/u);
});

// The remote control is named explicitly because it is the one app element that
// does not live in js/components/ — it belongs to the remote playback feature and
// is deleted with it. Discovering elements by directory alone would quietly stop
// covering it the moment it moved, which is exactly what happened.
test("app-owned custom elements keep styles in light DOM @scope blocks", async () => {
    const componentFiles = (await readdir(COMPONENTS_DIR))
        .filter((fileName) => fileName.endsWith(".js"))
        .map((fileName) => [fileName, new URL(fileName, COMPONENTS_DIR)]);
    const elements = [...componentFiles, ["remote-playback/control.js", REMOTE_CONTROL]];

    assert.ok(componentFiles.length >= 3, "the components directory stopped being discovered");

    for (const [name, url] of elements) {
        const source = await readFile(url, "utf8");

        assert.match(source, /@scope\s*\(/, `${name} should scope component-local styles.`);
        assert.doesNotMatch(source, /attachShadow\s*\(/, `${name} should use light DOM.`);
    }
});

// What app-menu's pointer handling cost, and what it was replaced by. Two bugs
// the browser showed and no unit test could, and then the hover that caused a
// third; the answer every time was to hand back to the platform a part this
// file was settling itself. There is no browser suite in CI, so these read the
// source and name the shape that has to stay — a poor substitute for driving
// the thing, and better than nothing.
const APP_MENU = new URL("app-menu.js", COMPONENTS_DIR);

// Dismissal is the browser's. A press outside, Escape, focus handed back and
// the top layer all come with `popover`, and every one of them was a bug here
// while the component did it by hand: a document-wide pointerdown listener that
// shut the panel mid-click, and a deferred activeElement check that could not
// tell a reader leaving from a label passing focus to its own radio.
test("the menu panel is a popover the browser dismisses", async () => {
    const source = await readFile(APP_MENU, "utf8");

    assert.match(source, /class="menu-panel" popover/u, "the panel should be a popover.");
    assert.match(source, /popovertarget=/u, "the button should toggle it as its invoker.");
    assert.doesNotMatch(
        source,
        /document\.addEventListener\(\s*"pointer/u,
        "an outside press is the browser's to dismiss, not a document listener's."
    );
    assert.doesNotMatch(
        source,
        /document\.activeElement/u,
        "nothing here should read the document to work out whether to close."
    );
});

// :focus-within counts the toggle button, and clicking a button leaves it
// focused — so the menu stayed painted open over the page, taking pointer
// events, with its own icon transparent underneath, until something else took
// the focus. Whether the panel is showing is now the popover's own state, so
// the paint asks that rather than a proxy for it.
test("the menu button follows the panel's own open state, not focus", async () => {
    const source = await readFile(APP_MENU, "utf8");

    assert.doesNotMatch(
        source,
        /:scope:focus-within/u,
        "focus on the toggle button should not stand in for the panel being open."
    );
    assert.match(source, /:scope:has\(\.menu-panel:popover-open\)/u);
});

// The menu opened on hover as well as on click for a while, and every problem
// it caused was the same problem: a pointer that has not moved is reported as
// having left whenever something repaints under it, and a theme change — picked
// from inside this very menu — is exactly that. The panel shut under the reader
// mid-use. What replaced it is nothing at all: the invoker opens it, the browser
// closes it, and no pointer state is kept here to go wrong.
test("the menu opens on click alone, with no pointer state of its own", async () => {
    const source = await readFile(APP_MENU, "utf8");

    for (const listener of ["pointerenter", "pointerleave", "pointerdown"]) {
        assert.doesNotMatch(
            source,
            new RegExp(`addEventListener\\(\\s*"${listener}"`, "u"),
            `${listener} is hover machinery; opening belongs to the invoker.`,
        );
    }
    assert.doesNotMatch(source, /setTimeout/u, "no wait decides whether the panel is open.");
});

// The one CSS declaration in this component that has to sit in exactly one rule.
// A closed popover is display:none by the UA stylesheet, and any author
// declaration outranks that whatever its specificity — so a `display` in the
// base .menu-panel rule leaves the panel laid out and its controls tabbable
// while it is nominally shut, invisible at opacity 0 over the header. The
// component says as much in a comment; this is the half that fails if someone
// tidies the two rules together anyway.
test("the menu panel declares display only while it is open", async () => {
    const source = await readFile(APP_MENU, "utf8");
    const base = source.slice(
        source.indexOf(".menu-panel {"),
        source.indexOf(".menu-panel:popover-open {"),
    );

    assert.ok(base.length > 0, "the two panel rules should both still be there.");
    assert.doesNotMatch(
        base,
        /^\s*display:/mu,
        "a display in the base rule outranks the UA's display:none and unhides a closed panel.",
    );
    assert.match(
        source,
        /\.menu-panel:popover-open \{[^}]*display: grid;/u,
        "the open rule is where display belongs.",
    );
});

// The same shape, in the other component built the same way, and the same
// answer to it. Dismissal is the browser's here too; what the conversion took
// away was a document-wide pointerdown listener that blurred
// `document.activeElement` by hand to force the panel shut.
//
// It opens on a click alone for the same reason the menu does. Resting on the
// speaker used to reveal it and cost nothing, because that reveal was pure CSS
// `:hover` and a repaint under a still pointer merely re-evaluates it — but a
// popover cannot be opened from CSS at all, so keeping the hover would have
// meant this file owning whether the pointer is still there, which is the one
// question no version of this has ever answered correctly.
const VOLUME_CONTROL = new URL("volume-control.js", COMPONENTS_DIR);

test("the volume panel is a popover the browser dismisses", async () => {
    const source = await readFile(VOLUME_CONTROL, "utf8");

    assert.match(source, /class="volume-panel" popover/u, "the panel should be a popover.");
    assert.match(source, /popovertarget=/u, "the button should toggle it as its invoker.");
    assert.match(
        source,
        /:scope:has\(\.volume-panel:popover-open\)/u,
        "the paint should ask the panel's own state rather than a proxy for it."
    );
    assert.doesNotMatch(
        source,
        /document\.addEventListener\(\s*"pointer/u,
        "an outside press is the browser's to dismiss, not a document listener's."
    );
    assert.doesNotMatch(
        source,
        /document\.activeElement/u,
        "nothing here should read the document to work out whether to close."
    );
});

test("the volume control opens on click alone, with no pointer state of its own", async () => {
    const source = await readFile(VOLUME_CONTROL, "utf8");

    for (const listener of ["pointerenter", "pointerleave", "pointerdown"]) {
        assert.doesNotMatch(
            source,
            new RegExp(`addEventListener\\(\\s*"${listener}"`, "u"),
            `${listener} is hover machinery; opening belongs to the invoker.`,
        );
    }
    assert.doesNotMatch(source, /setTimeout/u, "no wait decides whether the panel is open.");
});

// Neither invoker has a hover state, and the reason outlives the hover-opening
// that first prompted it: both light to --color-text while their panel is open,
// so a button that also lit under a passing pointer would mean either "open" or
// "the pointer is here" with no way to tell which. A reader glancing at the
// header or the footer can trust the lit one now. Items *inside* a panel are a
// different thing and keep their hovers.
test("neither popover's button lights up merely because a pointer is over it", async () => {
    for (const [name, url] of [["app-menu.js", APP_MENU], ["volume-control.js", VOLUME_CONTROL]]) {
        const source = await readFile(url, "utf8");

        assert.doesNotMatch(
            source,
            /:scope\s*>\s*button:hover/u,
            `${name} should leave the lit button meaning the panel is open, and nothing else.`,
        );
    }
});

// The button and the panel are two objects, and the open state is colour only.
// They were briefly one pill — the panel its top, the button its cap — which
// asked two boxes to meet exactly on an invisible seam. Everything that went
// wrong there came from the shape being shared: a pixel of misplacement read as
// a broken join, the focus ring had to be drawn in halves that met at the seam,
// the panel's shadow fell across its own cap, and the cap unrolled back into a
// circle in view on every close. A shape that changes under the reader is the
// thing this guards against, so the open state may set colours and nothing else.
test("the volume button keeps its own shape while the panel is open", async () => {
    const source = await readFile(VOLUME_CONTROL, "utf8");
    const openState = source.slice(
        source.indexOf(":scope:has(.volume-panel:popover-open) > button {"),
        source.indexOf(":scope:has(.volume-panel:popover-open) > button {") + 400,
    );
    const rule = openState.slice(0, openState.indexOf("}"));

    assert.ok(rule.length > 0, "the open-state rule should still be there.");
    for (const property of ["border-radius", "border-color", "box-shadow", "width", "height"]) {
        assert.doesNotMatch(
            rule,
            new RegExp(`^\\s*${property}:`, "mu"),
            `${property} reshapes the button; opening should only recolour it.`,
        );
    }
});

// Each panel hangs off its own button by CSS anchor positioning, and nothing in
// script measures anything. Both used to be placed by hand on every open — the
// button measured, page coordinates worked out, a resize listened for, and the
// volume panel's height declared only so script could read it back — which is
// all machinery the platform now does. A browser without anchor positioning
// (Safari before 26) keeps the UA's centred placement instead: a whole, usable
// panel, rather than one pinned to the viewport's corner.
//
// The volume panel opens above its button, never over it: a popover is not
// dismissed by a press inside itself, so a panel covering its own invoker would
// leave a touch screen no way to close it. And no transform moves it — a
// percentage translate reads against a box that is not laid out yet while the
// popover is display:none, and it put the panel a few pixels out of line on
// every open.
test("each panel is anchored to its own button by CSS, with a centred fallback", async () => {
    for (const [name, url, panel] of [
        ["app-menu.js", APP_MENU, "menu-panel"],
        ["volume-control.js", VOLUME_CONTROL, "volume-panel"],
    ]) {
        const source = await readFile(url, "utf8");
        const anchor = source.match(/anchor-name:\s*(--[\w-]+);/u);
        const panelRule = source.slice(source.indexOf(`.${panel} {`), source.indexOf(`.${panel}:popover-open {`));

        assert.ok(anchor, `${name}'s button should name itself as an anchor.`);
        assert.match(panelRule, new RegExp(`position-anchor:\\s*${anchor[1]};`, "u"), `${name}'s panel should hang off that button.`);
        assert.match(panelRule, /position-area:/u, `${name}'s panel should be placed by position-area.`);
        // An older iPad Safari stretched the menu to fill its insets instead of
        // fitting its content, and the fallback sets every inset to zero.
        assert.match(panelRule, /^\s*height:\s*max-content;/mu, `${name}'s panel should size to its content, not its insets.`);
        assert.match(source, /@supports not \(anchor-name:/u, `${name} should fall back where anchor positioning is missing.`);
        assert.doesNotMatch(source, /getBoundingClientRect|"resize"/u, `${name} should measure nothing in script.`);
    }

    const volume = await readFile(VOLUME_CONTROL, "utf8");
    const volumePanel = volume.slice(volume.indexOf(".volume-panel {"), volume.indexOf(".volume-panel:popover-open {"));

    assert.match(volumePanel, /position-area:\s*top\b/u, "the volume panel should open above its button, not over it.");
    // position-area aligns safely by default: a panel taller than the room above
    // the button, as in a very short window, is shifted down over the button.
    assert.match(volumePanel, /align-self:\s*unsafe end;/u, "and stay above it even when there is too little room.");
    assert.doesNotMatch(volumePanel, /transform:/u, "and no transform should move it.");
});

// popovertarget already tells assistive technology whether the panel is
// expanded, in Chrome, Edge, Firefox and Safari. An aria-expanded written into
// the markup would override that live state, and one kept in sync by script is
// a second copy of state the browser already holds.
test("neither popover button keeps its own expanded state", async () => {
    for (const [name, url] of [["app-menu.js", APP_MENU], ["volume-control.js", VOLUME_CONTROL]]) {
        const source = await readFile(url, "utf8");

        assert.doesNotMatch(
            source,
            /aria-expanded="|setAttribute\(\s*"aria-expanded"/u,
            `${name} should leave the expanded state to popovertarget.`,
        );
    }
});

// A range input ignores the wheel on every engine, which is right for one in a
// scrolling form and wrong for one that is the whole of a panel. Two things have
// to hold for it not to become a nuisance: the listener cannot be passive, or
// the page scrolls behind the panel on the same gesture, and the level cannot be
// scaled by the delta, because a notched mouse, a free-spinning one and a
// trackpad report the same flick as wildly different numbers in three different
// deltaMode units.
test("a scroll over the volume panel moves the level, and nothing else", async () => {
    const source = await readFile(VOLUME_CONTROL, "utf8");

    assert.match(
        source,
        /addEventListener\(\s*"wheel",.*?\{\s*passive:\s*false\s*\}\s*\)/su,
        "a passive listener cannot stop the page scrolling with the level.",
    );
    assert.match(source, /event\.preventDefault\(\)/u, "and it should actually stop it.");
    assert.match(source, /Math\.sign\(event\.deltaY\)/u, "the delta's sign is the whole of what a wheel says here.");
});

// The same single-rule `display` the menu has, for the same reason, and worth
// pinning twice because the trap is invisible: a closed popover with a display
// in its base rule stays laid out, and its slider stays tabbable, while the
// panel is nominally shut. `place-items` sitting in the base rule is fine — it
// does nothing until something is a grid.
test("the volume panel declares display only while it is open", async () => {
    const source = await readFile(VOLUME_CONTROL, "utf8");
    const base = source.slice(
        source.indexOf(".volume-panel {"),
        source.indexOf(".volume-panel:popover-open {"),
    );

    assert.ok(base.length > 0, "the two panel rules should both still be there.");
    assert.doesNotMatch(
        base,
        /^\s*display:/mu,
        "a display in the base rule outranks the UA's display:none and unhides a closed panel.",
    );
    assert.match(
        source,
        /\.volume-panel:popover-open \{[^}]*display: grid;/u,
        "the open rule is where display belongs.",
    );
});

// A theme change is animated once, for the whole surface, by a view transition:
// the browser holds a still picture of the old colours and cross-fades the new
// ones over it. What must not happen is every element easing its own colours
// through the swap — they arrive out of step, and each pair of text and ground
// crosses through the middle where the two are the same grey and the words
// vanish. Light and dark here are inverses, so that middle is exactly where the
// contrast goes.
//
// With no browser suite in CI, reading the source is the only thing that can say
// the two halves are still in place.
const THEME_UTILS = new URL("../src/js/theme-utils.js", import.meta.url);

test("a theme change is suppressed element by element and animated whole", async () => {
    const style = await readFile(STYLE_URL, "utf8");
    const utils = await readFile(THEME_UTILS, "utf8");

    assert.match(
        style,
        /:root\[data-theme-switching\][\s\S]*?transition: none !important;/u,
        "style.css should stop every element easing its own colours through the swap.",
    );
    assert.match(
        style,
        /::view-transition-old\(root\),\s*::view-transition-new\(root\)/u,
        "style.css should time the cross-fade that animates it instead.",
    );
    assert.match(
        style,
        /::view-transition \{[^}]*pointer-events: none;/u,
        "the overlay should not swallow a click aimed at what is under it.",
    );
    assert.match(utils, /startViewTransition/u, "theme-utils should start the cross-fade.");
    assert.match(
        utils,
        /dataset\[SWITCHING_KEY\] = ""/u,
        "theme-utils should mark the document for the frame the swap happens in.",
    );
});

// --color-change-duration is what a reader's own doing costs: a hover, a focus
// ring, a control lighting up. One timing for all of them, so the controls in a
// row answer at one pace rather than each at its own — and it is 0s under
// prefers-reduced-motion, so no rule has to know the preference. A hardcoded
// duration escapes both.
//
// Declaring a transition replaces it, so a rule that names its motion drops the
// colours by doing so; that is now the intended shape for anything that only
// changes colour with the theme, and this sweep only checks the colour
// transitions that do exist.
const COLOUR_PROPERTIES = ["background-color", "border-color", "box-shadow", "color"];

test("every colour a reader changes fades over --color-change-duration", async () => {
    const sources = [
        ["style.css", await readFile(STYLE_URL, "utf8")],
        ["components/app-menu.js", await readFile(APP_MENU, "utf8")],
        ["components/theme-selector.js", await readFile(new URL("theme-selector.js", COMPONENTS_DIR), "utf8")],
        ["components/volume-control.js", await readFile(VOLUME_CONTROL, "utf8")],
        ["remote-playback/control.js", await readFile(REMOTE_CONTROL, "utf8")],
    ];
    let checked = 0;

    for (const [name, source] of sources) {
        for (const [, value] of source.matchAll(/transition:\s*([^;}]+);/gu)) {
            for (const part of value.split(",")) {
                const property = part.trim().split(/\s+/u)[0];
                if (!COLOUR_PROPERTIES.includes(property)) continue;

                checked += 1;
                assert.match(
                    part,
                    /var\(--color-change-duration\)/u,
                    `${name} fades ${property} on a timing of its own.`,
                );
            }
        }
    }

    assert.ok(checked > 0, "the sweep should have found colour transitions to check.");
});

test("--color-change-duration is defined once and zeroed for reduced motion", async () => {
    const style = await readFile(STYLE_URL, "utf8");
    const definitions = [...style.matchAll(/--color-change-duration:\s*([^;]+);/gu)].map(([, value]) => value.trim());

    assert.deepEqual(definitions, ["0.18s", "0s"]);
    assert.match(
        style,
        /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*--color-change-duration:\s*0s;/u,
        "the zero should be the reduced-motion override.",
    );
});
