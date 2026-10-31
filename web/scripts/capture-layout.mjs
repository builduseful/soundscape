#!/usr/bin/env node
// Renders the app with Playwright in each shape of window the platforms are
// tested at, and writes where each part of the page sits to
// ../shared/fixtures/layout.json. Every other platform's tests hold its own
// layout to these boxes, so re-run this after any change to the page's layout
// and commit what it rewrites. Skips the write when nothing moved.
//
// Usage: npm run layout

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { srcDir, startServer } from "./static-server.mjs";

const outFile = path.join(srcDir, "..", "..", "shared", "fixtures", "layout.json");

// Phone, landscape phone, tablet, an unfolded foldable's inner screen, and a
// window shorter than the page.
const WINDOWS = [
    { width: 360, height: 640 },
    { width: 800, height: 360 },
    { width: 1280, height: 800 },
    { width: 673, height: 841 },
    { width: 360, height: 300 },
];

// Platform-neutral names; each platform's test maps them to its own elements.
// The title is its text, not the full-width heading that holds it.
const PARTS = {
    byline: ".app-byline",
    menuButton: "#appMenu button[aria-controls]",
    previous: "#previousButton",
    playPause: "#playPauseButton",
    next: "#nextButton",
    title: "#title .track-title-text",
    volumeButton: "#volumeControl button[aria-controls]",
};

const round = (value) => Math.round(value * 10) / 10;

// As a touch screen: that is the layout the other platforms have. A mouse's
// controls sit in a row of their own (style.css).
async function measure(browser, url, size) {
    const page = await browser.newPage({ viewport: size, colorScheme: "light", reducedMotion: "reduce", hasTouch: true });
    try {
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForSelector("#playPauseButton");
        const boxes = {};
        for (const [name, selector] of Object.entries(PARTS)) {
            // From the top of the page, not the viewport: a short window scrolls.
            const box = await page.locator(selector).evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height };
            });
            boxes[name] = Object.fromEntries(Object.entries(box).map(([key, value]) => [key, round(value)]));
        }
        return { ...size, boxes };
    } finally {
        await page.close();
    }
}

const { server, url } = await startServer();
const browser = await chromium.launch();
try {
    const windows = [];
    for (const size of WINDOWS) windows.push(await measure(browser, url, size));
    const json = `${JSON.stringify({
        about: "Where each part of the page sits in the web app, in CSS px from the top left of the page, per window. Written by web/scripts/capture-layout.mjs; do not edit.",
        windows,
    }, null, 2)}\n`;
    const existing = await readFile(outFile, "utf8").catch(() => null);
    if (existing === json) {
        console.log("unchanged: shared/fixtures/layout.json");
    } else {
        await writeFile(outFile, json);
        console.log(`${existing ? "updated" : "created"}: shared/fixtures/layout.json`);
    }
} finally {
    await browser.close();
    server.close();
}
