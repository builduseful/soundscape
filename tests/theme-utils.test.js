import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    applyThemePreference,
    DEFAULT_THEME,
    loadThemePreference,
    normalizeThemePreference,
    saveThemePreference,
    THEME_STORAGE_KEY,
    watchSystemTheme,
} from "../src/js/theme-utils.js";

const originalConsoleWarn = console.warn;
const originalLocalStorage = globalThis.localStorage;
const originalMatchMedia = globalThis.matchMedia;

afterEach(() => {
    console.warn = originalConsoleWarn;
    globalThis.localStorage = originalLocalStorage;
    globalThis.matchMedia = originalMatchMedia;
});

/**
 * A stand-in root that records what is written to its dataset, in order.
 *
 * The order is the point: the mark has to be on the document *before* the theme
 * lands on it and off again after, or a colour eases from the old theme to the
 * new one on its own.
 */
function recordingRoot() {
    const writes = [];
    const dataset = new Proxy({}, {
        set(target, key, value) {
            writes.push(`set ${String(key)}`);
            target[key] = value;
            return true;
        },
        deleteProperty(target, key) {
            writes.push(`delete ${String(key)}`);
            delete target[key];
            return true;
        },
    });

    return { root: { dataset }, writes };
}

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

// The theme lands under a mark that suppresses every colour transition, so the
// change is animated once — by the cross-fade in style.css — rather than by
// every element easing its own colours out of step with the rest.
test("the theme is swapped under a mark that suppresses colour transitions", () => {
    const { root, writes } = recordingRoot();

    applyThemePreference("dark", root);

    assert.deepEqual(writes, ["set themeSwitching", "set theme", "delete themeSwitching"]);
    assert.equal(root.dataset.theme, "dark");
});

// Starting a second transition for the same theme would abort the fade already
// running and cross-fade the new colours with themselves — the reader picks a
// theme and sees nothing happen. What is compared is the request, not the
// document: the swap happens a frame later, so a document read at the moment an
// echo arrives still says what it said before.
test("asking again for the theme already asked for does nothing", () => {
    const { root } = recordingRoot();

    applyThemePreference("dark", root);
    root.dataset.theme = "light";
    applyThemePreference("dark", root);

    assert.equal(root.dataset.theme, "light");
});

// On `system` the operating system can change the colours without passing
// through applyThemePreference at all. It repaints on its own; what this adds is
// the mark, so the controls that fade a colour do not each ease there
// separately.
test("watchSystemTheme marks a theme change nobody here chose", () => {
    const listeners = [];
    globalThis.matchMedia = () => ({
        matches: false,
        addEventListener(type, listener) {
            listeners.push(listener);
        },
        removeEventListener(type, listener) {
            listeners.splice(listeners.indexOf(listener), 1);
        },
    });

    const { root, writes } = recordingRoot();
    const stop = watchSystemTheme(root);

    assert.equal(listeners.length, 1);
    listeners[0]();
    assert.deepEqual(writes, ["set themeSwitching", "delete themeSwitching"]);

    stop();
    assert.equal(listeners.length, 0);
});

// Safari before 14 gave a MediaQueryList no addEventListener. Booting is worth
// more than the mark.
test("watchSystemTheme tolerates a browser it cannot listen to", () => {
    globalThis.matchMedia = () => ({ matches: false });

    assert.doesNotThrow(() => watchSystemTheme({ dataset: {} })());

    delete globalThis.matchMedia;

    assert.doesNotThrow(() => watchSystemTheme({ dataset: {} })());
});
