import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    applyThemePreference,
    DEFAULT_THEME,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
    THEME_STORAGE_KEY,
} from "../src/js/theme-utils.js";

const originalConsoleWarn = console.warn;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
    console.warn = originalConsoleWarn;
    globalThis.localStorage = originalLocalStorage;
});

function installStorage(entries = {}) {
    const storage = new Map(Object.entries(entries));

    globalThis.localStorage = {
        getItem(key) {
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        },
    };

    return storage;
}

function captureConsoleWarn() {
    const warnings = [];

    console.warn = (...args) => {
        warnings.push(args);
    };

    return warnings;
}

test("normalizeThemePreference only accepts supported theme values", () => {
    assert.equal(normalizeThemePreference("system"), "system");
    assert.equal(normalizeThemePreference("light"), "light");
    assert.equal(normalizeThemePreference("dark"), "dark");
    assert.equal(normalizeThemePreference("sepia"), DEFAULT_THEME);
    assert.equal(normalizeThemePreference(null), DEFAULT_THEME);
});

test("applyThemePreference writes explicit themes and clears the system override", () => {
    const root = { dataset: {} };

    applyThemePreference("dark", root);
    assert.equal(root.dataset.theme, "dark");

    applyThemePreference("light", root);
    assert.equal(root.dataset.theme, "light");

    applyThemePreference("system", root);
    assert.equal(root.dataset.theme, undefined);
});

test("loadThemePreference normalizes saved values", () => {
    installStorage({ [THEME_STORAGE_KEY]: "dark" });

    assert.equal(loadThemePreference(), "dark");

    installStorage({ [THEME_STORAGE_KEY]: "sepia" });

    assert.equal(loadThemePreference(), DEFAULT_THEME);
});

test("saveThemePreference stores the normalized value", () => {
    const storage = installStorage();

    assert.equal(saveThemePreference("light"), "light");
    assert.equal(storage.get(THEME_STORAGE_KEY), "light");

    assert.equal(saveThemePreference("sepia"), DEFAULT_THEME);
    assert.equal(storage.get(THEME_STORAGE_KEY), DEFAULT_THEME);
});

test("theme preference helpers tolerate storage failures", () => {
    const warnings = captureConsoleWarn();

    globalThis.localStorage = {
        getItem() {
            throw new Error("read failed");
        },
        setItem() {
            throw new Error("write failed");
        },
    };

    assert.equal(loadThemePreference(), DEFAULT_THEME);
    assert.equal(saveThemePreference("dark"), "dark");
    assert.equal(warnings.length, 2);
    assert.match(warnings[0][0], /Could not load soundscape\.themePreference/);
    assert.match(warnings[1][0], /Could not save soundscape\.themePreference/);
});
