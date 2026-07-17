const CACHE_NAME = "soundscape-v2026-07-17-1";

const APP_SHELL_ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.webmanifest",
    "./src/audio-player.js",
    "./src/media-session.js",
    "./src/pwa.js",
    "./src/theme-utils.js",
    "./src/tracks.js",
    "./src/components/theme-selector.js",
    "./src/components/volume-control.js",
    "./resources/icons/apple-touch-icon.png",
    "./resources/icons/favicon-16.png",
    "./resources/icons/favicon-32.png",
    "./resources/icons/icon-192.png",
    "./resources/icons/icon-512.png",
    "./resources/icons/maskable-icon-512.png",
    "./resources/icons/icon.svg",
    "./resources/icons/maskable-icon.svg",
];

const AUDIO_ASSETS = [
    "./resources/soundscapes/rain_loopable.opus",
    "./resources/soundscapes/rain_garden_loopable.opus",
    "./resources/soundscapes/rain-from-room-loop-smallest.opus",
    "./resources/soundscapes/rain_thunder_storm_loopable.opus",
    "./resources/soundscapes/rain-and-thunder-loop.opus",
    "./resources/soundscapes/fireplace_crackle_loopable.opus",
    "./resources/soundscapes/fireplace_low_rumble_loopable.opus",
    "./resources/soundscapes/open-road-loop.opus",
    "./resources/soundscapes/brown-noise-loop.opus",
    "./resources/soundscapes/pink-noise-loop.opus",
    "./resources/soundscapes/white-noise-loop.opus",
];

// Only the app shell is precached at install time (≈108 KB). Audio files are
// cached on-demand when the user plays a track — the sanitization in
// cacheIfOk guarantees offline-safe entries without an upfront download of
// the full catalog.
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => precacheAll(cache, APP_SHELL_ASSETS))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
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

    if (request.headers.has("range")) {
        event.respondWith(handleRangeRequest(request));
        return;
    }

    event.respondWith(tryCacheThenFetch(request));
});

async function handleNavigation(request) {
    const cache = await caches.open(CACHE_NAME);
    const indexKey = new URL("./index.html", self.location.origin).href;

    try {
        const response = await fetch(request);
        await cacheIfOk(cache, indexKey, response);
        return response;
    } catch {
        return await cache.match(indexKey) ?? Response.error();
    }
}



// Cache non-range requests under the original request URL. We intentionally do
// NOT use cleanCacheKey() here: it strips headers but preserves query params, so
// cache-busting URLs like script.js?v=... would still create duplicate cache
// entries under different keys. ignoreSearch: true makes lookup work across
// query-param variants while keeping storage keyed on the actual request.
async function tryCacheThenFetch(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, { ignoreSearch: true });

    if (cachedResponse) return cachedResponse;

    const response = await fetch(request);
    await cacheIfOk(cache, request, response);
    return response;
}

async function handleRangeRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = cleanCacheKey(request);

    let response = await cache.match(cacheKey, { ignoreSearch: true });

    // A partial (206) response can't be used to serve arbitrary byte ranges,
    // so fetch the full resource when the cache is missing or contains a fragment.
    if (!response || response.status === 206) {
        response = await fetchWithoutRange(request);
        await cacheIfOk(cache, cacheKey, response);
    }

    return createPartialResponse(request, response);
}

async function fetchWithoutRange(request) {
    const headers = new Headers(request.headers);
    headers.delete("range");
    // Strip conditional headers so the network fetch returns the full 200 response
    // instead of a 304; SW cache entries are 200s, and 304 bodies are empty.
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    return fetch(new Request(request.url, { headers, cache: "no-store" }));
}

// Precaching goes through fetch + cacheIfOk instead of cache.addAll on
// purpose: addAll can store an already-decoded body together with the
// original Content-Encoding header (e.g. brotli), and serving such an entry
// from the cache makes the browser try to decode plain bytes again, which
// kills offline navigations with net::ERR_FAILED.
async function precacheAll(cache, urls) {
    await Promise.all(urls.map(async (url) => {
        const response = await fetch(new Request(url, { cache: "no-cache" }));

        if (!response.ok) {
            throw new Error(`Could not precache ${url}: ${response.status} ${response.statusText}`);
        }

        await cacheIfOk(cache, url, response);
    }));
}

async function cacheIfOk(cache, key, response) {
    if (!response.ok || response.status !== 200) return;

    // Store a sanitized copy. The body reaching the service worker has already
    // been content-decoded, so a stored Content-Encoding header poisons the
    // entry (the browser would try to decode plain bytes again when it is
    // served back). Vary: Accept-Encoding makes cache lookups depend on the
    // requester's encoding headers even though the stored body is identical,
    // and Content-Length must match the stored body. Hop-by-hop headers do not
    // belong in a cache at all.
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

function cleanCacheKey(request) {
    return new Request(request.url, {
        cache: request.cache,
        credentials: request.credentials,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
    });
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
