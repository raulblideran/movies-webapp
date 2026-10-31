// The title popup (the "ticket"), shared by the collection page and the releases page, which opens
// it from a release's title list instead of leaving for the collection. Needs shelf.js; adds its
// own markup to the page the first time it's opened.
//
// TitleModal.configure({...}), by the page; all optional:
//   rows()          the titles previous/next step through, in order (none: no previous/next)
//   onStep(i)       after stepping to rows()[i], e.g. to keep the grid behind in step
//   showRelease(id) open a release over the popup; without it a release link goes to its page
//   onOpened(row)   after the popup renders (the collection page's admin bar)
//   lookup(mediaType, tmdbId)   the title with that TMDB id, if you have it (franchise progress)
//   addToWatchlist(parts)       optional, for editors: add a franchise's films ({ id, title }) to the watchlist
//
// The popup shares a layer with the release popups and other dialogs (js/auth.js), and whichever
// was opened last is on top. TitleModal.open(row, { front: true }) brings it over an open release;
// if it was already showing another title further down, that title comes back when this one closes.

(function () {
    let config = {};
    let current = null;
    // titles this popup showed further down before it was brought to the front: [{ row, below }],
    // where below is the dialog that sat on top of it
    const covered = [];
    let opener = null;
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

    // 135 → "2h 15m"; a series' runtime is its episode length
    function runtimeText(row) {
        if (!row.runtime) return "";
        const h = Math.floor(row.runtime / 60), m = row.runtime % 60;
        const t = h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
        return row.type === "Series" ? `${t} episodes` : t;
    }

    const pad = (n) => String(n).padStart(2, "0");
    function todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    // How long something has been on the watchlist: "today", "12 days", "5 months", "2 years"
    function waitText(iso) {
        const [y, m, d] = iso.split("-").map(Number);
        const [ty, tm, td] = todayIso().split("-").map(Number);
        const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000);
        if (days <= 0) return "today";
        if (days < 45) return days === 1 ? "1 day" : `${days} days`;
        if (days < 730) return `${Math.round(days / 30.44)} months`;
        return `${Math.floor(days / 365.25)} years`;
    }

    // First watch, the watch with Bogdan and the latest watch, in date order. A date shared by two
    // of them is one point on the line.
    function watchLogHtml(row) {
        const points = new Map();
        const add = (iso, label) => iso && points.set(iso, [...(points.get(iso) ?? []), label]);
        add(row.firstWatch, row.watchCount > 1 ? "First watch" : "Watched");
        if (row.latestWatch !== row.firstWatch) add(row.latestWatch, "Latest watch");
        add(row.dateWithBogdan, "With Bogdan");
        add(row.watchlistAddedOn, "Added to watchlist");
        if (points.size === 0) return "";
        const cls = (labels) =>
            labels.includes("With Bogdan") ? ' class="is-bogdan"' : labels.length === 1 && labels[0] === "Added to watchlist" ? ' class="is-watchlist"' : "";
        const items = [...points]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([iso, labels]) => `
                <li${cls(labels)}>
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

    // On the watchlist: how long it's been waiting, where a watched title shows its rating.
    function waitingHtml(row) {
        const since = row.watchlistAddedOn;
        return `
            <p class="stub-waiting">
                <span class="stub-waiting-label">On your watchlist</span>
                ${!since ? "" : waitText(since) === "today"
                    ? `<span class="stub-waiting-time">since today</span>`
                    : `<span class="stub-waiting-time">${esc(waitText(since))}</span>
                       <span class="stub-waiting-since">since <time datetime="${since}">${formatLongDate(since)}</time></span>`}
            </p>`;
    }

    // The stub: the verdict, then what your copy cost and what CeX would give for it.
    // A watchlist title gets how long it's been waiting instead of the verdict (and its old rating, if
    // it's waiting for a rewatch).
    function stubHtml(row) {
        const W = row.list === "watchlist";
        const facts = [];
        if (W && row.rating != null) facts.push(["Rated", `${row.rating}/10`]);
        if (row.runtime) facts.push(["Runtime", runtimeText(row)]);
        if (row.watchCount) facts.push(["Seen", row.watchCount === 1 ? "once" : `${row.watchCount} times`]);
        if (!W && row.rewatchPotential != null) facts.push(["Rewatch", `${row.rewatchPotential}/10`]);
        if (row.type === "Series") {
            if (row.seasons != null) facts.push(["Seasons", String(row.seasons)]);
            if (row.episodesTotal != null) facts.push(["Episodes", String(row.episodesTotal)]);
        }
        const share = Shelf.titleShare(row);
        const paid = (share || 0) > 0;
        const formats = row.releases.length > 0;
        const cex = row.releases.some((r) => r.cexSku);
        return `
        <aside class="stub" aria-label="${W ? "On your watchlist" : "Verdict and value"}">
            ${W ? waitingHtml(row) : ratingHtml(row, true) || `<p class="stub-unrated">Not rated yet</p>`}
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

    // "Directed by Ridley Scott · Starring Sigourney Weaver, Tom Skerritt" (a series: "Created by")
    function creditsHtml(row) {
        const parts = [];
        if (row.directors?.length) parts.push(`${row.type === "Series" ? "Created" : "Directed"} by ${row.directors.map(esc).join(", ")}`);
        if (row.cast?.length) parts.push(`Starring ${row.cast.slice(0, 4).map(esc).join(", ")}`);
        return parts.length ? `<p class="modal-credits">${parts.join(" · ")}</p>` : "";
    }

    // The trailer plays in a dialog over the popup (closing it stops the video).
    function openTrailer(row) {
        const key = encodeURIComponent(row.trailerKey);
        const d = Auth.dialog(
            `${esc(row.name)}: trailer`,
            `<div class="trailer-frame"><iframe src="https://www.youtube-nocookie.com/embed/${key}?autoplay=1&rel=0" title="Trailer for ${esc(row.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
             <p class="trailer-link"><a href="https://www.youtube.com/watch?v=${key}" target="_blank" rel="noopener" class="link">Open on YouTube ↗</a></p>`,
            { wide: true },
        );
        d.root.classList.add("trailer-dialog");
    }

    // ---------- franchise progress: the film's TMDB collection, and which of its films you have ----------

    const collections = new Map(); // id → Promise of the collection (or null)
    function fetchCollection(id) {
        if (!collections.has(id))
            collections.set(id, fetch(`/api/tmdb/collection/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
        return collections.get(id);
    }

    const todayText = () => todayIso();
    // where a part stands: yours (watched / on the watchlist), still to come, or not yours yet
    function partStatus(part) {
        const mine = config.lookup?.("movie", part.id);
        if (mine) return { mine, kind: mine.list === "watchlist" && !mine.watchCount ? "watchlist" : "watched" };
        if (!part.releaseDate || part.releaseDate > todayText()) return { kind: "coming" };
        return { kind: "missing" };
    }

    async function showFranchise(row) {
        const c = await fetchCollection(row.collectionId);
        const box = document.getElementById("franchise");
        if (current !== row || !box) return; // switched or closed meanwhile
        if (!c || c.parts.length < 2) return box.remove();
        const parts = c.parts.map((p) => ({ ...p, ...partStatus(p) }));
        const released = parts.filter((p) => p.kind !== "coming");
        const watched = released.filter((p) => p.kind === "watched").length;
        const canAdd = config.addToWatchlist && window.Auth?.me?.canEdit;
        const missing = parts.filter((p) => p.kind === "missing" || p.kind === "coming");
        const badge = (p) =>
            p.mine?.id === row.id ? "This one"
            : p.kind === "watched" ? "Watched"
            : p.kind === "watchlist" ? "On your watchlist"
            : p.kind === "coming" ? (p.year ? `Coming ${p.year}` : "Coming soon")
            : "";
        box.innerHTML = `
            <h3>${esc(c.name)}</h3>
            <p class="franchise-count">${watched} of ${released.length} watched</p>
            <div class="franchise-bar" role="progressbar" aria-label="Films watched" aria-valuemin="0" aria-valuemax="${released.length}" aria-valuenow="${watched}"><span style="width:${released.length ? (watched / released.length) * 100 : 0}%"></span></div>
            <ol class="franchise-parts">${parts
                .map((p, i) => `
                <li class="franchise-part is-${p.kind}${p.mine?.id === row.id ? " is-current" : ""}">
                    <a ${p.mine ? `href="${window.Lists ? Lists.link(p.mine) : "#"}" data-part-title="${i}"` : `href="https://www.themoviedb.org/movie/${p.id}" target="_blank" rel="noopener"`} title="${esc(p.title)}${p.year ? ` (${p.year})` : ""}">
                        ${p.posterUrl ? `<img src="${esc(p.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="franchise-noposter">${esc(p.title)}</span>`}
                        <span class="franchise-name">${esc(p.title)}</span>
                        <span class="franchise-meta">${p.year ?? ""}${badge(p) ? `${p.year ? " · " : ""}<strong>${badge(p)}</strong>` : ""}</span>
                    </a>
                    ${canAdd && !p.mine ? `<button type="button" class="btn btn-small" data-part-add="${i}">+ Watchlist</button>` : ""}
                </li>`)
                .join("")}</ol>
            ${canAdd && missing.length > 1 ? `<button type="button" class="btn btn-small" data-parts-add>Add all ${missing.length} to the watchlist</button>` : ""}`;
        // yours open here; a click on one you don't have goes to TMDB
        box.querySelectorAll("[data-part-title]").forEach((a) => {
            a.onclick = (e) => {
                if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                const mine = parts[Number(a.dataset.partTitle)].mine;
                if (mine.id !== row.id) open(mine);
            };
        });
        const add = async (list, button) => {
            button.disabled = true;
            button.textContent = "Adding…";
            await config.addToWatchlist(list.map((p) => ({ id: p.id, title: p.title })));
        };
        box.querySelectorAll("[data-part-add]").forEach((b) => (b.onclick = () => add([parts[Number(b.dataset.partAdd)]], b)));
        box.querySelector("[data-parts-add]")?.addEventListener("click", (e) => add(missing, e.currentTarget));
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

    // ---------- stacking ----------

    const visibleOverlays = () => [...document.querySelectorAll(".overlay:not(.hidden)")];
    const isOnTop = (el) => visibleOverlays().pop() === el;

    // open(row): show the title, refreshing it where it is if the popup is already open.
    // open(row, { front: true }): also bring the popup over anything opened on top of it.
    async function open(row, { front = false } = {}) {
        ensureMarkup();
        const modal = $("modal");
        const panel = $("modalPanel");
        const wasOpen = !modal.classList.contains("hidden");
        if (!wasOpen || (front && !isOnTop(modal))) {
            if (wasOpen && current) {
                const above = visibleOverlays();
                covered.push({ row: current, below: above[above.indexOf(modal) + 1] });
            }
            opener = document.activeElement;
            document.body.appendChild(modal); // last in the page = on top
            modal.classList.remove("hidden");
            render(row);
            panel.querySelector(".close").focus();
        } else {
            render(row);
        }
        document.body.style.overflow = "hidden";
    }

    async function render(row) {
        current = row;
        const scroll = $("modalScroll");

        const tags = [
            `<span class="tag tag-${row.type === "Film" ? "film" : "series"}">${esc(row.type)}</span>`,
            row.list === "watchlist" ? `<span class="tag tag-watchlist">Watchlist</span>` : "",
            ...row.genres.map((g) => `<span class="tag">${esc(g)}</span>`),
            row.withBogdan ? `<span class="tag tag-bogdan">With Bogdan</span>` : "",
            row.watchedInCinema ? `<span class="tag tag-cinema">In cinema</span>` : "",
        ].join("");

        scroll.innerHTML = `
        <div class="ticket${row.posterUrl ? "" : " no-poster"}">
            ${row.posterUrl ? `<div class="ticket-poster"><img class="modal-poster" src="${esc(row.posterUrl)}" alt="Poster for ${esc(row.name)}"></div>` : ""}
            <header class="ticket-head">
                <div class="ticket-head-text">
                    <div class="tags">${tags}</div>
                    <h2 class="modal-title" id="modalTitle">${esc(row.name)}${row.releaseYear ? ` <span class="modal-year">${row.releaseYear}</span>` : ""}</h2>
                    ${creditsHtml(row)}
                    ${row.trailerKey ? `<button type="button" class="btn btn-small modal-trailer" data-trailer><span aria-hidden="true">▶</span> Watch the trailer</button>` : ""}
                </div>
            </header>
            <div class="ticket-actions"><div id="modalAdminBar"></div></div>
            ${stubHtml(row)}
            ${watchLogHtml(row) || row.comments || row.overview || row.collectionId ? `
            <div class="ticket-body">
                ${row.overview ? `<p class="modal-overview">${esc(row.overview)}</p>` : ""}
                ${watchLogHtml(row)}
                ${row.comments ? `<blockquote class="modal-note">${esc(row.comments)}</blockquote>` : ""}
                ${row.collectionId ? `<section class="modal-section franchise" id="franchise" aria-live="polite"><h3>${esc(row.collectionName ?? "Collection")}</h3><p class="muted pulse">Looking up the collection…</p></section>` : ""}
            </div>` : ""}
        </div>`;

        scroll.scrollTop = 0;
        fitPoster();

        updateNav();
        scroll.querySelector("[data-trailer]")?.addEventListener("click", () => openTrailer(row));
        config.onOpened?.(row);
        if (config.showRelease)
            scroll.querySelectorAll("[data-release-link]").forEach((a) => {
                a.onclick = (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab: the releases page
                    e.preventDefault();
                    config.showRelease(Number(a.dataset.releaseLink));
                };
            });

        if (row.collectionId) showFranchise(row);

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
        const modal = $("modal");
        if (!modal || modal.classList.contains("hidden")) return;
        if (opener?.isConnected) opener.focus();
        opener = null;
        // the title this one covered goes back where it was, under the dialog that was over it
        let back = covered.pop();
        while (back && !back.below?.isConnected) back = covered.pop();
        if (back) {
            back.below.before(modal);
            render(back.row);
            return;
        }
        current = null;
        modal.classList.add("hidden");
        if (!visibleOverlays().length) document.body.style.overflow = "";
    }

    function wire() {
        $("modalPrev").onclick = () => step(-1);
        $("modalNext").onclick = () => step(1);
        // only × and Esc close it: a click on the backdrop does nothing
        $("modalPanel").querySelector(".close").onclick = close;

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
        // Only while the popup is on top; dialogs over it handle their own keys.
        const modal = $("modal");
        if (!current || !modal || !isOnTop(modal)) return;
        if (event.key === "Escape") {
            // stop here, or the dialog underneath would see the same Escape once this is closed
            event.stopImmediatePropagation();
            close();
            return;
        }
        const typing = event.target.closest?.("input, textarea, select, [contenteditable]");
        if (!typing && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
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
        todayIso,
        waitText,
        formatLongDate,
        runtimeText,
    };
})();
