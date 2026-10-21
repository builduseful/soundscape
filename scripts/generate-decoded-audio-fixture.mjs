#!/usr/bin/env node
// Writes shared/fixtures/decoded-audio.json: what each published soundscape
// decodes to, according to ffmpeg — its length in frames and its first and
// last samples. A platform's own decoder is held to it, which is how a
// dropped pre-skip, an ignored edit list or tail padding shows up: as a length
// that differs, or edges that do not line up.
//
// Requires ffmpeg on PATH. Re-run after the audio build changes any file.
//
// Usage: node scripts/generate-decoded-audio-fixture.mjs

import { spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const soundscapes = path.join(repoRoot, "web", "src", "resources", "soundscapes");
const output = path.join(repoRoot, "shared", "fixtures", "decoded-audio.json");
const EDGE_FRAMES = 32;

const { tracks } = JSON.parse(await readFile(path.join(repoRoot, "shared", "catalog.json"), "utf8"));

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args);
        const stdout = [];
        const stderr = [];
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (code) => code === 0
            ? resolve(Buffer.concat(stdout))
            : reject(new Error(`${command} exited ${code}: ${Buffer.concat(stderr)}`)));
    });
}

async function describe(file) {
    const probe = JSON.parse(await run("ffprobe", [
        "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels", "-of", "json", file,
    ]));
    const { sample_rate: sampleRate, channels } = probe.streams[0];
    const pcm = await run("ffmpeg", ["-v", "error", "-i", file, "-f", "f32le", "-"]);
    const samples = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
    const frames = samples.length / channels;
    const round = (value) => Math.round(value * 1e6) / 1e6;

    return {
        sampleRate: Number(sampleRate),
        channels,
        frames,
        // Interleaved, as decoders deliver it.
        head: Array.from(samples.subarray(0, EDGE_FRAMES * channels), round),
        tail: Array.from(samples.subarray(samples.length - EDGE_FRAMES * channels), round),
    };
}

const files = {};
for (const directory of ["opus", "aac"]) {
    const names = new Set(await readdir(path.join(soundscapes, directory)));
    for (const { id } of tracks) {
        const name = `${id}.${directory === "opus" ? "opus" : "m4a"}`;
        if (!names.has(name)) throw new Error(`Missing ${directory}/${name}`);
        files[`${directory}/${name}`] = await describe(path.join(soundscapes, directory, name));
    }
}

// The version alone: the rest of the banner names whichever build is installed.
const banner = (await run("ffmpeg", ["-version"])).toString();
const ffmpegVersion = `ffmpeg ${/ffmpeg version (\d+(?:\.\d+)*)/u.exec(banner)?.[1] ?? "unknown"}`;
await writeFile(output, `${JSON.stringify({ decoder: ffmpegVersion, edgeFrames: EDGE_FRAMES, files }, null, 4)}\n`);
console.log(`wrote ${path.relative(repoRoot, output).split(path.sep).join("/")} (${Object.keys(files).length} files)`);
