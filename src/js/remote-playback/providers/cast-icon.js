/**
 * The Google Cast mark.
 *
 * Material Symbols "cast" and "cast_connected", from
 * google/material-design-icons, Apache License 2.0. Verbatim on Material's own
 * 960 grid, recoloured through currentColor and nothing else: Google asks that a
 * Cast button use their template, so a hand-drawn lookalike would take the
 * trademark's recognition without the licence. Replace these from Material too
 * rather than tracing them.
 *
 * Cast, not Chromecast — the same button reaches Nest speakers and Google TV.
 */

function castGlyph(path) {
    return /* html */ `
        <svg viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="${path}"></path>
        </svg>
    `;
}

const CAST = "M480-480Zm320 320H600q0-20-1.5-40t-4.5-40h206v-480H160v46q-20-3-40-4.5T80-680v-40q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160Zm-720 0v-120q50 0 85 35t35 85H80Zm200 0q0-83-58.5-141.5T80-360v-80q117 0 198.5 81.5T360-160h-80Zm160 0q0-75-28.5-140.5t-77-114q-48.5-48.5-114-77T80-520v-80q91 0 171 34.5T391-471q60 60 94.5 140T520-160h-80Z";

const CAST_CONNECTED = "M720-320H575q-7-21-15.5-41.5T542-400h98v-160H413q-29-25-62.5-45T281-640h439v320ZM480-480ZM80-160v-120q50 0 85 35t35 85H80Zm200 0q0-83-58.5-141.5T80-360v-80q117 0 198.5 81.5T360-160h-80Zm160 0q0-75-28.5-140.5t-77-114q-48.5-48.5-114-77T80-520v-80q91 0 171 34.5T391-471q60 60 94.5 140T520-160h-80Zm360 0H600q0-20-1.5-40t-4.5-40h206v-480H160v46q-20-3-40-4.5T80-680v-40q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160Z";

// Google ships the connected state as its own drawing, so it is a swap rather
// than something drawn on top of the idle one.
export const CAST_ICON = {
    idle: castGlyph(CAST),
    connected: castGlyph(CAST_CONNECTED),
};
