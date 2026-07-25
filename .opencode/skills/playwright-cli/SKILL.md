<!-- Adapted from https://github.com/microsoft/playwright-cli; see playwright-cli.LICENSE-APACHE. -->

---
name: playwright-cli
description: Drive a real browser from the terminal via the Playwright CLI. Use for browser testing, web automation, and reproducing UI bugs.
allowed-tools: Bash(playwright-cli:*) Bash(npx:*) Bash(npm:*)
---

# Browser Automation with playwright-cli

## Quick start

```bash
# open new browser
playwright-cli open
# navigate to a page
playwright-cli goto https://playwright.dev
# interact with the page using refs from the snapshot
playwright-cli click e15
playwright-cli type "page.click"
playwright-cli press Enter
# take a screenshot (rarely used, as snapshot is more common)
playwright-cli screenshot
# close the browser
playwright-cli close
```

## Commands

### Core

```bash
playwright-cli open
# open and navigate right away
playwright-cli open https://example.com/
playwright-cli goto https://playwright.dev
playwright-cli type "search query"
playwright-cli click e3
playwright-cli dblclick e7
# --submit presses Enter after filling the element
playwright-cli fill e5 "user@example.com"  --submit
playwright-cli drag e2 e8
# drop files or data onto an element (from outside the page)
playwright-cli drop e4 --path=./image.png
playwright-cli drop e4 --data="text/plain=hello world"
playwright-cli hover e4
playwright-cli select e9 "option-value"
playwright-cli upload ./document.pdf
playwright-cli check e12
playwright-cli uncheck e12
playwright-cli snapshot
playwright-cli eval "document.title"
playwright-cli eval "el => el.textContent" e5
# get element id, class, or any attribute not visible in the snapshot
playwright-cli eval "el => el.id" e5
playwright-cli eval "el => el.getAttribute('data-testid')" e5
playwright-cli dialog-accept
playwright-cli dialog-accept "confirmation text"
playwright-cli dialog-dismiss
playwright-cli resize 1920 1080
playwright-cli close
```

### Navigation

```bash
playwright-cli go-back
playwright-cli go-forward
playwright-cli reload
```

### Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli keydown Shift
playwright-cli keyup Shift
```

### Mouse

```bash
playwright-cli mousemove 150 300
playwright-cli mousedown
playwright-cli mousedown right
playwright-cli mouseup
playwright-cli mouseup right
playwright-cli mousewheel 0 100
```

### Save as

```bash
playwright-cli screenshot
playwright-cli screenshot e5
playwright-cli screenshot --filename=page.png
playwright-cli screenshot --full-page    # entire scrollable page
playwright-cli screenshot --hires        # high-DPI capture
playwright-cli pdf --filename=page.pdf
```

### Tabs

```bash
playwright-cli tab-list
playwright-cli tab-new
playwright-cli tab-new https://example.com/page
playwright-cli tab-close
playwright-cli tab-close 2
playwright-cli tab-select 0
```

### Storage

```bash
playwright-cli state-save
playwright-cli state-save auth.json
playwright-cli state-load auth.json

# Cookies
playwright-cli cookie-list
playwright-cli cookie-list --domain=example.com
playwright-cli cookie-get session_id
playwright-cli cookie-set session_id abc123
playwright-cli cookie-set session_id abc123 --domain=example.com --httpOnly --secure
playwright-cli cookie-delete session_id
playwright-cli cookie-clear

# LocalStorage
playwright-cli localstorage-list
playwright-cli localstorage-get theme
playwright-cli localstorage-set theme dark
playwright-cli localstorage-delete theme
playwright-cli localstorage-clear

# SessionStorage
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get step
playwright-cli sessionstorage-set step 3
playwright-cli sessionstorage-delete step
playwright-cli sessionstorage-clear
```

### Network

```bash
playwright-cli route "**/*.jpg" --status=404
playwright-cli route "https://api.example.com/**" --body='{"mock": true}'
playwright-cli route-list
playwright-cli unroute "**/*.jpg"
playwright-cli unroute
```

### DevTools

```bash
playwright-cli console
playwright-cli console warning
playwright-cli requests
playwright-cli request 5
playwright-cli run-code "async page => await page.context().grantPermissions(['geolocation'])"
playwright-cli run-code --filename=script.js
playwright-cli tracing-start
playwright-cli tracing-stop
playwright-cli video-start video.webm
playwright-cli video-chapter "Chapter Title" --description="Details" --duration=2000
playwright-cli video-stop

# annotate each subsequent action (click, type, ...) with a callout naming the action and highlighting the target
playwright-cli video-show-actions --duration=600 --position=top-right
playwright-cli video-hide-actions

# launch the dashboard for UI review / design feedback — user annotates the page, you receive the annotated screenshot, snapshot, and notes
playwright-cli show --annotate

# generate a Playwright locator for an element from its ref or selector
playwright-cli generate-locator e5 --raw

# show a persistent highlight overlay for an element, optionally with a custom style
playwright-cli highlight e5
playwright-cli highlight e5 --style="outline: 3px dashed red"
# hide a single element highlight, or all page highlights when no target is given
playwright-cli highlight e5 --hide
playwright-cli highlight --hide
```

## Raw output

The global `--raw` option strips page status, generated code, and snapshot sections from the output, returning only the result value. Use it to pipe command output into other tools. Commands that don't produce output return nothing.

```bash
playwright-cli --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'
playwright-cli --raw eval "JSON.stringify([...document.querySelectorAll('a')].map(a => a.href))" > links.json
playwright-cli --raw snapshot > before.yml
playwright-cli click e5
playwright-cli --raw snapshot > after.yml
diff before.yml after.yml
TOKEN=$(playwright-cli --raw cookie-get session_id)
playwright-cli --raw localstorage-get theme
```

For structured output wrapping every reply as JSON, pass `--json` instead:

```bash
playwright-cli list --json
```

## Batching commands

The daemon holds the browser open between commands, so the cost of a flow is
dominated by the number of Bash calls, not the work itself. To keep
round-trips low:

- **Chain steps in one Bash call.** `cmd1 ; cmd2 ; cmd3` (continue on errors)
  or `cmd1 && cmd2 && cmd3` (fail-fast, preferred for tests) collapses a
  multi-step flow into a single tool call. The browser stays open between
  steps.
- **Suppress output for setup steps.** `--raw` returns just the result value
  and `>/dev/null` silences the status / snapshot block. Use both freely for
  navigate / resize / `state-load` steps; only read a snapshot when you need
  the structure.
- **Use `run-code --filename=` for branching / async flows.** A single script
  runs loops, conditionals, and waits in one round trip — much cheaper than
  the equivalent chained CLI calls. See
  [references/running-code.md](references/running-code.md).

## When to fall back to `chrome-devtools_*`

`playwright-cli` covers almost all scripted browser work. Reach for the
`chrome-devtools_*` tools only when you need something it can't provide:

- Heap snapshots (memory leak analysis).
- Performance traces at the engine level (Core Web Vitals: LCP, INP, CLS).
- Lighthouse audits.

Both can be used in the same session — `playwright-cli` for interaction,
`chrome-devtools_*` for deeper debugging on the same page.

## Config files

Launch / context options with no CLI equivalent go in a JSON file passed via
`--config=<path>`. If `config.json` is missing, copy from
`example.config.json` (the local copy is gitignored).

## Open parameters
```bash
# Use specific browser when creating session
playwright-cli open --browser=chrome
playwright-cli open --browser=firefox
playwright-cli open --browser=webkit
playwright-cli open --browser=msedge

# Mobile emulation (lighter → smaller snapshots, useful for layout testing)
playwright-cli open --mobile
playwright-cli open --device="iPhone 15"

# Use persistent profile (by default profile is in-memory)
playwright-cli open --persistent
# Use persistent profile with custom directory
playwright-cli open --profile=/path/to/profile

# Connect to browser via Playwright Extension
playwright-cli attach --extension=chrome

# Connect to a running Chrome or Edge by channel name
playwright-cli attach --cdp=chrome
playwright-cli attach --cdp=msedge

# Connect to a running browser via CDP endpoint
playwright-cli attach --cdp=http://localhost:9222

# Start with config file
playwright-cli open --config=my-config.json

# Close the browser
playwright-cli close
# Detach from an attached browser (leaves the external browser running)
playwright-cli -s=msedge detach
# Delete user data for the default session
playwright-cli delete-data
```

## URLs with `&` on Windows

On Windows, `cmd.exe` and PowerShell treat `&` as a command separator, so URLs with multiple query parameters get truncated before `playwright-cli` runs. Escape `&` with `^&` in `cmd.exe`, or use `--%` in PowerShell:

```batch
playwright-cli goto "https://example.com/?a=1^&b=2"
```

```powershell
playwright-cli --% goto "https://example.com/?a=1&b=2"
```

## Snapshots

After each command, playwright-cli writes a compact accessibility-tree snapshot
to a file (e.g. `.playwright-cli/page-<timestamp>.yml`) and prints a pointer
in the output. The DOM is **not** dumped into context — read the file only
when you actually need the structure. Use `--raw` / `>/dev/null` on setup
steps so the pointer doesn't pile up.

```bash
> playwright-cli goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

You can also take a snapshot on demand using `playwright-cli snapshot` command. All the options below can be combined as needed.

```bash
# default - save to a file with timestamp-based name
playwright-cli snapshot

# save to file, use when snapshot is a part of the workflow result
playwright-cli snapshot --filename=after-click.yaml

# snapshot an element instead of the whole page
playwright-cli snapshot "#main"

# limit snapshot depth for efficiency, take a partial snapshot afterwards
playwright-cli snapshot --depth=4
playwright-cli snapshot e34

# include each element's bounding box as [box=x,y,width,height]
playwright-cli snapshot --boxes
```

## Targeting elements

Prefer CSS selectors or Playwright locators — they let you click / fill in one
step without a snapshot read, and they're stable across browser restarts. Refs
from a snapshot are generated fresh each session and don't carry over after the
browser reopens, so reach for refs only when the target is dynamic or unknown.

```bash
# css selector
playwright-cli click "#main > button.submit"

# role locator
playwright-cli click "getByRole('button', { name: 'Submit' })"

# test id
playwright-cli click "getByTestId('submit-button')"

# ref (use when the target is dynamic or unknown)
playwright-cli snapshot
playwright-cli click e15
```

`snapshot` writes an accessibility-tree YAML to a file (zero context tokens until you read it). `screenshot` costs roughly `w*h/750` tokens — about 1.6k for a 1440×900 capture, ~7× more than reading the snapshot. Default to snapshot/refs; only screenshot when you need to *see* rendering (visual bug, canvas, non-accessible UI).

## Timing & auto-wait

Auto-wait behaviour differs by layer — this is the most common source of false
negatives:

- **Inside `run-code`, Playwright auto-waits.** `page.locator(...).click()` /
  `fill()`, `locator.waitFor()`, and `expect(locator)…` wait for the element to
  be present and actionable (default 30s; raise with
  `waitFor({ timeout: ms })` or `page.setDefaultTimeout(ms)`). Use this for
  anything that appears after async work (search results, route transitions,
  post-navigation renders, debounced UI updates).
- **Bare CLI `click` / `fill` / `check` / `select` do NOT wait.** They resolve
  the target against the current page and error immediately
  (`does not match any elements`) if it isn't there yet. Chaining a bare
  `playwright-cli click "#result"` right after a trigger that renders the
  result 2s later will fail.
- **Reads never wait** (`snapshot`, `eval`, `console`, `requests`): they
  reflect the DOM right now. Run them too early and you capture loading /
  stale state.

For async results, prefer `run-code` with an explicit `waitFor()` and
act / branch in one call, or poll the snapshot until the element appears. See
[references/running-code.md](references/running-code.md) for wait patterns.

Other robust waits inside `run-code`:

- `page.waitForResponse(predicate)` — wait for a specific network response (e.g. after a click that triggers XHR/fetch).
- `page.waitForLoadState('networkidle')` — wait until the network is idle.
- `expect(locator).toBeVisible()` — auto-waits and asserts; best for "the result appeared" checks.

## Debugging workflow

After any action, verify what actually happened before drawing conclusions —
the UI may look fine while the underlying state is wrong:

- **Check console first** — `playwright-cli console` surfaces warnings /
  errors that scroll past visually but break behaviour. Run it after each
  non-trivial action.
- **Verify network** — `playwright-cli requests` confirms expected resources
  loaded (200s, correct MIME types) and flags failed / blocked requests. Use
  `playwright-cli request <i>` to inspect one in detail.
- **Check UI state** — `playwright-cli snapshot` for visible structure,
  `playwright-cli eval "…"` for JS-driven state (custom events, framework
  state, Media Session metadata, localStorage values).

These are cheap, fail fast, and catch the silent-failure cases that look like
"nothing happened".

## Browser Sessions

```bash
# create new browser session named "mysession" with persistent profile
playwright-cli -s=mysession open example.com --persistent
# same with manually specified profile directory (use when requested explicitly)
playwright-cli -s=mysession open example.com --profile=/path/to/profile
playwright-cli -s=mysession click e6
playwright-cli -s=mysession close  # stop a named browser
playwright-cli -s=mysession delete-data  # delete user data for persistent session

playwright-cli list
# Close all browsers
playwright-cli close-all
# Forcefully kill all browser processes
playwright-cli kill-all
```

## Installation

If global `playwright-cli` command is not available, try a local version via `npx playwright-cli`:

```bash
npx --no-install playwright-cli --version
```

When local version is available, use `npx playwright-cli` in all commands. Otherwise, install `playwright-cli` as a global command:

```bash
npm install -g @playwright/cli@latest
```

### Version-mismatch banner — ignore it

`playwright-cli --version` may print a box saying the bundled skill
*"does not match the tool version"* and to run `playwright-cli install --skills`.
**Do not run that command** — it would overwrite this customised skill.
The banner is expected and harmless; it does not appear in normal command output.

## Example: Form submission

```bash
playwright-cli open https://example.com/form
playwright-cli snapshot

playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
playwright-cli close
```

## Example: Multi-tab workflow

```bash
playwright-cli open https://example.com
playwright-cli tab-new https://example.com/other
playwright-cli tab-list
playwright-cli tab-select 0
playwright-cli snapshot
playwright-cli close
```

## Example: Debugging with DevTools

```bash
playwright-cli open https://example.com
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli console
playwright-cli requests
playwright-cli close
```

```bash
playwright-cli open https://example.com
playwright-cli tracing-start
playwright-cli click e4
playwright-cli fill e7 "test"
playwright-cli tracing-stop
playwright-cli close
```

## Example: Interactive session

Ask the user for UI review or design feedback. The user draws boxes on the live page and types comments; you receive the annotated screenshot, the snapshot of the marked region, and the user's notes. Use this whenever the user asks for "UI review", "design feedback", or to "ask the user what they think / want / mean":

```bash
playwright-cli open https://example.com
playwright-cli show --annotate
```

## Specific tasks

* **Running and Debugging Playwright tests** [references/playwright-tests.md](references/playwright-tests.md)
* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Spec-driven testing (plan / generate / heal)** [references/spec-driven-testing.md](references/spec-driven-testing.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Test generation** [references/test-generation.md](references/test-generation.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
* **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)
