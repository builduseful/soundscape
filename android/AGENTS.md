# Android app

A native Kotlin app that looks, sounds and behaves like the web app, which is
the reference (see the root `AGENTS.md`). minSdk 26, compile and target SDK 37.
Every command in this file runs from `android/`.

## Modules

| Module | Holds | May depend on |
|---|---|---|
| `core/` | The product's rules: catalog, loop crossfade, and the playback controller and audio-focus rules with their ports (`core/playback`). Plain Kotlin on the JVM. | Kotlin's standard library only |
| `app/` | Everything Android: activity, Compose UI, playback service, audio engine. | `core`, the libraries below |
| `e2e/` | The end-to-end suite: the installed app driven from outside its process with UI Automator — the screen, the notification, a restart. | `core`, the test libraries |
| `build-logic/` | Gradle tasks that generate code and resources from `../shared/`. | Gradle |

Keep Android out of `core`: if a rule can be stated without the platform, it
belongs there and is tested on the JVM, fast. `app` adapts it to the OS and
draws it.

`PlaybackController` is confined to one thread (the main thread, in `app`):
the engine's callbacks and the scheduler's actions must be delivered there.
`PlayerState` is the whole of what the screen and the OS controls show — draw
from it, and send every action through the controller. `PlaybackService` owns
the controller; its rules are in
[`app/src/main/kotlin/com/builduseful/soundscape/playback/AGENTS.md`](app/src/main/kotlin/com/builduseful/soundscape/playback/AGENTS.md).

## The shared contract

`core` gets `catalogTracks` and `DesignTokens` as generated Kotlin; `app` gets
`strings.xml` and the per-theme page colour as generated resources. Both come
from [`../shared/`](../shared/AGENTS.md) on every build — never edit the
generated files, and never copy a value from `shared/` into code by hand. Read
them through `DesignTokens` and `R.string`. The bundled audio is
`../web/src/resources/soundscapes/`, added as an asset directory: one copy on
disk for every platform.

## Dependencies

As few as possible, and first-party: Gradle, the Android Gradle Plugin,
Kotlin, and AndroidX (Compose, Activity, Test). JUnit 4 is the one exception,
approved for tests only. **Ask the maintainer before adding any other
library**, and prefer writing it ourselves when it can be made to work on every
API level we support. Every version is pinned in `gradle/libs.versions.toml`.
Espresso is only Compose's test rule's own dependency, pinned newer as a
constraint: the 3.5 it brings fails on API 37.

The audio path uses the platform directly — `MediaExtractor`, `MediaCodec`,
`AudioTrack`, the framework `MediaSession` — not Media3 or ExoPlayer. Its rules
(why Opus, why 16-bit, how the output is fed) are in
[`app/src/main/kotlin/com/builduseful/soundscape/audio/AGENTS.md`](app/src/main/kotlin/com/builduseful/soundscape/audio/AGENTS.md).

## Current Android, back to 8.0

Built the way current Android expects, with nothing kept for older levels'
sake: Compose only, edge-to-edge with the safe-drawing insets, predictive back
through `BackHandler`, the framework `MediaSession`. A newer level's extra
(per-app night mode on 12+, live reduced-motion changes on 13+) is used where it
exists and simply absent below it — never emulated. Kotlin and lint both fail
on a warning, so a deprecated call does not build.

Phones, tablets, foldables and Chromebooks get the one layout, resizable and
never letterboxed. The activity handles size and night-mode changes itself, so
a rotation, fold or resize keeps the screen's state.

## The UI

`app/.../ui/` draws `PlayerState` and the web's look from `DesignTokens`:

- **It sizes by the space it is given** (`BoxWithConstraints`), as the web's
  media queries do the viewport — not the window, which on a window not drawn
  edge to edge is larger than the page.
- **A theme change fades the palette**, every colour mixed in sRGB by one
  progress, and the screen is never rebuilt: a rebuild would drop focus and
  open panels. A control's own colour change animates a 0–1 progress
  (`animateOn`) and mixes palette colours by it, so it keeps step with a theme
  fade; never `animateColorAsState` on a palette colour.
- **Glyphs are scaled as paths, not under a canvas scale**: Android before 9
  rasterises a scaled path at its unscaled size and blurs it.
- **The keyboard follows the web**: Tab in reading order, which is placement
  order (the header is placed first and drawn on top by `zIndex`); Space and
  the arrows from the page or the transport; Escape and back close a panel. A
  panel's button and panel form one focus group, so moving between its
  controls is not leaving it.
- **UI tests send keys through the system** (UI Automator), not Compose's key
  injection, which skips the window's own focus navigation that a real
  keyboard's Tab goes through.

## Efficiency

The root `AGENTS.md` asks for an app that is light on memory, CPU and battery,
through plain code. Here that means:

- **Audio is 16-bit PCM**, decoded once into an exactly sized buffer, with the
  loop crossfade applied in place (`loopCrossfadeInPlace`). Float would double
  a minute-long track to 12 MB.
- **Hold as little audio as possible.** No decode cache: at most the track
  playing, one fading out and one decoding. The API 29 image, with
  `dalvik.vm.heapgrowthlimit` unset, has been seen to run apps with a 16 MB
  limit (the decoder spike hit it with float buffers) and on other boots with
  512 MB; do not count on either.
- **No polling and no timers while playing.** One render thread blocks on
  `AudioTrack.write`; nothing at all runs while paused.
- **No allocation on the audio path**, and no recomposition while nothing on
  screen changes.

### Performance budgets

Gating instrumented tests, so a regression fails instead of shipping. Each
budget sits well above what is measured, to catch a design going wrong rather
than emulator noise; raise one only with the maintainer's agreement.

| Budget | Test | Limit | Measured (API 26 / 37) |
|---|---|---|---|
| Heap a decode keeps | `AudioBudgetTest` | its PCM + 512 KB | PCM + 2 KB on 26, 29 and 37 |
| Render thread CPU while playing | `AudioBudgetTest` | 5% of one core | under 10 ms in 3 s (the clock's resolution) on 26, 29 and 37 |
| Render thread while paused | `AudioBudgetTest` | waiting, 0 ms CPU | waiting, 0 ms on 26, 29 and 37 |

Each phase adds the budgets for what it builds: heap during a track change and
time to first frame are still to come.

## Toolchain

- JDK 21 (any OpenJDK build) as `JAVA_HOME`.
- The Android SDK command-line tools, with `ANDROID_HOME` pointing at the SDK.
  Install with `sdkmanager` from `cmdline-tools/latest/bin`: `platform-tools`,
  `emulator`, `platforms;android-37.0`, and a `google_apis;x86_64` system image
  per API level in the test matrix. AGP fetches the build-tools it pins.
- Emulators are named `soundscape-api<level>`, for example
  `avdmanager create avd --name soundscape-api26 --package
  "system-images;android-26;google_apis;x86_64" --device pixel_6`.
- Where these live on a given machine goes in the gitignored `.config.md`, not
  here. If the AVDs are not under `~/.android/avd`, the emulator needs
  `ANDROID_AVD_HOME` in the environment of the shell that starts it.
- On Windows, call `sdkmanager.bat` and `avdmanager.bat` from PowerShell, not
  Git Bash: Bash hands a `.bat` its arguments through cmd, which splits package
  names at the `;`.

## Build and test

```sh
./gradlew :core:test                 # the JVM suite: fast, no device
./gradlew :app:lintDebug             # lint; warnings are errors
./gradlew :app:assembleDebug         # app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:connectedDebugAndroidTest   # instrumented, on a running emulator
./gradlew :e2e:connectedDebugAndroidTest   # end to end, on a running emulator
```

Check a change on the lowest and highest API level in the matrix
(`docs/native-apps-plan.md`), in both themes, before calling it done:

```sh
emulator -avd soundscape-api26 -no-window -no-audio -no-snapshot-save &
adb wait-for-device
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -W -n com.builduseful.soundscape/.MainActivity
adb shell cmd uimode night yes        # dark; `no` for light (not on API 29: below)
adb exec-out screencap -p > ../.temp/screen.png
adb emu kill
```

On API 29, `cmd uimode night` reports success and changes nothing. Use
`adb shell settings put secure ui_night_mode 2` (1 for light) and `adb reboot`.

The end-to-end suite finds controls by the names TalkBack reads, taken from
`shared/copy.json`, so it holds the installed app to the contract's wording
too. It runs in its own process (self-instrumenting), which is what lets it
kill the app and launch it again.

Uninstall a hand-installed APK (`adb uninstall com.builduseful.soundscape`)
before `connectedDebugAndroidTest`: its own install then fails with
`INSTALL_FAILED_ALREADY_EXISTS`, and the build still reports success with no
tests run.

On a foldable emulator, which has two displays, pass the display to
`screencap -d <id>` (the ids are in `adb shell dumpsys SurfaceFlinger
--display-id`); without one it writes a warning into the file instead of a PNG.

Releasing to Play, and what it needs from the maintainer, is
[`RELEASE.md`](RELEASE.md).

The Play listing's screenshots are `store/screenshots/`, written by
`node scripts/capture-store-screenshots.mjs`. Re-run it after any change to how
the home screen looks, and commit what it rewrites.

`node scripts/capture-parity.mjs` screenshots the screen as `LayoutParityTest`
lays it out (`ParityScreenshots`, which Gradle's runs leave out) for the
repository's parity report: see [`../scripts/AGENTS.md`](../scripts/AGENTS.md).
Both scripts drive the device through `scripts/device.mjs`: the one attached,
or else the AVD they name, started headless.

Take screenshots from Bash, not PowerShell: PowerShell's `>` re-encodes the
binary and corrupts the PNG. Put them in `.temp/`.

`gradlew` must be committed executable (`git add --chmod=+x`), or CI cannot run it.
