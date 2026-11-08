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
            has: (v) => values.some((x) => x.toLowerCase() === v.toLowerCase()),
            // what it holds, plus anything typed but not yet added (doesn't add it)
            peek: () => [...values, input.value.trim()].filter(Boolean),
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

    // Copies on the shelf are releases, edited on the releases page; the title form lists them, and after
    // them the ones traded in or sold (row.soldReleases, from Lists.normalise).
    function releasesInner(row, isNew) {
        const label = window.Shelf?.label ?? ((r) => r.format);
        const item = (r, meta) => `<li><a href="/releases?release=${r.id}" class="link" data-release-link="${r.id}">${esc(r.name)}</a> <span class="faint">${esc(meta)}</span></li>`;
        const items = row.releases.map((r) => item(r, `${label(r)}${r.pricePaid != null ? ` · £${Number(r.pricePaid).toFixed(2)}` : ""}`)).join("");
        const gone = (row.soldReleases ?? []).map((r) => item(r, `${label(r)} · ${window.Shelf?.saleBadge(r) ?? "Sold"}`)).join("");
        return `
                <span class="label">On the shelf</span>
                ${items ? `<ul>${items}</ul>` : `<p class="faint">Not on any release${gone ? " now" : ""}.</p>`}
                ${gone ? `<span class="label">No longer on the shelf</span><ul class="is-gone">${gone}</ul>` : ""}
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
            tags: row.tags ?? [],
            seasons: row.seasons,
            episodesTotal: row.episodesTotal,
            withBogdan: !!row.withBogdan,
            dateWithBogdan: row.dateWithBogdan,
            watchedInCinema: !!row.watchedInCinema,
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
            // one more watch, today; a title seen before keeps the watches it has
            row = { ...row, list: "watched", watches: [...(row.watches ?? []), { date: today, withBogdan: false, inCinema: false, notes: null }] };
        }
        const W = (row?.list ?? list) === "watchlist"; // the watchlist's shorter form
        row = row ?? {
            name: "",
            type: "Film",
            list: W ? "watchlist" : "watched",
            watches: W ? [] : [{ date: today, withBogdan: false, inCinema: false, notes: null }],
            watchlistAddedOn: W ? today : null,
            genres: [],
            tags: [],
            releases: [],
            withBogdan: false,
            watchedInCinema: false,
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
        // the genre chips, with TMDB's genres offered underneath after a pick (nothing is added for you)
        const genresField = `
                    <div>
                        ${f("Genres", `<div data-genres data-label="Add a genre"></div>`)}
                        <div data-genre-suggest class="genre-suggest hidden"></div>
                    </div>
                    <div>
                        ${f("Your tags", `<div data-tags data-label="Add a tag"></div>`)}
                        <p class="field-hint">Your own labels, like Christmas or Comfort films. They become a filter.</p>
                    </div>`;

        container.innerHTML = `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="editor">
                <div class="editor-poster">
                    <div data-poster class="poster-slot">No poster</div>
                    <button type="button" data-find class="btn btn-block" title="Search TMDB for the name below">Search TMDB</button>
                    <button type="button" data-clear-poster class="btn btn-small btn-block">Remove poster</button>
                </div>
                <div class="stack">
                    <div>
                        ${f("Find on TMDB", `<div class="tmdb-link"><input name="tmdbQuery" type="text" inputmode="search" autocomplete="off" spellcheck="false" class="input" placeholder="Search by name, or paste a themoviedb.org link" aria-describedby="tmdb-hint-${uid}"><button type="button" data-tmdb-go class="btn">Search</button></div>`)}
                        <p class="sr-only" id="tmdb-hint-${uid}">Results appear as you type. Picking one fills in the form.</p>
                        <p data-tmdb-note class="tmdb-note hidden" role="status"></p>
                        <div data-tmdb-results class="tmdb-results hidden"></div>
                    </div>
                    <div class="row row-name">
                        ${f("Name", `<input name="name" required maxlength="300" class="input" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="input">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
                    ${W ? `
                    <div class="row row-4">
                        ${f("Release year", num("releaseYear", row.releaseYear, `min="1870" max="2200"`))}
                        ${f("Seasons", num("seasons", row.seasons, `min="0"`))}
                        ${f("Episodes", num("episodesTotal", row.episodesTotal, `min="0"`))}
                        ${f("Added to watchlist", date("watchlistAddedOn", row.watchlistAddedOn))}
                    </div>
                    ${genresField}` : `
                    <div class="row row-5">
                        ${f("Rating out of 10", num("rating", row.rating, `min="0" max="11" step="0.5" placeholder="?"`))}
                        ${f("Rewatch out of 10", num("rewatchPotential", row.rewatchPotential, `min="0" max="10" step="1"`))}
                        ${f("Release year", num("releaseYear", row.releaseYear, `min="1870" max="2200"`))}
                        ${f("Seasons", num("seasons", row.seasons, `min="0"`))}
                        ${f("Episodes", num("episodesTotal", row.episodesTotal, `min="0"`))}
                    </div>
                    <fieldset class="editor-watches" data-watches>
                        <legend class="label">Watches <span class="count" data-watch-count></span></legend>
                        <ol class="watch-rows" data-watch-rows></ol>
                        <div class="watch-add">
                            <button type="button" class="btn btn-small" data-add-watch>+ Add a watch</button>
                            <button type="button" class="btn btn-small" data-add-undated title="Watched before, but you don't know when">+ One with no date</button>
                        </div>
                    </fieldset>
                    ${genresField}`}
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
        const tags = chipInput(d.$("[data-tags]"), row.tags ?? [], unique(allRows, (r) => r.tags ?? []), `tagOptions-${uid}`);

        // ---------- the watches (the Watchlog's form): one row each, saved with the title ----------

        const watchRows = d.$("[data-watch-rows]");
        function addWatchRow(w) {
            const li = document.createElement("li");
            li.className = "watch-row";
            if (w.id) li.dataset.id = w.id;
            li.innerHTML = `
                <input data-date data-w="date" class="input" value="${v(w.date)}" aria-label="Date watched (empty if you don't know)" placeholder="Date unknown">
                <label class="check"><input type="checkbox" data-w="withBogdan" ${w.withBogdan ? "checked" : ""}> Bogdan</label>
                <label class="check"><input type="checkbox" data-w="inCinema" ${w.inCinema ? "checked" : ""}> Cinema</label>
                <input data-w="notes" class="input" maxlength="2000" value="${v(w.notes)}" placeholder="Notes" aria-label="Notes on this watch">
                <button type="button" class="btn btn-small" data-remove-watch aria-label="Remove this watch" title="Remove this watch">×</button>`;
            DatePicker.attach(li.querySelector("[data-date]"));
            li.querySelector("[data-date]").placeholder = "Date unknown"; // empty: watched, but not sure when
            li.querySelector("[data-remove-watch]").onclick = () => {
                li.remove();
                countWatches();
            };
            watchRows.appendChild(li);
            countWatches();
            return li;
        }
        function countWatches() {
            const n = watchRows?.children.length ?? 0;
            const el = d.$("[data-watch-count]");
            if (el) el.textContent = n ? String(n) : "none yet";
        }
        // [{ id, date, withBogdan, inCinema, notes }], or null when a date isn't one (the field is focused)
        function readWatches() {
            if (!watchRows) return [];
            const out = [];
            for (const li of watchRows.children) {
                const dateInput = li.querySelector('[data-w="date"]');
                const date = DatePicker.iso(dateInput);
                if (date === undefined) {
                    dateInput.focus();
                    d.error("A watch's date isn't a date. Use dd/mm/yyyy, or leave it empty if you don't know.");
                    return null;
                }
                out.push({
                    id: li.dataset.id ? Number(li.dataset.id) : null,
                    date,
                    withBogdan: li.querySelector('[data-w="withBogdan"]').checked,
                    inCinema: li.querySelector('[data-w="inCinema"]').checked,
                    notes: li.querySelector('[data-w="notes"]').value.trim() || null,
                });
            }
            return out;
        }
        if (watchRows) {
            (row.watches ?? []).forEach(addWatchRow);
            d.$("[data-add-watch]").onclick = () => addWatchRow({ date: today }).querySelector("[data-date]").focus();
            d.$("[data-add-undated]").onclick = () => addWatchRow({ date: null }).querySelector('[data-w="notes"]').focus();
            countWatches();
        }

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
                    const moved = await api("PUT", `/api/titles/${dupe.id}`, body);
                    markClean();
                    onMoved(normalise(moved));
                }),
            );
        }

        const hideResults = () => d.$("[data-tmdb-results]").classList.add("hidden");

        // TMDB's genres, matched to the collection's names, offered as chips to add (nothing is added for you).
        const suggestBox = d.$("[data-genre-suggest]");
        let suggested = [];
        function renderSuggestions() {
            const left = suggested.filter((g) => !genres.has(g));
            suggestBox.classList.toggle("hidden", left.length === 0);
            suggestBox.innerHTML = left.length
                ? `<span class="faint">From TMDB:</span>
                   ${left.map((g) => `<button type="button" class="genre-chip" data-genre="${esc(g)}">+ ${esc(g)}</button>`).join("")}
                   ${left.length > 1 ? `<button type="button" class="btn btn-small" data-genre-all>Add all</button>` : ""}`
                : "";
        }
        suggestBox.addEventListener("click", (e) => {
            const chip = e.target.closest("[data-genre]");
            if (chip) genres.addAll([chip.dataset.genre]);
            else if (e.target.closest("[data-genre-all]")) genres.addAll(suggested);
            else return;
            renderSuggestions();
        });

        // A pick or a pasted link. A new title takes TMDB's name, type, year and episode counts; one you're
        // editing keeps what's already filled in and only gets the poster and the empty fields.
        function applyDetails(t) {
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
            hideResults();
            const dupe = duplicateOf(t.id, t.mediaType);
            if (dupe) return duplicateNote(dupe);
            const pickGenres = suggested.some((g) => !genres.has(g)) ? " Pick genres from the suggestions." : "";
            note(`From TMDB: <strong>${esc(t.title)}</strong>${t.year ? ` (${t.year})` : ""}.${pickGenres}${W || !isNew ? "" : " Add your rating and watch dates."}`);
            (W ? form.comments : isNew ? form.rating : form.name).focus();
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
                        ${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<div class="no-poster">${esc(r.title)}</div>`}
                        <span>${esc(r.title)}</span>
                        <span>${esc(r.year ?? "?")} · ${r.mediaType === "tv" ? "Series" : "Film"}</span>
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
            const text = query.value.trim() || form.name.value.trim(); // empty: search for the name
            if (!text) {
                query.focus();
                return d.error("Type a title to search for, or paste a TMDB link.");
            }
            if (looksLikeTmdb(text)) return fillFrom(text, goButton);
            const seq = ++searchSeq;
            const { q, year } = splitYear(text);
            const params = new URLSearchParams({ q });
            if (year || form.releaseYear.value) params.set("year", year || form.releaseYear.value);
            if (genres.peek().some((g) => g.toLowerCase().includes("anime"))) params.set("anime", "true");
            try {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                if (seq !== searchSeq) return; // a newer search is on its way
                d.error("");
                showResults(tmdbBox, results, (r, b) => fillFrom(`${r.mediaType}/${r.id}`, b), `Nothing on TMDB for “${esc(q)}”. Try a shorter title, or check the release year.`);
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
        goButton.onclick = searchTmdb;

        // ---------- the poster column's button: search TMDB for the name ----------

        d.$("[data-find]").onclick = () => {
            const name = form.name.value.trim();
            if (name) query.value = name;
            goButton.textContent = "Search";
            searchTmdb();
        };

        d.$("[data-cancel]").onclick = () => onCancel?.();
        if (markWatched && row.watches.length > 1)
            note(`Watch number ${row.watches.length}: you've seen it before, so its watches and rating are kept. Change the rating if it's moved.`);

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
            showReleases(releases, soldReleases = []) {
                row = { ...row, releases, soldReleases };
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
                tags: tags.get(),
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
                const watches = readWatches();
                if (!watches) return;
                body = {
                    ...shared,
                    list: "Watched",
                    watchlistAddedOn: row.watchlistAddedOn ?? null,
                    rating: numOrNull(form.rating.value),
                    rewatchPotential: numOrNull(form.rewatchPotential.value),
                    watches,
                };
            }
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const result = isNew ? await api("POST", "/api/titles", body) : await api("PUT", `/api/titles/${row.id}`, body);
                markClean();
                await onSaved?.(normalise(result), isNew);
            });
        };

        // Unsaved changes: anything different from how the form opened (the TMDB search box doesn't count).
        const watchesNow = () =>
            [...(watchRows?.children ?? [])].map((li) => [...li.querySelectorAll("[data-w]")].map((i) => (i.type === "checkbox" ? i.checked : i.value)));
        const snapshot = () =>
            JSON.stringify([[...new FormData(form)].filter(([k]) => k !== "tmdbQuery"), genres.peek(), tags.peek(), poster, watchesNow()]);
        let initial = snapshot();
        let saved = false;
        const isDirty = () => !saved && snapshot() !== initial;
        const markClean = () => {
            saved = true;
        };

        (isNew ? query : form.name).focus();
        return { form, ...editor, isDirty, markClean };
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
            if (fresh) ed.showReleases(fresh.releases, fresh.soldReleases);
        }
    }

    window.TitleEditor = { mount, todayIso, refreshReleases, toRequest, mapGenres };
})();
