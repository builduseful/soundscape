#!/usr/bin/env node
// Captures the web and Android screens in every window of
// shared/fixtures/layout.json, light and dark, and writes
// .temp/parity/report.html: each pair side by side with a pixel diff. Advisory,
// for a person to look over — LayoutParityTest is what gates where things sit;
// this shows what it cannot, such as colour, type and glyphs.
//
// Usage, from the repository root:
//   node scripts/parity-report.mjs              # capture both, then report
//   node scripts/parity-report.mjs --no-capture # report on the last capture
// Capturing needs what web/scripts/capture-parity.mjs and
// android/scripts/capture-parity.mjs each need (Playwright; the Android SDK and
// an emulator).

import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const parityDir = path.join(repoDir, ".temp", "parity");
const PLATFORMS = ["web", "android"];

if (!process.argv.includes("--no-capture")) {
    for (const platform of PLATFORMS) {
        execFileSync(process.execPath, [path.join(repoDir, platform, "scripts", "capture-parity.mjs")], { stdio: "inherit" });
    }
}

const { windows } = JSON.parse(await readFile(path.join(repoDir, "shared", "fixtures", "layout.json"), "utf8"));
const captured = Object.fromEntries(await Promise.all(PLATFORMS.map(async (platform) => [
    platform,
    new Set(await readdir(path.join(parityDir, platform)).catch(() => [])),
])));

async function dataUri(platform, name) {
    if (!captured[platform].has(name)) return null;
    return `data:image/png;base64,${(await readFile(path.join(parityDir, platform, name))).toString("base64")}`;
}

const sections = [];
for (const { width, height } of windows) {
    const rows = [];
    for (const theme of ["light", "dark"]) {
        const name = `${width}x${height}-${theme}.png`;
        const [web, android] = await Promise.all(PLATFORMS.map((platform) => dataUri(platform, name)));
        const image = (src, label) => src
            ? `<figure><img src="${src}" alt="${label}"><figcaption>${label}</figcaption></figure>`
            : `<figure class="missing"><div>Not captured</div><figcaption>${label}</figcaption></figure>`;
        rows.push(`<div class="row" style="--w:${width};--h:${height}">
      ${image(web, `Web, ${theme}`)}
      ${image(android, `Android, ${theme}`)}
      <figure><canvas width="${width * 2}" height="${height * 2}"></canvas><figcaption>Difference, ${theme}: <span class="score">…</span></figcaption></figure>
    </div>`);
    }
    sections.push(`<section><h2>${width} × ${height}</h2>${rows.join("\n")}</section>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parity report</title>
<style>
  :root { color-scheme: light dark; --page: #f6f6f4; --text: #1f1f1f; --muted: #666; --card: #fff; --line: #ddd; }
  @media (prefers-color-scheme: dark) { :root { --page: #161616; --text: #eee; --muted: #aaa; --card: #222; --line: #333; } }
  body { margin: 0; padding: 24px 16px 64px; background: var(--page); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  p { margin: 0 0 24px; color: var(--muted); max-width: 70ch; }
  h2 { font-size: 17px; margin: 32px 0 12px; }
  .row { display: grid; grid-template-columns: repeat(3, minmax(0, calc(var(--w) * 1px))); gap: 12px; margin-bottom: 16px; }
  figure { margin: 0; min-width: 0; }
  img, canvas, .missing div { display: block; width: 100%; aspect-ratio: var(--w) / var(--h); border: 1px solid var(--line); background: var(--card); }
  .missing div { display: grid; place-items: center; color: var(--muted); }
  figcaption { font-size: 13px; color: var(--muted); margin-top: 4px; }
  @media (max-width: 700px) { .row { grid-template-columns: minmax(0, calc(var(--w) * 1px)); } }
</style>
</head>
<body>
<h1>Web and Android, side by side</h1>
<p>Each window of shared/fixtures/layout.json, with the first soundscape paused and no motion. The difference shows the web faded, and in red every pixel where the two differ by more than an eighth in any channel. Advisory: type is the system's on each platform, so text always differs a little.</p>
${sections.join("\n")}
<script>
  const load = (img) => img.complete ? Promise.resolve(img) : new Promise((done) => img.addEventListener("load", () => done(img)));
  for (const row of document.querySelectorAll(".row")) {
    const [web, android] = row.querySelectorAll("img");
    const canvas = row.querySelector("canvas");
    const score = row.querySelector(".score");
    if (!web || !android) { score.textContent = "needs both"; continue; }
    Promise.all([load(web), load(android)]).then(() => {
      const { width, height } = canvas;
      const pixels = (img) => {
        const scratch = new OffscreenCanvas(width, height).getContext("2d");
        scratch.drawImage(img, 0, 0, width, height);
        return scratch.getImageData(0, 0, width, height).data;
      };
      const a = pixels(web), b = pixels(android);
      const context = canvas.getContext("2d");
      const out = context.createImageData(width, height);
      let differing = 0;
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        if (delta > 32) {
          differing++;
          out.data.set([230, 30, 60, 255], i);
        } else {
          const grey = 255 - (255 - (a[i] + a[i + 1] + a[i + 2]) / 3) * 0.25;
          out.data.set([grey, grey, grey, 255], i);
        }
      }
      context.putImageData(out, 0, 0);
      score.textContent = (differing / (width * height) * 100).toFixed(2) + "% of pixels differ";
    });
  }
</script>
</body>
</html>
`;
await mkdir(parityDir, { recursive: true });
await writeFile(path.join(parityDir, "report.html"), html);
console.log("wrote: .temp/parity/report.html");
