# Repository Guidelines

## Overview

Soundscape is a browser-based Progressive Web App (PWA) that plays looping ambient background audio — rain, thunderstorms, fireplace, open road, and white/pink/brown noise.

It has play/pause/prev/next controls, a volume slider, light/dark/system themes, and it remembers your volume, theme and track. It works offline once installed, and it responds to the media keys on your keyboard and the playback controls your OS shows in its notification area. The loops are gapless, which is harder than it sounds and is the reason for most of the audio rules.

## Where the rules live

This file is the standing overview. Everything task-specific lives beside what
it governs, in a nested `AGENTS.md` — read the one for what you are touching
before you touch it.

| I want to… | Read |
|---|---|
| Run the tests, run the app, drive it in a browser | [`tests/AGENTS.md`](tests/AGENTS.md) |
| Change how audio plays | [`src/js/AGENTS.md`](src/js/AGENTS.md) |
| Change a custom element, styling, or the theme | [`src/js/components/AGENTS.md`](src/js/components/AGENTS.md) |
| Change Chromecast/AirPlay | [`src/js/remote-playback/AGENTS.md`](src/js/remote-playback/AGENTS.md) |
| Ship a change — version bump, cache, deploy | [`src/AGENTS.md`](src/AGENTS.md) |
| Rebuild audio, icons or screenshots | [`scripts/AGENTS.md`](scripts/AGENTS.md) |
| Supply a new audio master | [`masters/AGENTS.md`](masters/AGENTS.md) |

**Any change under `src/` needs a version bump** in three files — see
[`src/AGENTS.md`](src/AGENTS.md).

## How To Work On This

Work the front end — implementation, refactoring, design, and the shape of the
code — as an experienced engineer who cares about the craft and is building
something meant to last. Prefer what the platform already does well, keep state
explicit rather than inferred, and settle each thing in one place. Run the app
and look at it, in both themes, before calling it done.

**Comments are minimal and to the point.** Write one only where the code cannot
say it itself: a non-obvious constraint, or a decision someone would otherwise
undo. Do not narrate what the code already shows.

### Where a piece of knowledge goes

- **A rule about one component, function, or rule set** — a comment at the code
  it governs.
- **What a test protects, and why it exists at all** — a comment above the test.
- **A subsystem with invariants of its own** — the nested `AGENTS.md` in its
  directory. It goes with the directory if that is ever deleted or moved.
- **Why a change was made** — the commit message.
- **Only what is true of the repo as a whole, and needed before every task** —
  this file. It is not a changelog. Prefer tightening an existing entry over
  appending a new one: two that overlap will drift, and the stale one is the one
  that gets believed.

## Project Structure

```
soundscape/
├── src/                              # Deploy folder (served at site root)
│   ├── AGENTS.md                     # Service worker, cache, versioning, deploy
│   ├── index.html                    # App entry point, loads script.js and styles
│   ├── style.css                     # App-wide styling + theme tokens (component internals live in @scope blocks)
│   ├── sw.js                         # Service worker for offline/PWA support
│   ├── manifest.webmanifest          # PWA manifest
│   ├── CNAME                         # Custom domain for deployment
│   ├── js/
│   │   ├── AGENTS.md                 # Audio invariants
│   │   ├── script.js                 # App bootstrap: wires audio, UI, state, and components
│   │   ├── audio-player.js           # Web Audio + HTMLAudioElement playback engine (the local PlaybackOutput)
│   │   ├── playback-output.js        # The PlaybackOutput port: what "a thing that can be playing" is
│   │   ├── media-session.js          # Media Session API integration (metadata, actions)
│   │   ├── pwa.js                    # Service worker registration + Launch Queue consumer
│   │   ├── theme-utils.js            # Light/dark/system theme helpers
│   │   ├── tracks.js                 # Track catalog: id + title only, no file paths
│   │   ├── local-source.js           # Which local file this browser plays for a track
│   │   ├── remote-playback/          # Chromecast/AirPlay plugin — detachable; READ ITS AGENTS.md
│   │   │   └── AGENTS.md             # Invariants, platform evidence, testing, device checklist
│   │   └── components/
│   │       ├── AGENTS.md             # Custom element rules, theme and colour
│   │       ├── app-menu.js           # Custom element for the top-right menu (a native popover)
│   │       ├── theme-selector.js     # Custom element for theme mode selection
│   │       └── volume-control.js     # Custom element for volume slider (a native popover)
│   └── resources/
│       ├── icons/                    # PWA/favicon icons (png + svg)
│       ├── screenshots/              # manifest.webmanifest install screenshots (git-tracked PNGs)
│       └── soundscapes/              # Ambience loops, by output role
│           ├── opus/                 # Local primary: one loop period, <track-id>.opus
│           ├── aac/                  # Local fallback (older Safari/iOS): one loop period, <track-id>.m4a
│           └── cast/                 # Remote playback: repeated ~120s programme, <track-id>.m4a
├── tests/                            # Unit tests (dependency-free)
│   ├── AGENTS.md                     # Running the suite, the app, and the browser
│   ├── playback-output-contract.test.js   # One spec, run against every PlaybackOutput incl. AudioPlayer
│   ├── *remote-playback*, providers/ # The plugin's own tests — see its AGENTS.md
│   └── helpers/                      # app-test-harness.js, popover-fakes.js, and the remote-playback fakes (see that plugin's AGENTS.md)
├── scripts/
│   ├── AGENTS.md                     # The generators: audio, icons, screenshots
│   ├── export-icons.mjs              # Icon PNG export from SVG sources
│   ├── capture-screenshots.mjs       # Manifest install-screenshot capture
│   ├── build-audio.mjs               # All three audio roles from masters/ (needs ffmpeg)
│   └── send-media-key.ps1            # OS-level media key injection for testing
├── .github/
│   └── workflows/
│       └── deploy.yml                # CI: `npm test` gates the Pages deploy (uploads src/)
├── Dockerfile                        # Multi-target image: default = Caddy + Node (serve + npm test); `--target serve` = slim Caddy-only runtime
├── .dockerignore                     # Excludes unnecessary files from the build
├── package.json                      # Scripts and metadata
├── package-lock.json                 # Locks the scripts/ devDependencies (playwright); npm test itself has none
├── masters/                          # Build inputs: gitignored audio + tracked provenance records
│   └── AGENTS.md                     # What a master must be, and how to supply one
├── .config.md                        # Per-developer configuration (gitignored)
├── AGENTS.md
├── CLAUDE.md                         # Includes AGENTS.md; keep the guidance itself in AGENTS.md
├── README.md
└── opencode.json
```

## Remote Playback

Chromecast and AirPlay are a detachable plugin in `src/js/remote-playback/`.

**Read [`src/js/remote-playback/AGENTS.md`](src/js/remote-playback/AGENTS.md)
before changing anything in that directory, its tests, or the handover region of
`script.js`.** It carries measured platform behaviour — silent picker rejections,
codec limits, device-only failures — that the test suite cannot show you and that
tidying will quietly undo.

**Never cast to a real device from an automated run.** It plays audio in
someone's room. Fakes cover everything except the manual checklist in its AGENTS.md.

## Agent Workflow

- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other
  git mutations unless explicitly asked.
- **Never stage or unstage anything on your own initiative.** Staging here is a
  review marker, not a commit being assembled: the maintainer stages a file once
  they have read it and are happy with it, so the index is the record of what
  has been reviewed. Unstaging destroys that record.
- Two things follow. Staging **moves while you work** — files unstaged when you
  started may be staged part-way through; that is review happening, not drift to
  report or correct. And **changing an already-staged file is ordinary work**:
  the new change appears as unstaged beside the staged one. Leave that split
  where it falls — it says what has been read and what has not.

## Nothing Machine-Specific in the Repo

- **Never commit anything true only on one machine** — absolute paths,
  usernames, emails, secrets, or the container engine a particular person uses.
  Paths are relative to the repo root; per-person settings go in the gitignored
  `.config.md`, and the docs use a placeholder like `<container-engine>`.
- **Binaries carry metadata too** — encoders copy tags from their input, so a
  master tagged with someone's name ships that name in `src/`. Encode with
  `-map_metadata -1`.
