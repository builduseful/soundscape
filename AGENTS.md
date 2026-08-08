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
│   │   ├── media-session.js          # Media Session API integration (metadata, actions)
│   │   ├── pwa.js                    # PWA lifecycle (registration, install prompts, launch queue)
│   │   ├── theme-utils.js            # Light/dark/system theme helpers
│   │   ├── tracks.js                 # Track catalog and metadata
│   │   └── components/
│   │       ├── theme-selector.js     # Custom element for theme mode selection
│   │       └── volume-control.js     # Custom element for volume slider
│   └── resources/
│       ├── icons/                    # PWA/favicon icons (png + svg)
│       └── soundscapes/              # Looping ambience audio files (.opus)
├── test/                             # Unit tests (dependency-free)
│   └── helpers/
│       └── app-test-harness.js       # Shared test fixtures/utilities
├── scripts/
│   ├── export-icons.sh               # Icon generation helper
│   └── send-media-key.ps1           # OS-level media key injection for testing
├── .github/
│   └── workflows/
│       └── deploy.yml                # GitHub Pages deployment (uploads src/)
├── Dockerfile                        # Multi-target image: default = Caddy + Node (serve + npm test); `--target serve` = slim Caddy-only runtime
├── .dockerignore                     # Excludes unnecessary files from the build
├── package.json                      # Scripts and metadata (npm test)
├── .config.md                        # Per-developer configuration (gitignored)
├── AGENTS.md
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
- Re-register Media Session action handlers after every track change. Some browsers drop the Media Session association when the long-lived `<audio>` element's `src` changes, so refreshing the handlers (and metadata) inside `playCurrentTrack` keeps keyboard/earphone controls working across tracks.

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
- **Snapshot refs change after navigation** — refs (e.g. `e27`) are ephemeral and may point at different elements after navigation. Always take a fresh snapshot after navigating to get valid refs.
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

## Versioning

- The app version lives in `package.json`, `sw.js`, and `script.js`. Keep them in sync.
- Follow semantic versioning: bump **patch** for bug fixes, **minor** for new features, and **major** for breaking changes.
- Update the version whenever you make a user-facing change so the deployed PWA and footer label stay accurate.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other git mutations unless explicitly asked.
- Preserve the existing git staging state: keep staged files staged and unstaged files unstaged.
- Do not stage or unstage files on the agent's own initiative.
