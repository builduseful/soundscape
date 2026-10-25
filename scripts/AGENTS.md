# Repo-wide generators

`node scripts/build-audio.mjs`, run from the repository root, builds every
published soundscape from the masters into
`web/src/resources/soundscapes/{opus,aac}/`. That folder is the one copy of the
audio: the web app serves it and every other platform reads it from there. It
is **host-only** (not part of any test suite or container image), needs
`ffmpeg` and the inputs in [`../masters/`](../masters/AGENTS.md), and skips
writing when the output is unchanged. The script's header says how it works.

- With no flags it builds both roles; `--opus` and `--aac` narrow it.
- **Keep what it produces; never revert it.** Stale is the only failure mode
  here, and the byte-identical skip means a routine run costs nothing.
- New audio under `web/src/` is a deployed change, so it needs a web version
  bump: see [`../web/src/AGENTS.md`](../web/src/AGENTS.md).

`node scripts/generate-loop-crossfade-fixture.mjs` rewrites
`shared/fixtures/loop-crossfade.json` from the formula in
[`../shared/AGENTS.md`](../shared/AGENTS.md); it needs nothing but Node.

`node scripts/parity-report.mjs` screenshots the web and Android screens in
every window of `shared/fixtures/layout.json`, light and dark, and writes
`.temp/parity/report.html`: each pair side by side with a pixel diff. Advisory
and untracked — `LayoutParityTest` gates where things sit; this is for a person
to look over after a change to how either looks. It runs
`web/scripts/capture-parity.mjs` and `android/scripts/capture-parity.mjs`, so
it needs Playwright and an emulator; `--no-capture` rebuilds the report from
the last capture.

The web app's own generators (icons, screenshots) are in
[`../web/scripts/AGENTS.md`](../web/scripts/AGENTS.md).
