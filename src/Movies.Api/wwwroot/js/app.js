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

// "2020-04-01" -> "04/2020"
function formatMonth(iso) {
    if (!iso) return "";
    const [y, m] = iso.split("-");
    return `${m}/${y}`;
}

function formatRating(rating) {
    return rating == null ? "" : String(rating);
}

function ensureSpinAnimation() {
    if (!document.getElementById("spinAnimation")) {
        const style = document.createElement("style");
        style.id = "spinAnimation";
        style.textContent =
            "@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
        document.head.appendChild(style);
    }
}

// Detail rows shown on cards and in the modal, in the original sheet's column order and labels.
function detailFields(row) {
    return [
        ["1st Watch", formatMonth(row.firstWatch)],
        ["Watch count", row.watchCount ? String(row.watchCount) : ""],
        ["Latest Watch", formatMonth(row.latestWatch)],
        ["Seasons", row.seasons != null ? String(row.seasons) : ""],
        ["Episodes Total", row.episodesTotal != null ? String(row.episodesTotal) : ""],
        ["Genre", row.genres.join("/")],
        ["Date W/Bogdi", formatMonth(row.dateWithBogdan)],
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
        formatMonth(row.firstWatch),
        formatMonth(row.latestWatch),
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
    const iconEl = document.getElementById("calcCexIcon");

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
    btn.style.opacity = "0.5";
    iconEl.style.display = "inline-block";
    iconEl.style.animation = "spin 1s linear infinite";
    ensureSpinAnimation();

    totalsEl.classList.remove("hidden");
    totalsEl.classList.add("flex");
    document.getElementById("totalSell").textContent = "...";
    document.getElementById("totalCash").textContent = "...";
    document.getElementById("totalVoucher").textContent = "...";
    const totalPaidAll = totalPaidCex + totalPaidOther;
    document.getElementById("totalPaidCex").textContent =
        totalPaidCex > 0 ? `£${totalPaidCex.toFixed(2)}` : "-";
    document.getElementById("totalPaidOther").textContent =
        totalPaidOther > 0 ? `£${totalPaidOther.toFixed(2)}` : "-";
    document.getElementById("totalPaidAll").textContent =
        totalPaidAll > 0 ? `£${totalPaidAll.toFixed(2)}` : "-";
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
            document.getElementById("totalSell").textContent = `£${totalSell.toFixed(2)}`;
            document.getElementById("totalCash").textContent = `£${totalCash.toFixed(2)}`;
            document.getElementById("totalVoucher").textContent = `£${totalVoucher.toFixed(2)}`;
        }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    iconEl.style.animation = "";
    btn.disabled = false;
    btn.style.opacity = "1";
    document.getElementById("totalCexItems").textContent = `${itemCount}`;
}

// ---------- notifications / UI toggles ----------

function showError(message) {
    const errorEl = document.getElementById("error");
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    errorEl.classList.add("block");
    setTimeout(() => {
        errorEl.classList.add("hidden");
        errorEl.classList.remove("block");
    }, 8000);
}

function showSuccess(message) {
    const successEl = document.getElementById("success");
    successEl.textContent = message;
    successEl.classList.remove("hidden");
    successEl.classList.add("block");
    setTimeout(() => {
        successEl.classList.add("hidden");
        successEl.classList.remove("block");
    }, 3000);
}

function toggleFilters() {
    const filtersSection = document.getElementById("filtersSection");
    const filterIcon = document.getElementById("filterToggleIcon");
    filtersSection.classList.toggle("collapsed");
    filterIcon.style.transform = filtersSection.classList.contains("collapsed")
        ? "rotate(0deg)"
        : "rotate(180deg)";
}

function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    overlay.classList.toggle("hidden", !show);
    overlay.classList.toggle("flex", show);
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
    const refreshIcon = document.getElementById("refreshIcon");
    const refreshButton = document.getElementById("refreshButton");

    refreshIcon.style.display = "inline-block";
    refreshIcon.style.animation = "spin 1s linear infinite";
    refreshButton.disabled = true;
    refreshButton.style.opacity = "0.5";
    ensureSpinAnimation();

    cexCache = {};
    if (await loadTitles({ quiet: true })) {
        showSuccess("✅ Collection refreshed! Found " + allData.length + " titles.");
    }

    refreshIcon.style.animation = "";
    refreshButton.disabled = false;
    refreshButton.style.opacity = "1";
}

window.addEventListener("DOMContentLoaded", () => {
    loadTitles();
    fetch("/api/version")
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
            if (v?.version) document.getElementById("appVersion").textContent = `v${v.version}`;
        })
        .catch(() => {});
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

    statsEl.innerHTML = `
    <div class="group relative bg-gradient-to-br from-white/8 to-white/12 backdrop-blur-md px-6 py-4 rounded-xl border border-white/15 text-center hover:border-primary/50 transition-all duration-300 hover:scale-105 min-w-[120px]">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2 font-semibold">📊 Total</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary to-red-400">${totalCount}</div>
    </div>
    <div class="group relative bg-gradient-to-br from-white/8 to-white/12 backdrop-blur-md px-6 py-4 rounded-xl border border-white/15 text-center hover:border-blue-500/50 transition-all duration-300 hover:scale-105 min-w-[120px]">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2 font-semibold">🎬 Films</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">${films}</div>
    </div>
    <div class="group relative bg-gradient-to-br from-white/8 to-white/12 backdrop-blur-md px-6 py-4 rounded-xl border border-white/15 text-center hover:border-cyan-500/50 transition-all duration-300 hover:scale-105 min-w-[120px]">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2 font-semibold">📺 Series</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-teal-400">${series}</div>
    </div>
    <div class="group relative bg-gradient-to-br from-white/8 to-white/12 backdrop-blur-md px-6 py-4 rounded-xl border border-white/15 text-center hover:border-yellow-500/50 transition-all duration-300 hover:scale-105 min-w-[120px]">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2 font-semibold">⭐ Rating</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-400">${avgRating}</div>
    </div>
    <div class="group relative bg-gradient-to-br from-white/8 to-white/12 backdrop-blur-md px-6 py-4 rounded-xl border border-white/15 text-center hover:border-purple-500/50 transition-all duration-300 hover:scale-105 min-w-[120px]">
        <div class="text-xs uppercase tracking-wider text-gray-400 mb-2 font-semibold">👥 Bogdan</div>
        <div class="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">${withBogdan}</div>
    </div>
`;
}

const FILTER_BTN =
    "px-4 py-2 border-2 border-primary text-white rounded-full cursor-pointer transition-all duration-300 font-semibold text-xs";

function filterButton(category, value, label) {
    const btn = document.createElement("button");
    const active = activeFilters[category] === value;
    btn.className =
        FILTER_BTN + (active ? " !bg-primary scale-105" : " bg-black/30 hover:bg-primary hover:scale-105");
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

    document.querySelectorAll(`#${category}Filters button`).forEach((btn) => {
        btn.classList.remove("!bg-primary", "scale-105");
        btn.classList.add("bg-black/30");
    });
    if (button) {
        button.classList.remove("bg-black/30");
        button.classList.add("!bg-primary", "scale-105");
    }

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
    displayCards(filtered);
}

// ---------- sorting ----------

function toggleSortDropdown() {
    document.getElementById("sortDropdown").classList.toggle("hidden");
}

function selectSort(sortBy, displayText, element) {
    currentSort = sortBy;
    document.getElementById("sortButtonText").textContent = displayText;

    const dropdown = document.getElementById("sortDropdown");
    dropdown.querySelectorAll("div[data-active]").forEach((opt) => {
        opt.removeAttribute("data-active");
        opt.classList.remove("bg-yellow-500/20", "text-yellow-500");
        opt.classList.add("text-white");
    });
    element.setAttribute("data-active", "true");
    element.classList.add("bg-yellow-500/20", "text-yellow-500");
    element.classList.remove("text-white");

    dropdown.classList.add("hidden");
    sortCards();
}

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
        dropdown.classList.add("hidden");
    }
});

// ---------- cards ----------

const BADGE = {
    film: "bg-blue-500/30 border border-blue-500 text-blue-500",
    series: "bg-cyan-400/30 border border-cyan-400 text-cyan-400",
    bogdan: "bg-purple-500/30 border-2 border-purple-500 text-purple-500 font-bold",
    physical: "bg-orange-500/30 border border-orange-500 text-orange-500",
    rewatch: "bg-green-500/30 border border-green-500 text-green-500",
};

function ratingBadgeClass(rating) {
    return rating === 11
        ? "bg-gradient-to-br from-yellow-400 to-yellow-600 text-black shadow-[0_4px_10px_rgba(255,215,0,0.5)]"
        : "bg-gradient-to-br from-primary to-primary-dark text-white shadow-[0_4px_10px_rgba(233,69,96,0.3)]";
}

function typeBadge(row) {
    return row.type === "Film" ? BADGE.film : BADGE.series;
}

function displayCards(data) {
    const grid = document.getElementById("cardsGrid");
    grid.innerHTML = "";

    if (data.length === 0) {
        grid.innerHTML = '<p class="text-white text-center w-full text-xl">No titles match your filters 🎬</p>';
        return;
    }

    const fragment = document.createDocumentFragment();
    for (const [index, row] of data.entries()) {
        const card = document.createElement("div");
        card.className =
            "bg-white/12 backdrop-blur-md rounded-3xl p-0 border border-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition-all duration-300 animate-fadeInUp relative overflow-hidden cursor-pointer hover:-translate-y-2.5 hover:scale-[1.02] hover:shadow-[0_20px_40px_rgba(233,69,96,0.4)] hover:border-primary card";
        card.style.animationDelay = `${Math.min(index, 60) * 0.03}s`;
        card.onclick = () => openModal(row);

        const hasPhysical = row.physicalFormats.length > 0;
        const rating = formatRating(row.rating);

        let html = row.posterUrl
            ? `<img src="${escapeHtml(row.posterUrl)}" loading="lazy" alt="${escapeHtml(row.name)}" class="w-full h-[280px] object-contain bg-gradient-to-br from-primary/20 to-black/40" />`
            : `<div class="w-full h-[280px] bg-gradient-to-br from-primary/20 to-black/40 flex items-center justify-center text-3xl">🎬</div>`;

        html += `
        <div class="p-4">
            <div class="flex justify-between items-start mb-3">
                <h3 class="text-white text-lg flex-1">${escapeHtml(row.name)}</h3>
                ${rating ? `<div class="px-2.5 py-1.5 rounded-lg font-bold text-sm min-w-[45px] text-center ${ratingBadgeClass(row.rating)}">${rating}/10</div>` : ""}
            </div>
            <div class="flex gap-1.5 flex-wrap mb-3">
                <span class="px-2.5 py-1 rounded-xl text-[0.7em] font-semibold uppercase tracking-wide ${typeBadge(row)}">${row.type}</span>
                ${row.withBogdan ? `<span class="px-2.5 py-1 rounded-xl text-[0.7em] font-semibold uppercase tracking-wide ${BADGE.bogdan}">👥 Bogdan</span>` : ""}
                ${hasPhysical ? `<span class="px-2.5 py-1 rounded-xl text-[0.7em] font-semibold uppercase tracking-wide ${BADGE.physical}">💿 Physical</span>` : ""}
                ${(row.rewatchPotential ?? 0) >= 9 ? `<span class="px-2.5 py-1 rounded-xl text-[0.7em] font-semibold uppercase tracking-wide ${BADGE.rewatch}">♻️ Rewatch</span>` : ""}
            </div>
        `;

        for (const [label, value] of detailFields(row)) {
            const golden =
                label === "Watch count" && row.watchCount >= 10
                    ? "bg-gradient-to-br from-yellow-400 to-yellow-600 text-black font-bold px-3 py-1.5 rounded-lg inline-block shadow-[0_4px_10px_rgba(255,215,0,0.5)]"
                    : "";
            html += `<div class="my-1.5 py-1.5 border-b border-white/10 text-sm last:border-b-0"><div class="font-semibold text-primary text-xs uppercase tracking-wide opacity-90">${label}</div><div class="text-white mt-1 opacity-90 ${golden}">${escapeHtml(value)}</div></div>`;
        }

        html += "</div>";
        card.innerHTML = html;
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

    const physicalColors = [
        "bg-orange-500/30 border border-orange-500 text-orange-500",
        "bg-purple-500/30 border border-purple-500 text-purple-500",
        "bg-blue-500/30 border border-blue-500 text-blue-500",
        "bg-green-500/30 border border-green-500 text-green-500",
        "bg-yellow-500/30 border border-yellow-500 text-yellow-500",
    ];
    const physicalBadges = row.physicalFormats
        .map(
            (format, index) =>
                `<span class="px-4 py-2 rounded-xl text-base font-semibold uppercase tracking-wide ${physicalColors[index % 5]}">💿 ${escapeHtml(format)}</span>`,
        )
        .join("\n");

    const rating = formatRating(row.rating);

    let html = `
    <div id="modalAdminBar"></div>
    <div class="flex gap-2.5 flex-wrap mb-5">
        <span class="px-4 py-2 rounded-xl text-base font-semibold uppercase tracking-wide ${typeBadge(row)}">${row.type}</span>
        ${row.withBogdan ? `<span class="px-4 py-2 rounded-xl text-base font-semibold uppercase tracking-wide ${BADGE.bogdan}">👥 Bogdan</span>` : ""}
        ${physicalBadges}
        ${(row.rewatchPotential ?? 0) >= 9 ? `<span class="px-4 py-2 rounded-xl text-base font-semibold uppercase tracking-wide ${BADGE.rewatch}">♻️ High Rewatch</span>` : ""}
    </div>
    <div class="mb-5">
        <h2 class="text-4xl text-white mb-4 pr-16">${escapeHtml(row.name)}</h2>
        ${rating ? `<div class="inline-block"><div class="px-5 py-3 rounded-lg font-bold text-2xl min-w-[60px] text-center ${ratingBadgeClass(row.rating)}">${rating}/10</div></div>` : ""}
    </div>
    `;

    for (const [label, value] of detailFields(row)) {
        if (label === "Price (£)") continue; // shown in its own section below
        const golden =
            label === "Watch count" && row.watchCount >= 10
                ? "bg-gradient-to-br from-yellow-400 to-yellow-600 text-black font-bold px-4 py-2 rounded-lg inline-block shadow-[0_4px_10px_rgba(255,215,0,0.5)]"
                : "";
        html += `
        <div class="my-4 p-4 bg-white/5 rounded-xl border-l-4 border-primary">
            <div class="font-semibold text-primary text-sm uppercase tracking-wide mb-2">${label}</div>
            <div class="text-white text-lg leading-relaxed ${golden}">${escapeHtml(value)}</div>
        </div>`;
    }

    if ((row.pricePaid || 0) > 0) {
        html += `
        <div class="my-4 p-4 bg-primary/5 rounded-xl border-l-4 border-primary">
            <div class="font-semibold text-primary text-sm uppercase tracking-wide mb-3">Price Paid</div>
            <div class="bg-primary/10 rounded-lg p-3 text-center border border-primary/30 inline-block">
                <div class="text-xs text-primary uppercase tracking-wide mb-1">Total</div>
                <div class="text-2xl font-bold text-primary">£${row.pricePaid.toFixed(2)}</div>
            </div>
        </div>`;
    }

    if (row.cexLinks.length > 0) {
        html += `
        <div class="my-4 p-4 bg-emerald-500/5 rounded-xl border-l-4 border-emerald-500" id="cexSection">
            <div class="font-semibold text-emerald-400 text-sm uppercase tracking-wide mb-3">CeX Value</div>
            <div id="cexPricing" class="text-gray-400 text-sm animate-pulse">Loading CeX pricing...</div>
        </div>`;
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

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.body.style.overflow = "hidden";

    window.Admin?.onModalOpened(row);

    // CeX pricing loads after the modal is visible
    if (row.cexLinks.length > 0) {
        const pricingEl = document.getElementById("cexPricing");
        let resultsHtml = "";
        let loaded = 0;
        for (const link of row.cexLinks) {
            const sku = extractCexSku(link);
            if (!sku) continue;
            const details = await fetchCexDetails(sku);
            if (modalRow !== row) return; // modal was closed or switched meanwhile
            if (!details) {
                resultsHtml += `<div class="mb-3 text-red-400 text-xs">Could not fetch data for SKU ${escapeHtml(sku)}</div>`;
                continue;
            }
            loaded++;
            resultsHtml += `
            <div class="${loaded > 1 ? "mt-4 pt-4 border-t border-emerald-500/20" : ""}">
                <div class="grid grid-cols-3 gap-3 mb-3">
                    <div class="bg-white/5 rounded-lg p-3 text-center">
                        <div class="text-xs text-gray-400 uppercase tracking-wide mb-1">Sell Price</div>
                        <div class="text-xl font-bold text-white">£${details.sellPrice}</div>
                        <div class="text-[10px] text-gray-500 mt-1">What CeX sells for</div>
                    </div>
                    <div class="bg-emerald-500/10 rounded-lg p-3 text-center border border-emerald-500/30">
                        <div class="text-xs text-emerald-400 uppercase tracking-wide mb-1">Cash</div>
                        <div class="text-xl font-bold text-emerald-400">£${details.cashPrice}</div>
                        <div class="text-[10px] text-gray-500 mt-1">Cash payout</div>
                    </div>
                    <div class="bg-yellow-500/10 rounded-lg p-3 text-center border border-yellow-500/30">
                        <div class="text-xs text-yellow-400 uppercase tracking-wide mb-1">Voucher</div>
                        <div class="text-xl font-bold text-yellow-400">£${details.exchangePrice}</div>
                        <div class="text-[10px] text-gray-500 mt-1">Store credit</div>
                    </div>
                </div>
                <div class="flex items-center justify-between">
                    <span class="text-xs text-gray-500">${escapeHtml(details.boxName)}</span>
                    <a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="text-xs text-emerald-400 hover:text-emerald-300 underline" onclick="event.stopPropagation()">View on CeX</a>
                </div>
            </div>`;
        }
        pricingEl.classList.remove("animate-pulse");
        pricingEl.innerHTML = resultsHtml || '<span class="text-red-400">Could not fetch CeX data</span>';
    }
}

function closeModal() {
    modalRow = null;
    const modal = document.getElementById("modal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.style.overflow = "auto";
}

document.getElementById("modal").onclick = function (event) {
    if (event.target === this) closeModal();
};

document.addEventListener("keydown", function (event) {
    // Admin dialogs handle their own Escape.
    if (event.key === "Escape" && !document.querySelector("[data-admin-dialog]:not(.hidden)")) closeModal();
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
