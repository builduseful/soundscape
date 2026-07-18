FROM caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648 AS caddy

FROM node:26-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66

# Copy the official Caddy binary from the upstream image.
# Caddy is a statically linked Go binary — no runtime library
# dependencies, so it runs identically on any Alpine-based image.
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy

WORKDIR /app

COPY . .

EXPOSE 4321

# Default: serve static files with Caddy's file-server.
# Override the command for tests:
#   <container-engine> container run --rm soundscape npm test
CMD ["caddy", "file-server", "--listen", ":4321", "--root", "/app"]
