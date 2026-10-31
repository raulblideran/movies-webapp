// The add/edit title form, shared by the editor dialog (admin.js) and the full page (edit-page.js). It
// has two shapes: the Watchlog's (watches and rating) and the Watchlist's (when it was added). Needs
// auth.js and datepicker.js, loaded before this file (and lists.js, where it's on the page).

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

    // "in your Watchlog" / "on your Watchlist"
    const whereIs = (list) => (list === "watchlist" ? "on your Watchlist" : "in your Watchlog");
    const normalise = (saved) => window.Lists?.normalise(saved) ?? saved;

    /** The PUT body that saves a title as it is (admin.js changes a field or two before sending it). */
    function toRequest(row) {
        return {
            name: row.name,
            type: row.type,
            list: row.list === "watchlist" ? "Watchlist" : "Watched",
            watchlistAddedOn: row.watchlistAddedOn ?? null,
            firstWatch: row.firstWatch,
            latestWatch: row.latestWatch,
            watchCount: row.watchCount ?? 0,
            rating: row.rating,
            rewatchPotential: row.rewatchPotential,
            genres: row.genres,
            seasons: row.seasons,
            episodesTotal: row.episodesTotal,
            withBogdan: !!row.withBogdan,
            dateWithBogdan: row.dateWithBogdan,
            comments: row.comments,
            releaseYear: row.releaseYear,
            tmdbId: row.tmdbId,
            tmdbMediaType: row.tmdbMediaType,
            posterPath: row.posterPath,
        };
    }

    // "alien 1979" or "Alien (1979)": the name, and a year that puts the right film first
    function splitYear(q) {
        const m = q.match(/^(.*\S)\s+\(?((?:18|19|20)\d{2})\)?$/);
        return m ? { q: m[1], year: m[2] } : { q, year: null };
    }

    /**
     * Render the form into container.
     *   row        the title to edit (rows carry .list, see lists.js), or null to add one
     *   list       "watched" (default) or "watchlist": the list a new title goes on
     *   markWatched   true: row is on the watchlist and has just been watched. The watched form,
     *              filled in for today's watch; saving moves it to the Watchlog
     *   allRows    every title on both lists (genre suggestions, the duplicate check)
     *   onSaved    (saved, isNew) => …   after a successful POST/PUT; saved carries .list
     *   onMoved    optional (saved) => …: adding to the watchlist something already in the Watchlog
     *              offers to move that title instead, and this is called after it's moved
     *   onCancel   () => …
     *   pageLink   optional href shown as "Open as page" (the dialog uses it)
     *   openRelease(id)   optional: open a release over the form instead of following its link
     *   addRelease()      optional: open "Add a release" over the form instead of going to the releases page
     */
    function mount(container, row, { allRows = [], list = "watched", markWatched = false, onSaved, onMoved, onCancel, pageLink, openRelease, addRelease } = {}) {
        const today = todayIso();
        const isNew = !row;
        if (markWatched) {
            // one more watch, today; a title seen before keeps its first watch
            row = { ...row, list: "watched", watchCount: (row.watchCount || 0) + 1, latestWatch: today, firstWatch: row.firstWatch ?? today };
        }
        const W = (row?.list ?? list) === "watchlist"; // the watchlist's shorter form
        row = row ?? {
            name: "",
            type: "Film",
            list: W ? "watchlist" : "watched",
            watchCount: W ? 0 : 1,
            firstWatch: W ? null : today,
            latestWatch: W ? null : today,
            watchlistAddedOn: W ? today : null,
            genres: [],
            releases: [],
            withBogdan: false,
        };
        const duplicateOf = (tmdbId, mediaType) => allRows.find((r) => r.id !== row.id && r.tmdbId === tmdbId && r.tmdbMediaType === mediaType);
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
        const num = (name, value, attrs = "") => `<input name="${name}" type="number" ${attrs} class="input" value="${v(value)}">`;

        container.innerHTML = `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="editor">
                <div class="editor-poster">
                    <div data-poster class="poster-slot">No poster</div>
                    <button type="button" data-find class="btn btn-block">Find poster</button>
                    <button type="button" data-clear-poster class="btn btn-small btn-block">Remove poster</button>
                </div>
                <div class="stack">
                    <div>
                        ${f("Find on TMDB", `<div class="tmdb-link"><input name="tmdbQuery" type="text" inputmode="search" autocomplete="off" spellcheck="false" class="input" placeholder="Search by name, or paste a themoviedb.org link" aria-describedby="tmdb-hint-${uid}"><button type="button" data-tmdb-go class="btn">Search</button></div>`)}
                        <p class="sr-only" id="tmdb-hint-${uid}">Results appear as you type. Picking one fills in the form.</p>
                        <div data-tmdb-results class="tmdb-results hidden"></div>
                        <p data-tmdb-note class="tmdb-note hidden" role="status"></p>
                    </div>
                    <div class="row row-name">
                        ${f("Name", `<input name="name" required maxlength="300" class="input" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="input">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
                    <div data-results class="hidden"></div>
                    ${W ? `
                    <div class="row row-4">
                        ${f("Release year", num("releaseYear", row.releaseYear, `min="1870" max="2200"`))}
                        ${f("Seasons", num("seasons", row.seasons, `min="0"`))}
                        ${f("Episodes", num("episodesTotal", row.episodesTotal, `min="0"`))}
                        ${f("Added to watchlist", date("watchlistAddedOn", row.watchlistAddedOn))}
                    </div>
                    ${f("Genres", `<div data-genres data-label="Add a genre"></div>`)}` : `
                    <div class="row row-4">
                        ${f("Rating out of 10", num("rating", row.rating, `min="0" max="11" step="0.5" placeholder="?"`))}
                        ${f("Rewatch out of 10", num("rewatchPotential", row.rewatchPotential, `min="0" max="10" step="1"`))}
                        ${f("Watch count", num("watchCount", row.watchCount, `min="0" step="1"`))}
                        ${f("Release year", num("releaseYear", row.releaseYear, `min="1870" max="2200"`))}
                    </div>
                    <div class="row row-4">
                        ${f("First watch", date("firstWatch", row.firstWatch))}
                        ${f("Latest watch", date("latestWatch", row.latestWatch))}
                        ${f("Seasons", num("seasons", row.seasons, `min="0"`))}
                        ${f("Episodes", num("episodesTotal", row.episodesTotal, `min="0"`))}
                    </div>
                    ${f("Genres", `<div data-genres data-label="Add a genre"></div>`)}
                    <div class="row row-3" style="align-items:end">
                        <label class="check" style="padding-bottom:10px"><input type="checkbox" name="withBogdan" ${row.withBogdan ? "checked" : ""}> Watched with Bogdan</label>
                        ${f("Date with Bogdan", date("dateWithBogdan", row.dateWithBogdan))}
                    </div>`}
                    <div class="editor-releases" data-releases>${releasesInner(row, isNew)}</div>
                    ${f(W ? "Notes" : "Comments", `<textarea name="comments" rows="3" maxlength="4000" class="input"${W ? ` placeholder="Who recommended it, where to watch it…"` : ""}>${v(row.comments)}</textarea>`)}
                    <div class="actions">
                        ${pageLink ? `<a href="${esc(pageLink)}" class="btn push" title="Open this form on its own page">Open as page ↗</a>` : ""}
                        <button type="button" data-cancel class="btn">Cancel</button>
                        <button type="submit" class="btn btn-primary">${markWatched ? "Save to Watchlog" : W ? (isNew ? "Add to watchlist" : "Save changes") : isNew ? "Add title" : "Save changes"}</button>
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

        // ---------- TMDB: a note under the search, and filling the form from a film or series ----------

        function note(html, warn = false) {
            const el = d.$("[data-tmdb-note]");
            el.innerHTML = html;
            el.classList.toggle("hidden", !html);
            el.classList.toggle("is-warning", warn);
        }
        // Already on a list? Adding something to the watchlist that's in the Watchlog can move that title
        // over instead (keeping its watches), so there's one of it.
        function duplicateNote(dupe) {
            const canMove = W && isNew && onMoved && dupe.list === "watched";
            note(
                `Already ${whereIs(dupe.list)} as <strong>${esc(dupe.name)}</strong>${dupe.releaseYear ? ` (${dupe.releaseYear})` : ""}.` +
                    (canMove ? ` <button type="button" class="link" data-move-instead>Move it to your watchlist instead</button>` : "") +
                    (!W && isNew && dupe.list === "watchlist" ? " Mark it as watched from there instead." : ""),
                true,
            );
            d.$("[data-move-instead]")?.addEventListener("click", (e) =>
                busy(d, e.currentTarget, async () => {
                    const body = { ...toRequest(dupe), list: "Watchlist", watchlistAddedOn: DatePicker.iso(form.watchlistAddedOn) || today };
                    onMoved(normalise(await api("PUT", `/api/titles/${dupe.id}`, body)));
                }),
            );
        }

        const hideResults = () => {
            d.$("[data-results]").classList.add("hidden");
            d.$("[data-tmdb-results]").classList.add("hidden");
        };

        function applyDetails(t) {
            form.name.value = t.title;
            form.type.value = t.type;
            form.type.dispatchEvent(new Event("change")); // the themed dropdown (select.js) follows "change"
            if (t.year) form.releaseYear.value = t.year;
            if (t.seasons != null) form.seasons.value = t.seasons;
            if (t.episodes != null) form.episodesTotal.value = t.episodes;
            genres.addAll(mapGenres(t.genres, t.isAnime, unique(allRows, (r) => r.genres)));
            Object.assign(poster, { tmdbId: t.id, tmdbMediaType: t.mediaType, posterPath: t.posterPath ?? poster.posterPath });
            renderPoster();
            hideResults();
            const dupe = duplicateOf(t.id, t.mediaType);
            if (dupe) return duplicateNote(dupe);
            note(`Filled from TMDB: <strong>${esc(t.title)}</strong>${t.year ? ` (${t.year})` : ""}.${W ? "" : " Add your rating and watch dates."}`);
            (W ? form.comments : form.rating).focus();
        }

        // a film or series by TMDB link ("movie/603" works too), into the form
        const fillFrom = (link, button) =>
            busy(d, button, async () => applyDetails(await api("GET", `/api/tmdb/details?link=${encodeURIComponent(link)}`)));

        // Search results as poster buttons; pick(result) runs on a click. Ones already on a list say so.
        function showResults(box, results, pick, empty) {
            box.classList.remove("hidden");
            box.innerHTML = results.length
                ? `<div class="poster-results">${results
                      .map((r, i) => {
                          const dupe = duplicateOf(r.id, r.mediaType);
                          return `
                    <button type="button" data-pick="${i}" title="${esc(r.title)} (${esc(r.year ?? "?")})">
                        <img src="${esc(r.posterUrl)}" alt="">
                        <span>${esc(r.title)}</span>
                        <span>${esc(r.year ?? "?")}, ${r.mediaType === "tv" ? "TV" : "film"}</span>
                        ${dupe ? `<span class="poster-result-have">${dupe.list === "watchlist" ? "On watchlist" : "In Watchlog"}</span>` : ""}
                    </button>`;
                      })
                      .join("")}</div>`
                : `<p class="muted">${empty}</p>`;
            box.querySelectorAll("[data-pick]").forEach((b) => (b.onclick = () => pick(results[Number(b.dataset.pick)], b)));
        }

        // ---------- the TMDB search box: type a name, or paste a link ----------

        const query = form.tmdbQuery;
        const goButton = d.$("[data-tmdb-go]");
        const tmdbBox = d.$("[data-tmdb-results]");
        let searchSeq = 0;
        let timer = null;
        async function searchTmdb() {
            clearTimeout(timer);
            const text = query.value.trim();
            if (!text) return tmdbBox.classList.add("hidden");
            if (looksLikeTmdb(text)) return fillFrom(text, goButton);
            const seq = ++searchSeq;
            const { q, year } = splitYear(text);
            const params = new URLSearchParams({ q });
            if (year) params.set("year", year);
            try {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                if (seq !== searchSeq) return; // a newer search is on its way
                d.error("");
                showResults(tmdbBox, results, (r, b) => fillFrom(`${r.mediaType}/${r.id}`, b), "Nothing on TMDB by that name. Try fewer words, or add the year.");
            } catch (e) {
                if (seq === searchSeq) d.error(e.message);
            }
        }
        query.addEventListener("input", () => {
            const text = query.value.trim();
            goButton.textContent = looksLikeTmdb(text) ? "Fill" : "Search";
            clearTimeout(timer);
            if (!text) {
                searchSeq++;
                return tmdbBox.classList.add("hidden");
            }
            if (!looksLikeTmdb(text) && text.length >= 3) timer = setTimeout(searchTmdb, 400);
        });
        query.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault(); // search, don't submit the form
                searchTmdb();
            } else if (e.key === "Escape" && !tmdbBox.classList.contains("hidden")) {
                e.preventDefault();
                e.stopPropagation(); // close the results, keep the dialog open
                tmdbBox.classList.add("hidden");
            }
        });
        // Pasting a link fills straight away.
        query.addEventListener("paste", () =>
            setTimeout(() => {
                if (looksLikeTmdb(query.value)) fillFrom(query.value.trim(), goButton);
            }),
        );
        goButton.onclick = () => (query.value.trim() ? searchTmdb() : (d.error("Type a name to search TMDB, or paste a TMDB link."), query.focus()));

        // ---------- Find poster: by the name and year in the form ----------
        // On a new title a pick fills the whole form; on one you're editing it only changes the poster.

        d.$("[data-find]").onclick = (e) => {
            const name = form.name.value.trim();
            if (!name) return d.error("Enter a name first, or search TMDB above.");
            const params = new URLSearchParams({ q: name });
            if (form.releaseYear.value) params.set("year", form.releaseYear.value);
            if (genres.get().some((g) => g.toLowerCase().includes("anime"))) params.set("anime", "true");
            busy(d, e.currentTarget, async () => {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                showResults(d.$("[data-results]"), results, (r, b) => {
                    if (isNew) return fillFrom(`${r.mediaType}/${r.id}`, b);
                    Object.assign(poster, { tmdbId: r.id, tmdbMediaType: r.mediaType, posterPath: r.posterPath });
                    if (!form.releaseYear.value && r.year) form.releaseYear.value = r.year;
                    renderPoster();
                    hideResults();
                    const dupe = duplicateOf(r.id, r.mediaType);
                    if (dupe) duplicateNote(dupe);
                    else note("");
                }, "No posters found. Check the name or the release year.");
            });
        };

        d.$("[data-cancel]").onclick = () => onCancel?.();
        if (markWatched && row.watchCount > 1)
            note(`Watch number ${row.watchCount}: you've seen it before, so its first watch and rating are kept. Change the rating if it's moved.`);

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

        // ---------- saving ----------

        function readDates(fields) {
            const out = {};
            for (const [name, label] of fields) {
                out[name] = DatePicker.iso(form[name]);
                if (out[name] === undefined) {
                    form[name].focus();
                    d.error(`${label} isn't a date. Use dd/mm/yyyy.`);
                    return null;
                }
            }
            return out;
        }

        form.onsubmit = (e) => {
            e.preventDefault();
            const shared = {
                name: form.name.value.trim(),
                type: form.type.value,
                releaseYear: numOrNull(form.releaseYear.value),
                seasons: numOrNull(form.seasons.value),
                episodesTotal: numOrNull(form.episodesTotal.value),
                genres: genres.get(),
                comments: form.comments.value,
                ...poster,
            };
            let body;
            if (W) {
                const dates = readDates([["watchlistAddedOn", "Added to watchlist"]]);
                if (!dates) return;
                // the watch fields aren't on this form: a title waiting for a rewatch keeps its watches
                body = { ...toRequest(row), ...shared, ...dates, list: "Watchlist" };
            } else {
                const dates = readDates([["firstWatch", "First watch"], ["latestWatch", "Latest watch"], ["dateWithBogdan", "Date with Bogdan"]]);
                if (!dates) return;
                body = {
                    ...shared,
                    ...dates,
                    list: "Watched",
                    watchlistAddedOn: row.watchlistAddedOn ?? null,
                    rating: numOrNull(form.rating.value),
                    rewatchPotential: numOrNull(form.rewatchPotential.value),
                    watchCount: numOrNull(form.watchCount.value) ?? 0,
                    withBogdan: form.withBogdan.checked,
                };
            }
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = isNew ? await api("POST", "/api/titles", body) : await api("PUT", `/api/titles/${row.id}`, body);
                await onSaved?.(normalise(saved), isNew);
            });
        };

        (isNew ? query : form.name).focus();
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

    window.TitleEditor = { mount, todayIso, refreshReleases, toRequest, mapGenres };
})();
