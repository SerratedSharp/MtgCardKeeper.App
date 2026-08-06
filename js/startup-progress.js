window.startupProgress = (() => {
    const root = document.documentElement;
    let applicationStartupHasBegun = false;

    function setPercentage(percentage) {
        const boundedPercentage = Math.max(0, Math.min(100, percentage));
        const percentageText = `${Math.round(boundedPercentage)}%`;

        root.style.setProperty("--app-load-percentage", `${boundedPercentage}%`);
        root.style.setProperty("--app-load-percentage-text", `"${percentageText}"`);
    }

    function mirrorBlazorDownloadProgress() {
        if (applicationStartupHasBegun) {
            return;
        }

        const blazorPercentageText = root.style.getPropertyValue("--blazor-load-percentage");
        const blazorPercentage = Number.parseFloat(blazorPercentageText);

        if (Number.isFinite(blazorPercentage)) {
            setPercentage(blazorPercentage * 0.9);
        }

        requestAnimationFrame(mirrorBlazorDownloadProgress);
    }

    requestAnimationFrame(mirrorBlazorDownloadProgress);

    return {
        beginApplicationStartup() {
            applicationStartupHasBegun = true;
            setPercentage(90);
        },

        setPercentage,

        complete() {
            setPercentage(100);
        }
    };
})();
