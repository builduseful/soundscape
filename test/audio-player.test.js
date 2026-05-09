import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { AudioPlayer } from "../src/audio-player.js";

const originalAudioContext = globalThis.AudioContext;
const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    globalThis.fetch = originalFetch;
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
        decodedBuffers = [];
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
            };

            this.gains.push(gainNode);
            return gainNode;
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
            const decodedBuffer = { arrayBuffer, duration: 30 };

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
            async arrayBuffer() {
                return new ArrayBuffer(8);
            },
        };
    };

    return calls;
}

test("playTrack uses a decoded buffer for the audible loop and keeps the media element browser-visible", async () => {
    const contexts = installAudioContext();
    const fetchCalls = installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);

    assert.equal(player.hasContext(), true);
    assert.equal(player.hasTrack(), true);
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
    assert.equal(audibleSource.buffer, context.decodedBuffers[0]);
    assert.equal(audibleSource.loop, true);
    assert.deepEqual(audibleSource.startCalls, [0]);
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
    assert.equal(contexts[0].bufferSources[1].buffer, contexts[0].decodedBuffers[0]);
});

test("playTrack can replace the current track and keep the new track paused", async () => {
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
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(audioElement.playCalls, 0);
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

test("playTrack accepts supported MIME types before loading the track", async () => {
    installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({
        url: "/rain.ogg",
        mime: "audio/ogg; codecs=vorbis",
    }, true);

    assert.equal(audioElement.src, "/rain.ogg");
});

test("playTrack rejects unsupported track MIME types before creating the audio graph", async () => {
    const contexts = installAudioContext();
    const fetchCalls = installFetch();
    const audioElement = createAudioElement();
    audioElement.canPlayType = () => "";
    const player = new AudioPlayer(audioElement);

    await assert.rejects(
        () => player.playTrack({ url: "/rain.ogg", mime: "audio/ogg; codecs=vorbis" }, true),
        /Unsupported audio type: audio\/ogg; codecs=vorbis/,
    );

    assert.equal(contexts.length, 0);
    assert.equal(audioElement.loadCalls, 0);
    assert.deepEqual(fetchCalls, []);
});

test("play and pause keep a loaded track's audio context and media element in sync", async () => {
    const contexts = installAudioContext();
    installFetch();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);
    await player.pause();
    assert.equal(player.state, "suspended");
    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(contexts[0].suspendCalls, 1);

    await player.play();
    assert.equal(player.state, "running");
    assert.equal(player.isPlaying(), true);
    assert.equal(audioElement.playCalls, 2);
    assert.equal(contexts[0].resumeCalls, 2);
});

test("supportsTrack intentionally checks only the MIME type", () => {
    const audioElement = createAudioElement();
    const checkedTypes = [];
    audioElement.canPlayType = (type) => {
        checkedTypes.push(type);
        return "probably";
    };

    const player = new AudioPlayer(audioElement);
    const result = player.supportsTrack({ url: "/rain.ogg", mime: "audio/ogg; codecs=vorbis" });

    assert.equal(result, true);
    assert.deepEqual(checkedTypes, ["audio/ogg; codecs=vorbis"]);
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
