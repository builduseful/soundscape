import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { VERSION } from "../src/version.js";

describe("version sync", () => {
    it("src/version.js matches package.json", async () => {
        const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

        assert.equal(VERSION, packageJson.version, "src/version.js and package.json versions must stay in sync");
    });
});
