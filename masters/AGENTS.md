# Masters

Every soundscape's master: the one source of its audio. The web's Opus and AAC
are built from it by `scripts/build-audio.mjs`; the Android app bundles it as it
is (`BundleLoops`, in `android/build-logic/`), so a master is a finished loop.

`masters/` sits outside `web/src/`, so it is not in the deploy folder, not in the
service worker precache, and not in the Docker image.

## What is tracked, and what is not

| Path | Tracked? | Why |
|---|---|---|
| `AGENTS.md` | yes | This file. |
| `provenance.json` | yes | What each master *is*, and its hash. |
| `build-manifest.json` | yes | What was built from what. |
| `*.wav` | yes | The master audio. Android ships it, so a clone must hold it. |

Every master here is ours to publish: recorded by the maintainer or licensed for
it. One that is not cannot be added, since git and the APK both hand it out.

## Placeholders

Until the genuine originals are available, every master here is a
**`opus-decoded-placeholder`**: PCM decoded back out of the published Opus file
and made a finished loop with the web's own crossfade (`applyLoopCrossfade`),
so the app loops as the web does.

```sh
node scripts/build-audio.mjs --placeholders
```

A placeholder is a *production input*, not a recovered original and not an
audio-quality improvement. Decoding a lossy file to PCM restores nothing the
encoder discarded. It exists so the pipeline has one shape whether or not the
originals have turned up, and so the day they do is a file swap rather than a
rewrite.

Two rules keep that honest, and both are enforced in code:

- Every derivative records its input's provenance in `build-manifest.json`. A
  placeholder is never recorded as a master.
- `--opus` **refuses to run** against a placeholder. The placeholder was decoded
  from the published Opus, so re-encoding it would spend a second lossy
  generation to arrive back where it started, fractionally worse. The published
  bitstream stays exactly as it is until a real master exists.

`--placeholders` will not overwrite a master declared as `master` in
`provenance.json`.

## Supplying a real master

1. Prepare the file **finished**: 48 kHz mono 16-bit PCM WAV, unclipped, and at
   the level you want it heard at relative to the other soundscapes.
   **Loop-ready**: exactly one loop, its last sample running straight into its
   first, since the app wraps from one to the other and adds nothing.
   **No metadata**: only the `fmt` and `data` chunks, since tags are shipped
   with the file (export with `-map_metadata -1 -fflags +bitexact`).
2. Save it as `masters/<track-id>.wav`, using the id from `shared/catalog.json`.
3. Update its entry in `provenance.json` — `"kind": "master"` and the file's
   SHA-256. The build refuses to run on a hash that disagrees with the file,
   because every derivative built past that point would carry a provenance
   record that is simply untrue.
4. Rebuild: `node scripts/build-audio.mjs`. The Android build picks it up as
   it is; `MastersTest` in `android/core` fails on a master with a step at its
   seam, or with anything in it but 48 kHz mono 16-bit samples.

### What the build will not do for you

- **No automatic stereo-to-mono downmix.** A downmix changes the spatial content
  of a recording. That is an artistic decision, and it belongs to whoever
  prepares the master. A stereo source is rejected, not converted.
- **No loudness normalisation.** A gain change can be technically clean and still
  be wrong: choosing comparable perceived loudness across rain, fire and noise
  is an editorial judgement, not an encoder default. Set the level when you
  prepare the master, and note it below.
- **No repair of clipping or of a bad loop point.** Both need ears.

The three noise sources may eventually be generated rather than stored. If they
are, the generator needs a fixed algorithm version, seed, sample rate, duration
and filter initial state, all recorded in `provenance.json` as their source —
otherwise "generated" is not a provenance, it is a guess.

## Source notes

One entry per master, added when a real one replaces a placeholder. Record what
a hash cannot: where it came from, what licence it carries, who set its level,
and where its loop point was chosen.

_(None yet — every master is currently a placeholder.)_
