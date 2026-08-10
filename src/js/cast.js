/**
 * Casting to Chromecast, Google/Nest speakers, Google TV, AirPlay targets
 * (HomePod, Apple TV) and AirPlay 2 speakers such as modern Sonos.
 *
 * Casting is not another audio output the app can mix into. Nothing in the
 * browser can route an AudioContext to a cast target, so a connected cast stops
 * the local Web Audio path entirely and this module's own media element takes
 * over as the transport.
 *
 * What happens beyond that element is not one mechanism but three, and the
 * difference matters. Chrome on Android flings: the receiver is handed the URL
 * and fetches it. Chrome on desktop remotes: the browser demuxes locally and
 * streams encoded frames to the device — MediaRouterDesktop has no flinging
 * controller at all. Safari drives AirPlay, where the Mac or iPhone decodes and
 * streams audio to the speaker. Two of the three fetch the file through the
 * page, and only the first can loop without the browser's help.
 *
 * The transport element is deliberately kept out of the audio graph:
 * createMediaElementSource diverts an element's audio into the graph, which is
 * precisely what disqualifies the app's long-lived <audio> from this job.
 *
 * Everything platform-specific lives in the two backends below, and it comes to
 * two things: how you open the picker, and how you observe the connection. Once
 * connected, both platforms are driven by plain src/play/pause on the same
 * element, so the controller stays generic and a new target should be a backend
 * rather than a branch.
 *
 * There is deliberately no third thing. Both APIs can also report whether a
 * device is out there, and that was once used for one purpose: hiding the button
 * when nothing could be cast to. It is not worth its price. Watching means
 * scanning the local network continuously for as long as the page is open —
 * something Apple documents as a battery cost and asks you not to do without a
 * specific need — and it buys nothing the picker does not already do, since both
 * platforms discover devices themselves when it opens. So the button is simply
 * always there when a backend exists, and nothing is asked of the network until
 * someone presses it. A machine with no devices gets the browser's own picker
 * rather than an error the app would have to explain.
 *
 * Two things this file once claimed are now known to be false, and are corrected
 * rather than deleted because both were argued for at length:
 *
 *   - "prompt() reaches the picker with the element still at readyState 0." It
 *     does not. Chromium clears its availability URLs while duration is NaN and
 *     then rejects with the same NotAllowedError a real dismissal produces, so
 *     the failure is silent. Hence the metadata wait in prompt() below.
 *   - "No vendor SDK." Chromium's Remote Playback never opened a picker for this
 *     app's audio on any device tested, which is what forced cast-sdk.js. That
 *     module's header carries the evidence and the SDK-free routes tried first.
 *     This file is now the Safari and AirPlay path.
 */

const REMOTE_CONNECTION_EVENTS = ["connecting", "connect", "disconnect"];

// How often the receiver's position is sampled, and how many still samples in a
// row mean it has stopped rather than hesitated. Two samples is ~4s of silence
// before the soundscape comes back — long enough that ordinary rebuffering does
// not trip it, short enough to read as a stumble rather than an ending.
const PROGRESS_POLL_MS = 2000;
const STALLED_SAMPLES_BEFORE_RESTART = 2;

// Media element readyState for "the header has been read", which is the state
// both platforms actually require before they will show a picker.
const HAVE_METADATA = 1;

// How long prompt() waits for the transport element to report metadata before
// opening the picker regardless.
//
// This wait is not politeness, it is what makes the button work at all.
// Chromium builds the list of cast targets from the element's *loaded*
// metadata: RemotePlayback::UpdateAvailabilityUrlsAndStartListening() clears
// the availability URLs whenever duration() is NaN or at or under
// kMinRemotingMediaDurationInSec, and prompt() with an empty list never reaches
// a picker — PromptInternal() posts PromptCancelled(), which rejects as
// NotAllowedError "The prompt was dismissed." That is the identical rejection a
// real dismissal produces, so the failure is completely silent, and it is
// guaranteed on the first press: the pointerdown that releases the transport
// and the click that prompts are the same gesture, so the element is still at
// readyState 0 with an empty currentSrc when the picker is asked for. Safari
// arrives at the same place from the other side, rejecting prompt() below
// HAVE_METADATA outright. One wait answers both.
//
// The cap matters as much as the wait: prompt() has to still be inside the
// browser's transient user activation window when it finally runs — five
// seconds in Chromium — so this ends well short of that, leaving room for the
// call itself.
const TRANSPORT_METADATA_WAIT_MS = 2500;

// Before the position has moved even once, the same stillness means the
// receiver is still fetching and buffering a megabyte, not that it has stopped,
// and restarting into that would fight the connection it is still making. So
// the first advance gets a far longer rope — but a rope, not an open licence.
// A restart is only a request; a receiver can swallow one and stay silent, and
// treating "never advanced" as "never intervene again" would leave the app
// showing playing into a quiet room, which is the exact failure this watchdog
// exists to catch. Counting instead of waiting keeps the retry coming.
const STALLED_SAMPLES_BEFORE_FIRST_START = 8;

// Chromium ships a complete Remote Playback API and then never opens a picker
// for this app's audio — measured on Chrome desktop, Chrome for Android and
// Samsung Internet alike. Feature detection cannot see that, because every
// member is present and correct; only the engine tells you.
//
// Chrome itself never reaches this backend: it takes the Cast SDK. So this
// decides one case only — a Chromium browser with no Cast SDK to fall back on,
// which is Samsung Internet, where the button appeared and did nothing at all.
// Offering a control backed by an API known not to work is worse than offering
// none, so that browser now gets no cast button.
//
// Brands rather than the UA string: `userAgentData` is Chromium-only, which
// makes its mere absence most of the answer, and Safari and Firefox cannot be
// caught by it by accident.
function isChromium(scope = globalThis) {
    return Boolean(scope.navigator?.userAgentData?.brands?.some(
        ({ brand }) => brand === "Chromium",
    ));
}

// Chromium's Remote Playback API. Covers Chromecast, Nest speakers, Google TV.
const remotePlaybackBackend = {
    name: "remote-playback",

    // Deliberately probes `watchAvailability`, which this module never calls, as
    // a proxy for a complete Remote Playback implementation. Narrowing it to the
    // methods actually used would be tidier and is not worth it: Safari 13.1+
    // implements part of this API, so which member is probed decides whether
    // modern Safari lands on this backend or the AirPlay one below. That routing
    // has been tested as it stands, on a platform this repo cannot test, and it
    // must not change as a side effect of tidying.
    //
    // The engine check is not tidying and must stay: see isChromium above.
    isSupported(element, scope = globalThis) {
        return !isChromium(scope) && typeof element.remote?.watchAvailability === "function";
    },

    // "connecting" is watched as well as the two settled states because reaching
    // a Chromecast takes long enough to be worth reporting to the user.
    watchConnection(element, onChange) {
        for (const type of REMOTE_CONNECTION_EVENTS) {
            element.remote.addEventListener(type, onChange);
        }

        return () => {
            for (const type of REMOTE_CONNECTION_EVENTS) {
                element.remote.removeEventListener(type, onChange);
            }
        };
    },

    isConnected(element) {
        return element.remote.state === "connected";
    },

    isConnecting(element) {
        return element.remote.state === "connecting";
    },

    // There is no disconnect method in the API by design: prompting again while
    // connected is what surfaces the "stop casting" choice.
    prompt(element) {
        return element.remote.prompt();
    },
};

// WebKit's AirPlay API. Covers HomePod, Apple TV, and AirPlay 2 speakers
// (modern Sonos included — they appear as ordinary AirPlay targets, so they
// need no code of their own).
const airPlayBackend = {
    name: "airplay",

    isSupported(element) {
        return typeof element.webkitShowPlaybackTargetPicker === "function";
    },

    // Note the absence of webkitplaybacktargetavailabilitychanged. Registering it
    // is what makes WebKit scan the local network for AirPlay targets, and Apple
    // explicitly warns it drains battery and asks that it not be registered
    // without a specific need. There is none — webkitShowPlaybackTargetPicker()
    // finds targets itself. Do not add it back.

    // This one is not a scan: it reports only whether *this* element's own output
    // has moved to a wireless target.
    watchConnection(element, onChange) {
        element.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onChange);

        return () => element.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onChange);
    },

    isConnected(element) {
        return Boolean(element.webkitCurrentPlaybackTargetIsWireless);
    },

    // AirPlay reports only the settled state — there is no equivalent of the
    // Remote Playback API's "connecting".
    isConnecting() {
        return false;
    },

    // Normalises WebKit's synchronous picker onto the shared promise interface.
    prompt(element) {
        element.webkitShowPlaybackTargetPicker();
        return Promise.resolve();
    },
};

export const CAST_BACKENDS = [remotePlaybackBackend, airPlayBackend];

/**
 * Watches a running cast for the one failure no platform reports: the receiver
 * going quiet with nothing said about it.
 *
 * This is liveness policy, not transport and not platform, which is why it sits
 * apart from both the backends above and the controller below. It knows only
 * three things about the cast — where the position is, whether it should be
 * advancing right now, and how to ask for a restart — and nothing at all about
 * elements, backends or URLs.
 */
class LoopWatchdog {
    constructor({ getPosition, isRunning, restart }) {
        this.getPosition = getPosition;
        this.isRunning = isRunning;
        this.restart = restart;
        this.timer = 0;
        this.lastPosition = -1;
        this.hasAdvanced = false;
        this.stalledSamples = 0;
    }

    isArmed() {
        return this.timer !== 0;
    }

    arm() {
        this.disarm();
        this.reset();
        this.timer = setInterval(() => this.check(), PROGRESS_POLL_MS);
    }

    disarm() {
        clearInterval(this.timer);
        this.timer = 0;
    }

    // Seeded from the live position rather than a sentinel: a sentinel would
    // make the very first sample look like movement, and "it has moved once" is
    // exactly what separates a receiver that stopped from one that has not
    // started.
    reset() {
        this.lastPosition = this.getPosition();
        this.hasAdvanced = false;
        this.stalledSamples = 0;
    }

    check() {
        // Not running covers three things — no playback intent, no connection, or
        // paused from the receiver's own remote — and none of them is a stall.
        if (!this.isRunning()) {
            this.stalledSamples = 0;
            return;
        }

        const position = this.getPosition();

        if (position !== this.lastPosition) {
            this.lastPosition = position;
            this.hasAdvanced = true;
            this.stalledSamples = 0;
            return;
        }

        this.stalledSamples++;

        // A cast that has played before is known to work, so a stop is news
        // worth acting on quickly. One that has never produced a frame is more
        // likely still starting, and is given ~16s before the first nudge.
        const patience = this.hasAdvanced
            ? STALLED_SAMPLES_BEFORE_RESTART
            : STALLED_SAMPLES_BEFORE_FIRST_START;

        if (this.stalledSamples < patience) return;

        this.restart();
    }
}

const BENIGN_PROMPT_ERRORS = new Set([
    "NotAllowedError",
    "NotFoundError",
    "OperationError",
    "AbortError",
]);

export function selectCastBackend(element, backends = CAST_BACKENDS, scope = globalThis) {
    return backends.find((backend) => backend.isSupported(element, scope)) ?? null;
}

export class CastController {
    constructor(element, {
        onChange,
        onPlaybackChange,
        backends = CAST_BACKENDS,
        metadataWaitMs = TRANSPORT_METADATA_WAIT_MS,
        scope = globalThis,
    } = {}) {
        this.element = element;
        this.backend = selectCastBackend(element, backends, scope);
        this.onChange = onChange;
        this.onPlaybackChange = onPlaybackChange;
        this.metadataWaitMs = metadataWaitMs;
        // Whether the element may hold a source yet. False until the app reports
        // a user gesture — see allowTransportLoad.
        this.transportAllowed = false;
        this.playbackRequested = false;
        this.promptPending = false;
        // What the app is on, versus what the element has actually been given.
        // The two diverge while the transport is still held back — see
        // syncElementSource.
        this.track = null;
        this.castUrl = null;
        this.stopWatchingConnection = null;
        this.watchdog = new LoopWatchdog({
            getPosition: () => this.element.currentTime,
            isRunning: () => this.playbackRequested && this.isConnected() && !this.element.paused,
            restart: () => this.restartLoop(),
        });
        // Set once for the element's whole life rather than per play(). On the
        // paths that honour it the browser implements it as a seek back to zero;
        // on the one that does not, the watchdog above carries the loop instead.
        this.element.loop = true;
    }

    isSupported() {
        return this.backend !== null;
    }

    backendName() {
        return this.backend?.name ?? null;
    }

    isConnected() {
        return this.isSupported() && this.backend.isConnected(this.element);
    }

    isConnecting() {
        return this.isSupported() && this.backend.isConnecting(this.element);
    }

    // The raw intent, not gated on still being connected — a disconnect has to
    // be able to ask "was this playing?" after the connection is already gone,
    // to decide whether local playback should pick the soundscape back up.
    isPlaybackRequested() {
        return this.playbackRequested;
    }

    isPlaying() {
        return this.isConnected() && !this.element.paused;
    }

    // The app hands its playback intent over at the start of a transition,
    // before either transport has moved. A session that fails the instant it
    // opens arrives as a disconnect while that handover is still awaiting the
    // local pause, and the handback reads this flag to decide whether the room
    // gets its soundscape back — so it has to be set before the first await, not
    // after the cast is confirmed playing.
    setPlaybackRequested(requested) {
        this.playbackRequested = Boolean(requested);

        if (!this.playbackRequested) this.watchdog.disarm();
    }

    start() {
        if (!this.isSupported() || this.stopWatchingConnection) return false;

        // Watched for the page's whole life, because a connection can open or
        // close from outside the app — the OS picker, or the receiver being taken
        // over. It is a plain element event, not a network scan.
        this.stopWatchingConnection = this.backend.watchConnection(this.element, () => {
            this.syncElementSource();
            this.notifyChange();
        });
        this.element.addEventListener("ended", this.handleEnded);
        // A receiver has its own controls, and the person holding them is not
        // this page. Without these the room could be paused from the device
        // while the app went on showing playing.
        this.element.addEventListener("play", this.handleTransportPlaybackChange);
        this.element.addEventListener("pause", this.handleTransportPlaybackChange);
        // Report the opening state so the listener renders the control from one
        // path rather than trusting the markup to have seeded it. A page can also
        // load with a cast already live — the session outlives a reload on the
        // device side — and this is what notices.
        this.notifyChange();

        return true;
    }

    // Nothing is fetched until the app says a person has touched the page.
    //
    // The element has to be readable before the picker opens, because Safari
    // rejects prompt() below HAVE_METADATA. It must not be loaded *by* prompt(),
    // because a fresh src resets readyState and would break the very call it was
    // meant to serve. A gesture is the earliest honest signal that a click on the
    // button is possible, and it leaves a page that is opened and never touched
    // costing nothing at all. (Chromium turns out to need the metadata too — the
    // claim that it opened a picker at readyState 0 was wrong, and silently so.)
    allowTransportLoad() {
        if (this.transportAllowed) return false;

        this.transportAllowed = true;
        this.syncElementSource();

        return true;
    }

    // Nothing to do: this backend's cost is the media header, and the first
    // gesture on the page has already paid it. Present so the app can signal
    // "the user is reaching for the button" without knowing which transport is
    // listening — on the SDK path that is the moment a script gets fetched.
    prepare() {
        return false;
    }

    // This transport has no volume API at all, and cannot be given one. The
    // element's own volume is not local while connected — Chromium forwards it
    // to the receiver as a stream volume change, and on a Cast device that is
    // the speaker's own level, which outlives the session — so driving it from
    // here would mean connecting a cast quietly moved the room's volume to
    // wherever this page's slider happened to sit.
    //
    // The Cast SDK path answers true: it has RemotePlayerController.setVolumeLevel,
    // which is an explicit, session-scoped request rather than a side effect.
    canControlVolume() {
        return false;
    }

    stopWatching() {
        this.stopWatchingConnection?.();
        this.stopWatchingConnection = null;
        this.element.removeEventListener("ended", this.handleEnded);
        this.element.removeEventListener("play", this.handleTransportPlaybackChange);
        this.element.removeEventListener("pause", this.handleTransportPlaybackChange);
        this.watchdog.disarm();
    }

    // The transport changed between playing and paused. Whoever caused it — the
    // app, the device's own remote, the OS media UI — the listener's job is only
    // to re-read the state and redraw, never to drive the transport back, so
    // this cannot fight the app's own play() and pause().
    //
    // Deliberately reports nothing but the fact of a change, and does not touch
    // `playbackRequested`. Assigning `src` runs the media load algorithm, which
    // pauses the element and fires `pause` — so a track change while casting
    // emits one of these for a cast that is not stopping at all. A listener that
    // re-reads `element.paused` when it runs sees the truth after play() has
    // resumed; one that had trusted the event would have cleared the intent that
    // same play() just set.
    //
    // That same re-reading makes the connection check below belt-and-braces
    // rather than load-bearing: a listener that recomputes from live state lands
    // on the right answer after a disconnect too. What it buys is the moment in
    // between — parking the element during handback fires a `pause` while local
    // playback is still resuming, and without this the OS media UI would be told
    // "paused" and then "playing" a tick later.
    handleTransportPlaybackChange = () => {
        if (!this.isConnected()) return;

        this.onPlaybackChange?.();
    };

    // A receiver is free to simply end the track — the Remote Playback spec says
    // nothing about whether `loop` reaches it, and AirPlay makes no promise
    // either. Restarting on `ended` covers the receivers that announce it, and
    // costs nothing where `loop` works, because there `ended` never fires.
    //
    // It is not enough on its own. Chrome Android reports no end at all:
    // FlingingRenderer drops every media status that is not playing or paused,
    // so Blink never runs its end-of-media algorithm — no `ended`, no `pause`,
    // and `loop` never applied. The room goes quiet with the app still showing
    // playing. Hence the watchdog: position is the one signal every platform
    // keeps, and a position that has stopped moving while the app still wants
    // audio means the soundscape is over and nothing said so.
    handleEnded = () => {
        this.restartLoop();
    };

    // Seeking home is enough on its own for a receiver that is merely sitting at
    // the end, and play() covers the one that dropped the media entirely — the
    // Cast sender reloads from zero on the next play once the receiver has
    // reported it finished.
    restartLoop() {
        if (!this.playbackRequested || !this.isConnected()) return;

        this.element.currentTime = 0;
        // Back to the starting posture deliberately: a restart has to refetch
        // and rebuffer exactly like a fresh connection, so it earns the same
        // patience — and if it never takes, the same patience runs out again
        // and the next restart follows.
        this.watchdog.reset();

        void this.element.play().catch((error) => {
            console.warn("Could not restart the cast loop.", error);
        });
    }

    // Whether the element has read its header. Both platforms need this before
    // they will show a picker — see TRANSPORT_METADATA_WAIT_MS — so it is also
    // the caller's answer to "could that press have opened anything?".
    isTransportReady() {
        return this.element.readyState >= HAVE_METADATA;
    }

    // Resolves true once the element has read its header, false if the wait ran
    // out or the load failed. It never rejects: prompting anyway is still the
    // better move, since a picker that might open beats a button that certainly
    // does nothing. The answer's real job is to tell the caller whether a
    // "dismissed" can be taken at face value.
    waitForTransportMetadata() {
        if (this.isTransportReady()) return Promise.resolve(true);

        return new Promise((resolve) => {
            const settle = (ready) => {
                clearTimeout(timer);
                this.element.removeEventListener("loadedmetadata", onLoaded);
                this.element.removeEventListener("error", onFailed);
                resolve(ready);
            };
            const onLoaded = () => settle(true);
            const onFailed = () => settle(false);
            const timer = setTimeout(() => settle(false), this.metadataWaitMs);

            this.element.addEventListener("loadedmetadata", onLoaded);
            this.element.addEventListener("error", onFailed);
        });
    }

    // A second prompt while one is already open is an error on both platforms,
    // and a double-click on the button is all it takes. Refusing the re-entry
    // is the fix; BENIGN_PROMPT_ERRORS still absorbs a race the app cannot see,
    // such as the OS opening its own picker.
    async prompt() {
        if (!this.isSupported() || this.promptPending) return false;

        // Ordinarily a no-op, and that is the point. Whatever produced this click
        // — a pointerdown, or a keydown on the focused button — is itself the
        // gesture, and it reached the document listener before the click reached
        // the button, so the source is already loaded. This only does work if a
        // click somehow arrives with no gesture reported, and even then it is the
        // lesser evil: a fresh src resets readyState, which is exactly what Safari
        // refuses to open a picker on.
        this.allowTransportLoad();
        this.promptPending = true;

        // Kept outside the try so the catch can tell a dismissal that could
        // have been real from one the browser invented for a picker it never
        // showed.
        let ready = false;

        try {
            ready = await this.waitForTransportMetadata();

            if (!ready) {
                // Worth saying out loud rather than leaving to the phantom
                // dismissal below: the press is about to do nothing, and the
                // reason is the file, not the devices.
                console.warn("Opening the cast picker without transport metadata; the device list may not appear.");
            }

            await this.backend.prompt(this.element);
            return true;
        } catch (error) {
            // Per the Remote Playback spec these are ordinary outcomes, not
            // faults: the user dismissed the picker (NotAllowedError), no device
            // was found or it went away while the picker was open
            // (NotFoundError), or a second prompt raced the first
            // (OperationError). Logging them would turn routine use into console
            // noise. AbortError is not in the spec but Chromium has used it for
            // dismissal, so it is treated the same way.
            //
            // A machine with no devices does not usually land here at all:
            // Chromium opens its own picker and reports the eventual dismissal,
            // which is why the app needs no "nothing found" message of its own.
            //
            // Gated on `ready`, because without metadata Chromium rejects with
            // that same NotAllowedError for a picker it never opened. Absorbing
            // it there would file a real fault as an ordinary outcome, which is
            // exactly how this stayed invisible.
            if (ready && BENIGN_PROMPT_ERRORS.has(error?.name)) return false;

            console.warn("Could not open the cast device picker.", error);
            return false;
        } finally {
            this.promptPending = false;
        }
    }

    // What the element actually holds, which is not always the app's current
    // track — see syncElementSource. Callers asking "is this the soundscape the
    // receiver has?" want this one, not `track`.
    getTrackUrl() {
        return this.castUrl;
    }

    setTrack(track) {
        this.track = track;
        this.syncElementSource();
    }

    // Whether the element has to be holding the app's current soundscape yet.
    // A gesture means the picker could open at any moment; a live or opening
    // connection means a receiver is already waiting on the answer.
    needsCurrentSource() {
        return this.transportAllowed || this.isConnected() || this.isConnecting();
    }

    // Sourcing the element costs real bytes, so it happens as late as it can and
    // no later.
    //
    // `preload="metadata"` is a hint, not a budget. Measured in Chrome against a
    // ~1 MB twin, the first load buffers ~90% of the file and later track changes
    // tens of KB each — so an element kept permanently current would charge every
    // visitor for a cast most of them will never start. Two gates keep that off
    // the wire:
    //
    // No backend, no source. Firefox ships neither API, so there is no button and
    // no picker, and nothing for the element to be readable for: zero bytes.
    //
    // No gesture, no source. Until someone has touched the page, a click on the
    // button is not possible and the file is not needed. From that first gesture
    // it is kept current on every track change, because the picker could then open
    // at any moment and Safari will not open it below HAVE_METADATA.
    syncElementSource() {
        if (!this.isSupported() || !this.needsCurrentSource()) return;

        this.applyElementSource();
    }

    // The equality guard is not an optimisation: assigning src reloads the
    // element, so re-setting the track that is already playing would interrupt a
    // live cast. It compares the URL the controller was given rather than
    // element.src, which the DOM resolves to an absolute URL on the way back out.
    applyElementSource() {
        const url = this.track?.castUrl;

        if (!url || url === this.castUrl) return;

        this.castUrl = url;
        this.element.src = url;
    }

    async play() {
        if (!this.isConnected()) return false;

        this.playbackRequested = true;
        this.watchdog.arm();

        try {
            await this.element.play();
        } catch (error) {
            // The transport never started, so there is no position to watch.
            // Leaving the timer armed would poll a paused element for the rest
            // of the session, and the caller reports the failure from here.
            this.watchdog.disarm();
            throw error;
        }

        return true;
    }

    // One transport verb for both "the user pressed pause" and "the cast is
    // over": there is nothing to tear down beyond the intent and the element,
    // and a receiver is released by the connection ending, not by the page.
    pause() {
        this.playbackRequested = false;
        this.watchdog.disarm();
        this.element.pause();
    }

    // Deliberately no volume control. Element volume is not local while
    // connected — Chromium forwards it to the receiver as a stream volume
    // change, which on a Cast device is the device's own volume and outlives the
    // session. Pushing the app's slider onto it would mean connecting a cast
    // silently turns the speaker in the room up or down. The device keeps its
    // own level; the app's slider governs the output the app actually owns.

    notifyChange() {
        const report = (error) => console.warn("Could not apply a cast state change.", error);

        try {
            // The listener is allowed to be async — moving playback between two
            // outputs is — and a rejection from it would surface long after this
            // try block has returned, so the promise needs catching as well.
            // Both states in the payload rather than one plus a lookup: the
            // listener renders one control from them, and a caller that had to
            // pull `connecting` off the controller separately could read it a
            // tick later than the value it is being combined with.
            void Promise.resolve(this.onChange?.({
                connected: this.isConnected(),
                connecting: this.isConnecting(),
            })).catch(report);
        } catch (error) {
            report(error);
        }
    }
}
