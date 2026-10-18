// The release popup and the release editor, shared by the releases page and the collection page
// (which opens them over the title popup). Needs auth.js and shelf.js.
//
// ctx, given by the page:
//   titles()          Map of title id → title
//   find(id)          the release with that id
//   onChanged(saved)  after a save (saved) or delete (null): reload, return the fresh release to show
//   openTitle(id)     optional: show a title in place instead of following its link
//   onOpen(r), onClose(r)   optional

(function () {
    const { api, dialog, busy, esc, CLS } = Auth;
    const { FORMATS, EDITIONS, money } = Shelf;

    const titlesOf = (r, ctx) =>
        r.titleIds.map((id) => ctx.titles().get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

    function art(r, ctx, { large = false, photo = true } = {}) {
        if (r.imageUrl && photo) return `<img class="release-photo" data-release="${r.id}" src="${esc(r.imageUrl)}" alt="" loading="lazy">`;
        const posters = titlesOf(r, ctx).filter((t) => t.posterUrl).slice(0, 4);
        if (posters.length === 0) return `<div class="no-poster">${esc(r.name)}</div>`;
        if (posters.length === 1) return `<img src="${esc(posters[0].posterUrl)}" alt="" loading="lazy">`;
        // a box set without a CeX photo: its titles' posters together
        return `<div class="release-collage n${posters.length}${large ? " is-large" : ""}">${posters.map((t) => `<img src="${esc(t.posterUrl)}" alt="" loading="lazy">`).join("")}</div>`;
    }

    // If CeX's photo won't load, show the titles' posters instead of an empty box.
    function photoFallback(root, ctx) {
        root.addEventListener(
            "error",
            (e) => {
                const img = e.target.closest?.(".release-photo");
                const r = img && ctx.find(Number(img.dataset.release));
                if (!r) return;
                const box = img.parentElement;
                box.classList.remove("has-photo");
                box.innerHTML = art(r, ctx, { photo: false, large: box.classList.contains("release-detail-art") });
            },
            true,
        );
    }

    // ---------- one release ----------

    async function open(r, ctx) {
        const ts = titlesOf(r, ctx);
        const canEdit = Auth.me.canEdit;
        const d = dialog(
            esc(r.name),
            `
            <div class="release-detail">
                <div class="release-detail-art release-art${r.imageUrl ? " has-photo" : ""}">${art(r, ctx, { large: true })}</div>
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
                        <li><a href="/?title=${t.id}" class="release-title" data-title="${t.id}">
                            ${t.posterUrl ? `<img src="${esc(t.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(t.name)}</span>`}
                            <span>${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}</span>
                        </a></li>`)
                          .join("")}</ul>`
                    : `<p class="faint">No titles linked yet.</p>`}
            </section>`,
            { wide: true, onClose: () => ctx.onClose?.(r) },
        );
        ctx.onOpen?.(r);
        photoFallback(d.root, ctx);
        // where the page can show a title itself (the collection page), a plain click does that instead of navigating
        if (ctx.openTitle)
            d.$$("[data-title]").forEach((a) =>
                a.addEventListener("click", (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    d.close();
                    ctx.openTitle(Number(a.dataset.title));
                }),
            );
        d.$("[data-edit]")?.addEventListener("click", () => {
            d.close();
            edit(r, [], ctx);
        });
        d.$("[data-delete]")?.addEventListener("click", () => remove(r, d, ctx));

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

    async function remove(r, d, ctx) {
        if (!window.confirm(`Delete "${r.name}"? Its titles stay in the collection.`)) return;
        try {
            await api("DELETE", `/api/releases/${r.id}`);
            d.close();
            await ctx.onChanged(null);
            Auth.showSuccess(`Deleted ${r.name}`);
        } catch (e) {
            Auth.showError(e.message);
        }
    }

    // ---------- add / edit ----------

    // Pick titles by typing; picked ones are chips.
    function titlePicker(container, initialIds, titles) {
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

    function edit(r, presetTitleIds, ctx) {
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
        const picker = titlePicker(d.$("[data-titles]"), r.titleIds, ctx.titles());
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
                const fresh = await ctx.onChanged(saved);
                Auth.showSuccess(isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
                if (fresh) open(fresh, ctx);
            });
        };
        form.name.focus();
    }

    window.ReleaseDialogs = { art, photoFallback, open, edit };
})();
