import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { AudioPlayer } from "../src/audio-player.js";

const originalAudioContext = globalThis.AudioContext;
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    globalThis.fetch = originalFetch;
});

test("playTrack decodes the track, routes it through gain, loops it, and starts playback", async () => {
    const fetchedUrls = [];
    const decodedBuffers = [];
    const contexts = [];
    const audioBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const decodedBuffer = { duration: 30 };

    globalThis.fetch = async (url) => {
        fetchedUrls.push(url);

        return {
            async arrayBuffer() {
                return audioBytes;
            },
        };
    };

    globalThis.AudioContext = class FakeAudioContext {
        state = "running";
        currentTime = 12;
        destination = { type: "destination" };
        sources = [];
        gains = [];

        constructor() {
            contexts.push(this);
        }

        async decodeAudioData(arrayBuffer) {
            decodedBuffers.push(arrayBuffer);
            return decodedBuffer;
        }

        createBufferSource() {
            const source = {
                buffer: undefined,
                loop: false,
                connectedTo: undefined,
                startedAt: undefined,
                stopped: false,
                disconnected: false,
                connect(node) {
                    this.connectedTo = node;
                    return node;
                },
                start(when) {
                    this.startedAt = when;
                },
                stop() {
                    this.stopped = true;
                },
                disconnect() {
                    this.disconnected = true;
                },
            };

            this.sources.push(source);
            return source;
        }

        createGain() {
            const gainNode = {
                connectedTo: undefined,
                disconnected: false,
                gain: {
                    value: 1,
                    cancelledAt: undefined,
                    setAt: undefined,
                    rampedTo: undefined,
                    cancelScheduledValues(when) {
                        this.cancelledAt = when;
                    },
                    setValueAtTime(value, when) {
                        this.setAt = { value, when };
                    },
                    linearRampToValueAtTime(value, when) {
                        this.rampedTo = { value, when };
                    },
                },
                connect(node) {
                    this.connectedTo = node;
                    return node;
                },
                disconnect() {
                    this.disconnected = true;
                },
            };

            this.gains.push(gainNode);
            return gainNode;
        }
    };

    const audioElement = {
        async play() {},
        pause() {},
    };
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);

    assert.equal(player.hasContext(), true);
    assert.equal(player.isPlaying(), true);
    assert.deepEqual(fetchedUrls, ["/sound.ogg"]);
    assert.deepEqual(decodedBuffers, [audioBytes]);

    const context = contexts[0];
    const source = context.sources[0];
    const gainNode = context.gains[0];

    assert.equal(source.buffer, decodedBuffer);
    assert.equal(source.loop, true);
    assert.equal(source.connectedTo, gainNode);
    assert.equal(gainNode.connectedTo, context.destination);
    assert.equal(source.startedAt, 0);
});

test("playTrack stops and disconnects the previous source before replacing it", async () => {
    const contexts = [];

    globalThis.fetch = async () => ({
        async arrayBuffer() {
            return new ArrayBuffer(1);
        },
    });

    globalThis.AudioContext = class FakeAudioContext {
        state = "running";
        destination = {};
        sources = [];
        gains = [];

        constructor() {
            contexts.push(this);
        }

        async decodeAudioData() {
            return {};
        }

        createBufferSource() {
            const source = {
                loop: undefined,
                connect(node) {
                    return node;
                },
                start() {},
                stopCalls: 0,
                disconnectCalls: 0,
                stop() {
                    this.stopCalls += 1;
                },
                disconnect() {
                    this.disconnectCalls += 1;
                },
            };

            this.sources.push(source);
            return source;
        }

        createGain() {
            const gainNode = {
                connect(node) {
                    return node;
                },
                disconnectCalls: 0,
                gain: {},
                disconnect() {
                    this.disconnectCalls += 1;
                },
            };

            this.gains.push(gainNode);
            return gainNode;
        }
    };

    const player = new AudioPlayer({ async play() {}, pause() {} });

    await player.playTrack({ url: "/first.ogg" }, true);
    const firstContext = contexts[0];
    const firstSource = firstContext.sources[0];
    const firstGain = firstContext.gains[0];

    await player.playTrack({ url: "/second.ogg" }, false);

    assert.equal(firstSource.stopCalls, 1);
    assert.equal(firstSource.disconnectCalls, 1);
    assert.equal(firstGain.disconnectCalls, 1);
    assert.equal(firstContext.sources[1].loop, false);
});

test("playTrack can replace the context and keep the new track paused", async () => {
    const contexts = [];

    globalThis.fetch = async () => ({
        async arrayBuffer() {
            return new ArrayBuffer(1);
        },
    });

    globalThis.AudioContext = class FakeAudioContext {
        state = "running";
        destination = {};
        sources = [];
        suspendCalls = 0;

        constructor() {
            contexts.push(this);
        }

        async suspend() {
            this.suspendCalls += 1;
            this.state = "suspended";
        }

        async decodeAudioData() {
            return {};
        }

        createBufferSource() {
            const source = {
                connect(node) {
                    return node;
                },
                startCalls: 0,
                start() {
                    this.startCalls += 1;
                },
                stop() {},
                disconnect() {},
            };

            this.sources.push(source);
            return source;
        }

        createGain() {
            return {
                gain: { value: 1 },
                connect(node) {
                    return node;
                },
                disconnect() {},
            };
        }
    };

    const player = new AudioPlayer({ async play() {}, pause() {} });

    await player.playTrack({ url: "/first.ogg" }, true);
    await player.playTrack({ url: "/second.ogg" }, true, true, true);

    assert.equal(contexts.length, 2);
    assert.equal(contexts[1].suspendCalls, 1);
    assert.equal(contexts[1].state, "suspended");
    assert.equal(contexts[1].sources[0].startCalls, 1);
});

test("playTrack applies the latest volume to newly created gain nodes", async () => {
    const contexts = [];

    globalThis.fetch = async () => ({
        async arrayBuffer() {
            return new ArrayBuffer(1);
        },
    });

    globalThis.AudioContext = class FakeAudioContext {
        state = "running";
        destination = {};
        gains = [];

        constructor() {
            contexts.push(this);
        }

        async decodeAudioData() {
            return {};
        }

        createBufferSource() {
            return {
                connect(node) {
                    return node;
                },
                start() {},
                stop() {},
                disconnect() {},
            };
        }

        createGain() {
            const gainNode = {
                gain: { value: 1 },
                connect(node) {
                    return node;
                },
                disconnect() {},
            };

            this.gains.push(gainNode);
            return gainNode;
        }
    };

    const player = new AudioPlayer({ async play() {}, pause() {} });
    player.updateVolume(0.35);

    await player.playTrack({ url: "/quiet.ogg" }, true);

    assert.equal(contexts[0].gains[0].gain.value, 0.35);
});

test("play and pause keep the audio context and backing media element in sync", async () => {
    let playCalls = 0;
    let pauseCalls = 0;

    const audioElement = {
        async play() {
            playCalls += 1;
        },
        pause() {
            pauseCalls += 1;
        },
    };
    const player = new AudioPlayer(audioElement);
    player.audioContext = {
        state: "suspended",
        async resume() {
            this.state = "running";
        },
        async suspend() {
            this.state = "suspended";
        },
    };

    await player.play();
    assert.equal(player.state, "running");
    assert.equal(playCalls, 1);

    await player.pause();
    assert.equal(player.state, "suspended");
    assert.equal(pauseCalls, 1);
});

test("updateVolume fades from the current gain value", () => {
    const player = new AudioPlayer({ async play() {}, pause() {} });
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

test("updateVolume is a no-op before a track has created a gain node", () => {
    const player = new AudioPlayer({ async play() {}, pause() {} });

    assert.doesNotThrow(() => player.updateVolume(0.5));
});
