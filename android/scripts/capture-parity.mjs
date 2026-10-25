#!/usr/bin/env node
// Screenshots the screen in each window of ../shared/fixtures/layout.json,
// light and dark, as LayoutParityTest lays it out (the instrumented
// ParityScreenshots), and writes .temp/parity/android/<width>x<height>-<theme>.png
// for scripts/parity-report.mjs to set beside the web's. Uninstalls the app
// afterwards, so a later connectedDebugAndroidTest can install its own.
//
// Usage, from android/:  node scripts/capture-parity.mjs
// Uses the attached device, or else starts the soundscape-api37 AVD.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP, androidDir, gradle, openDevice } from "./device.mjs";

const outDir = path.join(androidDir, "..", ".temp", "parity", "android");
const RUNNER = `${APP}.test/androidx.test.runner.AndroidJUnitRunner`;

const device = await openDevice("soundscape-api37");
try {
    gradle(":app:installDebug", ":app:installDebugAndroidTest");
    const result = device.shell(
        `am instrument -w -e class ${APP}.ui.ParityScreenshots ${RUNNER}`,
    );
    if (!result.includes("OK (")) throw new Error(`ParityScreenshots failed:\n${result}`);

    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    for (const name of device.shell(`run-as ${APP} ls files/parity`).split(/\s+/).filter(Boolean)) {
        await writeFile(path.join(outDir, name), device.binary("exec-out", "run-as", APP, "cat", `files/parity/${name}`));
        console.log(`wrote: .temp/parity/android/${name}`);
    }
} finally {
    for (const pkg of [`${APP}.test`, APP]) {
        try {
            device.adb("uninstall", pkg);
        } catch {
            // Not installed: the build failed before it got there.
        }
    }
    device.close();
}
