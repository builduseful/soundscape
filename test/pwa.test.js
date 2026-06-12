import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import { registerServiceWorker } from "../src/pwa.js";
import { tracks } from "../src/tracks.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});

test("registerServiceWorker installs offline support when service workers are available", () => {
    const registrations = [];
    const serviceWorker = {
        register(url) {
            registrations.push(url);
            return Promise.resolve();
        },
    };

    assert.equal(registerServiceWorker({
        location: { protocol: "https:" },
        serviceWorker,
    }), true);
    assert.deepEqual(registrations, ["./sw.js"]);
});

test("registerServiceWorker skips unsupported and file protocol contexts", () => {
    assert.equal(registerServiceWorker({
        location: { protocol: "https:" },
        serviceWorker: undefined,
    }), false);
    assert.equal(registerServiceWorker({
        location: { protocol: "file:" },
        serviceWorker: { register() {} },
    }), false);
});

test("registerServiceWorker reports registration failures without crashing the app", async () => {
    const warnings = [];

    console.warn = (...args) => {
        warnings.push(args);
    };

    assert.equal(registerServiceWorker({
        location: { protocol: "https:" },
        serviceWorker: {
            register() {
                return Promise.reject(new Error("Registration failed"));
            },
        },
    }), true);

    await Promise.resolve();

    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /offline support could not be installed/);
});

test("manifest exposes an installable standalone app with any and maskable icons", async () => {
    const source = await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8");
    const manifest = JSON.parse(source);

    assert.equal(manifest.name, "Soundscape");
    assert.equal(manifest.start_url, "./");
    assert.equal(manifest.scope, "./");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.orientation, undefined);
    assert.equal(manifest.background_color, "#111111");
    assert.equal(manifest.theme_color, "#111111");
    assert.ok(manifest.icons.some((icon) => icon.type === "image/png" && icon.sizes === "192x192"));
    assert.ok(manifest.icons.some((icon) => icon.type === "image/png" && icon.sizes === "512x512"));
    assert.ok(manifest.icons.some((icon) => icon.src === "resources/icons/maskable-icon-512.png" && icon.purpose === "maskable"));
    assert.ok(manifest.icons.some((icon) => icon.purpose === "any"));
    assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("HTML exposes SVG and PNG favicon fallbacks", async () => {
    const source = await readFile(new URL("../index.html", import.meta.url), "utf8");

    assert.match(source, /<link rel="icon" href="resources\/icons\/icon\.svg" type="image\/svg\+xml" \/>/);
    assert.match(source, /<link rel="icon" href="resources\/icons\/favicon-32\.png" sizes="32x32" type="image\/png" \/>/);
    assert.match(source, /<link rel="icon" href="resources\/icons\/favicon-16\.png" sizes="16x16" type="image\/png" \/>/);
    assert.match(source, /<link rel="apple-touch-icon" href="resources\/icons\/apple-touch-icon\.png" \/>/);
});

test("service worker precaches every cataloged soundscape and handles byte ranges", async () => {
    const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");

    for (const track of tracks) {
        assert.match(source, new RegExp(escapeRegExp(`./${track.url}`)));
    }

    assert.match(source, /request\.headers\.has\("range"\)/);
    assert.match(source, /response\.ok\s*&&\s*response\.status\s*===\s*200/);
    assert.match(source, /cacheKey/);
    assert.match(source, /favicon-16\.png/);
    assert.match(source, /favicon-32\.png/);
    assert.match(source, /if \(!response\.ok\) return response/);
    assert.match(source, /status:\s*206/);
    assert.match(source, /Content-Range/);
});

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
