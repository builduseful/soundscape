/**
 * The plugin front door.
 *
 * `createRemotePlayback()` is the whole extension point: it decides, once and
 * from the browser alone, which provider this engine gets — or that it gets none
 * — and it is the boundary where a malformed provider is supposed to be caught
 * by name rather than three interactions later, mid-handover.
 *
 * None of it had a direct test. Selection was covered only through the app
 * harness, which exercises the answer rather than the choosing, and the
 * conformance check had no test at all — so the one thing standing between a new
 * provider and an `undefined is not a function` was itself unverified.
 *
 * Nothing here reaches a network, a device or a real browser API. Every scope is
 * a plain object.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
    REMOTE_PROVIDER_MEMBERS,
    createRemotePlayback,
    missingRemoteProviderMembers,
} from "../src/js/remote-playback/index.js";
import { PLAYBACK_OUTPUT_MEMBERS } from "../src/js/playback-output.js";

const originalConsoleWarn = console.warn;

afterEach(() => {
    console.warn = originalConsoleWarn;
});

function captureWarnings() {
    const warnings = [];

    console.warn = (...args) => warnings.push(args);

    return warnings;
}

// A provider that satisfies both contracts and nothing more, so a test can say
// which member it is removing.
function conformingProvider(overrides = {}) {
    const provider = {};

    for (const member of [...REMOTE_PROVIDER_MEMBERS, ...PLAYBACK_OUTPUT_MEMBERS]) {
        provider[member] = () => false;
    }

    provider.isSupported = () => true;

    return Object.assign(provider, overrides);
}

function descriptor(name, candidate) {
    return { name, create: () => candidate };
}

test("the first supported provider wins, and the rest are never built", () => {
    const built = [];
    const first = conformingProvider();
    const second = conformingProvider();

    const chosen = createRemotePlayback({
        providers: [
            { name: "first", create: () => (built.push("first"), first) },
            { name: "second", create: () => (built.push("second"), second) },
        ],
    });

    assert.equal(chosen, first);
    assert.deepEqual(built, ["first"], "a later provider was built despite an earlier one winning");
});

// The ordinary answer on Firefox and Samsung Internet. Not an error, and not a
// degraded mode — the shape the core is written against.
test("a browser with no provider gets null rather than a stub", () => {
    const warnings = captureWarnings();

    const chosen = createRemotePlayback({
        providers: [
            descriptor("unbuildable", null),
            descriptor("unsupported", conformingProvider({ isSupported: () => false })),
        ],
    });

    assert.equal(chosen, null);
    assert.deepEqual(warnings, [], "a browser that simply cannot cast should say nothing at all");
});

test("a provider missing a PlaybackOutput member is refused, by name", () => {
    const warnings = captureWarnings();
    const broken = conformingProvider();

    delete broken.holdsTrack;

    const chosen = createRemotePlayback({ providers: [descriptor("broken", broken)] });

    assert.equal(chosen, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /"broken"/);
    assert.deepEqual(warnings[0][1], ["holdsTrack"]);
});

// The half that was prose until now. `setPlaybackRequested` is how a handover
// pushes intent into the output it is handing to; a provider without it fails in
// the middle of moving the audio, which is the worst possible moment to find out.
test("a provider missing a provider-contract member is refused too", () => {
    const warnings = captureWarnings();
    const broken = conformingProvider();

    delete broken.setPlaybackRequested;

    const chosen = createRemotePlayback({ providers: [descriptor("broken", broken)] });

    assert.equal(chosen, null);
    assert.deepEqual(warnings[0][1], ["setPlaybackRequested"]);
});

// The check has to come before anything is called on the candidate, or the
// boundary meant to catch a bad provider becomes the thing that throws.
test("a provider missing isSupported is reported, not called", () => {
    const warnings = captureWarnings();
    const broken = conformingProvider();

    delete broken.isSupported;

    assert.doesNotThrow(() => {
        const chosen = createRemotePlayback({ providers: [descriptor("broken", broken)] });

        assert.equal(chosen, null);
    });

    assert.deepEqual(warnings[0][1], ["isSupported"]);
});

// A malformed provider costs the app its button, not its soundscape — and not
// the next provider's turn either.
test("a malformed provider does not deny a working one its turn", () => {
    captureWarnings();
    const working = conformingProvider();
    const broken = conformingProvider();

    delete broken.prompt;

    const chosen = createRemotePlayback({
        providers: [descriptor("broken", broken), descriptor("working", working)],
    });

    assert.equal(chosen, working);
});

test("missingRemoteProviderMembers answers for a whole missing provider", () => {
    assert.deepEqual(missingRemoteProviderMembers(null), REMOTE_PROVIDER_MEMBERS);
    assert.deepEqual(missingRemoteProviderMembers(conformingProvider()), []);
});

// The two contracts are disjoint on purpose: a member that appears in both would
// be one the port had quietly grown for the remotes' benefit.
test("the two contracts share no members", () => {
    const shared = REMOTE_PROVIDER_MEMBERS.filter((member) => PLAYBACK_OUTPUT_MEMBERS.includes(member));

    assert.deepEqual(shared, []);
});

// Selection is a fact about the browser, and the real providers have to agree
// with the registry about which browser is theirs.
test("the real providers select on the engine, not on chance", () => {
    const castableElement = { remote: { watchAvailability() {} }, addEventListener() {}, removeEventListener() {} };
    const chrome = {
        PresentationRequest() {},
        isSecureContext: true,
        navigator: { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }] } },
    };
    const safari = { isSecureContext: true, navigator: {} };
    const samsung = {
        PresentationRequest() {},
        isSecureContext: true,
        navigator: { userAgentData: { brands: [{ brand: "Chromium" }, { brand: "Samsung Internet" }] } },
    };

    assert.equal(
        createRemotePlayback({ element: castableElement, scope: chrome })?.backendName(),
        "cast-sdk",
        "Chrome must take the Cast SDK: its Remote Playback picker never opens for this audio",
    );
    assert.equal(
        createRemotePlayback({ element: castableElement, scope: safari })?.backendName(),
        "remote-playback",
        "Safari must keep the media element path, the one engine that honours it",
    );
    assert.equal(
        createRemotePlayback({ element: castableElement, scope: samsung }),
        null,
        "Samsung Internet ships both APIs and neither works; it must get no control at all",
    );
});
