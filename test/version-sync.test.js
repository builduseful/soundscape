import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const VERSION_RE = /const\s+VERSION\s*=\s*"([^"]+)"/;

describe("version sync", () => {
    it("sw.js VERSION matches package.json", async () => {
        const [sw, pkg] = await Promise.all([
            readFile(new URL("../sw.js", import.meta.url), "utf8"),
            readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        ]);

        const match = VERSION_RE.exec(sw);
        assert.ok(match, "sw.js should declare a top-level VERSION constant");
        assert.equal(match[1], pkg.version, "sw.js and package.json versions must stay in sync");
    });

    it("script.js VERSION matches package.json", async () => {
        const [script, pkg] = await Promise.all([
            readFile(new URL("../script.js", import.meta.url), "utf8"),
            readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        ]);

        const match = VERSION_RE.exec(script);
        assert.ok(match, "script.js should declare a top-level VERSION constant");
        assert.equal(match[1], pkg.version, "script.js and package.json versions must stay in sync");
    });
});
