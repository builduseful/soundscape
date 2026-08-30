# Masters

The inputs `scripts/build-audio.mjs` reads. Everything the app ships is derived
from what lives here; nothing here is ever deployed.

`masters/` sits outside `src/`, so it is not in the deploy folder, not in the
service worker precache, and not in the Docker image.

## What is tracked, and what is not

| Path | Tracked? | Why |
|---|---|---|
| `README.md` | yes | This file. |
| `provenance.json` | yes | What each master *is*, and its hash. |
| `build-manifest.json` | yes | What was built from what. |
| `*.wav` | **no** | Master audio. Large, and not all of it is ours to redistribute. |

The bytes are gitignored but the records are not, which is the whole design: a
fresh clone can always read what an input was claimed to be, and anyone actually
holding the file can have that claim checked against a hash.

The consequence to accept: **a clone cannot reproduce a build.** It can verify
one, given the inputs. That is a property of holding masters outside the repo,
not something the manifest can fix.

## Placeholders

Until the genuine originals are available, every master here is a
**`opus-decoded-placeholder`**: PCM decoded straight back out of the published
Opus file.

```sh
npm run audio -- --placeholders
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
`provenance.json`. Master bytes are not tracked, so losing one to a routine
re-run would be unrecoverable from this repo.

## Supplying a real master

1. Prepare the file **finished**: 48 kHz mono PCM WAV, loop-ready, unclipped,
   and at the level you want it heard at relative to the other soundscapes.
2. Save it as `masters/<track-id>.wav`, using the id from `src/js/tracks.js`.
3. Update its entry in `provenance.json` — `"kind": "master"` and the file's
   SHA-256. The build refuses to run on a hash that disagrees with the file,
   because every derivative built past that point would carry a provenance
   record that is simply untrue.
4. Rebuild: `npm run audio`.

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
