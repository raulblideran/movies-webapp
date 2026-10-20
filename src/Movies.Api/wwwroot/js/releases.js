// Physical releases page: every disc (or box set) on the shelf and the titles on it.
// Public read; editors add, edit and delete releases. Needs auth.js and shelf.js.
//   /releases?release=12          opens that release
//   /releases?new=1&title=34      opens "Add a release" with that title already picked (editors)

(function () {
    const { api, esc } = Auth;
    const { label, FORMATS, EDITIONS, PLACES, money, renderTable, viewToggle } = Shelf;

    let releases = [];
    let titles = new Map(); // id → title
    const filter = { q: "", format: "all", edition: "all", place: "all", sort: "name" };
    let tableSort = { key: "name", dir: "asc" };
    let shown = [];
    const view = viewToggle(document.getElementById("viewToggle"), "releases", () => show());

    const titlesOf = (r) => r.titleIds.map((id) => titles.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

    // ---------- loading ----------

    async function load() {
        const [rs, ts] = await Promise.all([api("GET", "/api/releases"), api("GET", "/api/titles")]);
        releases = rs;
        titles = new Map(ts.map((t) => [t.id, t]));
        TitleEditor.refreshReleases((id) => titles.get(id));
        for (const r of releases)
            r._search = [r.name, r.cexBoxName, r.notes, label(r), PLACES[r.purchasedFrom], ...titlesOf(r).map((t) => t.name)].filter(Boolean).join(" ").toLowerCase();
        hero();
        filters();
        show();
    }

    function hero() {
        const covered = new Set(releases.flatMap((r) => r.titleIds)).size;
        const paid = releases.reduce((s, r) => s + (r.pricePaid ?? 0), 0);
        const uhd = releases.filter((r) => r.format === "UltraHdBluRay").length;
        document.getElementById("stats").innerHTML = [
            [releases.length, releases.length === 1 ? "release" : "releases"],
            [covered, covered === 1 ? "title" : "titles"],
            [`£${Math.round(paid)}`, "paid"],
            [uhd, "in 4K"],
        ]
            .map(([v, l]) => `<div class="stat"><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`)
            .join("");
    }

    // ---------- filters, sorting ----------

    function filters() {
        const chips = (id, key, options) => {
            const el = document.getElementById(id);
            el.innerHTML = options
                .map(([v, l]) => `<button type="button" class="chip" data-v="${v}" aria-pressed="${filter[key] === v}">${esc(l)}</button>`)
                .join("");
            el.querySelectorAll("[data-v]").forEach((b) => {
                b.onclick = () => {
                    filter[key] = b.dataset.v;
                    el.querySelectorAll("[data-v]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
                    show();
                };
            });
        };
        const count = (pred) => releases.filter(pred).length;
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
    };

    document.getElementById("releaseSearch").addEventListener("input", (e) => {
        filter.q = e.target.value.trim().toLowerCase();
        show();
    });
    document.getElementById("releaseSort").addEventListener("change", (e) => {
        filter.sort = e.target.value;
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
        // a title on a release opens over it here instead of leaving for the collection page
        openTitle(id) {
            const t = titles.get(id);
            if (t) TitleModal.open(t, { front: true });
        },
    };
    TitleModal.configure({
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
        { key: "titles", label: "Titles", value: (r) => titlesOf(r).map((t) => t.name).join(", "), wrap: true },
        { key: "count", label: "No.", value: (r) => r.titleIds.length, num: true },
        { key: "paid", label: "Paid", value: (r) => r.pricePaid, html: (r) => money(r.pricePaid), num: true },
        { key: "place", label: "Bought from", value: (r) => PLACES[r.purchasedFrom] },
        { key: "cex", label: "CeX product", wrap: true, value: (r) => r.cexBoxName ?? (r.cexSku ? r.cexSku : ""), html: (r) => (r.cexUrl ? `<a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" onclick="event.stopPropagation()">${esc(r.cexBoxName ?? r.cexSku)}</a>` : "") },
        { key: "notes", label: "Notes", value: (r) => r.notes ?? "", wrap: true },
        { key: "added", label: "Added", value: (r) => r.createdAt, html: (r) => esc(r.createdAt.slice(0, 10).split("-").reverse().join("/")) },
    ];

    function show() {
        const list = releases
            .filter((r) => (filter.format === "all" || r.format === filter.format) && (filter.edition === "all" || r.edition === filter.edition) && (filter.place === "all" || r.purchasedFrom === filter.place) && (!filter.q || r._search.includes(filter.q)))
            .sort(sorters[filter.sort]);
        document.getElementById("releaseCount").textContent = list.length === releases.length ? "" : `${list.length} of ${releases.length}`;
        const grid = document.getElementById("releasesGrid");
        shown = list;
        grid.classList.toggle("is-table", view.get() === "table" && list.length > 0);
        if (!list.length) {
            grid.innerHTML = releases.length
                ? `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a shorter search or another format.</p></div>`
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
                return `
                <button type="button" class="card release-card" data-i="${i}">
                    <div class="card-poster release-art${r.imageUrl ? " has-photo" : ""}">${art(r)}</div>
                    <div class="card-body">
                        <h3 class="card-title">${esc(r.name)}</h3>
                        <div class="tags">
                            <span class="tag tag-physical">${esc(label(r))}</span>
                            ${ts.length > 1 ? `<span class="tag">${ts.length} titles</span>` : ""}
                        </div>
                        <dl class="facts">
                            ${r.pricePaid != null ? `<dt>Paid</dt><dd>${money(r.pricePaid)}</dd>` : ""}
                            ${r.purchasedFrom !== "Other" ? `<dt>From</dt><dd>${esc(PLACES[r.purchasedFrom])}</dd>` : ""}
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
