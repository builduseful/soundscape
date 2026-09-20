# Generators

`npm run audio`, `npm run screenshots` and `npm run icons` regenerate committed
artefacts. All three are **host-only** — not part of `npm test` or the Docker
image — and all three skip writing when the output is unchanged. See each
script's header for how it works.

| Script | Produces | Needs |
|---|---|---|
| `npm run audio` | `src/resources/soundscapes/{opus,aac,cast}/` | `ffmpeg`, and the inputs in [`../masters/`](../masters/AGENTS.md) |
| `npm run icons` | `src/resources/icons/*.png` | Playwright |
| `npm run screenshots` | `src/resources/screenshots/*.png` | Playwright |

- `npm run audio` builds all three roles; `-- --opus`, `-- --aac`, `-- --cast`
  narrow it.
- Re-run `icons` / `screenshots` after a change that affects the home page's
  appearance or either icon SVG.
- **Keep what a script produces; never revert it.** Stale is the only failure
  mode here, and the byte-identical skip means a routine run costs nothing.

## Screenshots

**No remote playback control appears in them, deliberately.** The capture
browser brands itself `Chromium`, which both capability checks refuse, so the
control removes itself — and an install screenshot showing what every visitor
gets beats one showing a button only some browsers offer. Do not force it into
frame.

Screenshots are excluded from the service worker precache; icons are not. See
[`../src/AGENTS.md`](../src/AGENTS.md).
