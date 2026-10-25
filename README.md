# Soundscape

Soundscape is a small ambience player for seamless looping background audio. It runs in the browser today, and a native Android app is on the way.

Sounds include rain, thunderstorms, fireplace ambience, open road ambience, and white, pink, and brown noise.

It supports:

- play, pause, previous, and next controls
- persistent volume, theme, and selected track preferences
- light, dark, and system theme modes
- Media Session integration for browser and OS media controls
- sample-accurate looping through Web Audio
- installable as a PWA, and fully playable offline once installed

## Repository

| Folder | What it is |
|---|---|
| `web/` | The web app (PWA), its tests and its container |
| `android/` | The native Android app (in progress) |
| `shared/` | What every platform agrees on: tracks, design tokens, wording |
| `scripts/` | The audio build, which feeds every platform |
| `masters/` | The audio build's inputs and their provenance |

## Web app

Run every command below from `web/`.

### Prerequisites

An OCI-compatible container engine (Docker, Podman, wslc, or similar). See `.config.md` for this project's specific engine; substitute `<container-engine>` below accordingly.

### Running

```sh
<container-engine> build --tag soundscape .
<container-engine> container run --detach \
    --publish 4321:80 \
    --volume ${PWD}:/app \
    soundscape
```

Then open `http://soundscape.localhost:4321`. The `--volume` bind mount maps your working directory into the container so source edits appear without rebuilding.

The project uses Caddy as a static file server inside the container — everything is self-contained, no Node.js or other tools needed on the host.

The default image also bundles Node.js so it can run `npm test`. For a slim runtime-only image (~50 MB, Caddy without Node), build the `serve` target:

```sh
<container-engine> build --tag soundscape --target serve .
```

### Testing

```sh
<container-engine> build --tag soundscape .
<container-engine> container run --rm \
    --volume ${PWD}/..:/repo --workdir /repo/web \
    soundscape npm test
```

## Android app

Run every command below from `android/`. It needs JDK 21 and the Android SDK
(`ANDROID_HOME`); [`android/AGENTS.md`](android/AGENTS.md) has the toolchain,
the emulators and the rest.

```sh
./gradlew :app:assembleDebug               # app/build/outputs/apk/debug/app-debug.apk
./gradlew :core:test :app:lintDebug        # JVM tests and lint, no device needed
./gradlew :app:connectedDebugAndroidTest   # instrumented tests, on a running emulator
./gradlew :e2e:connectedDebugAndroidTest   # end-to-end tests, on a running emulator
```

## Keeping the platforms alike

`node scripts/parity-report.mjs`, from the repository root, screenshots the web
and Android apps at the same window sizes and writes a side-by-side report to
`.temp/parity/report.html`. See [`scripts/AGENTS.md`](scripts/AGENTS.md).
