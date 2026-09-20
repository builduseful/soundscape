# Running and testing

Covers the unit suite, running the app locally, and driving it in a browser.
The remote-playback tests have their own rules — see
[`../src/js/remote-playback/AGENTS.md`](../src/js/remote-playback/AGENTS.md).
CI, which gates the deploy on this suite, is in
[`../src/AGENTS.md`](../src/AGENTS.md).

The tests are dependency-free: they import only Node built-ins and `src/js`.

## Container engine

The app works with any OCI container engine (Docker, Podman, and others).
**Always read `.config.md` first** for this project's engine, then substitute
`<container-engine>` in the commands below. If `.config.md` is not configured or
does not specify an engine, fall back to `docker`.

## Unit tests

```sh
<container-engine> container run --rm --volume ${PWD}:/app soundscape npm test  # live source: picks up your current file state
```

## Running the app

The shell tool has a timeout, so `npm test` and builds may be killed before
completing. Start the server via `run --detach` (returns immediately). The
`--volume` flag maps your working directory into the container, so edits appear
without rebuilding:

```sh
<container-engine> build --tag soundscape .
<container-engine> container rm --force soundscape-server 2>$null  # Idempotent: tears down any prior container, running or stopped
<container-engine> container run --detach \
    --publish 4321:80 \
    --volume ${PWD}:/app \
    --name soundscape-server \
    soundscape
```

- After starting, **verify the server is serving** before launching the browser —
  the SW cache can make a stale page appear live. Use
  `curl -sI --max-time 3 http://soundscape.localhost:4321` (the `--max-time`
  prevents the shell tool's timeout from blocking on a hung request).
- **If the server is already running**, skip the start commands — the bind mount
  means source edits are live without rebuilding. Just verify with `curl`.
- When testing is complete, stop and remove the server unless it is
  intentionally being left running:
  ```sh
  <container-engine> container stop soundscape-server
  <container-engine> container rm soundscape-server
  ```
- After stopping the server the page still loads from the SW cache — this is
  correct offline behaviour, not a stale server.
- On a first visit the page reloads once after the service worker claims the
  client. This `controllerchange` auto-reload only fires on the **first-ever
  claim** (null → SW), not on version-bump updates — after a version bump the
  user must reload manually to see the new version label.
- Avoid hard reloads when testing offline behaviour, because they bypass the
  service worker.
- Do not open `index.html` directly via `file://`; the app requires HTTP for
  service worker support.
- Put agent-specific temporary files in `.temp/` (already gitignored); do not
  write temporary files outside the repo.

## Browser testing

Use `playwright-cli` for all browser interaction, in **visible (headed) mode** —
never headless. Its YAML snapshots are clearer than the alternatives, it handles
hidden elements (e.g. `pointer-events: none`) correctly, and it closes cleanly
with no "last tab" limitation. It also covers network requests, console messages
and tracing; with `eval` and the Performance API it can verify cache-hit vs
cache-miss without DevTools. Fall back to `chrome-devtools_*` only when
explicitly asked.

```sh
playwright-cli -s=soundscape open http://soundscape.localhost:4321 --persistent --config=".opencode/skills/playwright-cli/config.json"
# ...interactions, every one of them -s=soundscape...
playwright-cli -s=soundscape close
```

The skill's config sets headed mode, a 900×700 OS window, and `viewport: null`
so the page renders at the window size — no separate `resize` step. Add
`--profile=".temp/fresh-profile"` for clean-state testing, which avoids saved
localStorage preferences (track, volume, theme) and cached SW assets; reusing a
`--profile` opens a new tab sharing cookies, localStorage and the SW cache.

- **Name the session, on every command.** Without `-s=`, `playwright-cli` drives
  one shared default browser, so anything else using it — another agent, another
  terminal, the maintainer testing something unrelated — steers the same tab. It
  fails silently and in the worst way: the tab here was navigated to someone
  else's app mid-run, and `eval` went on answering about that page. A named
  session is the whole fix, but it is per command, not per browser: one call
  that forgets `-s=` reaches for the default browser instead. Full reference:
  the [playwright-cli skill](../.opencode/skills/playwright-cli/SKILL.md).
- **Check console first** — run `playwright-cli console` after every action to
  catch warnings/errors before they scroll away.
- **Verify network** — run `playwright-cli requests --static` to see every URL,
  method, and status code. Use `eval` with
  `performance.getEntriesByType('resource')` to check `transferSize`: **0** means
  served from the SW cache, **>0** means fetched from the network. For audio
  specifically, a **206 only** (without a preceding 200) on a replayed track
  confirms a cache hit — the SW served the full file and sliced the byte range
  without a network re-fetch. Use `eval` with
  `performance.getEntriesByType('navigation')[0].transferSize` to confirm the
  navigation itself came from cache.
- **Check UI state** — use `snapshot` for visual structure, `eval` for
  JS-driven state (e.g. Media Session metadata/playbackState, localStorage
  values). `navigator.mediaSession.playbackState` is the most reliable playback
  source; DOM attributes (`aria-label`, `data-playing`) mirror the same value.
- **Prefer CSS selectors over snapshot refs** — refs (e.g. `e27`) are renumbered
  on every re-render, not just on navigation, and a stale one usually *hits the
  wrong element instead of erroring*: a reload here turned `click e19` from Play
  into Previous, silently. `<target>` accepts any unique selector, so
  `playwright-cli click "#playPauseButton"` cannot drift that way — and every
  control the page itself owns has a stable id. The exception is a control that
  lives *inside* a component and so has no id of its own: reach those through
  the host element, as in `click "remote-playback button"`. (It does **not**
  accept an accessible name: `click "Play"` fails with "does not match any
  elements".) If a ref is unavoidable, snapshot immediately before the click and
  use it immediately after; a ref that is even one command old is already
  suspect.
- **Some pickers open a native OS dialog, which blocks the automation session** —
  a browser-chrome window is outside the page, so nothing can dismiss it from
  the driver and the run hangs until someone clicks it by hand. Prefer the unit
  suite for any flow that ends in one.
- **An unknown subcommand prints usage and exits 0** — `playwright-cli navigate <url>`
  (the command is `goto`) does nothing, reports no error, and leaves the page
  where it was. Piping through `tail` hides the usage text, so it reads as
  success and every later assertion silently describes the old page. Check the
  command list in `playwright-cli --help` rather than guessing the verb.
- **Testing slow loads needs a reload, not just a cache purge** — `AudioPlayer`
  keeps decoded buffers in an in-memory `bufferCache` for the page's lifetime,
  so a track played earlier in the session replays instantly even after you
  delete it from the SW cache. Reload the page to clear it. To throttle, use
  `context.route` (not `page.route`) — only the context-level route intercepts
  the service worker's own fetches — and delay with `page.waitForTimeout` inside
  the handler, since `run-code` route handlers have no `setTimeout`.
- **Track changes have a 420ms title animation** — verify state via
  `navigator.mediaSession.metadata.title` (immediate) rather than the `<h1>`
  textContent (which settles after the animation completes). Or wait for the
  `animationend` event.
- **Key press semantics** — `playwright-cli press "ArrowRight"` generates a
  `keydown` event with `event.key === "ArrowRight"`. Space for play/pause uses
  `event.key === " "`. The `handleDocumentKeydown` handler suppresses repeat
  events (`event.repeat`), so press keys without holding.

## Hardware media keys

Synthetic keyboard events (Playwright `press`, CDP `Input.dispatchKeyEvent`) are
NOT routed through the Media Session API by Chromium. To test real hardware
media keys (MediaPlayPause, MediaTrackNext, MediaTrackPrevious, MediaStop), send
OS-level input events. On Windows:

```powershell
# The script is available at scripts/send-media-key.ps1
PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Next
PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Previous
PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key PlayPause
PowerShell -ExecutionPolicy Bypass -File "scripts\send-media-key.ps1" -Key Stop
```

The browser window must be focused (not minimized) for OS-level key events to
reach it. **Click Play in Soundscape once before the first key press** so it
owns the active media session; subsequent hardware keys will then route to it
regardless of other media-playing Chrome windows. Use
`Start-Sleep -Milliseconds 800` between successive key presses to allow async
track loading to complete; rapid-fire presses (<500ms apart) can cause
unexpected track ordering due to concurrent async handlers.
