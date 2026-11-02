import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const COMPONENTS_DIR = new URL("../src/js/components/", import.meta.url);
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

// These two numbers are one decision: a page turned by a key has landed
// before the indicator can appear, so it never shows on a page still moving.
test("the loading indicator waits for a page turn to land", async () => {
    const script = await readFile(SCRIPT_URL, "utf8");
    const delayMs = Number(/LOADING_INDICATOR_DELAY_MS = (\d+)/u.exec(script)?.[1]);
    const turnMs = Number(/SWIPE_MAX_MS = (\d+)/u.exec(script)?.[1]);

    assert.ok(Number.isFinite(delayMs), "script.js should define LOADING_INDICATOR_DELAY_MS.");
    assert.ok(Number.isFinite(turnMs), "script.js should define SWIPE_MAX_MS.");
    assert.ok(delayMs >= turnMs, `The ${delayMs}ms indicator delay should not precede the ${turnMs}ms page turn.`);
});

// Found by directory: every app-owned custom element lives in js/components/.
test("app-owned custom elements keep styles in light DOM @scope blocks", async () => {
    const componentFiles = (await readdir(COMPONENTS_DIR))
        .filter((fileName) => fileName.endsWith(".js"))
        .map((fileName) => [fileName, new URL(fileName, COMPONENTS_DIR)]);
    assert.ok(componentFiles.length >= 3, "the components directory stopped being discovered");

    for (const [name, url] of componentFiles) {
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

// The menu's button has no hover state, and the reason outlives the
// hover-opening that first prompted it: it lights to --color-text while its
// panel is open, so a button that also lit under a passing pointer would mean
// either "open" or "the pointer is here" with no way to tell which. Items
// *inside* the panel are a different thing and keep their hovers.
test("the menu's button does not light up merely because a pointer is over it", async () => {
    const source = await readFile(APP_MENU, "utf8");

    assert.doesNotMatch(
        source,
        /:scope\s*>\s*button:hover/u,
        "the lit button should mean the panel is open, and nothing else.",
    );
});

// The panel hangs off its button by CSS anchor positioning, and nothing in
// script measures anything. It used to be placed by hand on every open — the
// button measured, page coordinates worked out, a resize listened for — which
// is all machinery the platform now does. A browser without anchor positioning
// (Safari before 26) keeps the UA's centred placement instead: a whole, usable
// panel, rather than one pinned to the viewport's corner.
test("the menu panel is anchored to its button by CSS, with a centred fallback", async () => {
    const source = await readFile(APP_MENU, "utf8");
    const anchor = source.match(/anchor-name:\s*(--[\w-]+);/u);
    const panelRule = source.slice(source.indexOf(".menu-panel {"), source.indexOf(".menu-panel:popover-open {"));

    assert.ok(anchor, "the button should name itself as an anchor.");
    assert.match(panelRule, new RegExp(`position-anchor:\\s*${anchor[1]};`, "u"), "the panel should hang off that button.");
    assert.match(panelRule, /position-area:/u, "the panel should be placed by position-area.");
    // An older iPad Safari stretched the menu to fill its insets instead of
    // fitting its content, and the fallback sets every inset to zero.
    assert.match(panelRule, /^\s*height:\s*max-content;/mu, "the panel should size to its content, not its insets.");
    assert.match(source, /@supports not \(anchor-name:/u, "it should fall back where anchor positioning is missing.");
    assert.doesNotMatch(source, /getBoundingClientRect|"resize"/u, "it should measure nothing in script.");
});

// popovertarget already tells assistive technology whether the panel is
// expanded, in Chrome, Edge, Firefox and Safari. An aria-expanded written into
// the markup would override that live state, and one kept in sync by script is
// a second copy of state the browser already holds.
test("the menu's button keeps no expanded state of its own", async () => {
    const source = await readFile(APP_MENU, "utf8");

    assert.doesNotMatch(
        source,
        /aria-expanded="|setAttribute\(\s*"aria-expanded"/u,
        "the expanded state should be left to popovertarget.",
    );
});

// A scroll over the page sets the volume. Two things have to hold for it not to
// become a nuisance: the listener cannot be passive, or it cannot stop the
// browser's own use of the wheel, and the level cannot be scaled by the delta,
// because a notched mouse, a free-spinning one and a trackpad report the same
// flick as wildly different numbers in three different deltaMode units.
test("a scroll over the page moves the level, and nothing else", async () => {
    const source = await readFile(SCRIPT_URL, "utf8");

    assert.match(
        source,
        /addEventListener\(\s*"wheel",.*?\{\s*passive:\s*false\s*\}\s*\)/su,
        "a passive listener cannot stop the page scrolling with the level.",
    );
    assert.match(source, /event\.preventDefault\(\)/u, "and it should actually stop it.");
    assert.match(source, /Math\.sign\(event\.deltaY\)/u, "the delta's sign is the whole of what a wheel says here.");
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
