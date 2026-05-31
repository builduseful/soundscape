const CACHE_NAME = "soundscape-v2026-05-31-1";

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

const PRECACHE_ASSETS = [
    ...APP_SHELL_ASSETS,
    ...AUDIO_ASSETS,
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_ASSETS))
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

    event.respondWith(cacheFirst(request));
});

async function handleNavigation(request) {
    const cache = await caches.open(CACHE_NAME);

    try {
        const response = await fetch(request);
        await cache.put("./index.html", response.clone());
        return response;
    } catch (error) {
        return await cache.match("./index.html") ?? Response.error();
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request, { ignoreSearch: true });

    if (cachedResponse) return cachedResponse;

    const response = await fetch(request);

    if (response.ok) {
        await cache.put(request, response.clone());
    }

    return response;
}

async function handleRangeRequest(request) {
    const cache = await caches.open(CACHE_NAME);
    let response = await cache.match(request, { ignoreSearch: true });

    if (!response) {
        response = await fetchWithoutRange(request);

        if (response.ok) {
            await cache.put(request.url, response.clone());
        }
    }

    return createPartialResponse(request, response);
}

async function fetchWithoutRange(request) {
    const headers = new Headers(request.headers);

    headers.delete("range");

    return await fetch(new Request(request.url, {
        cache: request.cache,
        credentials: request.credentials,
        headers,
        integrity: request.integrity,
        mode: request.mode === "navigate" ? "same-origin" : request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
    }));
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
