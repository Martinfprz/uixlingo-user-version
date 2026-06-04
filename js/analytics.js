(function () {
    function safeTrack(eventName, data) {
        if (typeof umami === 'undefined') return;
        umami.track(eventName, data);
    }

    // Click tracking: reads data-track-section / data-track-action from any element
    // Uses capture phase so stopPropagation() on inner buttons doesn't block it
    document.addEventListener('click', function (e) {
        const el = e.target.closest('[data-track-section]');
        if (!el) return;
        const section = el.dataset.trackSection;
        const action = el.dataset.trackAction;
        if (section && action) safeTrack(section, { action: action });
    }, true);

    window.trackScreen = function (name) {
        safeTrack('screen', { name: name });
    };
})();
