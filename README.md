## Testing

Run the dependency-free test suite with:

```sh
node --test
```

`npm test` runs the same command when npm is available. The tests use Node's built-in test runner with fakes for the browser audio and media-session APIs.

## Audio Architecture

Soundscape intentionally keeps one long-lived `HTMLAudioElement` as the browser-visible media surface for source loading, Media Session state, OS controls, audio focus, and autoplay policy. The element uses `preload="auto"`, receives direct `src` swaps followed by `load()`, and is kept in sync with the app's play/pause state.

The audible transport is intentionally different from the usual native-media recommendation: tracks are fetched, decoded into `AudioBuffer`s, and looped with `AudioBufferSourceNode`. That is a deliberate product tradeoff because the app requires perfect loop points for short ambience files, and native `HTMLAudioElement.loop` has been close but not exact enough in practice. The media element is still present and playing through a zero-gain path so browser and OS media plumbing can see active playback while Web Audio provides the sample-accurate loop.

Media Session support is progressive: the app publishes metadata, registers only the supported play/pause/previous/next actions, keeps `playbackState` synchronized from real media events, and clears position state because an endless ambience loop should not expose a wrapping progress bar. The Audio Session API is also treated as a progressive enhancement and is set to `playback` when available.
