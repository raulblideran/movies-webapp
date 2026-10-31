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
};
// the page's sort menu marks its default
let currentSort = document.querySelector('#sortDropdown [aria-checked="true"]')?.dataset.sort ?? "name";

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
            ["Seen", row.watchCount ? (row.watchCount === 1 ? "Once" : `${row.watchCount} times`) : ""],
            ["Seasons", row.seasons != null ? String(row.seasons) : ""],
            ["Episodes", row.episodesTotal != null ? String(row.episodesTotal) : ""],
            ["Genre", row.genres.join("/")],
            ["Comments", row.comments || ""],
            ["Price (£)", Shelf.titleShare(row) != null ? Shelf.titleShare(row).toFixed(2) : ""],
        ].filter(([, v]) => v !== "");
    return [
        ["First watch", formatDate(row.firstWatch)],
        ["Watch count", row.watchCount ? String(row.watchCount) : ""],
        ["Latest watch", formatDate(row.latestWatch)],
        ["Seasons", row.seasons != null ? String(row.seasons) : ""],
        ["Episodes", row.episodesTotal != null ? String(row.episodesTotal) : ""],
        ["Genre", row.genres.join("/")],
        ["With Bogdan", formatDate(row.dateWithBogdan)],
        ["Comments", row.comments || ""],
        ["Price (£)", Shelf.titleShare(row) != null ? Shelf.titleShare(row).toFixed(2) : ""],
    ].filter(([, v]) => v !== "");
}

function searchTextFor(row) {
    return [
        row.name,
        row.type,
        row.genres.join(" "),
        row.releases.map((r) => `${r.name} ${Shelf.label(r)}`).join(" "),
        row.comments,
        formatRating(row.rating),
        formatDate(row.firstWatch),
        formatDate(row.latestWatch),
        formatDate(row.watchlistAddedOn),
        row.releaseYear,
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
    fill("physicalFormatFilters", "physicalFormat", [["all", "All"], ...uniqueValues((r) => r.releases.map(Shelf.label))]);
    fill(
        "specialFilters",
        "special",
        (IS_WATCHLIST
            ? ["All", "On the shelf", "Not on the shelf", "Seen before"]
            : ["All", "Watched w/ Bogdan", "Not w/ Bogdan", "Physical Copy", "High Rewatch"]
        ).map((s) => [s.toLowerCase(), s]),
    );
}

function setFilter(category, value, button) {
    activeFilters[category] = value;

    document
        .querySelectorAll(`#${category}Filters button`)
        .forEach((btn) => btn.setAttribute("aria-pressed", String(btn === button)));

    const active = Object.values(activeFilters).filter((v) => v !== "all").length;
    document.getElementById("filterCount").textContent = active ? `(${active})` : "";

    applyFilters();
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
    { key: "added", label: "Added", value: (r) => r.watchlistAddedOn, html: (r) => escapeHtml(formatDate(r.watchlistAddedOn)) },
    { key: "genres", label: "Genres", value: (r) => r.genres.join(", "), wrap: true },
    { key: "seen", label: "Seen", value: (r) => r.watchCount || null, num: true },
    { key: "releases", label: "On the shelf", value: (r) => r.releases.map(Shelf.label).join(", "), wrap: true },
];
const titleColumns = [
    { key: "name", label: "Name", value: (r) => r.name },
    { key: "type", label: "Type", value: (r) => r.type },
    { key: "year", label: "Year", value: (r) => r.releaseYear, num: true },
    { key: "rating", label: "Rating", value: (r) => r.rating, num: true },
    { key: "watches", label: "Watches", value: (r) => r.watchCount, num: true },
    { key: "first", label: "First watch", value: (r) => r.firstWatch, html: (r) => escapeHtml(formatDate(r.firstWatch)) },
    { key: "latest", label: "Latest watch", value: (r) => r.latestWatch, html: (r) => escapeHtml(formatDate(r.latestWatch)) },
    { key: "genres", label: "Genres", value: (r) => r.genres.join(", "), wrap: true },
    { key: "releases", label: "On the shelf", value: (r) => r.releases.map(Shelf.label).join(", "), wrap: true },
    { key: "paid", label: "Paid", value: (r) => Shelf.titleShare(r), html: (r) => Shelf.money(Shelf.titleShare(r)), num: true },
    { key: "bogdan", label: "Bogdan", value: (r) => (r.withBogdan ? "Yes" : "") },
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
            ? `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a shorter search or clear some filters.</p></div>`
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
});

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
    openModal,
    closeModal,
    showRelease,
    addRelease,
    showError,
    showSuccess,
    escapeHtml,
};
