# Repository Guidelines

## Overview

Soundscape is a browser-based Progressive Web App (PWA) that plays seamless looping ambient background audio (rain, thunderstorms, fireplace, open road, and white/pink/brown noise). It supports play/pause/prev/next controls, persistent volume/theme/track preferences, light/dark/system themes, and Media Session integration for browser and OS media controls, with sample-accurate looping via Web Audio.

## Project Structure

```
soundscape/
├── src/                              # Deploy folder (served at site root)
│   ├── index.html                    # App entry point, loads script.js and styles
│   ├── style.css                     # App-wide styling (component internals live in @scope blocks)
│   ├── sw.js                         # Service worker for offline/PWA support
│   ├── manifest.webmanifest          # PWA manifest
│   ├── CNAME                         # Custom domain for deployment
│   ├── js/
│   │   ├── script.js                 # App bootstrap: wires audio, UI, state, and components
│   │   ├── audio-player.js           # Web Audio + HTMLAudioElement playback engine
│   │   ├── cast.js                   # Cast controller + platform backends (Remote Playback, AirPlay)
│   │   ├── media-session.js          # Media Session API integration (metadata, actions)
│   │   ├── pwa.js                    # Service worker registration + Launch Queue consumer
│   │   ├── theme-utils.js            # Light/dark/system theme helpers
│   │   ├── tracks.js                 # Track catalog and metadata
│   │   └── components/
│   │       ├── app-menu.js           # Custom element for the top-right menu
│   │       ├── theme-selector.js     # Custom element for theme mode selection
│   │       └── volume-control.js     # Custom element for volume slider
│   └── resources/
│       ├── icons/                    # PWA/favicon icons (png + svg)
│       ├── screenshots/              # manifest.webmanifest install screenshots (git-tracked PNGs)
│       └── soundscapes/              # Ambience loops: .opus (local playback) + .m4a twins (cast)
├── test/                             # Unit tests (dependency-free)
│   └── helpers/
│       └── app-test-harness.js       # Shared test fixtures/utilities
├── scripts/
│   ├── export-icons.mjs              # Icon PNG export from SVG sources
│   ├── capture-screenshots.mjs       # Manifest install-screenshot capture
│   ├── build-cast-audio.mjs          # AAC cast twins with the loop crossfade baked in (needs ffmpeg)
│   └── send-media-key.ps1            # OS-level media key injection for testing
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI: `npm test` gates the Pages deploy (uploads src/)
├── Dockerfile                        # Multi-target image: default = Caddy + Node (serve + npm test); `--target serve` = slim Caddy-only runtime
├── .dockerignore                     # Excludes unnecessary files from the build
├── package.json                      # Scripts and metadata
├── package-lock.json                 # Locks the scripts/ devDependencies (playwright); npm test itself has none
├── .config.md                        # Per-developer configuration (gitignored)
├── AGENTS.md
├── CLAUDE.md                         # Includes AGENTS.md; keep the guidance itself in AGENTS.md
├── README.md
└── opencode.json
```

## Custom Elements

- App-owned custom elements live in `src/js/components`.
- Use light DOM with an inline `@scope` style block by default. This keeps component markup easy to inspect, test, and integrate while preventing component selectors from leaking outward.
- Keep selectors inside `@scope` short and component-local. Reserve `style.css` for app-wide styling, not component internals.
- Do not use Shadow DOM for normal app components. If a change seems to need Shadow DOM, raise the reason first; the app is internal and should stay easy to inspect and style.

## Audio Invariants

- Soundscape intentionally has two coordinated playback surfaces: one long-lived `HTMLAudioElement` for browser-observable playback, and decoded Web Audio buffers for audible playback.
- The `HTMLAudioElement` exists for platform integration, not sound output or visible UI. Browser and OS media controls, notifications, autoplay policy, audio focus, and source/preload state all depend on browser-observable media plumbing; Web Audio alone is not a reliable substitute.
- Keep the media element loaded and play/pause it with app state. Route it through zero gain so platform media plumbing observes playback without doubling the audible output.
- Audible looping comes from decoded `AudioBufferSourceNode`s. These ambience tracks need seamless loop points, and native `HTMLAudioElement.loop` has produced audible gaps or discontinuities on short loops.
- Create and resume `AudioContext` from the playback flow, not page load, so browser user-gesture policy stays intact.
- Preserve stale-request guards around track changes. Buffer fetch/decode work can finish out of order, and older requests must not replace newer playback.
- Report buffer fetch/decode as a loading state (`AudioPlayer.isLoading()` / `onLoadingChange`). The title switches the instant a track is picked but the audio cannot, so on a slow connection there is a real window where the name on screen is not the sound in the room. Three rules keep the indicator honest, each with a test behind it:
  - It waits out `LOADING_INDICATOR_DELAY_MS` before showing, so a cached track — which decodes in milliseconds — never flashes one. That delay must also outlast the title change animation, because the `<h1>`'s accessible text only settles when the animation ends; `component-contract.test.js` pins the two together across `script.js` and `style.css`.
  - Skipping again mid-load hands the state to the newer request without reporting a stop, so the indicator never blinks between tracks and the delay is not re-armed.
  - It and `#playbackError` are mutually exclusive. They are the app's only two status messages, they sit in the same strip under the title, and a failure notice under a live loading bar is both a contradiction and (with reduced motion, where the bar becomes text) an overlap.
- Treat Media Session and Audio Session APIs as progressive enhancements. When available, keep metadata, playback state, actions, and decoded-buffer position state in sync; when unavailable, playback should still work.
- Keep the cast element out of the Web Audio graph. `createMediaElementSource`
  diverts an element's audio into the graph, which is precisely what makes the
  app's long-lived `<audio>` unusable as a cast transport — hence a second,
  un-wired `#castAudioElement`. Never pass it to `createMediaElementSource`.
- For the same reason `#audioElement` carries `disableremoteplayback` and
  `x-webkit-airplay="deny"`. Its audio is diverted into the graph, so a browser
  or OS offering it as a cast source would hand the user a route the app knows
  nothing about while the decoded buffer keeps playing locally — the
  two-places-at-once that casting is otherwise built to prevent.
- Re-register Media Session action handlers after every track change. Some browsers drop the Media Session association when the long-lived `<audio>` element's `src` changes, so refreshing the handlers (and metadata) inside `playCurrentTrack` keeps keyboard/earphone controls working across tracks.

## Casting Invariants

- Casting is not a second audio output the app mixes into. Nothing in the browser
  can route an `AudioContext` to a cast target, so the two outputs are strictly
  exclusive: exactly one of `audioPlayer` and `castController` drives playback at
  any moment. While a cast is connected the local element is parked and the
  `AudioContext` is suspended.
- **Casting is three mechanisms, not one, and the difference decides everything
  below.** Chrome on Android *flings*: the receiver is handed the URL and fetches
  it. Chrome on desktop (121+) *remotes*: the browser demuxes locally and streams
  encoded frames over the Cast mirroring protocol — `MediaRouterDesktop::
  GetFlingingController` returns `nullptr`, so there is no flinging path there at
  all. Safari (13.1+, which does implement the Remote Playback API — the AirPlay
  backend is now a fallback for older WebKit only) drives AirPlay audio, where
  the Mac or iPhone decodes and streams to the speaker. Two of the three fetch
  the twin *through the page*, and only the first could loop without the browser.
- Because the local element is parked on purpose, its own `play`/`pause` events
  say nothing about what the listener hears. `handleBrowserPlaybackStart` and
  `handleBrowserPlaybackPause` must stay guarded by `isCasting()`, or parking the
  element reads as "the user paused" and stops the receiver too. Same for
  `handleVisibilityChange`: a cast keeps playing whether the tab is visible or not.
- **The cast element's `play`/`pause` events are the exact opposite, so do not
  make the two symmetrical.** The receiver has its own controls and the person
  holding them is not this page; the Remote Playback API reports nothing about
  them, so those events are the app's only word that the room went quiet. They
  drive `onPlaybackChange` → `syncPlaybackState`, which **re-reads** the transport
  rather than trusting the event, and which never drives the transport back. Both
  properties are load-bearing: assigning `src` runs the media load algorithm,
  which pauses the element and fires `pause`, so every track change while casting
  emits one for a cast that is not stopping at all. A handler that trusted the
  event would clear the intent the very next `play()` had just set. It also must
  not touch `playbackRequested` for the same reason. `app-cast.test.js` pins both.
- Cast plays the `.m4a` twin, never the `.opus` original. Safari could not decode
  Ogg Opus at all before 18.4, and desktop remoting only carries Opus if the sink
  advertises it — AAC in MP4 is the one format every path accepts, and one shared
  format keeps a single code path for every backend rather than per-platform
  codec selection. `tracks.js` derives `castUrl` from `url`, so the two can never
  drift; `tracks.test.js` checks every twin exists on disk.
- Everything platform-specific lives in the two backend objects in `cast.js`, and
  it comes to only two things: how you open the picker, and how you observe the
  connection. Once connected, both platforms are driven by plain
  `src`/`play`/`pause`. Keep it that way — new targets should be a backend, not a
  branch in the controller.
- **`remotePlaybackBackend.isSupported` also refuses Chromium, and that is not a
  bug.** Chromium ships the whole Remote Playback API and never opens a picker
  for this app's audio — measured on Chrome desktop, Chrome for Android and
  Samsung Internet — so feature detection cannot tell a working implementation
  from a decorative one; only the engine can. Chrome never reaches this backend
  (it takes the Cast SDK), so the check decides one case: a Chromium browser with
  no Cast SDK to fall back on. That is Samsung Internet, where the button
  appeared and did nothing at all, and where it is now correctly absent. The
  probe is `navigator.userAgentData.brands`, which is Chromium-only — Safari and
  Firefox have no `userAgentData`, so they cannot be caught by it by accident.
- **Do not "tidy" `remotePlaybackBackend.isSupported`.** It probes
  `watchAvailability`, a method the module deliberately never calls, and that is
  not an oversight. Because Safari 13.1+ implements part of the Remote Playback
  API, the member being probed is what decides whether modern Safari selects that
  backend or the AirPlay one — so narrowing the check to the methods actually used
  could silently re-route Safari onto an untested path, on the one platform this
  repo cannot test.
- Do not add the Google Cast Web Sender SDK. It requires a cross-origin
  `gstatic.com` script this offline-first app cannot precache, and buys little
  over the Remote Playback API for plain media playback.
- Do not replace the twins with an HLS playlist that lists one short segment
  hundreds of times. It is a real technique and it looks tailor-made for this
  problem — one 30 s segment on disk, a text playlist, hours of seamless output,
  every repeat an HTTP cache hit — but it does not survive the three-mechanism
  split above. Only Chrome *Android* hands the URL to a receiver that can parse
  HLS. Chrome on **desktop** demuxes the media in the browser and streams frames,
  and Blink has no native HLS demuxer at all: without MSE and a JS library, the
  playlist simply fails to load, so the platform with the most cast devices
  attached would be the one that stopped working. Safari would play it, and
  AirPlay-to-a-speaker would have the *sending* device fetch it anyway, where
  AVFoundation's caching is not something to rely on. A single self-contained
  file is the only shape all three mechanisms read the same way, and the lever on
  seam frequency is `REPEAT_TO_SECONDS`, which costs bytes and nothing else.
- Sonos needs no code of its own. Modern models (One, Beam, Arc, Five, Move,
  Roam on S2) are AirPlay 2 targets and appear in the AirPlay picker.
- **The app never asks whether a cast device exists. Do not reintroduce
  availability watching.** Both platforms discover devices inside their own picker
  when it opens, so asking in advance bought exactly one thing — a conditionally
  visible button — at the price of continuous local-network scanning for the whole
  life of the page, which Apple documents as a battery cost and asks you not to
  incur without a specific need. `prompt()` reaches the picker with no prior
  `watchAvailability` call — `RemotePlayback::prompt()` only consults
  `availability_` to *reject early*, and it sits at `UNKNOWN` when nothing is
  watching — and a machine with no devices gets the browser's own picker rather
  than an error to report, so there is nothing to hand-roll for the no-devices
  case either. `cast.test.js` asserts neither backend registers a scan. What is
  **not** optional is metadata: see the `prompt()` bullet below.
- The cast button is therefore always visible, and `hidden` is decided once at
  boot from `isSupported()` alone — a browser either has a way to cast or it does
  not, and that cannot change while the page is open. This is also what makes "a
  live cast can never lose its stop control" true by construction rather than by a
  guard. It carries all three states as
  `data-cast-state="idle|connecting|connected"` — the filled screen in the glyph
  means *connected*, so connecting takes the weight but not the fill and pulses
  instead. `CastController.start()` reports the opening state so that appearance
  comes from one path rather than the markup, which also catches a page loading
  with a cast already live.
- `prompt()` rejects as part of normal use: `NotAllowedError` (picker dismissed),
  `NotFoundError` (no device found, or it went away), `OperationError` (a second
  prompt raced the first), and `AbortError` (not in the spec, but Chromium has
  used it for dismissal). These are swallowed — but only once the transport has
  metadata, for the reason in the next bullet; without it `NotAllowedError` means
  the opposite thing. Only genuinely unexpected failures are logged. The common
  cause of that race — a double-click on the button — is
  refused outright by `CastController.prompt()` rather than absorbed after the
  fact. There is no
  `disconnect()` in the Remote Playback API by design; prompting again while
  connected is what offers "stop casting".
- **`CastController.prompt()` waits for the transport's metadata before opening
  the picker, and that wait is what makes the button work at all.** Both engines
  need the header read first, and Chromium's way of saying so is silent:
  `RemotePlayback::UpdateAvailabilityUrlsAndStartListening()` clears
  `availability_urls_` whenever `duration()` is `NaN` or at or under
  `kMinRemotingMediaDurationInSec`, and `PromptInternal()` with an empty list
  never contacts the presentation service — it posts `PromptCancelled()`, which
  rejects as `NotAllowedError` *"The prompt was dismissed."* That is
  byte-for-byte the rejection a real dismissal produces, so it lands in
  `BENIGN_PROMPT_ERRORS` and vanishes. It was also **guaranteed on the first
  press**: the `pointerdown` that releases the transport and the `click` that
  prompts are the same gesture, so the element is still at `readyState` 0 with an
  empty `currentSrc` when the picker is asked for. Symptom: the cast button does
  nothing, on desktop and Android alike, with a clean console. Safari reaches the
  same place from the other side, rejecting below `HAVE_METADATA` with
  `NotSupportedError`. Hence `#castAudioElement` keeps `preload="metadata"`, the
  twins are written `+faststart` so the index is at the head, and the service
  worker leaves `.m4a` alone (see below).
  - The wait is capped (`TRANSPORT_METADATA_WAIT_MS`, 2.5 s) because `prompt()`
    must still be inside the browser's transient user activation window when it
    finally runs — five seconds in Chromium. Do not raise it past that.
  - When the wait runs out the app prompts anyway (a picker that might open beats
    one that certainly will not) but **stops treating `NotAllowedError` as
    benign** — without metadata it is a phantom dismissal, not a user's — and
    `script.js` puts `CAST_UNAVAILABLE_MESSAGE` on screen. This is the one cast
    outcome written to `#playbackError` directly rather than through
    `reportPlaybackFailure`, which suppresses messages while audio is playing;
    that is exactly when someone reaches for this button.
  - Do not "simplify" this to loading the source inside `prompt()`. A fresh `src`
    resets `readyState`, which is the state neither engine will open a picker on.
  - One Chromium gate the app cannot work around: `IsLowEndDevice()` disables
    availability URL generation entirely, so on a low-RAM Android device
    `prompt()` never reaches a picker no matter what the element holds.
- **`preload="metadata"` is a hint, not a budget — do not assume that read is
  cheap.** Measured in Chrome against a ~1 MB twin, the first load buffers ~90% of
  the file and later track changes tens of KB each. Two gates keep that off the
  wire, both in `CastController.syncElementSource`:
  - **No backend, no source.** Firefox ships neither API, so there is no button
    and no picker: the whole cast budget is zero bytes.
  - **No gesture, no source.** Nothing loads until the app reports a pointer or
    key event via `allowTransportLoad()`, so a tab restored on startup and never
    touched costs nothing. From that first gesture the file is kept current on
    every track change, because the picker could then open at any moment.
  Do **not** move the load into `prompt()` to defer it further: a fresh `src`
  resets `readyState`, and that is exactly what Safari refuses to open a picker
  on — it would break the call it was meant to serve. `needsCurrentSource()` also
  answers true while connected or connecting, so a cast opened from outside the
  app (the OS picker) still gets the current track. `app-cast.test.js` pins all
  of it.
- Chromium refuses to *remote* media of 15 seconds or less
  (`kMinRemotingMediaDurationInSec`). Every twin must clear it — which the
  repeat-to-two-minutes rule below does with room to spare, but a new soundscape
  shorter than that would silently fail to cast on desktop Chrome. This no longer
  shows up as a missing button, since the button no longer depends on discovery;
  it would show up as a picker that lists nothing.
- Cast twins are the one asset the service worker does not handle — neither
  precached nor cached at runtime. It is not a caching preference: `cacheIfOk`
  buffers the whole body and `handleRangeRequest` upgrades a range miss to a full
  fetch, so every partial read the cast element makes would become a whole
  megabyte. Passing them through leaves the browser fetching the bytes it
  actually asked for. `test/pwa.test.js` already excludes everything under
  `resources/soundscapes/`. The consequence to accept: casting needs the network,
  which is true of the Android path regardless, since there the receiver does the
  fetching.
- **The cast transport reports nothing about being superseded, so `playCurrentTrack`
  checks the track generation itself before `finishTrackChange`.** Two quick skips
  leave two changes in flight and a receiver can answer the first one last. On the
  local path `AudioPlayer`'s own stale-request guard makes this impossible — it
  answers `false` and the caller never reaches the metadata write. `CastController`
  has no equivalent (the whole point is that it is driven by plain
  `src`/`play`/`pause`), so without the check the older skip would write its
  captured track into the OS media UI while the receiver and the on-screen title
  are on the newer one. Everything else in the playback tail re-reads live state
  and is self-correcting; `finishTrackChange(track)` is the one call carrying a
  value captured before the await. `app-cast.test.js` pins it.
- The handover reads `AudioPlayer.wantsPlayback()`, not `isPlaybackRequested()`.
  The latter ANDs in `hasTrack()` so no resume path can try to play nothing; the
  handover needs the opposite reading. A device connecting while the *first*
  track is still decoding finds `hasTrack()` false — nothing has ever loaded —
  and would take that for "the user wasn't playing", handing the receiver a
  silence after an explicit press of play. Keep the two callers apart.
- `startCasting` checks `castTransitionId` before **everything** it writes, not
  just the last line. A connect and a disconnect close together leave two
  transitions in flight; the stale one clearing or posting a playback error would
  overwrite the message belonging to the one still running. The log still happens
  either way — a failure is worth a developer's attention whether or not it is
  still worth the user's.
- **Volume is a per-transport capability, asked as `canControlVolume()`.** The
  two answer differently and for good reasons:
  - `CastController` (Remote Playback / AirPlay) answers **false**. Element
    volume is not local while connected — Chromium forwards it to the receiver
    as a stream volume change, which on a Cast device is the speaker's own level
    and outlives the session — so there is no session-scoped way to set it.
  - `CastSdkController` answers **true**. `RemotePlayerController.setVolumeLevel`
    is an explicit request rather than a side effect, so the slider drives the
    device directly.
  The app shows one of two honest shapes and never a third: a working slider,
  relabelled to say whose level it moves, or no slider at all. It is deliberately
  **not** disabled-and-greyed any more — that read as broken rather than absent
  and explained nothing.
- **The device's level is adopted on connect, never pushed.** Sending the page's
  slider position to the receiver would turn the speaker in the room to wherever
  it happened to sit, and on a Cast device that change outlives the session. For
  the same reason a level set while casting is not persisted: it belongs to the
  speaker, not to this app, and the saved preference is restored on handback.
- Media Session position state is not published while casting. The receiver owns
  the position and the page cannot read it, and the local player's answer is
  worse than none: it still holds the buffer from before the cast and its context
  is suspended, so it would pin a frozen position under a "playing" state. The
  1 s polling timer stays off for the same reason.
- Never rely on `loop`, or on `ended`, or on any end-of-media event. Neither spec
  promises the attribute is honoured remotely; where a browser does honour it, it
  implements it as a seek back to zero, which flushes the receiver's buffer and
  is audible. Worse, Chrome Android reports no end at all —
  `FlingingRenderer::OnMediaStatusUpdated` drops every status that is not playing
  or paused and never calls `client_->OnEnded()`, so Blink never runs its
  end-of-media algorithm: no `ended`, no `pause`, and `loop` never applied. The
  room goes quiet with the app still showing playing. Position is the one signal
  every platform keeps, so `LoopWatchdog` polls it and asks `CastController` to
  restart a cast that has stopped advancing. It is kept a separate class on
  purpose: liveness policy, knowing nothing about elements, backends or URLs. Keep
  the `ended` handler too — it is one line and covers the receivers that do
  announce it — but it is not the safety net.
- The watchdog is patient before the first advance, not silent. A receiver can
  take seconds to fetch and buffer, and a restart into that would fight the
  connection it is still making — so a position that has never moved gets ~16 s
  (`STALLED_SAMPLES_BEFORE_FIRST_START`) against the ~4 s a position that has
  moved and then stopped gets. It must stay a count and not an open-ended
  reprieve: a restart is only a request, a receiver can swallow one and stay
  quiet, and `restartLoop` deliberately returns to the un-advanced posture. If
  that posture meant "never intervene again", the first restart would disarm the
  watchdog for the session and leave the app showing playing into a silent room —
  the exact failure it exists to catch. `cast.test.js` pins the retry.
- `npm run cast-audio` rebuilds the AAC twins (needs `ffmpeg`/`ffprobe` on PATH;
  host-only, not in `npm test` or the Docker image). It imports the app's own
  `applyLoopCrossfade`, trims to the loop period, and writes that period
  repeatedly until the file passes `REPEAT_TO_SECONDS` (two minutes). Repetition
  is bit-exact — every internal join is the sample-adjacent seam the crossfade
  built — so the only audible seam is the one at the end of the file, and the
  file's length is the only lever on how often it comes round. Re-run after
  replacing any `.opus` source.
- The cast crossfade is **not** fixed at `LOOP_CROSSFADE_MS`; it is stretched to
  whatever length lands the loop period on a 1024-sample AAC frame boundary
  (10–31 ms in practice). A partial final frame gets padded with silence by the
  encoder, and that padding sits exactly on the loop seam — measured at ~224
  samples, it took the seam discontinuity from 0.27x to 5.18x of the signal's own
  typical sample step. The build fails loudly if the period is not frame-aligned.
  This does not touch local playback, which still uses the 10 ms runtime fade.
  Alignment matters now for the *internal* joins between repeats, which are the
  seams the listener actually crosses; keep it if a native-looping receiver ever
  appears, but do not expect one today.
- What remains unfixable is AAC *encoder priming* at the head. It is intrinsic to
  the codec — the container's edit list is the mechanism for it, and every
  gapless-aware receiver honours it. `ffprobe` confirms the twins ship `edts`/
  `elst` with `initial_padding=0`.

## Development and Testing

- The app works with any OCI-compatible container engine. **Always read `.config.md` first** for this project's specific engine, then substitute `<container-engine>` in the commands below accordingly. If `.config.md` is not configured or does not specify an engine, fall back to `docker`.

- **Agents only:** The shell tool has a timeout, so `npm test` and builds may be killed before completing. Start the server via `run --detach` (returns immediately). The `--volume` bind mount maps your working directory into the container so edits appear without rebuilding:
  ```sh
  <container-engine> build --tag soundscape .
  <container-engine> container rm --force soundscape-server 2>$null  # Idempotent: tears down any prior container, running or stopped
  <container-engine> container run --detach \
      --publish 4321:80 \
      --volume ${PWD}:/app \
      --name soundscape-server \
      soundscape
  ```
  - After starting, **verify the server is serving** before launching the browser — the SW cache can make a stale page appear live. Use `curl -sI --max-time 3 http://soundscape.localhost:4321` (the `--max-time` prevents the shell tool's timeout from blocking on a hung request).
  - **If the server is already running**, you can skip the start commands — the bind mount means source edits are live without rebuilding. Just verify with `curl`.
  - When testing is complete, stop and remove the server unless it is intentionally being left running for further testing:
    ```sh
    <container-engine> container stop soundscape-server
    <container-engine> container rm soundscape-server
    ```
  - After stopping the server the page still loads from the SW cache — this is correct offline behavior, not a stale server.
  - On a first visit the page reloads once after the service worker claims the client. This `controllerchange` auto-reload only fires on the **first-ever claim** (null → SW), not on version-bump updates — after a version bump the user must reload manually to see the new version label.
  - Avoid hard reloads when testing offline behavior because they bypass the service worker.
- **Service worker caching.** One cache, `soundscape-v{VERSION}`. Bump `VERSION` to wipe — the only invalidation lever. The precache uses `cache: "no-cache"` so it revalidates via ETag on every install, which is why the design works identically on any host. The precache list is split by criticality, not by cache: `APP_SHELL_ASSETS` (markup, styles, modules) fails the install if any entry is missing, because the shell cannot boot without it; `OPTIONAL_ASSETS` (icons) is best effort, so one bad icon cannot cost every bit of offline support. `test/pwa.test.js` asserts the two lists together cover everything deployable under `src/`. `VERSION` lives in three places (`sw.js`, `script.js`, `package.json`); bump all three on every release — `test/pwa.test.js` and `test/version-sync.test.js` enforce it. Do not:
  - Make `sw.js` a module worker that imports `VERSION`. The byte-change must land in `sw.js` itself, not an import, for the browser's SW update to fire.
  - Split into shell/audio caches, hash asset lists, or add HTTP-level `Cache-Control` config. The SW is the only cache that matters.
- Do not open `index.html` directly via `file://`; the app requires HTTP for service worker support.
- Put agent-specific temporary files in `.temp/` (already gitignored); do not write temporary files outside the repo.
- Run unit tests:
  ```sh
  <container-engine> container run --rm --volume ${PWD}:/app soundscape npm test  # live source: picks up your current file state
  ```
- **CI runs the same suite and gates the deploy.** `.github/workflows/deploy.yml` runs `npm test` on every push to `trunk` and on every pull request against it; Pages only publishes if it passes, and never from a pull request (the deploy job names the events that may publish rather than excluding the ones that may not, and pins the ref to `trunk` — `workflow_dispatch` can otherwise be run from any branch). Concurrency lives on the jobs, not the workflow — at workflow level every pull request would join the Pages group, where pending runs cancel each other. Two things there are deliberate and should not be "fixed": there is **no `npm ci`** — the suite imports only `node:` builtins and `src/js`, so it passes from a bare checkout, and the one devDependency (playwright) belongs to the host-only `scripts/`, which CI never runs; and it does **not** build the Dockerfile — that image exists to make local runs match each other, and the runner is already a clean Linux box with the right Node.
- For browser-driven testing, **always use visible (headed) mode** — never headless. Follow this exact sequence when opening the browser:

  1. **Open** the browser and navigate:
     ```sh
     playwright-cli open http://soundscape.localhost:4321 --persistent --config=".opencode/skills/playwright-cli/config.json"
     ```
     Or with a fresh profile for clean-state testing:
     ```sh
     playwright-cli open http://soundscape.localhost:4321 --persistent --profile=".temp/fresh-profile" --config=".opencode/skills/playwright-cli/config.json"
     ```
     The skill's config sets headed mode, a 900×700 OS window, and `viewport: null` so the page renders at the window size — no separate `resize` step is needed.
  2. Run your interactions, then **close** when done:
     ```sh
     playwright-cli close
     ```

  - **Fresh profile** (step 1 alt) avoids interference from previously saved localStorage preferences (track, volume, theme) and cached SW assets.
  - **Multiple tabs share the same cache** — each `playwright-cli open` with the same `--profile` creates a new tab sharing cookies, localStorage, and the SW cache.
  - For generic playwright-cli patterns, commands, and the full reference, see the [playwright-cli skill](.opencode/skills/playwright-cli/SKILL.md).

## Browser Interaction

- Prefer `playwright-cli` for all browser interaction (clicking, filling forms, snapshots, screenshots, console inspection). Its YAML snapshots are clearer, it handles hidden elements (e.g. `pointer-events: none`) correctly, and it closes the browser cleanly with no "last tab" limitation.
- playwright-cli also handles network requests, console messages, and tracing which captures action logs, DOM snapshots, network details, and periodic screenshots. Combined with `page.evaluate()` and the Performance API (`performance.getEntriesByType('resource')`), it can fully verify cache-hit vs cache-miss behavior without DevTools.
- Fall back to `chrome-devtools_*` tools only when explicitly asked — playwright-cli handles nearly everything.

## Testing Methodology

- **Check console first** — run `playwright-cli console` after every action to catch warnings/errors before they scroll away.
- **Verify network** — run `playwright-cli requests --static` to see every URL, method, and status code. Use `eval` with `performance.getEntriesByType('resource')` to check `transferSize`: **0** means served from the SW cache, **>0** means fetched from the network. For audio specifically, a **206 only** (without a preceding 200) on a replayed track confirms a cache hit — the SW served the full file and sliced the byte range without a network re-fetch. Use `eval` with `performance.getEntriesByType('navigation')[0].transferSize` to confirm the navigation itself came from cache.
- **Check UI state** — use `snapshot` for visual structure, `eval` for JS-driven state (e.g. Media Session metadata/playbackState, localStorage values). `navigator.mediaSession.playbackState` is the most reliable playback source; DOM attributes (`aria-label`, `data-playing`) mirror the same value.
- **Prefer CSS selectors over snapshot refs** — refs (e.g. `e27`) are renumbered on every re-render, not just on navigation, and a stale one usually *hits the wrong element instead of erroring*: a reload here turned `click e19` from Play into Previous, silently. `<target>` accepts any unique selector, so `playwright-cli click "#playPauseButton"` cannot drift that way — and this app gives every control a stable id. (It does **not** accept an accessible name: `click "Play"` fails with "does not match any elements".) If a ref is unavoidable, snapshot immediately before the click and use it immediately after; a ref that is even one command old is already suspect.
- **An unknown subcommand prints usage and exits 0** — `playwright-cli navigate <url>` (the command is `goto`) does nothing, reports no error, and leaves the page where it was. Piping through `tail` hides the usage text, so it reads as success and every later assertion silently describes the old page. Check the command list in `playwright-cli --help` rather than guessing the verb.
- **Testing slow loads needs a reload, not just a cache purge** — `AudioPlayer` keeps decoded buffers in an in-memory `bufferCache` for the page's lifetime, so a track played earlier in the session replays instantly even after you delete it from the SW cache. Reload the page to clear it. To throttle, use `context.route` (not `page.route`) — only the context-level route intercepts the service worker's own fetches — and delay with `page.waitForTimeout` inside the handler, since `run-code` route handlers have no `setTimeout`.
- **Track changes have a 420ms title animation** — when testing track navigation, verify state via `navigator.mediaSession.metadata.title` (immediate) rather than the `<h1>` textContent (which settles after the animation completes). Or wait for the `animationend` event.
- **Key press semantics** — `playwright-cli press "ArrowRight"` generates a `keydown` event with `event.key === "ArrowRight"`. Space for play/pause uses `event.key === " "`. The `handleDocumentKeydown` handler suppresses repeat events (`event.repeat`), so press keys without holding.
- **Hardware media key testing** — synthetic keyboard events (Playwright `press`, CDP `Input.dispatchKeyEvent`) are NOT routed through the Media Session API by Chromium. To test real hardware media keys (MediaPlayPause, MediaTrackNext, MediaTrackPrevious, MediaStop), send OS-level input events. On Windows:
  ```powershell
  # The script is available at scripts/send-media-key.ps1
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Next
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Previous
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key PlayPause
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Stop
  ```
  The browser window must be focused (not minimized) for OS-level key events to reach it. **Click Play in Soundscape once before the first key press** so it owns the active media session; subsequent hardware keys will then route to it regardless of other media-playing Chrome windows. Use `Start-Sleep -Milliseconds 800` between successive key presses to allow async track loading to complete; rapid-fire presses (<500ms apart) can cause unexpected track ordering due to concurrent async handlers.

## Testing Casting

- **Never cast to a real device from an automated run.** Casting reaches out to
  hardware on someone's network and starts playing audio in a room. Keep agent
  testing to the unit suite and in-page simulation.
- `test/cast.test.js` covers `CastController` against fake backends;
  `test/app-cast.test.js` covers the transport handoff end to end via the
  harness's opt-in `startAppTestEnvironment({ castDevices: true })`, which
  attaches a fake Remote Playback object to the cast element and exposes
  `castRemote` for driving `beginConnecting` / `connect` / `disconnect`. There is
  no availability control to drive, because the app has no availability to hear
  about; the fake's `watchAvailability` exists only to satisfy feature detection
  and counts its calls so a test can prove it is never used.
- **The cast element carries no `src` until a gesture is reported**, so a test
  that inspects it after a bare `startAppTestEnvironment` will correctly find it
  empty. Dispatch a `pointerdown` or `keydown` on the document first — the
  `touchPage` helper in `app-cast.test.js` does exactly that. In a browser, any
  real click or keypress does it.
- To exercise the real browser path without any device, shadow the read-only
  state on the live `RemotePlayback` object and dispatch its events — this drives
  the app's actual handlers and contacts nothing:
  ```js
  const r = document.getElementById("castAudioElement").remote;
  Object.defineProperty(r, "state", { value: "connected", configurable: true });
  r.dispatchEvent(new Event("connect"));
  ```
- The cast button is visible on any browser that can cast, devices or not, so
  there is nothing to un-hide before checking its appearance. Clicking it on a
  machine with no devices is a safe, useful test: the browser opens its own
  picker, finds nothing, and the dismissal is swallowed as a benign outcome —
  a clean console is the pass condition.

## Manifest Screenshots & Icons

- See also `npm run cast-audio` under Casting Invariants — same host-only,
  skip-when-unchanged contract, but it needs `ffmpeg` rather than Playwright.
- `npm run screenshots` and `npm run icons` regenerate `src/resources/screenshots/*.png` and `src/resources/icons/*.png` via Playwright (see each script's header for how). Host-only — not part of `npm test` or the Docker image. Re-run after a change that affects the home page's appearance or either icon SVG; both skip writing when the output is unchanged.
- Screenshots are excluded from the service worker precache (`test/pwa.test.js` filters `./resources/screenshots/`) — they're only fetched by the OS install UI before the app is installed, never by the running page. Icons remain part of `OPTIONAL_ASSETS`.

## Versioning

- The app version lives in `package.json`, `sw.js`, and `script.js`. Keep them in sync.
- Follow semantic versioning: bump **patch** for bug fixes, **minor** for new features, and **major** for breaking changes.
- Update the version whenever you make a user-facing change so the deployed PWA and footer label stay accurate.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other git mutations unless explicitly asked.
- Preserve the existing git staging state: keep staged files staged and unstaged files unstaged.
- Do not stage or unstage files on the agent's own initiative.
