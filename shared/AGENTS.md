# Shared contract

What every platform must agree on, kept as data so that each platform checks
itself against this rather than against another platform's code. Platforms
share this and the audio, and nothing else: there is no shared code.

| File | Holds |
|---|---|
| `catalog.json` | The soundscapes: `id` and `title`, in display order; and the ids offered as app shortcuts, in order (on Android, those not yet ordered by listening) |
| `design-tokens.json` | Colours (light and dark), shadows, sizes, type, durations, the volume control's steps, the gestures' thresholds, motion |
| `copy.json` | Every string more than one platform shows |
| `fixtures/loop-crossfade.json` | Golden input and output for the loop crossfade |
| `fixtures/layout.json` | Where each part of the page sits in the web app, per window size; written by `web/scripts/capture-layout.mjs` (`npm run layout`) |

## Rules

- **A change here lands on every platform in the same pull request.** Each
  platform has a test that fails until it matches, so a half-made change cannot
  pass CI.
- **The web app is where a value is designed**, by looking at it in a browser.
  Change it there and here together; other platforms follow.
- **Platform-neutral only.** No CSS selectors, file paths or resource names:
  where a value lives in a platform's code is that platform's test's business.
  Units are CSS pixels, which are dp on Android and points on iOS; type sizes are
  the same unit (sp on Android), with the web's `rem` at 16. A size ending in
  `Chars` counts the font's zeros (CSS `ch`); `letterSpacing` is in `em`. Durations are in
  milliseconds; easings are cubic-bézier control points.
- **A string only one platform shows stays out of `copy.json`.** The web's
  "Install app" and its offline error have no Android counterpart: the app is
  not installed from a page, and its audio is bundled. `{title}` in a string is
  the track title.
- **`id` is permanent.** It names the saved preference, the `?track=` link and
  the audio file on every platform; renaming one breaks all of them. Titles may
  change freely.

## The loop crossfade

The web builds its loop this way as it decodes, and the fixture holds it to the
formula. Android adds nothing: its masters are finished loops, and the
placeholders were made with the web's own function (`masters/AGENTS.md`).
For a buffer of `length` samples per channel at `sampleRate`:

```
overlap    = min(max(1, round(crossfadeMs × sampleRate / 1000)), floor(length / 2))
loopLength = length − overlap
out[i]     = src[loopLength + i] × cos(t·π/2) + src[i] × sin(t·π/2),  t = i / overlap,  for i < overlap
out[i]     = src[i]                                                    otherwise
```

and the loop plays `[0, loopLength)`. The fixture's expected values were
computed from this formula in double precision, not taken from any platform's
output; compare within its `tolerance`. Changing the formula means changing it
in `scripts/generate-loop-crossfade-fixture.mjs` too, re-running that, and saying
why in the commit.

## Who reads what

- **Web:** `web/tests/shared-contract.test.js` checks the web code against all
  four files.
- **Audio build:** `scripts/build-audio.mjs` reads `catalog.json` to know which
  soundscapes to build.
- **Android** (being built; see `docs/native-apps-plan.md`): generates Kotlin
  and resources from these files at build time, and tests the result against
  them; its instrumented tests read `layout.json`.
