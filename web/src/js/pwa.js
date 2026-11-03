const SERVICE_WORKER_URL = "./sw.js";

export function registerServiceWorker({
    serviceWorker = globalThis.navigator?.serviceWorker,
    location = globalThis.location,
    onFirstControl,
} = {}) {
    if (!serviceWorker || location?.protocol === "file:") {
        return false;
    }

    // No reload when it first takes control: sw.js claims the page as it
    // activates, so every request from then on goes through it, and a reload
    // would cut off a soundscape a first-time listener had just started. What
    // was fetched before then missed the worker's cache, though, so
    // onFirstControl is the chance to fetch it again.
    if (!serviceWorker.controller && typeof serviceWorker.addEventListener === "function") {
        serviceWorker.addEventListener("controllerchange", () => onFirstControl?.(), { once: true });
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
