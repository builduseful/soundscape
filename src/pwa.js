const SERVICE_WORKER_URL = "./sw.js";

export function registerServiceWorker({
    serviceWorker = globalThis.navigator?.serviceWorker,
    location = globalThis.location,
} = {}) {
    if (!serviceWorker || location?.protocol === "file:") {
        return false;
    }

    serviceWorker.register(SERVICE_WORKER_URL).catch((error) => {
        console.warn("Soundscape offline support could not be installed.", error);
    });

    return true;
}
