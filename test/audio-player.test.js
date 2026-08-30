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

// These tests hand the player fixture files (`/loop.ogg`) rather than catalog
// tracks, so they inject a resolver that plays whatever URL the fixture names.
// The production resolver derives the URL from the track id and would send every
// one of them to the same nonexistent file — which would test the resolver, not
// the player. `local-source.test.js` covers the real derivation.
function createPlayer(audioElement, options = {}) {
    return new AudioPlayer(audioElement, {
        resolveSource: (track) => ({ url: track.url, mime: track.mime }),
        ...options,
    });
}

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "loop", url: "/loop.ogg" }, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "sound", url: "/sound.ogg" }, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "first", url: "/first.ogg" }, true);
    await player.playTrack({ id: "second", url: "/second.ogg" }, false, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "loop", url: "/loop.ogg" }, true);
    await player.playTrack({ id: "loop", url: "/loop.ogg" }, true);

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
    const player = createPlayer(audioElement);

    const firstPlay = player.playTrack({ id: "loop", url: "/loop.ogg" }, true);
    const secondPlay = player.playTrack({ id: "loop", url: "/loop.ogg" }, true);

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
    const player = createPlayer(audioElement);

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
        () => player.playTrack({ id: "retry", url: "/retry.ogg" }, true),
        /Could not load audio: 503 Service Unavailable/,
    );
    await player.playTrack({ id: "retry", url: "/retry.ogg" }, true);

    assert.deepEqual(fetchCalls, ["/retry.ogg", "/retry.ogg"]);
    assert.equal(contexts[0].decodedBuffers.length, 1);
});

test("playTrack ignores stale buffer loads when a newer track is requested", async () => {
    const contexts = installAudioContext();
    const requests = installDeferredFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    const firstPlay = player.playTrack({ id: "slow", url: "/slow.ogg" }, true);
    const secondPlay = player.playTrack({ id: "fast", url: "/fast.ogg" }, true);

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
    const player = createPlayer(audioElement);

    const firstPlay = player.playTrack({ id: "first", url: "/first.ogg" }, true);
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, true);

    const firstSource = contexts[0].bufferSources[0];
    const secondPlay = player.playTrack({ id: "second", url: "/second.ogg" }, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "first", url: "/first.ogg" }, true);
    const firstSource = contexts[0].bufferSources[0];

    await player.playTrack({ id: "second", url: "/second.ogg" }, true);

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
    const player = createPlayer(audioElement);

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

    await player.playTrack({ id: "first", url: "/first.ogg" }, true);
    const firstSource = contexts[0].bufferSources[0];

    await assert.rejects(
        () => player.playTrack({ id: "broken", url: "/broken.ogg" }, true),
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
    const player = createPlayer(audioElement);

    const firstPlay = player.playTrack({ id: "first", url: "/first.ogg" }, true);
    requests[0].resolveWithBytes(8);
    assert.equal(await firstPlay, true);

    const secondPlay = player.playTrack({ id: "second", url: "/second.ogg" }, true);
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
    const player = createPlayer(audioElement, {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    const firstPlay = player.playTrack({ id: "first", url: "/first.ogg" }, true);
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

    const secondPlay = player.playTrack({ id: "second", url: "/second.ogg" }, true);
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
    const player = createPlayer(createAudioElement(), {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    const firstPlay = player.playTrack({ id: "first", url: "/first.ogg" }, true);
    const secondPlay = player.playTrack({ id: "second", url: "/second.ogg" }, true);

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
    const player = createPlayer(createAudioElement(), {
        onLoadingChange: (isLoading) => loadingChanges.push(isLoading),
    });

    globalThis.fetch = async () => ({ ok: false, status: 504, statusText: "Offline" });

    await assert.rejects(
        () => player.playTrack({ id: "missing", url: "/missing.ogg" }, true),
        /Could not load audio: 504 Offline/,
    );

    assert.equal(player.isLoading(), false);
    assert.deepEqual(loadingChanges, [true, false]);
});

test("playTrack refreshes the browser playback surface when replacing a paused track", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.ogg" }, true, true, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.ogg" }, true);
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
    const player = createPlayer(audioElement);
    player.updateVolume(0.35);

    await player.playTrack({ id: "quiet", url: "/quiet.ogg" }, true);

    assert.equal(contexts[0].gains[1].gain.value, 0.35);
});

test("getMediaSessionPositionState reports decoded buffer loop position", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true);
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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true);
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
    const player = createPlayer(audioElement, {
        onStateChange() {
            stateChangeCount += 1;
        },
    });

    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true);
    contexts[0].dispatch("statechange");

    assert.equal(stateChangeCount, 1);
});

test("playTrack snaps the source start time when the context resumes after a suspended load", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    // Loaded paused, which is the case that still starts a source against a
    // suspended context. The playing path resumes before it reads the clock, so
    // the time it captures is already the time playback begins.
    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true, false, true);

    // Simulate the gap between source.start() and the actual resume event. In a
    // real browser the AudioContext clock keeps advancing while the context is
    // suspended, so the currentTime captured at start() is stale by the time
    // playback actually begins.
    contexts[0].currentTime = 12.5;
    contexts[0].state = "running";
    contexts[0].dispatch("statechange");

    assert.equal(player.getCurrentPosition(), 0);
});

// Ordering, not decoration. Starting a media element is what activates the
// system audio session on iOS, and that activation interrupts an AudioContext
// that is already running: on an iPad the soundscape started, cut out, and
// started again. Nothing audible may begin before the element has.
test("playTrack starts the browser-visible element before any audible source", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    let startedSourcesWhenElementPlayed;

    const elementPlay = audioElement.play.bind(audioElement);
    audioElement.play = async () => {
        startedSourcesWhenElementPlayed ??= contexts[0].bufferSources
            .filter((source) => source.startCalls.length > 0).length;
        await elementPlay();
    };

    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true);

    assert.equal(startedSourcesWhenElementPlayed, 0, "the element must start into silence");
    assert.equal(audioElement.src, "/quiet.opus", "the element must carry the track it started for");
    assert.ok(
        contexts[0].bufferSources.some((source) => source.startCalls.length > 0),
        "the audible source must still start",
    );
});

test("playTrack leaves the source start time alone when the context is already running", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "quiet", url: "/quiet.opus" }, true);
    contexts[0].currentTime += 4;
    contexts[0].dispatch("statechange");

    // Source started in a running context, so the snap path must not fire and
    // position tracks the clock from the start() call.
    assert.equal(player.getCurrentPosition(), 4);
});

// A browser that cannot decode Opus should not play nothing. The retry is
// deliberately narrow — see sourceAfterDecodeFailure — so these pin all three
// halves of it: it happens on a decode failure, it does not happen on any other
// failure, and it happens at most once.
function installFailingDecode(failures) {
    const original = globalThis.AudioContext.prototype.decodeAudioData;
    let attempts = 0;

    globalThis.AudioContext.prototype.decodeAudioData = async function decodeAudioData(arrayBuffer) {
        attempts += 1;

        if (attempts <= failures) throw new Error("The format is not supported");

        return original.call(this, arrayBuffer);
    };

    return () => {
        globalThis.AudioContext.prototype.decodeAudioData = original;
    };
}

function createSwitchableResolver(codecs) {
    let index = 0;
    const resolve = (track) => ({ url: `/${codecs[index]}/${track.id}`, mime: codecs[index] });

    resolve.codec = () => codecs[index];
    resolve.downgrade = () => {
        if (index >= codecs.length - 1) return false;
        index += 1;

        return true;
    };

    return resolve;
}

test("a decode failure falls back to the next local codec", async () => {
    installAudioContext();
    const fetched = installFetch();
    const restoreDecode = installFailingDecode(1);
    const resolveSource = createSwitchableResolver(["opus", "aac"]);
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement, { resolveSource });

    console.warn = () => {};

    try {
        await player.playTrack({ id: "rain" }, true);
    } finally {
        restoreDecode();
    }

    assert.deepEqual(fetched, ["/opus/rain", "/aac/rain"]);
    assert.equal(player.getTrackUrl(), "/aac/rain");

    // The media element has to follow the downgrade, not just the decoded
    // buffer. It is the app's whole platform surface — OS media controls,
    // hardware keys, audio focus, autoplay policy — and `shouldLoadMediaElement`
    // is keyed on the track id, which a downgrade does *not* change. Left
    // behind, it would sit on a file this browser has just proved it cannot
    // decode, while the audible buffer played something else.
    assert.equal(audioElement.src, "/aac/rain");
    assert.equal(audioElement.paused, false, "the silent element must still be playing");

    // The track never changed — only the file did. Identity has to survive that,
    // or the handover and the media session would disagree with the player.
    assert.equal(player.holdsTrack({ id: "rain" }), true);
});

// Waits for an asynchronous chain to reach a state, rather than assuming how
// many microtask turns it takes to get there.
async function until(condition, turns = 50) {
    for (let turn = 0; turn < turns; turn++) {
        if (condition()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }

    throw new Error("Timed out waiting for the expected state");
}

// Identity is advanced before the media element starts, so that the element's
// own play event finds the track already held. That claim is about a source
// which has not started yet, and a request that loses the race must take it
// back — otherwise the player reports holding a soundscape that is not the one
// audible, and the next press resumes the previous track under the new title.
test("a superseded request gives back the identity it claimed", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "first", url: "/first.opus" }, true);
    assert.ok(player.holdsTrack({ id: "first" }), "the first track should be held");

    // Park the next request precisely inside play(), which is the window the
    // early identity claim is exposed in.
    let releaseResume;
    contexts[0].resume = async () => {
        await new Promise((resolve) => {
            releaseResume = resolve;
        });
    };

    const parked = player.playTrack({ id: "second", url: "/second.opus" }, true);
    await until(() => releaseResume !== undefined);

    // Supersede it with a request that never reaches its own identity
    // assignment, so nothing else will set identity after the bail-out.
    globalThis.fetch = async () => ({ ok: false, status: 404, statusText: "Not Found" });
    const superseding = player.playTrack({ id: "third", url: "/third.opus" }, true);

    await assert.rejects(superseding, /Could not load audio/);

    releaseResume();
    assert.equal(await parked, false, "the parked request must report itself superseded");

    assert.ok(
        player.holdsTrack({ id: "first" }),
        "identity must name the track whose source is actually playing",
    );
    assert.ok(!player.holdsTrack({ id: "second" }), "the superseded track must not be held");
    assert.equal(player.getTrackUrl(), "/first.opus");
});

// A media element that models the one part of play()'s contract
// createAudioElement leaves out: the promise does not always resolve. A real one
// rejects it with AbortError when the source is replaced under it, and again
// when pause() is called while it is still starting. Both are things this app
// does to itself during an ordinary track change, and the fake resolving anyway
// is why the cascade below went unnoticed.
function createInterruptibleAudioElement() {
    const element = createAudioElement();

    let rejectPending;

    const interrupt = (reason) => {
        if (!rejectPending) return;

        const reject = rejectPending;

        rejectPending = undefined;
        reject(Object.assign(new Error(reason), { name: "AbortError" }));
    };

    return Object.defineProperties(element, {
        src: {
            enumerable: true,
            get() {
                return this._src ?? "";
            },
            set(value) {
                this._src = value;
                interrupt("The play() request was interrupted by a new load request.");
            },
        },
        play: {
            enumerable: true,
            value() {
                this.playCalls += 1;
                this.paused = false;

                // Left pending on purpose: a real element resolves this only
                // once it has enough data, which on a slow connection is the
                // whole window this test is about. `settlePlay` ends it.
                return new Promise((resolve, reject) => {
                    rejectPending = reject;
                    element.settlePlay = () => {
                        rejectPending = undefined;
                        resolve();
                    };
                });
            },
        },
        pause: {
            enumerable: true,
            value() {
                this.pauseCalls += 1;
                this.paused = true;
                interrupt("The play() request was interrupted by a call to pause().");
            },
        },
    });
}

// Skipping twice while the element is still loading must not stop the music.
//
// The second skip replaces the source, which aborts the first skip's pending
// play(). Treating that as a failure tears down state the second skip now owns
// — and the teardown's own pause() then aborts the second skip's play() too, so
// one interruption stops a soundscape that had already decoded and puts an
// error on screen. Reproduced in Chrome before this guard existed.
test("a skip that interrupts an earlier skip's play() does not stop playback", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createInterruptibleAudioElement();
    const player = createPlayer(audioElement);

    const first = player.playTrack({ id: "first", url: "/first.opus" }, true);
    await until(() => audioElement.playCalls === 1);
    audioElement.settlePlay();
    assert.equal(await first, true);

    // The skip whose element load never finishes.
    const parked = player.playTrack({ id: "second", url: "/second.opus" }, true);
    await until(() => audioElement.playCalls === 2);

    // The skip that lands on top of it, replacing the source and so aborting
    // the pending play() above.
    const superseding = player.playTrack({ id: "third", url: "/third.opus" }, true);
    await until(() => audioElement.playCalls === 3);
    audioElement.settlePlay();

    assert.equal(await parked, false, "the interrupted skip reports itself superseded");
    assert.equal(await superseding, true, "the newest skip still starts");

    assert.ok(player.holdsTrack({ id: "third" }), "the newest track must be the held one");
    assert.equal(player.wantsPlayback(), true, "the interruption must not clear playback intent");
    assert.equal(audioElement.paused, false, "the element must be left playing");
    assert.equal(contexts[0].state, "running", "the context must not be suspended");
    assert.equal(player.isPlaying(), true);
});

// The same interruption, from the other direction: pausing while a track change
// is still starting the element. The pause has already stopped everything, so
// the abort it causes is not a second thing to report — and reporting it put a
// "could not be played" notice on screen for a soundscape the listener had
// simply paused.
test("a pause during a track change's play() is not reported as a failure", async () => {
    const contexts = installAudioContext({ initialState: "running" });
    installFetch();
    const audioElement = createInterruptibleAudioElement();
    const player = createPlayer(audioElement);

    const changing = player.playTrack({ id: "next", url: "/next.opus" }, true);
    await until(() => audioElement.playCalls === 1);

    await player.pause();

    assert.equal(await changing, true, "the track change resolves rather than throwing");
    assert.equal(player.wantsPlayback(), false);
    assert.equal(audioElement.paused, true);
    assert.equal(contexts[0].state, "suspended");
});

// The retry is a second load, so it needs the same stale guard as the first.
// Without one, skipping during a fallback attempt turns a superseded request
// into a playback error for a soundscape the listener has already left.
test("a failed retry stays quiet when it has already been superseded", async () => {
    installAudioContext();
    const requests = installDeferredFetch();
    const restoreDecode = installFailingDecode(2);
    const resolveSource = createSwitchableResolver(["opus", "aac"]);
    const player = createPlayer(createAudioElement(), { resolveSource });

    console.warn = () => {};

    try {
        const firstPlay = player.playTrack({ id: "rain" }, true);

        // Fails to decode, downgrades, and opens the fallback fetch. That chain
        // crosses several awaits, so wait for the effect rather than guessing a
        // number of microtask turns.
        requests[0].resolveWithBytes(8);
        await until(() => requests.length === 2);

        assert.equal(requests.length, 2, "the fallback load should be in flight");
        assert.equal(requests[1].url, "/aac/rain");

        // A skip lands while that fallback is still loading.
        const secondPlay = player.playTrack({ id: "fireplace" }, true);

        requests[1].resolveWithBytes(8);

        assert.equal(await firstPlay, false, "a superseded retry resolves quietly");

        requests[2].resolveWithBytes(8);
        assert.equal(await secondPlay, true);
    } finally {
        restoreDecode();
    }

    assert.equal(player.holdsTrack({ id: "fireplace" }), true);
});

test("a fetch failure never changes codec", async () => {
    installAudioContext();
    globalThis.fetch = async () => ({ ok: false, status: 503, statusText: "Service Unavailable" });

    const resolveSource = createSwitchableResolver(["opus", "aac"]);
    const player = createPlayer(createAudioElement(), { resolveSource });

    await assert.rejects(() => player.playTrack({ id: "rain" }, true), /Could not load audio: 503/u);

    // Re-fetching identical bytes in a different container answers a question
    // nobody asked: the network failed, not the decoder.
    assert.equal(resolveSource.codec(), "opus");
});

test("a decode failure downgrades at most once per page", async () => {
    installAudioContext();
    installFetch();
    const restoreDecode = installFailingDecode(2);
    const resolveSource = createSwitchableResolver(["opus", "aac"]);
    const player = createPlayer(createAudioElement(), { resolveSource });

    console.warn = () => {};

    try {
        await assert.rejects(
            () => player.playTrack({ id: "rain" }, true),
            /Could not decode audio: \/aac\/rain/u,
            "the second failure is reported rather than retried",
        );
    } finally {
        restoreDecode();
    }

    assert.equal(resolveSource.codec(), "aac");
});

test("playTrack accepts supported MIME types before loading the track", async () => {
    installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = createPlayer(audioElement);

    await player.playTrack({
        id: "rain",
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
    const player = createPlayer(audioElement);

    // canPlayType() describes the media element, but the audible path is
    // decodeAudioData(). A conservative "" must not mute the app before a byte
    // is fetched — warn and let the decode be the real verdict.
    await player.playTrack({ id: "rain", url: "/rain.opus", mime: "audio/ogg; codecs=opus" }, true);

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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "sound", url: "/sound.ogg" }, true);
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
    const player = createPlayer(audioElement);

    await player.playTrack({ id: "sound", url: "/sound.ogg" }, true);
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
    const player = createPlayer(audioElement);

    await assert.rejects(
        () => player.playTrack({ id: "sound", url: "/sound.ogg" }, true),
        /Media element rejected playback/,
    );

    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(contexts[0].state, "suspended");
    assert.equal(contexts[0].suspendCalls, 1);
});

test("supportsSource intentionally checks only the MIME type", () => {
    const audioElement = createAudioElement();
    const checkedTypes = [];
    audioElement.canPlayType = (type) => {
        checkedTypes.push(type);
        return "probably";
    };

    const player = createPlayer(audioElement);
    const result = player.supportsSource({ id: "rain", url: "/rain.opus", mime: "audio/ogg; codecs=opus" });

    assert.equal(result, true);
    assert.deepEqual(checkedTypes, ["audio/ogg; codecs=opus"]);
});

test("supportsSource accepts a source without a declared MIME type", () => {
    const audioElement = createAudioElement();
    audioElement.canPlayType = () => {
        throw new Error("canPlayType should not be called without a MIME type");
    };

    const player = createPlayer(audioElement);

    assert.equal(player.supportsSource({ id: "legacy", url: "/legacy.ogg" }), true);
});

test("isPlaying returns false if the audio element is paused even if the context is running", async () => {
    installAudioContext({ initialState: "running" });
    const audioElement = createAudioElement();
    audioElement.paused = true;
    const player = createPlayer(audioElement);

    assert.equal(player.isPlaying(), false);
});

test("pause is a no-op before the audio graph exists", async () => {
    const player = createPlayer(createAudioElement());

    await assert.doesNotReject(() => player.pause());
});

test("updateVolume fades from the current gain value", () => {
    const player = createPlayer(createAudioElement());
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
    const player = createPlayer(createAudioElement());

    assert.doesNotThrow(() => player.updateVolume(0.5));
});
