#!/usr/bin/env node
// Rasterizes the SVG icon sources to the PNG sizes the app ships, via
// Playwright (shared devDependency with capture-screenshots.mjs).
//
// Usage: npm install && npx playwright install chromium   # one-time
//        npm run icons

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.join(__dirname, "..", "src", "resources", "icons");

const ICONS = [
    { source: "icon.svg", output: "icon-96.png", size: 96 },
    { source: "icon.svg", output: "icon-128.png", size: 128 },
    { source: "icon.svg", output: "icon-192.png", size: 192 },
    { source: "icon.svg", output: "icon-256.png", size: 256 },
    { source: "icon.svg", output: "icon-384.png", size: 384 },
    { source: "icon.svg", output: "icon-512.png", size: 512 },
    { source: "icon.svg", output: "favicon-16.png", size: 16 },
    { source: "icon.svg", output: "favicon-32.png", size: 32 },
    { source: "maskable-icon.svg", output: "apple-touch-icon.png", size: 180 },
    { source: "maskable-icon.svg", output: "maskable-icon-512.png", size: 512 },
];

async function exportIcon(browser, { source, output, size }) {
    const svg = await readFile(path.join(iconDir, source), "utf8");

    // Transparent html/body so pixels outside the SVG's own painted shapes
    // (icon.svg's rounded rect corners) come out as alpha 0, not opaque
    // white — the OS then applies its own icon mask over real transparency.
    const html = `
        <!doctype html>
        <html>
            <head>
                <style>
                    html, body {
                        margin: 0;
                        padding: 0;
                        background: transparent;
                    }

                    svg {
                        display: block;
                        width: ${size}px;
                        height: ${size}px;
                    }
                </style>
            </head>
            <body>${svg}</body>
        </html>
    `;

    const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
    });

    try {
        await page.setContent(html);
        const buffer = await page.screenshot({ omitBackground: true });
        await writeFile(path.join(iconDir, output), buffer);
        console.log(`Exported ${path.join("src/resources/icons", output)} (${size}x${size})`);
    } finally {
        await page.close();
    }
}

async function main() {
    const browser = await chromium.launch();

    try {
        for (const icon of ICONS) {
            await exportIcon(browser, icon);
        }
    } finally {
        await browser.close();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
