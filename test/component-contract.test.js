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
