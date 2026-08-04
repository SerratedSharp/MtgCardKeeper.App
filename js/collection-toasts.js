window.mckCollectionToasts = (function () {
    var listener = null;
    var media = window.matchMedia('(min-width: 768px)');

    function getMaxVisible() {
        return media.matches ? 3 : 2;
    }

    function watchMaxVisible(dotNetRef) {
        unwatchMaxVisible();
        listener = function () {
            dotNetRef.invokeMethodAsync('OnViewportBreakpointChanged');
        };
        if (media.addEventListener) {
            media.addEventListener('change', listener);
        } else {
            media.addListener(listener);
        }
    }

    function unwatchMaxVisible() {
        if (!listener) return;
        if (media.removeEventListener) {
            media.removeEventListener('change', listener);
        } else {
            media.removeListener(listener);
        }
        listener = null;
    }

    return {
        getMaxVisible: getMaxVisible,
        watchMaxVisible: watchMaxVisible,
        unwatchMaxVisible: unwatchMaxVisible
    };
})();
