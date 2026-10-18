// The add/edit title form, shared by the editor dialog (admin.js) and the full page (edit-page.js).
// Needs auth.js and datepicker.js, loaded before this file.

(function () {
    const { api, busy, esc, CLS } = Auth;

    const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
    const pad = (n) => String(n).padStart(2, "0");
    const todayIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    // Chips with a themed suggestion list (a native <datalist> popup can't be styled).
    function chipInput(container, initial, suggestions, listId) {
        const values = [...initial];
        container.className = "input chip-input";
        container.innerHTML = `<ul class="suggest hidden" id="${listId}" role="listbox"></ul>`;
        const list = container.querySelector(".suggest");
        const input = document.createElement("input");
        input.placeholder = "Type and press Enter";
        input.autocomplete = "off";
        input.setAttribute("role", "combobox");
        input.setAttribute("aria-autocomplete", "list");
        input.setAttribute("aria-controls", listId);
        input.setAttribute("aria-expanded", "false");
        if (container.dataset.label) input.setAttribute("aria-label", container.dataset.label);
        let matches = [];
        let active = -1;

        function render() {
            container.querySelectorAll("[data-chip]").forEach((c) => c.remove());
            values.forEach((v, i) => {
                const chip = document.createElement("span");
                chip.dataset.chip = "";
                chip.className = "chip-value";
                chip.innerHTML = `${esc(v)} <button type="button" aria-label="Remove ${esc(v)}">×</button>`;
                chip.querySelector("button").onclick = (e) => {
                    e.stopPropagation();
                    values.splice(i, 1);
                    render();
                };
                container.insertBefore(chip, input);
            });
        }
        function hideList() {
            list.classList.add("hidden");
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
            active = -1;
        }
        function showList() {
            const q = input.value.trim().toLowerCase();
            const taken = new Set(values.map((v) => v.toLowerCase()));
            matches = suggestions
                .filter((s) => !taken.has(s.toLowerCase()) && s.toLowerCase().includes(q))
                .sort((a, b) => a.toLowerCase().startsWith(q) === b.toLowerCase().startsWith(q) ? 0 : a.toLowerCase().startsWith(q) ? -1 : 1);
            if (!matches.length) return hideList();
            active = Math.min(active, matches.length - 1);
            list.innerHTML = matches
                .map((m, i) => `<li role="option" id="${listId}-${i}" data-i="${i}" aria-selected="${i === active}">${esc(m)}</li>`)
                .join("");
            list.classList.remove("hidden");
            input.setAttribute("aria-expanded", "true");
            if (active >= 0) {
                input.setAttribute("aria-activedescendant", `${listId}-${active}`);
                list.children[active].scrollIntoView({ block: "nearest" });
            } else input.removeAttribute("aria-activedescendant");
        }
        function add(v) {
            v = v.trim();
            if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) values.push(v);
        }
        function commit() {
            for (const part of input.value.split(",")) add(part);
            input.value = "";
            render();
        }
        function pick(i) {
            add(matches[i]);
            input.value = "";
            render();
            active = -1;
            showList();
            input.focus();
        }
        input.addEventListener("keydown", (e) => {
            const open = !list.classList.contains("hidden");
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) return showList();
                // -1 means "nothing highlighted" (Enter adds what's typed); the cycle wraps through it
                if (e.key === "ArrowDown") active = active + 1 >= matches.length ? -1 : active + 1;
                else active = active - 1 < -1 ? matches.length - 1 : active - 1;
                showList();
            } else if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                if (open && active >= 0 && e.key === "Enter") pick(active);
                else {
                    commit();
                    showList();
                }
            } else if (e.key === "Escape" && open) {
                e.preventDefault();
                e.stopPropagation(); // keep the dialog open
                hideList();
            } else if (e.key === "Backspace" && !input.value && values.length) {
                values.pop();
                render();
            }
        });
        input.addEventListener("input", () => {
            active = -1;
            showList();
        });
        input.addEventListener("focus", showList);
        input.addEventListener("blur", () => {
            commit();
            hideList();
        });
        // mousedown so the pick lands before the input's blur
        list.addEventListener("mousedown", (e) => {
            const li = e.target.closest("[data-i]");
            e.preventDefault();
            if (li) pick(Number(li.dataset.i));
        });
        container.addEventListener("click", () => input.focus());
        container.insertBefore(input, list);
        render();
        return { get: () => (commit(), values) };
    }

    /** Distinct values of a list field across all titles, for the chip suggestions. */
    function unique(rows, getList) {
        const map = new Map();
        for (const r of rows) for (const v of getList(r)) if (!map.has(v.toLowerCase())) map.set(v.toLowerCase(), v);
        return [...map.values()].sort((a, b) => a.localeCompare(b));
    }

    /**
     * Render the form into container.
     *   row        the title to edit, or null to add one
     *   allRows    every title (genre and format suggestions)
     *   onSaved    (saved, isNew) => …   after a successful POST/PUT
     *   onCancel   () => …
     *   pageLink   optional href shown as "Open as page" (the dialog uses it)
     */
    function mount(container, row, { allRows = [], onSaved, onCancel, pageLink } = {}) {
        const isNew = !row;
        row = row ?? {
            name: "",
            type: "Film",
            watchCount: 1,
            firstWatch: todayIso(),
            latestWatch: todayIso(),
            genres: [],
            physicalFormats: [],
            cexLinks: [],
            withBogdan: false,
        };
        const poster = { tmdbId: row.tmdbId ?? null, tmdbMediaType: row.tmdbMediaType ?? null, posterPath: row.posterPath ?? null };
        const uid = Math.random().toString(36).slice(2, 8);
        // Field: a label tied to the first control in html (by name).
        const f = (label, html) => {
            const name = html.match(/name="(\w+)"/)?.[1];
            const id = name ? `ed-${uid}-${name}` : "";
            return `<div><label class="label"${id ? ` for="${id}"` : ""}>${label}</label>${id ? html.replace(`name="${name}"`, `name="${name}" id="${id}"`) : html}</div>`;
        };
        const v = (x) => (x == null ? "" : esc(x));
        const date = (name, value) => `<input name="${name}" data-date class="input" value="${v(value)}">`;

        container.innerHTML = `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="editor">
                <div class="editor-poster">
                    <div data-poster class="poster-slot">No poster</div>
                    <button type="button" data-find class="btn btn-block">Find poster</button>
                    <button type="button" data-clear-poster class="btn btn-small btn-block">Remove poster</button>
                </div>
                <div class="stack">
                    <div class="row row-name">
                        ${f("Name", `<input name="name" required maxlength="300" class="input" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="input">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
                    <div data-results class="hidden"></div>
                    <div class="row row-4">
                        ${f("Rating out of 10", `<input name="rating" type="number" min="0" max="11" step="0.5" placeholder="?" class="input" value="${v(row.rating)}">`)}
                        ${f("Rewatch out of 10", `<input name="rewatchPotential" type="number" min="0" max="10" step="1" class="input" value="${v(row.rewatchPotential)}">`)}
                        ${f("Watch count", `<input name="watchCount" type="number" min="0" step="1" class="input" value="${v(row.watchCount)}">`)}
                        ${f("Release year", `<input name="releaseYear" type="number" min="1870" max="2200" class="input" value="${v(row.releaseYear)}">`)}
                    </div>
                    <div class="row row-4">
                        ${f("First watch", date("firstWatch", row.firstWatch))}
                        ${f("Latest watch", date("latestWatch", row.latestWatch))}
                        ${f("Seasons", `<input name="seasons" type="number" min="0" class="input" value="${v(row.seasons)}">`)}
                        ${f("Episodes", `<input name="episodesTotal" type="number" min="0" class="input" value="${v(row.episodesTotal)}">`)}
                    </div>
                    ${f("Genres", `<div data-genres data-label="Add a genre"></div>`)}
                    ${f("Physical formats", `<div data-formats data-label="Add a physical format"></div>`)}
                    <div class="row row-3" style="align-items:end">
                        <label class="check" style="padding-bottom:10px"><input type="checkbox" name="withBogdan" ${row.withBogdan ? "checked" : ""}> Watched with Bogdan</label>
                        ${f("Date with Bogdan", date("dateWithBogdan", row.dateWithBogdan))}
                        ${f("Price paid (£)", `<input name="pricePaid" type="number" min="0" step="0.01" class="input" value="${v(row.pricePaid)}">`)}
                    </div>
                    ${f("CeX links, one per line", `<textarea name="cexLinks" rows="2" class="input code">${esc(row.cexLinks.join("\n"))}</textarea>`)}
                    ${f("Comments", `<textarea name="comments" rows="3" maxlength="4000" class="input">${v(row.comments)}</textarea>`)}
                    <div class="actions">
                        ${pageLink ? `<a href="${esc(pageLink)}" class="btn push" title="Open this form on its own page">Open as page ↗</a>` : ""}
                        <button type="button" data-cancel class="btn">Cancel</button>
                        <button type="submit" class="btn btn-primary">${isNew ? "Add title" : "Save changes"}</button>
                    </div>
                </div>
            </form>`;

        // What Auth.busy needs: an error slot inside the form.
        const d = {
            $: (sel) => container.querySelector(sel),
            error(msg) {
                const el = container.querySelector("[data-error]");
                el.textContent = msg || "";
                el.classList.toggle("hidden", !msg);
                if (msg) el.scrollIntoView({ block: "nearest" });
            },
        };
        d.error("");

        const form = d.$("form");
        form.querySelectorAll("[data-date]").forEach(DatePicker.attach);
        const genres = chipInput(d.$("[data-genres]"), row.genres, unique(allRows, (r) => r.genres), `genreOptions-${uid}`);
        const formats = chipInput(d.$("[data-formats]"), row.physicalFormats, unique(allRows, (r) => r.physicalFormats), `formatOptions-${uid}`);

        const renderPoster = () => {
            const el = d.$("[data-poster]");
            el.innerHTML = poster.posterPath
                ? `<img src="https://image.tmdb.org/t/p/w500${esc(poster.posterPath)}" alt="Chosen poster">`
                : "No poster";
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
                    ? `<div class="poster-results">${results
                          .map(
                              (r, i) => `
                        <button type="button" data-pick="${i}" title="${esc(r.title)} (${esc(r.year ?? "?")})">
                            <img src="${esc(r.posterUrl)}" alt="">
                            <span>${esc(r.title)}</span>
                            <span>${esc(r.year ?? "?")}, ${r.mediaType === "tv" ? "TV" : "film"}</span>
                        </button>`,
                          )
                          .join("")}</div>`
                    : `<p class="muted">No posters found. Check the name or the release year.</p>`;
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

        d.$("[data-cancel]").onclick = () => onCancel?.();

        form.onsubmit = (e) => {
            e.preventDefault();
            const dates = {};
            for (const [name, label] of [["firstWatch", "First watch"], ["latestWatch", "Latest watch"], ["dateWithBogdan", "Date with Bogdan"]]) {
                dates[name] = DatePicker.iso(form[name]);
                if (dates[name] === undefined) {
                    form[name].focus();
                    return d.error(`${label} isn't a date. Use dd/mm/yyyy.`);
                }
            }
            const body = {
                name: form.name.value.trim(),
                type: form.type.value,
                rating: numOrNull(form.rating.value),
                rewatchPotential: numOrNull(form.rewatchPotential.value),
                watchCount: numOrNull(form.watchCount.value) ?? 0,
                releaseYear: numOrNull(form.releaseYear.value),
                ...dates,
                seasons: numOrNull(form.seasons.value),
                episodesTotal: numOrNull(form.episodesTotal.value),
                genres: genres.get(),
                physicalFormats: formats.get(),
                withBogdan: form.withBogdan.checked,
                pricePaid: numOrNull(form.pricePaid.value),
                cexLinks: form.cexLinks.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
                comments: form.comments.value,
                ...poster,
            };
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = isNew
                    ? await api("POST", "/api/titles", body)
                    : await api("PUT", `/api/titles/${row.id}`, body);
                await onSaved?.(saved, isNew);
            });
        };

        form.name.focus();
        return { form };
    }

    window.TitleEditor = { mount, todayIso };
})();
