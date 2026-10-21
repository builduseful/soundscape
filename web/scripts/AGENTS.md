# Generators

`npm run icons` and `npm run screenshots`, run from `web/`, regenerate committed
artefacts. Both are **host-only** — not part of `npm test` or the Docker image
— and both skip writing when the output is unchanged. See each script's header
for how it works. The audio build is at the repository root:
[`../../scripts/AGENTS.md`](../../scripts/AGENTS.md).

| Script | Produces | Needs |
|---|---|---|
| `npm run icons` | `src/resources/icons/*.png` | Playwright |
| `npm run screenshots` | `src/resources/screenshots/*.png` | Playwright |

- Re-run them after a change that affects the home page's appearance or either
  icon SVG.
- **Keep what a script produces; never revert it.** Stale is the only failure
  mode here, and the byte-identical skip means a routine run costs nothing.
- `send-media-key.ps1` is a test aid, not a generator:
  [`../tests/AGENTS.md`](../tests/AGENTS.md) says how to use it.

## Screenshots

Screenshots are excluded from the service worker precache; icons are not. See
[`../src/AGENTS.md`](../src/AGENTS.md).
