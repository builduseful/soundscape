# Web app

The reference implementation of Soundscape: a vanilla-JavaScript PWA with no
build step. `src/` is deployed as-is to GitHub Pages and served at the site
root. It works offline once installed through its service worker, drives the
OS media controls through the Media Session API, and loops gaplessly through
Web Audio. Every command in these files runs from `web/`.

| I want to… | Read |
|---|---|
| Run the tests, run the app, drive it in a browser | [`tests/AGENTS.md`](tests/AGENTS.md) |
| Change how audio plays | [`src/js/AGENTS.md`](src/js/AGENTS.md) |
| Change a custom element, styling, or the theme | [`src/js/components/AGENTS.md`](src/js/components/AGENTS.md) |
| Ship a change — version bump, cache, deploy | [`src/AGENTS.md`](src/AGENTS.md) |
| Rebuild icons or screenshots | [`scripts/AGENTS.md`](scripts/AGENTS.md) |

Colours, sizes, timings, wording and the track list are also in
[`../shared/`](../shared/AGENTS.md), and `tests/shared-contract.test.js` fails
until the two agree: change them in both.

**Any change to a deployed asset under `src/` needs a version bump** in three
files — see [`src/AGENTS.md`](src/AGENTS.md).

```
web/
├── src/                   # Deploy folder: index.html, style.css, sw.js, manifest
│   ├── js/                # App modules; components/ carries its own AGENTS.md
│   └── resources/         # icons/, screenshots/, soundscapes/{opus,aac}/
├── tests/                 # Unit suite (dependency-free), plus helpers/
├── scripts/               # Host-only generators: icons, screenshots, the shared layout; a media-key test aid
└── Dockerfile             # Default target = Caddy + Node; `--target serve` = slim Caddy only
```

`sw.js`'s precache list is the file-level inventory of `src/`; this tree stays
at directories.
