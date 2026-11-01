// Stats page, Year in review tab (#review, #review-2025): one year of watching at a glance. Built from the
// blocks js/stats.js shares as window.StatsKit.
//
// A year's figures come from the watches dated in it: "new" means its first dated watch was that year,
// "rewatched" means watched that year after first seeing it in an earlier one. Watches with no date
// can't be placed in a year, so they're left out (date them on the Watches page and they count).

(function () {
    const K = window.StatsKit;
    const { columns, hbars, fmt, esc } = window.Charts;
    const { card, section, guard, kpiTiles, plural, mean, sum, slot, MONTHS } = K;

    let year = null;
    let hero = [];

    const thisYear = () => new Date().getFullYear();
    const yearOf = (iso) => (iso ? Number(iso.slice(0, 4)) : null);
    const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

    // every year something happened in, newest first, and this year even if it's quiet so far
    function years() {
        const ys = new Set([thisYear()]);
        for (const r of K.watched()) for (const w of r.watches ?? []) if (w.date) ys.add(yearOf(w.date));
        for (const r of K.titles()) if (r.watchlistAddedOn) ys.add(yearOf(r.watchlistAddedOn));
        return [...ys].sort((a, b) => b - a);
    }

    // In January the year that just ended is the interesting one.
    function defaultYear() {
        const now = new Date();
        const hasData = (y) => K.watched().some((r) => (r.watches ?? []).some((w) => yearOf(w.date) === y));
        return now.getMonth() === 0 && hasData(thisYear() - 1) ? thisYear() - 1 : thisYear();
    }

    // A year's watching, from the watches dated in it.
    function yearData(Y) {
        const W = K.watched();
        const inYear = new Map();
        for (const r of W) {
            const ws = (r.watches ?? []).filter((w) => yearOf(w.date) === Y);
            if (ws.length) inYear.set(r, ws);
        }
        const seen = [...inYear.keys()];
        const fresh = seen.filter((r) => r.fy === Y);
        const rewatched = seen.filter((r) => r.fy != null && r.fy < Y);
        const watchesIn = (r) => inYear.get(r)?.length ?? 0;
        const yearWatches = [...inYear.values()].flat();
        const minutesPerWatch = (r) => (!r.runtime ? null : r.type === "Series" ? (r.episodesTotal ? r.runtime * r.episodesTotal : null) : r.runtime);
        const minutes = sum(seen.map((r) => (minutesPerWatch(r) ?? 0) * watchesIn(r)));
        const rated = fresh.filter((r) => r.r10 != null);
        const all = K.titles();
        const addedToWatchlist = all.filter((r) => yearOf(r.watchlistAddedOn) === Y);
        // off the watchlist: its first watch on or after the day it was added, in this year
        const watchedAfter = (r) => (r.watches ?? []).map((w) => w.date).filter((d) => d && d >= r.watchlistAddedOn).sort()[0];
        const crossedOff = all.filter((r) => r.list === "watched" && r.watchlistAddedOn && yearOf(watchedAfter(r)) === Y);
        return {
            Y, fresh, rewatched, seen, minutes, rated,
            avg: rated.length ? mean(rated.map((r) => r.r10)) : null,
            withBogdan: seen.filter((r) => inYear.get(r).some((w) => w.withBogdan)).length,
            inCinema: yearWatches.filter((w) => w.inCinema).length,
            favourites: fresh.filter((r) => r.fav),
            watches: yearWatches.length,
            addedToWatchlist,
            crossedOff,
            wait: crossedOff.length ? mean(crossedOff.map((r) => days(r.watchlistAddedOn, watchedAfter(r)))) : null,
            noRuntime: seen.filter((r) => minutesPerWatch(r) == null).length,
        };
    }

    // "+12" / "−3" against the year before
    const delta = (now, before, digits = 0) =>
        before == null || now == null ? "" : now === before ? "same as last year" : `${now > before ? "+" : "−"}${fmt(Math.abs(now - before), digits)} on last year`;

    const posterLink = (r, value) => `
        <a class="record" href="${Lists.link(r)}" data-title="${r.id}">
            ${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(r.name)}</span>`}
            <span class="record-text">
                <span class="record-name">${esc(r.name)}</span>
                <span class="record-value">${esc(value)}</span>
            </span>
        </a>`;

    function recordsHtml(title, items) {
        const list = items.filter(([, r]) => r);
        if (!list.length) return "";
        return `
            <section class="viz-section" aria-labelledby="rv-${title.replace(/\W+/g, "-")}">
                <div class="viz-section-head"><h2 id="rv-${title.replace(/\W+/g, "-")}">${esc(title)}</h2></div>
                <div class="records">${list
                    .map(([label, r, value]) =>
                        posterLink(r, value).replace('<span class="record-name">', `<span class="record-label">${esc(label)}</span><span class="record-name">`))
                    .join("")}</div>
            </section>`;
    }

    // the year's most-watched director and actor (TMDB credits), if they're loaded
    function peopleOfTheYear(seen) {
        const credits = K.credits();
        if (!credits) return [];
        const top = (role) => {
            const map = new Map();
            for (const r of seen) for (const id of new Set(credits.titles[r.id]?.[role] ?? [])) map.set(id, [...(map.get(id) ?? []), r]);
            const [id, titles] = [...map].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
            return id && titles.length > 1 ? { person: credits.people[id], titles } : null;
        };
        return [["Director of the year", top("directors")], ["Actor of the year", top("cast")]].filter(([, p]) => p);
    }

    function render() {
        const root = document.getElementById("reviewRoot");
        K.beginTab("review");
        const ys = years();
        if (!ys.includes(year)) year = defaultYear();
        const d = yearData(year);
        const prev = yearData(year - 1);
        const soFar = year === thisYear();

        hero = [
            [fmt(d.fresh.length), soFar ? `new in ${year} so far` : `new in ${year}`],
            [K.hoursText(d.minutes || null), "screen time"],
            [d.avg != null ? d.avg.toFixed(2) : "–", "avg rating"],
            [fmt(d.rewatched.length), "rewatched"],
        ];
        K.setHero(hero);

        const chips = `
            <div class="chips review-years" role="group" aria-label="Year">
                ${ys.map((y) => `<button type="button" class="chip" data-year="${y}" aria-pressed="${y === year}">${y}${y === thisYear() ? " (so far)" : ""}</button>`).join("")}
            </div>`;

        if (!d.seen.length && !d.addedToWatchlist.length) {
            root.innerHTML = `${chips}<div class="empty"><h2>Nothing logged in ${year}${soFar ? " yet" : ""}</h2><p class="muted">Pick another year.</p></div>`;
            return;
        }

        const goal = K.goals?.().find((g) => g.year === year);
        const tiles = [
            ["New titles", fmt(d.fresh.length), `${plural(d.fresh.filter((r) => r.type === "Film").length, "film")} · ${fmt(d.fresh.filter((r) => r.type === "Series").length)} series · ${delta(d.fresh.length, prev.fresh.length)}`],
            ["Watches", fmt(d.watches), `${plural(d.rewatched.length, "title")} seen before, watched again`],
            ["Screen time", K.hoursText(d.minutes || null), `about ${fmt(d.minutes / 60, 0)} hours${d.noRuntime ? ` · ${plural(d.noRuntime, "title")} without a runtime` : ""}`],
            ["Average rating", d.avg != null ? fmt(d.avg, 2) : "–", d.rated.length ? `${plural(d.rated.length, "new title")} rated · ${delta(d.avg, prev.avg, 2)}` : "nothing rated"],
            ["With Bogdan", fmt(d.withBogdan), `${plural(d.withBogdan, "title")}${d.inCinema ? ` · ${plural(d.inCinema, "trip")} to the cinema` : ""}`],
            ["New favourites", fmt(d.favourites.length), "rated off the scale (11/10)"],
            ...(goal ? [["Goal", `${fmt(d.watches)} of ${fmt(goal.target)}`, d.watches >= goal.target ? "made it" : soFar ? `${plural(goal.target - d.watches, "watch", "watches")} to go` : `${plural(goal.target - d.watches, "watch", "watches")} short`]] : []),
            ["Onto the watchlist", fmt(d.addedToWatchlist.length), plural(d.addedToWatchlist.length, "title") + " added"],
            ["Off the watchlist", fmt(d.crossedOff.length), d.wait != null ? `after ${fmt(d.wait, 0)} days on average` : "watched from the watchlist"],
        ];

        // month by month: new titles, films and series
        const byMonth = MONTHS.map((m, i) => ({
            label: m,
            values: [d.fresh.filter((r) => r.fm === i && r.type === "Film").length, d.fresh.filter((r) => r.fm === i && r.type === "Series").length],
        }));
        const busiest = [...byMonth].sort((a, b) => sum(b.values) - sum(a.values))[0];

        // genres of everything watched that year
        const genreCount = new Map();
        for (const r of d.seen)
            for (const g of new Set(r.genres.map((x) => x.trim()).filter(Boolean))) {
                const key = g.toLowerCase();
                const cur = genreCount.get(key) ?? { label: g, value: 0 };
                cur.value++;
                genreCount.set(key, cur);
            }
        const genres = [...genreCount.values()].sort((a, b) => b.value - a.value).slice(0, 10);

        const best = [...d.rated].sort((a, b) => b.r10 - a.r10 || (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || a.name.localeCompare(b.name));
        const pick = (xs, cmp) => (xs.length ? [...xs].sort(cmp)[0] : null);
        const films = d.seen.filter((r) => r.type === "Film" && r.runtime);
        const dated = d.seen.filter((r) => r.releaseYear);

        root.innerHTML = [
            chips,
            `<p class="review-note muted">${soFar ? "So far this year. " : ""}Counted from the watches dated in ${year}: “new” means first watched in ${year}, and a title seen before counts again for each watch. Watches with no date can't be placed in a year. Screen time is an estimate.</p>`,
            kpiTiles(tiles),
            best.length
                ? `<section class="viz-section" aria-labelledby="rv-best">
                    <div class="viz-section-head"><h2 id="rv-best">Best new watches</h2><p>The highest-rated titles you saw for the first time in ${year}.</p></div>
                    <div class="records">${best.slice(0, 6).map((r) => posterLink(r, `${fmt(r.rating, 1)}/10${r.fav ? " · all-time favourite" : ""}`)).join("")}</div>
                </section>`
                : "",
            section("rv-when", "When and what", busiest && sum(busiest.values) ? `${busiest.label} was the busiest month, with ${plural(sum(busiest.values), "new title")}.` : "", [
                card("Month by month", "New titles, films and series stacked", (el) =>
                    columns(el, { items: byMonth, series: [{ name: "Films", color: slot(0) }, { name: "Series", color: slot(1) }], label: `New titles each month of ${year}` }), {
                    head: ["Month", "Films", "Series"],
                    rows: byMonth.map((m) => [m.label, ...m.values]),
                }),
                card("Genres", `Of the ${plural(d.seen.length, "title")} watched`, guard(genres.length, (el) => hbars(el, { items: genres, label: `Genres watched in ${year}` })), {
                    head: ["Genre", "Titles"],
                    rows: genres.map((g) => [g.label, g.value]),
                }),
            ]),
            recordsHtml("The year's records", [
                ["Most rewatched ever", pick(d.seen, (a, b) => b.watchCount - a.watchCount), (r) => `${r.watchCount}× in all`],
                ["Lowest rated", d.rated.length >= 5 ? best[best.length - 1] : null, (r) => `${fmt(r.rating, 1)}/10`],
                ["Oldest film", pick(dated, (a, b) => a.releaseYear - b.releaseYear), (r) => `released ${r.releaseYear}`],
                ["Newest film", pick(dated, (a, b) => b.releaseYear - a.releaseYear), (r) => `released ${r.releaseYear}`],
                ["Longest film", pick(films, (a, b) => b.runtime - a.runtime), (r) => TitleModal.runtimeText(r)],
                ["Shortest film", pick(films, (a, b) => a.runtime - b.runtime), (r) => TitleModal.runtimeText(r)],
            ].map(([label, r, value]) => [label, r, r ? value(r) : ""])),
            peopleOfTheYear(d.seen).length
                ? `<section class="viz-section" aria-labelledby="rv-people">
                    <div class="viz-section-head"><h2 id="rv-people">People of the year</h2></div>
                    <div class="people">${peopleOfTheYear(d.seen)
                        .map(([label, p]) => `
                        <div class="people-col">
                            <h3>${esc(label)}</h3>
                            <div class="person is-static">
                                ${p.person.photoUrl ? `<img src="${esc(p.person.photoUrl)}" alt="" loading="lazy">` : `<span class="person-nophoto" aria-hidden="true">${esc(p.person.name[0])}</span>`}
                                <span class="person-text"><span class="person-name">${esc(p.person.name)}</span><span class="person-figures">${plural(p.titles.length, "title")} in ${year}</span></span>
                            </div>
                            <div class="person-titles">${p.titles.map((r) => posterLink(r, r.rating != null ? `${fmt(r.rating, 1)}/10` : "")).join("")}</div>
                        </div>`)
                        .join("")}</div>
                </section>`
                : "",
        ].join("");

        root.querySelectorAll("[data-year]").forEach((b) => {
            b.onclick = () => {
                year = Number(b.dataset.year);
                history.replaceState(null, "", `#review-${year}`);
                render();
            };
        });
        K.redraw();
    }

    // the year from the address (#review-2025), when the page opens on this tab
    const fromHash = Number(location.hash.match(/^#review-(\d{4})$/)?.[1]);
    if (fromHash) year = fromHash;

    K.addTab("review", {
        render,
        hero: () => hero.length && K.setHero(hero),
    });

    // titles open in the popup instead of leaving for the Watchlog
    document.getElementById("reviewRoot")?.addEventListener("click", (e) => {
        const a = e.target.closest("[data-title]");
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        const row = K.titles().find((t) => t.id === Number(a.dataset.title));
        if (!row) return;
        e.preventDefault();
        TitleModal.open(row);
    });
})();
