const originalAudioContext = globalThis.AudioContext;
const originalCustomElements = globalThis.customElements;
const originalDocument = globalThis.document;
const originalElement = globalThis.Element;
const originalFetch = globalThis.fetch;
const originalHTMLElement = globalThis.HTMLElement;
const originalLocalStorage = globalThis.localStorage;
const originalLaunchQueue = globalThis.launchQueue;
const originalMatchMedia = globalThis.matchMedia;
const originalMediaMetadata = globalThis.MediaMetadata;
const originalNavigator = globalThis.navigator;
const originalClearInterval = globalThis.clearInterval;
const originalSetInterval = globalThis.setInterval;
const originalClearTimeout = globalThis.clearTimeout;
const originalSetTimeout = globalThis.setTimeout;

class FakeElement {
    constructor() {
        this.attributes = new Map();
        this.eventHandlers = new Map();
        this.classNames = new Set();
        this.textContent = "";
        this.value = "1";
        this.dataset = {};
        this.isContentEditable = false;
        this.closestMatch = null;
        this.offsetWidth = 0;
        this.classList = {
            add: (...names) => {
                for (const name of names) {
                    this.classNames.add(name);
                }
            },
            remove: (...names) => {
                for (const name of names) {
                    this.classNames.delete(name);
                }
            },
            contains: (name) => {
                return this.classNames.has(name);
            },
        };
    }

    addEventListener(type, handler) {
        const handlers = this.eventHandlers.get(type) ?? [];

        handlers.push(handler);
        this.eventHandlers.set(type, handlers);
    }

    removeEventListener(type, handler) {
        const handlers = this.eventHandlers.get(type) ?? [];

        this.eventHandlers.set(type, handlers.filter((candidate) => candidate !== handler));
    }

    async dispatch(type, event = {}) {
        const handlers = this.eventHandlers.get(type) ?? [];
        const dispatchedEvent = createFakeEvent(this, event);

        for (const handler of handlers) {
            await handler(dispatchedEvent);
        }

        return dispatchedEvent;
    }

    closest(selector) {
        if (typeof this.closestMatch === "function") {
            return this.closestMatch(selector);
        }

        return this.closestMatch === selector ? this : null;
    }

    querySelector(selector) {
        if (!this.children) return null;
        return this.children.get(selector) ?? null;
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    toggleAttribute(name, force) {
        const shouldSet = force === undefined ? !this.hasAttribute(name) : Boolean(force);

        if (shouldSet) {
            this.setAttribute(name, "");
        } else {
            this.removeAttribute(name);
        }

        return shouldSet;
    }
}

class FakeAudioElement extends FakeElement {
    constructor() {
        super();
        this.paused = true;
        this.sourceUrl = "";
        this.currentTime = 0;
        // A real element reads its header off the network, so the app's wait for
        // it is a real wait. Resolving on a microtask keeps that shape without
        // costing the suite any time; a test that wants to hold the element at
        // readyState 0 clears autoLoadMetadata and drives it by hand.
        this.readyState = 0;
        this.autoLoadMetadata = true;
        // The spec default, so a test can tell "left alone" from "set to full".
        this.volume = 1;
        this.loadCalls = 0;
        this.playCalls = 0;
        this.pauseCalls = 0;
        this.playShouldFail = false;
        this.playGates = [];
    }

    get src() {
        return this.sourceUrl;
    }

    // Assigning src runs the media load algorithm, which drops readiness back to
    // nothing — the behaviour the cast picker's metadata wait exists for.
    set src(value) {
        this.sourceUrl = value;
        this.readyState = 0;

        if (this.autoLoadMetadata && value) {
            queueMicrotask(() => this.completeMetadataLoad());
        }
    }

    completeMetadataLoad() {
        if (!this.sourceUrl) return;

        this.readyState = 1;
        void this.dispatch("loadedmetadata");
    }

    failMetadataLoad() {
        void this.dispatch("error");
    }

    canPlayType(mime) {
        return mime.includes("audio/mpeg") || mime.includes("audio/ogg") || mime.includes("audio/opus") || mime.includes("audio/wav") ? "probably" : "";
    }

    load() {
        this.loadCalls += 1;
    }

    async play() {
        this.playCalls += 1;
        this.paused = false;
        const shouldFail = this.playShouldFail;
        const gate = this.playGates.shift();

        if (gate) {
            await gate;
        }

        if (shouldFail) {
            throw new Error("Media element rejected playback");
        }

        await this.dispatch("play");
    }

    async pause() {
        this.pauseCalls += 1;
        this.paused = true;
        await this.dispatch("pause");
    }
}

// The fake decodeAudioData below returns 30 s at 48 kHz. applyLoopCrossfade
// then trims the loop by its 10 ms overlap, so the period the app reports as
// Media Session duration is shorter than the decoded file.
export const FAKE_TRACK_SECONDS = 30;
export const FAKE_TRACK_LOOP_SECONDS = (48000 * FAKE_TRACK_SECONDS - 480) / 48000;

// Stands in for a Remote Playback API implementation on the cast element. It is
// opt-in because the default environment should look like a machine with no
// cast devices on the network — which is what most of the suite assumes.
function createFakeRemotePlayback() {
    const listeners = new Map();

    return {
        state: "disconnected",
        promptCalls: 0,
        promptShouldReject: null,

        // Present but never expected to run. The backend feature-detects on this
        // method without calling it — see its comment in cast.js for why it probes
        // one it does not use — so the fake has to carry it to be selected at all.
        // Counted so a test can prove no scan was started.
        watchAvailabilityCalls: 0,
        watchAvailability() {
            this.watchAvailabilityCalls += 1;
            return Promise.resolve(1);
        },

        addEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            handlers.push(handler);
            listeners.set(type, handlers);
        },
        removeEventListener(type, handler) {
            const handlers = listeners.get(type) ?? [];

            listeners.set(type, handlers.filter((candidate) => candidate !== handler));
        },
        prompt() {
            this.promptCalls += 1;

            if (this.promptShouldReject) return Promise.reject(this.promptShouldReject);

            return Promise.resolve();
        },

        // Test-facing controls.
        // The real sequence between the picker and a live session, which on a
        // Chromecast lasts several seconds and is a state the app reports.
        async beginConnecting() {
            this.state = "connecting";
            await this.emit("connecting");
        },
        async connect() {
            this.state = "connected";
            await this.emit("connect");
        },
        async disconnect() {
            this.state = "disconnected";
            await this.emit("disconnect");
        },
        async emit(type) {
            for (const handler of listeners.get(type) ?? []) {
                await handler({ type });
            }
        },
    };
}

export function installAppTestEnvironment({
    castDevices = false,
    fetch = defaultFetch,
    launchQueue,
    matchMediaMatches = false,
    storageEntries = {},
} = {}) {
    const audioContexts = [];
    const mediaSessionHandlers = new Map();
    let mediaSessionHandlerCalls = 0;
    const mediaSessionPositionStates = [];
    const elements = new Map();
    const title = new FakeElement();
    const currentTitle = new FakeElement();
    const incomingTitle = new FakeElement();
    const audioElement = new FakeAudioElement();
    const castAudioElement = new FakeAudioElement();
    const castRemote = castDevices ? createFakeRemotePlayback() : null;
    const documentHandlers = new Map();

    if (castRemote) {
        castAudioElement.remote = castRemote;
    }
    const intervals = new Map();
    const timeouts = new Map();
    const timeoutLog = [];
    const storage = createStorageMap(storageEntries);
    let nextIntervalId = 1;
    let nextTimeoutId = 1;

    currentTitle.classList.add("track-title-text--current");
    incomingTitle.classList.add("track-title-text--incoming");
    title.children = new Map([
        [".track-title-text--current", currentTitle],
        [".track-title-text--incoming", incomingTitle],
    ]);

    for (const id of [
        "volumeControl",
        "playPauseButton",
        "nextButton",
        "previousButton",
        "themeSelector",
        "appVersion",
        "playbackError",
        "trackLoading",
        "trackLoadingLabel",
        "castButton",
        "castStatus",
    ]) {
        elements.set(id, new FakeElement());
    }

    elements.get("castButton").hidden = true;

    // Mirrors the `hidden` attribute on the real elements so tests can assert
    // whether a playback failure — or a slow load — is actually surfaced.
    elements.get("playbackError").hidden = true;
    elements.get("trackLoading").hidden = true;

    elements.set("title", title);
    elements.set("audioElement", audioElement);
    elements.set("castAudioElement", castAudioElement);

    globalThis.HTMLElement = FakeElement;
    globalThis.Element = FakeElement;
    globalThis.customElements = {
        define() {},
    };
    globalThis.document = {
        title: "",
        hidden: false,
        documentElement: new FakeElement(),
        addEventListener(type, handler) {
            const handlers = documentHandlers.get(type) ?? [];

            handlers.push(handler);
            documentHandlers.set(type, handlers);
        },
        removeEventListener(type, handler) {
            const handlers = documentHandlers.get(type) ?? [];

            documentHandlers.set(type, handlers.filter((candidate) => candidate !== handler));
        },
        async dispatch(type, event = {}) {
            const handlers = documentHandlers.get(type) ?? [];
            const dispatchedEvent = createFakeEvent(this, event);

            for (const handler of handlers) {
                await handler(dispatchedEvent);
            }

            return dispatchedEvent;
        },
        getElementById(id) {
            return elements.get(id);
        },
    };
    globalThis.localStorage = {
        shouldFail: false,
        getItem(key) {
            if (this.shouldFail) throw new Error("Storage failed");
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            if (this.shouldFail) throw new Error("Storage failed");
            storage.set(key, String(value));
        },
    };
    globalThis.launchQueue = launchQueue;
    globalThis.matchMedia = () => ({ matches: matchMediaMatches });
    globalThis.MediaMetadata = function FakeMediaMetadata(metadata) {
        Object.assign(this, metadata);
    };
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
            mediaSession: {
                metadata: undefined,
                playbackState: "none",
                setActionHandler(action, handler) {
                    mediaSessionHandlerCalls += 1;
                    mediaSessionHandlers.set(action, handler);
                },
                setPositionState(positionState) {
                    mediaSessionPositionStates.push(positionState);
                },
            },
        },
    });
    globalThis.fetch = fetch;
    globalThis.setInterval = (handler, delay) => {
        const id = nextIntervalId++;

        intervals.set(id, { delay, handler });
        return id;
    };
    globalThis.clearInterval = (id) => {
        intervals.delete(id);
    };
    // `timeouts` only holds timers that are still pending, so a timer that was
    // armed and then cleared is indistinguishable from one that was never armed.
    // For debounced UI that difference is the whole behaviour, so every timer is
    // also recorded here with what eventually happened to it.
    globalThis.setTimeout = (handler, delay) => {
        const id = nextTimeoutId++;
        const record = { id, delay, fired: false, cleared: false };

        timeoutLog.push(record);

        if (delay === 0) {
            originalSetTimeout(() => {
                if (timeouts.has(id)) {
                    timeouts.delete(id);
                    record.fired = true;
                    handler();
                }
            }, 0);
        }

        timeouts.set(id, { delay, handler, record });
        return id;
    };
    globalThis.clearTimeout = (id) => {
        const timeout = timeouts.get(id);

        if (timeout) {
            timeout.record.cleared = true;
        }

        timeouts.delete(id);
    };
    globalThis.AudioContext = class FakeAudioContext {
        state = "suspended";
        currentTime = 12;
        destination = {};
        bufferSources = [];
        gains = [];
        eventHandlers = new Map();
        decodeAudioDataCalls = 0;
        decodeAudioDataShouldFail = false;

        constructor() {
            audioContexts.push(this);
        }

        addEventListener(type, handler) {
            this.eventHandlers.set(type, handler);
        }

        async dispatch(type) {
            await this.eventHandlers.get(type)?.();
        }

        createMediaElementSource() {
            return {
                connect(node) {
                    return node;
                },
            };
        }

        createGain() {
            const gainNode = {
                gain: {
                    calls: [],
                    value: 1,
                    cancelScheduledValues(time) {
                        this.calls.push({ name: "cancelScheduledValues", time });
                    },
                    setValueAtTime(value, time) {
                        this.calls.push({ name: "setValueAtTime", value, time });
                    },
                    linearRampToValueAtTime(value, time) {
                        this.calls.push({ name: "linearRampToValueAtTime", value, time });
                        this.value = value;
                    },
                    setValueCurveAtTime(curve, time, duration) {
                        this.calls.push({ name: "setValueCurveAtTime", curve, time, duration });
                        this.value = curve[curve.length - 1];
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

            return {
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
        }

        createBufferSource() {
            const source = {
                connect() {},
                disconnect() {},
                start() {},
                stop() {},
            };

            this.bufferSources.push(source);
            return source;
        }

        async decodeAudioData(arrayBuffer) {
            this.decodeAudioDataCalls++;
            if (this.decodeAudioDataShouldFail) {
                throw new Error("Decode failed");
            }

            const sampleRate = 48000;
            const duration = 30;
            const length = sampleRate * duration;
            const channels = [new Float32Array(length)];

            return {
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
        }

        async resume() {
            this.state = "running";
            await this.dispatch("statechange");
        }

        async suspend() {
            this.state = "suspended";
            await this.dispatch("statechange");
        }
    };

    return {
        audioContexts,
        audioElement,
        castAudioElement,
        castRemote,
        elements,
        intervals,
        timeouts,
        timeoutLog,
        mediaActions: createMediaActions(mediaSessionHandlers),
        mediaSessionHandlers,
        get mediaSessionHandlerCalls() {
            return mediaSessionHandlerCalls;
        },
        mediaSessionPositionStates,
        navigator: globalThis.navigator,
        storage,
        triggerInterval(id) {
            return intervals.get(id)?.handler();
        },
        async triggerTimeout(id) {
            const timeout = timeouts.get(id);
            timeouts.delete(id);

            if (timeout) {
                timeout.record.fired = true;
            }

            return await timeout?.handler();
        },
    };
}

export async function startAppTestEnvironment(options) {
    const environment = installAppTestEnvironment(options);

    await importApp();

    return environment;
}

export async function importApp() {
    const scriptUrl = new URL("../../src/js/script.js", import.meta.url);
    scriptUrl.search = `?test=${Date.now()}-${Math.random()}`;
    await import(scriptUrl.href);
}

export function restoreAppTestEnvironment() {
    globalThis.AudioContext = originalAudioContext;
    globalThis.customElements = originalCustomElements;
    globalThis.document = originalDocument;
    globalThis.Element = originalElement;
    globalThis.fetch = originalFetch;
    globalThis.HTMLElement = originalHTMLElement;
    globalThis.localStorage = originalLocalStorage;
    globalThis.launchQueue = originalLaunchQueue;
    globalThis.matchMedia = originalMatchMedia;
    globalThis.MediaMetadata = originalMediaMetadata;
    globalThis.clearInterval = originalClearInterval;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearTimeout = originalClearTimeout;
    globalThis.setTimeout = originalSetTimeout;
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: originalNavigator,
    });
}

function createMediaActions(mediaSessionHandlers) {
    return {
        next: () => runMediaAction(mediaSessionHandlers, "nexttrack"),
        pause: () => runMediaAction(mediaSessionHandlers, "pause"),
        play: () => runMediaAction(mediaSessionHandlers, "play"),
        previous: () => runMediaAction(mediaSessionHandlers, "previoustrack"),
        stop: () => runMediaAction(mediaSessionHandlers, "stop"),
    };
}

function runMediaAction(mediaSessionHandlers, action) {
    const handler = mediaSessionHandlers.get(action);

    if (typeof handler !== "function") {
        throw new Error(`Media Session action "${action}" was not registered.`);
    }

    return handler();
}

function createStorageMap(storageEntries) {
    if (storageEntries instanceof Map) {
        return new Map(storageEntries);
    }

    if (Array.isArray(storageEntries)) {
        return new Map(storageEntries);
    }

    return new Map(Object.entries(storageEntries));
}

function createFakeEvent(defaultTarget, event) {
    const dispatchedEvent = {
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        target: defaultTarget,
        ...event,
    };

    if (typeof event.preventDefault === "function") {
        dispatchedEvent.preventDefault = function preventDefault() {
            event.preventDefault();
            this.defaultPrevented = true;
        };
    }

    return dispatchedEvent;
}

async function defaultFetch() {
    return {
        ok: true,
        async arrayBuffer() {
            return new ArrayBuffer(8);
        },
    };
}
