/**
 * A small drawing of the soundscape playing, above its name: rain from a
 * cloud, a fire, a road running on. One line weight and one colour, like the
 * icon, and moving only while the sound plays.
 *
 * Drawn on a 48-unit square, each scene inside the same 30-unit live area and
 * centred by eye rather than by box. Motion follows the drawing: a slanted
 * streak falls along its slant, a drop leaves a ring where it lands, a road's
 * markings grow and quicken as they near. Timings are kept apart from one
 * another so nothing visibly repeats in step.
 *
 * Paused, it stops where it is, and playing carries on from there. Under
 * reduced motion nothing moves at all.
 *
 * CSS animations of a few strokes, held paused and moved by the drawing's own
 * clock: a frame repaints a few hundred pixels, and a still or hidden one
 * costs nothing.
 *
 * @element track-scene
 * @attr {string} track - The soundscape's id; one without a drawing shows nothing.
 * @attr {boolean} playing - Whether the drawing moves.
 */

// Three true circles, left, crown and right, joined where they cross and
// sat on one flat base, so every join is smooth.
const CLOUD = "<path class=\"cloud\" d=\"M17 26H32.5A5 5 0 0 0 32.35 16 7.5 7.5 0 0 0 17.6 16.05 5 5 0 0 0 17 26Z\"/>";

/**
 * Falling streaks. Each travels along its own direction, so a slanted streak
 * falls on its slant, and fades in below where it starts and out before it
 * ends, so none appears or vanishes whole. The cycle is entered partway, so the
 * still drawing catches its streaks falling rather than not yet begun.
 */
function streaks(list, { length, slant = 0, travel, duration }) {
    const ratio = slant / length;

    return list.map(([x, y, delay]) => "<line class=\"streak\" x1=\"" + x + "\" y1=\"" + y + "\" x2=\"" + (x - slant)
        + "\" y2=\"" + (y + length) + "\" style=\"--dx: " + (-travel * ratio) + "px; --dy: " + travel
        + "px; --duration: " + duration + "s; --delay: " + (delay - 0.45 * duration).toFixed(2) + "s\"/>").join("");
}

// A wave longer than the box, so drifting it one wavelength loops seamlessly;
// a direction of -1 drifts it the other way.
function wave(className, wavelength, amplitude, y, duration, direction = 1) {
    const half = wavelength / 2;
    let path = "M" + -wavelength * 2 + " " + y + "q" + half / 2 + " " + -amplitude * 2 + " " + half + " 0";

    for (let x = -wavelength * 2 + half; x < 48 + wavelength; x += half) path += "t" + half + " 0";

    return "<path class=\"wave " + className + "\" style=\"--wavelength: " + wavelength * direction + "px; --duration: " + duration
        + "s\" d=\"" + path + "\"/>";
}

const BOLT = "<path class=\"bolt\" d=\"M25.6 27.5 22.4 33h4.2L23.4 39\"/>";

const FLAME = "<path class=\"flame\" d=\"M24 37c-4.4 0-7-2.9-7-6.5 0-4.2 3.6-6.6 4.5-11.3 2.4 2.2 3.3 4.6 3.3 6.6 1.2-.9 2.1-2.4 2.4-3.9 2.3 2.3 3.8 5.2 3.8 8.6 0 3.6-2.6 6.5-7 6.5Z\"/>"
    + "<path class=\"flame flame--inner\" d=\"M24 37c-1.8 0-2.9-1.2-2.9-2.8 0-1.7 1.4-3 2.9-4.9 1.5 1.9 2.9 3.2 2.9 4.9 0 1.6-1.1 2.8-2.9 2.8Z\"/>";
const LOGS = "<path d=\"M15.5 41.5 32.5 38M15.5 38l17 3.5\"/>";

function embers(list) {
    return list.map(([x, y, delay]) => "<circle class=\"ember\" cx=\"" + x + "\" cy=\"" + y + "\" r=\".8\" style=\"--delay: "
        + delay + "s\"/>").join("");
}

// The lane's markings, spread along one cycle; still, they lie where a
// photograph would catch them.
const DASHES = [0, -0.65, -1.3, -1.95].map((delay) => "<line class=\"dash\" x1=\"24\" y1=\"20\" x2=\"24\" y2=\"21.4\" style=\"--delay: "
    + delay + "s\"/>").join("");

/**
 * A drop that falls to a surface and the ring it leaves there, kept in step:
 * the ring starts as the drop lands.
 */
function landing(x, from, surface, { duration, delay = 0, rx, ry }) {
    return "<path class=\"drip\" d=\"M" + x + " " + from + "v3\" style=\"--land: " + (surface - from - 3)
        + "px; --duration: " + duration + "s; --delay: " + delay + "s\"/>"
        + "<ellipse class=\"ring\" cx=\"" + x + "\" cy=\"" + surface + "\" rx=\"" + rx + "\" ry=\"" + ry
        + "\" style=\"--duration: " + duration + "s; --delay: " + (delay - 0.42 * duration).toFixed(2) + "s\"/>";
}

// A seedling: a stem and a leaf either side of its tip.
function sprout(x, height, base = 37) {
    const tip = base - height;

    return "<path d=\"M" + x + " " + base + "v" + -height + "\"/>"
        + "<path d=\"M" + x + " " + tip + "c-1.6-.3-2.7-1.5-2.7-3.2 1.7.2 2.7 1.4 2.7 3.2Z\"/>"
        + "<path d=\"M" + x + " " + (tip + 0.8) + "c1.5-.5 2.5-1.7 2.5-3.4-1.6.3-2.5 1.5-2.5 3.4Z\"/>";
}

// A repeatable pseudo-random sequence, so the drawing is the same every time.
function random(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A line of noise made of sine harmonics that repeat every 48 units, so
 * drifting it 48 loops seamlessly. Every harmonic as strong as the next, as in
 * white noise.
 */
function noise({ y, scale, harmonics, seed, duration }) {
    const next = random(seed);
    const phases = Array.from({ length: harmonics }, () => next() * Math.PI * 2);
    let path = "";

    for (let x = -48; x <= 96; x += 0.5) {
        const value = phases.reduce((sum, phase, i) => sum + Math.sin((2 * Math.PI * (i + 1) * x) / 48 + phase), 0);
        path += (path ? "L" : "M") + x + " " + (y + (value / harmonics) * scale).toFixed(2);
    }

    return "<path class=\"wave\" style=\"--wavelength: -48px; --duration: " + duration + "s\" d=\"" + path + "\"/>";
}

const SCENES = {
    // Drops into a puddle, each leaving its ring as it lands.
    "rain": landing(17, 12, 33, { duration: 3, rx: 6, ry: 1.6 }) + landing(30, 14, 35, { duration: 3, delay: -1.1, rx: 7, ry: 1.9 })
        + landing(25, 10, 29, { duration: 3, delay: -2.1, rx: 4.5, ry: 1.2 }),
    "garden-rain": "<path d=\"M12 37h24\"/>" + sprout(17, 4) + sprout(24, 7) + sprout(31, 3)
        + streaks([[14, 8, 0], [20.5, 11, -0.5], [27.5, 7, -1], [34, 12, -0.3]], { length: 3, travel: 7, duration: 1.5 }),
    // Three depths of rain: the far drops small, faint and slow, the near ones
    // long and quick.
    "heavy-rain": "<g mask=\"url(#track-scene-fade-y)\"><g class=\"layer--far\">"
        + streaks([[12, 4, 0], [19, 8, -0.6], [26, 3, -1.2], [33, 7, -0.3], [39, 5, -0.9]],
            { length: 2.5, slant: 0.8, travel: 30, duration: 2.2 })
        + "</g><g class=\"layer--mid\">"
        + streaks([[10, 6, -0.4], [17, 2, -0.1], [24, 7, -0.8], [31, 3, -0.5], [38, 8, -0.2]],
            { length: 4, slant: 1.3, travel: 30, duration: 1.4 })
        + "</g>" + streaks([[14, 3, -0.3], [28, 5, -0.7], [21, 1, -0.05], [36, 2, -0.5]], { length: 6, slant: 2, travel: 30, duration: 0.85 })
        + "</g>",
    "rain-thunder": CLOUD + BOLT + streaks([[18.5, 29, 0], [30.5, 29.5, -0.7]], { length: 3, travel: 6, duration: 1.5 }),
    "heavy-thunderstorm": "<g class=\"storm\">" + CLOUD + "</g>" + BOLT
        + streaks([[16.5, 29, 0], [20, 30.5, -0.4], [29.5, 30.5, -0.2], [33, 29, -0.55]], { length: 5, slant: 1.5, travel: 7, duration: 0.8 }),
    "fireplace": "<g transform=\"translate(0 -3.5)\">" + FLAME + LOGS + embers([[25.5, 16, 0]]) + "</g>",
    // The deep one burns in a hearth, slower.
    "deep-fireplace": "<path d=\"M12 40V24a12 12 0 0 1 24 0v16M9 40h30\"/>"
        + "<g transform=\"translate(2.4 .9) scale(.9)\">" + FLAME + LOGS + "</g>"
        + embers([[22, 19.5, 0], [26, 18.5, -1.4]]),
    // The road runs out between mountains; its edges stop short of them, as
    // the eye loses them there.
    "the-open-road": "<path d=\"M9 20l6-6 3.5 3.5L25 11l9 9h5\"/>"
        + "<path d=\"M13 39 22 21.5M35 39 26 21.5\"/>" + DASHES
        + "<path class=\"lane-still\" d=\"M24 22.5v2M24 27.5v3.5M24 34v5\"/>",
    // Deep and slow: one bold swell between two fainter ones, the lowest
    // running the other way.
    "brown-noise": "<g mask=\"url(#track-scene-fade)\">" + wave("wave--under", 40, 1.4, 19, 14)
        + wave("wave--bold", 34, 2, 25, 11) + wave("wave--under", 30, 1.4, 31, 16, -1) + "</g>",
    // Each layer half the last, as pink noise's power halves with each octave.
    "pink-noise": "<g mask=\"url(#track-scene-fade)\">" + wave("", 22, 3.5, 23, 5.5) + wave("wave--under", 13, 2, 25, 3.7)
        + wave("wave--faint", 8, 1.1, 26.5, 2.3) + "</g>",
    "white-noise": "<g mask=\"url(#track-scene-fade)\">" + noise({ y: 24, scale: 7, harmonics: 40, seed: 5, duration: 3 }) + "</g>",
};

// Fades a wave out at both ends rather than cutting it off, and rain in at
// the top and out at the bottom.
const FADE_MASK = "<defs><linearGradient id=\"track-scene-edge\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\"0\"/>"
    + "<stop offset=\".22\" stop-color=\"#fff\"/><stop offset=\".78\" stop-color=\"#fff\"/>"
    + "<stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient>"
    + "<linearGradient id=\"track-scene-edge-y\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#fff\" stop-opacity=\"0\"/>"
    + "<stop offset=\".25\" stop-color=\"#fff\"/><stop offset=\".75\" stop-color=\"#fff\"/>"
    + "<stop offset=\"1\" stop-color=\"#fff\" stop-opacity=\"0\"/></linearGradient>"
    + "<mask id=\"track-scene-fade\"><rect x=\"7\" y=\"0\" width=\"34\" height=\"48\" stroke=\"none\" fill=\"url(#track-scene-edge)\"/></mask>"
    + "<mask id=\"track-scene-fade-y\" maskUnits=\"userSpaceOnUse\"><rect x=\"0\" y=\"9\" width=\"48\" height=\"31\" stroke=\"none\" "
    + "fill=\"url(#track-scene-edge-y)\"/></mask></defs>";

// The motions are slow, so a step at SCENE_FRAME_RATE reads as smooth, and a
// screen's own rate, 120 a second or more on many, would cost twice the frames
// for nothing seen. A step once three-quarters of one has passed keeps them
// even on any screen: every other frame at 120 Hz, every frame at 60.
const SCENE_FRAME_RATE = 60;
const MIN_STEP_MS = 750 / SCENE_FRAME_RATE;
// Turned on, it takes the motions away; set, a time would bring one back.
const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

export class TrackScene extends HTMLElement {
    static observedAttributes = ["track", "playing"];

    // The drawing's clock, in milliseconds.
    #time = 0;
    #motions = null;
    #last = null;
    #frame = 0;

    connectedCallback() {
        reducedMotion?.addEventListener("change", this.#restyled);
        this.render();
        this.#sync();
    }

    disconnectedCallback() {
        reducedMotion?.removeEventListener("change", this.#restyled);
        cancelAnimationFrame(this.#frame);
        this.#frame = 0;
        this.#last = null;
    }

    attributeChangedCallback(name) {
        if (!this.isConnected) return;
        if (name === "track") this.render();
        this.#sync();
    }

    // Carries on from the moment [other] has reached, so one drawing can take
    // over from the other unseen.
    takeOver(other) {
        const theirs = other.getAnimations({ subtree: true });

        this.#time = other.#time;
        this.getAnimations({ subtree: true }).forEach((animation, index) => {
            if (theirs[index]) animation.currentTime = theirs[index].currentTime;
        });
    }

    // Playing starts and stops it at once, as the sound does.
    #sync() {
        if (this.#moves()) {
            this.#frame ||= requestAnimationFrame((time) => this.#step(time));
        } else {
            cancelAnimationFrame(this.#frame);
            this.#frame = 0;
            this.#last = null;
        }
    }

    #restyled = () => {
        this.#motions = null;
        this.#sync();
    };

    // Found once the drawing's style is in place, and again after each new one.
    #allMotions() {
        this.#motions ??= this.getAnimations({ subtree: true }).filter((animation) => animation.animationName !== "scene-in");
        return this.#motions;
    }

    #moves() {
        return this.hasAttribute("playing") && this.#allMotions().length > 0;
    }

    #step(now) {
        this.#frame = 0;
        if (this.#last === null) {
            this.#last = now;
        } else if (now - this.#last >= MIN_STEP_MS) {
            this.#time += now - this.#last;
            this.#last = now;
            for (const motion of this.#allMotions()) motion.currentTime = this.#time;
        }
        if (this.#moves()) {
            this.#frame = requestAnimationFrame((time) => this.#step(time));
        } else {
            this.#last = null;
        }
    }

    render() {
        const track = this.getAttribute("track") ?? "";

        this.#time = 0;
        this.#motions = null;
        const scene = SCENES[track] ?? "";

        this.innerHTML = /* html */ `
            <style>
                @scope (track-scene) {
                    :scope {
                        color: var(--color-text-muted);
                        display: block;
                        height: 64px;
                        width: 64px;
                    }

                    svg {
                        display: block;
                        fill: none;
                        height: 100%;
                        overflow: visible;
                        stroke: currentColor;
                        stroke-linecap: round;
                        stroke-linejoin: round;
                        stroke-width: 1.5;
                        width: 100%;
                    }

                    .ember {
                        fill: currentColor;
                        stroke: none;
                    }

                    .wave--bold {
                        stroke-width: 2;
                    }

                    /* On the group: a streak's own opacity is its fall's. */
                    .layer--far {
                        opacity: 0.25;
                        stroke-width: 1.1;
                    }

                    .layer--mid {
                        opacity: 0.45;
                    }

                    .wave--under {
                        opacity: 0.45;
                    }

                    .wave--faint {
                        opacity: 0.25;
                    }

                    .dash {
                        stroke-width: 1.3;
                    }

                    /* The storm's cloud is heavy: shaded, not only drawn. */
                    .storm .cloud {
                        fill: color-mix(in srgb, currentColor 14%, transparent);
                    }

                    .ember {
                        opacity: 0;
                    }

                    .lane-still {
                        display: none;
                    }

                    @media (prefers-reduced-motion: reduce) {
                        .dash {
                            display: none;
                        }

                        .lane-still {
                            display: inline;
                        }
                    }

                    @media (prefers-reduced-motion: no-preference) {
                        svg {
                            animation: scene-in 0.5s ease-out both;
                        }

                        /* Every part keeps its motion, held paused: the
                           drawing's clock moves them (see the class), so a
                           pause stops it where it is and play carries on from
                           there. Before it first plays, each shows the first
                           frame of its motion: a moment of it, held. */
                        .streak {
                            animation: fall var(--duration) cubic-bezier(0.4, 0, 0.9, 0.7) var(--delay) infinite paused;
                        }

                        .dash {
                            animation: approach 2.6s cubic-bezier(0.55, 0, 0.9, 0.6) var(--delay) infinite paused;
                            transform-origin: 24px 20px;
                        }

                        .drip {
                            animation: drip var(--duration) cubic-bezier(0.45, 0, 0.9, 0.5) var(--delay) infinite paused;
                        }

                        .ring {
                            animation: ripple var(--duration) cubic-bezier(0.2, 0.6, 0.4, 1) var(--delay) infinite paused;
                            transform-box: fill-box;
                            transform-origin: center;
                        }

                        .bolt {
                            animation: flash 6.5s linear infinite paused;
                        }

                        [data-track="heavy-thunderstorm"] .bolt {
                            animation-duration: 4.3s;
                        }

                        .storm .cloud {
                            animation: glow 4.3s linear infinite paused;
                        }

                        .flame {
                            animation: flicker 2.2s ease-in-out infinite alternate paused;
                            transform-origin: 24px 37px;
                        }

                        .flame--inner {
                            animation-duration: 1.3s;
                            animation-direction: alternate-reverse;
                        }

                        [data-track="deep-fireplace"] .flame {
                            animation-duration: 3.1s;
                        }

                        [data-track="deep-fireplace"] .flame--inner {
                            animation-duration: 1.9s;
                        }

                        .ember {
                            animation: rise 3.4s ease-out var(--delay) infinite paused;
                        }

                        .wave {
                            animation: drift var(--duration) linear infinite paused;
                        }
                    }

                    @keyframes scene-in {
                        from { opacity: 0; transform: translateY(2px); }
                    }

                    @keyframes fall {
                        0% { opacity: 0; transform: translate(0, 0); }
                        25% { opacity: 1; }
                        65% { opacity: 1; }
                        100% { opacity: 0; transform: translate(var(--dx), var(--dy)); }
                    }

                    /* Down to its surface, and gone as it lands. */
                    @keyframes drip {
                        0% { opacity: 0; transform: translateY(0); }
                        12% { opacity: 1; }
                        58% { opacity: 1; transform: translateY(var(--land)); }
                        62%, 100% { opacity: 0; transform: translateY(var(--land)); }
                    }

                    @keyframes ripple {
                        0% { opacity: 0; transform: scale(0.15); }
                        12% { opacity: 1; }
                        100% { opacity: 0; transform: scale(1); }
                    }

                    /* Unlit while it plays, but for a flicker now and then; the
                       cycle starts on the flicker, so the still drawing has its
                       bolt and play begins with a flash. */
                    @keyframes flash {
                        0%, 4%, 100% { opacity: 1; }
                        2% { opacity: 0.15; }
                        11%, 99% { opacity: 0; }
                    }

                    /* In step with the heavy storm's flash. */
                    @keyframes glow {
                        0%, 4%, 100% { fill: color-mix(in srgb, currentColor 40%, transparent); }
                        11%, 99% { fill: color-mix(in srgb, currentColor 14%, transparent); }
                    }

                    @keyframes flicker {
                        0% { transform: scale(1, 1) skewX(0deg); }
                        40% { transform: scale(0.98, 1.04) skewX(-1.5deg); }
                        75% { transform: scale(1.01, 0.97) skewX(1deg); }
                        100% { transform: scale(0.99, 1.02) skewX(-0.5deg); }
                    }

                    @keyframes rise {
                        0% { opacity: 0; transform: translate(0, 0); }
                        20% { opacity: 0.9; }
                        100% { opacity: 0; transform: translate(1.5px, -7px); }
                    }

                    /* From the horizon to the near edge: growing in length and
                       width as it comes, and quickening, as perspective does. */
                    @keyframes approach {
                        0% { opacity: 0; transform: translateY(0) scale(0.5, 0.6); }
                        15% { opacity: 1; }
                        85% { opacity: 1; }
                        100% { opacity: 0; transform: translateY(19px) scale(1.6, 3.4); }
                    }

                    @keyframes drift {
                        to { transform: translateX(var(--wavelength)); }
                    }

                }
            </style>
            <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false" data-track="${track}">
                ${FADE_MASK}${scene}
            </svg>
        `;
    }
}
