// Registers the service worker (sw.js), which makes the site installable as an app
// and keeps the collection pages readable offline.
(function () {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", function () {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function (e) {
            console.warn("Service worker registration failed", e);
        });
    });
})();
