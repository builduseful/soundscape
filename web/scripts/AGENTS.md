# Generators

`npm run icons`, `npm run screenshots` and `npm run layout`, run from `web/`,
regenerate committed artefacts. All are **host-only** — not part of `npm test`
or the Docker image — and all skip writing when the output is unchanged. See each script's header
for how it works. The audio build is at the repository root:
[`../../scripts/AGENTS.md`](../../scripts/AGENTS.md).

| Script | Produces | Needs |
|---|---|---|
| `npm run icons` | `src/resources/icons/*.png` | Playwright |
| `npm run screenshots` | `src/resources/screenshots/*.png` | Playwright |
| `npm run layout` | `../shared/fixtures/layout.json`, which the other platforms' layout tests hold to | Playwright |

- Re-run them after a change that affects the home page's appearance or either
  icon SVG; `npm run layout` after any change that moves something on the page.
- **Keep what a script produces; never revert it.** Stale is the only failure
  mode here, and the byte-identical skip means a routine run costs nothing.
- `npm run parity` is not a generator either: it writes untracked screenshots to
  `../../.temp/parity/web/` for the parity report
  (`node scripts/parity-report.mjs` at the repository root).
- `send-media-key.ps1` is a test aid, not a generator:
  [`../tests/AGENTS.md`](../tests/AGENTS.md) says how to use it.

## Screenshots

Screenshots are excluded from the service worker precache; icons are not. See
[`../src/AGENTS.md`](../src/AGENTS.md).
