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

    const todayIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    // When it's out (or was): the UK release when TMDB has one, else TMDB's own date (a series: its first air date).
    // { date: "2026-12-23", uk: true }, or null when there's no date at all.
    const releaseOf = (row) =>
        row.ukReleaseDate ? { date: row.ukReleaseDate, uk: true } : row.releaseDate ? { date: row.releaseDate, uk: false } : null;

    // Out already? Its release date (above) is today or earlier. Without a date, only a past release year says
    // it's out: no date and no year means it hasn't been announced, so it isn't. Used by the watchlist's
    // "Out yet?" filter and by Pick for me.
    const isReleased = (row) => {
        const r = releaseOf(row);
        return r ? r.date <= todayIso() : !!row.releaseYear && row.releaseYear < new Date().getFullYear();
    };

    // "23 Dec 2026"
    const shortDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const dateText = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        return shortDate.format(new Date(y, m - 1, d));
    };
    // "in 3 weeks", "in 5 months", "next year"
    function untilText(iso) {
        const [y, m, d] = iso.split("-").map(Number);
        const days = Math.round((Date.UTC(y, m - 1, d) - Date.now()) / 864e5);
        if (days <= 1) return days <= 0 ? "out now" : "tomorrow";
        if (days < 14) return `in ${days} days`;
        if (days < 60) return `in ${Math.round(days / 7)} weeks`;
        if (days < 540) return `in ${Math.round(days / 30.44)} months`;
        return `in ${Math.round(days / 365.25)} years`;
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
        isReleased,
        releaseOf,
        dateText,
        untilText,
        editUrl: (id) => `/titles/${id}/edit`,
        // where a title opens: its list's page, with its popup open
        link: (row) => `${LISTS[row.list].page}?title=${row.id}`,
    };
})();
