import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { AudioPlayer } from "../src/audio-player.js";

const originalAudioContext = globalThis.AudioContext;

afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
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
        gains = [];
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

test("playTrack uses the media element as the browser-visible source and routes it through gain", async () => {
    const contexts = installAudioContext();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.playTrack({ url: "/sound.ogg" }, true);

    assert.equal(player.hasContext(), true);
    assert.equal(player.hasTrack(), true);
    assert.equal(player.isPlaying(), true);
    assert.equal(audioElement.src, "/sound.ogg");
    assert.equal(audioElement.loop, true);
    assert.equal(audioElement.currentTime, 0);
    assert.equal(audioElement.loadCalls, 1);
    assert.equal(audioElement.playCalls, 1);

    const context = contexts[0];
    const source = context.mediaSources[0];
    const gainNode = context.gains[0];

    assert.equal(context.resumeCalls, 1);
    assert.equal(source.audioElement, audioElement);
    assert.equal(source.connectedTo, gainNode);
    assert.equal(gainNode.connectedTo, context.destination);
});

test("playTrack reuses the media element audio graph when replacing tracks", async () => {
    const contexts = installAudioContext();
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
});

test("playTrack can replace the current track and keep the new track paused", async () => {
    const contexts = installAudioContext({ initialState: "running" });
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
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);
    player.updateVolume(0.35);

    await player.playTrack({ url: "/quiet.ogg" }, true);

    assert.equal(contexts[0].gains[0].gain.value, 0.35);
});

test("play and pause keep the audio context and media element in sync", async () => {
    const contexts = installAudioContext();
    const audioElement = createAudioElement();
    const player = new AudioPlayer(audioElement);

    await player.play();
    assert.equal(player.state, "running");
    assert.equal(player.isPlaying(), true);
    assert.equal(audioElement.playCalls, 1);

    await player.pause();
    assert.equal(player.state, "suspended");
    assert.equal(player.isPlaying(), false);
    assert.equal(audioElement.pauseCalls, 1);
    assert.equal(contexts[0].suspendCalls, 1);
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
