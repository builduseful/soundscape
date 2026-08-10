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

// Surfaces Chromium's install offer as a menu item. `beforeinstallprompt` is
// single-use — `.prompt()` spends it either way, and no second offer arrives
// without a fresh page load — so the button is shown the moment it's captured
// and hidden the moment it's spent. Already-standalone contexts and browsers
// without the API (Safari, Firefox) return false and register no listeners.
export function registerInstallPrompt(button, { scope = globalThis } = {}) {
    if (!button) return false;

    const isStandalone = Boolean(scope.matchMedia?.("(display-mode: standalone)").matches)
        || scope.navigator?.standalone === true;

    if (isStandalone) return false;

    let deferredPrompt = null;

    scope.addEventListener?.("beforeinstallprompt", (event) => {
        event.preventDefault();
        deferredPrompt = event;
        button.hidden = false;
    });

    scope.addEventListener?.("appinstalled", () => {
        deferredPrompt = null;
        button.hidden = true;
    });

    button.addEventListener("click", () => {
        if (!deferredPrompt) return;

        const prompt = deferredPrompt;

        deferredPrompt = null;
        button.hidden = true;
        prompt.prompt();
    });

    return true;
}

// Progressive enhancement for the Launch Queue API. With the manifest's
// launch_handler client_mode set to "focus-existing", launches of an
// already-running instance (e.g. app shortcut clicks) are delivered to the
// consumer instead of opening a second window.
export function registerLaunchQueueConsumer(consumer, {
    launchQueue = globalThis.launchQueue,
} = {}) {
    if (typeof consumer !== "function" || typeof launchQueue?.setConsumer !== "function") {
        return false;
    }

    launchQueue.setConsumer(consumer);
    return true;
}
