export const THEME_STORAGE_KEY = "soundscape.themePreference";
export const DEFAULT_THEME = "system";

export function normalizeThemePreference(value) {
    return ["system", "light", "dark"].includes(value) ? value : DEFAULT_THEME;
}

// Marks the document for as long as it takes to put a theme on it, so that not
// one colour eases from the old theme to the new one on its own. Every element
// fading its own colours is two faults at once: they arrive out of step, each at
// whatever duration its own rule named, and each pair of text and ground crosses
// through the middle where the two are the same grey and the words vanish. Light
// and dark here are inverses, so that middle is exactly where the contrast goes.
//
// The swap under this attribute is therefore instant, and the change is animated
// once, over the whole surface, by the cross-fade applyThemePreference starts
// below. A cross-fade of two inverse pictures has a low-contrast instant of its
// own, in the middle, and nothing about the easing or the colour space avoids it
// — a wipe is the only animation that never blends the two. Weigh that again
// rather than rediscover it.
//
// Written through dataset rather than setAttribute so a plain object stands in
// for the root, which is what the unit tests hand this.
const SWITCHING_KEY = "themeSwitching";

// The theme most recently asked for, per root. See applyThemePreference.
const REQUESTED = new WeakMap();

/**
 * Let the new colours land before anything is allowed to animate again.
 * @param {HTMLElement} root - Element carrying the theme attribute.
 */
function settleWithoutTransition(root) {
    // Reading a layout property forces style to be recalculated here, while the
    // suppression is still in force. Without it the attribute could go on and
    // come off inside one recalculation, which is the same as never setting it.
    void root.offsetWidth;

    const done = () => delete root.dataset[SWITCHING_KEY];
    // The unit tests hand this a plain object and no frames ever come.
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(done);
    else done();
}

/**
 * Put a theme on the document, and animate the change as one thing.
 *
 * The swap itself is instant — every colour transition is suppressed while it
 * happens — and the browser then cross-fades it in over a still picture of the
 * old colours, so the whole surface changes together rather than as a hundred
 * rules racing each other.
 * @param {unknown} value - Candidate theme.
 * @param {HTMLElement} [root] - Element carrying the theme attribute.
 */
export function applyThemePreference(value, root = document.documentElement) {
    const theme = normalizeThemePreference(value);

    // Asking for the theme already asked for is not a change, and starting a
    // transition for it would abort the fade already running and cross-fade the
    // new colours with themselves — the reader picks dark and sees nothing
    // happen. What is compared is the request, not the document: the swap
    // happens inside the transition a frame later, so a second call arriving
    // before then would read a document that still says what it said before.
    if (REQUESTED.get(root) === theme) return;
    REQUESTED.set(root, theme);

    const swap = () => {
        root.dataset[SWITCHING_KEY] = "";
        if (theme === "system") delete root.dataset.theme;
        else root.dataset.theme = theme;
        settleWithoutTransition(root);
    };

    // Only once there is a picture to take. At startup the theme goes on before
    // the first paint (index.html does it inline), and a transition there would
    // fade in from an unstyled page. Browsers without view transitions — Firefox
    // among them — fall through to the instant swap, which is the whole change
    // minus its fade.
    const view = root.ownerDocument ?? globalThis.document;
    if (view?.readyState !== "complete" || !view.startViewTransition) return swap();

    const transition = view.startViewTransition(swap);
    // Skipped whenever another begins before this one has finished, or the page
    // is hidden while it runs. The swap still happens either way; only the fade
    // over it is dropped, so these are noise rather than news — but unhandled
    // they surface as page errors.
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
}

/**
 * Do the same for a theme nobody here chose.
 *
 * On `system` the colours follow the operating system, which can change them
 * without passing through this file at all — at sunset, or when the reader flips
 * it themselves. `color-scheme` and `light-dark()` repaint on their own, and the
 * media query tells us in time to mark the document before the new colours are
 * painted, so that swap is instant rather than a scatter of controls easing
 * separately.
 *
 * Instant and nothing more: a chosen theme is cross-faded, but that has to be
 * started around the change that causes it, and here the colours have already
 * moved by the time we are told.
 * @param {HTMLElement} [root] - Element carrying the theme attribute.
 * @returns {() => void} Stops watching.
 */
export function watchSystemTheme(root = document.documentElement) {
    const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
    // Safari before 14 gave a MediaQueryList no addEventListener, only the older
    // addListener. Nothing here is worth failing to boot over: without a way to
    // be told, a system theme change simply goes unmarked and the controls that
    // fade a colour ease their own way there.
    if (typeof query?.addEventListener !== "function") return () => {};

    const listener = () => {
        root.dataset[SWITCHING_KEY] = "";
        settleWithoutTransition(root);
    };

    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
}

export function loadThemePreference() {
    try {
        return normalizeThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
    } catch (error) {
        console.warn(`Could not load ${THEME_STORAGE_KEY}`, error);
        return DEFAULT_THEME;
    }
}

export function saveThemePreference(value) {
    const theme = normalizeThemePreference(value);

    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
        console.warn(`Could not save ${THEME_STORAGE_KEY}`, error);
    }

    return theme;
}
