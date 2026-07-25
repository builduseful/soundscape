import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, test } from "node:test";

import { registerLaunchQueueConsumer, registerServiceWorker } from "../src/js/pwa.js";
import { tracks, trackSlug } from "../src/js/tracks.js";

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

test("registerLaunchQueueConsumer installs the consumer when the Launch Queue API is available", () => {
    const consumers = [];
    const consumer = () => {};

    assert.equal(registerLaunchQueueConsumer(consumer, {
        launchQueue: {
            setConsumer(value) {
                consumers.push(value);
            },
        },
    }), true);
    assert.deepEqual(consumers, [consumer]);
});

test("registerLaunchQueueConsumer degrades gracefully without the Launch Queue API", () => {
    assert.equal(registerLaunchQueueConsumer(() => {}, { launchQueue: undefined }), false);
    assert.equal(registerLaunchQueueConsumer(() => {}, { launchQueue: {} }), false);
    assert.equal(registerLaunchQueueConsumer(null, {
        launchQueue: {
            setConsumer() {
                assert.fail("setConsumer should not be called for an invalid consumer");
            },
        },
    }), false);
});

test("manifest exposes an installable standalone app with any and maskable icons", async () => {
    const source = await readFile(new URL("../src/manifest.webmanifest", import.meta.url), "utf8");
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

test("manifest app shortcuts point at real tracks via ?track= slugs", async () => {
    const source = await readFile(new URL("../src/manifest.webmanifest", import.meta.url), "utf8");
    const manifest = JSON.parse(source);
    const slugs = tracks.map((track) => trackSlug(track));

    assert.ok(Array.isArray(manifest.shortcuts));
    assert.notEqual(manifest.shortcuts.length, 0);

    for (const shortcut of manifest.shortcuts) {
        const slug = new URLSearchParams(new URL(shortcut.url, "https://example.test").search).get("track");

        assert.ok(slug, `Shortcut "${shortcut.name}" should carry a ?track= param`);
        assert.ok(slugs.includes(slug), `Shortcut slug "${slug}" should match a track`);
    }
});

test("HTML exposes SVG and PNG favicon fallbacks", async () => {
    const source = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

    assert.match(source, /<link rel="icon" href="resources\/icons\/icon\.svg" type="image\/svg\+xml" \/>/);
    assert.match(source, /<link rel="icon" href="resources\/icons\/favicon-32\.png" sizes="32x32" type="image\/png" \/>/);
    assert.match(source, /<link rel="icon" href="resources\/icons\/favicon-16\.png" sizes="16x16" type="image\/png" \/>/);
    assert.match(source, /<link rel="apple-touch-icon" href="resources\/icons\/apple-touch-icon\.png" \/>/);
});

test("service worker precaches the app shell and caches audio on demand with sanitized entries and byte-range support", async () => {
    const source = await readFile(new URL("../src/sw.js", import.meta.url), "utf8");

    // The SW does not know about the audio catalog — audio is cached on
    // demand by the same single cache the next time the user plays a track.
    // The audio list lives in src/tracks.js for the app, not for the SW.
    assert.doesNotMatch(source, /\bAUDIO_ASSETS\b/);
    assert.doesNotMatch(source, /\btracks\b\s*=\s*tracks\.map\(/);
    assert.doesNotMatch(source, /\bhashAssets\b/);

    // VERSION is hardcoded (not imported) so a version bump changes sw.js
    // bytes and the browser detects a new SW. An import would break that.
    assert.doesNotMatch(
        source,
        /import\s*\{\s*VERSION\s*\}\s*from\s*["']\.\/src\/version\.js["']/,
    );

    // Single cache, VERSION-keyed, with the app shell precached.
    assert.match(source, /CACHE_NAME\s*=\s*["'`]soundscape-v\$\{VERSION\}/);
    assert.match(source, /APP_SHELL_ASSETS/);
    assert.doesNotMatch(source, /cache\.addAll\(/);
    assert.match(source, /precacheAll\(cache, APP_SHELL_ASSETS\)/);
    // cache: "no-cache" forces If-None-Match revalidation on every install,
    // which is what makes the design host-agnostic (GitHub Pages' 10-minute
    // max-age is irrelevant). If this weakens to "default", the guarantee
    // breaks.
    assert.match(source, /fetch\(new Request\(url,\s*\{\s*cache:\s*["']no-cache["']\s*\}\)\)/);
    assert.match(source, /request\.headers\.has\("range"\)/);
    assert.match(source, /!response\.ok\s*\|\|\s*response\.status\s*!==\s*200/);
    assert.match(source, /headers\.delete\("content-encoding"\)/);
    assert.match(source, /headers\.delete\("vary"\)/);
    assert.match(source, /favicon-16\.png/);
    assert.match(source, /favicon-32\.png/);
    assert.match(source, /if \(!response\.ok\) return response/);
    assert.match(source, /status:\s*206/);
    assert.match(source, /Content-Range/);
});

test("service worker keys non-range cache lookups on the original request", async () => {
    const source = await readFile(new URL("../src/sw.js", import.meta.url), "utf8");
    const match = /async function tryCacheThenFetch\(request\) \{([\s\S]*?)\n\}/.exec(source);

    assert.ok(match, "tryCacheThenFetch function should exist");

    const body = match[1];

    // Look up with the request as-is and `ignoreSearch: true` so cache-busting
    // URLs like `script.js?v=...` don't create duplicate cache entries. No
    // custom key helper — per the Fetch spec, Cache.match keys are URLs only,
    // so the original request is the right key.
    assert.doesNotMatch(body, /cleanCacheKey/);
    assert.match(body, /cache\.match\(request,\s*\{\s*ignoreSearch:\s*true\s*\}\)/);
    assert.match(body, /cacheIfOk\(cache,\s*request,\s*response\)/);
});

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
