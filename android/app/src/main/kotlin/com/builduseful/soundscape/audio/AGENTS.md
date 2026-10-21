# Audio

Gapless looping is the product. The rules below are what keep it gapless on
every API level in the matrix; each was found the hard way on an emulator.

## The asset: Opus, the web's own bytes

- The app bundles `../web/src/resources/soundscapes/opus/` and nothing else;
  the AAC folder is excluded in `app/build.gradle.kts`.
- **The extractor ignores the Ogg end trim.** It honours Opus pre-skip, but
  hands back the encoder's padding at the end. The true length is the last
  page's granule minus pre-skip (`oggOpusFrameCount` in `core`); the decoder
  sizes its buffer to that and stops there.
- **AAC is not gapless here, and cannot be made so cleanly**: API 26 ignores
  the edit list and leaves 1,024 priming samples at the head; API 37 drops
  16–32 samples from the tail. Do not switch to it.
- **Keep the encoder's 20 ms packets.** Decoding costs a round trip to the
  media process per packet, and 60 ms packets would cut that to a third — but
  API 26's Ogg extractor reads no packets at all from such a file.
- `AssetDecoderTest` decodes every bundled file and holds it, sample for
  sample, to `shared/fixtures/decoded-audio.json` (ffmpeg's decode). It must
  pass on every level in the matrix.

## The PCM

- **16-bit, interleaved, one exactly sized buffer per track.** Float doubles
  it, which the API 29 image, on a boot that gave apps 16 MB, could not hold.
- The loop crossfade is applied once, in place (`loopCrossfadeInPlace`);
  `LoopReader` then plays `[0, loopEnd)` forever. Both live in `core` and are
  tested on the JVM against the shared fixture.

## The engine

`LoopingAudioEngine` implements `core`'s `AudioEngine` port; the mixing it
does — the loop, and the 250 ms equal-power change between tracks — is
`LoopMixer` in `core`, tested on the JVM. Here is only threads and the output.

- **Three threads, one job each.** The main thread makes every call and gets
  every callback. One decode thread loads one track at a time, and a newer load
  cancels an older one mid-decode, so fast skipping costs nothing. It decodes
  with MediaCodec's asynchronous mode (callbacks on that thread's looper):
  polling the codec in the synchronous mode took up to twice as long. One render
  thread owns the AudioTrack.
- **The render thread alone pauses, flushes and starts the AudioTrack**, and
  only between its own writes, so a blocking `write()` never waits on a paused
  track. While paused it waits on a condition: nothing wakes, nothing runs.
- **One mono AudioTrack for the engine's life**, about a tenth of a second of
  buffer, fed in 20 ms chunks. A skip is heard within that tenth.
- **Fill the buffer before `play()`.** Starting on an empty buffer counts an
  underrun on API 26, and is an audible gap anywhere.
- **Flush on pause**, so a track changed while paused does not begin with the
  old one's last tenth of a second. API 29 counts that pause as one underrun;
  nothing is missing from what is heard, so the tests check playing time only.
- **Volume is `AudioTrack.setVolume`**, applied by the system mixer as audio
  leaves the buffer: heard at once and ramped there. Mixing it into the PCM
  would delay it by the buffer. The web ramps over 250 ms (`volumeRamp`).
- **No decode cache.** At most three tracks are held: the one playing, one
  fading out, and one decoding — 18 MB with the two longest. Pausing ends a
  fade, so its audio is let go.

`LoopingAudioEngineTest` plays through changes and pauses with no underrun,
holds superseded loads to never winning, and reaches the worst case for memory;
`AudioBudgetTest` holds a decode's heap and the render thread's CPU, playing
and paused, to their budgets (see `android/AGENTS.md`).
