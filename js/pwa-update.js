(function () {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    const build = document.querySelector('meta[name="mck-build"]')?.getAttribute('content');
    if (!build || build === 'local') {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            registrations.forEach(function (registration) {
                registration.unregister();
            });
        });
        return;
    }

    const coldStartMs = 8000;
    const updateIntervalMs = 60 * 60 * 1000;
    const reloadFlagKey = 'mck-pwa-reloading';
    const loadedAt = Date.now();

    const banner = document.getElementById('mck-pwa-update');
    const reloadButton = document.getElementById('mck-pwa-update-reload');

    let registration = null;
    let reloadArmed = false;
    let justBecameVisible = false;
    const skipControllerChangeReload = sessionStorage.getItem(reloadFlagKey) === '1';
    if (skipControllerChangeReload) {
        sessionStorage.removeItem(reloadFlagKey);
    }

    function isColdStart() {
        return Date.now() - loadedAt < coldStartMs;
    }

    function shouldAutoTakeover() {
        return isColdStart()
            || document.visibilityState === 'hidden'
            || justBecameVisible;
    }

    function showBanner() {
        if (banner) {
            banner.hidden = false;
        }
    }

    function handleWaiting() {
        if (!registration || !registration.waiting) {
            return;
        }

        if (shouldAutoTakeover()) {
            requestTakeover();
            return;
        }

        showBanner();
    }

    function requestTakeover() {
        if (reloadArmed || !registration || !registration.waiting) {
            return;
        }

        reloadArmed = true;
        registration.waiting.postMessage('SKIP_WAITING');
    }

    function bindRegistration(reg) {
        registration = reg;
        handleWaiting();

        reg.addEventListener('updatefound', function () {
            const installing = reg.installing;
            if (!installing) {
                return;
            }

            installing.addEventListener('statechange', function () {
                if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                    handleWaiting();
                }
            });
        });
    }

    async function checkForUpdate() {
        if (!registration) {
            return;
        }

        try {
            await registration.update();
        } catch {
            // Offline or HTTP cache miss is expected; ignore.
        }

        handleWaiting();
    }

    navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (skipControllerChangeReload || !reloadArmed) {
            return;
        }

        sessionStorage.setItem(reloadFlagKey, '1');
        window.location.reload();
    });

    navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
        .then(function (reg) {
            bindRegistration(reg);
            checkForUpdate();
            window.setInterval(checkForUpdate, updateIntervalMs);
        })
        .catch(function () {
            // Registration can fail on unsupported origins; the app still runs.
        });

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible') {
            return;
        }

        justBecameVisible = true;
        handleWaiting();
        justBecameVisible = false;
        checkForUpdate();
    });

    if (reloadButton) {
        reloadButton.addEventListener('click', function () {
            requestTakeover();
        });
    }
})();
