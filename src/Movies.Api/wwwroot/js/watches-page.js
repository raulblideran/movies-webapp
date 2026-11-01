// The Watches page (/watches), for editors: every watch of every title in one table, to filter by title,
// date the ones with no date, change or delete. A row opens the watch in a dialog (js/watch-dialog.js);
// its bin button deletes it. ?title=<id> shows one title's watches (the title popup links here).

(function () {
    const { api, esc } = Auth;
    let titles = [];
    let rows = []; // [{ watch, title, nth }], every watch
    const filter = { titleId: null, q: "", show: "all", year: "all" };
    let sort = { key: "date", dir: "desc" };

    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat("en-GB");

    // ---------- toasts (the same slots as the list pages) ----------

    function toast(id, message, action, ms) {
        const el = $(id);
        el.textContent = message;
        if (action) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "toast-action";
            b.textContent = action.label;
            b.onclick = () => {
                el.classList.add("hidden");
                action.run();
            };
            el.append(" ", b);
        }
        el.classList.remove("hidden");
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add("hidden"), action ? 8000 : ms);
    }
    const showError = (m) => toast("error", m, null, 8000);
    const showSuccess = (m, action) => toast("success", m, action, 3000);

    // ---------- data ----------

    async function load() {
        titles = await Lists.loadAll();
        rows = [];
        for (const t of titles) {
            // numbered in date order, the undated ones after: "watch 3 of 5"
            (t.watches ?? []).forEach((w, i) => rows.push({ watch: w, title: t, nth: i + 1, of: t.watches.length }));
        }
        renderStats();
        renderYears();
        render();
    }

    function renderStats() {
        const all = rows.map((r) => r.watch);
        const year = String(new Date().getFullYear());
        const stats = [
            [fmt.format(all.length), "watches"],
            [fmt.format(all.filter((w) => !w.date).length), "dates unknown"],
            [fmt.format(all.filter((w) => w.date?.startsWith(year)).length), `in ${year}`],
            [fmt.format(all.filter((w) => w.withBogdan).length), "with Bogdan"],
            [fmt.format(all.filter((w) => w.inCinema).length), "in the cinema"],
        ];
        $("stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><dt>${l}</dt><dd>${v}</dd></div>`).join("");
    }

    function renderYears() {
        const years = [...new Set(rows.map((r) => r.watch.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
        const select = document.querySelector("select[data-watch-year]"); // select.js gives its id to its themed button
        select.innerHTML = [`<option value="all">Every year</option>`, ...years.map((y) => `<option value="${y}">${y}</option>`)].join("");
        if (filter.year !== "all" && !years.includes(filter.year)) filter.year = "all";
        select.value = filter.year;
        select.dispatchEvent(new Event("change")); // the themed dropdown (select.js) follows "change"
    }

    const SHOW = [
        ["all", "All"],
        ["undated", "Dates unknown", (w) => !w.date],
        ["bogdan", "With Bogdan", (w) => w.withBogdan],
        ["cinema", "In the cinema", (w) => w.inCinema],
        ["notes", "With notes", (w) => !!w.notes],
    ];

    function renderShow() {
        const counts = Object.fromEntries(SHOW.map(([k, , test]) => [k, test ? rows.filter((r) => test(r.watch)).length : rows.length]));
        $("watchShow").innerHTML = SHOW.map(([k, label]) => `<button type="button" class="chip" data-show="${k}" aria-pressed="${filter.show === k}">${label} <span class="chip-count">${fmt.format(counts[k])}</span></button>`).join("");
        $("watchShow").querySelectorAll("[data-show]").forEach((b) => {
            b.onclick = () => {
                filter.show = b.dataset.show;
                render();
            };
        });
    }

    function visible() {
        const test = SHOW.find(([k]) => k === filter.show)?.[2];
        const q = filter.q.toLowerCase();
        return rows.filter(({ watch: w, title: t }) => {
            if (filter.titleId != null && t.id !== filter.titleId) return false;
            if (filter.titleId == null && q && !t.name.toLowerCase().includes(q) && !(w.notes ?? "").toLowerCase().includes(q)) return false;
            if (test && !test(w)) return false;
            if (filter.year !== "all" && !w.date?.startsWith(filter.year)) return false;
            return true;
        });
    }

    // ---------- the table ----------

    const columns = [
        {
            key: "date",
            label: "Date",
            value: (r) => r.watch.date,
            html: (r) => (r.watch.date ? `<time datetime="${r.watch.date}">${esc(WatchDialog.label(r.watch))}</time>` : `<span class="watch-unknown">Date unknown</span>`),
        },
        {
            key: "title",
            label: "Title",
            value: (r) => r.title.name,
            html: (r) => `
                <span class="watch-title">
                    ${r.title.posterUrl ? `<img src="${esc(r.title.posterUrl.replace("/w500/", "/w92/"))}" alt="" loading="lazy">` : `<span class="watch-title-blank"></span>`}
                    <span>${esc(r.title.name)}${r.title.releaseYear ? ` <span class="faint">${r.title.releaseYear}</span>` : ""}</span>
                </span>`,
            wrap: true,
        },
        { key: "nth", label: "Watch", value: (r) => r.nth, html: (r) => `${r.nth} <span class="faint">of ${r.of}</span>`, num: true },
        { key: "bogdan", label: "Bogdan", value: (r) => (r.watch.withBogdan ? "Yes" : ""), html: (r) => (r.watch.withBogdan ? `<span class="tag tag-bogdan">With Bogdan</span>` : "") },
        { key: "cinema", label: "Cinema", value: (r) => (r.watch.inCinema ? "Yes" : ""), html: (r) => (r.watch.inCinema ? `<span class="tag tag-cinema">Cinema</span>` : "") },
        { key: "notes", label: "Notes", value: (r) => r.watch.notes ?? "", wrap: true },
        {
            key: "actions",
            label: "",
            value: () => "",
            html: (r) => `<button type="button" class="btn btn-small btn-icon" data-delete="${r.watch.id}" aria-label="Delete this watch of ${esc(r.title.name)}" title="Delete this watch">${binIcon}</button>`,
        },
    ];
    const binIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>`;

    function render() {
        renderShow();
        renderPicked();
        const list = visible();
        $("watchCount").textContent = list.length === rows.length ? "" : `${fmt.format(list.length)} of ${fmt.format(rows.length)}`;
        const table = $("watchesTable");
        if (!list.length) {
            table.innerHTML = `<div class="empty"><h2>No watches here</h2><p class="muted">${rows.length ? "Try another title, year or filter." : "Add a watch from a title's popup, or with Add a watch."}</p></div>`;
            return;
        }
        Shelf.renderTable(table, {
            rows: list,
            columns,
            sort,
            caption: "Watches",
            onSort: (s) => {
                if (s.key === "actions") return;
                sort = s;
                render();
            },
            onRow: (r) => edit(r),
        });
        table.querySelector('[data-sort-key="actions"]')?.setAttribute("tabindex", "-1");
        table.querySelectorAll("[data-delete]").forEach((b) => {
            b.onclick = (e) => {
                e.stopPropagation(); // not the row's click, which opens the watch
                const r = rows.find((x) => x.watch.id === Number(b.dataset.delete));
                if (r) remove(r);
            };
            b.onkeydown = (e) => e.stopPropagation();
        });
        writeUrl();
    }

    // ---------- filtering by title ----------

    const search = $("watchSearch");
    const titleList = $("watchTitleList");

    function renderPicked() {
        const el = $("pickedTitle");
        const t = titles.find((x) => x.id === filter.titleId);
        el.classList.toggle("hidden", !t);
        if (!t) return (el.innerHTML = "");
        el.innerHTML = `Showing <strong>${esc(t.name)}</strong> <button type="button" class="link" data-unpick>Show every title</button>`;
        el.querySelector("[data-unpick]").onclick = () => {
            filter.titleId = null;
            search.value = "";
            filter.q = "";
            render();
        };
    }

    function suggest() {
        const q = search.value.trim().toLowerCase();
        const hits = q ? titles.filter((t) => t.name.toLowerCase().includes(q) && t.watches?.length).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8) : [];
        titleList.innerHTML = hits
            .map((t) => `<li role="option"><button type="button" data-pick="${t.id}">${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""} <span class="faint">· ${t.watches.length}×</span></button></li>`)
            .join("");
        titleList.classList.toggle("hidden", hits.length === 0);
        search.setAttribute("aria-expanded", String(hits.length > 0));
    }

    search.addEventListener("input", () => {
        filter.titleId = null;
        filter.q = search.value.trim();
        suggest();
        render();
    });
    search.addEventListener("focus", suggest);
    search.addEventListener("blur", () => setTimeout(() => titleList.classList.add("hidden"), 120));
    search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") titleList.classList.add("hidden");
    });
    titleList.addEventListener("mousedown", (e) => e.preventDefault());
    titleList.addEventListener("click", (e) => {
        const b = e.target.closest("[data-pick]");
        if (!b) return;
        pickTitle(Number(b.dataset.pick));
    });
    function pickTitle(id) {
        const t = titles.find((x) => x.id === id);
        if (!t) return;
        filter.titleId = id;
        filter.q = "";
        search.value = t.name;
        titleList.classList.add("hidden");
        render();
    }

    document.querySelector("select[data-watch-year]").addEventListener("change", (e) => {
        if (filter.year === e.target.value) return;
        filter.year = e.target.value;
        render();
    });

    function writeUrl() {
        const p = new URLSearchParams();
        if (filter.titleId != null) p.set("title", filter.titleId);
        else if (filter.q) p.set("q", filter.q);
        if (filter.show !== "all") p.set("show", filter.show);
        if (filter.year !== "all") p.set("year", filter.year);
        history.replaceState(null, "", location.pathname + (p.size ? `?${p}` : ""));
    }

    // ---------- editing ----------

    async function saved(message, action) {
        await load();
        showSuccess(message, action);
    }

    function edit(r) {
        WatchDialog.open({
            title: r.title,
            watch: r.watch,
            onSaved: (fresh, { deleted }) => saved(deleted ? `Deleted a watch of ${fresh.name}` : `Saved the watch of ${fresh.name}`),
        });
    }

    async function remove(r) {
        const sure = await Auth.confirm({
            title: "Delete this watch?",
            message: `${WatchDialog.label(r.watch)} · ${r.title.name} (watch ${r.nth} of ${r.of}). It comes off the title's history and its count.`,
            confirmLabel: "Delete",
            danger: true,
        });
        if (!sure) return;
        try {
            const { date, withBogdan, inCinema, notes } = r.watch;
            await api("DELETE", `/api/watches/${r.watch.id}`);
            // Undo adds it back (as a new watch: the same day, Bogdan, cinema and notes)
            await saved(`Deleted a watch of ${r.title.name}`, {
                label: "Undo",
                run: async () => {
                    try {
                        await api("POST", `/api/titles/${r.title.id}/watches`, { date, withBogdan, inCinema, notes });
                        await saved(`Put the watch of ${r.title.name} back`);
                    } catch (e) {
                        showError(e.message);
                    }
                },
            });
        } catch (e) {
            showError(e.message);
        }
    }

    $("addWatch").onclick = () =>
        WatchDialog.open({
            title: titles.find((t) => t.id === filter.titleId) ?? null,
            titles,
            onSaved: (fresh) => saved(`Added a watch of ${fresh.name} (${fresh.watchCount} in all)`),
        });

    // ---------- start: editors only ----------

    let started = false;
    document.addEventListener("auth-changed", async (e) => {
        const me = e.detail;
        $("signedOut").classList.toggle("hidden", !!me.canEdit);
        $("watchesUi").classList.toggle("hidden", !me.canEdit);
        if (!me.canEdit) {
            $("signedOut").querySelector("[data-login]").onclick = () => (Auth.mustEnrolMfa() ? Auth.openMfaSetup() : Auth.openLogin());
            $("signedOut").querySelector("[data-login]").textContent = Auth.mustEnrolMfa() ? "Set up 2FA to edit" : "Sign in";
            return;
        }
        if (started) return;
        started = true;
        const p = new URLSearchParams(location.search);
        if (["undated", "bogdan", "cinema", "notes"].includes(p.get("show"))) filter.show = p.get("show");
        if (/^\d{4}$/.test(p.get("year") ?? "")) filter.year = p.get("year");
        try {
            await load();
        } catch (err) {
            showError(`Couldn't load the watches: ${err.message}`);
            return;
        }
        if (p.get("title")) pickTitle(Number(p.get("title")));
        else if (p.get("q")) {
            search.value = filter.q = p.get("q");
            render();
        }
    });
})();
