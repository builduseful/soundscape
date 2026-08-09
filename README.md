# Soundscape

Soundscape is a small browser-based ambience player for seamless looping background audio.

Sounds include rain, thunderstorms, fireplace ambience, open road ambience, and white, pink, and brown noise.

It supports:

- play, pause, previous, and next controls
- persistent volume, theme, and selected track preferences
- light, dark, and system theme modes
- Media Session integration for browser and OS media controls
- sample-accurate looping through Web Audio
- casting to Chromecast, Google/Nest speakers, Google TV, and AirPlay targets

## Casting

The cast button sits in the header on any browser that can cast, and pressing it
opens your browser's own device picker. The app does not scan the network to find
out whether a device is there first — that would mean scanning continuously for
as long as the page is open, and the picker discovers devices itself. On a
browser with no way to cast at all (Firefox), the button is absent. It covers:

| Target | How | Browser |
| --- | --- | --- |
| Chromecast, Google/Nest speakers, Google TV | Remote Playback API | Chrome, Edge |
| HomePod, Apple TV | AirPlay | Safari |
| Sonos (One, Beam, Arc, Five, Move, Roam, S2) | AirPlay 2 — they appear as ordinary AirPlay targets | Safari |

Whichever route it takes, the audio the receiver plays comes from a file rather
than from the app's live Web Audio output — nothing in a browser can route an
`AudioContext` to a cast target. So two things differ from local playback:

- **The device plays an AAC copy**, not the Opus original — AirPlay cannot
  decode Opus. The copies are built by `npm run cast-audio`.
- **Looping works differently.** No cast path loops reliably on its own, so each
  AAC copy has the crossfade baked in and then contains that loop period repeated
  to about two minutes — every join inside the file is seamless, and the app
  restarts the file when it reaches the end. Each copy is trimmed so its loop
  period is a whole number of AAC frames, because otherwise the encoder pads the
  final frame with silence right on the seam. What remains is AAC's encoder delay
  at the head, which the container's edit list exists to absorb and gapless-aware
  receivers honour. Local playback remains sample-accurate regardless.
- **Volume belongs to the device.** The in-app slider does not control a
  Chromecast's level; use the device or its own app.

For bit-perfect looping on a Chromecast, cast the browser tab instead
(Chrome ⋮ → Cast → *Cast tab*). That captures the real Web Audio output, so
loops, crossfades, and the volume slider all behave exactly as they do locally —
at the cost of keeping the sending device awake and on the network.

## Prerequisites

An OCI-compatible container engine (Docker, Podman, wslc, or similar). See `.config.md` for this project's specific engine; substitute `<container-engine>` below accordingly.

## Running

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

## Testing

```sh
<container-engine> build --tag soundscape .
<container-engine> container run --rm \
    --volume ${PWD}:/app \
    soundscape npm test
```
