# Repository Guidelines

## Overview

Soundscape is a browser-based Progressive Web App (PWA) that plays seamless looping ambient background audio (rain, thunderstorms, fireplace, open road, and white/pink/brown noise). It supports play/pause/prev/next controls, persistent volume/theme/track preferences, light/dark/system themes, and Media Session integration for browser and OS media controls, with sample-accurate looping via Web Audio.

## Project Structure

```
soundscape/
├── Dockerfile               # Multi-target image: default = Caddy + Node (serve + npm test); `--target serve` = slim Caddy-only runtime
├── .dockerignore            # Excludes unnecessary files from the build
├── index.html               # App entry point, loads script.js and styles
├── style.css                # App-wide styling (component internals live in @scope blocks)
├── script.js                # App bootstrap: wires audio, UI, state, and components
├── sw.js                    # Service worker for offline/PWA support
├── manifest.webmanifest     # PWA manifest
├── CNAME                    # Custom domain for deployment
├── package.json             # Scripts and metadata (npm test)
├── src/
│   ├── audio-player.js          # Web Audio + HTMLAudioElement playback engine
│   ├── media-session.js         # Media Session API integration (metadata, actions)
│   ├── pwa.js                   # PWA lifecycle (registration, install prompts, launch queue)
│   ├── theme-utils.js           # Light/dark/system theme helpers
│   ├── tracks.js                # Track catalog and metadata
│   └── components/
│       ├── theme-selector.js    # Custom element for theme mode selection
│       └── volume-control.js    # Custom element for volume slider
├── resources/
│   ├── icons/                   # PWA/favicon icons (png + svg)
│   └── soundscapes/             # Looping ambience audio files (.opus)
├── scripts/
│   ├── export-icons.sh         # Icon generation helper
│   └── send-media-key.ps1     # OS-level media key injection for testing
├── test/                        # Unit tests (dependency-free)
├── test-helpers/
│   └── app-test-harness.js     # Shared test fixtures/utilities
├── .config.md                  # Per-developer configuration (gitignored)
└── .opencode/                  # Opencode agent/skill config (not app code)
```

## Custom Elements

- App-owned custom elements live in `src/components`.
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
- Treat Media Session and Audio Session APIs as progressive enhancements. When available, keep metadata, playback state, actions, and decoded-buffer position state in sync; when unavailable, playback should still work.
- Re-register Media Session action handlers after every track change. Some browsers drop the Media Session association when the long-lived `<audio>` element's `src` changes, so refreshing the handlers (and metadata) inside `playCurrentTrack` keeps keyboard/earphone controls working across tracks.

## Development and Testing

- The app works with any OCI-compatible container engine. **Always read `.config.md` first** for this project's specific engine, then substitute `<container-engine>` in the commands below accordingly. If `.config.md` is not configured or does not specify an engine, fall back to `docker`.

- **Agents only:** The shell tool has a timeout, so `npm test` and builds may be killed before completing. Start the server via `run --detach` (returns immediately). The `--volume` bind mount maps your working directory into the container so edits appear without rebuilding:
  ```sh
  <container-engine> build --tag soundscape .
  <container-engine> container rm soundscape-server 2>$null  # Remove stale container if it exists
  <container-engine> container run --detach \
      --publish 4321:80 \
      --volume ${PWD}:/app \
      --name soundscape-server \
      soundscape
  ```
  - After starting, **verify the server is serving** before launching the browser. Use curl or a quick page check. The browser may silently show a cached/stale page otherwise, especially with the service worker active.
  - To stop and remove the server:
    ```sh
    <container-engine> container stop soundscape-server
    <container-engine> container rm soundscape-server
    ```
  - The app uses a service worker, so the browser may display a cached version of the page after the server is stopped. To confirm the server is actually running, use the browser's Network panel or perform a hard reload (`Ctrl+Shift+R`).
  - On a first visit the page reloads once after the service worker claims the client; this guarantees that cached navigations and audio requests are handled by the SW. Avoid hard reloads when testing offline behavior because they bypass the service worker.
  - Favicon and some manifest icon requests bypass the service worker by design in Chrome, so expect occasional `304` revalidation log entries for those icons even when the app shell is cached.
- Do not open `index.html` directly via `file://`; the app requires HTTP for module loading and service worker support.
- Put agent-specific temporary files in `.temp/` (already gitignored); do not write temporary files outside the repo.
- Run unit tests:
  ```sh
  <container-engine> container run --rm --volume ${PWD}:/app soundscape npm test  # live source: picks up your current file state
  ```
- For browser-driven testing, **always use visible (headed) mode** — never headless. Follow this exact sequence when opening the browser:

  1. **Open** the browser and navigate:
     ```sh
     playwright-cli open http://soundscape.localhost:4321 --headed --persistent
     ```
     Or with a fresh profile for clean-state testing:
     ```sh
     playwright-cli open http://soundscape.localhost:4321 --headed --persistent --profile=".temp/fresh-profile"
     ```
  2. **Resize** the window to a consistent viewport:
     ```sh
     playwright-cli resize 900 700
     ```
  3. Run your interactions, then **close** when done:
     ```sh
     playwright-cli close
     ```

  Additional notes:
  - **Unregister SW + `--ignoreCache`** reload when verifying new code.
  - **Snapshot refs change between sessions** — always take a fresh `snapshot` before interacting, since element refs (e.g. `e27`, `e28`) are generated per-session and don't carry over after closing/reopening the browser.
  - **Fresh profile** (step 1 alt) avoids interference from previously saved localStorage preferences (track, volume, theme).

## Browser Interaction

- Prefer `playwright-cli` for all browser interaction (clicking, filling forms, snapshots, screenshots, console inspection). Its YAML snapshots are clearer, it handles hidden elements (e.g. `pointer-events: none`) correctly, and it closes the browser cleanly with no "last tab" limitation.
- playwright-cli also handles network requests, console messages, and tracing which captures action logs, DOM snapshots, network details, and periodic screenshots.
- Fall back to `chrome-devtools_*` tools when you need something playwright-cli can't provide (e.g. heap snapshots, performance traces at the engine level).
- Both can be used together in a session — playwright-cli for interaction, chrome-devtools for deeper debugging on the same page.

## Testing Methodology

- **Check console first** — run `playwright-cli console` after every action to catch warnings/errors before they scroll away.
- **Verify network** — run `playwright-cli requests` to confirm expected resources loaded (audio .opus files return 200, SW serves from cache when offline).
- **Check UI state** — use `snapshot` for visual structure, `eval` for JS-driven state (e.g. Media Session metadata/playbackState, localStorage values).
- **Track changes have a 420ms title animation** — when testing track navigation, verify state via `navigator.mediaSession.metadata.title` (immediate) rather than the `<h1>` textContent (which settles after the animation completes). Or wait for the `animationend` event.
- **Key press semantics** — `playwright-cli press "ArrowRight"` generates a `keydown` event with `event.key === "ArrowRight"`. Space for play/pause uses `event.key === " "`. The `handleDocumentKeydown` handler suppresses repeat events (`event.repeat`), so press keys without holding.
- **Lighthouse audits** — when using `chrome-devtools_lighthouse_audit`, first ensure DevTools is pointed at the target page (not `about:blank`) via `chrome-devtools_navigate_page`.
- **Media Session is authoritative** — when checking playback state, `navigator.mediaSession.playbackState` is the most reliable source (it reflects the app's actual state), while the play button's `aria-label` and `data-playing` attribute mirror the same value.
- **Hardware media key testing** — synthetic keyboard events (Playwright `press`, CDP `Input.dispatchKeyEvent`) are NOT routed through the Media Session API by Chromium. To test real hardware media keys (MediaPlayPause, MediaTrackNext, MediaTrackPrevious, MediaStop), send OS-level input events. On Windows:
  ```powershell
  # The script is available at scripts/send-media-key.ps1
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Next
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Previous
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key PlayPause
  PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Stop
  ```
  The browser window must be focused (not minimized) for OS-level key events to reach it. Use `Start-Sleep -Milliseconds 800` between successive key presses to allow async track loading to complete; rapid-fire presses (<500ms apart) can cause unexpected track ordering due to concurrent async handlers.

## Versioning

- The app version lives in `package.json` and `src/version.js`. Keep them in sync.
- Follow semantic versioning: bump **patch** for bug fixes, **minor** for new features, and **major** for breaking changes.
- Update the version whenever you make a user-facing change so the deployed PWA and footer label stay accurate.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other git mutations unless explicitly asked.
- Preserve the existing git staging state: keep staged files staged and unstaged files unstaged.
- Do not stage or unstage files on the agent's own initiative.
