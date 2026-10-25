# Releasing to Google Play

What the maintainer does by hand, once per release unless it says otherwise.
Everything the build can do itself is already in the repo; what is left here
needs an account, a key, or a decision.

## Once

- [ ] **Upload key.** Create it with `keytool` and keep it, and its passwords,
      outside the repo (never commit a keystore or a password; see the root
      `AGENTS.md`). Enrol in Play App Signing, so Google holds the app signing
      key and a lost upload key can be reset.
- [ ] **Release signing in Gradle**, reading the keystore's path and passwords
      from the environment or `~/.gradle/gradle.properties`, never from a
      tracked file. `app/build.gradle.kts` has no release `signingConfig` yet.
- [ ] **Decide on R8** for the release build (`isMinifyEnabled` and
      `isShrinkResources`). It is off today: the release APK is about 9 MB,
      most of it the bundled audio. Turning it on means running the
      instrumented and end-to-end suites against a minified build first.
- [ ] **App content** in the Play Console:
  - Privacy policy: a URL Play requires. The app collects nothing, so it can
    say exactly that.
  - Data safety: no data collected or shared. The app has no `INTERNET`
    permission; its links open the browser. Its three preferences (volume,
    theme, track) stay on the device, apart from Android's own backup
    (`allowBackup`).
  - Ads: none. App access: no login. Target audience and content rating: the
    questionnaires.
  - Foreground service: declare the `mediaPlayback` type (playing the
    soundscape in the background), with the short video Play asks for.
- [ ] **Store listing:** category Music & Audio; name; short description (80
      characters at most) and full description; the 512 × 512 icon and the
      1024 × 500 feature graphic, which are not in the repo yet.
- [ ] **New personal developer account?** Play first needs a closed test with
      enough testers for long enough before production; check the current rule
      in the Console.

## Every release

- [ ] Bump `versionCode` (every upload) and `versionName` in
      `app/build.gradle.kts`.
- [ ] Everything green on `trunk`: `:core:test`, `:app:lintDebug`, and the
      instrumented and end-to-end suites on the lowest and highest API level
      (`AGENTS.md`, "Build and test").
- [ ] Screenshots current: `node scripts/capture-store-screenshots.mjs`, then
      upload `store/screenshots/` (phone, 7-inch and 10-inch tablet, light and
      dark) if any changed.
- [ ] `./gradlew :app:bundleRelease` and upload
      `app/build/outputs/bundle/release/app-release.aab`, with release notes.
- [ ] Install it from the internal testing track on a real phone, and play,
      pause and skip from the screen and the notification before promoting it.
