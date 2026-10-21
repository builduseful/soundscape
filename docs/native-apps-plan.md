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
    engine, the decoder, the service and MediaSession, and the
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
    first build step. Android's Gradle build reads it from there as an asset
    source directory: one copy on disk, no duplication in git.
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
    - **Audio tests** that decode every bundled asset and prove the loop seam is
      continuous, so the gapless promise is tested rather than asserted.
  - They run on **Gradle Managed Devices** (first-party, part of AGP) at API 26
    and the latest API, locally and in CI.
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
- [ ] Propose the tag for the last casting commit, and create it on a yes.
- [ ] Delete `src/js/remote-playback/` and its tests:
  - `app-cast-sdk`
  - `app-remote-playback`
  - `remote-playback-*`
  - `providers/`
  - `helpers/fake-remote-playback.js`
  - `helpers/remote-transport-fakes.js`
- [ ] Remove from `index.html`: `<remote-playback>`, `#remoteTransportElement`,
      and the opt-out attributes whose only reason was casting (keep them if the
      reason still stands; see the decision note below).
- [ ] `script.js`:
  - Delete the handover, the remote wiring, `adoptRemote*` and
    `syncVolumeControlForRemote`.
  - `activeOutput()` stays, returning `localOutput`.
  - Keep `isRemoteActive()` only if a reader needs it; otherwise collapse it.
- [ ] `audio-player.js` / `playback-output.js`: remove the handover-only members
      (`pauseForHandover`, `wantsPlayback`) and update the contract suite.
- [ ] `sw.js`: remove the cast bypass and the precache entries. Update
      `pwa.test.js`.
- [ ] Delete `resources/soundscapes/cast/`, the `--cast` role in
      `build-audio.mjs`, and the `cast/*` entries in `build-manifest.json`.
- [ ] Update the docs: README, root AGENTS.md, `src/js/AGENTS.md`,
      `components/AGENTS.md`, `tests/AGENTS.md`, `scripts/AGENTS.md`. Leave one
      line pointing at the tag.
- [ ] List the remaining clean-up candidates for the maintainer (above). Do
      none unasked.
- [ ] `npm test` green. Run in a browser in both themes, then play, skip, change
      volume and use the menu.
- [ ] Propose the version bump.

> **Decision note:** `disableremoteplayback` / `x-webkit-airplay="deny"` on
> `#audioElement` still protect against the *browser's own* cast and AirPlay
> button offering a route that would leave the decoded buffer playing locally.
> That reason survives the plugin's removal, so they stay, with the comment
> rewritten.

### Phase 2 — Restructure into platform siblings
- [ ] Use `git mv` for `src/`, `tests/`, `package.json`, `package-lock.json`,
      `Dockerfile`, `.dockerignore` and `opencode.json`'s web-specific bits →
      `web/`. Move `export-icons.mjs`, `capture-screenshots.mjs` and
      `send-media-key.ps1` → `web/scripts/`. Keep `build-audio.mjs` at the
      root, re-pointed at `web/src/resources/soundscapes`.
- [ ] Re-point the paths in:
  - the workflow (`working-directory: web`, `path: web/src`, path filters)
  - the Dockerfile (bind mount, `--root`)
  - the scripts
  - tests that resolve repo-relative paths
  - the playwright-cli skill config notes
- [ ] Split the docs:
  - Root `AGENTS.md` becomes the entry point (product, routing table, craft
    rules, where knowledge goes, git workflow, nothing machine-specific, and
    the cross-platform rule).
  - `web/AGENTS.md` covers the web overview and running and testing.
  - The existing nested files move with their directories.
  - `README.md` is reworked per platform.
- [ ] `npm test` green from `web/`. The container serves; check in a browser.
      CI paths are verified by reading and a dry run where possible.

### Phase 3 — Shared contract
- [ ] `shared/catalog.json`: id, title and group for each track, in order.
      `web/tests/tracks.test.js` asserts `tracks.js` matches it, and
      `build-audio.mjs` reads it.
- [ ] `shared/design-tokens.json`:
  - light and dark colours (every `--color-*`)
  - shadows
  - sizes (play 118/102, prev/next 60, icons 30/52/46, gaps 15/34, padding
    26/18, the narrow breakpoint at 520, volume button 50, menu button 40,
    slider length 120)
  - type sizes
  - durations (loading delay 450, title 420, track crossfade 250, loop
    crossfade 10, theme fade 200, colour change 180, popover 160/240)

  A web test asserts `style.css` and the component CSS match it.
- [ ] `shared/copy.json`: the labels, the loading text and the error messages.
      A web test asserts the wording matches.
- [ ] `shared/fixtures/loop-crossfade.json`: golden input and output vectors.
      The web test runs `applyLoopCrossfade` against it.
- [ ] `shared/AGENTS.md`: what the contract is, the rule that a change here
      lands on every platform in the same PR, and how each platform consumes it.

### Phase 4 — Android toolchain (host)
- [ ] Ask, then install: a JDK 21 (winget), the Android command-line tools, the
      SDK platform and build-tools, the emulator, and system images for API 26
      and the latest API.
- [ ] Record the setup in `android/AGENTS.md` generically (no machine paths;
      anything per-person goes in `.config.md`).

### Phase 5 — Android skeleton
- [ ] Set up the Gradle wrapper, `settings.gradle.kts`, the version catalog
      (`gradle/libs.versions.toml`, every version pinned), and the
      `android/core` (Kotlin JVM) and `android/app` (Android application)
      modules.
- [ ] Code generation from `shared/` at build time, using Gradle's bundled
      JSON parser (no dependency):
  - the catalog and tokens become Kotlin
  - the copy becomes `strings.xml`
  - the audio comes in as an asset source directory
- [ ] An empty Compose activity, edge-to-edge, the adaptive and monochrome icon
      (vector drawables from `icon.svg`/`maskable-icon.svg`), and the splash
      background per theme.
- [ ] Lint with warnings as errors. Add `.github/workflows/android.yml`.
- [ ] Builds, installs and launches on an emulator at API 26 and the latest
      API.

### Phase 6 — Audio spike: prove gapless on Android
- [ ] Decode each `.opus` with MediaExtractor + MediaCodec on API 26 and the
      latest API, and compare the sample count and edges against an ffmpeg
      decode (pre-skip honoured, no padding). Do the same for the `.m4a`
      (encoder delay/edit list).
- [ ] Choose the asset format and record why in the audio AGENTS.md. The
      preference is the same Opus bytes as the web, if Ogg extraction works at
      API 26; otherwise AAC; FLAC only if neither is sample-exact.
- [ ] Prototype the AudioTrack streaming loop, and check the seam is continuous
      by rendering across it.

### Phase 7 — Domain core (`android/core`)
- [ ] Catalog, `PlayerState`, `PlaybackController`, and the ports
      (`AudioEngine`, `PreferenceStore`, `Scheduler`).
- [ ] Behaviour ported from the web's rules, each with a JVM test:
  - wrap-around
  - stale-request generation
  - rollback, or naming the failed track, on a failed change
  - the loading delay, and the hand-off of loading state on a skip
  - error and loading never shown together
  - only failures that leave silence are shown
  - volume clamped and persisted
  - an unknown saved track falls back to the first
  - shortcut selection plays
- [ ] The loop-crossfade maths, tested against the shared golden fixture.

### Phase 8 — Audio engine (`android/app`, audio)
- [ ] The decoder (to float PCM, with a per-track cache) and the
      `LoopingAudioEngine` on AudioTrack float PCM:
  - one render thread
  - the loop window
  - an equal-power track crossfade
  - a 250 ms gain ramp for volume and pause fades
- [ ] Instrumented tests:
  - every bundled track decodes, at the expected length
  - the rendered seam is continuous
  - the crossfade hits the right gain at its end points
  - a superseded load never replaces newer playback

### Phase 9 — Playback service and OS integration
- [ ] A foreground `PlaybackService` (`mediaPlayback` type) owns the controller,
      so playback outlives the activity. The activity binds to it.
- [ ] The framework `MediaSession`: metadata, playback state, actions (play,
      pause, stop, previous, next), and media buttons.
- [ ] A `MediaStyle` notification with a channel and a POST_NOTIFICATIONS
      request on Android 13+, explained, never nagging.
- [ ] Audio focus (pause on loss, resume on transient gain if we paused),
      `ACTION_AUDIO_BECOMING_NOISY`, and static shortcuts that mirror the
      manifest.
- [ ] Tests (instrumented, UI Automator):
  - the notification shows the track
  - media next and previous change the track
  - playback survives backgrounding
  - unplugging pauses (simulated broadcast)
  - a shortcut opens and plays its track

### Phase 10 — UI (Compose), matching the web
- [ ] Theme from the tokens, with a light/dark/system preference and the
      200 ms whole-surface cross-fade on change.
- [ ] Header (name, byline link, menu), transport controls (sizes, press-in
      scale 0.95), title with the 420 ms slide and the loading dim, the loading
      bar sweep, the error line, the volume button and pop-up pill (wipe, mute
      glyph), and the menu panel (theme selector with the sliding thumb,
      version link).
- [ ] Narrow-width sizes at under 520 dp, reduced motion (animator duration
      scale 0 means no motion), TalkBack labels matching the web's accessible
      names, and announcements for loading and errors.
- [ ] Compose UI tests for each behaviour above, using a fake engine.

### Phase 11 — Parity
- [ ] `web/scripts/capture-layout.mjs` writes
      `shared/fixtures/layout-<w>x<h>.json` (element boxes, both themes).
- [ ] An Android instrumented test asserts the same boxes within ±2 dp
      (gating).
- [ ] Screenshot capture on both platforms, plus `scripts/parity-report.mjs`,
      which produces a side-by-side and diff HTML report (advisory).

### Phase 12 — End-to-end and CI
- [ ] A UI Automator end-to-end suite: launch, play, skip, change volume, theme,
      background, notification controls, restart restores the preferences.
- [ ] Gradle Managed Devices (API 26 and the latest) wired into CI with KVM, and
      web/Android path filters verified.

### Phase 13 — Wrap-up
- [ ] Docs pass: every `AGENTS.md` is accurate, the README covers the
      platforms, and this plan is removed (its decisions now live beside the
      code).
- [ ] A release checklist for the maintainer: signing key, Play listing, data
      safety form (no data collected), and screenshots.
