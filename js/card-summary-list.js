window.mtgCardKeeper = window.mtgCardKeeper || {};

/** Bootstrap 5 breakpoints matching CardSummaryList row-cols-1/sm-2/md-3/lg-4/xl-6. */
window.mtgCardKeeper.getBootstrapColumnCount = function () {
    const w = window.innerWidth;
    if (w >= 1200) return 6; // xl
    if (w >= 992) return 4;  // lg
    if (w >= 768) return 3;  // md
    if (w >= 576) return 2;  // sm
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
