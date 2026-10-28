# Plan: native Android app, simpler web app, room for iOS

The working plan for splitting Soundscape into platform siblings: a simpler web
app (no casting) and a native Android app that looks and behaves the same,
with the repository laid out so a native iOS app can join later without
another restructure. Each phase below is ticked off as it lands. When the work
is done, the lasting rules move into the `AGENTS.md` files and this file is
deleted. It is a plan, not documentation.

## 1. Requirements

### Product

- **Android does everything the web app does that makes sense on a phone:**
  play/pause/previous/next with wrap-around, gapless looping (equal-power
  10 ms loop crossfade), a 250 ms equal-power crossfade between tracks, an app
  volume slider in a pop-up pill, a light/dark/system theme in an overflow menu,
  remembered volume, theme and track, the title slide on track change, the
  delayed loading indicator, the calm error line, the byline and version links,
  and the three app shortcuts (Garden Rain, Fireplace, Rain & Thunder).
- **Android does what the OS expects of a media app:** playback continues in the
  background, there is a media notification with lock-screen and Bluetooth/
  headset controls, it respects audio focus (calls, other apps), and it pauses
  when headphones are unplugged.
- **Fully offline.** The audio ships inside the app, so there is no network
  path and no "you're offline" message.
- **Looks identical to the web app** at the same screen size. Colours, sizes,
  spacing and motion timings come from one shared source, and both platforms are
  checked against it.
- **Not on Android:** "Install app", PWA/service worker, and casting.
  Keyboard shortcuts (space and arrows) are kept, because Chromebooks and
  tablets have keyboards and it costs one key handler.
- **Phones, tablets, foldables and Chromebooks (maintainer requirement).** One
  layout for every window, as the web has one page for every viewport: the
  header at the top, the player centred, volume at the bottom, scrolling only
  in a window too short to hold them. Any size and either orientation,
  split-screen and free-form windows included; nothing is locked or
  letterboxed. A foldable is just a window that changes size, so there is no
  fold- or hinge-specific code. Keyboard, mouse and trackpad work as they do
  on the web.

### Web

- **Remove Chromecast and AirPlay.** Delete the plugin, its tests and fakes,
  the cast audio twins (about 12 MB), the `--cast` build role, the
  service-worker bypass, the handover in `script.js`, and the members only the
  handover used.
- **Keep the `PlaybackOutput` seam** (`activeOutput()`, the port, the contract
  suite run against `AudioPlayer`), so casting can come back as a plugin.
- **Tag the last commit that has casting**, and point to that tag from the docs
  so the measured platform notes in `remote-playback/AGENTS.md` stay findable.
- **Ask before any other clean-up.** Candidates found so far, none to be done
  without a yes:
  - `isBrowserPlaybackSyncSuppressed` may reduce to the paused-surface refresh
    alone.
  - The volume label swap (`REMOTE_VOLUME_LABEL`).
  - `failureMessage()` and `canControlVolume()` are only ever non-trivial for a
    remote.

### Engineering

- **Efficient, and plainly so (maintainer requirement).** As fast, responsive
  and light as it can be — memory, CPU and battery, while playing and while
  idle — through clean, straightforward code, never through hacks. In
  practice:
  - **Memory:** 16-bit PCM mapped from the APK, never decoded or copied onto
    the heap, and at most two tracks mapped at once (during a track
    crossfade). Measured with a 16 MB heap, the worst real limit the spike met.
  - **CPU:** one render thread that blocks on `AudioTrack.write` — no polling,
    no timers while playing, no per-frame allocation; no recomposition while
    nothing on screen changes.
  - **Battery:** nothing runs while paused except what the OS requires; no
    wake lock beyond what a foreground media service implies; the output
    buffer is sized for few wake-ups, not low latency, since nothing here
    needs low latency.
  - **Startup:** the first frame draws before any audio is loaded.
  - Each is checked, not assumed: Phase 12 measures memory, CPU while playing,
    and wake-ups against budgets, on the lowest and highest API level.

- **Dependencies (confirmed).**
  - Built into Android, with no dependency: AudioTrack, MediaExtractor/
    MediaCodec, the framework `MediaSession` with a `Notification.MediaStyle`
    notification, a foreground service, `AudioFocusRequest`,
    `SharedPreferences`, `org.json`, and the platform splash screen.
  - Google first-party, bundled in the APK: Jetpack Compose (BOM),
    `androidx.activity:activity-compose`, `androidx.core`.
  - Kotlin's own: the stdlib and `kotlinx-coroutines`.
  - Test-only: JUnit4 (third party, approved), AndroidX Test, Compose UI Test
    and UI Automator.
  - Build: Gradle (third party, unavoidable), the Android Gradle Plugin and the
    Kotlin plugin.
  - **Anything not on this list needs the maintainer's yes**, with its category
    stated. Where a platform API will do reliably across the supported versions,
    we write the code ourselves.
- **Built for current Android, and plainly compatible back to 8.0
  (maintainer requirement).** The app is written the way current Android
  expects, and the same code runs on every supported level with no
  workarounds for old ones; where a newer level offers something better it is
  used there and simply absent below. Nothing deprecated: the Kotlin compiler
  and lint both fail the build on a warning. What that means in practice:
  - Compose for all UI, with no AppCompat, Material Components or View
    widgets; a single activity.
  - Edge-to-edge on every level, laid out within the system's safe-drawing
    insets (bars, cutouts, the taskbar).
  - Predictive back: nothing intercepts back except an open panel, which back
    closes.
  - The theme choice is handed to the system on 12+ (per-app night mode), so
    the splash screen and system surfaces match it; below 12 the app applies
    it itself, and a cold start shows the system theme's window colour for
    an instant.
  - The platform splash screen on 12+; a themed (monochrome) icon on 13+.
  - Media through the framework `MediaSession`, which 13+ builds its controls
    from; MediaCodec in its asynchronous mode.
  - Resizable, with no orientation lock, so tablets, foldables, Chromebooks
    and desktop windowing get the app at its natural size. The touchscreen is
    not required, so keyboard-and-mouse Chromebooks can install it.
- **minSdk 26 (Android 8.0), about 97% of active devices.** Android 9+ was
  already 95.2% in late 2025, so 26 costs nothing extreme. What it gives us,
  and what would otherwise need compatibility code:
  - `AudioFocusRequest`
  - mandatory notification channels
  - adaptive icons
  - `startForegroundService`
  - float PCM in AudioTrack

  "System" theme follows the OS setting where there is one (Android 10+) and
  falls back to light below that. compileSdk and targetSdk are the latest
  stable.
- **Architecture: domain separate from the OS and the UI.**
  - `android/core` is a pure Kotlin/JVM module with no Android imports. It holds:
    - the catalog model
    - the playback controller (intent, track generation, stale-request guards,
      rollback on a failed change, loading-indicator delay, error/loading
      exclusivity, volume clamping, persistence rules)
    - the loop-crossfade maths
    - the ports it needs: `AudioEngine`, `PreferenceStore`, `Scheduler`
  - `android/app` holds the UI (Compose) and the OS adapters: the AudioTrack
    engine, the service and MediaSession, and the
    SharedPreferences store. Adapters implement core's ports, and nothing in
    `core` knows Android exists.
- **No code sharing with iOS (no Kotlin Multiplatform).** The domain is small
  and a native Swift app should be idiomatic Swift. The platforms share
  **data and specs** instead, in `shared/`: the catalog, the design tokens, the
  copy, and golden test fixtures. Every platform's tests check against them,
  which is how "reference each other and check against one another" becomes
  executable.
- **Repository layout: platform siblings (confirmed).**

  ```
  AGENTS.md            entry point: product, routing, craft rules, git workflow
  shared/              cross-platform contract + AGENTS.md
  web/                 was src/, tests/, package.json, Dockerfile (+ AGENTS.md)
  android/             Gradle project: core/, app/ (+ AGENTS.md)
  ios/                 later
  masters/ scripts/    audio pipeline feeding every platform
  ```

  - **The published audio stays in `web/src/resources/soundscapes/`.** GitHub
    Pages publishes one folder, so moving it out would give the web app its
    first build step. Android bundles the masters instead (see Phase 12):
    still one copy of each soundscape in git, in `masters/`.
  - **Web-only generators move with the web app:**
    - icons
    - screenshots
    - the media-key script

    `build-audio.mjs` stays at the root, because every platform consumes its
    output.
- **Tests that earn their place.**
  - JVM unit tests (JUnit4) for all of `core`.
  - On-device instrumented tests:
    - **Compose UI Test**, the in-process counterpart of the web's component
      tests.
    - **UI Automator**, the black-box, cross-app counterpart of Playwright: it
      drives the real app, the notification and media keys.
    - **Audio tests** that prove every bundled loop's seam is continuous, so
      the gapless promise is tested rather than asserted.
  - They run on **Gradle Managed Devices** (first-party, part of AGP), locally
    and in CI, across the version matrix below.
- **Version matrix: every API level where something we use changed (requested
  by the maintainer).** A level with no relevant change is skipped. The reasons
  are checked against Android's behaviour-change notes in Phase 4, and the
  matrix is revisited whenever the app starts using another platform API.

  | API | Android | Why it is in |
  |---|---|---|
  | 26 | 8.0 | minSdk. Notification channels, `startForegroundService`, `AudioFocusRequest`. |
  | 29 | 10 | Software codecs move to Codec2, in an updatable Mainline media module, so the Opus/AAC decode must be re-proven; gesture navigation. |
  | 30 | 11 | Media controls move into Quick Settings, built from the MediaSession. |
  | 31 | 12 | Limits on starting a foreground service from the background (media-button resume); `PendingIntent` mutability is mandatory. |
  | 33 | 13 | `POST_NOTIFICATIONS` runtime permission; media controls derive their buttons from `PlaybackState` actions. |
  | 34 | 14 | `foregroundServiceType="mediaPlayback"` and its permission become mandatory. |
  | 35 | 15 | Edge-to-edge is enforced. |
  | 37 | 17 | The current target. Background audio hardening: playback and audio-focus requests from the background fail silently, and for apps targeting 37 a foreground service with while-in-use capability must already be running. |

  Skipped: 27 and 28 (nothing we use changes at runtime; 28's
  `FOREGROUND_SERVICE` permission is a manifest entry that lint checks), 32
  (large-screen polish only), and 36 (its changes for our target — predictive
  back on by default, no edge-to-edge opt-out, orientation ignored on large
  screens — all hold on 37 too, which adds its own). When a newer API becomes
  the target, the old target stays in the matrix if anything we use changed in
  between. Pull requests run 26 and 37; pushes to `trunk` and every Android
  release run the whole matrix.

  Design consequence of 37, for Phase 9: a media-button "play" after the
  service has stopped cannot start audio from the background, so the service
  stays in the foreground while paused (until the notification is dismissed),
  and a resume with no service running is tested to fail gracefully, not
  silently.
- **Visual parity, checked two ways.**
  1. **Gating, on geometry.** A Playwright script records the web app's key
     element boxes (play/prev/next buttons, title, header, footer controls) at a
     fixed viewport into a shared fixture. A Compose test lays the Android
     screen out at the same size in dp and asserts the same boxes within ±2 dp.
     This is robust to font rasterisation, and it catches real drift.
  2. **Advisory, on pixels.** Both apps are screenshotted at the same size and
     density, in both themes, into a side-by-side and diff report for a human
     eye. Pixel-identical is not achievable across two text renderers, so this
     does not gate CI. It may gate later with a tolerance once it proves stable.
- **Versioning.** The two platforms version independently: web keeps
  `package.json`/`sw.js`/`script.js`, and Android keeps `versionName`/
  `versionCode` in one Gradle file. Proposed tag prefixes are `web-v*` and
  `android-v*` from here on, with the existing `v*` tags left as they are. This
  is to be confirmed when the first release happens; each bump and tag still
  waits for a yes, as now.
- **CI.** Workflows are split per platform with path filters. The web workflow
  is the current one, re-pointed at `web/`. The Android workflow runs lint, JVM
  tests and a debug build on every PR, and instrumented tests on a managed
  emulator (KVM on Ubuntu runners). It uses no third-party actions beyond
  GitHub's own (`checkout`, `setup-java`).
- **Out of scope for now:** a release signing key, the Play Store listing, and
  publishing. These are listed in the final phase, and they need the
  maintainer's accounts and keys.

### Open questions (not blocking; asked when their phase arrives)

- The version bump for the casting removal. It removes a feature, so a major
  bump is proposed, with the tag name for the last casting commit.
- The tag prefixes above.
- The application ID. `com.builduseful.soundscape` is proposed.

## 2. Phases

Every phase ends the same way: the tests are green, the app has been run and
looked at in both themes, the docs are updated beside the code they govern, and
the box is ticked here.

### Phase 0 — Requirements and plan
- [x] Read the whole codebase and its AGENTS.md files.
- [x] Settle dependencies, layout, the casting removal and the toolchain with
      the maintainer.
- [x] Write and commit this plan.

### Phase 1 — Web: remove casting (on the current layout)
Done before the move, so the move carries less and the tag points at a clean
pre-removal state.
- [x] Propose the tag for the last casting commit, and create it on a yes.
- [x] Delete `src/js/remote-playback/` and its tests:
  - `app-cast-sdk`
  - `app-remote-playback`
  - `remote-playback-*`
  - `providers/`
  - `helpers/fake-remote-playback.js`
  - `helpers/remote-transport-fakes.js`
- [x] Remove from `index.html`: `<remote-playback>`, `#remoteTransportElement`,
      and the opt-out attributes whose only reason was casting (keep them if the
      reason still stands; see the decision note below).
- [x] `script.js`:
  - Delete the handover, the remote wiring, `adoptRemote*` and
    `syncVolumeControlForRemote`.
  - `activeOutput()` stays, returning `localOutput`.
  - Keep `isRemoteActive()` only if a reader needs it; otherwise collapse it.
- [x] `audio-player.js` / `playback-output.js`: remove the handover-only members
      (`pauseForHandover`, `wantsPlayback`) and update the contract suite.
- [x] `sw.js`: remove the cast bypass and the precache entries. Update
      `pwa.test.js`.
- [x] Delete `resources/soundscapes/cast/`, the `--cast` role in
      `build-audio.mjs`, and the `cast/*` entries in `build-manifest.json`.
- [x] Update the docs: README, root AGENTS.md, `src/js/AGENTS.md`,
      `components/AGENTS.md`, `tests/AGENTS.md`, `scripts/AGENTS.md`. Leave one
      line pointing at the tag.
- [x] List the remaining clean-up candidates for the maintainer (above). Do
      none unasked.
- [x] `npm test` green. Run in a browser in both themes, then play, skip, change
      volume and use the menu.
- [x] Propose the version bump.

> **Decision note:** `disableremoteplayback` / `x-webkit-airplay="deny"` on
> `#audioElement` still protect against the *browser's own* cast and AirPlay
> button offering a route that would leave the decoded buffer playing locally.
> That reason survives the plugin's removal, so they stay, with the comment
> rewritten.

### Phase 2 — Restructure into platform siblings
- [x] Use `git mv` for `src/`, `tests/`, `package.json`, `package-lock.json`,
      `Dockerfile`, `.dockerignore` and `opencode.json`'s web-specific bits →
      `web/`. Move `export-icons.mjs`, `capture-screenshots.mjs` and
      `send-media-key.ps1` → `web/scripts/`. Keep `build-audio.mjs` at the
      root, re-pointed at `web/src/resources/soundscapes`.
- [x] Re-point the paths in:
  - the workflow (`working-directory: web`, `path: web/src`, path filters)
  - the Dockerfile (bind mount, `--root`)
  - the scripts
  - tests that resolve repo-relative paths
  - the playwright-cli skill config notes
- [x] Split the docs:
  - Root `AGENTS.md` becomes the entry point (product, routing table, craft
    rules, where knowledge goes, git workflow, nothing machine-specific, and
    the cross-platform rule).
  - `web/AGENTS.md` covers the web overview and running and testing.
  - The existing nested files move with their directories.
  - `README.md` is reworked per platform.
- [x] `npm test` green from `web/`. The container serves; check in a browser.
      CI paths are verified by reading and a dry run where possible.

> **As done:** plain moves, not `git mv` (staging is the maintainer's review
> marker; git still records them as renames). `opencode.json` stays at the root,
> since it configures a tool, not the web app. `build-audio.mjs` runs as
> `node scripts/build-audio.mjs` from the root, so `web/package.json` lost its
> `audio` script. Path filters wait for the Android workflow in Phase 5: with one
> workflow there is nothing to filter between.

### Phase 3 — Shared contract
- [x] `shared/catalog.json`: id, title and group for each track, in order.
      `web/tests/tracks.test.js` asserts `tracks.js` matches it, and
      `build-audio.mjs` reads it.
- [x] `shared/design-tokens.json`:
  - light and dark colours (every `--color-*`)
  - shadows
  - sizes (play 118/102, prev/next 60, icons 30/52/46, gaps 15/34, padding
    26/18, the narrow breakpoint at 520, volume button 50, menu button 40,
    slider length 120)
  - type sizes
  - durations (loading delay 450, title 420, track crossfade 250, loop
    crossfade 10, theme fade 200, colour change 180, popover 160/240)

  A web test asserts `style.css` and the component CSS match it.
- [x] `shared/copy.json`: the labels, the loading text and the error messages.
      A web test asserts the wording matches.
- [x] `shared/fixtures/loop-crossfade.json`: golden input and output vectors.
      The web test runs `applyLoopCrossfade` against it.
- [x] `shared/AGENTS.md`: what the contract is, the rule that a change here
      lands on every platform in the same PR, and how each platform consumes it.

> **As done:** the catalog has no `group`: the groups were only comments in
> `tracks.js`, and nothing shows them. One test file,
> `web/tests/shared-contract.test.js`, checks all four (72 tests), helped by a
> small CSS block reader in `tests/helpers/css.js`; deliberately breaking each
> file made it fail. The fixture is computed from the formula, not from the web
> code, by `scripts/generate-loop-crossfade-fixture.mjs`. The suite now reads
> `../shared`, so the container test command mounts the repository root.

### Phase 4 — Android toolchain (host)
- [x] Ask, then install: a JDK 21 (winget), the Android command-line tools, the
      SDK platform and build-tools, the emulator, and system images for API 26
      and the latest API (the rest of the matrix on demand).
- [x] Check each reason in the version matrix against Android's
      behaviour-change notes, and adjust the matrix.
      (Done: 36 dropped as covered by 37; 37 added for background audio
      hardening.)
- [x] Record the setup in `android/AGENTS.md` generically (no machine paths;
      anything per-person goes in `.config.md`).

> **As done:** Microsoft OpenJDK 21 (winget), the SDK command-line tools,
> platform 37.0, and images for 26 and 37, on the drive the maintainer chose;
> the paths are in `.config.md`. The Windows Hypervisor Platform was already
> usable, so the emulator needed no admin step. `sdkmanager` now warns that it
> is deprecated in favour of an `android` CLI; it still works, and the switch
> can wait until it stops.

### Phase 5 — Android skeleton
- [x] Set up the Gradle wrapper, `settings.gradle.kts`, the version catalog
      (`gradle/libs.versions.toml`, every version pinned), and the
      `android/core` (Kotlin JVM) and `android/app` (Android application)
      modules.
- [x] Code generation from `shared/` at build time, using Gradle's bundled
      JSON parser (no dependency):
  - the catalog and tokens become Kotlin
  - the copy becomes `strings.xml`
  - the audio comes in as an asset source directory
- [x] An empty Compose activity, edge-to-edge, the adaptive and monochrome icon
      (vector drawables from `icon.svg`/`maskable-icon.svg`), and the splash
      background per theme.
- [x] Lint with warnings as errors. Add `.github/workflows/android.yml`.
- [x] Builds, installs and launches on an emulator at API 26 and the latest
      API.

> **As done:** AGP 9.4.1 (built-in Kotlin, no `kotlin-android` plugin),
> Gradle 9.8.2 (wrapper checksum pinned), Kotlin 2.4.21, Compose BOM
> 2026.09.00, and Compose `foundation`/`ui` only: no Material, since the UI is
> drawn to the web's design. Code generation is an included build,
> `android/build-logic`, with typed, cacheable tasks: `core` gets
> `catalogTracks` and `DesignTokens`, and `app` gets `strings.xml` plus the page
> colour per theme for the window and the Android 12 splash. `core` already
> holds `loopCrossfade`, tested against the shared fixture. The framework
> `Theme.Material` is the window theme, with no AppCompat. Checked: lint is
> clean, and the app launches on API 26 and 37 emulators in both themes. The
> new `android.yml` runs the JVM tests, lint and a build; both workflows now
> have path filters. Commit `gradlew` with its executable bit.

### Phase 6 — Audio spike: prove gapless on Android
- [x] Decode each `.opus` with MediaExtractor + MediaCodec on API 26, 29 and
      the latest API, and compare the sample count and edges against an ffmpeg
      decode (pre-skip honoured, no padding). Do the same for the `.m4a`
      (encoder delay/edit list).
- [x] Choose the asset format and record why in the audio AGENTS.md. The
      preference is the same Opus bytes as the web, if Ogg extraction works at
      API 26; otherwise AAC; FLAC only if neither is sample-exact.
- [x] Prototype the AudioTrack streaming loop, and check the seam is continuous
      by rendering across it.

> **As done:** Opus, the web's own bytes; AAC is left out of the APK. The
> Android extractor honours Opus pre-skip but not the Ogg end trim, so the
> decoder reads the true length from the last page's granule (`oggOpusFrameCount`
> in `core`) and stops there; with that, all eleven files match ffmpeg's decode
> sample for sample on API 26, 29 and 37 (`AssetDecoderTest`, against
> `shared/fixtures/decoded-audio.json`). AAC cannot be made gapless without
> undoing the codec's own framing: API 26 ignores the edit list (1,024 priming
> samples left in) and API 37 drops 16–32 samples from the tail. PCM is 16-bit,
> not float: the API 29 image's 16 MB heap could not hold float buffers. The loop
> crossfade runs in place on that buffer (`loopCrossfadeInPlace`) and
> `LoopReader` plays it forever, both tested on the JVM against the shared
> fixture. On the device, an AudioTrack in streaming mode fed by a blocking
> writer streams across many wraps with no underrun on API 26 and 37 — once its
> buffer is filled before `play()`: starting it empty counts an underrun on
> API 26. The first budgets (`AudioBudgetTest`): a decode keeps only its PCM,
> and the writer uses about 0.2% of one core.
>
> **Revised in Phase 12:** the app bundles the masters as 16-bit PCM WAV, each
> a finished loop, and maps them from the APK. No decoder, no crossfade at
> runtime, nothing on the heap: a load is instant and keeps 0 KB, for about
> 35 MB more in the APK. `OggOpus`, `AssetDecoder`, `LoopCrossfade` and
> `shared/fixtures/decoded-audio.json` went; `MastersTest` holds each master to
> a clean seam.

### Phase 7 — Domain core (`android/core`)
- [x] Catalog, `PlayerState`, `PlaybackController`, and the ports
      (`AudioEngine`, `PreferenceStore`, `Scheduler`).
- [x] Behaviour ported from the web's rules, each with a JVM test:
  - wrap-around
  - stale-request generation
  - rollback, or naming the failed track, on a failed change
  - the loading delay, and the hand-off of loading state on a skip
  - error and loading never shown together
  - only failures that leave silence are shown
  - volume clamped and persisted
  - an unknown saved track falls back to the first
  - shortcut selection plays
- [x] The loop-crossfade maths, tested against the shared golden fixture.

> **As done:** `core/playback`: `PlaybackController`, `PlayerState`, and the
> three ports. No coroutines: the controller is confined to one thread and the
> engine answers each load with a callback, which keeps `core` at zero
> dependencies and makes every test deterministic (a fake engine finishes
> loads when the test says, on a virtual clock). Loading and a failure share
> one `notice` slot in the state, so they cannot be shown together by
> construction. 31 tests, each rule mutation-checked. Two deliberate
> differences from the web, both worth carrying back to it:
> - **A failed change rolls back to the track the engine holds**, not to the
>   title before that change. The web's `changeTrack` restores the index from
>   just before *its* change, so after two quick skips (A playing → B → C,
>   C fails) it shows B over A's sound.
> - **The play button answers at once** (it shows intent), where the web's
>   flips once the decode finishes; a pause during that load lands it paused.
>   Volume is saved when a drag ends rather than on every step.

### Phase 8 — Audio engine (`android/app`, audio)
- [x] The decoder (16-bit PCM; see Phase 6) and the `LoopingAudioEngine` on
      AudioTrack 16-bit PCM:
  - one render thread
  - the loop window
  - an equal-power track crossfade
  - volume through `AudioTrack.setVolume` (see below)
- [x] Instrumented tests:
  - every bundled track decodes, at the expected length
  - the rendered seam is continuous
  - the crossfade hits the right gain at its end points
  - a superseded load never replaces newer playback

> **As done:** `LoopingAudioEngine` (app) on `LoopMixer` (core). The mixing is
> pure Kotlin and tested on the JVM (endpoint gains, equal power, an
> interrupted change, chunking); the engine is threads and the AudioTrack:
> main for calls, one decode thread whose loads cancel when superseded, and one
> render thread that alone starts, pauses and flushes the output, and waits on
> a condition while paused. Decisions, each in the audio `AGENTS.md`:
> - **Volume is `AudioTrack.setVolume`**, not a 250 ms ramp in the PCM: the
>   system mixer applies it after the buffer, so it is heard at once and never
>   clicks. The web's pause is an immediate `suspend()` with no fade, so there
>   is no pause fade to match; the token that looked like one is renamed
>   `volumeRamp`, since it only ever timed the web's volume ramp.
> - **No decode cache**: at most three tracks in memory (playing, fading out,
>   decoding), 18 MB with the two longest.
> - The output's buffer is about 100 ms, so a skip is heard within it.
> 10 instrumented tests pass on API 26, 29 and 37; the budgets measured are in
> `android/AGENTS.md`. Found on the way: API 29 counts a pause as an underrun
> (the tests check playing time), its `cmd uimode night` does nothing (use the
> secure setting and reboot), and its heap limit varies by boot (16 MB once,
> 512 MB since). Left for Phase 9: if the output will not start on the render
> thread, the engine logs it and stops, but has no way yet to tell the
> controller; the service's engine listener (focus, noisy) should carry it.

### Phase 9 — Playback service and OS integration
- [x] A foreground `PlaybackService` (`mediaPlayback` type) owns the controller,
      so playback outlives the activity. The activity binds to it.
- [x] The framework `MediaSession`: metadata, playback state, actions (play,
      pause, stop, previous, next), and media buttons.
- [x] A `MediaStyle` notification with a channel and a POST_NOTIFICATIONS
      request on Android 13+, explained, never nagging.
- [x] Audio focus (pause on loss, resume on transient gain if we paused),
      `ACTION_AUDIO_BECOMING_NOISY`, and static shortcuts that mirror the
      manifest.
- [x] Tests (instrumented, UI Automator):
  - the notification shows the track
  - media next and previous change the track
  - playback survives backgrounding
  - unplugging pauses (simulated broadcast)
  - a shortcut opens and plays its track

> **As done:** `PlaybackService` owns the engine and controller and joins them
> to the OS; the activity binds while visible. The rules stay in `core`:
> `AudioFocusRules` (hold focus while playing, give it up on pause, stop on a
> loss for good, resume after a brief one only if that is what paused us; a
> refused request pauses) has 8 JVM tests, and the engine now reports an
> output that will not start (`AudioEngine.setOnStopped`), which the
> controller shows as a failure. Decisions:
> - **No POST_NOTIFICATIONS request.** Media-session notifications are exempt
>   on Android 13 and later; the app does not declare the permission, and the
>   test shows the notification on API 37 without it. Nothing to explain, so
>   nothing can nag.
> - **In the foreground from the first play until stopped, paused included**
>   (the API 37 design note above). Stop is a notification action (Android 8
>   to 13 cannot swipe a foreground notification away) and the swipe on 14+;
>   swiping the app from recents stops too, playing or not.
> - **No media-button resumption.** Once stopped, the session is gone and a
>   headset key does nothing; that is tested, and is what "fail gracefully"
>   came to.
> - **The shortcuts are in the contract**: `shared/catalog.json` lists their
>   ids, and the web test holds the manifest to it. Android publishes them as
>   dynamic shortcuts, and once tracks have been listened to for 30 seconds
>   it puts the most recent first, which a PWA's fixed manifest cannot.
> - Artwork is the web's icon (`icon.svg`, as `drawable/artwork`), drawn once
>   at 320 dp, the largest the media controls show, so no card stretches it.
> 8 service tests, 18 instrumented in all, pass on API 26, 29 and 37, and the
> notification was looked at on each, light and dark. Found on the way:
> - A listener that paused in reaction to play (focus refused) left the load
>   it had just issued playing: the controller now tells the engine before
>   its listeners, and a listener never hears a state older than one already
>   delivered. Both have JVM tests.
> - A media key pressed as the service ends is delivered after `onDestroy`;
>   acting on it crashed API 26 (`startForegroundService` with no
>   `startForeground`). Late session callbacks are now dropped.
> - **Decoding is slow on the emulators**: 1.3–6.2 s per track on API 26 and
>   29, so the first sound of a long track waits that long. Measured since:
>   the codec's own work is small (ffmpeg decodes the longest track at about
>   700× real time on the host), and the codec was never waited on. The time
>   is the round trip to the media process for each 20 ms packet, about 1 ms
>   each on the emulators (3,300 packets in the longest track). MediaCodec's
>   asynchronous mode, which the platform recommends, cuts it by about a
>   third to a half, and the decoder now uses it (the longest track: 5.3 s to
>   3.6 s on API 37). Rejected: 60 ms Opus packets (a third of the round
>   trips, but API 26's extractor cannot read them), and bundling PCM (no
>   decode, but about 35 MB more in the APK and a second copy of the audio).
>   On a phone a round trip is a small fraction of the emulator's, so the
>   first sound is expected well within a second; Phase 12's time to first
>   sound budget checks that on real hardware.

### Phase 10 — UI (Compose), matching the web
- [x] Theme from the tokens, with a light/dark/system preference and the
      200 ms whole-surface cross-fade on change.
- [x] Header (name, byline link, menu), transport controls (sizes, press-in
      scale 0.95), title with the 420 ms slide and the loading dim, the loading
      bar sweep, the error line, the volume button and pop-up pill (wipe, mute
      glyph), and the menu panel (theme selector with the sliding thumb,
      version link).
- [ ] Narrow-width sizes at under 520 dp, reduced motion (animator duration
      scale 0 means no motion), TalkBack labels matching the web's accessible
      names, and announcements for loading and errors.
- [x] Every window: phone portrait and landscape, tablet, an unfolded
      foldable, split-screen and a window too short for the page (it
      scrolls); the safe-drawing insets in each; and the keyboard (space,
      arrows, Tab, Escape/back closing a panel).
- [x] Compose UI tests for each behaviour above, using a fake engine, at
      phone, landscape, tablet and short window sizes.

> As done so far: the UI matches the web's screenshots in both themes on API 26
> and 37, and "System" follows the OS on 12+ (`MODE_NIGHT_AUTO`). The fade
> mixes the palette rather than rebuilding the screen, so focus and an open
> panel survive it. `SoundscapeAppTest` (21 tests) drives the screen with a
> recorded player rather than a fake engine — the controller's rules are
> core's — at phone, landscape, tablet, unfolded and short sizes, with keys
> sent through the system. On the API 37 tablet and foldable emulators the
> whole instrumented suite passes; folding, unfolding and rotating keep the
> sound playing and the screen's state; and a resizable freeform window lays
> out at every size down to Android's smallest, where — as on the web at that
> width — the transport is clipped at the side. Still open: TalkBack itself
> (the labels and live regions are in place, not yet heard).

- [x] Store screenshots, scripted like the web's `npm run screenshots`: one
      command (`android/scripts/capture-store-screenshots`) boots the latest
      emulator, plays a fixed track at a fixed volume, captures phone, 7-inch
      and 10-inch tablet screenshots in light and dark at Play's required
      sizes, and writes them
      to a tracked `android/store/screenshots/`, skipping files that have not
      changed. Its header and `android/AGENTS.md` say when to re-run it (any
      change to how the home screen looks).

### Phase 11 — Parity
- [x] `web/scripts/capture-layout.mjs` writes the web's element boxes to
      `shared/fixtures/`.
- [x] An Android instrumented test asserts the same boxes within ±2 dp
      (gating).

> As done: one file, `shared/fixtures/layout.json`, for the five windows the UI
> tests use, and one theme — no box depends on it. `LayoutParityTest` holds
> buttons to all four edges, and text to what the font does not move: where
> the byline starts, and the title's centre and top. It found the app name a
> line 1.6 dp taller than the web's: Android will not lay a line out shorter
> than its font, so `Modifier.lineBox` holds it to the token.
- [x] Screenshot capture on both platforms, plus `scripts/parity-report.mjs`,
      which produces a side-by-side and diff HTML report (advisory).

> As done: both capture the windows of `layout.json`, light and dark, with the
> first soundscape paused — the web with Playwright, Android with
> `ParityScreenshots` rendering the screen as `LayoutParityTest` does (left out
> of Gradle's runs). The report embeds both and draws the diff in the page.
> First run: under 2% of pixels differ in any window, almost all of it text
> and glyph edges.

### Phase 12 — End-to-end and CI
- [x] A UI Automator end-to-end suite: launch, play, skip, change volume, theme,
      background, notification controls, restart restores the preferences.

> As done: `android/e2e/`, a self-instrumenting `com.android.test` module, so
> a test can force-stop the app and launch it again. Three journeys: play,
> skip and pause; playing on from the home screen under the notification's
> controls; and a restart that keeps the track, volume and theme (the one the
> system is not in, checked by the page's colour on screen, not only the menu).
> CI compiles it and the instrumented suite; running them there is the next
> item.
- [ ] Gradle Managed Devices for the whole version matrix, wired into CI with
      KVM (26 and the latest on pull requests; the full matrix on `trunk`),
      and web/Android path filters verified.
- [x] Run the end-to-end and instrumented suites on every level in the matrix
      and record the results, with a light and dark screenshot from each level
      in `.temp/screens/` for the maintainer to look over (not tracked), and
      from a tablet and a foldable on the lowest and highest level.

> As done: both suites pass on API 26, 29, 30, 31, 33, 34, 35 and 37, and on
> the tablet and foldable at 26 and 37 — run one emulator at a time, two cores
> each. The first runs found one bug in the app: on API 33 SystemUI clears a
> stopped player's notification a second later as if dismissed, and when a new
> one shared its id that stopped the new playback; each notification now has
> its own (`playingAgainRightAfterAStopCarriesOn`). The rest were the tests'
> own: `pm clear` finishing after it answers, and on API 34 killing a launch
> half a second on; `isMusicActive` lagging the last test's sound; and waits
> too short for an emulator just booted (60 s ceilings now, not budgets). On a
> Galaxy A26 (One UI, Android 16) everything passes but Escape closing a panel:
> One UI keeps the Escape key for itself, and Back still closes it.

- [ ] Performance budgets, measured on API 26 and 37 and recorded in
      `android/AGENTS.md`, each a gating test so a regression fails CI: Java
      heap while playing and during a track change, CPU while playing and while
      paused (none), wake-ups while paused (none), time to first frame, and
      time to first sound (instant since the loops are mapped; see Phase 6).
      The audio path's first two (heap kept by a load, writer CPU) exist from
      Phase 6 in `AudioBudgetTest`; each later phase adds the budgets for what
      it builds.

### Phase 13 — Wrap-up
- [ ] Docs pass: every `AGENTS.md` is accurate, the README covers the
      platforms, and this plan is removed (its decisions now live beside the
      code).
- [x] A release checklist for the maintainer: signing key, Play listing, data
      safety form (no data collected), and screenshots.

> As done: [`android/RELEASE.md`](../android/RELEASE.md). The README now covers
> both platforms; the rest of the docs pass, and removing this plan, wait for
> the phases above.
