// The two lists every title is on one of: the Watchlog (watched, at /) and the Watchlist (to watch, at
// /watchlist). They're one table (a title's .list), shown by the same page code. A watchlist title can
// already have watches: it's waiting to be watched again.

(function () {
    const LISTS = {
        watched: { page: "/", name: "Watchlog", newUrl: "/titles/new" },
        watchlist: { page: "/watchlist", name: "Watchlist", newUrl: "/watchlist/new" },
    };

    // The API says "Watched" / "Watchlist"; the pages use the lowercase keys above. The title's releases are
    // split: .releases is what's on the shelf now (every page reads it that way: filters, tags, what you paid,
    // CeX prices), .soldReleases the discs traded in or sold, kept as history.
    const normalise = (row) => {
        const all = row.soldReleases ? [...row.releases, ...row.soldReleases] : (row.releases ?? []);
        return {
            ...row,
            list: row.list === "Watchlist" || row.list === "watchlist" ? "watchlist" : "watched",
            releases: all.filter((r) => !r.soldVia),
            soldReleases: all.filter((r) => r.soldVia),
        };
    };

    // Every title, on both lists.
    async function loadAll() {
        const resp = await fetch("/api/titles", { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()).map(normalise);
    }

    // Out already? TMDB's release date (a series: its first air date) is today or earlier. Without a date
    // the release year decides; with neither there's no telling, so it counts as out. Used by the
    // watchlist's "Out yet?" filter and by Pick for me.
    const todayIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };
    const isReleased = (row) => (row.releaseDate ? row.releaseDate <= todayIso() : !row.releaseYear || row.releaseYear <= new Date().getFullYear());

    // The same film or series (by TMDB id) among rows, other than row itself.
    const sameTmdb = (row, rows) =>
        row.tmdbId ? rows.find((r) => r.id !== row.id && r.tmdbId === row.tmdbId && r.tmdbMediaType === row.tmdbMediaType) : null;

    window.Lists = {
        ...LISTS,
        other: (list) => (list === "watched" ? "watchlist" : "watched"),
        normalise,
        loadAll,
        sameTmdb,
        isReleased,
        editUrl: (id) => `/titles/${id}/edit`,
        // where a title opens: its list's page, with its popup open
        link: (row) => `${LISTS[row.list].page}?title=${row.id}`,
    };
})();
