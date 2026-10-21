#!/usr/bin/env node
// Writes shared/fixtures/loop-crossfade.json: golden vectors for the loop
// crossfade, computed in double precision straight from the formula in
// shared/AGENTS.md — deliberately not from any platform's implementation, so
// the fixture can catch one.
//
// Usage: node scripts/generate-loop-crossfade-fixture.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(repoRoot, "shared", "fixtures", "loop-crossfade.json");

const round = (value) => Math.round(value * 1e6) / 1e6;

// Smooth but not periodic, so no wrap is accidentally seamless.
const signal = (length, seed) =>
    Array.from({ length }, (_, i) => round(0.8 * Math.sin(i * 0.37 + seed) * Math.cos(i * 0.11 + seed * 2)));

function crossfade(channels, sampleRate, crossfadeMs) {
    const length = channels[0].length;
    const overlapSamples = Math.min(
        Math.max(1, Math.round((crossfadeMs * sampleRate) / 1000)),
        Math.floor(length / 2),
    );
    const loopEndSamples = length - overlapSamples;

    return {
        overlapSamples,
        loopEndSamples,
        channels: channels.map((source) => source.map((sample, i) => {
            if (i >= overlapSamples) return sample;
            const t = i / overlapSamples;
            return round(source[loopEndSamples + i] * Math.cos((t * Math.PI) / 2) + sample * Math.sin((t * Math.PI) / 2));
        })),
    };
}

const cases = [
    ["mono, 10 ms at 1 kHz", 1000, 10, [signal(30, 0.1)]],
    ["stereo, 10 ms at 2 kHz", 2000, 10, [signal(50, 0.3), signal(50, 1.7)]],
    ["overlap clamped to half the buffer", 1000, 10, [signal(8, 2.2)]],
    ["overlap never below one sample", 100, 1, [signal(6, 0.9)]],
].map(([name, sampleRate, crossfadeMs, channels]) => ({
    name,
    input: { sampleRate, crossfadeMs, channels },
    expected: crossfade(channels, sampleRate, crossfadeMs),
}));

await writeFile(output, `${JSON.stringify({ tolerance: 1e-6, cases }, null, 4)}\n`);
console.log(`wrote ${path.relative(repoRoot, output).split(path.sep).join("/")}`);
