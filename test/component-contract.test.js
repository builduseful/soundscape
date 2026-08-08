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

test("app-owned custom elements keep styles in light DOM @scope blocks", async () => {
    const componentFiles = (await readdir(COMPONENTS_DIR))
        .filter((fileName) => fileName.endsWith(".js"));

    assert.notEqual(componentFiles.length, 0);

    for (const fileName of componentFiles) {
        const source = await readFile(new URL(fileName, COMPONENTS_DIR), "utf8");

        assert.match(source, /@scope\s*\(/, `${fileName} should scope component-local styles.`);
        assert.doesNotMatch(source, /attachShadow\s*\(/, `${fileName} should use light DOM.`);
    }
});
