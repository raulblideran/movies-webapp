// Collection editing (add/edit/watched again/delete). Needs auth.js, loaded before this file.

(function () {
    const { api, dialog, busy, esc, CLS } = Auth;

    // ---------- title editing ----------

    const thisMonth = () => new Date().toISOString().slice(0, 7) + "-01";
    const toMonthInput = (iso) => (iso ? iso.slice(0, 7) : "");
    const fromMonthInput = (v) => (v ? `${v}-01` : null);
    const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

    function toRequest(row) {
        return {
            name: row.name,
            type: row.type,
            firstWatch: row.firstWatch,
            latestWatch: row.latestWatch,
            watchCount: row.watchCount,
            rating: row.rating,
            rewatchPotential: row.rewatchPotential,
            genres: row.genres,
            physicalFormats: row.physicalFormats,
            seasons: row.seasons,
            episodesTotal: row.episodesTotal,
            withBogdan: row.withBogdan,
            dateWithBogdan: row.dateWithBogdan,
            comments: row.comments,
            releaseYear: row.releaseYear,
            pricePaid: row.pricePaid,
            cexLinks: row.cexLinks,
            tmdbId: row.tmdbId,
            tmdbMediaType: row.tmdbMediaType,
            posterPath: row.posterPath,
        };
    }

    async function afterSave(saved, message) {
        await App.reload();
        App.showSuccess(message);
        const fresh = App.getAll().find((r) => r.id === saved.id);
        if (fresh) App.openModal(fresh);
        else App.closeModal();
    }

    function chipInput(container, initial, suggestions, listId) {
        const values = [...initial];
        container.className = `${CLS.input} flex flex-wrap gap-1.5 items-center min-h-[42px] cursor-text`;
        container.innerHTML = `<datalist id="${listId}">${suggestions.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
        const input = document.createElement("input");
        input.setAttribute("list", listId);
        input.className = "flex-1 min-w-[100px] bg-transparent outline-none text-sm text-white";
        input.placeholder = "Type and press Enter";

        function render() {
            container.querySelectorAll("[data-chip]").forEach((c) => c.remove());
            values.forEach((v, i) => {
                const chip = document.createElement("span");
                chip.dataset.chip = "";
                chip.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-xs text-white";
                chip.innerHTML = `${esc(v)} <button type="button" class="text-gray-300 hover:text-white">×</button>`;
                chip.querySelector("button").onclick = () => {
                    values.splice(i, 1);
                    render();
                };
                container.insertBefore(chip, input);
            });
        }
        function commit() {
            for (const part of input.value.split(",")) {
                const v = part.trim();
                if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) values.push(v);
            }
            input.value = "";
            render();
        }
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
            } else if (e.key === "Backspace" && !input.value && values.length) {
                values.pop();
                render();
            }
        });
        input.addEventListener("change", commit); // picking from the datalist
        input.addEventListener("blur", commit);
        container.addEventListener("click", () => input.focus());
        container.appendChild(input);
        render();
        return { get: () => (commit(), values) };
    }

    function unique(getList) {
        const map = new Map();
        for (const r of App.getAll()) for (const v of getList(r)) if (!map.has(v.toLowerCase())) map.set(v.toLowerCase(), v);
        return [...map.values()].sort((a, b) => a.localeCompare(b));
    }

    function openEditor(row) {
        const isNew = !row;
        row = row ?? {
            name: "",
            type: "Film",
            watchCount: 1,
            firstWatch: thisMonth(),
            latestWatch: thisMonth(),
            genres: [],
            physicalFormats: [],
            cexLinks: [],
            withBogdan: false,
        };
        const poster = { tmdbId: row.tmdbId ?? null, tmdbMediaType: row.tmdbMediaType ?? null, posterPath: row.posterPath ?? null };
        const f = (label, html, cls = "") => `<div class="${cls}"><label class="${CLS.label}">${label}</label>${html}</div>`;
        const v = (x) => (x == null ? "" : esc(x));

        const d = dialog(
            isNew ? "➕ Add title" : `✏️ Edit ${esc(row.name)}`,
            `
            <div data-error class="${CLS.error}"></div>
            <form class="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
                <div class="space-y-2">
                    <div data-poster class="w-full aspect-[2/3] rounded-xl bg-gradient-to-br from-primary/20 to-black/40 flex items-center justify-center text-4xl overflow-hidden">🎬</div>
                    <button type="button" data-find class="${CLS.btn} ${CLS.secondary} w-full justify-center">🔎 Find poster</button>
                    <button type="button" data-clear-poster class="${CLS.btn} ${CLS.secondary} w-full justify-center text-xs">Remove poster</button>
                </div>
                <div class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                        ${f("Name", `<input name="name" required maxlength="300" class="${CLS.input}" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="${CLS.input}">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
                    <div data-results class="hidden"></div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${f("Rating /10", `<input name="rating" type="number" min="0" max="11" step="0.5" placeholder="?" class="${CLS.input}" value="${v(row.rating)}">`)}
                        ${f("Rewatch /10", `<input name="rewatchPotential" type="number" min="0" max="10" step="1" class="${CLS.input}" value="${v(row.rewatchPotential)}">`)}
                        ${f("Watch count", `<input name="watchCount" type="number" min="0" step="1" class="${CLS.input}" value="${v(row.watchCount)}">`)}
                        ${f("Release year", `<input name="releaseYear" type="number" min="1870" max="2200" class="${CLS.input}" value="${v(row.releaseYear)}">`)}
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${f("1st watch", `<input name="firstWatch" type="month" class="${CLS.input}" value="${toMonthInput(row.firstWatch)}">`)}
                        ${f("Latest watch", `<input name="latestWatch" type="month" class="${CLS.input}" value="${toMonthInput(row.latestWatch)}">`)}
                        ${f("Seasons", `<input name="seasons" type="number" min="0" class="${CLS.input}" value="${v(row.seasons)}">`)}
                        ${f("Episodes", `<input name="episodesTotal" type="number" min="0" class="${CLS.input}" value="${v(row.episodesTotal)}">`)}
                    </div>
                    ${f("Genres", `<div data-genres></div>`)}
                    ${f("Physical formats", `<div data-formats></div>`)}
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                        <label class="flex items-center gap-2 text-sm text-gray-300 pb-2"><input type="checkbox" name="withBogdan" ${row.withBogdan ? "checked" : ""}> 👥 Watched with Bogdan</label>
                        ${f("Date with Bogdan", `<input name="dateWithBogdan" type="month" class="${CLS.input}" value="${toMonthInput(row.dateWithBogdan)}">`)}
                        ${f("Price paid (£)", `<input name="pricePaid" type="number" min="0" step="0.01" class="${CLS.input}" value="${v(row.pricePaid)}">`)}
                    </div>
                    ${f("CeX links (one per line)", `<textarea name="cexLinks" rows="2" class="${CLS.input} font-mono text-xs">${esc(row.cexLinks.join("\n"))}</textarea>`)}
                    ${f("Comments", `<textarea name="comments" rows="3" maxlength="4000" class="${CLS.input}">${v(row.comments)}</textarea>`)}
                    <div class="flex gap-2 justify-end pt-2">
                        <button type="button" data-cancel class="${CLS.btn} ${CLS.secondary}">Cancel</button>
                        <button type="submit" class="${CLS.btn} ${CLS.primary}">${isNew ? "Add title" : "Save changes"}</button>
                    </div>
                </div>
            </form>`,
            { wide: true },
        );

        const form = d.$("form");
        const genres = chipInput(d.$("[data-genres]"), row.genres, unique((r) => r.genres), "genreOptions");
        const formats = chipInput(d.$("[data-formats]"), row.physicalFormats, unique((r) => r.physicalFormats), "formatOptions");

        const renderPoster = () => {
            const el = d.$("[data-poster]");
            el.innerHTML = poster.posterPath
                ? `<img src="https://image.tmdb.org/t/p/w500${esc(poster.posterPath)}" class="w-full h-full object-cover" alt="">`
                : "🎬";
        };
        renderPoster();

        d.$("[data-clear-poster]").onclick = () => {
            Object.assign(poster, { tmdbId: null, tmdbMediaType: null, posterPath: null });
            renderPoster();
        };

        d.$("[data-find]").onclick = (e) => {
            const name = form.name.value.trim();
            if (!name) return d.error("Enter a name first.");
            const params = new URLSearchParams({ q: name });
            if (form.releaseYear.value) params.set("year", form.releaseYear.value);
            if (genres.get().some((g) => g.toLowerCase().includes("anime"))) params.set("anime", "true");
            busy(d, e.currentTarget, async () => {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                const box = d.$("[data-results]");
                box.classList.remove("hidden");
                box.innerHTML = results.length
                    ? `<div class="flex gap-2 overflow-x-auto pb-2">${results
                          .map(
                              (r, i) => `
                        <button type="button" data-pick="${i}" title="${esc(r.title)} (${esc(r.year ?? "?")})" class="shrink-0 w-24 text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all">
                            <img src="${esc(r.posterUrl)}" class="w-24 h-36 object-cover" alt="">
                            <div class="text-[10px] text-gray-300 p-1 truncate">${esc(r.title)}</div>
                            <div class="text-[10px] text-gray-500 px-1 pb-1">${esc(r.year ?? "?")} · ${r.mediaType === "tv" ? "TV" : "Film"}</div>
                        </button>`,
                          )
                          .join("")}</div>`
                    : `<p class="text-sm text-gray-400">No posters found. Try correcting the name or the release year.</p>`;
                box.querySelectorAll("[data-pick]").forEach((b) => {
                    b.onclick = () => {
                        const r = results[Number(b.dataset.pick)];
                        Object.assign(poster, { tmdbId: r.id, tmdbMediaType: r.mediaType, posterPath: r.posterPath });
                        if (!form.releaseYear.value && r.year) form.releaseYear.value = r.year;
                        renderPoster();
                        box.classList.add("hidden");
                    };
                });
            });
        };

        d.$("[data-cancel]").onclick = () => d.close();

        form.onsubmit = (e) => {
            e.preventDefault();
            const body = {
                name: form.name.value.trim(),
                type: form.type.value,
                rating: numOrNull(form.rating.value),
                rewatchPotential: numOrNull(form.rewatchPotential.value),
                watchCount: numOrNull(form.watchCount.value) ?? 0,
                releaseYear: numOrNull(form.releaseYear.value),
                firstWatch: fromMonthInput(form.firstWatch.value),
                latestWatch: fromMonthInput(form.latestWatch.value),
                seasons: numOrNull(form.seasons.value),
                episodesTotal: numOrNull(form.episodesTotal.value),
                genres: genres.get(),
                physicalFormats: formats.get(),
                withBogdan: form.withBogdan.checked,
                dateWithBogdan: fromMonthInput(form.dateWithBogdan.value),
                pricePaid: numOrNull(form.pricePaid.value),
                cexLinks: form.cexLinks.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
                comments: form.comments.value,
                ...poster,
            };
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = isNew
                    ? await api("POST", "/api/titles", body)
                    : await api("PUT", `/api/titles/${row.id}`, body);
                d.close();
                await afterSave(saved, isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
            });
        };
    }

    async function addWatch(row) {
        const body = toRequest(row);
        body.watchCount = (row.watchCount || 0) + 1;
        body.latestWatch = thisMonth();
        body.firstWatch = row.firstWatch ?? thisMonth();
        try {
            const saved = await api("PUT", `/api/titles/${row.id}`, body);
            await afterSave(saved, `+1 watch for ${saved.name} (${saved.watchCount} total)`);
        } catch (e) {
            App.showError(e.message);
        }
    }

    async function deleteTitle(row) {
        if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
        try {
            await api("DELETE", `/api/titles/${row.id}`);
            App.closeModal();
            await App.reload();
            App.showSuccess(`Deleted ${row.name}`);
        } catch (e) {
            App.showError(e.message);
        }
    }
// ---------- page integration ----------

    document.addEventListener("auth-changed", (e) => {
        const me = e.detail;
        const controls = document.getElementById("adminControls");
        controls.innerHTML = "";
        if (me.canEdit) {
            const add = document.createElement("button");
            add.className =
                "flex items-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 px-4 py-2.5 rounded-lg text-sm font-semibold text-primary transition-all cursor-pointer";
            add.innerHTML = "<span>➕ Add</span>";
            add.onclick = () => openEditor(null);
            controls.appendChild(add);
        } else if (Auth.mustEnrolMfa()) {
            const setup = document.createElement("button");
            setup.className =
                "flex items-center gap-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 px-4 py-2.5 rounded-lg text-sm font-semibold text-yellow-400 transition-all cursor-pointer";
            setup.innerHTML = "<span>🛡️ Set up 2FA to edit</span>";
            setup.onclick = Auth.openMfaSetup;
            controls.appendChild(setup);
        }
    });

    window.Admin = {
        onModalOpened(row) {
            const bar = document.getElementById("modalAdminBar");
            if (!bar || !Auth.me.canEdit) return;
            bar.className = "flex gap-2 flex-wrap mb-5 pb-5 border-b border-white/10";
            bar.innerHTML = `
                <button data-edit class="${CLS.btn} ${CLS.secondary}">✏️ Edit</button>
                <button data-watch class="${CLS.btn} ${CLS.secondary}" title="Increase the watch count and set the latest watch to this month">➕ Watched again</button>
                <button data-delete class="${CLS.btn} ${CLS.danger}">🗑️ Delete</button>`;
            bar.querySelector("[data-edit]").onclick = () => openEditor(row);
            bar.querySelector("[data-watch]").onclick = () => addWatch(row);
            bar.querySelector("[data-delete]").onclick = () => deleteTitle(row);
        },
    };
})();
