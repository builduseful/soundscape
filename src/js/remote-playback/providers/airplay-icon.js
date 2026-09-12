/**
 * The AirPlay mark.
 *
 * Drawn here rather than taken from Apple: the glyph ships in SF Symbols, whose
 * licence covers interfaces running on Apple's own operating systems, and a web
 * page is not one. So it is the system silhouette in the app's own line weight —
 * the *audio* one, a beam pointing into arcs, because the video mark is a screen
 * and would read as the Cast glyph at 22px.
 *
 * The arcs share one centre, at (12, 13) just above the beam's tip, with radii
 * in Apple's ratio and the same sweep either side. Drawing them from two centres
 * is the easy mistake and shows as a gap that pinches towards the ends.
 *
 * Two numbers came from looking rather than from reasoning: the arcs have to be
 * short and close to the beam, and the stroke heavier than the 1.6 the app's
 * other line icons use. Widen or thin either and it becomes a wifi symbol.
 */

const AIRPLAY_GLYPH = /* html */ `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"
         fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <path d="M6.75 10.09a6 6 0 0 1 10.5 0"></path>
        <path d="M9.25 11.47a3.15 3.15 0 0 1 5.5 0"></path>
        <path d="M12 13.4l6 6.6H6z" fill="currentColor"></path>
    </svg>
`;

/**
 * One drawing for both states, unlike the Cast pair.
 *
 * Apple ships a single AirPlay symbol and says a session is live by recolouring
 * it — `AVRoutePickerView` has an `activeTintColor` and no second glyph. The
 * control recolours a connected button already, so hollowing the beam for idle
 * would only leave the app's usual state wearing a mark that is not quite
 * Apple's.
 */
export const AIRPLAY_ICON = {
    idle: AIRPLAY_GLYPH,
    connected: AIRPLAY_GLYPH,
};
