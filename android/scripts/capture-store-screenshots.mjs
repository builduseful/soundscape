#!/usr/bin/env node
// Writes the Play listing's screenshots to android/store/screenshots/: phone,
// 7-inch and 10-inch tablet, light and dark, each playing the first soundscape
// from a fresh install. Skips a file that is byte-identical to the one already
// there, so a routine run does not churn a binary diff. Run it after any change
// to how the home screen looks.
//
// One emulator, the latest phone, plays every size: its display is set to each
// shape in turn. Play allows no side more than twice the other, so the phone is
// 16:9, not the emulator's own 20:9. The status bar is held in demo mode (a
// fixed clock, full Wi-Fi and battery), with every notification snoozed.
//
// Usage, from android/:  node scripts/capture-store-screenshots.mjs
// Needs ANDROID_HOME (and ANDROID_AVD_HOME if the AVDs are not in the default
// place), and the soundscape-api37 AVD (see android/AGENTS.md). With a device
// already attached, it uses that one instead of starting the emulator.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { APP, androidDir, gradle, openDevice, sleep, waitFor } from "./device.mjs";

const outDir = path.join(androidDir, "store", "screenshots");
const AVD = "soundscape-api37";
const PLAY_TRACK = `${APP}.action.PLAY_TRACK`;

const SHAPES = [
    { name: "phone", width: 1080, height: 1920, density: 420 },
    { name: "tablet-7in", width: 1200, height: 1920, density: 320 },
    { name: "tablet-10in", width: 1600, height: 2560, density: 320 },
];
const THEMES = ["light", "dark"];

const device = await openDevice(AVD);
const { shell } = device;

function demoMode(on) {
    const demo = (...extras) => shell(`am broadcast -a com.android.systemui.demo ${extras.join(" ")}`);
    if (!on) return demo("-e command exit");
    shell("settings put global sysui_demo_allowed 1");
    demo("-e command enter");
    demo("-e command clock -e hhmm 0900");
    demo("-e command battery -e level 100 -e plugged false");
    demo("-e command network -e wifi show -e level 4 -e fully true");
    demo("-e command network -e mobile hide");
}

// Demo mode's own "notifications visible false" leaves their icons in the status bar on API 37.
function snoozeNotifications() {
    const others = shell("cmd notification list").split(/\s+/).filter((key) => key && !key.includes(`|${APP}|`));
    for (const key of others) {
        shell(`cmd notification snooze --for 600000 '${key}'`);
    }
}

// Playing, with the title settled: the button offers Pause and nothing is loading.
async function waitUntilPlaying() {
    await waitFor("the soundscape to play", () => {
        shell("uiautomator dump /sdcard/window.xml");
        const screen = shell("cat /sdcard/window.xml");
        return screen.includes('content-desc="Pause"') && !screen.includes("Loading soundscape");
    });
    await sleep(1_000);
}

async function capture(shape, theme, track) {
    shell(`wm size ${shape.width}x${shape.height}`);
    shell(`wm density ${shape.density}`);
    // Entered afresh for each shape: carried across a size change, SystemUI draws its icons twice.
    demoMode(false);
    demoMode(true);
    shell(`cmd uimode night ${theme === "dark" ? "yes" : "no"}`);
    // From a fresh install: the default volume and theme ("System", which follows the line above).
    shell(`pm clear ${APP}`);
    shell(`am start -W -n ${APP}/.MainActivity -a ${PLAY_TRACK} --es trackId ${track}`);
    await waitUntilPlaying();
    snoozeNotifications();
    await sleep(1_000);

    const file = path.join(outDir, `${shape.name}-${theme}.png`);
    const png = device.binary("exec-out", "screencap", "-p");
    const existing = await readFile(file).catch(() => null);
    if (existing?.equals(png)) {
        console.log(`unchanged  ${path.relative(androidDir, file)}`);
    } else {
        await writeFile(file, png);
        console.log(`wrote      ${path.relative(androidDir, file)}`);
    }
}

const catalog = JSON.parse(await readFile(path.join(androidDir, "..", "shared", "catalog.json"), "utf8"));
const track = catalog.tracks[0].id;

try {
    gradle(":app:assembleDebug");
    device.adb("install", "-r", path.join(androidDir, "app", "build", "outputs", "apk", "debug", "app-debug.apk"));
    await mkdir(outDir, { recursive: true });
    for (const shape of SHAPES) {
        for (const theme of THEMES) await capture(shape, theme, track);
    }
} finally {
    shell(`am force-stop ${APP}`);
    demoMode(false);
    shell("wm size reset");
    shell("wm density reset");
    shell("cmd uimode night no");
    device.close();
}
