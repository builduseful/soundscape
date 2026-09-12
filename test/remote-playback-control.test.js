import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The remote playback control, tested against a DOM stand-in rather than a
 * behaviour stand-in.
 *
 * The app suite fakes this component; this file fakes the browser under it. That
 * is the split that makes both meaningful: there, the subject is the app and the
 * control is a recorder, so a fake reproducing the pulse would prove nothing;
 * here the subject is the control and everything it does — the pulse, the glyph
 * state, the announcement wording, the facade calls — is the real class.
 *
 * What is not covered here is the markup and CSS `render()` writes, because a
 * fake DOM that parsed HTML would be a browser. That half is checked as source by
 * component-contract.test.js, which pins the state names in the template against
 * the ones in the logic below.
 */

const originalHTMLElement = globalThis.HTMLElement;
const CONTROL_URL = new URL("../src/js/remote-playback/control.js", import.meta.url);
const PROVIDERS_DIR = new URL("../src/js/remote-playback/providers/", import.meta.url);

class FakeNode {
    constructor(tag) {
        this.tag = tag;
        this.dataset = {};
        this.textContent = "";
        // Recorded, not parsed: the glyph slots are handed whole drawings by the
        // provider, and what matters here is that each lands in its own slot.
        this.innerHTML = "";
        this.attributes = new Map();
        this.listeners = new Map();
    }

    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) ?? [];

        handlers.push(handler);
        this.listeners.set(type, handlers);
    }

    removeEventListener(type, handler) {
        this.listeners.set(
            type,
            (this.listeners.get(type) ?? []).filter((candidate) => candidate !== handler),
        );
    }

    async dispatch(type) {
        for (const handler of [...(this.listeners.get(type) ?? [])]) {
            await handler({ type });
        }
    }

    listenerCount(type) {
        return (this.listeners.get(type) ?? []).length;
    }

    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    removeAttribute(name) {
        this.attributes.delete(name);
    }
}

// Everything HTMLElement gives the component, and nothing more. innerHTML is
// recorded rather than parsed: the two nodes the component reaches for are
// handed back by querySelector, and the template itself is the contract test's
// business.
class FakeHost {
    constructor() {
        this.hidden = false;
        this.markup = "";
        this.removed = false;
        this._button = new FakeNode("button");
        this._status = new FakeNode("p");
        this._idleGlyph = new FakeNode("span");
        this._connectedGlyph = new FakeNode("span");
    }

    set innerHTML(value) {
        this.markup = value;
    }

    get innerHTML() {
        return this.markup;
    }

    querySelector(selector) {
        if (selector === "button") return this._button;
        if (selector === "p") return this._status;
        if (selector === ".glyph-idle") return this._idleGlyph;
        if (selector === ".glyph-connected") return this._connectedGlyph;

        return null;
    }

    remove() {
        this.removed = true;
    }
}

async function loadComponent() {
    globalThis.HTMLElement = FakeHost;

    const url = new URL("../src/js/remote-playback/control.js", import.meta.url);

    url.search = `?test=${Date.now()}-${Math.random()}`;

    try {
        return await import(url.href);
    } finally {
        globalThis.HTMLElement = originalHTMLElement;
    }
}

function createFacade({
    prompt = async () => true,
    transportReady = true,
    prepare = () => true,
    icon = { idle: "<svg id='idle'></svg>", connected: "<svg id='connected'></svg>" },
} = {}) {
    const calls = { prompt: 0, prepare: 0, unavailable: [] };

    return {
        calls,
        icon,
        prompt: async () => {
            calls.prompt += 1;

            return prompt();
        },
        prepare: () => {
            calls.prepare += 1;

            return prepare();
        },
        isTransportReady: () => transportReady,
        onUnavailable: (message) => calls.unavailable.push(message),
    };
}

async function createControl(facadeOptions) {
    const { RemotePlayback } = await loadComponent();
    const control = new RemotePlayback();

    control.connectedCallback();

    const facade = facadeOptions === null ? null : createFacade(facadeOptions);

    if (facade) control.attach(facade);

    return { control, facade, button: control.button(), status: control.status() };
}

test("the control renders hidden and shows itself only once attached", async () => {
    const { RemotePlayback } = await loadComponent();
    const control = new RemotePlayback();

    control.connectedCallback();

    assert.equal(control.hidden, true, "nothing should flash in before a provider is known");
    assert.notEqual(control.markup, "", "the template still renders, so attaching is instant");

    control.attach(createFacade());

    assert.equal(control.hidden, false);
});

// Not hidden — gone. A browser with no way to cast should be left no markup at
// all rather than a control kept permanently out of sight.
test("detaching removes the control from the document", async () => {
    const { RemotePlayback } = await loadComponent();
    const control = new RemotePlayback();

    control.connectedCallback();
    control.detach();

    assert.equal(control.removed, true);
});

// Nothing is wired before attach: a press on a control with no provider has
// nothing to call, so there must be no listener able to try.
test("no listener exists before the control is attached", async () => {
    const { RemotePlayback } = await loadComponent();
    const control = new RemotePlayback();

    control.connectedCallback();

    assert.equal(control.button().listenerCount("click"), 0);
    assert.equal(control.button().listenerCount("pointerenter"), 0);
});

test("the three connection states each get their own glyph state and label", async () => {
    const { control, button } = await createControl();

    assert.equal(button.dataset.remoteState, "idle");

    control.setConnection({ connecting: true });
    assert.equal(control.state, "connecting");
    assert.equal(button.dataset.remoteState, "connecting");
    assert.match(button.getAttribute("aria-label"), /connecting/i);

    control.setConnection({ connected: true });
    assert.equal(control.state, "connected");
    assert.equal(button.dataset.remoteState, "connected");
    assert.match(button.getAttribute("aria-label"), /stop/i);

    control.setConnection({});
    assert.equal(control.state, "idle");
    assert.equal(button.dataset.remoteState, "idle");
    assert.match(button.getAttribute("aria-label"), /another device/i);
});

// The connection shows itself as a filled glyph and a changed label, neither of
// which a screen reader announces on an unfocused control.
test("connecting and disconnecting are announced", async () => {
    const { control, status } = await createControl();

    assert.equal(status.textContent, "", "nothing to announce at rest");

    control.setConnection({ connected: true });
    assert.match(status.textContent, /another device/i);

    control.setConnection({});
    assert.match(status.textContent, /this device/i);
});

// Reaching a Chromecast takes seconds. Without this the screen reader user gets
// silence for the whole wait.
test("the wait for a device is announced too", async () => {
    const { control, status } = await createControl();

    control.setConnection({ connecting: true });

    assert.match(status.textContent, /connecting/i);
});

// "Playback returned to this device" is only true if it ever left. A connection
// abandoned before it completed never moved the audio, so the announcement is
// cleared rather than replaced with a claim that did not happen.
test("a connection that never completes is not announced as a handback", async () => {
    const { control, status } = await createControl();

    control.setConnection({ connecting: true });
    control.setConnection({});

    assert.equal(status.textContent, "");
});

test("a repeated state is not re-announced", async () => {
    const { control, status } = await createControl();

    control.setConnection({ connected: true });
    status.textContent = "cleared by hand";
    control.setConnection({ connected: true });

    assert.equal(status.textContent, "cleared by hand");
});

// Opening a picker is not instant — a header has to be read, and on the SDK path
// a cross-origin script fetched — and until it appears the press has no visible
// effect at all, which reads as a broken button.
test("the control shows the wait while the picker is opening", async () => {
    let releasePrompt;
    const pending = new Promise((resolve) => {
        releasePrompt = resolve;
    });
    const { button } = await createControl({ prompt: () => pending });

    const pressed = button.dispatch("click");

    await Promise.resolve();

    assert.equal(button.dataset.remoteBusy, "true");
    assert.equal(button.getAttribute("aria-busy"), "true");
    // Nothing is connected, so the glyph must not claim otherwise.
    assert.equal(button.dataset.remoteState, "idle");

    releasePrompt(true);
    await pressed;

    assert.equal(button.dataset.remoteBusy, undefined);
    assert.equal(button.getAttribute("aria-busy"), null);
});

// A dismissed picker and a picker that never opened are the same `false`, and on
// Chromium the same DOMException too — so the transport's own readiness is what
// separates them.
test("a press that reached no picker reports the wording, and a dismissal does not", async () => {
    const dismissed = await createControl({ prompt: async () => false, transportReady: true });

    await dismissed.button.dispatch("click");
    assert.deepEqual(dismissed.facade.calls.unavailable, [], "a dismissal is an ordinary outcome");

    const unreachable = await createControl({ prompt: async () => false, transportReady: false });

    await unreachable.button.dispatch("click");
    assert.equal(unreachable.facade.calls.unavailable.length, 1);
    assert.match(unreachable.facade.calls.unavailable[0], /device list/i);
});

test("a prompt that opened is never reported as unavailable", async () => {
    const { button, facade } = await createControl({ prompt: async () => true, transportReady: false });

    await button.dispatch("click");

    assert.deepEqual(facade.calls.unavailable, []);
});

// The pulse has to come off even when the press throws, or the control is left
// claiming a wait that ended.
test("a prompt that throws still clears the wait", async () => {
    const { button } = await createControl({
        prompt: () => Promise.reject(new Error("picker exploded")),
    });

    await assert.rejects(() => button.dispatch("click"));

    assert.equal(button.dataset.remoteBusy, undefined);
    assert.equal(button.getAttribute("aria-busy"), null);
});

// Hover, focus, or the pointerdown before a tap: the last moment the wait can be
// spent instead of shown.
test("any of the three approach gestures prepares the provider", async () => {
    for (const gesture of ["pointerenter", "pointerdown", "focus"]) {
        const { button, facade } = await createControl();

        await button.dispatch(gesture);

        assert.equal(facade.calls.prepare, 1, `${gesture} should prepare`);
    }
});

// One preparation is all there is, so all three listeners come off together.
test("preparing once removes every approach listener", async () => {
    const { button, facade } = await createControl();

    await button.dispatch("pointerenter");

    assert.equal(button.listenerCount("pointerenter"), 0);
    assert.equal(button.listenerCount("pointerdown"), 0);
    assert.equal(button.listenerCount("focus"), 0);
    assert.equal(button.listenerCount("click"), 1, "the press must survive it");

    await button.dispatch("focus");
    assert.equal(facade.calls.prepare, 1);
});

// A provider that has nothing to prepare answers false, and the listeners have
// to stay: the work it will eventually do has not been done.
test("a provider with nothing to prepare yet keeps its listeners", async () => {
    const { button } = await createControl({ prepare: () => false });

    await button.dispatch("pointerenter");

    assert.equal(button.listenerCount("pointerenter"), 1);
    assert.equal(button.listenerCount("focus"), 1);
});

// Nothing here names a technology, which is the point: a provider added
// tomorrow gets its mark drawn without this file changing.
test("the button wears the drawings the provider supplied", async () => {
    const icon = { idle: "<svg id='mine-idle'></svg>", connected: "<svg id='mine-connected'></svg>" };
    const { control } = await createControl({ icon });

    assert.equal(control.querySelector(".glyph-idle").innerHTML, icon.idle);
    assert.equal(control.querySelector(".glyph-connected").innerHTML, icon.connected);
});

// Both go up at once and CSS shows one, so a connection can never land on a
// button whose glyph has not been drawn yet.
test("both drawings are in place from the moment the control is attached", async () => {
    const { control } = await createControl();

    control.setConnection({ connected: true });

    assert.notEqual(control.querySelector(".glyph-idle").innerHTML, "");
    assert.notEqual(control.querySelector(".glyph-connected").innerHTML, "");
});
