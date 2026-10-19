// The title popup (the "ticket"), shared by the collection page and the releases page, which opens
// it from a release's title list instead of leaving for the collection. Needs shelf.js; adds its
// own markup to the page the first time it's opened.
//
// TitleModal.configure({...}), by the page; all optional:
//   rows()          the titles previous/next step through, in order (none: no previous/next)
//   onStep(i)       after stepping to rows()[i], e.g. to keep the grid behind in step
//   showRelease(id) open a release over the popup; without it a release link goes to its page
//   onOpened(row)   after the popup renders (the collection page's admin bar)

(function () {
    let config = {};
    let current = null;
    const cexCache = new Map();

    const esc = (value) =>
        String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    const money = (value) => `£${value.toFixed(2)}`;

    function ratingHtml(row, large = false) {
        const rating = row.rating == null ? "" : String(row.rating);
        if (!rating) return "";
        const cls = `rating${row.rating > 10 ? " rating-gold" : ""}${large ? " rating-large" : ""}`;
        return `<span class="${cls}" title="Rated ${rating} out of 10">${rating}<small>/10</small></span>`;
    }

    async function fetchCex(sku) {
        if (!sku) return null;
        if (cexCache.has(sku)) return cexCache.get(sku);
        try {
            const resp = await fetch(`/api/cex/${encodeURIComponent(sku)}`);
            if (!resp.ok) return null;
            const details = await resp.json();
            cexCache.set(sku, details);
            return details;
        } catch (e) {
            console.error("Error fetching CeX details for SKU", sku, e);
            return null;
        }
    }

    // ---------- markup ----------

    const $ = (id) => document.getElementById(id);

    function ensureMarkup() {
        if ($("modal")) return;
        document.body.insertAdjacentHTML(
            "beforeend",
            `
        <div class="overlay hidden" id="modal">
            <div class="panel panel-title" id="modalPanel" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
                <button type="button" class="close" aria-label="Close">×</button>
                <div class="modal-scroll" id="modalScroll"></div>
            </div>
            <button type="button" class="modal-nav modal-prev" id="modalPrev" aria-label="Previous title">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
            </button>
            <button type="button" class="modal-nav modal-next" id="modalNext" aria-label="Next title">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
            </button>
            <span class="modal-count" id="modalCount" aria-live="polite"></span>
        </div>`,
        );
        wire();
    }

    // ---------- content ----------

    // "2020-04-15" -> "15 Apr 2020"
    const longDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
    function formatLongDate(iso) {
        const [y, m, d] = iso.split("-").map(Number);
        return longDateFormat.format(new Date(y, m - 1, d));
    }

    // First watch, the watch with Bogdan and the latest watch, in date order. A date shared by two
    // of them is one point on the line.
    function watchLogHtml(row) {
        const points = new Map();
        const add = (iso, label) => iso && points.set(iso, [...(points.get(iso) ?? []), label]);
        add(row.firstWatch, row.watchCount > 1 ? "First watch" : "Watched");
        if (row.latestWatch !== row.firstWatch) add(row.latestWatch, "Latest watch");
        add(row.dateWithBogdan, "With Bogdan");
        if (points.size === 0) return "";
        const items = [...points]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([iso, labels]) => `
                <li${labels.includes("With Bogdan") ? ' class="is-bogdan"' : ""}>
                    <time datetime="${iso}">${formatLongDate(iso)}</time>
                    <span>${labels.join(", ")}</span>
                </li>`)
            .join("");
        return `
        <section class="modal-section">
            <h3>Watch history</h3>
            <ol class="watch-log">${items}</ol>
        </section>`;
    }

    // The stub: the verdict, then what your copy cost and what CeX would give for it.
    function stubHtml(row) {
        const facts = [];
        if (row.watchCount) facts.push(["Seen", row.watchCount === 1 ? "once" : `${row.watchCount} times`]);
        if (row.rewatchPotential != null) facts.push(["Rewatch", `${row.rewatchPotential}/10`]);
        if (row.type === "Series") {
            if (row.seasons != null) facts.push(["Seasons", String(row.seasons)]);
            if (row.episodesTotal != null) facts.push(["Episodes", String(row.episodesTotal)]);
        }
        const share = Shelf.titleShare(row);
        const paid = (share || 0) > 0;
        const formats = row.releases.length > 0;
        const cex = row.releases.some((r) => r.cexSku);
        return `
        <aside class="stub" aria-label="Verdict and value">
            ${ratingHtml(row, true) || `<p class="stub-unrated">Not rated yet</p>`}
            ${facts.length ? `<dl class="stub-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
            ${paid || formats || cex ? `
            <section class="stub-copy" aria-label="Your copy">
                ${paid ? `<p class="stub-paid">You paid <span class="price-paid">${money(share)}</span>${row.releases.some((r) => r.titleCount > 1 && r.pricePaid != null) ? ` <span class="stub-share">(its share of a set)</span>` : ""}</p>` : ""}
                ${formats ? `<ul class="stub-releases">${row.releases
                    .map((r) => `
                    <li>
                        <a href="/releases?release=${r.id}" class="link" data-release-link="${r.id}">${esc(r.name)}</a>
                        <span class="stub-release-meta">${esc(Shelf.label(r))}${r.purchasedFrom !== "Other" ? ` · ${esc(Shelf.PLACES[r.purchasedFrom])}` : ""}${r.titleCount > 1 ? ` · ${r.titleCount} titles` : ""}${r.pricePaid != null ? ` · ${money(r.pricePaid)}` : ""}</span>
                    </li>`)
                    .join("")}</ul>` : ""}
                ${cex ? `<h3>At CeX today</h3><div id="cexPricing" class="stub-cex"><p class="muted pulse">Checking prices…</p></div>` : ""}
            </section>` : ""}
        </aside>`;
    }

    // The poster is never cropped, so when the ticket is taller than the poster, the poster column
    // widens (up to a limit) until the poster fills the height instead of leaving a gap under it.
    function fitPoster() {
        const ticket = document.querySelector("#modalScroll .ticket");
        const poster = ticket?.querySelector(".modal-poster");
        if (!poster) return;
        ticket.style.removeProperty("--poster-w");
        if (matchMedia("(max-width: 760px)").matches) return;
        for (let i = 0; i < 3; i++) {
            if (ticket.offsetHeight - poster.offsetHeight <= 1) break;
            ticket.style.setProperty("--poster-w", `${Math.min(480, Math.ceil((ticket.offsetHeight * 2) / 3))}px`);
        }
    }
    window.addEventListener("resize", () => current && fitPoster());

    // Releases with a CeX product, each product once.
    const cexReleases = (row) => [...new Map(row.releases.filter((r) => r.cexSku).map((r) => [r.cexSku, r])).values()];

    async function open(row) {
        ensureMarkup();
        current = row;
        const modal = $("modal");
        const scroll = $("modalScroll");
        const panel = $("modalPanel");

        const tags = [
            `<span class="tag tag-${row.type === "Film" ? "film" : "series"}">${esc(row.type)}</span>`,
            ...row.genres.map((g) => `<span class="tag">${esc(g)}</span>`),
            row.withBogdan ? `<span class="tag tag-bogdan">With Bogdan</span>` : "",
        ].join("");

        scroll.innerHTML = `
        <div class="ticket${row.posterUrl ? "" : " no-poster"}">
            ${row.posterUrl ? `<div class="ticket-poster"><img class="modal-poster" src="${esc(row.posterUrl)}" alt="Poster for ${esc(row.name)}"></div>` : ""}
            <header class="ticket-head">
                <div class="ticket-head-text">
                    <div class="tags">${tags}</div>
                    <h2 class="modal-title" id="modalTitle">${esc(row.name)}${row.releaseYear ? ` <span class="modal-year">${row.releaseYear}</span>` : ""}</h2>
                </div>
            </header>
            <div class="ticket-actions"><div id="modalAdminBar"></div></div>
            ${stubHtml(row)}
            <div class="ticket-body">
                ${watchLogHtml(row)}
                ${row.comments ? `<blockquote class="modal-note">${esc(row.comments)}</blockquote>` : ""}
            </div>
        </div>`;

        const wasOpen = !modal.classList.contains("hidden");
        modal.classList.remove("hidden");
        if (!wasOpen) panel.querySelector(".close").focus();
        scroll.scrollTop = 0;
        fitPoster();
        document.body.style.overflow = "hidden";

        updateNav();
        config.onOpened?.(row);
        if (config.showRelease)
            scroll.querySelectorAll("[data-release-link]").forEach((a) => {
                a.onclick = (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab: the releases page
                    e.preventDefault();
                    config.showRelease(Number(a.dataset.releaseLink));
                };
            });

        // CeX pricing loads after the modal is visible
        if (cexReleases(row).length > 0) {
            let rows = "";
            for (const { cexSku: sku, cexUrl: link } of cexReleases(row)) {
                const details = await fetchCex(sku);
                if (current !== row) return; // modal was closed or switched meanwhile
                rows += details
                    ? `
                    <div class="cex-entry">
                        <a href="${esc(link)}" target="_blank" rel="noopener" class="link" title="${esc(details.boxName)}">${esc(details.boxName)}</a>
                        <dl>
                            <div><dt>Sells for</dt><dd>£${details.sellPrice}</dd></div>
                            <div class="is-cash"><dt>Cash</dt><dd>£${details.cashPrice}</dd></div>
                            <div class="is-voucher"><dt>Voucher</dt><dd>£${details.exchangePrice}</dd></div>
                        </dl>
                    </div>`
                    : `<p class="status-bad">CeX didn't return prices for <a href="${esc(link)}" target="_blank" rel="noopener" class="link">${esc(sku)}</a>.</p>`;
            }
            $("cexPricing").innerHTML = rows;
            fitPoster();
        }
    }

    // ---------- previous / next ----------

    const rows = () => config.rows?.() ?? [];
    const index = () => (current ? rows().findIndex((r) => r.id === current.id) : -1);

    function updateNav() {
        const list = rows();
        const i = index();
        const prev = $("modalPrev");
        const next = $("modalNext");
        // a title opened on its own (from a release) has nothing to step through
        prev.hidden = next.hidden = i < 0;
        prev.disabled = i <= 0;
        next.disabled = i < 0 || i >= list.length - 1;
        prev.title = prev.disabled ? "" : `Previous: ${list[i - 1].name}`;
        next.title = next.disabled ? "" : `Next: ${list[i + 1].name}`;
        $("modalCount").textContent = i >= 0 ? `${i + 1} of ${list.length}` : "";
    }

    function step(by) {
        const i = index();
        const target = i >= 0 ? rows()[i + by] : null;
        if (!target) return;
        open(target);
        config.onStep?.(i + by);
    }

    function close() {
        current = null;
        const modal = $("modal");
        if (!modal || modal.classList.contains("hidden")) return;
        modal.classList.add("hidden");
        document.body.style.overflow = "";
    }

    function wire() {
        $("modalPrev").onclick = () => step(-1);
        $("modalNext").onclick = () => step(1);
        $("modalPanel").querySelector(".close").onclick = close;
        $("modal").onclick = function (event) {
            if (event.target === this) close();
        };

        // Swipe left/right on touch screens
        let x0 = null;
        let y0 = null;
        const panel = $("modalPanel");
        panel.addEventListener("touchstart", (e) => {
            [x0, y0] = [e.touches[0].clientX, e.touches[0].clientY];
        }, { passive: true });
        panel.addEventListener("touchend", (e) => {
            if (x0 == null) return;
            const dx = e.changedTouches[0].clientX - x0;
            const dy = e.changedTouches[0].clientY - y0;
            x0 = null;
            if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
        }, { passive: true });
    }

    document.addEventListener("keydown", function (event) {
        // Admin dialogs handle their own keys.
        if (document.querySelector("[data-admin-dialog]:not(.hidden)")) return;
        if (event.key === "Escape") close();
        const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
        if (current && !typing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            event.preventDefault();
            step(event.key === "ArrowLeft" ? -1 : 1);
        }
    });

    window.TitleModal = {
        configure: (c) => (config = c),
        open,
        close,
        current: () => current,
        ratingHtml,
        fetchCex,
    };
})();
