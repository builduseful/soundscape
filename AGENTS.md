# Repository Guidelines

## Overview

Soundscape is a browser-based Progressive Web App (PWA) that plays looping ambient background audio — rain, thunderstorms, fireplace, open road, and white/pink/brown noise.

It has play/pause/prev/next controls, a volume slider, light/dark/system themes, and it remembers your volume, theme and track. It works offline once installed, and it responds to the media keys on your keyboard and the playback controls your OS shows in its notification area. The loops are gapless, which is harder than it sounds and is the reason for most of the audio rules below.

**Quick start:**

| I want to… | Do this |
|---|---|
| Run the tests | `<container-engine> container run --rm --volume ${PWD}:/app soundscape npm test` |
| Run the app | See [Development and Testing](#development-and-testing) — start the server, then drive it with `playwright-cli` |
| Change how audio plays | Read [Audio Invariants](#audio-invariants) first |
| Change Chromecast/AirPlay | Read [`src/js/remote-playback/README.md`](src/js/remote-playback/README.md) first |
| Ship a change | Bump the version in three files (see [Service Worker and Versioning](#service-worker-and-versioning)) |

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
│   │   ├── audio-player.js           # Web Audio + HTMLAudioElement playback engine (the local PlaybackOutput)
│   │   ├── playback-output.js        # The PlaybackOutput port: what "a thing that can be playing" is
│   │   ├── media-session.js          # Media Session API integration (metadata, actions)
│   │   ├── pwa.js                    # Service worker registration + Launch Queue consumer
│   │   ├── theme-utils.js            # Light/dark/system theme helpers
│   │   ├── tracks.js                 # Track catalog and metadata (knows nothing about remote playback)
│   │   ├── remote-playback/          # Chromecast/AirPlay plugin — detachable; READ ITS README.md
│   │   │   └── README.md             # Invariants, platform evidence, testing, device checklist
│   │   └── components/
│   │       ├── app-menu.js           # Custom element for the top-right menu
│   │       ├── theme-selector.js     # Custom element for theme mode selection
│   │       └── volume-control.js     # Custom element for volume slider
│   └── resources/
│       ├── icons/                    # PWA/favicon icons (png + svg)
│       ├── screenshots/              # manifest.webmanifest install screenshots (git-tracked PNGs)
│       └── soundscapes/              # Ambience loops: .opus (local playback) + .m4a twins (cast)
├── test/                             # Unit tests (dependency-free)
│   ├── playback-output-contract.test.js   # One spec, run against every PlaybackOutput incl. AudioPlayer
│   ├── *remote-playback*, providers/ # The plugin's own tests — see its README
│   └── helpers/                      # app-test-harness.js + the three fakes (README explains which)
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

- App-owned custom elements live in `src/js/components`, **with one deliberate
  exception**: `src/js/remote-playback/control.js`. It lives with the feature it
  belongs to rather than with its siblings, because remote playback is a plugin
  that has to be deletable as a directory — a control filed under `components/`
  would leave the feature spread across two places and the deletion story a
  half-truth. The rule to take from this is the reason, not the exception: an
  element that belongs to one detachable feature goes with that feature;
  everything the app itself owns goes in `components/`.
- The `@scope`/light-DOM rule below applies to all of them wherever they sit, and
  `component-contract.test.js` checks the exception by name rather than by
  scanning the directory — a sweep that finds elements by folder stops covering
  one the moment it moves, which is precisely what happened when this one did.
- Build components in light DOM (ordinary markup in the page, visible to normal CSS and DevTools) with an inline `@scope` style block, which confines the rules inside it to that component's subtree. This keeps component markup easy to inspect, test and integrate, while stopping its selectors leaking out into the rest of the page.
- Keep selectors inside `@scope` short and component-local. Reserve `style.css` for app-wide styling, not component internals.
- Do not use Shadow DOM (which hides a component's markup and styles from the page) for normal app components. If a change seems to need it, raise the reason first; the app is internal and should stay easy to inspect and style.

## Audio Invariants (rules that must stay true)

- Soundscape intentionally has two coordinated playback surfaces: one long-lived `HTMLAudioElement` for browser-observable playback, and decoded Web Audio buffers for audible playback.
- The `HTMLAudioElement` exists for platform integration, not sound output or visible UI. Browser and OS media controls, notifications, autoplay policy, audio focus, and source/preload state all depend on browser-observable media plumbing; Web Audio alone is not a reliable substitute.
- Keep the media element loaded and play/pause it with app state. Route it through a gain node set to zero — silent, but still "playing" as far as the browser is concerned — so the platform sees playback without the sound being heard twice.
- Audible looping comes from decoded `AudioBufferSourceNode`s. These ambience tracks need seamless loop points, and native `HTMLAudioElement.loop` has produced audible gaps or discontinuities on short loops.
- Create and resume `AudioContext` from the playback flow, not page load, so browser user-gesture policy stays intact.
- Keep the stale-request guards around track changes — the checks that discard the result of a track change that has since been superseded. Fetching and decoding audio can finish out of order, and an older request must never replace newer playback.
- Report buffer fetch/decode as a loading state (`AudioPlayer.isLoading()` / `onLoadingChange`). The title switches the instant a track is picked but the audio cannot, so on a slow connection there is a real window where the name on screen is not the sound in the room. Three rules keep the indicator honest, each with a test behind it:
  - It waits out `LOADING_INDICATOR_DELAY_MS` before showing, so a cached track — which decodes in milliseconds — never flashes one. That delay must also outlast the title change animation, because the `<h1>`'s accessible text only settles when the animation ends; `component-contract.test.js` pins the two together across `script.js` and `style.css`.
  - Skipping again mid-load hands the state to the newer request without reporting a stop, so the indicator never blinks between tracks and the delay is not re-armed.
  - It and `#playbackError` are mutually exclusive. They are the app's only two status messages, they sit in the same strip under the title, and a failure notice under a live loading bar is both a contradiction and (with reduced motion, where the bar becomes text) an overlap.
- `AudioPlayer` is one implementation of `PlaybackOutput`, not the only one. Anything the app does to "the thing that is playing" goes through `activeOutput()` in `script.js`; only three paths are entitled to reach for the local player by name (its media element's own `play`/`pause` events, visibility, and the volume the app may persist), and they say so via `isRemoteActive()`.
- Treat Media Session and Audio Session APIs as progressive enhancements. When available, keep metadata, playback state, actions, and decoded-buffer position state in sync; when unavailable, playback should still work.
- **Neither `<audio>` element may cross into the other's job.** `#audioElement` goes through `createMediaElementSource`, so it is unusable as a cast transport and carries `disableremoteplayback` / `x-webkit-airplay="deny"` — a browser offering it as a cast source would hand the user a route the app knows nothing about while the decoded buffer kept playing locally. `#remoteTransportElement` is the cast transport and must never be passed to `createMediaElementSource`. Both halves prevent the same thing: audio in two places at once.
- Re-register Media Session action handlers after every track change. Some browsers drop the Media Session association when the long-lived `<audio>` element's `src` changes, so refreshing the handlers (and metadata) inside `playCurrentTrack` keeps keyboard/earphone controls working across tracks.

## Remote Playback

Chromecast and AirPlay are a detachable plugin in `src/js/remote-playback/`.

**Read [`src/js/remote-playback/README.md`](src/js/remote-playback/README.md)
before changing anything in that directory, its tests, or the handover region of
`script.js`.** It carries measured platform behaviour — silent picker rejections,
codec limits, device-only failures — that the test suite cannot show you and that
tidying will quietly undo.

**Never cast to a real device from an automated run.** It plays audio in
someone's room. Fakes cover everything except the manual checklist in the README.

## Development and Testing

- The app works with any container engine that follows the OCI standard (Docker, Podman, and others). **Always read `.config.md` first** for this project's specific engine, then substitute `<container-engine>` in the commands below accordingly. If `.config.md` is not configured or does not specify an engine, fall back to `docker`.
- **Agents only:** The shell tool has a timeout, so `npm test` and builds may be killed before completing. Start the server via `run --detach` (returns immediately). The `--volume` flag maps your working directory into the container, so edits appear without rebuilding:
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
- Do not open `index.html` directly via `file://`; the app requires HTTP for service worker support.
- Put agent-specific temporary files in `.temp/` (already gitignored); do not write temporary files outside the repo.
- Run unit tests:
  ```sh
  <container-engine> container run --rm --volume ${PWD}:/app soundscape npm test  # live source: picks up your current file state
  ```
- **CI runs the same suite and gates the deploy.** `.github/workflows/deploy.yml` runs `npm test` on every push to `trunk` and on every pull request against it. GitHub Pages publishes only if the tests pass, and never from a pull request. Three details there are deliberate:
  - **Only named events may publish**, and the deploy job pins the branch to `trunk`. Listing what may publish is safer than excluding what may not — `workflow_dispatch` (the manual "run workflow" button) can otherwise be triggered from any branch.
  - **Concurrency is set per job, not per workflow.** At workflow level every pull request would join the Pages group, where a pending run cancels the one before it.
  - **No `npm ci`, and no Docker build.** The suite imports only Node built-ins and `src/js`, so it runs from a bare checkout; the single dev dependency (playwright) belongs to `scripts/`, which CI never runs. The Docker image exists to make *local* runs match each other, and the CI runner is already a clean Linux box with the right Node.

## Service Worker and Versioning

- **One cache, named `soundscape-v{VERSION}`.** Changing `VERSION` is the only way to wipe it, and the only invalidation lever the app has.
- **Files are cached up front, at install** (this is the "precache"). The list is split by how badly the app needs each entry, not into separate caches:
  - `APP_SHELL_ASSETS` — markup, styles, modules. A missing entry fails the install, because the app cannot start without it.
  - `OPTIONAL_ASSETS` — icons. Best effort, so one bad icon cannot cost the app every bit of offline support.

  The fetch uses `cache: "no-cache"`, which asks the server to confirm each file is unchanged rather than trusting a stale copy — which is why this works the same on any host. `test/pwa.test.js` checks the two lists together cover everything deployable under `src/`.
- **Two things not to "fix":**
  - Do not make `sw.js` a module that imports `VERSION`. Browsers detect a service worker update by comparing the worker file's own bytes, so the change has to land in `sw.js` itself.
  - Do not split into separate shell/audio caches, hash the asset lists, or add HTTP `Cache-Control` config. The service worker is the only cache that matters here.
- **`VERSION` lives in three places** — `package.json`, `sw.js`, `script.js` — and all three move together on every release; `test/pwa.test.js` and `test/version-sync.test.js` enforce it. Semantic versioning: patch for fixes, minor for features, major for breaking changes. Bump on any user-facing change, so the deployed PWA and the footer label stay accurate — and on any change under `src/` even when nothing is user-facing, or the cache is not invalidated and a returning visitor gets a half-old shell.

## Browser Testing

- Use `playwright-cli` for all browser interaction, in **visible (headed) mode** — never headless. Its YAML snapshots are clearer than the alternatives, it handles hidden elements (e.g. `pointer-events: none`) correctly, and it closes cleanly with no "last tab" limitation. It also covers network requests, console messages and tracing; with `eval` and the Performance API it can verify cache-hit vs cache-miss without DevTools. Fall back to `chrome-devtools_*` only when explicitly asked.
  ```sh
  playwright-cli open http://soundscape.localhost:4321 --persistent --config=".opencode/skills/playwright-cli/config.json"
  # ...interactions...
  playwright-cli close
  ```
  The skill's config sets headed mode, a 900×700 OS window, and `viewport: null` so the page renders at the window size — no separate `resize` step. Add `--profile=".temp/fresh-profile"` for clean-state testing, which avoids saved localStorage preferences (track, volume, theme) and cached SW assets; reusing a `--profile` opens a new tab sharing cookies, localStorage and the SW cache. Full reference: the [playwright-cli skill](.opencode/skills/playwright-cli/SKILL.md).
- **Check console first** — run `playwright-cli console` after every action to catch warnings/errors before they scroll away.
- **Verify network** — run `playwright-cli requests --static` to see every URL, method, and status code. Use `eval` with `performance.getEntriesByType('resource')` to check `transferSize`: **0** means served from the SW cache, **>0** means fetched from the network. For audio specifically, a **206 only** (without a preceding 200) on a replayed track confirms a cache hit — the SW served the full file and sliced the byte range without a network re-fetch. Use `eval` with `performance.getEntriesByType('navigation')[0].transferSize` to confirm the navigation itself came from cache.
- **Check UI state** — use `snapshot` for visual structure, `eval` for JS-driven state (e.g. Media Session metadata/playbackState, localStorage values). `navigator.mediaSession.playbackState` is the most reliable playback source; DOM attributes (`aria-label`, `data-playing`) mirror the same value.
- **Prefer CSS selectors over snapshot refs** — refs (e.g. `e27`) are renumbered on every re-render, not just on navigation, and a stale one usually *hits the wrong element instead of erroring*: a reload here turned `click e19` from Play into Previous, silently. `<target>` accepts any unique selector, so `playwright-cli click "#playPauseButton"` cannot drift that way — and every control the page itself owns has a stable id. The exception is a control that lives *inside* a component and so has no id of its own: reach those through the host element, as in `click "remote-playback button"`. (It does **not** accept an accessible name: `click "Play"` fails with "does not match any elements".) If a ref is unavoidable, snapshot immediately before the click and use it immediately after; a ref that is even one command old is already suspect.
- **Some pickers open a native OS dialog, which blocks the automation session** — a browser-chrome window is outside the page, so nothing can dismiss it from the driver and the run hangs until someone clicks it by hand. Prefer the unit suite for any flow that ends in one.
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

## Manifest Screenshots and Icons

- `npm run cast-audio` follows the same host-only, skip-when-unchanged contract
  as these, but needs `ffmpeg`; see the remote playback README.
- `npm run screenshots` and `npm run icons` regenerate `src/resources/screenshots/*.png` and `src/resources/icons/*.png` via Playwright (see each script's header for how). Host-only — not part of `npm test` or the Docker image. Re-run after a change that affects the home page's appearance or either icon SVG; both skip writing when the output is unchanged.
- **Keep what the script produces; never revert it.** Stale is the only failure
  mode here, and the byte-identical skip means a routine run costs nothing.
- **No remote playback control appears in them, deliberately.** The capture
  browser brands itself `Chromium`, which both capability checks refuse, so the
  control removes itself — and an install screenshot showing what every visitor
  gets beats one showing a button only some browsers offer. Do not force it into
  frame.
- Screenshots are excluded from the service worker precache (`test/pwa.test.js` filters `./resources/screenshots/`) — they're only fetched by the OS install UI before the app is installed, never by the running page. Icons remain part of `OPTIONAL_ASSETS`.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other git mutations unless explicitly asked.
- Preserve the existing git staging state: keep staged files staged and unstaged files unstaged.
- Do not stage or unstage files on the agent's own initiative.
