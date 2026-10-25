# Audio

Gapless looping is the product. The rules below are what keep it gapless on
every API level in the matrix.

## The asset: a finished loop, as 16-bit PCM

- **Each track is its master, as it is: one WAV, 48 kHz mono 16-bit, that is
  exactly one loop.** Its end runs straight into its start: the seam is made in
  the audio, before it reaches the app, so the engine only wraps. The web's
  runtime crossfade does not run here. `BundleLoops` copies each master to
  `soundscapes/<id>.wav`, and `MastersTest` in `core` holds every one to a
  clean seam and to nothing but its samples (`masters/AGENTS.md`).
- **No decoder.** The web ships Opus for size; the app ships PCM so that a
  load is a file mapped, not seconds of MediaCodec work, and no codec quirk
  (pre-skip, end trim, priming, a decoder that fails part-way) can reach the
  seam. The cost is size: about 35 MB in the APK.
- **Stored uncompressed** (`noCompress` in `app/build.gradle.kts`), so it can be
  mapped where it lies in the APK.

## The PCM

- **Mapped, not read** (`mapLoop`): nothing is copied onto the heap, the system
  pages the samples in as they play and can drop them again. A load keeps next
  to nothing on the heap, which `AudioBudgetTest` holds it to.
- `readWavLayout` in `core` finds the samples and refuses anything but 16-bit
  integer PCM: the output plays them as they lie. `LoopReader` plays the whole
  buffer and wraps. Both are tested on the JVM.

## The engine

`LoopingAudioEngine` implements `core`'s `AudioEngine` port; the mixing it
does — the 250 ms equal-power change between tracks — is `LoopMixer` in
`core`, tested on the JVM. Here is only the output and its thread.

- **Two threads.** The main thread makes every call, loads every track and
  gets every callback; a load is posted to its next turn, as the port promises,
  so of two loads in one turn only the later is applied. One render thread owns
  the AudioTrack.
- **The render thread alone pauses, flushes and starts the AudioTrack**, and
  only between its own writes, so a blocking `write()` never waits on a paused
  track. While paused it waits on a condition: nothing wakes, nothing runs.
- **One mono AudioTrack for the engine's life**, about a quarter of a second of
  buffer, fed in 100 ms chunks. The thread wakes only when a whole chunk fits,
  about 6 times a second (`AudioBudgetTest`); a skip is heard within that
  quarter.
- **Fill the buffer before `play()`.** Starting on an empty buffer counts an
  underrun on API 26, and is an audible gap anywhere.
- **Flush on pause**, so a track changed while paused does not begin with the
  old one's last quarter of a second. API 29 counts that pause as one underrun;
  nothing is missing from what is heard, so the tests check playing time only.
- **Volume is `AudioTrack.setVolume`**, applied by the system mixer as audio
  leaves the buffer: heard at once and ramped there. Mixing it into the PCM
  would delay it by the buffer. The web ramps over 250 ms (`volumeRamp`).
- **No cache.** At most two tracks are mapped at once, the one playing and one
  fading out. Pausing ends a fade, so its mapping is let go.

`LoopingAudioEngineTest` plays through changes, rapid ones included, and
pauses with no underrun, and holds superseded loads to never winning;
`AudioBudgetTest` holds a load's heap and the render thread's CPU, playing and
paused, to their budgets (see `android/AGENTS.md`).
