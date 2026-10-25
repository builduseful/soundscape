#!/usr/bin/env node
// Renders the app with Playwright and writes the install screenshots that
// manifest.webmanifest references (one per form_factor Chrome/Android look
// for). Skips the write when the freshly rendered PNG is byte-identical to
// the checked-in one, so routine runs don't churn a binary diff — run this
// after any change that could affect what the home page looks like.
//
// Usage: npm install && npx playwright install chromium   # one-time
//        npm run screenshots

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { srcDir, startServer } from "./static-server.mjs";

const outDir = path.join(srcDir, "resources", "screenshots");

// Sizes are chosen to satisfy Chrome's install-UI screenshot requirements
// (320-3840px per side, aspect ratio no more extreme than ~2.3:1) while
// matching manifest.webmanifest's form_factor entries.
const SHOTS = [
    { name: "mobile-narrow.png", formFactor: "narrow", width: 375, height: 667, deviceScaleFactor: 2 },
    { name: "desktop-wide.png", formFactor: "wide", width: 1280, height: 800, deviceScaleFactor: 1 },
];

async function readFileIfExists(filePath) {
    try {
        return await readFile(filePath);
    } catch {
        return null;
    }
}

async function captureShot(browser, url, shot) {
    const context = await browser.newContext({
        colorScheme: "dark",
        viewport: { width: shot.width, height: shot.height },
        deviceScaleFactor: shot.deviceScaleFactor,
    });

    try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForSelector("#playPauseButton");
        // Let the 420ms title-swap animation fully settle before capturing.
        await page.waitForTimeout(600);
        return await page.screenshot();
    } finally {
        await context.close();
    }
}

async function main() {
    await mkdir(outDir, { recursive: true });

    const { server, url } = await startServer();
    const browser = await chromium.launch();

    try {
        for (const shot of SHOTS) {
            const buffer = await captureShot(browser, url, shot);
            const outPath = path.join(outDir, shot.name);
            const existing = await readFileIfExists(outPath);

            if (existing && existing.equals(buffer)) {
                console.log(`unchanged: ${shot.name}`);
                continue;
            }

            await writeFile(outPath, buffer);
            const pixelWidth = shot.width * shot.deviceScaleFactor;
            const pixelHeight = shot.height * shot.deviceScaleFactor;
            console.log(`${existing ? "updated" : "created"}: ${shot.name} (${pixelWidth}x${pixelHeight})`);
        }
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
