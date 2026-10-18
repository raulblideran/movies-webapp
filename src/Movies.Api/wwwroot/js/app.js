// Public collection page. Data comes from /api/titles; admin features live in admin.js.

let allData = [];
let filteredData = [];
let activeFilters = {
    type: "all",
    genre: "all",
    rating: "all",
    physicalFormat: "all",
    special: "all",
};
let cexCache = {};
let currentSort = "name";

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

function money(value) {
    return `£${value.toFixed(2)}`;
}

// Detail rows shown on cards and in the modal, in the original sheet's column order and labels.
function detailFields(row) {
    return [
        ["First watch", formatDate(row.firstWatch)],
        ["Watch count", row.watchCount ? String(row.watchCount) : ""],
        ["Latest watch", formatDate(row.latestWatch)],
        ["Seasons", row.seasons != null ? String(row.seasons) : ""],
        ["Episodes", row.episodesTotal != null ? String(row.episodesTotal) : ""],
        ["Genre", row.genres.join("/")],
        ["With Bogdan", formatDate(row.dateWithBogdan)],
        ["Comments", row.comments || ""],
        ["Price (£)", row.pricePaid != null ? String(row.pricePaid) : ""],
    ].filter(([, v]) => v !== "");
}

function searchTextFor(row) {
    return [
        row.name,
        row.type,
        row.genres.join(" "),
        row.physicalFormats.join(" "),
        row.comments,
        formatRating(row.rating),
        formatDate(row.firstWatch),
        formatDate(row.latestWatch),
        row.releaseYear,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

// ---------- CeX ----------

function extractCexSku(url) {
    if (!url) return null;
    const match = url.match(/[?&]id=([^&]+)/);
    return match ? match[1] : null;
}

async function fetchCexDetails(sku) {
    if (!sku) return null;
    if (cexCache[sku]) return cexCache[sku];
    try {
        const resp = await fetch(`/api/cex/${encodeURIComponent(sku)}`);
        if (!resp.ok) return null;
        const details = await resp.json();
        cexCache[sku] = details;
        return details;
    } catch (e) {
        console.error("Error fetching CeX details for SKU", sku, e);
        return null;
    }
}

async function calculateCollectionValue() {
    const btn = document.getElementById("calcCexBtn");
    const totalsEl = document.getElementById("cexTotals");

    // Phase 1: Scan all rows and collect data
    const uniqueSkus = new Set();
    let totalPaidCex = 0;
    let totalPaidOther = 0;
    let itemCount = 0;

    for (const row of allData) {
        const links = row.cexLinks;
        const paidPrice = row.pricePaid || 0;
        if (links.length === 0 && paidPrice <= 0) continue;

        itemCount++;

        // Split by source: has CeX link = CeX, otherwise = Other
        if (links.length > 0) {
            totalPaidCex += paidPrice;
        } else {
            totalPaidOther += paidPrice;
        }

        for (const link of links) {
            const sku = extractCexSku(link);
            if (sku) uniqueSkus.add(sku);
        }
    }

    if (itemCount === 0) {
        showError("No CeX links or prices found in your collection");
        return;
    }

    const skuList = [...uniqueSkus];

    btn.disabled = true;
    btn.classList.add("is-busy");
    totalsEl.classList.remove("hidden");
    document.getElementById("totalSell").textContent = "...";
    document.getElementById("totalCash").textContent = "...";
    document.getElementById("totalVoucher").textContent = "...";
    const totalPaidAll = totalPaidCex + totalPaidOther;
    document.getElementById("totalPaidCex").textContent =
        totalPaidCex > 0 ? money(totalPaidCex) : "-";
    document.getElementById("totalPaidOther").textContent =
        totalPaidOther > 0 ? money(totalPaidOther) : "-";
    document.getElementById("totalPaidAll").textContent =
        totalPaidAll > 0 ? money(totalPaidAll) : "-";
    document.getElementById("totalCexItems").textContent =
        skuList.length > 0 ? `0/${skuList.length}` : `${itemCount}`;

    // Phase 2: Fetch all unique CeX SKUs (a few at a time; the server caches results)
    let totalSell = 0;
    let totalCash = 0;
    let totalVoucher = 0;
    let fetched = 0;

    const queue = [...skuList];
    async function worker() {
        while (queue.length > 0) {
            const sku = queue.shift();
            const details = await fetchCexDetails(sku);
            if (details) {
                totalSell += details.sellPrice || 0;
                totalCash += details.cashPrice || 0;
                totalVoucher += details.exchangePrice || 0;
            }
            fetched++;
            document.getElementById("totalCexItems").textContent = `${fetched}/${skuList.length}`;
            document.getElementById("totalSell").textContent = money(totalSell);
            document.getElementById("totalCash").textContent = money(totalCash);
            document.getElementById("totalVoucher").textContent = money(totalVoucher);
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    btn.disabled = false;
    btn.classList.remove("is-busy");
    document.getElementById("totalCexItems").textContent = `${itemCount}`;
}

// ---------- notifications / UI toggles ----------

function showError(message) {
    const errorEl = document.getElementById("error");
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    clearTimeout(errorEl._timer);
    errorEl._timer = setTimeout(() => errorEl.classList.add("hidden"), 8000);
}

function showSuccess(message) {
    const successEl = document.getElementById("success");
    successEl.textContent = message;
    successEl.classList.remove("hidden");
    clearTimeout(successEl._timer);
    successEl._timer = setTimeout(() => successEl.classList.add("hidden"), 3000);
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
        const resp = await fetch("/api/titles", { cache: "no-store" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        allData = await resp.json();
        for (const row of allData) row._search = searchTextFor(row);

        displayStats();
        createFilters();
        applyFilters();
        return true;
    } catch (error) {
        showError("Error loading the collection: " + error.message);
        return false;
    } finally {
        showLoading(false);
    }
}

async function refreshData() {
    const refreshButton = document.getElementById("refreshButton");
    refreshButton.disabled = true;
    refreshButton.classList.add("is-busy");

    cexCache = {};
    if (await loadTitles({ quiet: true })) {
        showSuccess(`Collection refreshed: ${allData.length} titles`);
    }

    refreshButton.disabled = false;
    refreshButton.classList.remove("is-busy");
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
    }
});

// ---------- stats & filters ----------

function displayStats() {
    const statsEl = document.getElementById("stats");
    const totalCount = allData.length;
    const films = allData.filter((r) => r.type === "Film").length;
    const series = allData.filter((r) => r.type === "Series").length;
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
        container.innerHTML = "";
        for (const [value, label] of entries) container.appendChild(filterButton(category, value, label));
    };

    fill("typeFilters", "type", [["all", "All"], ["film", "Film"], ["series", "Series"]]);
    fill("genreFilters", "genre", [["all", "All"], ...uniqueValues((r) => r.genres)]);
    fill("ratingFilters", "rating", ["All", "10", "9-10", "8-9", "7-8", "<7"].map((r) => [r.toLowerCase(), r]));
    fill("physicalFormatFilters", "physicalFormat", [["all", "All"], ...uniqueValues((r) => r.physicalFormats)]);
    fill(
        "specialFilters",
        "special",
        ["All", "Watched w/ Bogdan", "Not w/ Bogdan", "Physical Copy", "High Rewatch"].map((s) => [s.toLowerCase(), s]),
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
            !row.physicalFormats.some((f) => f.toLowerCase() === activeFilters.physicalFormat)
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
                if (row.physicalFormats.length === 0) return false;
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

function ratingHtml(row, large = false) {
    const rating = formatRating(row.rating);
    if (!rating) return "";
    const cls = `rating${row.rating > 10 ? " rating-gold" : ""}${large ? " rating-large" : ""}`;
    return `<span class="${cls}" title="Rated ${rating} out of 10">${rating}<small>/10</small></span>`;
}

function tagsHtml(row, { formats = false } = {}) {
    const tags = [`<span class="tag tag-${row.type === "Film" ? "film" : "series"}">${escapeHtml(row.type)}</span>`];
    if (row.withBogdan) tags.push(`<span class="tag tag-bogdan">With Bogdan</span>`);
    if (formats) for (const f of row.physicalFormats) tags.push(`<span class="tag tag-physical">${escapeHtml(f)}</span>`);
    else if (row.physicalFormats.length > 0) tags.push(`<span class="tag tag-physical">On the shelf</span>`);
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

function displayCards(data) {
    const grid = document.getElementById("cardsGrid");
    grid.innerHTML = "";
    shownRows = data;

    if (data.length === 0) {
        grid.innerHTML = allData.length
            ? `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a shorter search or clear some filters.</p></div>`
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

// ---------- modal ----------

let modalRow = null;

async function openModal(row) {
    modalRow = row;
    const modal = document.getElementById("modal");
    const modalBody = document.getElementById("modalBody");
    const modalPoster = document.getElementById("modalPoster");

    let html = `
    <div id="modalAdminBar"></div>
    <div class="tags tags-large">${tagsHtml(row, { formats: true })}</div>
    <h2 class="modal-title" id="modalTitle">${escapeHtml(row.name)}</h2>
    ${ratingHtml(row, true)}
    <dl class="facts modal-facts">${factsHtml(row, { skip: ["Price (£)"] })}</dl>
    `;

    if ((row.pricePaid || 0) > 0) {
        html += `
        <section class="section">
            <h3>Price paid</h3>
            <div class="price-paid">${money(row.pricePaid)}</div>
        </section>`;
    }

    if (row.cexLinks.length > 0) {
        html += `
        <section class="section" id="cexSection">
            <h3>What it's worth at CeX</h3>
            <div id="cexPricing" class="muted pulse">Checking CeX prices…</div>
        </section>`;
    }

    modalBody.innerHTML = html;

    if (row.posterUrl) {
        modalPoster.src = row.posterUrl;
        modalPoster.alt = row.name;
        modalPoster.classList.remove("hidden");
    } else {
        modalPoster.removeAttribute("src");
        modalPoster.classList.add("hidden");
    }
    document.getElementById("modalPanel").classList.toggle("no-poster", !row.posterUrl);

    const wasOpen = !modal.classList.contains("hidden");
    modal.classList.remove("hidden");
    if (!wasOpen) modalBody.parentElement.querySelector(".close").focus();
    modalBody.scrollTop = 0;
    document.body.style.overflow = "hidden";

    updateModalNav();
    window.Admin?.onModalOpened(row);

    // CeX pricing loads after the modal is visible
    if (row.cexLinks.length > 0) {
        const pricingEl = document.getElementById("cexPricing");
        let resultsHtml = "";
        for (const link of row.cexLinks) {
            const sku = extractCexSku(link);
            if (!sku) continue;
            const details = await fetchCexDetails(sku);
            if (modalRow !== row) return; // modal was closed or switched meanwhile
            if (!details) {
                resultsHtml += `<p class="status-bad">Couldn't get CeX prices for ${escapeHtml(sku)}.</p>`;
                continue;
            }
            resultsHtml += `
            <dl class="prices">
                <div><dt>CeX sells for</dt><dd>£${details.sellPrice}</dd></div>
                <div class="is-cash"><dt>Cash payout</dt><dd>£${details.cashPrice}</dd></div>
                <div class="is-voucher"><dt>Voucher</dt><dd>£${details.exchangePrice}</dd></div>
            </dl>
            <div class="price-source">
                <span>${escapeHtml(details.boxName)}</span>
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="link">View on CeX</a>
            </div>`;
        }
        pricingEl.classList.remove("pulse", "muted");
        pricingEl.innerHTML = resultsHtml || `<p class="status-bad">Couldn't reach CeX. Try again later.</p>`;
    }
}

// ---------- modal: previous / next ----------

const modalIndex = () => (modalRow ? shownRows.findIndex((r) => r.id === modalRow.id) : -1);

function updateModalNav() {
    const i = modalIndex();
    const prev = document.getElementById("modalPrev");
    const next = document.getElementById("modalNext");
    prev.disabled = i <= 0;
    next.disabled = i < 0 || i >= shownRows.length - 1;
    prev.title = prev.disabled ? "" : `Previous: ${shownRows[i - 1].name}`;
    next.title = next.disabled ? "" : `Next: ${shownRows[i + 1].name}`;
    document.getElementById("modalCount").textContent = i >= 0 ? `${i + 1} of ${shownRows.length}` : "";
}

function stepModal(step) {
    const i = modalIndex();
    const target = i >= 0 ? shownRows[i + step] : null;
    if (!target) return;
    openModal(target);
    // keep the grid behind in step, so closing lands on the title you ended up on
    document.getElementById("cardsGrid").children[i + step]?.scrollIntoView({ block: "center" });
}

document.getElementById("modalPrev").onclick = () => stepModal(-1);
document.getElementById("modalNext").onclick = () => stepModal(1);

// Swipe left/right on touch screens
(function () {
    let x0 = null;
    let y0 = null;
    const panel = document.getElementById("modalPanel");
    panel.addEventListener("touchstart", (e) => {
        [x0, y0] = [e.touches[0].clientX, e.touches[0].clientY];
    }, { passive: true });
    panel.addEventListener("touchend", (e) => {
        if (x0 == null) return;
        const dx = e.changedTouches[0].clientX - x0;
        const dy = e.changedTouches[0].clientY - y0;
        x0 = null;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) stepModal(dx < 0 ? 1 : -1);
    }, { passive: true });
})();

function closeModal() {
    modalRow = null;
    const modal = document.getElementById("modal");
    if (modal.classList.contains("hidden")) return;
    modal.classList.add("hidden");
    document.body.style.overflow = "";
}

document.getElementById("modal").onclick = function (event) {
    if (event.target === this) closeModal();
};

document.addEventListener("keydown", function (event) {
    // Admin dialogs handle their own keys.
    if (document.querySelector("[data-admin-dialog]:not(.hidden)")) return;
    if (event.key === "Escape") closeModal();
    const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
    if (modalRow && !typing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        stepModal(event.key === "ArrowLeft" ? -1 : 1);
    }
});

// Used by admin.js
window.App = {
    reload: () => loadTitles({ quiet: true }),
    getAll: () => allData,
    openModal,
    closeModal,
    showError,
    showSuccess,
    escapeHtml,
};
