export const THEME_STORAGE_KEY = "soundscape.themePreference";
export const DEFAULT_THEME = "system";

export function normalizeThemePreference(value) {
    return ["system", "light", "dark"].includes(value) ? value : DEFAULT_THEME;
}

export function applyThemePreference(value, root = document.documentElement) {
    const theme = normalizeThemePreference(value);

    if (theme === "system") {
        delete root.dataset.theme;
    } else {
        root.dataset.theme = theme;
    }
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
