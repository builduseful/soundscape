import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const VERSION_RE = /const\s+VERSION\s*=\s*"([^"]+)"/;

describe("version sync", () => {
    it("sw.js VERSION matches package.json", async () => {
        const [sw, pkg] = await Promise.all([
            readFile(new URL("../src/sw.js", import.meta.url), "utf8"),
            readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        ]);

        const match = VERSION_RE.exec(sw);
        assert.ok(match, "sw.js should declare a top-level VERSION constant");
        assert.equal(match[1], pkg.version, "sw.js and package.json versions must stay in sync");
    });

    it("script.js VERSION matches package.json", async () => {
        const [script, pkg] = await Promise.all([
            readFile(new URL("../src/js/script.js", import.meta.url), "utf8"),
            readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        ]);

        const match = VERSION_RE.exec(script);
        assert.ok(match, "script.js should declare a top-level VERSION constant");
        assert.equal(match[1], pkg.version, "script.js and package.json versions must stay in sync");
    });

    // Generated, not hand-edited, so a bump leaves it behind until someone runs
    // npm install --package-lock-only. A stale lock resolves the same
    // dependencies, but the next npm install commits a version diff nobody asked for.
    it("package-lock.json records the same version, in both places it names one", async () => {
        const [lock, pkg] = await Promise.all([
            readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
            readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
        ]);

        assert.equal(lock.version, pkg.version, "the lock's top-level version must stay in sync");
        assert.equal(lock.packages[""].version, pkg.version, "and so must the root package entry's");
    });
});
