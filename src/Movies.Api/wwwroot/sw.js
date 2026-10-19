// Service worker: makes the site installable and lets the collection open offline.
// Served by the /sw.js endpoint in Program.cs, which fills in the placeholders below, so every
// deploy produces a new worker (and a fresh cache) and the old one is cleaned up.
const VERSION = "{{stamp}}";
const DEV = "{{environment}}" === "Development";
const CACHE = `movies-${VERSION}`;
const OFFLINE_URL = "/offline.html";

// Pages that are worth keeping for offline use. Editor pages need the network anyway.
const PAGES = new Set(["/", "/index.html", "/releases", "/releases.html", "/stats", "/stats.html", "/cex", "/cex.html"]);
// Read-only, anonymous collection data, so the shelves still show offline. Everything else under
// /api/ (sign-in, account, users, export, edits) always goes straight to the network.
const CACHED_API = [/^\/api\/titles\/?$/, /^\/api\/releases\/?$/];
// Google Fonts and the QR-code library, so pages still look and work right offline.
const CDN_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"]);

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon-192.png", "/favicon.svg"]))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith("movies-") && k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);

    if (req.mode === "navigate") {
        if (url.origin === location.origin && PAGES.has(url.pathname)) {
            event.respondWith(networkFirst(req, { key: url.pathname, fallback: OFFLINE_URL }));
        } else if (url.origin === location.origin) {
            event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
        }
        return;
    }

    if (url.origin === location.origin) {
        if (url.pathname.startsWith("/api/")) {
            if (CACHED_API.some((re) => re.test(url.pathname))) event.respondWith(networkFirst(req));
            return;
        }
        // In development `dotnet watch` hot-reloads files without changing their ?v= stamp,
        // so never serve them from the cache there.
        if (DEV) {
            event.respondWith(networkFirst(req));
        } else if (url.searchParams.has("v")) {
            event.respondWith(cacheFirst(req)); // versioned scripts/styles never change
        } else {
            event.respondWith(staleWhileRevalidate(req));
        }
        return;
    }

    if (CDN_HOSTS.has(url.hostname)) event.respondWith(staleWhileRevalidate(req));
});

async function networkFirst(req, { key = req, fallback } = {}) {
    const cache = await caches.open(CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) cache.put(key, res.clone());
        return res;
    } catch (err) {
        const cached = (await cache.match(key, { ignoreSearch: true })) || (fallback && (await cache.match(fallback)));
        if (cached) return cached;
        throw err;
    }
}

async function cacheFirst(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
}

async function staleWhileRevalidate(req) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
        .then((res) => {
            if (res.ok || res.type === "opaque") cache.put(req, res.clone());
            return res;
        })
        .catch(() => cached);
    return cached || network;
}
