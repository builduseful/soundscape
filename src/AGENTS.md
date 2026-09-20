# Service worker, cache and versioning

**Any change to a deployed asset under `src/` needs a version bump**, even when
nothing is user-facing — otherwise the cache is not invalidated and a returning
visitor gets a half-old shell. The exception is the `AGENTS.md` files that sit
beside the code they govern: the browser never requests them, and
`tests/pwa.test.js` already excludes them from the precache for that reason.

## Versioning

- **`VERSION` lives in three places you edit** — `package.json`, `sw.js`,
  `script.js` — and all three move together on every release;
  `tests/version-sync.test.js` enforces that. (`tests/pwa.test.js` covers a
  neighbouring rule: that `sw.js` hardcodes `VERSION` rather than importing it.)
  A fourth, `package-lock.json`, is generated rather than edited: re-sync it
  with `npm install --package-lock-only` after the bump. `version-sync` pins it
  too, because nothing else would notice it falling behind.
- Semantic versioning: patch for fixes, minor for features, major for breaking
  changes.
- **Version and tag move together.** Before a commit to `trunk`, or before
  opening a PR, propose the bump and a matching `v<version>` tag and wait for a
  yes or no.
- **The bump can ride in the PR; the tag cannot.** Tag on `trunk` after the
  merge — rebasing and squashing rewrite the commit it would point at. Tags are
  annotated; `git push --follow-tags` sends them.

## The cache

- **One cache, named `soundscape-v{VERSION}`.** Changing `VERSION` is the only
  way to wipe it, and the only invalidation lever the app has.
- **Files are cached up front, at install** (the "precache"). The list is split
  by how badly the app needs each entry, not into separate caches:
  - `APP_SHELL_ASSETS` — markup, styles, modules. A missing entry fails the
    install, because the app cannot start without it.
  - `OPTIONAL_ASSETS` — icons. Best effort, so one bad icon cannot cost the app
    every bit of offline support.

  The fetch uses `cache: "no-cache"`, which asks the server to confirm each file
  is unchanged rather than trusting a stale copy — which is why this works the
  same on any host. `tests/pwa.test.js` checks the two lists together cover
  everything deployable under `src/`.
- Screenshots are excluded from the precache (`tests/pwa.test.js` filters
  `./resources/screenshots/`) — they are only fetched by the OS install UI
  before the app is installed, never by the running page. Icons remain part of
  `OPTIONAL_ASSETS`.

## Two things not to "fix"

- Do not make `sw.js` a module that imports `VERSION`. Browsers detect a service
  worker update by comparing the worker file's own bytes, so the change has to
  land in `sw.js` itself.
- Do not split into separate shell/audio caches, hash the asset lists, or add
  HTTP `Cache-Control` config. The service worker is the only cache that matters
  here.

## Deploy

`.github/workflows/deploy.yml` runs `npm test` on every push to `trunk` and on
every pull request against it. GitHub Pages publishes `src/` as-is if the tests
pass, and never from a pull request. Three details there are deliberate:

- **Only named events may publish**, and the deploy job pins the branch to
  `trunk`. Listing what may publish is safer than excluding what may not —
  `workflow_dispatch` (the manual "run workflow" button) can otherwise be
  triggered from any branch.
- **Concurrency is set per job, not per workflow.** At workflow level every pull
  request would join the Pages group, where a pending run cancels the one
  before it.
- **No `npm ci`, and no Docker build.** The suite imports only Node built-ins
  and `src/js`, so it runs from a bare checkout; the single dev dependency
  (playwright) belongs to `scripts/`, which CI never runs. The Docker image
  exists to make *local* runs match each other, and the CI runner is already a
  clean Linux box with the right Node.

`src/CNAME` rides along in that upload and is what puts the site on its own
domain. It is the one file under `src/` the browser never requests, which is why
`tests/pwa.test.js` exempts it from the precache alongside `sw.js`.
