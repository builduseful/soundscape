# Repository Guidelines

## Overview

Soundscape is a browser-based Progressive Web App (PWA) that plays seamless looping ambient background audio (rain, thunderstorms, fireplace, open road, and white/pink/brown noise). It supports play/pause/prev/next controls, persistent volume/theme/track preferences, light/dark/system themes, and Media Session integration for browser and OS media controls, with sample-accurate looping via Web Audio.

## Project Structure

```
soundscape/
├── Dockerfile               # Builds the container image (Caddy + Node)
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
│   ├── pwa.js                   # PWA lifecycle (registration, install prompts)
│   ├── theme-utils.js           # Light/dark/system theme helpers
│   ├── tracks.js                # Track catalog and metadata
│   └── components/
│       ├── theme-selector.js    # Custom element for theme mode selection
│       └── volume-control.js    # Custom element for volume slider
├── resources/
│   ├── icons/                   # PWA/favicon icons (png + svg)
│   └── soundscapes/             # Looping ambience audio files (.opus)
├── scripts/
│   └── export-icons.sh         # Icon generation helper
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

- The app works with any OCI-compatible container engine. **Always read `.config.md` first** for this project's specific engine, then substitute `<container-engine>` in the commands below accordingly.
- **Agents only:** The shell tool has a timeout, so `npm test` and builds may be killed before completing. Start the server via `run --detach` (returns immediately). The `--volume` bind mount maps your working directory into the container so edits appear without rebuilding:
  ```sh
  <container-engine> build --tag soundscape .
  <container-engine> container run --detach \
      --publish 4321:4321 \
      --volume ${PWD}:/app \
      --name soundscape-server \
      soundscape
  ```
  Then navigate the browser — it will retry until the server is ready.
  - To stop the server:
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
- For browser-driven testing, **always use visible (headed) mode** — never headless. Use `playwright-cli open http://localhost:4321 --headed --persistent` to drive a visible browser the user can watch and listen to, then `playwright-cli close` when done (see the playwright-cli skill for full command reference). This uses Playwright's bundled Chromium (no yellow automation warning banner) and a persistent profile that remembers the window size.
  - **Window sizing:** `playwright-cli resize 900 700` — sets viewport size.
  - Unregister the service worker and `--ignoreCache` reload when verifying new code.

## Browser Interaction

- Prefer `playwright-cli` for all browser interaction (clicking, filling forms, snapshots, screenshots, console inspection). Its YAML snapshots are clearer, it handles hidden elements (e.g. `pointer-events: none`) correctly, and it closes the browser cleanly with no "last tab" limitation.
- playwright-cli also handles network requests, console messages, and tracing which captures action logs, DOM snapshots, network details, and periodic screenshots.
- Fall back to `chrome-devtools_*` tools when you need something playwright-cli can't provide (e.g. heap snapshots, performance traces at the engine level).
- Both can be used together in a session — playwright-cli for interaction, chrome-devtools for deeper debugging on the same page.

## Versioning

- The app version lives in `package.json` and `src/version.js`. Keep them in sync.
- Follow semantic versioning: bump **patch** for bug fixes, **minor** for new features, and **major** for breaking changes.
- Update the version whenever you make a user-facing change so the deployed PWA and footer label stay accurate.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other git mutations unless explicitly asked.
- Preserve the existing git staging state: keep staged files staged and unstaged files unstaged.
- Do not stage or unstage files on the agent's own initiative.
