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

(function () {
    const FAST_PX_PER_MS = 2.0;
    const SLOW_PX_PER_MS = 0.6;
    const MIN_DELTA_PX = 8;
    const FAST_SINGLE_DELTA_PX = 180;
    const MAX_SAMPLE_MS = 100;
    const PAUSE_MS = 800;
    const SLOW_RESUME_MS = 200;
    const AHEAD_PX = 15 * 340;
    const FACE_IMG_SELECTOR = '.cardSummaryList img.card-face-img[data-lo-src]';
    const PLACEHOLDER_ATTR = 'data-fast-placeholder';

    let lastY = 0;
    let lastT = 0;
    let scrollDir = 1;
    let useLow = false;
    let enterCount = 0;
    let pauseTimer = null;
    let slowSince = 0;
    let scrollHandler = null;
    let fastScrollRef = null;
    let mutationObserver = null;
    let observedRoot = null;
    let applyingSrcs = false;

    function getCardListScroller() {
        const list = document.querySelector('.cardSummaryList');
        if (!list)
            return document.scrollingElement || document.documentElement;
        let el = list.parentElement;
        while (el && el !== document.body && el !== document.documentElement) {
            const style = window.getComputedStyle(el);
            const oy = style.overflowY;
            if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1)
                return el;
            el = el.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    function isWindowScroller(scroller) {
        return !scroller || scroller === window || scroller === document.scrollingElement
            || scroller === document.documentElement || scroller === document.body;
    }

    function readY(scroller) {
        if (isWindowScroller(scroller))
            return window.scrollY || window.pageYOffset || 0;
        return scroller.scrollTop;
    }

    function getViewport(scroller) {
        if (isWindowScroller(scroller))
            return { top: 0, bottom: window.innerHeight };
        const r = scroller.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
    }

    function isListScrollerEvent(e, scroller) {
        const target = e.target === document
            ? (document.scrollingElement || document.documentElement)
            : e.target;
        if (target === scroller)
            return true;
        if (scroller === document.scrollingElement || scroller === document.documentElement) {
            return target === document.documentElement || target === document.body
                || target === document.scrollingElement;
        }
        return false;
    }

    function isHiLoaded(img) {
        const hi = img.getAttribute('data-hi-src');
        if (!hi)
            return false;
        if (img.dataset.hiLoaded && img.dataset.hiLoaded !== hi)
            delete img.dataset.hiLoaded;
        return img.dataset.hiLoaded === hi;
    }

    function markHiLoadedIfReady(img) {
        if (!(img instanceof HTMLImageElement))
            return;
        const hi = img.getAttribute('data-hi-src');
        if (!hi)
            return;
        if (img.getAttribute('src') !== hi)
            return;
        if (!img.complete || img.naturalWidth <= 0)
            return;
        img.dataset.hiLoaded = hi;
        img.removeAttribute(PLACEHOLDER_ATTR);
    }

    function scanHiLoaded() {
        document.querySelectorAll(FACE_IMG_SELECTOR).forEach(markHiLoadedIfReady);
    }

    function onFaceLoad(e) {
        markHiLoadedIfReady(e.target);
        if (useLow && e.target instanceof HTMLImageElement && isHiLoaded(e.target)) {
            const hi = e.target.getAttribute('data-hi-src');
            if (hi && e.target.getAttribute('src') !== hi)
                e.target.setAttribute('src', hi);
        }
    }

    function setLo(img) {
        const lo = img.getAttribute('data-lo-src');
        if (!lo)
            return;
        if (img.getAttribute('src') !== lo)
            img.setAttribute('src', lo);
        img.setAttribute(PLACEHOLDER_ATTR, '1');
    }

    function setHi(img) {
        const hi = img.getAttribute('data-hi-src');
        if (!hi)
            return;
        img.removeAttribute(PLACEHOLDER_ATTR);
        if (img.getAttribute('src') !== hi)
            img.setAttribute('src', hi);
    }

    function inUpgradeZone(img, scroller, dir) {
        const vr = getViewport(scroller);
        const ir = img.getBoundingClientRect();
        if (dir >= 0)
            return ir.top < vr.bottom + AHEAD_PX && ir.bottom > vr.top;
        return ir.bottom > vr.top - AHEAD_PX && ir.top < vr.bottom;
    }

    function applySrcs(useLo) {
        if (applyingSrcs)
            return;
        applyingSrcs = true;
        try {
            const scroller = getCardListScroller();
            document.querySelectorAll(FACE_IMG_SELECTOR).forEach((img) => {
                if (useLo && isHiLoaded(img)) {
                    setHi(img);
                    return;
                }

                if (useLo) {
                    setLo(img);
                    return;
                }

                if (isHiLoaded(img) || inUpgradeZone(img, scroller, scrollDir))
                    setHi(img);
                else if (img.getAttribute(PLACEHOLDER_ATTR) === '1')
                    setLo(img);
            });
        } finally {
            applyingSrcs = false;
        }
    }

    function upgradeZoneSrcs() {
        applySrcs(false);
    }

    function watchDom() {
        const root = document.querySelector('.cardSummaryList');
        if (!root)
            return;
        if (mutationObserver && observedRoot === root)
            return;
        stopWatchingDom();
        observedRoot = root;
        mutationObserver = new MutationObserver(() => {
            if (applyingSrcs)
                return;
            applySrcs(useLow);
        });
        mutationObserver.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'data-hi-src']
        });
    }

    function stopWatchingDom() {
        if (!mutationObserver)
            return;
        mutationObserver.disconnect();
        mutationObserver = null;
        observedRoot = null;
    }

    function notify(useLo) {
        if (!fastScrollRef)
            return;
        fastScrollRef.invokeMethodAsync('OnFastScrollPlaceholderChanged', useLo).catch(() => { });
    }

    function enterLow() {
        if (useLow)
            return;
        useLow = true;
        enterCount++;
        slowSince = 0;
        watchDom();
        applySrcs(true);
        notify(true);
        requestAnimationFrame(() => {
            if (useLow)
                applySrcs(true);
        });
    }

    function leaveLow() {
        if (!useLow)
            return;
        useLow = false;
        slowSince = 0;
        upgradeZoneSrcs();
        notify(false);
    }

    function onScroll(e) {
        const scroller = getCardListScroller();
        if (e && !isListScrollerEvent(e, scroller))
            return;

        watchDom();

        const now = performance.now();
        const y = readY(scroller);
        const signed = y - lastY;
        const dt = now - lastT;
        const dy = Math.abs(signed);
        lastY = y;
        lastT = now;

        if (pauseTimer)
            clearTimeout(pauseTimer);
        pauseTimer = setTimeout(() => {
            pauseTimer = null;
            leaveLow();
        }, PAUSE_MS);

        if (dy < MIN_DELTA_PX)
            return;

        scrollDir = signed > 0 ? 1 : -1;

        if (!useLow)
            upgradeZoneSrcs();
        else
            applySrcs(true);

        if (dy >= FAST_SINGLE_DELTA_PX) {
            enterLow();
            return;
        }

        if (dt <= 0 || dt > MAX_SAMPLE_MS)
            return;

        const velocity = dy / dt;
        if (velocity >= FAST_PX_PER_MS) {
            slowSince = 0;
            enterLow();
            return;
        }

        if (velocity < SLOW_PX_PER_MS) {
            if (!slowSince)
                slowSince = now;
            else if (now - slowSince >= SLOW_RESUME_MS)
                leaveLow();
        } else {
            slowSince = 0;
        }
    }

    /**
     * Notifies Blazor when fast window scrolling should use low-quality tile images.
     * @param {any} ref DotNetObjectReference with OnFastScrollPlaceholderChanged(bool)
     */
    window.mtgCardKeeper.subscribeFastScrollImageQuality = function (ref) {
        window.mtgCardKeeper.unsubscribeFastScrollImageQuality();
        fastScrollRef = ref;
        lastY = readY(getCardListScroller());
        lastT = performance.now();
        scrollDir = 1;
        useLow = false;
        enterCount = 0;
        slowSince = 0;
        scrollHandler = onScroll;
        document.addEventListener('scroll', scrollHandler, { passive: true, capture: true });
        document.addEventListener('load', onFaceLoad, true);
        watchDom();
        scanHiLoaded();
    };

    window.mtgCardKeeper.getCardListScroller = getCardListScroller;

    window.mtgCardKeeper.getFastScrollImageQualityState = function () {
        const scroller = getCardListScroller();
        const imgs = [...document.querySelectorAll(FACE_IMG_SELECTOR)];
        return {
            useLow,
            enterCount,
            observing: !!(mutationObserver && observedRoot && observedRoot.isConnected),
            scrollDir,
            lastY,
            y: readY(scroller),
            scrollHeight: isWindowScroller(scroller)
                ? document.documentElement.scrollHeight
                : scroller.scrollHeight,
            imageCount: imgs.length,
            loCount: imgs.filter((img) => img.getAttribute('src') === img.getAttribute('data-lo-src')).length,
            hiCount: imgs.filter((img) => img.getAttribute('src') === img.getAttribute('data-hi-src')).length,
            placeholderCount: document.querySelectorAll('.cardSummaryList img.card-face-img[' + PLACEHOLDER_ATTR + ']').length,
            hiLoadedCount: imgs.filter((img) => img.dataset.hiLoaded).length
        };
    };

    window.mtgCardKeeper.unsubscribeFastScrollImageQuality = function () {
        if (pauseTimer) {
            clearTimeout(pauseTimer);
            pauseTimer = null;
        }
        stopWatchingDom();
        document.removeEventListener('load', onFaceLoad, true);
        if (scrollHandler)
            document.removeEventListener('scroll', scrollHandler, { capture: true });
        scrollHandler = null;
        fastScrollRef = null;
        useLow = false;
        slowSince = 0;
        scrollDir = 1;
    };
})();
