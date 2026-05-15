const originalAudioContext = globalThis.AudioContext;
const originalCustomElements = globalThis.customElements;
const originalDocument = globalThis.document;
const originalElement = globalThis.Element;
const originalFetch = globalThis.fetch;
const originalHTMLElement = globalThis.HTMLElement;
const originalLocalStorage = globalThis.localStorage;
const originalMatchMedia = globalThis.matchMedia;
const originalMediaMetadata = globalThis.MediaMetadata;
const originalNavigator = globalThis.navigator;

class FakeElement {
    constructor() {
        this.attributes = new Map();
        this.eventHandlers = new Map();
        this.textContent = "";
        this.value = "1";
        this.dataset = {};
        this.classList = {
            add() {},
            remove() {},
            contains() {
                return false;
            },
        };
    }

    addEventListener(type, handler) {
        const handlers = this.eventHandlers.get(type) ?? [];

        handlers.push(handler);
        this.eventHandlers.set(type, handlers);
    }

    async dispatch(type, event = {}) {
        const handlers = this.eventHandlers.get(type) ?? [];

        for (const handler of handlers) {
            await handler({ target: this, ...event });
        }
    }

    closest() {
        return null;
    }

    querySelector(selector) {
        if (!this.children) return null;
        return this.children.get(selector) ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
}

class FakeAudioElement extends FakeElement {
    constructor() {
        super();
        this.paused = true;
        this.src = "";
        this.currentTime = 0;
        this.loadCalls = 0;
        this.playCalls = 0;
        this.pauseCalls = 0;
    }

    canPlayType() {
        return "probably";
    }

    load() {
        this.loadCalls += 1;
    }

    async play() {
        this.playCalls += 1;
        this.paused = false;
        await this.dispatch("play");
    }

    pause() {
        this.pauseCalls += 1;
        this.paused = true;
        void this.dispatch("pause");
    }
}

export function installAppTestEnvironment() {
    const mediaSessionHandlers = new Map();
    const elements = new Map();
    const title = new FakeElement();
    const currentTitle = new FakeElement();
    const incomingTitle = new FakeElement();
    const audioElement = new FakeAudioElement();
    const documentHandlers = new Map();
    const storage = new Map();

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
    ]) {
        elements.set(id, new FakeElement());
    }

    elements.set("title", title);
    elements.set("audioElement", audioElement);

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
        async dispatch(type, event = {}) {
            const handlers = documentHandlers.get(type) ?? [];

            for (const handler of handlers) {
                await handler(event);
            }
        },
        getElementById(id) {
            return elements.get(id);
        },
    };
    globalThis.localStorage = {
        getItem(key) {
            return storage.get(key) ?? null;
        },
        setItem(key, value) {
            storage.set(key, String(value));
        },
    };
    globalThis.matchMedia = () => ({ matches: false });
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
                    mediaSessionHandlers.set(action, handler);
                },
                setPositionState() {},
            },
        },
    });
    globalThis.fetch = async () => ({
        ok: true,
        async arrayBuffer() {
            return new ArrayBuffer(8);
        },
    });
    globalThis.AudioContext = class FakeAudioContext {
        state = "suspended";
        currentTime = 12;
        destination = {};

        addEventListener() {}

        createMediaElementSource() {
            return {
                connect(node) {
                    return node;
                },
            };
        }

        createGain() {
            return {
                gain: {
                    value: 1,
                    cancelScheduledValues() {},
                    setValueAtTime() {},
                    linearRampToValueAtTime() {},
                },
                connect(node) {
                    return node;
                },
            };
        }

        createBufferSource() {
            return {
                connect() {},
                start() {},
                stop() {},
            };
        }

        async decodeAudioData(arrayBuffer) {
            return { arrayBuffer, duration: 30 };
        }

        async resume() {
            this.state = "running";
        }

        async suspend() {
            this.state = "suspended";
        }
    };

    return {
        audioElement,
        elements,
        mediaActions: createMediaActions(mediaSessionHandlers),
        mediaSessionHandlers,
        navigator: globalThis.navigator,
        storage,
    };
}

export async function startAppTestEnvironment() {
    const environment = installAppTestEnvironment();

    await importApp();

    return environment;
}

export async function importApp() {
    const scriptUrl = new URL("../script.js", import.meta.url);
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
    globalThis.matchMedia = originalMatchMedia;
    globalThis.MediaMetadata = originalMediaMetadata;
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
    };
}

function runMediaAction(mediaSessionHandlers, action) {
    const handler = mediaSessionHandlers.get(action);

    if (typeof handler !== "function") {
        throw new Error(`Media Session action "${action}" was not registered.`);
    }

    return handler();
}
