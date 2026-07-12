const SERVICE_WORKER_URL = "./sw.js";

export function registerServiceWorker({
    serviceWorker = globalThis.navigator?.serviceWorker,
    location = globalThis.location,
} = {}) {
    if (!serviceWorker || location?.protocol === "file:") {
        return false;
    }

    // On the very first visit the page may load before the service worker has
    // claimed it. When a controller appears for the first time, reload once so
    // subsequent navigations (and cached audio requests) are handled by the SW.
    if (typeof serviceWorker.addEventListener === "function") {
        let wasControlled = Boolean(serviceWorker.controller);

        serviceWorker.addEventListener("controllerchange", () => {
            if (!wasControlled) {
                wasControlled = true;
                location.reload();
            }
        });
    }

    serviceWorker.register(SERVICE_WORKER_URL).catch((error) => {
        console.warn("Soundscape offline support could not be installed.", error);
    });

    return true;
}
