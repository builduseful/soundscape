#!/usr/bin/env node
// Builds every published audio derivative from the masters.
//
// One soundscape has one identity and three output roles, and this script owns
// all of them:
//
//   opus/<id>.opus   local primary   one loop period, no baked crossfade
//   aac/<id>.m4a     local fallback  one loop period, no baked crossfade
//   cast/<id>.m4a    remote playback crossfade baked in, repeated to ~120s
//
// The first two are the same product in two containers: the app decodes them
// and applies its own loop crossfade at runtime, so baking one in would apply
// it twice. The third is a different product entirely — nothing on the far side
// of a cast reads loopStart/loopEnd, and no cast path wraps natively — which is
// why it cannot be produced by transcoding either of the others.
//
// Requires ffmpeg/ffprobe on PATH. Host-only — not part of npm test or the
// Docker image. See masters/AGENTS.md for where the inputs come from.
//
// Usage:
//   npm run audio                    every applicable target
//   npm run audio -- --opus          local primary only
//   npm run audio -- --aac           local fallback only
//   npm run audio -- --cast          cast twins only
//   npm run audio -- --placeholders  (re)generate the stand-in masters
//   npm run audio -- --masters <dir> read masters from somewhere else

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { applyLoopCrossfade } from "../src/js/audio-player.js";
import { localSourceFor } from "../src/js/local-source.js";
import { remoteUrlFor } from "../src/js/remote-playback/track-source.js";
import { tracks } from "../src/js/tracks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const soundscapeDir = path.join(repoRoot, "src", "resources", "soundscapes");
const opusDir = path.join(soundscapeDir, "opus");
const aacDir = path.join(soundscapeDir, "aac");
const castDir = path.join(soundscapeDir, "cast");

// Outside src/, so masters are never deployed. Their bytes are gitignored; the
// two JSON records beside them are tracked, because provenance that only exists
// on one laptop is not provenance.
const defaultMastersDir = path.join(repoRoot, "masters");

const PROVENANCE_FILE = "provenance.json";
const MANIFEST_FILE = "build-manifest.json";

// A master that is not a real original. Every derivative built from one says so,
// in the manifest and on the console, because the one thing this record must
// never do is let a stand-in be mistaken later for a recovered original.
const PLACEHOLDER = "opus-decoded-placeholder";
const MASTER = "master";

// --- Encoding profile ------------------------------------------------------

// Matched to the sources, which are 56-75 kbps mono Opus. Encoding above that
// spends bytes on detail the Opus encoder already discarded — AAC cannot
// reconstruct it — so a higher rate costs size and buys nothing audible. The
// bytes saved go into REPEAT_TO_SECONDS instead, where they are audible.
const AAC_BITRATE = "64k";

// The local fallback carries one loop period rather than two minutes of
// repeats, so it can afford a little more per second than the cast twin.
const LOCAL_AAC_BITRATE = "80k";

// Only ever used for a real master. While the input is a placeholder the
// published Opus stays exactly as it is — see buildOpus.
const OPUS_BITRATE = "64k";

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

// The seam at the end of the file is not a waveform problem and cannot be fixed
// like one. Every join *inside* the file is sample-adjacent and inaudible; the
// one the listener hears is where the receiver reaches the end and starts over,
// and Chromecast has never done that gaplessly — the device tears down and
// re-initialises its pipeline, which no amount of matching either side of the
// join can prevent.
//
// So the goal changes from "remove the gap" to "stop it being a click". Cutting
// from full amplitude to a gap and back is a step discontinuity, which is what
// makes it read as harsh; ramping the first and last few milliseconds to zero
// turns the same interruption into a brief dip. On broadband ambience — rain,
// noise, crackle — a 40 ms dip is very hard to hear, while the step is not.
const EDGE_FADE_MS = 40;

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

function applyEdgeFade(audio, channels, sampleRate) {
    const fadeFrames = Math.min(
        Math.round((EDGE_FADE_MS * sampleRate) / 1000),
        Math.floor(audio.length / channels / 2),
    );

    if (fadeFrames <= 0) return;

    for (let frame = 0; frame < fadeFrames; frame++) {
        // Equal-power rather than linear: the same curve the runtime crossfade
        // uses, and it holds perceived loudness steadier through the ramp.
        const gain = Math.sin((frame / fadeFrames) * (Math.PI / 2));
        const head = frame * channels;
        const tail = audio.length - head - channels;

        for (let channel = 0; channel < channels; channel++) {
            audio[head + channel] *= gain;
            audio[tail + channel] *= gain;
        }
    }
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

// --- Process plumbing ------------------------------------------------------

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
            `${command} was not found on PATH. Install ffmpeg (it ships ffprobe too) and re-run \`npm run audio\`.`,
        );
    }
}

async function encoderVersion() {
    const output = await run("ffmpeg", ["-version"]);
    const line = output.toString().split("\n")[0].trim();
    const token = line.match(/^ffmpeg version (\S+)/)?.[1] ?? line;

    // A git snapshot ("N-109362-g8ad4e46b62") has no release number to keep, so
    // it stays whole rather than being trimmed away to nothing.
    return `ffmpeg ${token.match(/^\d+(\.\d+)*/)?.[0] ?? token}`;
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

async function decodeToFloat(file) {
    const { sampleRate, channels } = await probe(file);
    const raw = await run("ffmpeg", [
        "-v", "error",
        "-i", file,
        "-f", "f32le",
        "-acodec", "pcm_f32le",
        "-ac", String(channels),
        "-ar", String(sampleRate),
        "-",
    ]);
    const interleaved = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

    return { interleaved, sampleRate, channels, frameCount: interleaved.length / channels };
}

function sha256(buffer) {
    return createHash("sha256").update(buffer).digest("hex");
}

async function sha256OfFile(file) {
    return sha256(await readFile(file));
}

// Writes beside the target and renames, so a failure anywhere leaves the
// existing file intact, and skips the write when nothing changed so a routine
// re-run leaves the git working tree clean (same contract as the icon and
// screenshot scripts).
async function writeIfChanged(outputFile, produce, describe) {
    const tempFile = `${outputFile}.tmp`;

    await mkdir(path.dirname(outputFile), { recursive: true });

    try {
        await produce(tempFile);

        const next = await readFile(tempFile);
        const previous = await readFile(outputFile).catch(() => null);

        const label = path.relative(repoRoot, outputFile).split(path.sep).join("/");

        if (previous && previous.equals(next)) {
            console.log(`unchanged  ${label}`);
            return { bytes: next, changed: false };
        }

        await rename(tempFile, outputFile);
        console.log(`wrote      ${label}  ${describe(next)}`);

        return { bytes: next, changed: true };
    } finally {
        await unlink(tempFile).catch(() => {});
    }
}

// --- Provenance ------------------------------------------------------------

async function readJson(file, fallback) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return fallback;
        throw error;
    }
}

async function writeJson(file, value) {
    await writeFile(file, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

/**
 * What each master is, and proof the file on disk is still that thing.
 *
 * The declaration is tracked; the bytes are not. So a clone can always read what
 * an input was *claimed* to be, and anyone actually holding the file can have
 * that claim checked. A hash mismatch is an error rather than a warning: it
 * means the declaration and the file have parted company, and every derivative
 * built from that point would carry a provenance record that is simply untrue.
 */
async function loadProvenance(mastersDir) {
    const declared = await readJson(path.join(mastersDir, PROVENANCE_FILE), null);

    if (!declared) {
        throw new Error(
            `No ${PROVENANCE_FILE} in ${mastersDir}.`
            + ` Run \`npm run audio -- --placeholders\` to create stand-in masters,`
            + ` or see masters/AGENTS.md to supply real ones.`,
        );
    }

    const entries = new Map();

    for (const track of tracks) {
        const record = declared[track.id];

        if (!record) {
            throw new Error(`${PROVENANCE_FILE} has no entry for "${track.id}".`);
        }

        const file = path.join(mastersDir, `${track.id}.wav`);
        const actual = await sha256OfFile(file).catch(() => null);

        if (actual === null) {
            throw new Error(
                `Master ${track.id}.wav is missing from ${mastersDir}.`
                + ` Its bytes are gitignored, so a fresh clone has none:`
                + ` run \`npm run audio -- --placeholders\` or supply the originals.`,
            );
        }

        if (actual !== record.sha256) {
            throw new Error(
                `Master ${track.id}.wav does not match ${PROVENANCE_FILE}.`
                + ` Declared ${record.sha256.slice(0, 12)}, found ${actual.slice(0, 12)}.`
                + ` Update the declaration if the change was deliberate.`,
            );
        }

        entries.set(track.id, { ...record, file, sha256: actual });
    }

    return entries;
}

/**
 * Stand-in masters, decoded from the published Opus.
 *
 * These are a production input, not a recovered original: decoding a lossy file
 * to PCM restores none of what the encoder discarded. They exist so the pipeline
 * has one shape whether or not the originals have turned up, and so the day they
 * do turn up is a file swap rather than a rewrite.
 */
async function generatePlaceholders(mastersDir) {
    await mkdir(mastersDir, { recursive: true });

    const declared = await readJson(path.join(mastersDir, PROVENANCE_FILE), {});

    for (const track of tracks) {
        const source = path.join(repoRoot, "src", localSourceFor(track).url);
        const target = path.join(mastersDir, `${track.id}.wav`);

        // A real master is never overwritten by a stand-in. Losing one to a
        // routine re-run would be unrecoverable from this repo, since master
        // bytes are deliberately not tracked.
        if (declared[track.id]?.kind === MASTER) {
            console.log(`kept       ${track.id}.wav  (a real master, not overwritten)`);
            continue;
        }

        await writeIfChanged(
            target,
            (tempFile) => run("ffmpeg", [
                "-v", "error",
                "-i", source,
                "-c:a", "pcm_s16le",
                "-f", "wav",
                "-y", tempFile,
            ]),
            (bytes) => `(${(bytes.length / 1024).toFixed(0)} KiB placeholder)`,
        );

        declared[track.id] = {
            kind: PLACEHOLDER,
            sha256: await sha256OfFile(target),
            decodedFrom: localSourceFor(track).url,
            note: "Decoded from the published Opus. Not an original; replace when one exists.",
        };
    }

    await writeJson(path.join(mastersDir, PROVENANCE_FILE), declared);
}

// --- Targets ---------------------------------------------------------------

/**
 * A real master has to arrive already finished. Downmixing a stereo original
 * changes its spatial content and normalising it changes its level against the
 * other soundscapes; both are editorial decisions belonging to whoever prepared
 * it, not to an encoder default. So this rejects rather than repairs.
 */
function assertProductionProfile(track, sampleRate, channels) {
    if (channels !== 1) {
        throw new Error(
            `Master for "${track.id}" has ${channels} channels. Masters must already be mono:`
            + ` an automatic downmix would make an artistic decision silently.`,
        );
    }

    if (sampleRate !== 48000) {
        throw new Error(`Master for "${track.id}" is ${sampleRate} Hz. Masters must be 48 kHz.`);
    }
}

/**
 * The local primary.
 *
 * Refuses to run while the input is a placeholder, which is not a limitation but
 * the point: the placeholder was itself decoded from this exact file, so
 * re-encoding it would spend a second lossy generation to arrive back where we
 * started, fractionally worse. The published Opus stays bit-for-bit as it is
 * until a real master exists to build it from.
 */
async function buildOpus(track, master) {
    if (master.kind === PLACEHOLDER) {
        console.log(`skipped    opus/${track.id}.opus  (input is a ${PLACEHOLDER}; keeping the published bitstream)`);
        return null;
    }

    const outputFile = path.join(opusDir, `${track.id}.opus`);
    const { sampleRate, channels } = await probe(master.file);

    assertProductionProfile(track, sampleRate, channels);

    const { bytes } = await writeIfChanged(
        outputFile,
        (tempFile) => run("ffmpeg", [
            "-v", "error",
            "-i", master.file,
            // A master may carry the tags of whoever recorded it, and ffmpeg
            // copies them to the output by default — which would ship a
            // person's name in src/.
            "-map_metadata", "-1",
            "-c:a", "libopus",
            "-b:a", OPUS_BITRATE,
            "-f", "ogg",
            "-y", tempFile,
        ]),
        (next) => `(${(next.length / 1024).toFixed(0)} KiB)`,
    );

    return {
        outputFile,
        bytes,
        transform: { codec: "libopus", bitrate: OPUS_BITRATE, sampleRate, channels, loopCrossfade: "runtime" },
    };
}

/**
 * The local fallback: the same product as the primary, in a container older
 * Safari can open. One loop period, no baked crossfade and no edge fade — the
 * app applies its own crossfade after decoding, and a baked one would be
 * applied twice.
 */
async function buildLocalAac(track, master) {
    const outputFile = path.join(aacDir, `${track.id}.m4a`);
    const source = sourceFor(track, master);
    const { interleaved, sampleRate, channels, frameCount } = await decodeToFloat(source);

    // Trimmed to a whole number of AAC frames before encoding, for the same
    // reason the cast build frame-aligns its crossfade — and it is worth being
    // precise about which half of AAC's gapless problem this fixes.
    //
    // Head priming is handled by the container's edit list and every decoder
    // honours it. The tail is not: a partial final frame is padded to 1024
    // samples, and measured here that added 198-783 samples to the decoded
    // buffer against the Opus original. The app loops by crossfading the end of
    // the decoded buffer into its start, so those padded samples land exactly
    // on the seam — up to 16 ms of encoder filler blended into the join, on
    // every wrap, forever.
    //
    // Dropping the remainder instead costs at most 1023 samples (21 ms) off a
    // loop period of 15-30 seconds, and leaves the decoded length exactly equal
    // to the intended one.
    const alignedFrames = Math.floor(frameCount / AAC_FRAME_SAMPLES) * AAC_FRAME_SAMPLES;

    if (alignedFrames === 0) {
        throw new Error(`${track.id}: shorter than one AAC frame`);
    }

    const audio = interleaved.subarray(0, alignedFrames * channels);

    const { bytes } = await writeIfChanged(
        outputFile,
        (tempFile) => run("ffmpeg", [
            "-v", "error",
            "-f", "f32le",
            "-ar", String(sampleRate),
            "-ac", String(channels),
            "-i", "-",
            "-c:a", "aac",
            "-b:a", LOCAL_AAC_BITRATE,
            "-f", "mp4",
            "-movflags", "+faststart",
            "-y", tempFile,
        ], { input: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength) }),
        (next) => `(${(next.length / 1024).toFixed(0)} KiB fallback,`
            + ` ${(alignedFrames / sampleRate).toFixed(2)}s,`
            + ` ${frameCount - alignedFrames} frames trimmed)`,
    );

    return {
        outputFile,
        bytes,
        transform: {
            codec: "aac",
            bitrate: LOCAL_AAC_BITRATE,
            sampleRate,
            channels,
            loopCrossfade: "runtime",
            frameAlignedSamples: alignedFrames,
            trimmedSamples: frameCount - alignedFrames,
        },
    };
}

/**
 * The cast twin: a different product, built the way a receiver needs it.
 *
 * Imports the app's own applyLoopCrossfade so the baked treatment and the
 * runtime one cannot drift.
 */
async function buildCast(track, master) {
    const outputFile = path.join(castDir, `${track.id}.m4a`);
    const source = sourceFor(track, master);

    const { interleaved, sampleRate, channels, frameCount } = await decodeToFloat(source);
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
        throw new Error(`${track.id}: loop period ${loopFrames} is not a whole number of AAC frames`);
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

    applyEdgeFade(audio, channels, sampleRate);

    const { bytes } = await writeIfChanged(
        outputFile,
        (tempFile) => run("ffmpeg", [
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
        ], { input: Buffer.from(audio.buffer) }),
        (next) => `(${(next.length / 1024).toFixed(0)} KiB,`
            + ` ${(loopFrames / sampleRate).toFixed(2)}s loop × ${repeats}`
            + ` = ${((loopFrames * repeats) / sampleRate).toFixed(0)}s,`
            + ` ${(overlap / (sampleRate / 1000)).toFixed(1)}ms crossfade)`,
    );

    return {
        outputFile,
        bytes,
        transform: {
            codec: "aac",
            bitrate: AAC_BITRATE,
            sampleRate,
            channels,
            loopCrossfadeMs: Number(((overlap * 1000) / sampleRate).toFixed(3)),
            edgeFadeMs: EDGE_FADE_MS,
            repeats,
            loopSeconds: Number((loopFrames / sampleRate).toFixed(3)),
        },
    };
}

/**
 * Which file a derivative is actually built from.
 *
 * With a real master, that is the master. With a placeholder it is the published
 * Opus instead — the placeholder was decoded from exactly those samples, so
 * reading the Opus directly is the same audio with one less conversion, and it
 * keeps the build working on a clone that has no master bytes.
 */
function sourceFor(track, master) {
    return master.kind === PLACEHOLDER
        ? path.join(repoRoot, "src", localSourceFor(track).url)
        : master.file;
}

async function inputRecordFor(track, master, target) {
    // buildOpus only ever runs against a real master, so it alone always records
    // the master itself.
    if (master.kind !== PLACEHOLDER || target === "opus") {
        return {
            provenance: master.kind,
            file: path.relative(repoRoot, master.file).split(path.sep).join("/"),
            sha256: master.sha256,
        };
    }

    const publishedOpus = localSourceFor(track).url;

    return {
        provenance: master.kind,
        file: publishedOpus,
        sha256: await sha256OfFile(path.join(repoRoot, "src", publishedOpus)),
        note: `Read the published Opus directly; the ${PLACEHOLDER} was decoded from it.`,
    };
}

// --- Entry point -----------------------------------------------------------

function parseArgs(argv) {
    const flags = new Set();
    let mastersDir = defaultMastersDir;

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];

        if (arg === "--masters") {
            mastersDir = path.resolve(argv[++index] ?? "");
            continue;
        }

        if (arg.startsWith("--")) {
            flags.add(arg.slice(2));
            continue;
        }

        throw new Error(`Unexpected argument: ${arg}`);
    }

    const known = new Set(["opus", "aac", "cast", "placeholders"]);
    const unknown = [...flags].filter((flag) => !known.has(flag));

    if (unknown.length > 0) {
        throw new Error(`Unknown option(s): ${unknown.map((flag) => `--${flag}`).join(", ")}`);
    }

    const requested = ["opus", "aac", "cast"].filter((target) => flags.has(target));

    return {
        mastersDir,
        placeholders: flags.has("placeholders"),
        requestedTargets: requested,
        // No target flag means every applicable target, which is what a bare
        // `npm run audio` should do.
        targets: requested.length > 0 ? requested : ["opus", "aac", "cast"],
    };
}

const options = parseArgs(process.argv.slice(2));

await requireTool("ffmpeg");
await requireTool("ffprobe");

if (options.placeholders) {
    console.log(`Generating stand-in masters in ${path.relative(repoRoot, options.mastersDir)}/\n`);
    await generatePlaceholders(options.mastersDir);

    if (options.requestedTargets.length === 0) {
        console.log("\nDone. Masters only — pass --opus, --aac or --cast to build derivatives.");
        process.exit(0);
    }
}

const masters = await loadProvenance(options.mastersDir);
const encoder = await encoderVersion();
const builders = { opus: buildOpus, aac: buildLocalAac, cast: buildCast };
const manifest = await readJson(path.join(options.mastersDir, MANIFEST_FILE), {});

for (const target of options.targets) {
    console.log(`\n${target}:`);

    for (const track of tracks) {
        const master = masters.get(track.id);
        const result = await builders[target](track, master);

        if (!result) continue;

        const key = `${target}/${track.id}`;
        const outputSha256 = sha256(result.bytes);

        // A re-run with identical bytes must not restamp encoder and builtAt:
        // both move with the machine and the calendar, so re-recording them
        // makes a diff out of a build that changed nothing.
        if (manifest[key]?.outputSha256 === outputSha256) continue;

        manifest[key] = {
            id: track.id,
            role: target,
            output: path.relative(path.join(repoRoot, "src"), result.outputFile).split(path.sep).join("/"),
            outputSha256,
            input: await inputRecordFor(track, master, target),
            transform: result.transform,
            encoder,
            builtAt: new Date().toISOString().slice(0, 10),
        };
    }
}

await writeJson(path.join(options.mastersDir, MANIFEST_FILE), manifest);
console.log(`\nProvenance recorded in ${path.relative(repoRoot, path.join(options.mastersDir, MANIFEST_FILE))}`);

// A stale derivative would keep passing its inventory test while naming a track
// that no longer exists, so flag orphans rather than silently leaving them.
const ids = new Set(tracks.map((track) => track.id));

for (const [directory, extension] of [[opusDir, ".opus"], [aacDir, ".m4a"], [castDir, ".m4a"]]) {
    const orphans = (await readdir(directory).catch(() => []))
        .filter((fileName) => fileName.endsWith(extension))
        .filter((fileName) => !ids.has(path.basename(fileName, extension)));

    if (orphans.length > 0) {
        console.warn(`\nOrphaned audio in ${path.basename(directory)}/ with no track: ${orphans.join(", ")}`);
    }
}

// The cast path is imported from the app's own resolver rather than spelled
// again here, so this fails loudly if the two ever stop agreeing.
if (remoteUrlFor(tracks[0]) !== `resources/soundscapes/cast/${tracks[0].id}.m4a`) {
    throw new Error("The cast resolver and this script disagree about where cast audio lives.");
}
