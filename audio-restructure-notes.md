# Audio resource restructure — implementation plan

> **Status: implemented, shipped as 1.15.0 → 1.17.0.** This file is kept as the
> reasoning behind the change, not as outstanding work. Three things below were
> decided differently once the code met reality, and the text still describes the
> plan rather than the outcome:
>
> - **The fallback is AAC, in `aac/`, not the Opus-in-CAF remux** the evaluation
>   section recommends. CAF remains the better idea on paper — a lossless remux
>   with no padding to trim — but its one open question (does Safari's
>   `decodeAudioData` accept it?) needs a device nobody here has. AAC's
>   decodability on Safari is certain, and its padding problem turned out to be
>   fixable at build time: the encoder added 198–783 samples of trailing filler,
>   landing exactly on the loop seam, so `build-audio.mjs` now frame-aligns the
>   source before encoding. Revisit CAF if a device becomes available.
> - **The fallback is enabled, not held back** pending the device test this plan
>   gates it on. On the browsers it targets the alternative is not a worse loop,
>   it is silence — Ogg Opus fails outright there. What is verified: the files
>   decode, the probe selects correctly, `?codec=aac` forces the path, and the
>   service worker still caches it. What is not: loop quality on real Safari.
> - **The "stable for the page lifetime" / "guarded retry" contradiction** is
>   resolved in `local-source.js` as this file describes, and is now covered by
>   four tests including a superseded-retry case that was a real bug.
> - **The saved-track migration was built and then deliberately removed.** The
>   Saved-track migration section below describes a legacy-URL translation table
>   that shipped in no release: with a single user, a one-time reset to the first
>   soundscape is a smaller cost than carrying translation code and its tests
>   forever. What survives is the requirement that actually mattered — an install
>   from before ids must start cleanly rather than break — kept as one test.
>
> Outstanding: the manual remote-playback device checklist, which cannot be
> automated because it plays audio in someone's room.


## Outcome

Audio assets have one immutable identity and three separately addressed output
roles:

```
src/resources/soundscapes/
  opus/<id>.opus       # local primary: one loop period
  aac/<id>.m4a         # local fallback: one loop period
  cast/<id>.m4a        # remote playback: repeated ~120-second programme
```

The app selects exactly one local variant before loading it. Remote playback
always selects the `cast` variant. A local fallback must never be mistaken for
a cast asset: their loop treatment, cache policy, and consumer differ.

`masters/` is outside `src/`, so it is never deployed. Its binary contents are
gitignored; `masters/README.md` is tracked and records provenance, licence,
loop-point ownership, and how a developer supplies sources. Until the genuine
originals are available, create a clearly labelled, Opus-decoded PCM WAV
placeholder for every track there. It is a temporary production input, not a
recovered original or an audio-quality improvement.

## Non-negotiable invariants

- Every derivative records whether its input is an original master or an
  `opus-decoded-placeholder`. A placeholder must never be represented as a
  recovered original.
- `opus` and local `aac` contain one loop period, no baked loop crossfade, and
  no edge fade. `AudioPlayer` owns the runtime crossfade after decoding.
- `cast` is a different product: it has the runtime crossfade baked in, repeats
  to about 120 seconds, and has a short edge fade. Remote targets do not honour
  local loop bounds or wrap gaplessly.
- Only cast assets bypass the service worker. Local AAC must remain eligible for
  normal runtime caching and offline use.
- The remote transport element must keep receiving a cast URL, and the local
  element must keep receiving the selected local URL. Neither may cross into
  the other's audio role.
- The active-output contract remains unchanged: the application passes a
  canonical track to `activeOutput().startTrack(track)`. Local source selection
  belongs inside `AudioPlayer` (or an equivalent local-only adapter), not in
  `script.js` branches.
- Application-level identity is the canonical `id`. `AudioPlayer.holdsTrack()`
  compares `id`, and its resolved local URL becomes fetch state only — today it
  compares `track.url`, which after local codec selection would be a variant, not
  an identity. Remote providers are the deliberate exception and stay as they
  are: a receiver reports back only a URL, so `loadedUrl === remoteUrlFor(track)`
  is how adoption recognises a session it did not start. That comparison is still
  id-based, because `remoteUrlFor` derives the URL deterministically from the
  `id`. What must not happen is the two outputs answering `holdsTrack` from
  fields that can disagree for the same track.
- Remote playback is not being removed. Its existing detachable-plugin design
  simply requires its assets, resolver, tests, and service-worker exception to
  remain clearly bounded.

## Canonical track identity

Add an explicit immutable `id` to every catalog entry:

```js
{ id: "rain-thunder", title: "Rain & Thunder" }
```

A catalog entry becomes exactly `{ id, title }`. `url` and `mime` both leave it:
`mime` is a property of the selected local variant, so it is returned by
`local-source.js` alongside the URL, and `AudioPlayer.assertTrackSupported()` /
`supportsTrack()` must read it from the resolved source rather than from the
track. `remoteUrlFor()`'s null-guard moves from `track?.url` to `track?.id`, and
its comment about `track.mime` is stale once the field is gone.

`id` is the resource basename, `?track=` value, manifest shortcut target, and
saved preference value.

**The chosen IDs are byte-identical to what `trackSlug()` returns today** for all
eleven tracks — checked, including `"Rain & Thunder"` → `rain-thunder` and
`"The Open Road"` → `the-open-road`. So `?track=` links, the three manifest
shortcuts, and `test/pwa.test.js`'s shortcut assertion all keep working with no
migration and no manifest edit. This is the property that makes phase 1 nearly
risk-free; a test should pin it for the one release in which `trackSlug` still
exists, so a later ID rename cannot silently break a shortcut. It is not derived from `title`: display titles are
editorial text and must be freely renameable without breaking links, storage,
or assets. `trackSlug(track)` becomes the compatibility helper that returns
`track.id`.

Keep catalog entries free of local- and remote-transport URLs. Source resolvers
own those details:

- `local-source.js` returns an `{ url, mime }` local source for a canonical
  track.
- `remote-playback/track-source.js` returns
  `resources/soundscapes/cast/<id>.m4a` for that same canonical track.

This separation is required. The current remote resolver derives an AAC URL
from `track.url`; after local codec selection, that would incorrectly derive
from the local fallback rather than select the dedicated cast derivative.

## Saved-track migration

Replace `soundscape.currentTrackUrl` with an ID-based preference. On the first
release containing this change:

1. Read the new ID key first.
2. When it is absent, map the legacy URL through a fixed legacy-URL-to-ID table.
3. Persist the resolved ID under the new key.
4. Fall back to the first track only for an absent or unknown value.

Do not rely on the existing missing-URL fallback for planned renames: it does
fall back to track 0, but silently loses the listener's selected soundscape.
Keep the legacy map for one release and test every current stored URL against
it. Two loose ends to close explicitly rather than leave to drift:

- **Delete the old key** with `removeItem` once the ID has been persisted, so
  the legacy branch stops being reachable and a stale value cannot resurface if
  the read order is ever changed.
- **Name the release that removes the map and `trackSlug()`.** Both are
  compatibility shims with no other purpose, and a shim with no removal date is
  permanent. The natural point is the release after phase 2, once a launch has
  provably rewritten the preference; record that in the notes when it ships.

## Playback-output port surface

`AudioPlayer` currently overloads `this.currentTrackUrl` for three separate jobs:
`hasTrack()` (is anything loaded), `getTrackUrl()`, and `holdsTrack()`
(identity). Splitting local selection means splitting the field:
`currentTrackId` answers the first and third, and the resolved URL is kept
separately for `shouldLoadMediaElement`, the `audioElement.src` assignment, and
the buffer-cache key.

`getTrackUrl()` needs no decision at all — checked, and an earlier draft of
these notes had it wrong. It is **not** in `PLAYBACK_OUTPUT_MEMBERS`
(`playback-output.js:93`); it belongs to `REMOTE_PROVIDER_MEMBERS`
(`remote-playback/index.js:94`), and `AudioPlayer`'s copy is local-only with a
single caller in `test/audio-player.test.js`. `holdsTrack`'s own comment already
says so: it is "the reason getTrackUrl() is not one". So the local method simply
keeps returning the resolved local URL as fetch state, and identity moves to
`holdsTrack`. Nothing renames.

`test/playback-output-contract.test.js` (around lines 213–217) carries a comment
stating that the local player compares `track.url` while the remotes compare the
derived twin. That comment becomes wrong in phase 1 and must be rewritten. The
assertions themselves should still pass unchanged, which is the point — but
"passes unchanged" is not the same as "needs no edit."

## Local source selection

At `AudioPlayer` construction, probe the element once with exact MIME strings:

```js
audio/ogg; codecs=opus
audio/mp4; codecs=mp4a.40.2
```

Select Opus when it is reported playable; otherwise select the local fallback
when that is reported playable.

**Two rules in this section contradict each other as first written**, and the
resolution matters. "Stable for the page lifetime" and "a guarded retry from an
Opus decode failure, cached for the session" cannot both be absolute: the retry
*is* a mid-life change to the resolver's answer. State the reconciled rule
instead — the resolver's answer changes at most once per page, on a confirmed
decode failure, and that is safe only because of two facts established
elsewhere in this plan:

- The buffer cache is keyed by **resolved URL**, so the pre-flip and post-flip
  variants occupy separate entries and neither is served for the other.
- `holdsTrack()` compares **`id`**, so a track being re-resolved to a different
  variant is still the same track, and the flip cannot desynchronise identity,
  handover, or the media-session metadata.

Without both, the flip would be a bug. With both, it is merely a second fetch.

`canPlayType()` is only a capability hint; actual playback is established by
`decodeAudioData()`. Preserve the current diagnostic behavior for an unknown
codec, and define a single, guarded retry from an Opus *decode* failure to AAC.
Do not retry on fetch, HTTP, or cancellation failures. Cache a confirmed
codec-decode failure for the session so every track change does not reattempt
the same unsupported format.

### Evaluate Opus-in-CAF before committing to AAC

The fallback exists for Safari and iOS before 18.4, which cannot read *Ogg*
Opus. That is a container limitation, not a codec one: Safari has carried Opus
in the CAF container for far longer. If `decodeAudioData()` accepts it, CAF is
the better fallback on every axis that matters here, and the plan should try it
before spending effort on AAC.

Verified locally with the ffmpeg already required by this pipeline:

```sh
ffmpeg -i rain_loopable.opus -c:a copy rain_loopable.caf
```

It is a pure **remux** — `-c:a copy`, no re-encode. The output probes as
`codec_name=opus, 48000 Hz, mono`, identical duration, and costs 359 bytes of
container overhead on a 108 kB file. That yields three advantages AAC cannot
match:

- **No second lossy generation.** The AAC path re-encodes an already-lossy Opus
  source, which the plan elsewhere is careful to avoid. The remux carries the
  exact same bitstream.
- **No encoder delay or end padding**, so the whole class of loop-seam risk the
  AAC section warns about does not arise. `applyLoopCrossfade` receives the same
  decoded samples it receives from the Ogg file.
- **No build step and no provenance branch.** The fallback is a container swap
  of the published primary, so it cannot drift from it and needs no separate
  manifest entry beyond recording that it is a remux.

**This is unverified on device and must not be assumed.** The single open
question is whether Safari's `decodeAudioData()` accepts CAF-wrapped Opus, as
distinct from its `<audio>` element doing so; expect `canPlayType()` to be
unhelpful here, which the section above already anticipates. Test that first,
on the oldest target available. If it fails, fall back to AAC as originally
planned — and then validate that `decodeAudioData()` yields a seamless loop
window, because AAC encoder delay and end padding are material and an M4A that
plays in an `audio` element is not by itself proof its decoded `AudioBuffer`
loops correctly.

Because the winner is undecided, **the fallback directory must not be named
`aac/` until it is.** The Outcome block above hardcodes that name; treat it as
provisional and settle it in phase 4, when the probe target is known. The other
two directories are named for what they are and do not move.

## Service worker

Replace the extension test with a directory-boundary test:

```js
pathname.startsWith("/resources/soundscapes/cast/")
```

Name it `isRemotePlaybackAsset`. Note that a leading-slash `startsWith` assumes
the app is deployed at the site root — true for Pages and for the local
container, but the old extension test carried no such assumption. Either derive
the prefix from `registration.scope` or match on `.includes(
"/resources/soundscapes/cast/")`, and state which was chosen and why. Only that
path returns from the fetch handler without `respondWith`; `opus/` and `aac/` continue through the normal range and
cache logic. Add tests that prove both halves, including that a local `.m4a`
does not bypass the worker.

`test/pwa.test.js`'s precache filter (`startsWith("./resources/soundscapes/")`)
keeps working across the new subdirectories unchanged — no edit needed, and no
one should "fix" it into a per-directory list.

Audio remains excluded from install precaching. The local variants are cached
on demand, as they are today; cast variants remain network-dependent because
handling their range requests would require full-file worker reads.

## Asset migration

Use the following IDs, preserving the current title order:

```
rain
garden-rain
heavy-rain
rain-thunder
heavy-thunderstorm
fireplace
deep-fireplace
the-open-road
brown-noise
pink-noise
white-noise
```

First move the existing Opus files into `opus/` and existing cast M4A files
into `cast/`, renaming both to the IDs above. This is a path-only migration: it
must not re-encode audio. Update both resolvers, catalog tests, remote asset
tests, the service-worker test, and the legacy-storage map in the same release.

This is a single-user breaking path migration: no legacy asset support window
is required. An already-open old app shell can still ask for the old paths, so
close or reload it after the deployment. The ID-based preference migration
preserves the selected soundscape on the first load of the new release.

## Documentation to update

These describe the current layout in prose and go stale in the same release that
moves the files. None is optional:

- `AGENTS.md` project-structure tree (the `soundscapes/` line), and its
  `npm run cast-audio` reference under Manifest Screenshots and Icons.
- `src/js/remote-playback/README.md`: the service-worker bullet naming the
  extension-based exemption and `resources/soundscapes/`, and any
  `build-cast-audio.mjs` reference.
- `src/js/tracks.js` and `src/js/remote-playback/track-source.js` header
  comments, both of which describe twins derived by basename from the Opus
  original.
- `.gitignore` gains the `masters/` binaries exception (ignore the directory's
  contents, keep `masters/README.md` tracked).
- `src/sw.js`'s own comment block above `isRemoteAudio`, which explains the
  suffix check by hand.

## Build tooling and provenance

Replace `scripts/build-cast-audio.mjs` with `scripts/build-audio.mjs`:

```
npm run audio -- --opus
npm run audio -- --aac
npm run audio -- --cast
npm run audio                 # all applicable targets
```

The script accepts an explicit masters directory (with a documented default),
checks `ffmpeg`/`ffprobe` up front, builds to a temporary file, and retains the
existing byte-identical write skip. It imports `applyLoopCrossfade` for the cast
transform so cast and runtime loop treatment cannot drift.

Store a tracked build manifest outside `src/` — `masters/build-manifest.json`,
beside the README that documents the inputs it describes, so the provenance
record and the provenance prose stay together and neither is deployed. For every derivative it records
the canonical ID, input provenance (`master` or `opus-decoded-placeholder`),
input SHA-256, output SHA-256, transform parameters, and encoder version. It
is a provenance record and an optional verification aid when a developer has
the corresponding input; it cannot make a build reproducible on a clone
without externally held masters.

While a placeholder is the only input, retain the current Opus bitstream as the
published primary rather than decode and re-encode it. Build AAC derivatives
from the placeholder only when needed, and label them accordingly. This avoids
an unnecessary second lossy Opus generation; it does not make the AAC fallback
an audio-quality upgrade. Once a genuine master arrives, it replaces the
placeholder and becomes the shared input for every newly generated derivative.

### Production audio profile

All newly generated Opus and AAC outputs are 48 kHz mono. Use Ogg Opus for the
local primary and AAC-LC in MP4 for AAC outputs. Do not automatically downmix a
stereo original: that changes its spatial content. A genuine master must
already be mono, loop-ready, and free of clipping before it enters this build;
reject a source that is not.

Likewise, do not apply automatic loudness normalisation. A gain change can be
technically clean when it never clips, but choosing comparable perceived
loudness for rain, noise, and fire is an editorial decision rather than a safe
encoder default. Set that level when preparing the original, and record it in
the source documentation. The exact encoder bitrate remains a listening-test
decision; the existing Opus files stay bit-for-bit unchanged until real masters
are supplied.

The three noise sources may eventually be generated rather than stored as WAV,
but only from a deterministic generator with a fixed algorithm version, seed,
sample rate, duration, and filter initial state. Record those parameters in the
manifest as their source provenance.

## Tests required per phase

- Catalog IDs are non-empty, URL-safe, and unique; titles remain unique for UI.
- Every catalog ID has exactly the expected local Opus and cast asset; add local
  AAC to that inventory when the fallback ships. There are no orphaned files.
- Local resolver selection is deterministic and uses the intended MIME probes.
- Remote resolver always produces a `cast/` URL and never returns a local
  source.
- Saved URL migration preserves every current track selection; unknown storage
  still falls back safely.
- Service-worker tests distinguish cast M4A from local M4A, and cover a
   non-root scope if the prefix check is written scope-relative.
- The flat `resources/soundscapes/` directory is left empty after the move — a
  stray unreferenced file there is exactly what the old orphan tests caught, and
  the new per-directory inventories would not see it.
- For the one release in which both exist, `trackSlug(track) === track.id`, so
  the manifest shortcuts and `?track=` links provably survive.
- The existing playback-output contract, stale-request tests, gapless-loop
  tests, and real-device remote-playback checklist continue to pass unchanged.

## Delivery order

1. Add immutable IDs, ID-based saved-track migration, and tests while leaving
   existing files and URLs in place. Entries are `{ id, title, url, mime }` for
   the length of phase 1 only, so `tracks.test.js`'s exact-key assertion is
   edited twice — once here, once in phase 2 when `url` and `mime` move to the
   resolvers.

   That double edit is the right trade, and an earlier draft of these notes
   leaned the other way. Moving `url`/`mime` out in phase 1, while the files are
   still flat and irregularly named, would force **both** resolvers to carry an
   id-to-legacy-basename map that phase 2 immediately deletes. One assertion
   edited twice is cheaper than the same throwaway map duplicated across
   `local-source.js` and `track-source.js`.
2. Move and rename existing Opus and cast assets into their role directories;
   update resolvers and make the service-worker exemption path-based. Bump the
   version and run the remote-playback unit suite plus its manual device
   checklist.
3. Add provenance documentation, the external-master input contract, and the
   unified build script. Generate and record the Opus-decoded placeholders,
   while retaining the existing Opus files as the published local primary.
4. Produce local AAC assets and enable the resolver only after decoded-buffer
   loop testing on the intended older Safari/iOS targets. Add a developer
   override — a `localStorage` key or `?codec=aac` param consulted once at
   resolver construction — before that testing, because on every browser this
   project is developed in the probe selects Opus and the AAC path is otherwise
   unreachable by hand. The override must not defeat the stability rule: it is
   read once, at construction, like the probe itself.

Every step touching `src/` requires the normal three-way version bump in
`package.json`, `src/sw.js`, and `src/js/script.js`.

## External prerequisites

- When genuine originals are supplied, prepare them as loop-ready, unclipped
  48 kHz mono PCM WAV files and replace their corresponding placeholders.
- No automatic stereo-to-mono conversion is permitted; a future stereo original
  requires an explicit artistic downmix before it can enter this pipeline.
- Run the existing manual remote-playback device checklist after the cast-path
  move; automated tests must not cast to a real device.
