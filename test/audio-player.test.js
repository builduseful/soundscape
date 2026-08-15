import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { applyLoopCrossfade, AudioPlayer } from "../src/js/audio-player.js";

const originalAudioContext = globalThis.AudioContext;
const originalFetch = globalThis.fetch;

// The fake decodeAudioData below yields `30 * (byteLength / 8)` seconds at
// 48 kHz. applyLoopCrossfade then trims the loop by the 10 ms overlap, so the
// looping period is shorter than the decoded duration — mirror that here rather
// than hardcoding, so the expectation tracks the implementation.
function loopEndForDuration(durationSeconds, sampleRate = 48000, crossfadeMs = 10) {
    const length = Math.round(sampleRate * durationSeconds);
    const overlap = Math.min(
        Math.max(1, Math.round((crossfadeMs * sampleRate) / 1000)),
        Math.floor(length / 2),
    );

    return (length - overlap) / sampleRate;
}

const originalConsoleWarn = console.warn;

afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    globalThis.fetch = originalFetch;
    console.warn = originalConsoleWarn;
});

function createAudioElement() {
    return {
        paused: true,
        src: "",
        loop: false,
        currentTime: 0,
        loadCalls: 0,
        playCalls: 0,
        pauseCalls: 0,
        canPlayType() {
            return "probably";
        },
        load() {
            this.loadCalls += 1;
        },
        async play() {
            this.playCalls += 1;
            this.paused = false;
        },
        pause() {
            this.pauseCalls += 1;
            this.paused = true;
        },
    };
}

function installAudioContext({ initialState = "suspended" } = {}) {
    const contexts = [];

    globalThis.AudioContext = class FakeAudioContext {
        state = initialState;
        currentTime = 12;
        destination = { type: "destination" };
        mediaSources = [];
        bufferSources = [];
        gains = [];
        createdBuffers = [];
        decodedBuffers = [];
        eventHandlers = new Map();
        resumeCalls = 0;
        suspendCalls = 0;

        constructor() {
            contexts.push(this);
        }

        createMediaElementSource(audioElement) {
            const source = {
                audioElement,
                connectedTo: undefined,
                connect(node) {
                    this.connectedTo = node;
                    return node;
                },
            };

            this.mediaSources.push(source);
            return source;
        }

        createGain() {
            const gainNode = {
                connectedTo: undefined,
                gain: {
                    value: 1,
                    cancelledAt: undefined,
                    setAt: undefined,
                    rampedTo: undefined,
                    valueCurve: undefined,
                    cancelScheduledValues(when) {
                        this.cancelledAt = when;
                    },
                    setValueAtTime(value, when) {
                        this.setAt = { value, when };
                    },
                    linearRampToValueAtTime(value, when) {
                        this.rampedTo = { value, when };
                    },
                    setValueCurveAtTime(curve, when, duration) {
                        this.valueCurve = { curve, when, duration };
                    },
                },
                connect(node) {
                    this.connectedTo = node;
                    return node;
                },
            };

            this.gains.push(gainNode);
            return gainNode;
        }

        createBuffer(numberOfChannels, length, sampleRate) {
            const channels = [];
            for (let i = 0; i < numberOfChannels; i++) {
                channels.push(new Float32Array(length));
            }

            const buffer = {
                sampleRate,
                numberOfChannels,
                length,
                duration: length / sampleRate,
                getChannelData(ch) {
                    return channels[ch];
                },
                copyToChannel(data, ch) {
                    channels[ch].set(data);
                },
            };

            this.createdBuffers.push(buffer);
            return buffer;
        }

        addEventListener(type, handler) {
            this.eventHandlers.set(type, handler);
        }

        dispatch(type) {
            this.eventHandlers.get(type)?.();
        }

        createBufferSource() {
            const source = {
                buffer: undefined,
                loop: false,
                connectedTo: undefined,
                startCalls: [],
                stopCalls: 0,
                connect(node) {
                    this.connectedTo = node;
                    return node;
                },
                disconnect(node) {
                    if (!node || this.connectedTo === node) {
                        this.connectedTo = undefined;
                    }
                },
                start(when) {
                    this.startCalls.push(when);
                },
                stop() {
                    this.stopCalls += 1;
                },
            };

            this.bufferSources.push(source);
            return source;
        }

        async decodeAudioData(arrayBuffer) {
            const sampleRate = 48000;
            const duration = 30 * (arrayBuffer.byteLength / 8);
            const length = Math.round(sampleRate * duration);
            const channels = [];
            for (let ch = 0; ch < 1; ch++) {
                const data = new Float32Array(length);
                // Fill with a simple non-zero signal so crossfade changes are observable.
                for (let i = 0; i < length; i++) {
                    data[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
                }
                channels.push(data);
            }

            const decodedBuffer = {
                arrayBuffer,
                sampleRate,
                numberOfChannels: channels.length,
                length,
                duration,
                getChannelData(ch) {
                    return channels[ch];
                },
                copyToChannel(data, ch) {
                    channels[ch].set(data);
                },
            };

            this.decodedBuffers.push(decodedBuffer);
            return decodedBuffer;
        }

        async resume() {
            this.resumeCalls += 1;
            this.state = "running";
        }

        async suspend() {
            this.suspendCalls += 1;
            this.state = "suspended";
        }
    };

    return contexts;
}

function installFetch() {
    const calls = [];

    globalThis.fetch = async (url) => {
        calls.push(url);

        return {
            ok: true,
            async arrayBuffer() {
                return new ArrayBuffer(8);
            },
        };
    };

    return calls;
}

function installDeferredFetch() {
    const requests = [];

    globalThis.fetch = (url) => new Promise((resolve) => {
        const request = {
            url,
            resolveWithBytes(byteLength = 8) {
                resolve({
                    ok: true,
                    async arrayBuffer() {
                        return new ArrayBuffer(byteLength);
                    },
                });
            },
        };

        requests.push(request);
    });

    return requests;
}

function createFakeAudioContextForCrossfade() {
    const buffers = [];

    const context = {
        buffers,
        createBuffer(numberOfChannels, length, sampleRate) {
            const channels = [];
            for (let i = 0; i < numberOfChannels; i++) {
                channels.push(new Float32Array(length));
            }

            const buffer = {
                sampleRate,
                numberOfChannels,
                length,
                duration: length / sampleRate,
                getChannelData(ch) {
                    return channels[ch];
                },
                copyToChannel(data, ch) {
                    channels[ch].set(data);
                },
            };

            buffers.push(buffer);
            return buffer;
        },
    };

    return context;
}

// Deterministic lowpass ("pink-ish") noise, which is what these ambience files
// actually are: neighbouring samples are close, distant ones are unrelated.
// That gap is what makes a loop seam audible and what a correct crossfade has to
// close. An earlier version of this suite filled the head with a flat plateau,
// so the seam measured zero even when the join was genuinely discontinuous.
function fillWithNoise(data, seed) {
    let state = seed;
    let smoothed = 0;

    for (let i = 0; i < data.length; i++) {
        state = (state * 1664525 + 1013904223) % 4294967296;
        smoothed = 0.98 * smoothed + 0.02 * ((state / 4294967296) * 2 - 1);
        data[i] = smoothed * 5;
    }
}

function overlapSamplesFor(length, sampleRate, crossfadeMs = 10) {
    return Math.min(
        Math.max(1, Math.round((crossfadeMs * sampleRate) / 1000)),
        Math.floor(length / 2),
    );
}

test("applyLoopCrossfade shortens the loop period by the overlap", () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const fakeContext = createFakeAudioContextForCrossfade();
    const source = fakeContext.createBuffer(1, length, sampleRate);
    fillWithNoise(source.getChannelData(0), 7);

    const { buffer, loopStart, loopEnd } = applyLoopCrossfade(source, fakeContext, 10);
    const overlap = overlapSamplesFor(length, sampleRate);

    assert.equal(loopStart, 0);
    // The trim is what makes the join continuous. Keeping the full length here
    // would leave the wrap jumping backwards by the overlap.
    assert.equal(Math.round(loopEnd * sampleRate), length - overlap);
    assert.equal(buffer.sampleRate, sampleRate);
});

test("applyLoopCrossfade joins the loop on genuinely adjacent source samples", () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const fakeContext = createFakeAudioContextForCrossfade();
    const source = fakeContext.createBuffer(1, length, sampleRate);
    const data = source.getChannelData(0);
    fillWithNoise(data, 11);

    const original = Float32Array.from(data);
    const overlap = overlapSamplesFor(length, sampleRate);
    const loopLength = length - overlap;

    const { buffer, loopStart, loopEnd } = applyLoopCrossfade(source, fakeContext, 10);
    const out = buffer.getChannelData(0);
    const loopEndIndex = Math.round(loopEnd * sampleRate);

    // At the wrap, the last sample played is source[loopLength - 1] and the
    // first is source[loopLength] — adjacent in the original recording, so the
    // join carries no step the source didn't already have.
    assert.ok(Math.abs(out[loopStart] - original[loopLength]) < 1e-6);
    assert.equal(out[loopEndIndex - 1], original[loopLength - 1]);

    const seam = Math.abs(out[loopEndIndex - 1] - out[loopStart]);
    const naturalStep = Math.abs(original[loopLength] - original[loopLength - 1]);
    assert.ok(seam - naturalStep < 1e-6, `seam ${seam} should be a natural sample step (${naturalStep})`);

    // ...and it must beat looping the file untreated.
    const untreatedSeam = Math.abs(original[length - 1] - original[0]);
    assert.ok(seam < untreatedSeam, `seam ${seam} should improve on the untreated seam ${untreatedSeam}`);
});

test("applyLoopCrossfade blends the overlap with equal-power curves", () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const fakeContext = createFakeAudioContextForCrossfade();
    const source = fakeContext.createBuffer(1, length, sampleRate);
    fillWithNoise(source.getChannelData(0), 23);

    const original = Float32Array.from(source.getChannelData(0));
    const overlap = overlapSamplesFor(length, sampleRate);
    const loopLength = length - overlap;

    const { buffer } = applyLoopCrossfade(source, fakeContext, 10);
    const out = buffer.getChannelData(0);

    // Equal-power (sin/cos) rather than linear: these files are noise-like, and
    // a linear fade dips in perceived loudness across the overlap.
    for (const i of [0, Math.floor(overlap / 2), overlap - 1]) {
        const t = i / overlap;
        const expected = original[loopLength + i] * Math.cos((t * Math.PI) / 2)
            + original[i] * Math.sin((t * Math.PI) / 2);

        assert.ok(
            Math.abs(out[i] - expected) < 1e-6,
            `sample ${i} should be an equal-power blend (got ${out[i]}, expected ${expected})`,
        );
    }

    // Everything past the overlap is untouched source.
    assert.equal(out[overlap], original[overlap]);
    assert.equal(out[loopLength - 1], original[loopLength - 1]);
});

test("applyLoopCrossfade processes every channel in a stereo buffer", () => {
    const sampleRate = 48000;
    const length = sampleRate;
    const fakeContext = createFakeAudioContextForCrossfade();
    const source = fakeContext.createBuffer(2, length, sampleRate);
    fillWithNoise(source.getChannelData(0), 3);
    fillWithNoise(source.getChannelData(1), 99);

    const originalLeft = Float32Array.from(source.getChannelData(0));
    const originalRight = Float32Array.from(source.getChannelData(1));
    const overlap = overlapSamplesFor(length, sampleRate);
    const loopLength = length - overlap;

    const { buffer, loopStart, loopEnd } = applyLoopCrossfade(source, fakeContext, 10);
    const loopEndIndex = Math.round(loopEnd * sampleRate);

    assert.equal(buffer.numberOfChannels, 2);
    assert.equal(loopStart, 0);
    assert.equal(loopEndIndex, loopLength);
    // Both channels must be trimmed and blended identically, or the loop wrap
    // would smear the stereo image.
    assert.ok(Math.abs(buffer.getChannelData(0)[0] - originalLeft[loopLength]) < 1e-6);
    assert.ok(Math.abs(buffer.getChannelData(1)[0] - originalRight[loopLength]) < 1e-6);
});

test("applyLoopCrossfade computes loopEnd from the source sample rate", () => {
    const fakeContext = createFakeAudioContextForCrossfade();
    const sampleRate = 44100;
    const length = sampleRate * 2; // 2 seconds
    const source = fakeContext.createBuffer(1, length, sampleRate);
    source.getChannelData(0).fill(0.1);

    const { buffer, loopStart, loopEnd } = applyLoopCrossfade(source, fakeContext, 10);
    const overlap = overlapSamplesFor(length, sampleRate);

    assert.equal(loopStart, 0);
    assert.equal(loopEnd, (length - overlap) / sampleRate);
    assert.equal(buffer.sampleRate, sampleRate);
    assert.equal(buffer.length, length);
});

test("applyLoopCrossfade clamps the overlap to half the buffer length", () => {
    const fakeContext = createFakeAudioContextForCrossfade();
    const sampleRate = 48000;
    const length = 1000;
    const source = fakeContext.createBuffer(1, length, sampleRate);
    fillWithNoise(source.getChannelData(0), 5);
    const original = Float32Array.from(source.getChannelData(0));

    // A huge crossfade would ask for an overlap longer than the file; the join
    // must stay centred so "no step at the wrap" still holds.
    const crossfadeMs = 100000;
    const overlap = overlapSamplesFor(length, sampleRate, crossfadeMs);
    const { buffer, loopEnd } = applyLoopCrossfade(source, fakeContext, crossfadeMs);

    assert.equal(overlap, Math.floor(length / 2));
    assert.equal(Math.round(loopEnd * sampleRate), length - overlap);
    // The blend touches only the first `overlap` samples; the rest is source.
    assert.equal(buffer.getChannelData(0)[overlap], original[overlap]);
});

test("applyLoopCrossfade enforces a minimum one-sample overlap", () => {
    const fakeContext = createFakeAudioContextForCrossfade();
    const sampleRate = 48000;
    const length = 1000;
    const source = fakeContext.createBuffer(1, length, sampleRate);
    fillWithNoise(source.getChannelData(0), 9);
    const original = Float32Array.from(source.getChannelData(0));

    // A sub-sample crossfade rounds to zero, which would be no crossfade at all.
    const crossfadeMs = 0.005;
    const overlap = overlapSamplesFor(length, sampleRate, crossfadeMs);
    const { buffer, loopEnd } = applyLoopCrossfade(source, fakeContext, crossfadeMs);

    assert.equal(overlap, 1);
    assert.equal(Math.round(loopEnd * sampleRate), length - 1);
    // The single blended sample takes the value of the sample it crossfades
    // from (the wrap point), proving the blend still ran over the join.
    assert.equal(buffer.getChannelData(0)[0], original[length - 1]);
    assert.equal(buffer.getChannelData(0)[1], original[1]);
});

test("loadBuffer returns a crossfaded loop window and caches it", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/loop.ogg" }, true);

    const firstWindow = await player.loadBuffer("/loop.ogg");
    const secondWindow = await player.loadBuffer("/loop.ogg");

    assert.equal(firstWindow, secondWindow);
    assert.equal(firstWindow.loopStart, 0);
    assert.ok(firstWindow.loopEnd > 0);
    assert.equal(firstWindow.buffer.duration, contexts[0].decodedBuffers[0].duration);
    assert.notEqual(firstWindow.buffer, contexts[0].decodedBuffers[0]);
});

test("playTrack uses a decoded buffer for the audible loop and keeps the media element browser-visible", async () => {
    const contexts = installAudioContext();
    const fetchCalls = installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);

    assert.equal(player.hasContext(), true);
    assert.equal(player.hasTrack(), true);
    assert.equal(player.getTrackUrl(), "/sound.ogg");
    assert.equal(player.isPlaying(), true);
    assert.equal(audioElement.preload, "auto");
    assert.equal(audioElement.src, "/sound.ogg");
    assert.equal(audioElement.loop, true);
    assert.equal(audioElement.currentTime, 0);
    assert.equal(audioElement.loadCalls, 1);
    assert.equal(audioElement.playCalls, 1);
    assert.deepEqual(fetchCalls, ["/sound.ogg"]);

    const context = contexts[0];
    const mediaElementSource = context.mediaSources[0];
    const silentGainNode = context.gains[0];
    const audibleGainNode = context.gains[1];
    const audibleSource = context.bufferSources[0];

    assert.equal(context.resumeCalls, 1);
    assert.equal(mediaElementSource.audioElement, audioElement);
    assert.equal(mediaElementSource.connectedTo, silentGainNode);
    assert.equal(silentGainNode.gain.value, 0);
    assert.equal(silentGainNode.connectedTo, context.destination);
    assert.notEqual(audibleSource.buffer, context.decodedBuffers[0]);
    assert.equal(audibleSource.buffer.duration, context.decodedBuffers[0].duration);
    assert.equal(audibleSource.loop, true);
    assert.equal(audibleSource.loopStart, 0);
    assert.equal(audibleSource.loopEnd, loopEndForDuration(context.decodedBuffers[0].duration));
    assert.deepEqual(audibleSource.startCalls, [context.currentTime]);
    assert.equal(audibleSource.connectedTo, audibleGainNode);
    assert.equal(audibleGainNode.connectedTo, context.destination);
});

test("playTrack reuses the media element audio graph when replacing tracks", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/first.ogg" }, true);
    await player.playTrack({ url: "/second.ogg" }, false, true);

    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].mediaSources.length, 1);
    assert.equal(audioElement.src, "/second.ogg");
    assert.equal(audioElement.loop, false);
    assert.equal(audioElement.loadCalls, 2);
    assert.equal(audioElement.playCalls, 2);
    assert.equal(contexts[0].bufferSources[0].stopCalls, 1);
});

test("playTrack reuses decoded buffers when replaying the same track", async () => {
    const contexts = installAudioContext();
    const fetchCalls = installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/loop.ogg" }, true);
    await player.playTrack({ url: "/loop.ogg" }, true);

    assert.equal(audioElement.loadCalls, 1);
    assert.deepEqual(fetchCalls, ["/loop.ogg"]);
    assert.equal(contexts[0].decodedBuffers.length, 1);
    assert.equal(contexts[0].bufferSources.length, 2);
    assert.equal(contexts[0].bufferSources[0].stopCalls, 1);
    assert.equal(contexts[0].bufferSources[1].buffer.duration, contexts[0].decodedBuffers[0].duration);
});

test("playTrack reuses an in-flight buffer load for duplicate track requests", async () => {
    const contexts = installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    const firstPlay = player.playTrack({ url: "/loop.ogg" }, true);
    const secondPlay = player.playTrack({ url: "/loop.ogg" }, true);

    assert.equal(requests.length, 1);
    requests[0].resolveWithBytes(8);

    assert.equal(await secondPlay, true);
    assert.equal(await firstPlay, false);
    assert.equal(contexts[0].decodedBuffers.length, 1);
    assert.equal(contexts[0].bufferSources.length, 1);
});

test("playTrack retries a buffer load after a failed response", async () => {
    const contexts = installAudioContext();
    const fetchCalls = [];
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    globalThis.fetch = async (url) => {
        fetchCalls.push(url);

        if (fetchCalls.length === 1) {
            return { ok: false, status: 503, statusText: "Service Unavailable" };
        }

        return {
            ok: true,
            async arrayBuffer() {
                return new ArrayBuffer(8);
            },
        };
    };

    await assert.rejects(
        () => player.playTrack({ url: "/retry.ogg" }, true),
        /Could not load audio: 503 Service Unavailable/,
    );
    await player.playTrack({ url: "/retry.ogg" }, true);

    assert.deepEqual(fetchCalls, ["/retry.ogg", "/retry.ogg"]);
    assert.equal(contexts[0].decodedBuffers.length, 1);
});

test("playTrack ignores stale buffer loads when a newer track is requested", async () => {
    const contexts = installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    const firstPlay = player.playTrack({ url: "/slow.ogg" }, true);
    const secondPlay = player.playTrack({ url: "/fast.ogg" }, true);

    requests[1].resolveWithBytes(16);

    assert.equal(await secondPlay, true);
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, false);
    assert.equal(player.hasTrack(), true);
    assert.equal(audioElement.src, "/fast.ogg");
    assert.equal(audioElement.loadCalls, 1);
    assert.equal(contexts[0].bufferSources.length, 1);
    assert.equal(contexts[0].bufferSources[0].loopEnd, loopEndForDuration(60));
});

test("playTrack keeps the current buffer source active while a replacement track loads", async () => {
    const contexts = installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    const firstPlay = player.playTrack({ url: "/first.ogg" }, true);
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, true);

    const firstSource = contexts[0].bufferSources[0];
    const secondPlay = player.playTrack({ url: "/second.ogg" }, true);

    assert.equal(firstSource.stopCalls, 0);
    assert.equal(audioElement.src, "/first.ogg");
    assert.equal(contexts[0].bufferSources.length, 1);

    requests[1].resolveWithBytes(16);

    assert.equal(await secondPlay, true);
    assert.equal(firstSource.stopCalls, 1);
    assert.equal(contexts[0].bufferSources.length, 2);
    assert.equal(contexts[0].bufferSources[1].loopEnd, loopEndForDuration(60));
});

test("playTrack crossfades between two different playing tracks with equal-power curves", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/first.ogg" }, true);
    const firstSource = contexts[0].bufferSources[0];

    await player.playTrack({ url: "/second.ogg" }, true);

    const context = contexts[0];
    const currentGainNode = context.gains[1];
    const outgoingGainNode = context.gains[2];

    assert.equal(context.bufferSources.length, 2);
    assert.equal(firstSource.stopCalls, 1);
    assert.equal(firstSource.connectedTo, outgoingGainNode);

    assert.ok(outgoingGainNode.gain.valueCurve, "outgoing gain should use a value curve");
    assert.equal(outgoingGainNode.gain.valueCurve.duration, 0.25);
    assert.equal(outgoingGainNode.gain.valueCurve.curve[0], 1);
    assert.equal(outgoingGainNode.gain.valueCurve.curve[outgoingGainNode.gain.valueCurve.curve.length - 1], 0);

    assert.ok(currentGainNode.gain.valueCurve, "current gain should use a value curve");
    assert.equal(currentGainNode.gain.valueCurve.duration, 0.25);
    assert.ok(Math.abs(currentGainNode.gain.valueCurve.curve[0]) < 1e-15);
    assert.equal(currentGainNode.gain.valueCurve.curve[currentGainNode.gain.valueCurve.curve.length - 1], 1);
});

test("playTrack keeps the current track active if a replacement track fails to load", async () => {
    const contexts = installAudioContext();
    const fetchCalls = [];
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    globalThis.fetch = async (url) => {
        fetchCalls.push(url);

        if (url === "/broken.ogg") {
            return { ok: false, status: 404, statusText: "Not Found" };
        }

        return {
            ok: true,
            async arrayBuffer() {
                return new ArrayBuffer(8);
            },
        };
    };

    await player.playTrack({ url: "/first.ogg" }, true);
    const firstSource = contexts[0].bufferSources[0];

    await assert.rejects(
        () => player.playTrack({ url: "/broken.ogg" }, true),
        /Could not load audio: 404 Not Found/,
    );

    assert.deepEqual(fetchCalls, ["/first.ogg", "/broken.ogg"]);
    assert.equal(player.hasTrack(), true);
    assert.equal(player.isPlaying(), true);
    assert.equal(audioElement.src, "/first.ogg");
    assert.equal(audioElement.loadCalls, 1);
    assert.equal(contexts[0].bufferSources.length, 1);
    assert.equal(firstSource.stopCalls, 0);
});

test("playTrack respects a pause while a replacement track is still loading", async () => {
    const contexts = installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    const firstPlay = player.playTrack({ url: "/first.ogg" }, true);
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, true);

    const secondPlay = player.playTrack({ url: "/second.ogg" }, true);
    await player.pause();
    requests[1].resolveWithBytes(16);

    assert.equal(await secondPlay, true);
    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.src, "/second.ogg");
    assert.equal(audioElement.playCalls, 2);
    assert.equal(audioElement.pauseCalls, 3);
    assert.equal(contexts[0].state, "suspended");
});

test("playTrack reports loading for as long as the new track's audio is still arriving", async () => {
    installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const loadingChanges = [];
    const player = new AudioPlayer(audioElement, {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    const firstPlay = player.playTrack({ url: "/first.ogg" }, true);
    assert.equal(player.isLoading(), true);
    assert.deepEqual(loadingChanges, [true]);

    // Yield past the microtask queue: loading has to stay true for as long as
    // the request is outstanding, not merely at the moment playTrack was called.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(player.isLoading(), true);
    assert.deepEqual(loadingChanges, [true]);

    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, true);
    assert.equal(player.isLoading(), false);
    assert.deepEqual(loadingChanges, [true, false]);

    const secondPlay = player.playTrack({ url: "/second.ogg" }, true);
    assert.equal(player.isLoading(), true);

    requests[1].resolveWithBytes(16);
    assert.equal(await secondPlay, true);
    assert.equal(player.isLoading(), false);
    assert.deepEqual(loadingChanges, [true, false, true, false]);
});

// The listener has been waiting since the first press, so a second skip has to
// hand the loading state over rather than report a stop and an immediate start.
test("playTrack keeps reporting loading when a second track change supersedes the first", async () => {
    installAudioContext();
    const requests = installDeferredFetch();
    const loadingChanges = [];
    const player = new AudioPlayer(createAudioElement(), {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    const firstPlay = player.playTrack({ url: "/first.ogg" }, true);
    const secondPlay = player.playTrack({ url: "/second.ogg" }, true);

    // Resolving the superseded request must not clear the indicator.
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, false);
    assert.equal(player.isLoading(), true);
    assert.deepEqual(loadingChanges, [true]);

    requests[1].resolveWithBytes(16);
    assert.equal(await secondPlay, true);
    assert.equal(player.isLoading(), false);
    assert.deepEqual(loadingChanges, [true, false]);
});

test("playTrack stops reporting loading when the audio fails to arrive", async () => {
    installAudioContext();
    const loadingChanges = [];
    const player = new AudioPlayer(createAudioElement(), {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    globalThis.fetch = async () => ({ ok: false, status: 504, statusText: "Offline" });

    await assert.rejects(
        () => player.playTrack({ url: "/missing.ogg" }, true),
        /Could not load audio: 504 Offline/,
    );

    assert.equal(player.isLoading(), false);
    assert.deepEqual(loadingChanges, [true, false]);
});

test("playTrack refreshes the browser playback surface when replacing a paused track", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.ogg" }, true, true, true);

    assert.equal(player.hasTrack(), true);
    assert.equal(player.isPlaying(), false);
    assert.equal(contexts[0].state, "suspended");
    assert.equal(contexts[0].suspendCalls, 1);
    assert.equal(audioElement.src, "/quiet.ogg");
    assert.equal(audioElement.currentTime, 0);
    assert.equal(audioElement.pauseCalls, 2);
    assert.equal(audioElement.playCalls, 1);
    assert.equal(player.isBrowserPlaybackSyncSuppressed(), false);
});

// Parking the element for a handover has to pause it without its own pause
// event being read back as a person pressing pause. The app ignores those events
// by asking, when one arrives, whether a remote is active — and that answer can
// have flipped back by then: a session that fails as it opens disconnects while
// this pause is still in flight, so the event lands after the handback has
// resumed local playback and stops the room. Suppressing at the source is what
// says "this pause carries no intent" regardless of who owns the output by the
// time anyone hears about it.
test("pauseForHandover pauses without the element's own event reading as intent", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.ogg" }, true);
    assert.equal(player.isBrowserPlaybackSyncSuppressed(), false);

    const parked = player.pauseForHandover();

    // Suppressed for the whole of the pause, which is when the element's event
    // is generated.
    assert.equal(player.isBrowserPlaybackSyncSuppressed(), true);

    await parked;

    assert.equal(player.isPlaying(), false);
    assert.equal(contexts[0].state, "suspended");
    assert.equal(player.wantsPlayback(), false);
    // Still covered immediately after the await: the event is dispatched in a
    // task of its own, so releasing synchronously here would release too early.
    assert.equal(player.isBrowserPlaybackSyncSuppressed(), true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(
        player.isBrowserPlaybackSyncSuppressed(),
        false,
        "the suppression never lifted, so a later real pause would be ignored",
    );
});

test("playTrack applies the latest volume to the gain node", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);
    player.updateVolume(0.35);

    await player.playTrack({ url: "/quiet.ogg" }, true);

    assert.equal(contexts[0].gains[1].gain.value, 0.35);
});

test("getMediaSessionPositionState reports decoded buffer loop position", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.opus" }, true);
    contexts[0].currentTime += 7;

    // Duration is the looping period, which the crossfade trims below the
    // decoded 30 s.
    assert.deepEqual(player.getMediaSessionPositionState(), {
        duration: loopEndForDuration(30),
        playbackRate: 1,
        position: 7,
    });

    await player.pause();

    assert.deepEqual(player.getMediaSessionPositionState(), {
        duration: loopEndForDuration(30),
        playbackRate: 1,
        position: 7,
    });
});

test("getMediaSessionPositionState wraps long-running loop position", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.opus" }, true);
    contexts[0].currentTime += 37;

    // 37 s into a loop whose period is just under 30 s wraps into the second pass.
    assert.equal(player.getCurrentPosition(), 37 % loopEndForDuration(30));
    assert.ok(player.getCurrentPosition() > 7, "position should wrap past the trimmed loop end");
});

test("AudioContext state changes notify the app shell", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    let stateChangeCount = 0;
    const player = new AudioPlayer(audioElement, {
        onStateChange() {
            stateChangeCount += 1;
        },
    });

    await player.playTrack({ url: "/quiet.opus" }, true);
    contexts[0].dispatch("statechange");

    assert.equal(stateChangeCount, 1);
});

test("playTrack snaps the source start time when the context resumes after a suspended load", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.opus" }, true);
    // Simulate the gap between source.start() and the actual resume event. In a
    // real browser the AudioContext clock keeps advancing while the context is
    // suspended, so the currentTime captured at start() is stale by the time
    // playback actually begins.
    contexts[0].currentTime = 12.5;
    contexts[0].dispatch("statechange");

    assert.equal(player.getCurrentPosition(), 0);
});

test("playTrack leaves the source start time alone when the context is already running", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/quiet.opus" }, true);
    contexts[0].currentTime += 4;
    contexts[0].dispatch("statechange");

    // Source started in a running context, so the snap path must not fire and
    // position tracks the clock from the start() call.
    assert.equal(player.getCurrentPosition(), 4);
});

test("playTrack accepts supported MIME types before loading the track", async () => {
    installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({
        url: "/rain.opus",
        mime: "audio/ogg; codecs=opus",
    }, true);

    assert.equal(audioElement.src, "/rain.opus");
});

test("playTrack still attempts a track the media element reports as unsupported", async () => {
    const contexts = installAudioContext();
    const fetchCalls = installFetch();
    const audioElement = createAudioElement();
    audioElement.canPlayType = () => "";
    const warnings = [];
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    const player = new AudioPlayer(audioElement);

    // canPlayType() describes the media element, but the audible path is
    // decodeAudioData(). A conservative "" must not mute the app before a byte
    // is fetched — warn and let the decode be the real verdict.
    await player.playTrack({ url: "/rain.opus", mime: "audio/ogg; codecs=opus" }, true);

    assert.equal(contexts.length, 1);
    assert.equal(audioElement.src, "/rain.opus");
    assert.deepEqual(fetchCalls, ["/rain.opus"]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /reports no support for audio\/ogg; codecs=opus/);
});

test("play and pause keep a loaded track's audio context and media element in sync", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);
    assert.equal(player.isPlaybackRequested(), true);
    await player.pause();
    assert.equal(player.state, "suspended");
    assert.equal(player.isPlaying(), false);
    assert.equal(player.isPlaybackRequested(), false);
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(contexts[0].suspendCalls, 1);

    await player.play();
    assert.equal(player.state, "running");
    assert.equal(player.isPlaying(), true);
    assert.equal(player.isPlaybackRequested(), true);
    assert.equal(audioElement.playCalls, 2);
    assert.equal(contexts[0].resumeCalls, 2);
});

test("pause wins if it happens while play is resuming the audio context", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);
    await player.pause();

    let resolveResume;
    contexts[0].resume = async () => {
        contexts[0].resumeCalls += 1;
        contexts[0].state = "running";
        await new Promise((resolve) => {
            resolveResume = resolve;
        });
    };

    const playPromise = player.play();
    await player.pause();
    resolveResume();
    await playPromise;

    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.playCalls, 1);
    assert.equal(contexts[0].state, "suspended");
});

test("play suspends the audio context again if the media element cannot play", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    audioElement.play = async function play() {
        this.playCalls += 1;
        this.paused = false;
        throw new Error("Media element rejected playback");
    };
    const player = new AudioPlayer(audioElement);

    await assert.rejects(
        () => player.playTrack({ url: "/sound.ogg" }, true),
        /Media element rejected playback/,
    );

    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(contexts[0].state, "suspended");
    assert.equal(contexts[0].suspendCalls, 1);
});

test("supportsTrack intentionally checks only the MIME type", () => {
    const audioElement = createAudioElement();
    const checkedTypes = [];
    audioElement.canPlayType = (type) => {
        checkedTypes.push(type);
        return "probably";
    };

    const player = new AudioPlayer(audioElement);
    const result = player.supportsTrack({ url: "/rain.opus", mime: "audio/ogg; codecs=opus" });

    assert.equal(result, true);
    assert.deepEqual(checkedTypes, ["audio/ogg; codecs=opus"]);
});

test("supportsTrack accepts tracks without a declared MIME type", () => {
    const audioElement = createAudioElement();
    audioElement.canPlayType = () => {
        throw new Error("canPlayType should not be called without a MIME type");
    };

    const player = new AudioPlayer(audioElement);

    assert.equal(player.supportsTrack({ url: "/legacy.ogg" }), true);
});

test("isPlaying returns false if the audio element is paused even if the context is running", async () => {
    installAudioContext({ initialState: "running" });
    const audioElement = createAudioElement();
    audioElement.paused = true;
    const player = new AudioPlayer(audioElement);

    assert.equal(player.isPlaying(), false);
});

test("pause is a no-op before the audio graph exists", async () => {
    const player = new AudioPlayer(createAudioElement());

    await assert.doesNotReject(() => player.pause());
});

test("updateVolume fades from the current gain value", () => {
    const player = new AudioPlayer(createAudioElement());
    const calls = [];
    player.audioContext = { currentTime: 5 };
    player.currentTrackGainNode = {
        gain: {
            value: 0.7,
            cancelScheduledValues(when) {
                calls.push(["cancel", when]);
            },
            setValueAtTime(value, when) {
                calls.push(["set", value, when]);
            },
            linearRampToValueAtTime(value, when) {
                calls.push(["ramp", value, when]);
            },
        },
    };

    player.updateVolume(0.25);

    assert.deepEqual(calls, [
        ["cancel", 5],
        ["set", 0.7, 5],
        ["ramp", 0.25, 5.25],
    ]);
});

test("updateVolume is a no-op before the gain node exists", () => {
    const player = new AudioPlayer(createAudioElement());

    assert.doesNotThrow(() => player.updateVolume(0.5));
});
