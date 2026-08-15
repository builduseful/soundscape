/**
 * Remote playback — the plugin's front door.
 *
 * Everything about playing the soundscape on something that is not this device
 * lives under this directory, and `script.js` reaches it only through here. That
 * is the whole point of the restructure: the core knows there *may be* another
 * output and knows nothing about what it is. Delete this directory and its two
 * lines in `script.js` and the app is a local player again, with no dangling
 * references and no dead branches.
 *
 * ## What this returns
 *
 * `createRemotePlayback()` answers with **a provider or `null`**, and `null` is
 * the ordinary answer on Firefox, on Samsung Internet, and anywhere else with no
 * way to cast. It is not an error and not a degraded mode — it is the shape the
 * core is written against, which is what makes the plugin detachable rather than
 * merely separated.
 *
 * A provider is two contracts at once:
 *
 *   - **PlaybackOutput** (`playback-output.js`) — the part the core drives when
 *     this output owns the soundscape. Identical to `AudioPlayer`'s.
 *   - **The remote contract** — `isSupported`, `start`, `stopWatching`,
 *     `prompt`, `prepare`, `allowTransportLoad`, `isTransportReady`,
 *     `isConnected`, `isConnecting`, `backendName`, `setTrack`,
 *     `setPlaybackRequested`, `getTrackUrl`. How a remote output is discovered,
 *     opened, kept current and torn down. It has no local counterpart, which is
 *     exactly why it is a second contract and not more members on the first.
 *
 * ## Why the choice is made once, here
 *
 * Selection is a fact about the browser, not about the moment: an engine either
 * has a way to cast or it does not, and that cannot change while the page is
 * open. So this runs once at boot and its answer is final. Nothing downstream
 * re-asks, and nothing downstream branches on *which* provider it got — a
 * `backendName()` exists for diagnostics and for nothing else.
 *
 * Chrome takes the Cast SDK, Safari the media element path. The order below is
 * load-bearing and the two capability checks are pointed at each other on
 * purpose; each provider's header carries the evidence for its own half.
 *
 * ## Why both contracts are checked rather than assumed
 *
 * A provider missing a member fails somewhere downstream, usually mid-handover,
 * as an `undefined is not a function` with the fault three interactions away
 * from its cause. Checking here names it at boot instead, for one pass over two
 * lists of strings.
 */

import { missingPlaybackOutputMembers } from "../playback-output.js";
import { CastSdkController, isCastSdkCapable } from "./providers/cast-sdk.js";
import { MediaElementController } from "./providers/media-element.js";

export { REMOTE_FAILURE_MESSAGE } from "./messages.js";

/**
 * The control is deliberately *not* re-exported here, and that is worth stating
 * because re-exporting it is the obvious tidy-up.
 *
 * `control.js` declares `class RemotePlayback extends HTMLElement`, which is
 * evaluated at import time and does not exist outside a browser. Routing it
 * through this module would make the registry — pure logic, and the thing a new
 * provider is checked against — unloadable in Node without a DOM stub. The
 * registry's own tests found that immediately.
 *
 * So `script.js` imports the control from `./remote-playback/control.js`
 * directly. Two imports from one directory rather than one, which costs nothing:
 * the property that matters is that both paths start `remote-playback/`, so the
 * feature is still a directory you can delete.
 */

/**
 * The second contract, in the same checkable form as the first.
 *
 * A provider is a `PlaybackOutput` *and* these — how a remote output is
 * discovered, opened, kept current and torn down. `playback-output.js` explains
 * why they are not members of the port.
 *
 * Ordered as the app uses them: discovery, then the picker, then keeping the
 * transport current, then teardown.
 */
export const REMOTE_PROVIDER_MEMBERS = [
    "isSupported",
    "backendName",
    "start",
    "stopWatching",
    "isConnected",
    "isConnecting",
    "prompt",
    "prepare",
    "allowTransportLoad",
    "isTransportReady",
    "setTrack",
    "getTrackUrl",
    "setPlaybackRequested",
];

/** Which provider-contract members `candidate` is missing. Empty means it conforms. */
export function missingRemoteProviderMembers(candidate) {
    if (!candidate) return [...REMOTE_PROVIDER_MEMBERS];

    return REMOTE_PROVIDER_MEMBERS.filter((member) => typeof candidate[member] !== "function");
}

/**
 * The providers, most preferred first.
 *
 * `create` returns a candidate or `null`; a candidate is then checked against
 * both contracts and, only if it conforms, asked `isSupported()`. Two stages
 * because the two providers genuinely answer at different times: the SDK path
 * can rule itself out from the browser alone, while the media element path has
 * to be handed the element before it can say which backend — if any — that
 * element supports.
 *
 * Each implementation is one file under `providers/`, named for the entry below
 * it. Adding a third is that file plus one entry here; nothing outside this
 * directory changes.
 */
export const REMOTE_PROVIDERS = [
    {
        name: "cast-sdk",
        create({ tracks, onChange, onPlaybackChange, onTrackAdopted, onVolumeChange, scope }) {
            if (!isCastSdkCapable(scope)) return null;

            // `scope` is handed on, not just consulted: a provider that decided
            // it was capable from the injected scope and then re-decided from
            // the real one would answer two different questions, and the second
            // is the one `isSupported()` gives the registry a line later.
            return new CastSdkController({
                tracks,
                onChange,
                onPlaybackChange,
                onTrackAdopted,
                onVolumeChange,
                scope,
            });
        },
    },
    {
        name: "media-element",
        create({ element, onChange, onPlaybackChange, scope }) {
            if (!element) return null;

            return new MediaElementController(element, { onChange, onPlaybackChange, scope });
        },
    },
];

/**
 * Choose the remote playback provider for this browser, or `null` if it has none.
 *
 * `element` is the cast transport element — used only by the media element
 * provider, and harmless to pass on a browser that takes the SDK. `scope` is
 * injectable so the choice can be tested against a fake browser rather than the
 * one the tests happen to run in.
 */
export function createRemotePlayback({
    element = null,
    tracks = [],
    onChange,
    onPlaybackChange,
    onTrackAdopted,
    onVolumeChange,
    scope = globalThis,
    providers = REMOTE_PROVIDERS,
} = {}) {
    const options = { element, tracks, onChange, onPlaybackChange, onTrackAdopted, onVolumeChange, scope };

    for (const provider of providers) {
        const candidate = provider.create(options);

        if (!candidate) continue;

        // Both contracts are checked before anything is *called* on the
        // candidate, including `isSupported()` — a provider missing that one
        // would otherwise take the app down at boot with a TypeError, which is
        // the opposite of what a boundary check is for.
        const missing = [
            ...missingRemoteProviderMembers(candidate),
            ...missingPlaybackOutputMembers(candidate),
        ];

        if (missing.length > 0) {
            // Loud, named, and non-fatal: a malformed provider costs the app its
            // remote playback button, not its ability to play a soundscape.
            console.warn(
                `Remote playback provider "${provider.name}" does not implement the provider contract.`,
                missing,
            );
            continue;
        }

        if (!candidate.isSupported()) continue;

        return candidate;
    }

    return null;
}
