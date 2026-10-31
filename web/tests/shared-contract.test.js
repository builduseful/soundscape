// shared/ is what every platform must agree on. These tests hold the web app to
// it, so a change made only here, or only there, fails until both agree. Where
// each value lives in the web code is this file's business, not shared/'s: the
// contract stays platform-neutral.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import { applyLoopCrossfade } from "../src/js/audio-player.js";
import { tracks } from "../src/js/tracks.js";
import { componentCss, parseCss, rule } from "./helpers/css.js";

const SHARED = new URL("../../shared/", import.meta.url);
const SRC = new URL("../src/", import.meta.url);

const readShared = async (name) => JSON.parse(await readFile(new URL(name, SHARED), "utf8"));
const readSrc = (path) => readFile(new URL(path, SRC), "utf8");

const catalog = await readShared("catalog.json");
const copy = await readShared("copy.json");
const tokens = await readShared("design-tokens.json");
const crossfade = await readShared("fixtures/loop-crossfade.json");

const sources = {
    index: await readSrc("index.html"),
    script: await readSrc("js/script.js"),
    audioPlayer: await readSrc("js/audio-player.js"),
    appMenu: await readSrc("js/components/app-menu.js"),
    themeSelector: await readSrc("js/components/theme-selector.js"),
    volumeControl: await readSrc("js/components/volume-control.js"),
    gestures: await readSrc("js/gestures.js"),
    gestureTutorial: await readSrc("js/components/gesture-tutorial.js"),
    trackScene: await readSrc("js/components/track-scene.js"),
};

const page = parseCss(await readSrc("style.css"));
const menu = parseCss(componentCss(sources.appMenu));
const themes = parseCss(componentCss(sources.themeSelector));
const volume = parseCss(componentCss(sources.volumeControl));
const tutorial = parseCss(componentCss(sources.gestureTutorial));

const ROOT_REM_PX = 16;
const NARROW = `@media (max-width: ${tokens.size.narrowBreakpoint}px)`;
const MOTION = "@media (prefers-reduced-motion: no-preference)";
const WORDS_NOT_BAR = "@media (prefers-reduced-motion: reduce), (forced-colors: active)";

const px = (value) => `${value}px`;
const rem = (value) => `${value / ROOT_REM_PX}rem`;
const seconds = (ms) => `${ms / 1000}s`;
const bezier = ([x1, y1, x2, y2]) => `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
const kebab = (name) => name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
const jsConstant = (source, name) => {
    const match = new RegExp(`const ${name} = ([\\d.]+);`, "u").exec(source);
    assert.ok(match, `${name} should be a numeric constant.`);
    return Number(match[1]);
};

describe("the web app matches shared/catalog.json", () => {
    test("the same tracks, in the same order, with the same titles", () => {
        assert.deepEqual(tracks, catalog.tracks);
    });

    test("the manifest's app shortcuts are the catalog's, in order, by title", async () => {
        const manifest = JSON.parse(await readSrc("manifest.webmanifest"));
        const expected = catalog.shortcuts.map((id) => {
            const { title } = catalog.tracks.find((track) => track.id === id);
            return { name: title, short_name: title, url: `./?track=${id}` };
        });

        assert.deepEqual(
            manifest.shortcuts.map(({ name, short_name, url }) => ({ name, short_name, url })),
            expected,
        );
    });
});

describe("the web app matches shared/design-tokens.json", () => {
    test("every colour token is a light-dark() pair on :root, and nothing else is", () => {
        const declared = [...rule(page, ":root")].filter(([name]) => name.startsWith("--color-") && name !== "--color-change-duration");
        const expected = Object.entries(tokens.color).map(([name, { light, dark }]) => [
            `--color-${kebab(name)}`,
            `light-dark(${light}, ${dark})`,
        ]);

        assert.deepEqual(new Map(declared), new Map(expected));
    });

    test("shadows", () => {
        const layer = ({ y, blur, light, dark }) => `0 ${y}px ${blur}px light-dark(${light}, ${dark})`;
        const root = rule(page, ":root");
        const surface = tokens.shadow.surface.map(layer).join(", ");

        assert.equal(root.get("--shadow-surface"), surface);
        assert.equal(
            root.get("--shadow-elevated").replace("var(--shadow-surface)", surface),
            tokens.shadow.elevated.map(layer).join(", "),
        );
    });

    const { size } = tokens;
    const sizes = [
        ["pagePadding", rule(page, ".container").get("padding")],
        ["pagePaddingNarrow", rule(page, NARROW, ".container").get("padding")],
        ["headerGap", rule(page, ".app-header").get("gap")],
        ["brandGap", rule(page, ".app-brand").get("gap")],
        ["headerGap", rule(page, ".app-footer").get("gap")],
        ["playerGap", rule(page, ".player").get("gap")],
        ["playerMaxWidth", rule(page, ".player").get("max-width")],
        ["transportGap", rule(page, ".transport-controls").get("gap")],
        // Exactly over the drawing.
        ["stage", rule(page, "button.play").get("width")],
        ["stage", rule(page, "button.play").get("height")],
        ["skipButton", rule(page, "button.prev, button.next").get("width")],
        ["skipButton", rule(page, "button.prev, button.next").get("height")],
        ["skipIcon", rule(page, ".button-icon").get("width")],
        ["loadingBarWidth", rule(page, ".track-loading-bar").get("width")],
        ["loadingBarHeight", rule(page, ".track-loading-bar").get("height")],
        ["menuButton", rule(menu, "@scope (app-menu)", ":scope").get("--menu-button-size")],
        ["menuIcon", rule(menu, "@scope (app-menu)", ":scope > button svg").get("width")],
        ["menuPanelRadius", rule(menu, "@scope (app-menu)", ".menu-panel").get("border-radius")],
        ["menuPanelPadding", rule(menu, "@scope (app-menu)", ".menu-panel").get("--menu-panel-inset")],
        ["menuPanelGap", rule(menu, "@scope (app-menu)", ".menu-panel").get("gap")],
        ["themeOption", rule(themes, "@scope (theme-selector)", "label").get("width")],
        ["themeSelectorPadding", rule(themes, "@scope (theme-selector)", ".theme-selector").get("padding")],
        ["themeSelectorPadding", rule(themes, "@scope (theme-selector)", ".theme-selector").get("gap")],
        ["themeIcon", rule(themes, "@scope (theme-selector)", "svg").get("width")],
        ["volumeIcon", rule(volume, "@scope (volume-control)", "svg").get("width")],
        ["volumeButton", rule(volume, "@scope (volume-control)", ":scope").get("--volume-button-size")],
        ["volumePanelGap", rule(volume, "@scope (volume-control)", ":scope").get("--volume-panel-gap")],
        ["volumePanelPadding", rule(volume, "@scope (volume-control)", ":scope").get("--volume-panel-padding")],
        ["volumeSliderLength", rule(volume, "@scope (volume-control)", ":scope").get("--volume-slider-length")],
    ];

    for (const [name, actual] of sizes) {
        test(`size.${name}`, () => assert.equal(actual, px(size[name])));
    }

    test("size.loadingOffset", () => {
        assert.equal(rule(page, ".track-loading").get("top"), `calc(100% + ${px(size.loadingOffset)})`);
        assert.equal(rule(page, WORDS_NOT_BAR, ".track-loading").get("top"), `calc(100% + ${px(size.loadingOffsetReduced)})`);
    });

    test("size.titleMinWidthChars and size.errorMaxWidthChars", () => {
        assert.equal(rule(page, ".track-title").get("min-width"), `${size.titleMinWidthChars}ch`);
        assert.equal(rule(page, ".playback-error").get("max-width"), `${size.errorMaxWidthChars}ch`);
    });

    test("size.focusRing", () => {
        assert.ok(rule(page, "button:focus-visible").get("box-shadow").includes(`0 0 0 ${px(size.focusRing)}`));
        assert.equal(rule(menu, "@scope (app-menu)", ":scope > button:focus-visible").get("outline").split(" ")[0], px(size.focusRing));
        assert.equal(rule(menu, "@scope (app-menu)", ":scope > button:focus-visible").get("outline-offset"), px(size.focusRing));
        assert.equal(rule(themes, "@scope (theme-selector)", "input:focus-visible + label").get("outline").split(" ")[0], px(size.focusRing));
    });

    test("size.popoverOffset and motion.popoverScale", () => {
        assert.equal(
            rule(menu, "@scope (app-menu)", ".menu-panel").get("transform"),
            `translateY(-${px(size.popoverOffset)}) scale(${tokens.motion.popoverScale})`,
        );
    });

    const { type } = tokens;
    const typeRules = [
        ["appName", rule(page, ".app-name")],
        ["byline", rule(page, ".app-byline")],
        ["title", rule(page, ".track-title")],
        ["loading", rule(page, ".track-loading")],
        ["error", rule(page, ".playback-error")],
        ["menuLabel", rule(menu, "@scope (app-menu)", ".menu-label")],
        ["version", rule(menu, "@scope (app-menu)", ".app-version")],
    ];

    for (const [name, declarations] of typeRules) {
        test(`type.${name}`, () => {
            const style = type[name];
            assert.equal(declarations.get("font-size"), rem(style.size));
            if (style.weight) assert.equal(declarations.get("font-weight"), String(style.weight));
            if (style.lineHeight) assert.equal(declarations.get("line-height"), String(style.lineHeight));
            assert.equal(declarations.get("letter-spacing") ?? "0", style.letterSpacing ? `${style.letterSpacing}em` : "0");
            assert.equal(declarations.get("text-transform") === "uppercase", style.uppercase === true);
        });
    }

    test("type.body", () => {
        const body = rule(page, "body");
        assert.equal(body.get("font-size"), px(type.body.size));
        assert.equal(body.get("line-height"), String(type.body.lineHeight));
        assert.equal(body.has("font-weight"), false, "body text is the default 400 weight");
    });

    const { duration, motion } = tokens;
    const includes = [
        ["duration.loadingSweep", rule(page, MOTION, ".track-loading-bar::after").get("animation"), `${seconds(duration.loadingSweep)} linear`],
        ["duration.press", rule(page, MOTION, "button").get("transition"), `transform ${seconds(duration.press)}`],
        ["duration.themeThumb", rule(themes, "@scope (theme-selector)", ".theme-selector::before").get("transition"), `transform ${duration.themeThumb}ms ${bezier(motion.emphasizedEasing)}`],
        ["duration.popoverFade (menu)", rule(menu, "@scope (app-menu)", ".menu-panel").get("transition"), `opacity ${seconds(duration.popoverFade)}`],
        ["duration.popoverFade (volume)", rule(volume, "@scope (volume-control)", ".volume-panel").get("transition"), `opacity ${seconds(duration.popoverFade)}`],
        ["duration.volumeWipe", rule(volume, "@scope (volume-control)", ".volume-panel-surface").get("transition"), `clip-path ${seconds(duration.volumeWipe)} ${bezier(motion.wipeEasing)}`],
        ["motion.pressScale", rule(page, "button:active").get("transform"), `scale(${motion.pressScale})`],
    ];

    for (const [name, actual, expected] of includes) {
        test(name, () => assert.ok(actual?.includes(expected), `"${actual}" should include "${expected}".`));
    }

    test("duration.colorChange", () => {
        assert.equal(rule(page, ":root").get("--color-change-duration"), seconds(duration.colorChange));
    });

    test("duration.themeFade", () => {
        const fade = rule(page, "::view-transition-old(root), ::view-transition-new(root)");
        assert.equal(fade.get("animation-duration"), `${duration.themeFade}ms`);
    });

    test("volume", () => {
        assert.equal(jsConstant(sources.volumeControl, "WHEEL_STEP"), tokens.volume.wheelStep);
        assert.ok(sources.volumeControl.includes(`Number(safeValue) <= ${tokens.volume.mutedAtOrBelow}`));
        assert.equal(rule(volume, "@scope (volume-control)", ":scope[muted] .wave, :scope[muted] .wave-small").get("opacity"), String(tokens.volume.mutedWaveOpacity));
    });

    test("motion.loadingDash", () => {
        const dash = rule(page, ".track-loading-bar::after");
        assert.equal(dash.get("width"), `${tokens.motion.loadingDash * 100}%`);
        assert.equal(dash.get("left"), `-${tokens.motion.loadingDash * 100}%`);
    });

    test("motion.loadingDim", () => {
        assert.equal(rule(page, ".track-title.is-loading").get("opacity"), String(motion.loadingDim));
    });

    test("the audio and loading timings", () => {
        assert.equal(jsConstant(sources.audioPlayer, "LOOP_CROSSFADE_MS"), duration.loopCrossfade);
        assert.equal(jsConstant(sources.audioPlayer, "TRACK_CROSSFADE_SECONDS") * 1000, duration.trackCrossfade);
        assert.equal(jsConstant(sources.audioPlayer, "SWIPE_FADE_IN_SECONDS") * 1000, duration.swipeFadeIn);
        assert.equal(jsConstant(sources.audioPlayer, "FADE_DURATION_SECONDS") * 1000, duration.volumeRamp);
        assert.equal(jsConstant(sources.script, "LOADING_INDICATOR_DELAY_MS"), duration.loadingIndicatorDelay);
    });
});

describe("the gestures, the drawing and the resting screen match shared/design-tokens.json", () => {
    const { size, duration, gesture, motion } = tokens;

    test("gesture", () => {
        assert.equal(jsConstant(sources.gestures, "TAP_SLOP_PX"), gesture.tapSlop);
        assert.equal(jsConstant(sources.gestures, "TAP_MAX_MS"), gesture.tapMaxMs);
        assert.equal(jsConstant(sources.gestures, "SWIPE_MIN_PX"), gesture.swipeMin);
        assert.equal(jsConstant(sources.gestures, "SWIPE_PROJECTION_MS"), gesture.swipeProjectionMs);
        assert.equal(jsConstant(sources.gestures, "VELOCITY_WINDOW_MS"), gesture.velocityWindowMs);
        assert.equal(jsConstant(sources.script, "SWIPE_FADE_DISTANCE"), gesture.swipeFadeDistance);
        assert.equal(jsConstant(sources.gestures, "VOLUME_TRAVEL_PX"), gesture.volumeTravel);
        assert.equal(jsConstant(sources.script, "SWIPE_MIN_SPEED"), gesture.swipeMinSpeed);
    });

    test("the swipe's timings", () => {
        assert.equal(jsConstant(sources.script, "SWIPE_MIN_MS"), duration.swipeMin);
        assert.equal(jsConstant(sources.script, "SWIPE_MAX_MS"), duration.swipeMax);
        assert.equal(jsConstant(sources.script, "SWIPE_SETTLE_MS"), duration.swipeSettle);
        assert.ok(sources.script.includes(`const SWIPE_EASING = "${bezier(motion.swipeEasing)}";`));
    });

    test("the press-in under a drag", () => {
        const pressed = rule(page, MOTION, ".track-status[data-pressed]");
        assert.equal(pressed.get("scale"), String(motion.dragPressScale));
        assert.equal(pressed.get("transition"), `scale ${seconds(duration.dragPress)} ${bezier(motion.pressEasing)}`);
        assert.equal(rule(page, MOTION, ".track-status").get("transition"), `scale ${seconds(duration.dragRelease)} ${bezier(motion.emphasizedEasing)}`);
    });

    test("the stage", () => {
        assert.equal(rule(page, ".track-stage").get("width"), px(size.stage));
        assert.equal(rule(page, ".track-stage").get("height"), px(size.stage));
        assert.equal(rule(page, ".track-status").get("gap"), px(size.stageGap));
        // As much room above the drawing as the name takes below it, so the drawing is the centre.
        assert.equal(rule(page, ".player").get("--name-reach"), `calc(${px(size.stageGap)} + ${tokens.type.title.lineHeight} * ${rem(tokens.type.title.size)})`);
        assert.equal(rule(page, ".track-stage track-scene:not([playing])").get("opacity"), String(motion.pausedScene));
        assert.equal(rule(page, ".track-stage track-scene").get("transition"), `opacity ${seconds(duration.sceneDim)} ${bezier(motion.fadeEasing)}`);
        // Paused, it breathes out to pausedSceneBreath and pausedSceneBreathScale (script.js).
        assert.equal(jsConstant(sources.script, "PAUSED_SCENE"), motion.pausedScene);
        assert.equal(jsConstant(sources.script, "PAUSED_SCENE_BREATH"), motion.pausedSceneBreath);
        assert.equal(jsConstant(sources.script, "SCENE_BREATH_SCALE"), motion.pausedSceneBreathScale);
        assert.equal(jsConstant(sources.script, "SCENE_BREATH_MS"), duration.sceneBreath);
        assert.equal(jsConstant(sources.script, "SCENE_BREATH_STEP_MS"), duration.sceneBreathStep);
        assert.equal(jsConstant(sources.script, "SCENE_DIM_MS"), duration.sceneDim);
        // Playing, it steps no faster than sceneFrameRate (track-scene.js).
        assert.equal(jsConstant(sources.trackScene, "SCENE_FRAME_RATE"), motion.sceneFrameRate);
        assert.ok(sources.script.includes(`const FADE_EASING = "${bezier(motion.fadeEasing)}";`));
        // The name is in the drawing's colour, dimmed with it while paused.
        assert.equal(rule(page, ".track-title").get("color"), "var(--color-text-muted)");
        assert.equal(rule(page, ".track-status:has(track-scene:not([playing])) .track-title").get("filter"), `opacity(${motion.pausedScene})`);
    });

    test("the volume a drag sets", () => {
        const bar = rule(page, ".gesture-volume");
        assert.equal(bar.get("width"), px(size.gestureVolumeWidth));
        assert.equal(bar.get("height"), px(size.gestureVolumeHeight));
        assert.equal(bar.get("top"), `calc(100% + ${px(size.gestureVolumeOffset)})`);
        assert.equal(rule(page, ":root[data-resting] .gesture-volume").get("transition"), `opacity ${seconds(duration.restFade)} ${bezier(motion.fadeEasing)}`);
    });

    test("the arrival", () => {
        const arrival = rule(page, MOTION, ".app-header, .player, .app-footer").get("animation");
        assert.ok(arrival.includes(`app-enter ${seconds(duration.appEnter)} ${bezier(motion.emphasizedEasing)}`), arrival);
        assert.ok(arrival.includes(`app-fade ${seconds(duration.appEnter)} ${bezier(motion.fadeEasing)}`), arrival);
        assert.equal(rule(page, MOTION, ".player").get("animation-delay"), seconds(duration.appEnterStagger));
        assert.equal(rule(page, MOTION, ".app-footer").get("animation-delay"), seconds(2 * duration.appEnterStagger));
    });

    test("the resting screen", () => {
        assert.equal(jsConstant(sources.script, "REST_AFTER_MS"), duration.restAfter);
        const fade = bezier(motion.fadeEasing);
        assert.equal(rule(page, ".app-header > *").get("transition"), `opacity ${seconds(duration.wake)} ${fade}`);
        const title = rule(page, ".track-title").get("transition");
        assert.equal(title, `opacity ${seconds(duration.wake)} ${fade}, filter ${seconds(duration.sceneDim)} ${fade}`);
        assert.equal(
            rule(page, ":root[data-resting] :is(.app-header > *, .track-title)").get("transition-duration"),
            `${seconds(duration.restFade)}, ${seconds(duration.sceneDim)}`,
        );
    });

    test("the guide", () => {
        const card = rule(tutorial, "@scope (gesture-tutorial)", ":scope");
        assert.equal(jsConstant(sources.script, "TUTORIAL_DELAY_MS"), duration.tutorialDelay);
        assert.equal(jsConstant(sources.gestureTutorial, "FADE_MS"), duration.tutorialFade);
        assert.equal(jsConstant(sources.gestureTutorial, "DONE_HOLD_MS"), duration.tutorialDoneHold);
        assert.ok(card.get("transition").startsWith(`opacity ${seconds(duration.tutorialFade)} ease`));
        assert.ok(card.get("width").startsWith(`min(${px(size.tutorialMaxWidth)},`));
        assert.ok(card.get("bottom").startsWith(`calc(${px(size.tutorialBottom)} +`));
        assert.equal(rule(tutorial, "@scope (gesture-tutorial)", ".tutorial-card").get("border-radius"), px(size.tutorialRadius));
    });
});

describe("the web app matches shared/copy.json", () => {
    // Each key, and the form it takes where the web code says it. Every key in
    // copy.json must be listed: a string no platform is checked against is a
    // string that drifts.
    const placements = {
        appName: [["index", (v) => `<title>${v}</title>`], ["index", (v) => `<p class="app-name">${v}</p>`]],
        byline: [["index", (v) => `rel="noopener">${v}</a>`]],
        bylineUrl: [["index", (v) => `class="app-byline" href="${v}"`]],
        sourceUrl: [["index", (v) => `id="appVersion" href="${v}"`]],
        playbackControls: [["index", (v) => `class="controls" aria-label="${v}"`]],
        play: [["script", (v) => `const PLAY_LABEL = "${v}";`], ["index", (v) => `aria-label="${v}" data-playing="false"`]],
        pause: [["script", (v) => `const PAUSE_LABEL = "${v}";`]],
        previousTrack: [["index", (v) => `id="previousButton" type="button" aria-label="${v}"`]],
        nextTrack: [["index", (v) => `id="nextButton" type="button" aria-label="${v}"`]],
        volume: [["volumeControl", (v) => `const DEFAULT_LABEL = "${v}";`]],
        menu: [["appMenu", (v) => `aria-label="${v}"`]],
        theme: [["appMenu", (v) => `<span class="menu-label">${v}</span>`], ["themeSelector", (v) => `role="radiogroup" aria-label="${v}"`]],
        themeSystem: [["themeSelector", (v) => `label: "${v}",`]],
        themeLight: [["themeSelector", (v) => `label: "${v}",`]],
        themeDark: [["themeSelector", (v) => `label: "${v}",`]],
        loading: [["script", (v) => `const LOADING_LABEL = "${v}";`]],
        playbackFailed: [["script", (v) => `\`${v.replace("{title}", "${track.title}")}\``]],
        gestureTap: [["gestureTutorial", (v) => `{ gesture: "tap", text: "${v}" }`]],
        gestureSwipe: [["gestureTutorial", (v) => `{ gesture: "swipe", text: "${v}" }`]],
        gestureVolume: [["gestureTutorial", (v) => `{ gesture: "volume", text: "${v}" }`]],
        gestureDone: [["gestureTutorial", (v) => `const DONE_TEXT = "${v}";`]],
        skip: [["gestureTutorial", (v) => `class="tutorial-skip">${v}</button>`]],
    };

    test("every string in copy.json is checked here", () => {
        assert.deepEqual(Object.keys(placements).sort(), Object.keys(copy).sort());
    });

    for (const [key, places] of Object.entries(placements)) {
        test(key, () => {
            for (const [source, form] of places) {
                const expected = form(copy[key] ?? "");
                assert.ok(sources[source].includes(expected), `${source} should contain ${expected}`);
            }
        });
    }
});

describe("the web app matches shared/fixtures/loop-crossfade.json", () => {
    const context = {
        createBuffer(numberOfChannels, length, sampleRate) {
            const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
            return { numberOfChannels, length, sampleRate, getChannelData: (channel) => channels[channel] };
        },
    };

    for (const { name, input, expected } of crossfade.cases) {
        test(name, () => {
            const source = context.createBuffer(input.channels.length, input.channels[0].length, input.sampleRate);
            input.channels.forEach((samples, channel) => source.getChannelData(channel).set(samples));

            const { buffer, loopStart, loopEnd } = applyLoopCrossfade(source, context, input.crossfadeMs);

            assert.equal(loopStart, 0);
            assert.equal(Math.round(loopEnd * input.sampleRate), expected.loopEndSamples);
            expected.channels.forEach((samples, channel) => {
                const actual = buffer.getChannelData(channel);
                samples.forEach((sample, index) => {
                    assert.ok(
                        Math.abs(actual[index] - sample) <= crossfade.tolerance,
                        `channel ${channel}, sample ${index}: ${actual[index]} should be ${sample}`,
                    );
                });
            });
        });
    }
});
