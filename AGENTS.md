# Repository Guidelines

## Overview

Soundscape plays looping ambient background audio — rain, thunderstorms,
fireplace, open road, and white/pink/brown noise. It has play/pause/prev/next
controls, a volume slider, light/dark/system themes, and it remembers your
volume, theme and track. It responds to the media keys and to the playback
controls the OS shows in its notification area. The loops are gapless, which is
harder than it sounds and is the reason for most of the audio rules.

It ships as a web app (a PWA that works offline once installed). A native
Android app is being built to match it, with iOS likely later. The plan, and
progress against it, is [`docs/native-apps-plan.md`](docs/native-apps-plan.md).

## Where the rules live

This file is the entry point: what holds for the whole repo, on every platform.
Everything else lives beside what it governs, in a nested `AGENTS.md`. Read the
one for what you are touching before you touch it.

| I want to… | Read |
|---|---|
| Work on the web app: run, test, change, ship it | [`web/AGENTS.md`](web/AGENTS.md) |
| Work on the Android app: build, test, run it | [`android/AGENTS.md`](android/AGENTS.md) |
| Change a track, a colour, a size, a timing or any wording | [`shared/AGENTS.md`](shared/AGENTS.md) |
| Rebuild the audio | [`scripts/AGENTS.md`](scripts/AGENTS.md) |
| Supply a new audio master | [`masters/AGENTS.md`](masters/AGENTS.md) |

## One product, several platforms

The web app is the reference. Every platform looks, sounds and behaves like it:
the same tracks in the same order, the same controls, wording, colours, sizes
and timings. A change to any of those lands on every platform in the same pull
request, or it is not done. Platforms share **data, not code**: the contract in
`shared/`, which each platform's tests check it against, and the audio, whose
one source is `masters/`.

## How To Work On This

Work on every platform — implementation, refactoring, design, and the shape of
the code — as an experienced engineer who cares about the craft and is building
something meant to last. Prefer what the platform already does well, keep state
explicit rather than inferred, and settle each thing in one place. Keep the
rules of the product apart from the platform that runs them and the UI that
shows them. Run the app and look at it, in both themes, before calling it done.

**Efficient, and plainly so.** Every platform should be as fast, responsive and
light as it can be — in memory, CPU and battery, while playing and while idle —
and get there with clean, straightforward code, never with hacks. When the two
seem to pull apart, find the simple design that is also the efficient one;
measure rather than assume. This is part of every change and every test run,
not a later pass: ask what the change costs while playing and while idle, and
keep the performance tests passing — a budget is raised only with the
maintainer's agreement, never to make a test pass.

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
  that gets believed. `CLAUDE.md` only includes this file; guidance itself never
  goes there.

## Project Structure

```
soundscape/
├── web/                   # The web app: deploy folder, tests, container (+ AGENTS.md)
├── android/               # The Android app: Gradle project, core/ and app/ (+ AGENTS.md)
├── shared/                # The cross-platform contract: catalog, tokens, copy, fixtures
├── scripts/               # Repo-wide generators: the audio build, the shared fixtures
├── masters/               # The audio: finished-loop masters and their provenance
├── docs/                  # Plans and decisions that span platforms
├── .opencode/skills/      # playwright-cli (browser testing), git-commit
├── .github/workflows/     # CI: web tests gate the Pages deploy; Android lint, tests, build
└── .config.md             # Per-developer configuration (gitignored)
```

Directories only, and deliberately: a per-file listing here is a second copy of
what the routing table above and each nested `AGENTS.md` already say — and it
is always the copy that goes stale.

## Agent Workflow

- **Work on `trunk`** unless asked to use another branch.
- Do not run `git commit`, `git push`, `git reset`, `git rebase`, or any other
  git mutations unless explicitly asked.
- **A patch bump need not wait.** When a change calls for only the smallest
  version increment (a patch) on any platform and the maintainer has not
  answered the proposal within about a minute, make the bump and commit it with
  the change, but do not push. Anything larger waits for a yes.
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
  master tagged with someone's name ships that name in `web/src/`, and the
  masters themselves are committed and in the APK. Encode with
  `-map_metadata -1`; a master with tags in it fails `MastersTest`.
