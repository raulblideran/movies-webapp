// The two lists every title is on one of: the Watchlog (watched, at /) and the Watchlist (to watch, at
// /watchlist). They're one table (a title's .list), shown by the same page code. A watchlist title can
// already have watches: it's waiting to be watched again.

(function () {
    const LISTS = {
        watched: { page: "/", name: "Watchlog", newUrl: "/titles/new" },
        watchlist: { page: "/watchlist", name: "Watchlist", newUrl: "/watchlist/new" },
    };

    // The API says "Watched" / "Watchlist"; the pages use the lowercase keys above.
    const normalise = (row) => ({ ...row, list: row.list === "Watchlist" ? "watchlist" : "watched" });

    // Every title, on both lists.
    async function loadAll() {
        const resp = await fetch("/api/titles", { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()).map(normalise);
    }

    // The same film or series (by TMDB id) among rows, other than row itself.
    const sameTmdb = (row, rows) =>
        row.tmdbId ? rows.find((r) => r.id !== row.id && r.tmdbId === row.tmdbId && r.tmdbMediaType === row.tmdbMediaType) : null;

    window.Lists = {
        ...LISTS,
        other: (list) => (list === "watched" ? "watchlist" : "watched"),
        normalise,
        loadAll,
        sameTmdb,
        editUrl: (id) => `/titles/${id}/edit`,
        // where a title opens: its list's page, with its popup open
        link: (row) => `${LISTS[row.list].page}?title=${row.id}`,
    };
})();
