window.mtgCardKeeper = window.mtgCardKeeper || {};

(function () {
    const tooltipOptions = {
        delay: { show: 0, hide: 100 },
        trigger: 'hover focus'
    };

    function getEl(id) {
        return document.getElementById(id);
    }

    function enable(id, text) {
        const el = getEl(id);
        if (!el || !window.bootstrap?.Tooltip) {
            return;
        }

        disable(id);
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('data-bs-title', text);
        el.setAttribute('data-bs-placement', 'top');
        window.bootstrap.Tooltip.getOrCreateInstance(el, tooltipOptions);
    }

    function disable(id) {
        const el = getEl(id);
        if (!el) {
            return;
        }

        const instance = window.bootstrap?.Tooltip?.getInstance(el);
        if (instance) {
            instance.dispose();
        }

        el.removeAttribute('data-bs-toggle');
        el.removeAttribute('data-bs-title');
        el.removeAttribute('data-bs-placement');
        el.removeAttribute('aria-describedby');
    }

    window.mtgCardKeeper.tooltips = {
        enable: enable,
        disable: disable
    };

    window.mtgCardKeeper.getBuildVersion = function () {
        const el = document.querySelector('meta[name="mck-build"]');
        return el?.getAttribute('content') || 'local';
    };

    // Double rAF: Task.Delay(1) does not produce a paint on Chrome Android.
    window.mtgCardKeeper.yieldToPaint = function () {
        return new Promise(function (resolve) {
            requestAnimationFrame(function () {
                requestAnimationFrame(resolve);
            });
        });
    };

    window.mtgCardKeeper.readInputFileAsText = function (inputId) {
        const el = document.getElementById(inputId);
        const file = el && el.files && el.files[0];
        if (!file) {
            return Promise.reject(new Error('No file selected'));
        }
        return file.text();
    };
})();
