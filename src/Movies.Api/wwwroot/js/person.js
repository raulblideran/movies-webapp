// A person's page (/people/{tmdbId}): who they are (TMDB), what of theirs is in your collection, with your
// ratings and watches, and their best-known work you haven't seen, which an editor can put on the watchlist.
// Their titles open in the title popup here (js/title-modal.js).

(function () {
    const { esc, api } = Auth;
    const root = document.getElementById("personRoot");
    const id = Number(location.pathname.match(/^\/people\/(\d+)/)?.[1]);
    const fmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
    const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const dateText = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        return longDate.format(new Date(y, m - 1, d));
    };
    const today = () => new Date().toISOString().slice(0, 10);
    const plural = (n, one, many = one + "s") => `${fmt.format(n)} ${n === 1 ? one : many}`;
    const CREW = new Set(["Director", "Creator", "Writer", "Music"]);

    let person = null;
    let titles = []; // every title on both lists
    let mine = []; // [{ row, roles }]
    let unseen = []; // TMDB works not on either list
    let showAll = false;

    function toast(id, message, ms = 3000) {
        const el = document.getElementById(id);
        el.textContent = message;
        el.classList.remove("hidden");
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add("hidden"), ms);
    }

    // "1985–2026, 81" / "1951–" style years for the header
    function lifeText(p) {
        if (!p.birthday) return "";
        const born = dateText(p.birthday);
        if (p.deathday) return `${born} – ${dateText(p.deathday)}`;
        const [y, m, d] = p.birthday.split("-").map(Number);
        const now = new Date();
        const age = now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
        return `Born ${born} (${age})`;
    }

    const roleText = (roles) => {
        const crew = roles.filter((r) => CREW.has(r));
        const cast = roles.filter((r) => !CREW.has(r));
        return [...crew, ...cast].join(" · ");
    };

    function workKey(mediaType, tmdbId) {
        return `${mediaType}/${tmdbId}`;
    }

    // Your titles with them: the ones whose TMDB credits list them, or that TMDB lists among their work.
    function match(people) {
        const works = new Map(person.works.map((w) => [workKey(w.mediaType, w.id), w]));
        const byTitle = new Map();
        for (const row of titles) {
            const w = row.tmdbId ? works.get(workKey(row.tmdbMediaType, row.tmdbId)) : null;
            const credited = people?.titles?.[row.id];
            const asMaker = credited?.directors?.includes(id);
            const asCast = credited?.cast?.includes(id);
            if (!w && !asMaker && !asCast) continue;
            const roles = w?.roles ?? [asMaker ? (row.type === "Series" ? "Creator" : "Director") : "Cast"];
            byTitle.set(row.id, { row, roles });
        }
        mine = [...byTitle.values()].sort((a, b) => (b.row.releaseYear ?? 0) - (a.row.releaseYear ?? 0) || a.row.name.localeCompare(b.row.name));
        const have = new Set(titles.filter((t) => t.tmdbId).map((t) => workKey(t.tmdbMediaType, t.tmdbId)));
        // well known first (TMDB's popularity), leaving out what hardly anyone has rated unless it isn't out yet
        unseen = person.works
            .filter((w) => !have.has(workKey(w.mediaType, w.id)))
            .filter((w) => w.voteCount >= 20 || !w.releaseDate || w.releaseDate > today());
    }

    function render() {
        const p = person;
        const watched = mine.filter((m) => m.row.list === "watched" || m.row.watchCount > 0);
        const rated = watched.map((m) => m.row.rating).filter((r) => r != null).map((r) => Math.min(10, r));
        const watches = watched.reduce((n, m) => n + (m.row.watchCount || 0), 0);
        const knownFor = { Directing: "Director", Acting: "Actor", Writing: "Writer", Production: "Producer", Sound: "Composer", Creator: "Creator" }[p.knownFor] ?? p.knownFor;
        const canAdd = !!Auth.me.canEdit;
        const upcoming = unseen.filter((w) => !w.releaseDate || w.releaseDate > today());
        const released = unseen.filter((w) => w.releaseDate && w.releaseDate <= today());
        const shownUnseen = showAll ? released : released.slice(0, 18);
        document.title = p.name;

        root.innerHTML = `
            <header class="person-hero">
                ${p.profileUrl ? `<img class="person-photo" src="${esc(p.profileUrl)}" alt="">` : `<div class="person-photo person-photo-blank" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).slice(0, 2).join(""))}</div>`}
                <div class="person-intro">
                    ${knownFor ? `<p class="person-known">${esc(knownFor)}</p>` : ""}
                    <h1 class="person-title">${esc(p.name)}</h1>
                    <p class="person-life">${esc([lifeText(p), p.placeOfBirth].filter(Boolean).join(" · "))}</p>
                    <dl class="person-figures">
                        <div><dt>In your collection</dt><dd>${fmt.format(mine.length)}</dd></div>
                        <div><dt>Watched</dt><dd>${plural(watches, "time")}</dd></div>
                        <div><dt>Your average</dt><dd>${rated.length ? fmt.format(rated.reduce((a, b) => a + b, 0) / rated.length) : "–"}</dd></div>
                        <div><dt>Their work</dt><dd>${fmt.format(p.works.length)}</dd></div>
                    </dl>
                    ${p.biography ? `<details class="person-bio"><summary>${esc(p.biography.split(/\n/)[0].slice(0, 220))}${p.biography.length > 220 ? "…" : ""} <span class="link">More</span></summary>${p.biography.split(/\n+/).map((para) => `<p>${esc(para)}</p>`).join("")}</details>` : ""}
                </div>
            </header>

            <section class="person-section" aria-labelledby="p-mine">
                <h2 id="p-mine">In your collection <span class="count">${mine.length}</span></h2>
                ${mine.length
                    ? `<div class="person-grid">${mine
                          .map(({ row, roles }) => `
                        <a class="person-card" href="${Lists.link(row)}" data-title="${row.id}">
                            ${row.posterUrl ? `<img src="${esc(row.posterUrl.replace("/w500/", "/w342/"))}" alt="" loading="lazy">` : `<span class="person-card-blank">${esc(row.name)}</span>`}
                            ${TitleModal.ratingHtml(row)}
                            <span class="person-card-text">
                                <span class="person-card-name">${esc(row.name)}${row.releaseYear ? ` <span class="faint">${row.releaseYear}</span>` : ""}</span>
                                <span class="person-card-role">${esc(roleText(roles))}</span>
                                ${row.list === "watchlist" && !row.watchCount ? `<span class="tag tag-watchlist">On your watchlist</span>` : WatchDialog.pipsHtml(row)}
                            </span>
                        </a>`)
                          .join("")}</div>`
                    : `<p class="muted">Nothing of theirs in your collection yet.</p>`}
            </section>

            ${upcoming.length ? `
            <section class="person-section" aria-labelledby="p-soon">
                <h2 id="p-soon">On the way <span class="count">${upcoming.length}</span></h2>
                <div class="person-grid">${upcoming.sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999")).map((w) => workCard(w, canAdd)).join("")}</div>
            </section>` : ""}

            <section class="person-section" aria-labelledby="p-unseen">
                <h2 id="p-unseen">Not seen yet <span class="count">${released.length}</span></h2>
                <p class="muted">Their best-known work you haven't got, most popular first (from TMDB).</p>
                ${released.length
                    ? `<div class="person-grid">${shownUnseen.map((w) => workCard(w, canAdd)).join("")}</div>
                       ${released.length > shownUnseen.length ? `<button type="button" class="btn" data-show-all>Show all ${released.length}</button>` : ""}`
                    : `<p class="muted">You've got everything of theirs that TMDB knows about.</p>`}
            </section>`;

        root.querySelector("[data-show-all]")?.addEventListener("click", () => {
            showAll = true;
            render();
        });
        root.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => add(b)));
    }

    function workCard(w, canAdd) {
        const when = !w.releaseDate ? "Date TBA" : w.releaseDate > today() ? dateText(w.releaseDate) : String(w.year ?? "");
        return `
            <div class="person-card is-unseen">
                <a href="https://www.themoviedb.org/${w.mediaType}/${w.id}" target="_blank" rel="noopener" class="person-card-poster" title="${esc(w.title)} on TMDB">
                    ${w.posterUrl ? `<img src="${esc(w.posterUrl)}" alt="" loading="lazy">` : `<span class="person-card-blank">${esc(w.title)}</span>`}
                </a>
                <span class="person-card-text">
                    <span class="person-card-name">${esc(w.title)} <span class="faint">${esc(when)}</span></span>
                    <span class="person-card-role">${esc(roleText(w.roles))}${w.mediaType === "tv" ? " · Series" : ""}</span>
                    ${w.voteAverage != null ? `<span class="person-card-score">TMDB ${fmt.format(w.voteAverage)}</span>` : ""}
                    ${canAdd ? `<button type="button" class="btn btn-small" data-add="${w.mediaType}/${w.id}">+ Watchlist</button>` : ""}
                </span>
            </div>`;
    }

    // Onto the watchlist, filled in from TMDB like the add form would be
    async function add(button) {
        button.disabled = true;
        button.textContent = "Adding…";
        try {
            const d = await api("GET", `/api/tmdb/details?link=${encodeURIComponent(button.dataset.add)}`);
            const vocab = [...new Set(titles.flatMap((r) => r.genres))];
            await api("POST", "/api/titles", {
                name: d.title, type: d.type, list: "Watchlist", releaseYear: d.year,
                genres: TitleEditor.mapGenres(d.genres, d.isAnime, vocab), seasons: d.seasons, episodesTotal: d.episodes,
                tmdbId: d.id, tmdbMediaType: d.mediaType, posterPath: d.posterPath,
            });
            toast("success", `Added ${d.title} to your watchlist`);
            await reload();
        } catch (e) {
            toast("error", e.message, 8000);
            button.disabled = false;
            button.textContent = "+ Watchlist";
        }
    }

    async function reload() {
        const [all, people] = await Promise.all([Lists.loadAll(), fetch("/api/titles/people").then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
        titles = all;
        match(people);
        render();
    }

    root.addEventListener("click", (e) => {
        const a = e.target.closest("[data-title]");
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab: the list page
        const row = titles.find((t) => t.id === Number(a.dataset.title));
        if (!row) return;
        e.preventDefault();
        TitleModal.open(row);
    });

    TitleModal.configure({
        rows: () => mine.map((m) => m.row),
        lookup: (type, tmdbId) => titles.find((t) => t.tmdbId === tmdbId && t.tmdbMediaType === type),
        onTitleChanged: () => reload(),
        lookupTitle: (tid) => titles.find((t) => t.id === tid),
    });

    // editors get the add buttons once sign-in has loaded
    document.addEventListener("auth-changed", () => person && render());

    (async function start() {
        if (!id) {
            root.innerHTML = `<div class="empty"><h2>No one here</h2><p class="muted">That isn't a person's page.</p></div>`;
            return;
        }
        try {
            const resp = await fetch(`/api/tmdb/person/${id}`);
            if (resp.status === 404) throw new Error("TMDB doesn't know anyone with that id.");
            if (!resp.ok) throw new Error("TMDB couldn't be reached. Try again in a moment.");
            person = await resp.json();
            await reload();
        } catch (e) {
            root.innerHTML = `<div class="empty"><h2>Couldn't load this person</h2><p class="muted">${esc(e.message)}</p></div>`;
        }
    })();
})();
