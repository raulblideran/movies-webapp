// Physical releases page: every disc (or box set) on the shelf and the titles on it, and (one chip away) the
// ones traded in or sold, kept as history. Public read; editors add, edit and delete releases. Needs auth.js
// and shelf.js.
//   /releases?release=12          opens that release
//   /releases?status=sold&via=Cex  what went, and where (status: shelf, the default, all or sold)
//   /releases?titles=none          releases with no titles linked (something to fix)
//   /releases?new=1&title=34      opens "Add a release" with that title already picked (editors)

(function () {
    const { api, esc } = Auth;
    const { label, FORMATS, EDITIONS, PLACES, CHANNELS, money, renderTable, viewToggle, isSold, saleBadge, saleNet, signed, day } = Shelf;

    let releases = [];
    let titles = new Map(); // id → title
    // status: on the shelf (the default), all, or traded in / sold; via: where the sold ones went
    const filter = { q: "", status: "shelf", via: "all", titles: "all", format: "all", edition: "all", place: "all", sort: "name" };
    // the sorts about sales: picking one while the page shows the shelf switches to what went
    const SALE_SORTS = ["sold-recent", "sale-best", "sale-worst"];
    const DEFAULTS = { ...filter };
    let tableSort = { key: "name", dir: "asc" };
    let shown = [];

    // Search, filters, sort and grid/table live in the URL too (?q=&status=&via=&format=&edition=&place=&sort=&view=),
    // so Back, a refresh or a shared link land on the same view.
    (function readUrl() {
        const p = new URLSearchParams(location.search);
        for (const k of Object.keys(filter)) if (p.get(k)) filter[k] = k === "q" ? p.get(k).toLowerCase() : p.get(k);
        if (p.get("q")) document.getElementById("releaseSearch").value = p.get("q");
        const sort = sortSelect();
        if ([...sort.options].some((o) => o.value === filter.sort)) {
            sort.value = filter.sort;
            sort.dispatchEvent(new Event("change")); // the themed dropdown (select.js) follows "change"
        } else filter.sort = DEFAULTS.sort;
        if (!["shelf", "all", "sold"].includes(filter.status)) filter.status = DEFAULTS.status;
        if (filter.via !== "all" && !(filter.via in CHANNELS)) filter.via = DEFAULTS.via;
        if (!["all", "none"].includes(filter.titles)) filter.titles = DEFAULTS.titles;
        if (["grid", "table"].includes(p.get("view")))
            try {
                localStorage.setItem("view:releases", p.get("view"));
            } catch {
                // storage unavailable
            }
    })();
    // the native <select>: select.js gives its id to the themed button that replaces it on screen
    function sortSelect() {
        return document.querySelector("select[data-release-sort]");
    }

    let urlTimer = null;
    function writeUrl() {
        clearTimeout(urlTimer);
        urlTimer = setTimeout(() => {
            const p = new URLSearchParams(location.search);
            for (const k of Object.keys(filter)) {
                const v = k === "q" ? document.getElementById("releaseSearch").value.trim() : filter[k];
                if (v && v !== DEFAULTS[k]) p.set(k, v);
                else p.delete(k);
            }
            if (view.get() !== "grid") p.set("view", view.get());
            else p.delete("view");
            history.replaceState(history.state, "", location.pathname + (p.size ? `?${p}` : "") + location.hash);
        }, 250);
    }

    const view = viewToggle(document.getElementById("viewToggle"), "releases", () => show());

    const titlesOf = (r) => r.titleIds.map((id) => titles.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

    // ---------- loading ----------

    async function load() {
        const [rs, ts] = await Promise.all([api("GET", "/api/releases"), api("GET", "/api/titles")]);
        releases = rs;
        titles = new Map(ts.map((t) => [t.id, Lists.normalise(t)])); // both lists: a disc can hold one you haven't seen
        TitleEditor.refreshReleases((id) => titles.get(id));
        for (const r of releases)
            r._search = [r.name, r.cexBoxName, r.notes, label(r), PLACES[r.purchasedFrom], ...titlesOf(r).map((t) => t.name), ...(isSold(r) ? [saleBadge(r), CHANNELS[r.soldVia], "sold traded"] : [])]
                .filter(Boolean).join(" ").toLowerCase();
        hero();
        filters();
        show();
    }

    // what's on the shelf now; once anything has gone, how many and what came back
    function hero() {
        const shelf = releases.filter((r) => !isSold(r)), gone = releases.filter(isSold);
        const covered = new Set(shelf.flatMap((r) => r.titleIds)).size;
        const paid = shelf.reduce((s, r) => s + (r.pricePaid ?? 0), 0);
        const uhd = shelf.filter((r) => r.format === "UltraHdBluRay").length;
        const back = gone.reduce((s, r) => s + (r.soldFor ?? 0), 0);
        document.getElementById("stats").innerHTML = [
            [shelf.length, "on the shelf"],
            [covered, covered === 1 ? "title" : "titles"],
            [`£${Math.round(paid)}`, "paid"],
            ...(gone.length ? [[gone.length, "traded or sold"], [`£${Math.round(back)}`, "back"]] : [[uhd, "in 4K"]]),
        ]
            .map(([v, l]) => `<div class="stat"><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`)
            .join("");
    }

    // ---------- filters, sorting ----------

    // on the shelf, everything, or what went (and where)
    const inStatus = (r) => (filter.status === "all" ? true : filter.status === "sold" ? isSold(r) : !isSold(r));
    const inVia = (r) => filter.status === "shelf" || filter.via === "all" || r.soldVia === filter.via;

    function filters() {
        // after: the status and channel chips change the other groups' counts, so they redraw them all
        const chips = (id, key, options, { after } = {}) => {
            const el = document.getElementById(id);
            el.innerHTML = options
                .map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="${filter[key] === v}">${esc(l)}</button>`)
                .join("");
            el.querySelectorAll("[data-v]").forEach((b) => {
                b.onclick = () => {
                    filter[key] = b.dataset.v;
                    el.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
                    after?.();
                    show();
                };
            });
        };
        const gone = releases.filter(isSold);
        // a whole group (heading and chips) shows or hides
        const group = (id, on) => document.getElementById(id).closest(".filter-group").classList.toggle("hidden", !on);
        // nothing has gone yet: no point offering it
        group("statusFilters", gone.length);
        if (!gone.length) filter.status = "shelf";
        chips("statusFilters", "status", [
            ["shelf", `On the shelf (${releases.length - gone.length})`],
            ["sold", `Traded in or sold (${gone.length})`],
            ["all", `All (${releases.length})`],
        ], { after: filters });
        // where they went: only when the sold ones are showing, and they went to more than one place
        const vias = Object.keys(CHANNELS).filter((k) => gone.some((r) => r.soldVia === k));
        const showVia = filter.status !== "shelf" && vias.length > 1;
        group("viaFilters", showVia);
        if (!showVia) filter.via = "all";
        chips("viaFilters", "via", [["all", "Anywhere"], ...vias.map((k) => [k, `${k === "FacebookMarketplace" ? "FB Marketplace" : CHANNELS[k]} (${gone.filter((r) => r.soldVia === k).length})`])], { after: filters });
        // releases with no titles linked: shown (and countable) only when there are some, as something to fix
        const orphans = releases.filter((r) => inStatus(r) && inVia(r) && !r.titleIds.length).length;
        group("titleFilters", orphans);
        if (!orphans) filter.titles = "all";
        chips("titleFilters", "titles", [["all", "Any titles"], ["none", `No titles linked (${orphans})`]]);
        // the other groups count within the status (and channel) chosen
        const count = (pred) => releases.filter((r) => inStatus(r) && inVia(r) && pred(r)).length;
        chips("formatFilters", "format", [["all", "All formats"], ...Object.entries(FORMATS).filter(([k]) => count((r) => r.format === k)).map(([k, l]) => [k, `${l} (${count((r) => r.format === k)})`])]);
        chips("editionFilters", "edition", [["all", "All editions"], ...Object.entries(EDITIONS).filter(([k]) => count((r) => r.edition === k)).map(([k, l]) => [k, `${l} (${count((r) => r.edition === k)})`])]);
        chips("placeFilters", "place", [["all", "All shops"], ...Object.entries(PLACES).filter(([k]) => count((r) => r.purchasedFrom === k)).map(([k, l]) => [k, `${l} (${count((r) => r.purchasedFrom === k)})`])]);
    }

    const sorters = {
        name: (a, b) => a.name.localeCompare(b.name),
        "price-desc": (a, b) => (b.pricePaid ?? -1) - (a.pricePaid ?? -1),
        "price-asc": (a, b) => (a.pricePaid ?? Infinity) - (b.pricePaid ?? Infinity),
        titles: (a, b) => b.titleIds.length - a.titleIds.length || a.name.localeCompare(b.name),
        newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
        // the sales: releases without a sale date (or both prices) go last
        "sold-recent": (a, b) => (b.soldOn ?? "").localeCompare(a.soldOn ?? "") || a.name.localeCompare(b.name),
        "sale-best": (a, b) => (saleNet(b) ?? -Infinity) - (saleNet(a) ?? -Infinity) || a.name.localeCompare(b.name),
        "sale-worst": (a, b) => (saleNet(a) ?? Infinity) - (saleNet(b) ?? Infinity) || a.name.localeCompare(b.name),
    };

    document.getElementById("releaseSearch").addEventListener("input", (e) => {
        filter.q = e.target.value.trim().toLowerCase();
        show();
    });
    sortSelect().addEventListener("change", (e) => {
        filter.sort = e.target.value;
        // sorting by sales while the shelf shows: show what went
        if (SALE_SORTS.includes(filter.sort) && filter.status === "shelf" && releases.some(isSold)) {
            filter.status = "sold";
            filters();
        }
        show();
    });

    // the popup and editor (js/release-dialogs.js) work on this page's data
    const ctx = {
        titles: () => titles,
        find: (id) => releases.find((x) => x.id === id),
        async onChanged(saved) {
            await load();
            return saved ? releases.find((x) => x.id === saved.id) : null;
        },
        onOpen: (r) => setParam("release", r.id),
        onClose: () => setParam("release", null),
        // previous / next in the popup go through the releases on screen, in the order shown
        list: () => shown,
        // keep the grid behind in step, so closing lands on the release you ended up on
        onStep: (i) => document.querySelector(`#releasesGrid [data-i="${i}"]`)?.scrollIntoView({ block: "center" }),
        // a title on a release opens over it here instead of leaving for the collection page
        openTitle(id) {
            const t = titles.get(id);
            if (t) TitleModal.open(t, { front: true });
        },
    };
    TitleModal.configure({
        lookup: (type, id) => [...titles.values()].find((t) => t.tmdbId === id && t.tmdbMediaType === type),
        // a watch changed in the popup: the page's copy of the titles as they are now
        onTitleChanged: () => load(),
        lookupTitle: (id) => titles.get(id),
        // a release listed on the title opens over it
        showRelease(id) {
            const r = releases.find((x) => x.id === id);
            if (r) ReleaseDialogs.open(r, ctx);
        },
        onOpened(row) {
            const bar = document.getElementById("modalAdminBar");
            if (!bar || !Auth.me.canEdit) return;
            bar.className = "modal-actions";
            bar.innerHTML = `
                <span class="split">
                    <a href="/titles/${row.id}/edit" data-edit class="btn">Edit</a>
                    <a href="/titles/${row.id}/edit" class="btn split-end" title="Edit on its own page" aria-label="Edit on its own page">↗</a>
                </span>`;
            // a plain click edits over the popup; Ctrl/Cmd/Shift/middle click opens the edit page
            bar.querySelector("[data-edit]").onclick = (e) => {
                if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                editTitle(row);
            };
        },
    });

    // The title form (js/editor.js) over the title popup. Its releases, and a new one, open over the form.
    function editTitle(row) {
        const d = Auth.dialog(`Edit ${esc(row.name)}`, "", { wide: true });
        TitleEditor.mount(d.body, row, {
            allRows: [...titles.values()],
            pageLink: `/titles/${row.id}/edit`,
            openRelease: (id) => {
                const r = releases.find((x) => x.id === id);
                if (r) openRelease(r);
            },
            addRelease: () => openEditor(null, [row.id]),
            onCancel: () => d.close(),
            async onSaved(saved) {
                d.close();
                await load();
                const fresh = titles.get(saved.id);
                if (fresh && TitleModal.current()?.id === saved.id) TitleModal.open(fresh);
                Auth.showSuccess(`Saved ${saved.name}`);
            },
        });
    }
    const art = (r, opts) => ReleaseDialogs.art(r, ctx, opts);
    const openRelease = (r) => ReleaseDialogs.open(r, ctx);
    const openEditor = (r, presetTitleIds = []) => ReleaseDialogs.edit(r, presetTitleIds, ctx);
    ReleaseDialogs.photoFallback(document.getElementById("releasesGrid"), ctx);

    // ---------- grid / table ----------

    const columns = [
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "format", label: "Format", value: (r) => FORMATS[r.format] },
        { key: "edition", label: "Edition", value: (r) => EDITIONS[r.edition] },
        { key: "titles", label: "Titles", value: (r) => titlesOf(r).map((t) => t.name).join(", "), html: (r) => (r.titleIds.length ? esc(titlesOf(r).map((t) => t.name).join(", ")) : `<span class="warn-text">None linked</span>`), wrap: true },
        { key: "count", label: "No.", value: (r) => r.titleIds.length, num: true },
        { key: "paid", label: "Paid", value: (r) => r.pricePaid, html: (r) => money(r.pricePaid), num: true },
        { key: "place", label: "Bought from", value: (r) => PLACES[r.purchasedFrom] },
        { key: "bought", label: "Bought on", value: (r) => r.boughtOn ?? "", html: (r) => esc(day(r.boughtOn)) },
        { key: "status", label: "Status", value: (r) => (isSold(r) ? saleBadge(r) : "On the shelf") },
        { key: "soldOn", label: "Sold on", value: (r) => r.soldOn ?? "", html: (r) => esc(day(r.soldOn)) },
        { key: "got", label: "Got back", value: (r) => r.soldFor, html: (r) => money(r.soldFor), num: true },
        { key: "net", label: "+/−", value: (r) => saleNet(r), html: (r) => (saleNet(r) == null ? "" : `<span class="${saleNet(r) >= 0 ? "is-up" : "is-down"}">${signed(saleNet(r))}</span>`), num: true },
        { key: "cex", label: "CeX product", wrap: true, value: (r) => r.cexBoxName ?? (r.cexSku ? r.cexSku : ""), html: (r) => (r.cexUrl ? `<a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" onclick="event.stopPropagation()">${esc(r.cexBoxName ?? r.cexSku)}</a>` : "") },
        { key: "notes", label: "Notes", value: (r) => r.notes ?? "", wrap: true },
        { key: "added", label: "Added", value: (r) => r.createdAt, html: (r) => esc(r.createdAt.slice(0, 10).split("-").reverse().join("/")) },
    ];

    // The Filters button: shows the panel, and says how many filters are on ("Filters (2)"), as on the other pages.
    // "On the shelf" is the starting point, so only a different status counts.
    const FILTER_DEFAULTS = { status: "shelf", via: "all", titles: "all", format: "all", edition: "all", place: "all" };
    function updateFilterCount() {
        const active = Object.entries(FILTER_DEFAULTS).filter(([k, v]) => filter[k] !== v).length;
        document.getElementById("filterCount").textContent = active ? `(${active})` : "";
        document.getElementById("clearFilters").classList.toggle("hidden", !active);
    }
    document.getElementById("filterToggle").addEventListener("click", (e) => {
        const open = document.getElementById("filtersSection").classList.toggle("hidden") === false;
        e.currentTarget.setAttribute("aria-expanded", String(open));
    });
    document.getElementById("clearFilters").addEventListener("click", () => {
        Object.assign(filter, FILTER_DEFAULTS);
        filters();
        show();
    });

    function show() {
        if (releases.length) writeUrl();
        updateFilterCount();
        const pool = releases.filter((r) => inStatus(r) && inVia(r));
        const list = pool
            .filter((r) => (filter.titles === "all" || !r.titleIds.length) && (filter.format === "all" || r.format === filter.format) && (filter.edition === "all" || r.edition === filter.edition) && (filter.place === "all" || r.purchasedFrom === filter.place) && (!filter.q || r._search.includes(filter.q)))
            .sort(sorters[filter.sort]);
        document.getElementById("releaseCount").textContent = list.length === pool.length ? "" : `${list.length} of ${pool.length}`;
        const grid = document.getElementById("releasesGrid");
        shown = list;
        grid.classList.toggle("is-table", view.get() === "table" && list.length > 0);
        if (!list.length) {
            grid.innerHTML = releases.length
                ? pool.length || filter.status === "all"
                    ? `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a shorter search or another format.</p></div>`
                    : filter.status === "sold"
                      ? `<div class="empty"><h2>Nothing traded in or sold</h2><p class="muted">Tick “Traded in or sold” on a release when it goes, and it shows up here.</p></div>`
                      : `<div class="empty"><h2>The shelf is empty</h2><p class="muted">Everything here has been traded in or sold.</p></div>`
                : `<div class="empty"><h2>No releases yet</h2><p class="muted">Sign in and add the discs on your shelf.</p></div>`;
            return;
        }
        if (view.get() === "table") {
            shown = renderTable(grid, {
                rows: list,
                columns,
                sort: tableSort,
                caption: "Physical releases",
                onSort: (s) => {
                    tableSort = s;
                    show();
                },
                onRow: (r) => openRelease(r),
            });
            return;
        }
        grid.innerHTML = list
            .map((r, i) => {
                const ts = titlesOf(r);
                const sold = isSold(r);
                const net = saleNet(r);
                return `
                <button type="button" class="card release-card${sold ? " is-sold" : ""}${ts.length ? "" : " is-orphan"}" data-i="${i}">
                    <div class="card-poster release-art${ReleaseDialogs.artClass(r)}${sold ? " is-sold" : ""}">${sold ? `<span class="sale-badge">${esc(saleBadge(r))}</span>` : ""}${art(r)}${ts.length ? "" : `<span class="orphan-badge" title="No titles are linked to this release: edit it and add the titles on it">No titles linked</span>`}</div>
                    <div class="card-body">
                        <h3 class="card-title">${esc(r.name)}</h3>
                        <div class="tags">
                            ${Shelf.formatTag(r)}
                            ${ts.length > 1 ? `<span class="tag">${ts.length} titles</span>` : ""}
                        </div>
                        <dl class="facts">
                            ${r.pricePaid != null ? `<dt>Paid</dt><dd>${money(r.pricePaid)}</dd>` : ""}
                            ${sold
                                ? `${r.soldFor != null ? `<dt>Got</dt><dd class="sale-money">${money(r.soldFor)}${net != null ? ` <span class="${net >= 0 ? "is-up" : "is-down"}">${signed(net)}</span>` : ""}</dd>` : ""}
                                   <dt>${r.soldVia === "Cex" ? "Traded" : "Sold"}</dt><dd>${esc(day(r.soldOn))}</dd>`
                                : r.purchasedFrom !== "Other" ? `<dt>From</dt><dd>${esc(PLACES[r.purchasedFrom])}</dd>` : ""}
                            ${ts.length > 1 ? `<dt class="sr-only">Titles</dt><dd class="wide">${esc(ts.map((t) => t.name).join(", "))}</dd>` : ""}
                        </dl>
                    </div>
                </button>`;
            })
            .join("");
        grid.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => openRelease(list[Number(b.dataset.i)])));
    }

    // ---------- page integration ----------

    function setParam(key, value) {
        const p = new URLSearchParams(location.search);
        if (value == null) p.delete(key);
        else p.set(key, value);
        history.replaceState(null, "", location.pathname + (p.size ? `?${p}` : "") + location.hash);
    }

    document.addEventListener("auth-changed", (e) => {
        const controls = document.getElementById("adminControls");
        controls.innerHTML = "";
        if (e.detail.canEdit) {
            controls.innerHTML = `<button type="button" class="btn btn-primary" data-add>Add release</button>`;
            controls.querySelector("[data-add]").onclick = () => openEditor(null);
        } else if (Auth.mustEnrolMfa()) {
            controls.innerHTML = `<button type="button" class="btn btn-warn" data-mfa>Set up 2FA to edit</button>`;
            controls.querySelector("[data-mfa]").onclick = Auth.openMfaSetup;
        }
    });

    // Wait for both the data and who's signed in before acting on the URL.
    const authKnown = new Promise((resolve) => document.addEventListener("auth-changed", resolve, { once: true }));
    (async () => {
        const overlay = document.getElementById("loadingOverlay");
        try {
            await load();
        } catch (e) {
            document.getElementById("releasesGrid").innerHTML = `<div class="empty"><h2>Couldn't load the shelf</h2><p class="muted">${esc(e.message)}</p></div>`;
            return;
        } finally {
            overlay.classList.add("hidden");
        }
        const p = new URLSearchParams(location.search);
        const id = Number(p.get("release"));
        if (id) {
            const r = releases.find((x) => x.id === id);
            if (r) openRelease(r);
            else setParam("release", null);
        } else if (p.has("new")) {
            await authKnown;
            const titleId = Number(p.get("title"));
            setParam("new", null);
            setParam("title", null);
            if (Auth.me.canEdit) openEditor(null, titles.has(titleId) ? [titleId] : []);
        }
    })();
})();
