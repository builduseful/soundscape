#!/usr/bin/env node
// Builds the AAC twins that cast targets play, from the Opus originals.
//
// A cast asset differs from the local one three ways. The codec must be one
// every target accepts, which rules Opus out. The loop crossfade has to be baked
// in, because nothing on the far side of a cast reads loopStart/loopEnd. And the
// crossfaded period is written out repeatedly, because no cast path wraps
// natively — each one seeks, and a seek is audible, so the file's own length is
// what decides how often that happens. All three are covered in AGENTS.md under
// Casting Invariants; the transform here imports the app's own
// applyLoopCrossfade so the two can never drift.
//
// Requires ffmpeg/ffprobe on PATH. Host-only — not part of npm test or the
// Docker image. Re-run after replacing any .opus source.
//
// Usage: npm run cast-audio

import { spawn } from "node:child_process";
import { readdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyLoopCrossfade } from "../src/js/audio-player.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const soundscapeDir = path.join(__dirname, "..", "src", "resources", "soundscapes");

// Matched to the sources, which are 56–75 kbps mono Opus. Encoding above that
// spends bytes on detail the Opus encoder already discarded — AAC cannot
// reconstruct it — so a higher rate costs size and buys nothing audible. The
// bytes saved go into REPEAT_TO_SECONDS instead, where they are audible.
const AAC_BITRATE = "64k";

// The loop is written out repeatedly rather than once.
//
// No cast path performs a native wrap: Chrome desktop remotes the stream and
// Safari drives AirPlay, and both implement `loop` in the browser as a seek back
// to zero, which flushes the receiver's buffer and is audible. Chrome Android
// does not loop at all (see AGENTS.md). Repeating the trimmed period inside the
// file is bit-exact — every internal join is the same sample-adjacent seam the
// crossfade already built — so the only audible seam is the one at the end of
// the file, and length is what decides how often it comes round.
//
// Two minutes is the balance point: ~1 MB per twin at the bitrate above, and it
// clears by a wide margin the 15 s floor below which Chromium refuses to remote
// a file at all. Raising it is one constant and costs only bytes.
const REPEAT_TO_SECONDS = 120;

// AAC codes in 1024-sample frames. A loop period that is not a whole number of
// frames leaves a partial final frame, which the encoder pads with silence —
// and that padding lands exactly on the loop seam, so a receiver that does not
// honour the container's edit list plays ~5 ms of silence and a click on every
// wrap. Stretching the crossfade to the next frame boundary removes the partial
// frame entirely; measured, it takes the padding from ~224 samples to 0.
const AAC_FRAME_SAMPLES = 1024;
const MIN_CROSSFADE_MS = 10;

// Encoder delay at the head is the other half of AAC's gapless problem, and it
// is not ours to remove: it is intrinsic to the codec, which is why the edit
// list exists. Every gapless-aware receiver honours it.
function frameAlignedOverlap(frameCount, sampleRate) {
    let overlap = Math.max(1, Math.round((MIN_CROSSFADE_MS * sampleRate) / 1000));

    while ((frameCount - overlap) % AAC_FRAME_SAMPLES !== 0) {
        overlap++;
    }

    return overlap;
}

// applyLoopCrossfade only ever calls createBuffer on the context it is given,
// so this is the whole of the Web Audio surface it needs outside a browser.
const offlineAudioContextShim = {
    createBuffer(numberOfChannels, length, sampleRate) {
        const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));

        return {
            sampleRate,
            numberOfChannels,
            length,
            getChannelData: (channel) => channels[channel],
        };
    },
};

async function run(command, args, { input } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
        const stdout = [];
        const stderr = [];

        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`${command} exited with ${code}\n${Buffer.concat(stderr).toString()}`));
                return;
            }

            resolve(Buffer.concat(stdout));
        });

        if (input) child.stdin.end(input);
        else child.stdin.end();
    });
}

async function probe(file) {
    const output = await run("ffprobe", [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels",
        "-of", "json",
        file,
    ]);
    const stream = JSON.parse(output.toString()).streams?.[0];

    if (!stream) throw new Error(`No audio stream in ${file}`);

    return { sampleRate: Number(stream.sample_rate), channels: Number(stream.channels) };
}

// ffmpeg writes interleaved frames; Web Audio buffers are planar.
function deinterleave(interleaved, channels, frameCount) {
    const planes = Array.from({ length: channels }, () => new Float32Array(frameCount));

    for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            planes[channel][frame] = interleaved[frame * channels + channel];
        }
    }

    return planes;
}

function interleave(planes, channels, frameCount) {
    const interleaved = new Float32Array(frameCount * channels);

    for (let frame = 0; frame < frameCount; frame++) {
        for (let channel = 0; channel < channels; channel++) {
            interleaved[frame * channels + channel] = planes[channel][frame];
        }
    }

    return interleaved;
}

async function buildCastAudio(fileName) {
    const sourceFile = path.join(soundscapeDir, fileName);
    const outputFile = path.join(soundscapeDir, fileName.replace(/\.opus$/u, ".m4a"));
    const { sampleRate, channels } = await probe(sourceFile);

    const raw = await run("ffmpeg", [
        "-v", "error",
        "-i", sourceFile,
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        "-ac", String(channels),
        "-ar", String(sampleRate),
        "-",
    ]);

    const interleaved = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    const frameCount = interleaved.length / channels;
    const planes = deinterleave(interleaved, channels, frameCount);

    const sourceBuffer = {
        sampleRate,
        numberOfChannels: channels,
        length: frameCount,
        getChannelData: (channel) => planes[channel],
    };

    const overlap = frameAlignedOverlap(frameCount, sampleRate);
    const { buffer, loopEnd } = applyLoopCrossfade(
        sourceBuffer,
        offlineAudioContextShim,
        (overlap * 1000) / sampleRate,
    );
    // applyLoopCrossfade returns a full-length buffer plus the loop period to
    // play. A native loop has no loopEnd to honour, so the period becomes the
    // file: everything past it is the pre-crossfade tail and must not ship.
    const loopFrames = Math.round(loopEnd * sampleRate);

    // The crossfade length is derived through milliseconds, so a rounding slip
    // would silently reintroduce the partial frame this is all here to avoid.
    if (loopFrames % AAC_FRAME_SAMPLES !== 0) {
        throw new Error(
            `${fileName}: loop period ${loopFrames} is not a whole number of AAC frames`,
        );
    }
    const trimmed = Array.from(
        { length: channels },
        (unused, channel) => buffer.getChannelData(channel).subarray(0, loopFrames),
    );

    // Repeating the period keeps frame alignment — a whole number of AAC frames
    // times a whole number is still whole — so the encoder still has no partial
    // final frame to pad, and every internal join is sample-adjacent.
    const repeats = Math.max(1, Math.ceil((REPEAT_TO_SECONDS * sampleRate) / loopFrames));
    const period = interleave(trimmed, channels, loopFrames);
    const audio = new Float32Array(period.length * repeats);

    for (let repeat = 0; repeat < repeats; repeat++) {
        audio.set(period, repeat * period.length);
    }

    // Encoded beside the output rather than over it, so a failure anywhere below
    // leaves the existing twin intact. The finally clears the temp file whether
    // it was consumed by the rename or abandoned by a throw — otherwise a failed
    // run leaves a .m4a.tmp in the deploy folder that no test looks for.
    const tempFile = `${outputFile}.tmp`;

    try {
        await run("ffmpeg", [
            "-v", "error",
            "-f", "f32le",
            "-ar", String(sampleRate),
            "-ac", String(channels),
            "-i", "-",
            "-c:a", "aac",
            "-b:a", AAC_BITRATE,
            "-f", "mp4",
            // Without this the index lands after the audio, so nothing can read
            // the duration without reaching the end of the file. Two things
            // depend on it: preload="metadata" on the cast element, which is
            // what makes Chrome report a device at all, and the Android
            // receiver, which otherwise hunts for the index before it can play.
            "-movflags", "+faststart",
            "-y", tempFile,
        ], { input: Buffer.from(audio.buffer) });

        const next = await readFile(tempFile);
        const previous = await readFile(outputFile).catch(() => null);

        // Skip the write when nothing changed, so a re-run leaves the git working
        // tree clean (same contract as the icon and screenshot scripts).
        if (previous && previous.equals(next)) {
            console.log(`unchanged  ${path.basename(outputFile)}`);
            return;
        }

        await rename(tempFile, outputFile);
        console.log(
            `wrote      ${path.basename(outputFile)}`
            + `  (${(next.length / 1024).toFixed(0)} KiB,`
            + ` ${(loopFrames / sampleRate).toFixed(2)}s loop × ${repeats}`
            + ` = ${((loopFrames * repeats) / sampleRate).toFixed(0)}s,`
            + ` ${(overlap / (sampleRate / 1000)).toFixed(1)}ms crossfade)`,
        );
    } finally {
        await unlink(tempFile).catch(() => {});
    }
}

// Without this, a missing tool surfaces as the operating system's raw
// "no such file" failure (ENOENT), which names the binary but not what to do
// about it. This script is host-only — the container image deliberately has no
// ffmpeg — so the person hitting it is being told to install something, not
// that they broke something.
async function requireTool(command) {
    try {
        await run(command, ["-version"]);
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;

        throw new Error(
            `${command} was not found on PATH. Install ffmpeg (it ships ffprobe too) and re-run \`npm run cast-audio\`.`,
        );
    }
}

await requireTool("ffmpeg");
await requireTool("ffprobe");

const sources = (await readdir(soundscapeDir))
    .filter((fileName) => fileName.endsWith(".opus"))
    .sort();

if (sources.length === 0) {
    throw new Error(`No .opus sources found in ${soundscapeDir}`);
}

for (const fileName of sources) {
    await buildCastAudio(fileName);
}

// A stale twin would keep passing the catalog test while pointing at audio that
// no longer exists in Opus form, so flag orphans rather than silently leaving them.
const orphans = (await readdir(soundscapeDir))
    .filter((fileName) => fileName.endsWith(".m4a"))
    .filter((fileName) => !sources.includes(fileName.replace(/\.m4a$/u, ".opus")));

if (orphans.length > 0) {
    console.warn(`\nOrphaned cast audio with no .opus source: ${orphans.join(", ")}`);
}
