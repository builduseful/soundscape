#!/usr/bin/env node
// Screenshots the page in each window of ../shared/fixtures/layout.json, light
// and dark, as the layout boxes were measured: the first track, paused, with
// reduced motion. Writes .temp/parity/web/<width>x<height>-<theme>.png for
// scripts/parity-report.mjs to set beside Android's. Not tracked: the report
// is advisory, and these are rewritten on every run.
//
// Usage: npm run parity   (or node ../scripts/parity-report.mjs for the report)

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { srcDir, startServer } from "./static-server.mjs";

const repoDir = path.join(srcDir, "..", "..");
const outDir = path.join(repoDir, ".temp", "parity", "web");
const { windows } = JSON.parse(await readFile(path.join(repoDir, "shared", "fixtures", "layout.json"), "utf8"));

await mkdir(outDir, { recursive: true });
const { server, url } = await startServer();
const browser = await chromium.launch();
try {
    for (const { width, height } of windows) {
        for (const theme of ["light", "dark"]) {
            const context = await browser.newContext({
                viewport: { width, height },
                colorScheme: theme,
                reducedMotion: "reduce",
                deviceScaleFactor: 2,
            });
            try {
                const page = await context.newPage();
                await page.goto(url, { waitUntil: "networkidle" });
                await page.waitForSelector("#playPauseButton");
                // The title fades in when ready, with or without reduced motion.
                await page.waitForTimeout(600);
                const name = `${width}x${height}-${theme}.png`;
                await writeFile(path.join(outDir, name), await page.screenshot());
                console.log(`wrote: .temp/parity/web/${name}`);
            } finally {
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
    server.close();
}
