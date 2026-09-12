// Mirror script.js and package.json (the version-sync tests enforce).
// Bumping it invalidates the cache: sw.js bytes change, the browser sees a
// new SW, the activate handler wipes the old cache. Hardcoded here, not
// imported, so the byte-change lands in sw.js itself — which is what the
// browser's SW update is gated on.
const VERSION = "1.20.0";

const CACHE_NAME = `soundscape-v${VERSION}`;

// Precached at install; audio is cached on demand. Everything here is needed to
// boot offline, so a failure fails the install — a half-cached shell is worse
// than no offline support at all.
const APP_SHELL_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.webmanifest",
    "./js/script.js",
    "./js/audio-player.js",
    "./js/local-source.js",
    "./js/playback-output.js",
    "./js/remote-playback/index.js",
    "./js/remote-playback/messages.js",
    "./js/remote-playback/track-source.js",
    "./js/remote-playback/providers/airplay.js",
    "./js/remote-playback/providers/airplay-icon.js",
    "./js/remote-playback/providers/cast-sdk.js",
    "./js/remote-playback/providers/cast-icon.js",
    "./js/media-session.js",
    "./js/pwa.js",
    "./js/theme-utils.js",
    "./js/tracks.js",
    "./js/components/app-menu.js",
    "./js/remote-playback/control.js",
    "./js/components/theme-selector.js",
    "./js/components/volume-control.js",
];

// Cached best-effort: a missing icon should cost you an icon, not the entire
// offline experience, so these never fail the install.
const OPTIONAL_ASSETS = [
    "./resources/icons/apple-touch-icon.png",
    "./resources/icons/favicon-16.png",
    "./resources/icons/favicon-32.png",
    "./resources/icons/icon-96.png",
    "./resources/icons/icon-128.png",
    "./resources/icons/icon-192.png",
    "./resources/icons/icon-256.png",
    "./resources/icons/icon-384.png",
    "./resources/icons/icon-512.png",
    "./resources/icons/maskable-icon-512.png",
    "./resources/icons/icon.svg",
    "./resources/icons/maskable-icon.svg",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(async (cache) => {
                await precacheAll(cache, APP_SHELL_ASSETS);
                await precacheOptional(cache, OPTIONAL_ASSETS);
            })
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    // Drop any stale soundscape-* cache from a prior deploy (handles legacy
    // names like the old date-stamped cache and the shell/audio split too,
    // since they all start with the same prefix).
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(cacheNames
                .filter((cacheName) => cacheName.startsWith("soundscape-") && cacheName !== CACHE_NAME)
                .map((cacheName) => caches.delete(cacheName))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;

    if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(handleNavigation(request));
        return;
    }

    // The one place remote playback reaches into the service worker, and a
    // deliberate exception rather than an oversight: everything else about the
    // feature is confined to js/remote-playback/, but this worker cannot import
    // from it. It must stay a classic worker with VERSION hardcoded, because the
    // browser gates its update on this file's own bytes changing — so the cast
    // directory is named here by hand.
    //
    // Not a caching preference. Handling these would mean reading each one whole
    // whatever was asked for: cacheIfOk buffers the body, and handleRangeRequest
    // upgrades a range miss to a full fetch. The transport element asks for
    // ranges — it never wants the whole file up front — so every one of those
    // partial reads would become a megabyte. Left alone, the browser gets exactly
    // the bytes it asked for and its own HTTP cache handles the repeat.
    //
    // The consequence to accept: casting needs the network. That is true of the
    // Chrome Android path regardless, since there the receiver does the fetching.
    if (isRemotePlaybackAsset(request)) {
        return;
    }

    if (request.headers.has("range")) {
        event.respondWith(handleRangeRequest(request));
        return;
    }

    event.respondWith(tryCacheThenFetch(request));
});

// The cast twins, identified by the directory they live in rather than by their
// extension. Extension is the wrong test now that a local fallback may also be
// .m4a: the two are different products — different loop treatment, different
// consumer — and only the cast one may skip the worker. A local file that
// bypassed it would silently lose offline playback.
//
// Matched relative to the worker's own scope, not as an absolute path, so this
// keeps working if the app is ever served from a subdirectory. `registration`
// is available to a service worker at module scope.
function isRemotePlaybackAsset(request) {
    const scopePath = new URL(registration.scope).pathname;
    const { pathname } = new URL(request.url);

    return pathname.startsWith(`${scopePath}resources/soundscapes/cast/`);
}

// Cache-first navigation, matched against the page that was actually asked
// for. Answering every navigation with index.html — which this did until the
// cast diagnostic page came along and could not be reached — makes the app the
// only page the site has: any second page (an about page, a licence page)
// silently serves the app instead, and only an uninstalled visitor with an
// empty cache ever sees the real thing.
//
// index.html stays the *offline* fallback, which is the case it was written
// for: a navigation to a page that was never cached, with no network to fetch
// it from, is better answered by the app than by a browser error page.
//
// Any shell update that should reach returning users must change CACHE_NAME —
// bump VERSION.
async function handleNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });

    if (cached) return cached;

    try {
        const response = await fetch(request);

        await cacheIfOk(cache, request, response);

        return response;
    } catch {
        const indexKey = new URL("./index.html", self.location.origin).href;

        return await cache.match(indexKey) ?? Response.error();
    }
}

// Cache-first for everything else. ignoreSearch keeps `script.js?v=...`
// from creating duplicate cache entries.
async function tryCacheThenFetch(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, { ignoreSearch: true });

    if (cachedResponse) return cachedResponse;

    try {
        const response = await fetch(request);
        await cacheIfOk(cache, request, response);
        return response;
    } catch {
        return offlineResponse();
    }
}

async function handleRangeRequest(request) {
    const cache = await caches.open(CACHE_NAME);

    let response = await cache.match(request, { ignoreSearch: true });

    // A 206 cached response can't be used to serve arbitrary byte ranges; fetch
    // the full resource instead.
    if (!response || response.status === 206) {
        try {
            response = await fetchWithoutRange(request);
        } catch {
            return offlineResponse();
        }

        await cacheIfOk(cache, request, response);
    }

    return createPartialResponse(request, response);
}

// Audio is cached on demand, so a track the user has never played is simply not
// there when the network is gone. Resolving with a real response lets the app's
// error handling run and tell the user, instead of surfacing an opaque
// net::ERR_FAILED that looks like the app is broken.
function offlineResponse() {
    return new Response("", { status: 504, statusText: "Offline" });
}

// Precaching uses fetch + cacheIfOk (not cache.addAll) to avoid storing a
// decoded body with the original Content-Encoding header, which would break
// offline navigations with net::ERR_FAILED. `cache: "no-cache"` forces an
// If-None-Match revalidation on every install, so the precache gets the
// freshest version of each asset regardless of the HTTP server's
// Cache-Control — that's what makes the design host-agnostic.
async function precacheAll(cache, urls) {
    await Promise.all(urls.map(async (url) => {
        const response = await fetch(new Request(url, { cache: "no-cache" }));

        if (!response.ok) {
            throw new Error(`Could not precache ${url}: ${response.status} ${response.statusText}`);
        }

        await cacheIfOk(cache, url, response);
    }));
}

// Same revalidating fetch, but one bad asset only loses that asset.
async function precacheOptional(cache, urls) {
    await Promise.all(urls.map(async (url) => {
        try {
            const response = await fetch(new Request(url, { cache: "no-cache" }));

            if (response.ok) {
                await cacheIfOk(cache, url, response);
            }
        } catch {
            // Best effort by design.
        }
    }));
}

// The fetched response body has already been decoded by the browser's fetch
// layer, so a stored Content-Encoding header would poison the entry (the
// browser would try to decode plain bytes again). Vary: Accept-Encoding must
// also go, and Content-Length must match the stored body. Hop-by-hop headers
// don't belong in a cache at all.
async function cacheIfOk(cache, key, response) {
    if (!response.ok || response.status !== 200) return;

    const buffer = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);

    headers.delete("content-encoding");
    headers.delete("vary");
    headers.delete("connection");
    headers.delete("keep-alive");
    headers.set("content-length", String(buffer.byteLength));

    await cache.put(key, new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers,
    }));
}

// Strip the Range header and the conditional headers (If-None-Match,
// If-Modified-Since) so the network fetch returns a full 200 instead of a
// 304 (whose body is empty) or a 206.
async function fetchWithoutRange(request) {
    const headers = new Headers(request.headers);
    headers.delete("range");
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    return fetch(new Request(request.url, { headers, cache: "no-store" }));
}

async function createPartialResponse(request, response) {
    if (!response.ok) return response;

    const range = parseRangeHeader(request.headers.get("range"));

    if (!range) return response;

    const buffer = await response.arrayBuffer();
    const size = buffer.byteLength;
    const start = range.start ?? Math.max(size - range.suffixLength, 0);
    const end = Math.min(range.end ?? size - 1, size - 1);

    if (start >= size || end < start) {
        return new Response(null, {
            status: 416,
            statusText: "Range Not Satisfiable",
            headers: {
                "Content-Range": `bytes */${size}`,
            },
        });
    }

    const body = buffer.slice(start, end + 1);
    const headers = new Headers(response.headers);

    headers.delete("content-encoding");
    headers.delete("vary");
    headers.delete("connection");
    headers.delete("keep-alive");
    headers.set("Accept-Ranges", "bytes");
    headers.set("Content-Length", String(body.byteLength));
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

    return new Response(body, {
        status: 206,
        statusText: "Partial Content",
        headers,
    });
}

function parseRangeHeader(rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader ?? "");

    if (!match) return null;

    const [, rawStart, rawEnd] = match;

    if (!rawStart && !rawEnd) return null;

    if (!rawStart) {
        return { suffixLength: Number(rawEnd) };
    }

    return {
        start: Number(rawStart),
        end: rawEnd ? Number(rawEnd) : undefined,
    };
}
