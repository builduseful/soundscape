# Audio

Rules that must stay true of playback. Read before changing `audio-player.js`,
`playback-output.js`, `media-session.js`, or the playback paths in `script.js`.

Chromecast and AirPlay have their own invariants — see
[`remote-playback/AGENTS.md`](remote-playback/AGENTS.md).

## Two coordinated surfaces

Soundscape intentionally has two playback surfaces: one long-lived
`HTMLAudioElement` for browser-observable playback, and decoded Web Audio
buffers for audible playback.

- The `HTMLAudioElement` exists for platform integration, not sound output or
  visible UI. Browser and OS media controls, notifications, autoplay policy,
  audio focus, and source/preload state all depend on browser-observable media
  plumbing; Web Audio alone is not a reliable substitute. Keep it loaded and
  play/pause it with app state, routed through a gain node set to zero — silent,
  but still "playing" as far as the browser is concerned.
- Audible looping comes from decoded `AudioBufferSourceNode`s. These ambience
  tracks need seamless loop points, and native `HTMLAudioElement.loop` has
  produced audible gaps or discontinuities on short loops.
- **Neither `<audio>` element may cross into the other's job.** `#audioElement`
  goes through `createMediaElementSource`, so it is unusable as a cast transport
  and carries `disableremoteplayback` / `x-webkit-airplay="deny"` — a browser
  offering it as a cast source would hand the user a route the app knows nothing
  about while the decoded buffer kept playing locally. `#remoteTransportElement`
  is the cast transport and must never be passed to `createMediaElementSource`.
  Both halves prevent the same thing: audio in two places at once.

## Playback flow

- Create and resume `AudioContext` from the playback flow, not page load, so
  browser user-gesture policy stays intact.
- Keep the stale-request guards around track changes — the checks that discard
  the result of a track change that has since been superseded. Fetching and
  decoding audio can finish out of order, and an older request must never
  replace newer playback.
- `AudioPlayer` is one implementation of `PlaybackOutput`, not the only one.
  Anything the app does to "the thing that is playing" goes through
  `activeOutput()` in `script.js`. Few paths may reach for the local player by
  name — its media element's own `play`/`pause` events, visibility, the volume
  the app may persist, and the paused-or-none question in `syncPlaybackState` —
  and each says so by asking `isRemoteActive()` first. What makes one of them
  legitimate is that it is *about that element* rather than about whatever is
  making sound; keep any new one to that test. The handover is not among them:
  it is the one place ownership moves, so naming both outputs is its job.
- Re-register Media Session action handlers after every track change. Some
  browsers drop the Media Session association when the long-lived `<audio>`
  element's `src` changes, so refreshing the handlers (and metadata) inside
  `playCurrentTrack` keeps keyboard/earphone controls working across tracks.
- Treat Media Session and Audio Session APIs as progressive enhancements. When
  available, keep metadata, playback state, actions, and decoded-buffer position
  state in sync; when unavailable, playback should still work.

## The loading indicator

Report buffer fetch/decode as a loading state (`AudioPlayer.isLoading()` /
`onLoadingChange`). The title switches the instant a track is picked but the
audio cannot, so on a slow connection there is a real window where the name on
screen is not the sound in the room. Three rules keep the indicator honest, each
with a test behind it:

- It waits out `LOADING_INDICATOR_DELAY_MS` before showing, so a cached track —
  which decodes in milliseconds — never flashes one. That delay must also
  outlast the title change animation, because the `<h1>`'s accessible text only
  settles when the animation ends; `component-contract.test.js` pins the two
  together across `script.js` and `style.css`.
- Skipping again mid-load hands the state to the newer request without reporting
  a stop, so the indicator never blinks between tracks and the delay is not
  re-armed.
- It and `#playbackError` are mutually exclusive. They are the app's only two
  status messages, they sit in the same strip under the title, and a failure
  notice under a live loading bar is both a contradiction and (with reduced
  motion, where the bar becomes text) an overlap.

## Files

- **A track names no file.** A catalog entry is an id and a title;
  `local-source.js` chooses the local encoding for *this browser* and
  `remote-playback/track-source.js` names the cast twin. Local playback prefers
  Ogg Opus and falls back to AAC for Safari/iOS before 18.4, which cannot read
  the Ogg container. The choice is made once per page and may step down exactly
  once, on a confirmed decode failure — safe only because identity is the track
  id and the buffer cache is keyed by resolved URL. Force the fallback with
  `?codec=aac`.
- **The local AAC fallback and the cast twin are both `.m4a` and are not
  interchangeable.** The local one is a single loop period the app crossfades at
  runtime; the cast one has the crossfade baked in and repeats to ~120s. The
  service worker tells them apart by directory, never by extension.
