// Physical releases page: every disc (or box set) on the shelf and the titles on it.
// Public read; editors add, edit and delete releases. Needs auth.js and shelf.js.
//   /releases?release=12          opens that release
//   /releases?new=1&title=34      opens "Add a release" with that title already picked (editors)

(function () {
    const { api, dialog, busy, esc, CLS } = Auth;
    const { label, FORMATS, EDITIONS, money, renderTable, viewToggle } = Shelf;

    let releases = [];
    let titles = new Map(); // id → title
    const filter = { q: "", format: "all", edition: "all", sort: "name" };
    let tableSort = { key: "name", dir: "asc" };
    let shown = [];
    const view = viewToggle(document.getElementById("viewToggle"), "releases", () => show());

    const titlesOf = (r) => r.titleIds.map((id) => titles.get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

    // ---------- loading ----------

    async function load() {
        const [rs, ts] = await Promise.all([api("GET", "/api/releases"), api("GET", "/api/titles")]);
        releases = rs;
        titles = new Map(ts.map((t) => [t.id, t]));
        for (const r of releases)
            r._search = [r.name, r.cexBoxName, r.notes, label(r), ...titlesOf(r).map((t) => t.name)].filter(Boolean).join(" ").toLowerCase();
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

    // ---------- grid / table ----------

    function art(r, { large = false, photo = true } = {}) {
        if (r.imageUrl && photo) return `<img class="release-photo" data-release="${r.id}" src="${esc(r.imageUrl)}" alt="" loading="lazy">`;
        const posters = titlesOf(r).filter((t) => t.posterUrl).slice(0, 4);
        if (posters.length === 0) return `<div class="no-poster">${esc(r.name)}</div>`;
        if (posters.length === 1) return `<img src="${esc(posters[0].posterUrl)}" alt="" loading="lazy">`;
        // a box set without a CeX photo: its titles' posters together
        return `<div class="release-collage n${posters.length}${large ? " is-large" : ""}">${posters.map((t) => `<img src="${esc(t.posterUrl)}" alt="" loading="lazy">`).join("")}</div>`;
    }

    // If CeX's photo won't load, show the titles' posters instead of an empty box.
    function photoFallback(root) {
        root.addEventListener(
            "error",
            (e) => {
                const img = e.target.closest?.(".release-photo");
                const r = img && releases.find((x) => x.id === Number(img.dataset.release));
                if (!r) return;
                const box = img.parentElement;
                box.classList.remove("has-photo");
                box.innerHTML = art(r, { photo: false, large: box.classList.contains("release-detail-art") });
            },
            true,
        );
    }
    photoFallback(document.getElementById("releasesGrid"));

    const columns = [
        { key: "name", label: "Name", value: (r) => r.name },
        { key: "format", label: "Format", value: (r) => FORMATS[r.format] },
        { key: "edition", label: "Edition", value: (r) => EDITIONS[r.edition] },
        { key: "titles", label: "Titles", value: (r) => titlesOf(r).map((t) => t.name).join(", "), wrap: true },
        { key: "count", label: "No.", value: (r) => r.titleIds.length, num: true },
        { key: "paid", label: "Paid", value: (r) => r.pricePaid, html: (r) => money(r.pricePaid), num: true },
        { key: "cex", label: "CeX product", wrap: true, value: (r) => r.cexBoxName ?? (r.cexSku ? r.cexSku : ""), html: (r) => (r.cexUrl ? `<a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" onclick="event.stopPropagation()">${esc(r.cexBoxName ?? r.cexSku)}</a>` : "") },
        { key: "notes", label: "Notes", value: (r) => r.notes ?? "", wrap: true },
        { key: "added", label: "Added", value: (r) => r.createdAt, html: (r) => esc(r.createdAt.slice(0, 10).split("-").reverse().join("/")) },
    ];

    function show() {
        const list = releases
            .filter((r) => (filter.format === "all" || r.format === filter.format) && (filter.edition === "all" || r.edition === filter.edition) && (!filter.q || r._search.includes(filter.q)))
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
                            ${ts.length > 1 ? `<dt class="sr-only">Titles</dt><dd class="wide">${esc(ts.map((t) => t.name).join(", "))}</dd>` : ""}
                        </dl>
                    </div>
                </button>`;
            })
            .join("");
        grid.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => openRelease(list[Number(b.dataset.i)])));
    }

    // ---------- one release ----------

    async function openRelease(r) {
        const ts = titlesOf(r);
        const canEdit = Auth.me.canEdit;
        const d = dialog(
            esc(r.name),
            `
            <div class="release-detail">
                <div class="release-detail-art release-art${r.imageUrl ? " has-photo" : ""}">${art(r, { large: true })}</div>
                <div class="release-detail-info">
                    <div class="tags">
                        <span class="tag tag-physical">${esc(FORMATS[r.format])}</span>
                        ${r.edition !== "Standard" ? `<span class="tag">${esc(EDITIONS[r.edition])}</span>` : ""}
                    </div>
                    <dl class="facts release-facts">
                        <dt>Paid</dt><dd>${r.pricePaid != null ? money(r.pricePaid) : "–"}${ts.length > 1 && r.pricePaid != null ? ` <span class="faint">(${money(r.pricePaid / ts.length)} a title)</span>` : ""}</dd>
                        ${r.cexBoxName ? `<dt>At CeX</dt><dd>${esc(r.cexBoxName)}</dd>` : ""}
                        <dt>Added</dt><dd>${esc(r.createdAt.slice(0, 10).split("-").reverse().join("/"))}</dd>
                        ${r.notes ? `<dt class="sr-only">Notes</dt><dd class="wide release-notes">${esc(r.notes)}</dd>` : ""}
                    </dl>
                    ${r.cexSku ? `<section class="release-cex"><h3>At CeX today</h3><div data-cex class="stub-cex"><p class="muted pulse">Checking prices…</p></div></section>` : ""}
                    ${canEdit ? `<div class="actions release-actions"><button type="button" data-edit class="btn">Edit</button><button type="button" data-delete class="btn btn-danger">Delete</button></div>` : ""}
                </div>
            </div>
            <section class="release-titles">
                <h3>${ts.length === 1 ? "The title on it" : `The ${ts.length} titles on it`}</h3>
                ${ts.length
                    ? `<ul class="release-title-list">${ts
                          .map((t) => `
                        <li><a href="/?title=${t.id}" class="release-title">
                            ${t.posterUrl ? `<img src="${esc(t.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(t.name)}</span>`}
                            <span>${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}</span>
                        </a></li>`)
                          .join("")}</ul>`
                    : `<p class="faint">No titles linked yet.</p>`}
            </section>`,
            { wide: true, onClose: () => setParam("release", null) },
        );
        setParam("release", r.id);
        photoFallback(d.root);
        d.$("[data-edit]")?.addEventListener("click", () => {
            d.close();
            openEditor(r);
        });
        d.$("[data-delete]")?.addEventListener("click", () => removeRelease(r, d));

        if (r.cexSku) {
            try {
                const c = await api("GET", `/api/cex/${encodeURIComponent(r.cexSku)}`);
                d.$("[data-cex]").innerHTML = `
                    <div class="cex-entry">
                        <a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" title="${esc(c.boxName)}">${esc(c.boxName)}</a>
                        <dl>
                            <div><dt>Sells for</dt><dd>£${c.sellPrice}</dd></div>
                            <div class="is-cash"><dt>Cash</dt><dd>£${c.cashPrice}</dd></div>
                            <div class="is-voucher"><dt>Voucher</dt><dd>£${c.exchangePrice}</dd></div>
                        </dl>
                    </div>`;
            } catch {
                if (d.root.isConnected) d.$("[data-cex]").innerHTML = `<p class="status-bad">CeX didn't return prices for <a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link">${esc(r.cexSku)}</a>.</p>`;
            }
        }
    }

    async function removeRelease(r, d) {
        if (!window.confirm(`Delete "${r.name}"? Its titles stay in the collection.`)) return;
        try {
            await api("DELETE", `/api/releases/${r.id}`);
            d.close();
            await load();
            Auth.showSuccess(`Deleted ${r.name}`);
        } catch (e) {
            Auth.showError(e.message);
        }
    }

    // ---------- add / edit ----------

    // Pick titles by typing; picked ones are chips.
    function titlePicker(container, initialIds) {
        const picked = [...initialIds];
        const all = [...titles.values()].sort((a, b) => a.name.localeCompare(b.name));
        const listId = `titlePick-${Math.random().toString(36).slice(2, 8)}`;
        container.className = "input chip-input";
        container.innerHTML = `<input placeholder="Type a title" autocomplete="off" role="combobox" aria-label="Add a title" aria-autocomplete="list" aria-controls="${listId}" aria-expanded="false"><ul class="suggest hidden" id="${listId}" role="listbox"></ul>`;
        const input = container.querySelector("input"), list = container.querySelector(".suggest");
        let matches = [], active = -1;
        const render = () => {
            container.querySelectorAll("[data-chip]").forEach((c) => c.remove());
            for (const id of picked) {
                const t = titles.get(id);
                const chip = document.createElement("span");
                chip.dataset.chip = "";
                chip.className = "chip-value";
                chip.innerHTML = `${esc(t?.name ?? `#${id}`)} <button type="button" aria-label="Remove ${esc(t?.name ?? id)}">×</button>`;
                chip.querySelector("button").onclick = (e) => {
                    e.stopPropagation();
                    picked.splice(picked.indexOf(id), 1);
                    render();
                };
                container.insertBefore(chip, input);
            }
        };
        const hide = () => {
            list.classList.add("hidden");
            input.setAttribute("aria-expanded", "false");
            active = -1;
        };
        const suggest = () => {
            const q = input.value.trim().toLowerCase();
            if (!q) return hide();
            matches = all.filter((t) => !picked.includes(t.id) && t.name.toLowerCase().includes(q)).slice(0, 12);
            if (!matches.length) return hide();
            list.innerHTML = matches
                .map((t, i) => `<li role="option" id="${listId}-${i}" data-i="${i}" aria-selected="${i === active}">${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}</li>`)
                .join("");
            list.classList.remove("hidden");
            input.setAttribute("aria-expanded", "true");
        };
        const pick = (i) => {
            picked.push(matches[i].id);
            input.value = "";
            render();
            hide();
            input.focus();
        };
        input.addEventListener("input", () => {
            active = -1;
            suggest();
        });
        input.addEventListener("keydown", (e) => {
            const open = !list.classList.contains("hidden");
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
                e.preventDefault();
                active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
                suggest();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (open) pick(Math.max(0, active));
            } else if (e.key === "Escape" && open) {
                e.preventDefault();
                e.stopPropagation(); // keep the dialog open
                hide();
            } else if (e.key === "Backspace" && !input.value && picked.length) {
                picked.pop();
                render();
            }
        });
        input.addEventListener("blur", () => setTimeout(hide, 150));
        list.addEventListener("mousedown", (e) => {
            const li = e.target.closest("[data-i]");
            e.preventDefault();
            if (li) pick(Number(li.dataset.i));
        });
        container.addEventListener("click", () => input.focus());
        render();
        return { get: () => picked };
    }

    function openEditor(r, presetTitleIds = []) {
        const isNew = !r;
        r = r ?? { name: "", format: "BluRay", edition: "Standard", pricePaid: null, notes: "", cexUrl: "", titleIds: presetTitleIds };
        const v = (x) => (x == null ? "" : esc(x));
        const options = (map, current) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(l)}</option>`).join("");
        const d = dialog(
            isNew ? "Add a release" : `Edit ${esc(r.name)}`,
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="release-form stack">
                <div><label class="label" for="rel-name">Name</label>
                    <input id="rel-name" name="name" maxlength="300" class="input" value="${v(r.name)}" placeholder="Leave empty to use CeX's name"></div>
                <div class="row row-3">
                    <div><label class="label" for="rel-format">Format</label><select id="rel-format" name="format" class="input">${options(FORMATS, r.format)}</select></div>
                    <div><label class="label" for="rel-edition">Edition</label><select id="rel-edition" name="edition" class="input">${options(EDITIONS, r.edition)}</select></div>
                    <div><label class="label" for="rel-price">Price paid (£)</label><input id="rel-price" name="pricePaid" type="number" min="0" step="0.01" class="input" value="${v(r.pricePaid)}"></div>
                </div>
                <div><label class="label" for="rel-cex">CeX link</label>
                    <input id="rel-cex" name="cexUrl" class="input code" value="${v(r.cexUrl)}" placeholder="https://uk.webuy.com/product-detail?id=…"></div>
                <div><span class="label">Titles on it</span><div data-titles></div></div>
                <div><label class="label" for="rel-notes">Notes</label><textarea id="rel-notes" name="notes" rows="2" maxlength="2000" class="input">${v(r.notes)}</textarea></div>
                <div class="actions">
                    <button type="button" data-cancel class="btn">Cancel</button>
                    <button type="submit" class="btn btn-primary">${isNew ? "Add release" : "Save changes"}</button>
                </div>
            </form>`,
            { wide: true },
        );
        d.error("");
        const picker = titlePicker(d.$("[data-titles]"), r.titleIds);
        const form = d.$("form");
        d.$("[data-cancel]").onclick = () => d.close();
        form.onsubmit = (e) => {
            e.preventDefault();
            const body = {
                name: form.name.value.trim(),
                format: form.format.value,
                edition: form.edition.value,
                pricePaid: form.pricePaid.value === "" ? null : Number(form.pricePaid.value),
                cexUrl: form.cexUrl.value.trim() || null,
                notes: form.notes.value,
                titleIds: picker.get(),
            };
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = isNew ? await api("POST", "/api/releases", body) : await api("PUT", `/api/releases/${r.id}`, body);
                d.close();
                await load();
                Auth.showSuccess(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
                const fresh = releases.find((x) => x.id === saved.id);
                if (fresh) openRelease(fresh);
            });
        };
        form.name.focus();
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
