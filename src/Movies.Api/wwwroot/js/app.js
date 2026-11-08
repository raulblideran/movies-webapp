// The Watchlog (/, titles you've watched) and the Watchlist (/watchlist, to watch) share this page code.
// Every title is on one of the two (its .list, see js/lists.js); <body data-list> says which page this
// is. Admin features live in admin.js. Physical copies are releases (their own page, releases.html);
// each title lists the ones it's on.

const LIST = document.body.dataset.list === "watchlist" ? "watchlist" : "watched";
const IS_WATCHLIST = LIST === "watchlist";
let allData = [];
// the titles on the other list (the editor's duplicate check, a disc's other titles)
let otherData = [];
let filteredData = [];
let activeFilters = {
    type: "all",
    genre: "all",
    rating: "all",
    physicalFormat: "all",
    special: "all",
    runtime: "all",
    decade: "all",
    tag: "all",
    language: "all",
    watchCount: "all",
    released: "all", // the watchlist's "Out yet?": released / unreleased (Lists.isReleased)
};
// the page's sort menu marks its default
const DEFAULT_SORT = document.querySelector('#sortDropdown [aria-checked="true"]')?.dataset.sort ?? "name";
let currentSort = DEFAULT_SORT;

// ---------- the view in the URL: search, sort, filters and grid/table, so Back, a refresh or a shared
// link land on the same view, e.g. /watchlist?type=film&runtime=under-90 ----------

const URL_FILTERS = { type: "type", genre: "genre", rating: "rating", format: "physicalFormat", special: "special", runtime: "runtime", decade: "decade", tag: "tag", lang: "language", watches: "watchCount", out: "released" };
const VIEW_KEY = `view:${LIST === "watchlist" ? "watchlist" : "titles"}`;

(function readUrl() {
    const p = new URLSearchParams(location.search);
    for (const [param, key] of Object.entries(URL_FILTERS)) if (p.get(param)) activeFilters[key] = p.get(param).toLowerCase();
    const sortOption = p.get("sort") && document.querySelector(`#sortDropdown [data-sort="${CSS.escape(p.get("sort"))}"]`);
    if (sortOption) {
        currentSort = sortOption.dataset.sort;
        document.getElementById("sortButtonText").textContent = sortOption.textContent;
        document.querySelectorAll("#sortDropdown [data-sort]").forEach((o) => o.setAttribute("aria-checked", String(o === sortOption)));
    }
    if (p.get("q")) document.getElementById("searchBox").value = p.get("q");
    // the grid/table switch remembers its choice in this browser; a link's choice wins
    if (["grid", "table"].includes(p.get("view")))
        try {
            localStorage.setItem(VIEW_KEY, p.get("view"));
        } catch {
            // storage unavailable: the grid it is
        }
    if (!["all", "released", "unreleased"].includes(activeFilters.released)) activeFilters.released = "all";
    if (!/^(all|\d+|over[12])$/.test(activeFilters.watchCount)) activeFilters.watchCount = "all"; // a count, "over1"/"over2" (more than once/twice), or nothing
    updateFilterCount();
})();

let urlTimer = null;
function writeUrl({ now = false } = {}) {
    clearTimeout(urlTimer);
    if (!now) return (urlTimer = setTimeout(() => writeUrl({ now: true }), 300)); // typing: once it settles
    const p = new URLSearchParams(location.search);
    const set = (k, v, fallback) => (v && v !== fallback ? p.set(k, v) : p.delete(k));
    set("q", document.getElementById("searchBox").value.trim(), "");
    set("sort", currentSort, DEFAULT_SORT);
    for (const [param, key] of Object.entries(URL_FILTERS)) set(param, activeFilters[key], "all");
    set("view", view.get(), "grid"); // only called once the page is loaded, so view exists
    history.replaceState(history.state, "", location.pathname + (p.size ? `?${p}` : "") + location.hash);
}

// ---------- helpers ----------

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// "2020-04-15" -> "15/04/2020"
function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
}

function formatRating(rating) {
    return rating == null ? "" : String(rating);
}

// Detail rows shown on cards and in the modal, in the original sheet's column order and labels.
function detailFields(row) {
    if (row.list === "watchlist")
        return [
            ["Added", formatDate(row.watchlistAddedOn)],
            ["Seasons", row.seasons != null ? String(row.seasons) : ""],
            ["Episodes", row.episodesTotal != null ? String(row.episodesTotal) : ""],
            ["Genre", row.genres.join("/")],
            ["Comments", row.comments || ""],
            ["Price (£)", Shelf.titleShare(row) != null ? Shelf.titleShare(row).toFixed(2) : ""],
        ].filter(([, v]) => v !== "");
    return [
        ["First watch", formatDate(row.firstWatch)],
        ["Latest watch", row.latestWatch !== row.firstWatch ? formatDate(row.latestWatch) : ""],
        ["Seasons", row.seasons != null ? String(row.seasons) : ""],
        ["Episodes", row.episodesTotal != null ? String(row.episodesTotal) : ""],
        ["Genre", row.genres.join("/")],
        ["Comments", row.comments || ""],
        ["Price (£)", Shelf.titleShare(row) != null ? Shelf.titleShare(row).toFixed(2) : ""],
    ].filter(([, v]) => v !== "");
}

function searchTextFor(row) {
    return [
        row.name,
        row.type,
        row.genres.join(" "),
        row.watchedInCinema ? "cinema" : "",
        row.releases.map((r) => `${r.name} ${Shelf.label(r)}`).join(" "),
        row.comments,
        formatRating(row.rating),
        formatDate(row.firstWatch),
        formatDate(row.latestWatch),
        formatDate(row.watchlistAddedOn),
        row.releaseYear,
        ...(row.directors ?? []),
        ...(row.cast ?? []),
        ...(row.tags ?? []).map((t) => `#${t} ${t}`),
        ...(row.watches ?? []).map((w) => w.notes),
        TitleModal.languageName(row.originalLanguage),
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

// ---------- notifications / UI toggles ----------

function showError(message) {
    const errorEl = document.getElementById("error");
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    clearTimeout(errorEl._timer);
    errorEl._timer = setTimeout(() => errorEl.classList.add("hidden"), 8000);
}

// action: optional { label, run }, a button on the toast (e.g. Undo), which then stays up longer
function showSuccess(message, action) {
    const successEl = document.getElementById("success");
    successEl.textContent = message;
    if (action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "toast-action";
        button.textContent = action.label;
        button.onclick = () => {
            successEl.classList.add("hidden");
            action.run();
        };
        successEl.append(" ", button);
    }
    successEl.classList.remove("hidden");
    clearTimeout(successEl._timer);
    successEl._timer = setTimeout(() => successEl.classList.add("hidden"), action ? 8000 : 3000);
}

function toggleFilters() {
    const filtersSection = document.getElementById("filtersSection");
    const open = filtersSection.classList.toggle("hidden") === false;
    document.getElementById("filterToggle").setAttribute("aria-expanded", String(open));
}

function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    overlay.classList.toggle("hidden", !show);
}

// ---------- data loading ----------

async function loadTitles({ quiet = false } = {}) {
    if (!quiet) showLoading(true);
    try {
        const everything = await Lists.loadAll();
        allData = everything.filter((r) => r.list === LIST);
        otherData = everything.filter((r) => r.list !== LIST);
        for (const row of allData) row._search = searchTextFor(row);
        window.TitleEditor?.refreshReleases((id) => everything.find((r) => r.id === id));

        displayStats();
        createFilters();
        applyFilters();
        return true;
    } catch (error) {
        showError(`Error loading the ${Lists[LIST].name.toLowerCase()}: ${error.message}`);
        return false;
    } finally {
        showLoading(false);
    }
}

// "/?title=12" opens that title (the full-page editor lands here after saving).
window.addEventListener("DOMContentLoaded", async () => {
    if (!(await loadTitles())) return;
    const params = new URLSearchParams(location.search);
    const id = Number(params.get("title"));
    if (!id) return;
    params.delete("title");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
    const row = allData.find((r) => r.id === id);
    if (row) {
        document.getElementById("cardsGrid").children[shownRows.indexOf(row)]?.scrollIntoView({ block: "center" });
        openModal(row);
    } else {
        // on the other list (an old link, or one from a release): go there instead
        const there = otherData.find((r) => r.id === id);
        if (there) location.replace(Lists.link(there));
    }
});

// ---------- stats & filters ----------

function displayStats() {
    const statsEl = document.getElementById("stats");
    const totalCount = allData.length;
    const films = allData.filter((r) => r.type === "Film").length;
    const series = allData.filter((r) => r.type === "Series").length;
    if (IS_WATCHLIST) {
        const today = TitleModal.todayIso();
        const thisMonth = allData.filter((r) => r.watchlistAddedOn?.slice(0, 7) === today.slice(0, 7)).length;
        const oldest = allData.reduce((min, r) => (r.watchlistAddedOn && (!min || r.watchlistAddedOn < min) ? r.watchlistAddedOn : min), null);
        const stats = [
            [totalCount, "to watch"],
            [films, films === 1 ? "film" : "films"],
            [series, "series"],
            [thisMonth, "added this month"],
            [oldest ? TitleModal.waitText(oldest).replace("today", "0 days") : "-", "longest wait"],
        ];
        statsEl.innerHTML = stats.map(([value, label]) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`).join("");
        return;
    }
    const rated = allData.filter((r) => r.rating != null);
    const avgRating = rated.length
        ? (rated.reduce((sum, r) => sum + r.rating, 0) / rated.length).toFixed(1)
        : "-";
    const withBogdan = allData.filter((r) => r.withBogdan).length;

    const stats = [
        [totalCount, totalCount === 1 ? "title" : "titles"],
        [films, films === 1 ? "film" : "films"],
        [series, "series"],
        [avgRating, "avg rating"],
        [withBogdan, "with Bogdan"],
    ];
    statsEl.innerHTML = stats
        .map(([value, label]) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`)
        .join("");
}

function filterButton(category, value, label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.setAttribute("aria-pressed", String(activeFilters[category] === value));
    btn.textContent = label;
    btn.onclick = (e) => setFilter(category, value, e.currentTarget);
    return btn;
}

// Unique values across rows, case-insensitive, keeping the first spelling seen.
function uniqueValues(getList) {
    const map = new Map();
    for (const row of allData) {
        for (const v of getList(row)) {
            const key = v.toLowerCase();
            if (!map.has(key)) map.set(key, v);
        }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}

function createFilters() {
    const fill = (id, category, entries) => {
        const container = document.getElementById(id);
        if (!container) return; // the watchlist has no rating, format or special filters
        container.innerHTML = "";
        for (const [value, label] of entries) container.appendChild(filterButton(category, value, label));
    };

    fill("typeFilters", "type", [["all", "All"], ["film", "Film"], ["series", "Series"]]);
    fill("genreFilters", "genre", [["all", "All"], ...uniqueValues((r) => r.genres)]);
    fill("ratingFilters", "rating", ["All", "10", "9-10", "8-9", "7-8", "<7"].map((r) => [r.toLowerCase(), r]));
    fill("runtimeFilters", "runtime", RUNTIMES.map(([value, label]) => [value, label]));
    // only the decades this list has titles from (and the chosen one, which may have come from a link)
    const hasDecade = ([value, , test]) =>
        value === "all" || value === activeFilters.decade || allData.some((r) => r.releaseYear && test(r.releaseYear));
    fill("decadeFilters", "decade", DECADES.filter(hasDecade).map(([value, label]) => [value, label]));
    // your own tags, and the languages they're in (most titles first): groups with nothing to pick stay hidden
    const tags = uniqueValues((r) => r.tags ?? []);
    fill("tagFilters", "tag", [["all", "All"], ...tags.map(([value, label]) => [value, `#${label}`])]);
    document.getElementById("tagFilters")?.closest(".filter-group").classList.toggle("hidden", tags.length === 0);
    const languages = new Map();
    for (const r of allData) if (r.originalLanguage) languages.set(r.originalLanguage, (languages.get(r.originalLanguage) ?? 0) + 1);
    const byCount = [...languages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    fill("languageFilters", "language", [["all", "All"], ...byCount.map(([code, n]) => [code, `${TitleModal.languageName(code)} (${n})`])]);
    document.getElementById("languageFilters")?.closest(".filter-group").classList.toggle("hidden", byCount.length < 2);
    // how many times you've watched them: a chip for each count your titles have (and the chosen one, from a link)
    const times = new Map();
    for (const r of allData) times.set(r.watchCount || 0, (times.get(r.watchCount || 0) ?? 0) + 1);
    if (/^\d+$/.test(activeFilters.watchCount) && !times.has(Number(activeFilters.watchCount))) times.set(Number(activeFilters.watchCount), 0);
    const timesLabel = (n) => (n === 0 ? "Not seen" : n === 1 ? "Once" : n === 2 ? "Twice" : `${n}×`);
    const byTimes = [...times].sort((a, b) => a[0] - b[0]);
    // "More than once/twice": those counts together, when that's more than a single chip already shows
    const moreThan = [
        [1, "More than once"],
        [2, "More than twice"],
    ]
        .filter(([n]) => byTimes.filter(([t]) => t > n).length > 1 || activeFilters.watchCount === `over${n}`)
        .map(([n, label]) => [`over${n}`, `${label} (${allData.filter((r) => r.watchCount > n).length})`]);
    fill("watchCountFilters", "watchCount", [["all", "All"], ...moreThan, ...byTimes.map(([n, c]) => [String(n), `${timesLabel(n)} (${c})`])]);
    document.getElementById("watchCountFilters")?.closest(".filter-group").classList.toggle("hidden", byTimes.length < 2);
    // out yet? (the watchlist): both groups' counts, so you can see how much is still to come
    const released = allData.filter((r) => Lists.isReleased(r)).length;
    fill("releasedFilters", "released", [
        ["all", "All"],
        ["released", `Released (${released})`],
        ["unreleased", `Unreleased (${allData.length - released})`],
    ]);
    fill("physicalFormatFilters", "physicalFormat", [["all", "All"], ...uniqueValues((r) => r.releases.map(Shelf.label))]);
    fill(
        "specialFilters",
        "special",
        (IS_WATCHLIST
            ? ["All", "On the shelf", "Not on the shelf", "Seen before"]
            : ["All", "Watched w/ Bogdan", "Not w/ Bogdan", "Seen in cinema", "Physical Copy", "High Rewatch"]
        ).map((s) => [s.toLowerCase(), s]),
    );
}

// Length bands (a series by its episode length). Titles without a runtime only show under "All".
const RUNTIMES = [
    ["all", "All", () => true],
    ["under-90", "Under 1h30", (m) => m < 90],
    ["90-120", "1h30–2h", (m) => m >= 90 && m <= 120],
    ["120-150", "2h–2h30", (m) => m > 120 && m <= 150],
    ["over-150", "Over 2h30", (m) => m > 150],
];

// Release decades. Titles without a release year only show under "All".
const DECADES = [
    ["all", "All", () => true],
    ...[2020, 2010, 2000, 1990, 1980].map((d) => [`${d}s`, `${d}s`, (y) => y >= d && y < d + 10]),
    ["older", "Before 1980", (y) => y < 1980],
];

function setFilter(category, value, button) {
    activeFilters[category] = value;

    document
        .querySelectorAll(`#${category}Filters button`)
        .forEach((btn) => btn.setAttribute("aria-pressed", String(btn === button)));

    updateFilterCount();
    applyFilters();
    writeUrl({ now: true });
}

// "Filters (2)", and the Clear filters button while any are on
function updateFilterCount() {
    const active = Object.values(activeFilters).filter((v) => v !== "all").length;
    document.getElementById("filterCount").textContent = active ? `(${active})` : "";
    document.getElementById("clearFilters")?.classList.toggle("hidden", !active);
}

// Every filter back to All (the search and the sort stay as they are).
function clearFilters() {
    for (const key of Object.keys(activeFilters)) activeFilters[key] = "all";
    createFilters(); // the chips, pressed as they are now
    updateFilterCount();
    applyFilters();
    writeUrl({ now: true });
}

function applyFilters() {
    filteredData = allData.filter((row) => {
        if (activeFilters.type !== "all" && row.type.toLowerCase() !== activeFilters.type) return false;

        if (activeFilters.genre !== "all" && !row.genres.some((g) => g.toLowerCase() === activeFilters.genre))
            return false;

        if (activeFilters.rating !== "all") {
            const rating = row.rating ?? 0;
            if (activeFilters.rating === "10" && rating !== 10) return false;
            if (activeFilters.rating === "9-10" && (rating < 9 || rating > 10)) return false;
            if (activeFilters.rating === "8-9" && (rating < 8 || rating >= 9)) return false;
            if (activeFilters.rating === "7-8" && (rating < 7 || rating >= 8)) return false;
            if (activeFilters.rating === "<7" && rating >= 7) return false;
        }

        if (activeFilters.runtime !== "all") {
            const band = RUNTIMES.find(([v]) => v === activeFilters.runtime);
            if (!row.runtime || (band && !band[2](row.runtime))) return false;
        }

        if (activeFilters.released !== "all" && Lists.isReleased(row) !== (activeFilters.released === "released")) return false;

        if (activeFilters.tag !== "all" && !(row.tags ?? []).some((t) => t.toLowerCase() === activeFilters.tag)) return false;

        if (activeFilters.language !== "all" && row.originalLanguage !== activeFilters.language) return false;

        if (activeFilters.watchCount !== "all") {
            const over = /^over(\d)$/.exec(activeFilters.watchCount);
            if (over ? !(row.watchCount > Number(over[1])) : (row.watchCount || 0) !== Number(activeFilters.watchCount)) return false;
        }

        if (activeFilters.decade !== "all") {
            const band = DECADES.find(([v]) => v === activeFilters.decade);
            if (!row.releaseYear || (band && !band[2](row.releaseYear))) return false;
        }

        if (
            activeFilters.physicalFormat !== "all" &&
            !row.releases.some((r) => Shelf.label(r).toLowerCase() === activeFilters.physicalFormat)
        )
            return false;

        switch (activeFilters.special) {
            case "watched w/ bogdan":
                if (!row.withBogdan) return false;
                break;
            case "not w/ bogdan":
                if (row.withBogdan) return false;
                break;
            case "seen in cinema":
                if (!row.watchedInCinema) return false;
                break;
            case "physical copy":
            case "on the shelf":
                if (row.releases.length === 0) return false;
                break;
            case "not on the shelf":
                if (row.releases.length > 0) return false;
                break;
            case "seen before":
                if (!row.watchCount) return false;
                break;
            case "high rewatch":
                if ((row.rewatchPotential ?? 0) < 9) return false;
                break;
        }

        return true;
    });

    sortCards();
}

function filterCards() {
    const searchTerm = document.getElementById("searchBox").value.toLowerCase().trim();
    if (allData.length) writeUrl();
    const filtered = searchTerm ? filteredData.filter((row) => row._search.includes(searchTerm)) : filteredData;
    document.getElementById("resultCount").textContent =
        filtered.length === allData.length ? "" : `${filtered.length} of ${allData.length}`;
    displayCards(filtered);
}

// ---------- sorting ----------

function setSortMenu(open) {
    document.getElementById("sortDropdown").classList.toggle("hidden", !open);
    document.getElementById("sortButton").setAttribute("aria-expanded", String(open));
}

function toggleSortDropdown() {
    setSortMenu(document.getElementById("sortDropdown").classList.contains("hidden"));
}

function selectSort(element) {
    currentSort = element.dataset.sort;
    document.getElementById("sortButtonText").textContent = element.textContent;
    document
        .querySelectorAll("#sortDropdown [data-sort]")
        .forEach((opt) => opt.setAttribute("aria-checked", String(opt === element)));
    setSortMenu(false);
    sortCards();
    writeUrl({ now: true });
}

document.querySelectorAll("#sortDropdown [data-sort]").forEach((opt) => {
    opt.onclick = () => selectSort(opt);
});

function sortCards() {
    filteredData.sort((a, b) => {
        switch (currentSort) {
            case "name":
                return a.name.localeCompare(b.name);
            case "rating-desc":
                return (b.rating ?? 0) - (a.rating ?? 0);
            case "rating-asc":
                return (a.rating ?? 0) - (b.rating ?? 0);
            case "watch-count":
                return (b.watchCount || 0) - (a.watchCount || 0);
            case "date-latest":
                return (b.latestWatch || "").localeCompare(a.latestWatch || "");
            case "date-first":
                return (b.firstWatch || "").localeCompare(a.firstWatch || "");
            case "added-desc":
                return (b.watchlistAddedOn || "").localeCompare(a.watchlistAddedOn || "") || b.id - a.id;
            case "added-asc":
                return (a.watchlistAddedOn || "").localeCompare(b.watchlistAddedOn || "") || a.id - b.id;
            case "year-desc":
                return (b.releaseYear ?? 0) - (a.releaseYear ?? 0) || a.name.localeCompare(b.name);
            case "year-asc":
                return (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999) || a.name.localeCompare(b.name);
            case "runtime-asc":
                return (a.runtime ?? 99999) - (b.runtime ?? 99999) || a.name.localeCompare(b.name);
            case "runtime-desc":
                return (b.runtime ?? -1) - (a.runtime ?? -1) || a.name.localeCompare(b.name);
            default:
                return 0;
        }
    });

    filterCards();
}

document.addEventListener("click", function (event) {
    const dropdown = document.getElementById("sortDropdown");
    const button = document.getElementById("sortButton");
    if (dropdown && button && !button.contains(event.target) && !dropdown.contains(event.target)) {
        setSortMenu(false);
    }
});

// ---------- cards ----------

const ratingHtml = (row, large = false) => TitleModal.ratingHtml(row, large);

function tagsHtml(row, { formats = false } = {}) {
    const tags = [`<span class="tag tag-${row.type === "Film" ? "film" : "series"}">${escapeHtml(row.type)}</span>`];
    // on the watchlist with watches already: waiting to be watched again
    if (row.list === "watchlist" && row.watchCount > 0) tags.push(`<span class="tag tag-rewatch">Rewatch</span>`);
    if (row.withBogdan) tags.push(`<span class="tag tag-bogdan">With Bogdan</span>`);
    if (row.watchedInCinema) tags.push(`<span class="tag tag-cinema">In cinema</span>`);
    if (formats) for (const r of row.releases) tags.push(`<span class="tag tag-physical">${escapeHtml(Shelf.label(r))}</span>`);
    else if (row.releases.length > 0) tags.push(`<span class="tag tag-physical">On the shelf</span>`);
    if ((row.rewatchPotential ?? 0) >= 9) tags.push(`<span class="tag tag-rewatch">High rewatch</span>`);
    return tags.join("");
}

function factsHtml(row, { skip = [] } = {}) {
    return detailFields(row)
        .filter(([label]) => !skip.includes(label))
        .map(([label, value]) => {
            if (label === "Comments") return `<dt class="sr-only">${label}</dt><dd class="wide">${escapeHtml(value)}</dd>`;
            const shown =
                label === "Watch count" && row.watchCount >= 10
                    ? `<span class="milestone">${escapeHtml(value)}</span>`
                    : escapeHtml(value);
            return `<dt>${label}</dt><dd>${shown}</dd>`;
        })
        .join("");
}

// The cards currently on screen, in order: the title modal's previous/next step through these.
let shownRows = [];

// Admins can switch the grid for a sortable table (js/shelf.js).
let tableSort = IS_WATCHLIST ? { key: "added", dir: "desc" } : { key: "name", dir: "asc" };
const watchlistColumns = [
    { key: "name", label: "Name", value: (r) => r.name },
    { key: "type", label: "Type", value: (r) => r.type },
    { key: "year", label: "Year", value: (r) => r.releaseYear, num: true },
    { key: "runtime", label: "Runtime", value: (r) => r.runtime, html: (r) => escapeHtml(TitleModal.runtimeText(r).replace(" episodes", "/ep")), num: true },
    { key: "added", label: "Added", value: (r) => r.watchlistAddedOn, html: (r) => escapeHtml(formatDate(r.watchlistAddedOn)) },
    { key: "genres", label: "Genres", value: (r) => r.genres.join(", "), wrap: true },
    { key: "seen", label: "Seen", value: (r) => r.watchCount || null, num: true },
    { key: "releases", label: "On the shelf", value: (r) => r.releases.map(Shelf.label).join(", "), wrap: true },
];
const titleColumns = [
    { key: "name", label: "Name", value: (r) => r.name },
    { key: "type", label: "Type", value: (r) => r.type },
    { key: "year", label: "Year", value: (r) => r.releaseYear, num: true },
    { key: "runtime", label: "Runtime", value: (r) => r.runtime, html: (r) => escapeHtml(TitleModal.runtimeText(r).replace(" episodes", "/ep")), num: true },
    { key: "rating", label: "Rating", value: (r) => r.rating, num: true },
    { key: "watches", label: "Watches", value: (r) => r.watchCount, num: true },
    { key: "first", label: "First watch", value: (r) => r.firstWatch, html: (r) => escapeHtml(formatDate(r.firstWatch)) },
    { key: "latest", label: "Latest watch", value: (r) => r.latestWatch, html: (r) => escapeHtml(formatDate(r.latestWatch)) },
    { key: "genres", label: "Genres", value: (r) => r.genres.join(", "), wrap: true },
    { key: "releases", label: "On the shelf", value: (r) => r.releases.map(Shelf.label).join(", "), wrap: true },
    { key: "paid", label: "Paid", value: (r) => Shelf.titleShare(r), html: (r) => Shelf.money(Shelf.titleShare(r)), num: true },
    { key: "bogdan", label: "Bogdan", value: (r) => (r.withBogdan ? "Yes" : "") },
    { key: "cinema", label: "Cinema", value: (r) => (r.watchedInCinema ? "Yes" : "") },
    { key: "rewatch", label: "Rewatch", value: (r) => r.rewatchPotential, num: true },
];
const view = Shelf.viewToggle(document.getElementById("viewToggle"), IS_WATCHLIST ? "watchlist" : "titles", () => filterCards());

function displayCards(data) {
    const grid = document.getElementById("cardsGrid");
    grid.innerHTML = "";
    shownRows = data;
    grid.classList.toggle("is-table", view.get() === "table" && data.length > 0);

    if (view.get() === "table" && data.length > 0) {
        // the modal's previous/next follow the table's order
        shownRows = Shelf.renderTable(grid, {
            rows: data,
            columns: IS_WATCHLIST ? watchlistColumns : titleColumns,
            sort: tableSort,
            caption: IS_WATCHLIST ? "Watchlist" : "Titles",
            onSort: (s) => {
                tableSort = s;
                displayCards(data);
            },
            onRow: (row) => openModal(row),
        });
        return;
    }

    if (data.length === 0) {
        grid.innerHTML = allData.length
            ? `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a shorter search or clear some filters.</p>${Object.values(activeFilters).some((v) => v !== "all") ? `<button type="button" class="btn" onclick="clearFilters()">Clear all filters</button>` : ""}</div>`
            : IS_WATCHLIST
              ? `<div class="empty"><h2>Nothing on your watchlist</h2><p class="muted">Add the films and series you want to watch, and mark them as watched from here.</p></div>`
              : "";
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const row of data) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "card";
        card.onclick = () => openModal(row);

        const poster = row.posterUrl
            ? `<img src="${escapeHtml(row.posterUrl)}" loading="lazy" alt="" />`
            : `<div class="no-poster">${escapeHtml(row.name)}</div>`;

        card.innerHTML = `
            <div class="card-poster">${poster}${ratingHtml(row)}</div>
            <div class="card-body">
                <h3 class="card-title">${escapeHtml(row.name)}${row.releaseYear ? ` <span class="card-year">${row.releaseYear}</span>` : ""}</h3>
                <div class="tags">${tagsHtml(row)}</div>
                ${WatchDialog.pipsHtml(row)}
                <dl class="facts">${factsHtml(row, { skip: ["Genre", "Price (£)"] })}</dl>
            </div>`;
        fragment.appendChild(card);
    }
    grid.appendChild(fragment);
}

// ---------- the title popup (js/title-modal.js) ----------

function openModal(row) {
    return TitleModal.open(row);
}

function closeModal() {
    TitleModal.close();
}

TitleModal.configure({
    rows: () => shownRows,
    // keep the grid behind in step, so closing lands on the title you ended up on
    onStep: (i) => {
        if (view.get() !== "table") document.getElementById("cardsGrid").children[i]?.scrollIntoView({ block: "center" });
    },
    showRelease: (id) => showRelease(id),
    onOpened: (row) => window.Admin?.onModalOpened(row),
    lookup: (type, id) => everyTitle().find((r) => r.tmdbId === id && r.tmdbMediaType === type),
    addToWatchlist: (parts) => addToWatchlist(parts),
    // a watch added, changed or deleted in the popup: the cards and filters as they are now
    onTitleChanged: () => loadTitles({ quiet: true }),
    lookupTitle: (id) => everyTitle().find((r) => r.id === id),
});

// A franchise's missing films, from the popup: each one's TMDB details, onto the watchlist.
async function addToWatchlist(parts) {
    const vocab = [...new Set(everyTitle().flatMap((r) => r.genres))];
    const added = [];
    for (const p of parts) {
        try {
            const d = await Auth.api("GET", `/api/tmdb/details?link=movie/${p.id}`);
            await Auth.api("POST", "/api/titles", {
                name: d.title, type: d.type, list: "Watchlist", watchCount: 0, releaseYear: d.year,
                genres: TitleEditor.mapGenres(d.genres, d.isAnime, vocab), seasons: d.seasons, episodesTotal: d.episodes,
                tmdbId: d.id, tmdbMediaType: d.mediaType, posterPath: d.posterPath,
            });
            added.push(d.title);
        } catch (e) {
            showError(`Couldn't add ${p.title}: ${e.message}`);
        }
    }
    await loadTitles({ quiet: true });
    if (added.length) showSuccess(added.length === 1 ? `Added ${added[0]} to your watchlist` : `Added ${added.length} films to your watchlist`);
    const shown = TitleModal.current();
    const fresh = shown && everyTitle().find((r) => r.id === shown.id);
    if (fresh) TitleModal.open(fresh);
}

// ---------- a release, over the title popup (js/release-dialogs.js) ----------

const releaseCache = new Map();

async function fetchRelease(id) {
    const resp = await fetch(`/api/releases/${id}`, { cache: "no-store" });
    if (!resp.ok) return null;
    const r = await resp.json();
    releaseCache.set(id, r);
    return r;
}

const everyTitle = () => [...allData, ...otherData];

const releaseCtx = {
    titles: () => new Map(everyTitle().map((t) => [t.id, t])),
    find: (id) => releaseCache.get(id),
    // after an edit or delete: refresh the collection and the title popup underneath
    async onChanged(saved) {
        await loadTitles({ quiet: true });
        const shown = TitleModal.current();
        const row = shown && everyTitle().find((r) => r.id === shown.id);
        if (row) openModal(row);
        return saved ? fetchRelease(saved.id) : null;
    },
    // a title on the release opens over it; the release stays open underneath
    openTitle(id) {
        const row = everyTitle().find((r) => r.id === id);
        if (row) TitleModal.open(row, { front: true });
    },
};

async function showRelease(id) {
    const r = await fetchRelease(id);
    if (r) ReleaseDialogs.open(r, releaseCtx);
    else showError("Couldn't load that release.");
}

// "Add a release" with the title already picked, over the title's editor
const addRelease = (titleId) => ReleaseDialogs.edit(null, [titleId], releaseCtx);

// Used by admin.js
window.App = {
    list: LIST,
    reload: () => loadTitles({ quiet: true }),
    getAll: () => allData,
    getOther: () => otherData,
    // what's on screen, in order (search and filters applied): Pick for me picks from these
    getShown: () => shownRows,
    // films from TMDB ([{ id, title }]) onto the watchlist (Coming soon, franchise progress)
    addToWatchlist: (parts) => addToWatchlist(parts),
    openModal,
    closeModal,
    showRelease,
    addRelease,
    showError,
    showSuccess,
    escapeHtml,
};
