import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const COMPONENTS_DIR = new URL("../src/js/components/", import.meta.url);

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
