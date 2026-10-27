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
        return {
            get: () => (commit(), values),
            has: (v) => values.some((x) => x.toLowerCase() === v.toLowerCase()),
            addAll(list) {
                list.forEach(add);
                render();
            },
        };
    }

    /** Distinct values of a list field across all titles, for the chip suggestions. */
    function unique(rows, getList) {
        const map = new Map();
        for (const r of rows) for (const v of getList(r)) if (!map.has(v.toLowerCase())) map.set(v.toLowerCase(), v);
        return [...map.values()].sort((a, b) => a.localeCompare(b));
    }

    // Copies on the shelf are releases, edited on the releases page; the title form lists them.
    function releasesInner(row, isNew) {
        const label = window.Shelf?.label ?? ((r) => r.format);
        const items = row.releases
            .map((r) => `<li><a href="/releases?release=${r.id}" class="link" data-release-link="${r.id}">${esc(r.name)}</a> <span class="faint">${esc(label(r))}${r.pricePaid != null ? ` · £${Number(r.pricePaid).toFixed(2)}` : ""}</span></li>`)
            .join("");
        return `
                <span class="label">On the shelf</span>
                ${items ? `<ul>${items}</ul>` : `<p class="faint">Not on any release.</p>`}
                ${isNew
                    ? `<p class="faint">Save the title first, then add the discs it's on from the releases page.</p>`
                    : `<a href="/releases?new=1&title=${row.id}" class="btn btn-small" data-add-release>Add a release with this title</a>`}`;
    }

    // Open editors (in dialogs), so a page can refresh their shelf list after a release changes.
    const live = new Set();

    // TMDB genre names → the names this collection already uses, when it has an equivalent.
    const GENRE_ALIASES = {
        "science fiction": ["Sci-Fi", "Sci-fi", "SciFi"],
        "sci-fi": ["Science Fiction"],
        animation: ["Animated"],
        music: ["Musical"],
    };
    // TMDB genres that describe the format rather than the film.
    const GENRE_SKIP = new Set(["tv movie", "kids", "news", "reality", "soap", "talk"]);
    function mapGenres(tmdbGenres, isAnime, vocab) {
        const known = new Map(vocab.map((g) => [g.toLowerCase(), g]));
        const pick = (g) => known.get(g.toLowerCase()) ?? (GENRE_ALIASES[g.toLowerCase()] ?? []).map((a) => known.get(a.toLowerCase())).find(Boolean) ?? g;
        const out = tmdbGenres.filter((g) => !GENRE_SKIP.has(g.toLowerCase())).map(pick);
        if (isAnime) out.push(pick("Anime"));
        return out;
    }
    // Loose check before calling the server, so pasting random text doesn't fire a request.
    const looksLikeTmdb = (s) => /themoviedb\.org\/.*\b(movie|tv)\/\d/i.test(s) || /^\/?(movie|tv)\/\d+/i.test(s.trim());

    /**
     * Render the form into container.
     *   row        the title to edit, or null to add one
     *   allRows    every title (genre and format suggestions)
     *   onSaved    (saved, isNew) => …   after a successful POST/PUT
     *   onCancel   () => …
     *   pageLink   optional href shown as "Open as page" (the dialog uses it)
     *   openRelease(id)   optional: open a release over the form instead of following its link
     *   addRelease()      optional: open "Add a release" over the form instead of going to the releases page
     */
    function mount(container, row, { allRows = [], onSaved, onCancel, pageLink, openRelease, addRelease } = {}) {
        const isNew = !row;
        row = row ?? {
            name: "",
            type: "Film",
            watchCount: 1,
            firstWatch: todayIso(),
            latestWatch: todayIso(),
            genres: [],
            releases: [],
            withBogdan: false,
            watchedInCinema: false,
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
                    <button type="button" data-find class="btn btn-block" title="Search TMDB for the name above">Search TMDB</button>
                    <button type="button" data-clear-poster class="btn btn-small btn-block">Remove poster</button>
                </div>
                <div class="stack">
                    <div>
                        ${f("Find on TMDB", `<div class="tmdb-link"><input name="tmdbQuery" type="search" autocomplete="off" spellcheck="false" class="input" placeholder="Search by title, or paste a themoviedb.org link"><button type="button" data-tmdb-go class="btn">Search</button></div>`)}
                        <p data-tmdb-note class="tmdb-note hidden" role="status"></p>
                        <div data-results class="tmdb-results hidden"></div>
                    </div>
                    <div class="row row-name">
                        ${f("Name", `<input name="name" required maxlength="300" class="input" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="input">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
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
                    <div>
                        ${f("Genres", `<div data-genres data-label="Add a genre"></div>`)}
                        <div data-genre-suggest class="genre-suggest hidden"></div>
                    </div>
                    <div class="row row-3" style="align-items:end">
                        <label class="check" style="padding-bottom:10px"><input type="checkbox" name="withBogdan" ${row.withBogdan ? "checked" : ""}> Watched with Bogdan</label>
                        ${f("Date with Bogdan", date("dateWithBogdan", row.dateWithBogdan))}
                        <label class="check" style="padding-bottom:10px"><input type="checkbox" name="watchedInCinema" ${row.watchedInCinema ? "checked" : ""}> Watched in cinema</label>
                    </div>
                    <div class="editor-releases" data-releases>${releasesInner(row, isNew)}</div>
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

        // ---------- TMDB: search by title or paste a link, pick a result, fill the form ----------

        const tmdbBox = form.tmdbQuery;
        const goButton = d.$("[data-tmdb-go]");
        const resultsBox = d.$("[data-results]");
        const note = (html, warn = false) => {
            const el = d.$("[data-tmdb-note]");
            el.innerHTML = html;
            el.classList.toggle("hidden", !html);
            el.classList.toggle("is-warning", warn);
        };
        const inWatchlog = (mediaType, id) => allRows.find((r) => r.tmdbId === id && r.tmdbMediaType === mediaType && r.id !== row.id);

        // TMDB's genres, matched to the collection's names, offered as chips to add (nothing is added for you).
        const suggestBox = d.$("[data-genre-suggest]");
        let suggested = [];
        const renderSuggestions = () => {
            const left = suggested.filter((g) => !genres.has(g));
            suggestBox.classList.toggle("hidden", left.length === 0);
            suggestBox.innerHTML = left.length
                ? `<span class="faint">From TMDB:</span>
                   ${left.map((g) => `<button type="button" class="genre-chip" data-genre="${esc(g)}">+ ${esc(g)}</button>`).join("")}
                   ${left.length > 1 ? `<button type="button" class="btn btn-small" data-genre-all>Add all</button>` : ""}`
                : "";
        };
        suggestBox.addEventListener("click", (e) => {
            const chip = e.target.closest("[data-genre]");
            if (chip) genres.addAll([chip.dataset.genre]);
            else if (e.target.closest("[data-genre-all]")) genres.addAll(suggested);
            else return;
            renderSuggestions();
        });

        // Picking a result or pasting a link. A new title takes TMDB's name, type, year and episode counts;
        // an existing one keeps what's already filled in and only gets the poster and the empty fields.
        const fill = (link, button) =>
            busy(d, button, async () => {
                const t = await api("GET", `/api/tmdb/details?link=${encodeURIComponent(link)}`);
                const take = (input, value) => {
                    if (value == null || value === "") return;
                    if (isNew || input.value === "") input.value = value;
                };
                take(form.name, t.title);
                if (isNew && form.type.value !== t.type) {
                    form.type.value = t.type;
                    form.type.dispatchEvent(new Event("change")); // the themed dropdown (select.js) follows "change"
                }
                take(form.releaseYear, t.year);
                take(form.seasons, t.seasons);
                take(form.episodesTotal, t.episodes);
                Object.assign(poster, { tmdbId: t.id, tmdbMediaType: t.mediaType, posterPath: t.posterPath ?? poster.posterPath });
                renderPoster();
                suggested = mapGenres(t.genres, t.isAnime, unique(allRows, (r) => r.genres));
                renderSuggestions();
                resultsBox.classList.add("hidden");
                const dupe = inWatchlog(t.mediaType, t.id);
                note(
                    dupe
                        ? `Already in your watchlog as <strong>${esc(dupe.name)}</strong>${dupe.releaseYear ? ` (${dupe.releaseYear})` : ""}.`
                        : `From TMDB: <strong>${esc(t.title)}</strong>${t.year ? ` (${t.year})` : ""}.${suggested.some((g) => !genres.has(g)) ? " Pick genres from the suggestions." : ""}`,
                    !!dupe,
                );
                if (!dupe) (isNew ? form.rating : form.name).focus();
            });

        const search = (query, button) => {
            if (!query) {
                tmdbBox.focus();
                return d.error("Type a title to search for, or paste a TMDB link.");
            }
            const params = new URLSearchParams({ q: query });
            if (form.releaseYear.value) params.set("year", form.releaseYear.value);
            if (genres.get().some((g) => g.toLowerCase().includes("anime"))) params.set("anime", "true");
            return busy(d, button, async () => {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                note("");
                resultsBox.classList.remove("hidden");
                resultsBox.innerHTML = results.length
                    ? `<div class="poster-results">${results
                          .map((r, i) => {
                              const owned = inWatchlog(r.mediaType, r.id);
                              return `
                        <button type="button" data-pick="${i}" title="${esc(r.title)} (${esc(r.year ?? "?")})${owned ? " · already in your watchlog" : ""}">
                            ${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<div class="no-poster">${esc(r.title)}</div>`}
                            <span>${esc(r.title)}</span>
                            <span>${esc(r.year ?? "?")} · ${r.mediaType === "tv" ? "Series" : "Film"}${owned ? " · ✓" : ""}</span>
                        </button>`;
                          })
                          .join("")}</div>`
                    : `<p class="muted">Nothing on TMDB for “${esc(query)}”. Try a shorter title, or check the release year.</p>`;
                resultsBox.querySelectorAll("[data-pick]").forEach((b) => {
                    b.onclick = () => {
                        const r = results[Number(b.dataset.pick)];
                        fill(`${r.mediaType}/${r.id}`, b);
                    };
                });
            });
        };

        // The box: a link fills straight away; text searches; empty searches for the name.
        const go = () => {
            const q = tmdbBox.value.trim();
            if (looksLikeTmdb(q)) fill(q, goButton);
            else search(q || form.name.value.trim(), goButton);
        };
        goButton.onclick = go;
        tmdbBox.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault(); // search, don't submit the form
            go();
        });
        // Pasting a link fills straight away.
        tmdbBox.addEventListener("paste", () =>
            setTimeout(() => {
                if (looksLikeTmdb(tmdbBox.value)) fill(tmdbBox.value.trim(), goButton);
            }),
        );
        // The poster column's button searches for the name.
        d.$("[data-find]").onclick = (e) => {
            const name = form.name.value.trim();
            if (name) tmdbBox.value = name;
            search(name, e.currentTarget);
        };

        d.$("[data-cancel]").onclick = () => onCancel?.();

        // a plain click stays on the page; Ctrl/Cmd/Shift/middle click still opens the releases page
        const plain = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
        const releasesBox = d.$("[data-releases]");
        releasesBox.addEventListener("click", (e) => {
            const link = e.target.closest("[data-release-link]");
            if (link && openRelease && plain(e)) {
                e.preventDefault();
                openRelease(Number(link.dataset.releaseLink));
            } else if (e.target.closest("[data-add-release]") && addRelease && plain(e)) {
                e.preventDefault();
                addRelease();
            }
        });
        const editor = {
            id: row.id,
            showReleases(releases) {
                row = { ...row, releases };
                releasesBox.innerHTML = releasesInner(row, isNew);
            },
            isOpen: () => container.isConnected,
        };
        if (!isNew) live.add(editor);

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
                withBogdan: form.withBogdan.checked,
                watchedInCinema: form.watchedInCinema.checked,
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
        return { form, ...editor };
    }

    // After the page reloads its titles: every open editor shows its title's releases as they are now.
    // find(id) returns the fresh title.
    function refreshReleases(find) {
        for (const ed of live) {
            if (!ed.isOpen()) {
                live.delete(ed);
                continue;
            }
            const fresh = find(ed.id);
            if (fresh) ed.showReleases(fresh.releases);
        }
    }

    window.TitleEditor = { mount, todayIso, refreshReleases };
})();
