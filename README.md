# Soundscape

Soundscape is a small browser-based ambience player for seamless looping background audio.

Sounds include rain, thunderstorms, fireplace ambience, open road ambience, and white, pink, and brown noise.

It supports:

- play, pause, previous, and next controls
- persistent volume, theme, and selected track preferences
- light, dark, and system theme modes
- Media Session integration for browser and OS media controls
- sample-accurate looping through Web Audio

## Prerequisites

An OCI-compatible container engine (Docker, Podman, wslc, or similar). See `.config.md` for this project's specific engine; substitute `<container-engine>` below accordingly.

## Running

```sh
<container-engine> build --tag soundscape .
<container-engine> container run --detach \
    --publish 4321:4321 \
    --volume ${PWD}:/app \
    soundscape
```

Then open `http://localhost:4321`. The `--volume` bind mount maps your working directory into the container so source edits appear without rebuilding.

The project uses Caddy as a static file server inside the container — everything is self-contained, no Node.js or other tools needed on the host.

## Testing

```sh
<container-engine> build --tag soundscape .
<container-engine> container run --rm \
    --volume ${PWD}:/app \
    soundscape npm test
```
