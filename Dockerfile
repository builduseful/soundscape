# Base images are pinned by tag AND digest (digests verified against Docker Hub
# on 2026-07-18). Update the tag and digest together; Dependabot or Renovate can
# automate digest bumps.
#   caddy:2-alpine  → tag last published 2026-06-24
#   node:26-alpine  → tag last published 2026-07-08
FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS caddy

# ── serve: slim runtime image (Caddy only, ~50 MB, no Node) ─────────────────
# Build explicitly with: <container-engine> build --tag soundscape --target serve .
FROM caddy AS serve

LABEL org.opencontainers.image.title="Soundscape" \
      org.opencontainers.image.description="A calm ambience player for seamless looping background audio."

# /srv (not /app like the dev stage): this stage has no bind mount, so the
# path only needs to match --root in the CMD below.
WORKDIR /srv

COPY . .

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

CMD ["caddy", "file-server", "--listen", ":80", "--root", "/srv"]

# ── dev (default target): Caddy + Node, also used for `npm test` ────────────
# This is the final stage on purpose: `container build --tag soundscape .`
# builds it, so every documented command keeps working unchanged.
FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS dev

LABEL org.opencontainers.image.title="Soundscape (dev)" \
      org.opencontainers.image.description="A calm ambience player for seamless looping background audio. Dev image: Caddy for serving, Node for npm test."

# Copy the official Caddy binary from the upstream image.
# Caddy is a statically linked Go binary — no runtime library
# dependencies, so it runs identically on any Alpine-based image.
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

# /app is intentional: WORKDIR, the --volume ${PWD}:/app bind mount in
# AGENTS.md, and --root in the CMD below must all match. That trio is what
# makes live source edits on the host visible to Caddy without rebuilding.
# Changing this path also requires updating the bind mount in AGENTS.md.
WORKDIR /app

COPY . .

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1

# Default: serve static files with Caddy's file-server.
# Override the command for tests:
#   <container-engine> container run --rm soundscape npm test
CMD ["caddy", "file-server", "--listen", ":80", "--root", "/app"]
