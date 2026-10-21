# Generators

`npm run audio`, `npm run screenshots` and `npm run icons` regenerate committed
artefacts. All three are **host-only** — not part of `npm test` or the Docker
image — and all three skip writing when the output is unchanged. See each
script's header for how it works.

| Script | Produces | Needs |
|---|---|---|
| `npm run audio` | `src/resources/soundscapes/{opus,aac}/` | `ffmpeg`, and the inputs in [`../masters/`](../masters/AGENTS.md) |
| `npm run icons` | `src/resources/icons/*.png` | Playwright |
| `npm run screenshots` | `src/resources/screenshots/*.png` | Playwright |

- `npm run audio` builds both roles; `-- --opus` and `-- --aac` narrow it.
- Re-run `icons` / `screenshots` after a change that affects the home page's
  appearance or either icon SVG.
- **Keep what a script produces; never revert it.** Stale is the only failure
  mode here, and the byte-identical skip means a routine run costs nothing.

## Screenshots

Screenshots are excluded from the service worker precache; icons are not. See
[`../src/AGENTS.md`](../src/AGENTS.md).
