window.mtgCardKeeper = window.mtgCardKeeper || {};

/** Tile grid column counts: 1 below 400px, then Bootstrap md/lg/xl (768/992/1200). */
window.mtgCardKeeper.getBootstrapColumnCount = function () {
    const w = window.innerWidth;
    if (w >= 1200) return 6; // xl
    if (w >= 992) return 4;  // lg
    if (w >= 768) return 3;  // md
    if (w >= 400) return 2;  // custom (below Bootstrap sm)
    return 1;
};

(function () {
    let lastCols = -1;
    let resizeHandler = null;
    let dotNetRef = null;

    function notify() {
        if (!dotNetRef)
            return;
        const cols = window.mtgCardKeeper.getBootstrapColumnCount();
        if (cols === lastCols)
            return;
        lastCols = cols;
        dotNetRef.invokeMethodAsync('OnColumnCountChanged', cols);
    }

    /**
     * Notifies Blazor when the Bootstrap column count changes.
     * @param {any} ref DotNetObjectReference with OnColumnCountChanged(int)
     */
    window.mtgCardKeeper.subscribeBootstrapColumnCount = function (ref) {
        window.mtgCardKeeper.unsubscribeBootstrapColumnCount();
        dotNetRef = ref;
        lastCols = -1;
        resizeHandler = notify;
        window.addEventListener('resize', resizeHandler);
        notify();
    };

    window.mtgCardKeeper.unsubscribeBootstrapColumnCount = function () {
        if (resizeHandler)
            window.removeEventListener('resize', resizeHandler);
        resizeHandler = null;
        dotNetRef = null;
        lastCols = -1;
    };
})();
