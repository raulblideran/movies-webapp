// Stats page: everything is worked out in the browser from /api/titles. Charts come from js/charts.js
// and take their colours from the theme, so only filters and resizes trigger a redraw.
// The page has tabs; this file owns the Collection tab and the tab switching, and shares its building
// blocks as window.StatsKit with the other tabs (js/stats-cex.js).

(function () {
    const { columns, hbars, line, divbars, donut, heatmap, scatter, legend, table, fmt, esc } = window.Charts;

    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const SLOTS = 7; // categorical colours per theme (--chart-1 … --chart-7)
    const slot = (i) => (i < SLOTS ? `var(--chart-${i + 1})` : "var(--viz-other)");
    const OTHER = "var(--viz-other)";
    const MAIN = "var(--viz-main)";
    const HI = "var(--viz-hi)";
    const TYPE_COLOR = { Film: slot(0), Series: slot(1) };

    const gbp = (n, dp = 2) =>
        n == null ? "–" : "£" + Number(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
    const pct = (n, dp = 0) => (n == null || Number.isNaN(n) ? "–" : `${fmt(n, dp)}%`);
    const sum = (xs) => xs.reduce((a, b) => a + b, 0);
    const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);
    const median = (xs) => {
        if (!xs.length) return null;
        const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
        return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    };
    const countBy = (xs, key) => {
        const m = new Map();
        for (const x of xs) {
            const k = key(x);
            m.set(k, (m.get(k) ?? 0) + 1);
        }
        return m;
    };
    const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;
    // every year from the first to the last, so gaps show as gaps instead of being squeezed out
    const yearSpan = (ys) => (ys.length ? Array.from({ length: Math.max(...ys) - Math.min(...ys) + 1 }, (_, i) => Math.min(...ys) + i) : []);

    // every title on both lists (the releases tab and the popups), and the ones you've watched, which the
    // Watchlog charts count: the Watchlog, plus watchlist titles already seen (waiting for a rewatch)
    let everything = [];
    let all = [];
    const setTitles = (rows) => {
        everything = rows.map((r) => shape({ ...r, list: r.list === "Watchlist" ? "watchlist" : "watched" }));
        all = everything.filter((r) => r.list === "watched" || r.watchCount > 0);
    };
    let genreInfo = { name: new Map(), color: new Map(), top: [] };
    const filter = { type: "all", from: null, to: null };
    // Each tab keeps the chart draw calls for its panel; only the visible tab is drawn (hidden panels have no width).
    const tabs = { collection: { draws: [], render: () => render() } };
    let target = tabs.collection.draws;
    let current = "collection";
    let seq = 0;

    // ---------- shaping the data ----------

    // "Sci-Fi" / "Sci-fi" and "Super Heroes" / "SuperHeroes" are the same genre.
    const genreKey = (g) => g.toLowerCase().replace(/[^a-z0-9]/g, "");

    function medium(formats) {
        const f = formats.join(" ").toLowerCase();
        if (!formats.length) return "Not on disc";
        if (f.includes("4k")) return "4K Blu-ray";
        if (f.includes("blu")) return "Blu-ray";
        if (f.includes("dvd")) return "DVD";
        return "Other";
    }
    function packaging(formats) {
        const f = formats.join(" ").toLowerCase();
        const kinds = [];
        if (f.includes("steelbook")) kinds.push("Steelbook");
        if (f.includes("box set")) kinds.push("Box set");
        return kinds.length ? kinds : ["Standard case"];
    }

    function shape(row) {
        // what's on the shelf comes from the title's releases: their labels, and its share of what they cost
        const formats = row.releases.map(Shelf.label);
        const d = row.firstWatch ? new Date(row.firstWatch + "T00:00:00") : null;
        const l = row.latestWatch ? new Date(row.latestWatch + "T00:00:00") : null;
        return {
            ...row,
            physicalFormats: formats,
            pricePaid: Shelf.titleShare(row),
            fy: d ? d.getFullYear() : null,
            fm: d ? d.getMonth() : null,
            ly: l ? l.getFullYear() : null,
            span: d && l ? (l - d) / (365.25 * 864e5) : null,
            // 11 means "all-time favourite"; averages count it as a 10
            r10: row.rating == null ? null : Math.min(row.rating, 10),
            fav: row.rating != null && row.rating > 10,
            gkeys: [...new Set(row.genres.map(genreKey).filter(Boolean))],
            medium: medium(formats),
            packaging: formats.length ? packaging(formats) : [],
            rewatch: row.rewatchPotential != null && row.rewatchPotential <= 10 ? row.rewatchPotential : null,
            // screen time: a film's length per watch, a series' episode length × episodes per watch
            minutes: !row.runtime || !row.watchCount ? null : row.type === "Series" ? (row.episodesTotal ? row.runtime * row.episodesTotal * row.watchCount : null) : row.runtime * row.watchCount,
        };
    }

    // "1,234 h" or "51 days" for the tile; "6 days of screen time" for the hero
    const hoursText = (min) => (min == null ? "–" : min >= 60 * 24 * 3 ? `${fmt(min / 1440, 0)} days` : `${fmt(min / 60, 0)} h`);

    // Genre names and colours come from the whole collection, so a filter never repaints a genre.
    function buildGenres() {
        const spellings = new Map();
        const counts = new Map();
        for (const r of all)
            r.genres.forEach((g) => {
                const k = genreKey(g);
                if (!k) return;
                counts.set(k, (counts.get(k) ?? 0) + 1);
                const s = spellings.get(k) ?? new Map();
                s.set(g, (s.get(g) ?? 0) + 1);
                spellings.set(k, s);
            });
        const name = new Map([...spellings].map(([k, s]) => [k, [...s].sort((a, b) => b[1] - a[1])[0][0]]));
        const top = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
        const color = new Map(top.map((k, i) => [k, slot(i)]));
        genreInfo = { name, color, top, counts };
    }

    function filtered() {
        const years = all.map((r) => r.fy).filter((y) => y != null);
        const lo = Math.min(...years), hi = Math.max(...years);
        const ranged = (filter.from != null && filter.from > lo) || (filter.to != null && filter.to < hi);
        return all.filter(
            (r) =>
                (filter.type === "all" || r.type === filter.type) &&
                (!ranged || (r.fy != null && r.fy >= (filter.from ?? lo) && r.fy <= (filter.to ?? hi))),
        );
    }

    // ---------- page building blocks ----------

    function card(title, sub, draw, { size = "", rows = null, head = null, note = "", extra = "" } = {}) {
        const id = `viz${++seq}`;
        if (draw) target.push(() => {
            const el = document.getElementById(id);
            if (el) draw(el);
        });
        return `
            <article class="viz-card ${size}">
                <header class="viz-head">
                    <h3>${esc(title)}</h3>
                    ${sub ? `<p class="viz-sub">${sub}</p>` : ""}
                </header>
                ${extra}
                <div class="viz-body" id="${id}"></div>
                ${note ? `<p class="viz-note">${note}</p>` : ""}
                ${rows && rows.length ? `<details class="viz-details"><summary>Show table</summary><div class="viz-table-wrap">${table(head, rows)}</div></details>` : ""}
            </article>`;
    }

    const section = (id, title, intro, cards) => `
        <section class="viz-section" aria-labelledby="${id}">
            <div class="viz-section-head">
                <h2 id="${id}">${esc(title)}</h2>
                ${intro ? `<p>${intro}</p>` : ""}
            </div>
            <div class="viz-grid">${cards.join("")}</div>
        </section>`;

    const empty = (el, msg = "Nothing to show for this selection.") => (el.innerHTML = `<p class="viz-empty">${esc(msg)}</p>`);
    const guard = (ok, fn, msg) => (el) => (ok ? fn(el) : empty(el, msg));

    // ---------- sections ----------

    function kpis(F) {
        const rated = F.filter((r) => r.r10 != null).map((r) => r.r10);
        const priced = F.filter((r) => r.pricePaid != null).map((r) => r.pricePaid);
        const watches = sum(F.map((r) => r.watchCount));
        const bogdan = F.filter((r) => r.withBogdan).length;
        const owned = F.filter((r) => r.physicalFormats.length).length;
        const genres = new Set(F.flatMap((r) => r.gkeys)).size;
        const rewatchOf = F.filter((r) => r.rewatch != null).map((r) => r.rewatch);
        const months = countBy(F.filter((r) => r.fy != null), (r) => r.fy * 12 + r.fm);
        const busiest = [...months].sort((a, b) => b[1] - a[1])[0];
        const perfect = F.filter((r) => r.rating === 10).length;
        const years = F.map((r) => r.fy).filter((y) => y != null);
        const tiles = [
            ["Titles", fmt(F.length), `${plural(F.filter((r) => r.type === "Film").length, "film")} · ${fmt(F.filter((r) => r.type === "Series").length)} series`],
            ["Total watches", fmt(watches), `${fmt(watches - F.filter((r) => r.watchCount > 0).length)} of them rewatches`],
            ["Average rating", fmt(mean(rated), 2), `median ${fmt(median(rated), 1)} · ${plural(rated.length, "rated title")}`],
            ["Perfect 10s", fmt(perfect), `${pct(F.length ? (perfect / F.length) * 100 : null)} of titles`],
            ["All-time favourites", fmt(F.filter((r) => r.fav).length), "rated off the scale (11/10)"],
            ["With Bogdan", pct(F.length ? (bogdan / F.length) * 100 : null), plural(bogdan, "title")],
            ["Spent", gbp(sum(priced), 0), `${gbp(mean(priced))} average · ${plural(priced.length, "priced title")}`],
            ["On disc", fmt(owned), `${pct(F.length ? (owned / F.length) * 100 : null)} of titles`],
            ["Genres", fmt(genres), `${fmt(mean(F.map((r) => r.gkeys.length)), 1)} per title`],
            ["Rewatch potential", fmt(mean(rewatchOf), 1), "average, out of 10"],
            ["Episodes", fmt(sum(F.map((r) => r.episodesTotal ?? 0))), plural(sum(F.map((r) => r.seasons ?? 0)), "season")],
            ["Time watched", hoursText(sum(F.map((r) => r.minutes ?? 0)) || null), `${fmt(sum(F.map((r) => r.minutes ?? 0)) / 60, 0)} hours · ${plural(F.filter((r) => r.minutes == null).length, "title")} without a runtime`],
            ["Busiest month", busiest ? `${MONTHS[busiest[0] % 12]} ${Math.floor(busiest[0] / 12)}` : "–", busiest ? `${plural(busiest[1], "title")} first watched` : ""],
            ["Years of watching", years.length ? fmt(Math.max(...years) - Math.min(...years) + 1) : "–", years.length ? `${Math.min(...years)}–${Math.max(...years)}` : ""],
            ["Titles a month", fmt(months.size ? sum([...months.values()]) / ((Math.max(...months.keys()) - Math.min(...months.keys())) + 1) : null, 1), "average since the first"],
        ];
        return kpiTiles(tiles);
    }

    // [label, value, sub] → tile grid
    const kpiTiles = (tiles) =>
        `<dl class="kpis">${tiles
            .map(([label, value, sub]) => `<div class="kpi"><dt>${esc(label)}</dt><dd>${esc(value)}</dd><p>${esc(sub)}</p></div>`)
            .join("")}</dl>`;

    // ---------- this year's goal (all titles, whatever the filters): watches dated this year ----------

    let goals = []; // [{ year, target }]
    const watchesIn = (year) => everything.flatMap((r) => r.watches ?? []).filter((w) => w.date?.startsWith(String(year))).length;

    function goalSection() {
        const now = new Date();
        const year = now.getFullYear();
        const goal = goals.find((g) => g.year === year);
        const canEdit = !!window.Auth?.me?.canEdit;
        if (!goal && !canEdit) return "";
        if (!goal)
            return `
            <section class="goal-card is-empty" aria-label="${year} goal">
                <p>No goal for ${year} yet. How many watches are you aiming for?</p>
                <button type="button" class="btn" data-goal-edit>Set a goal for ${year}</button>
            </section>`;
        const done = watchesIn(year);
        const start = new Date(year, 0, 1), end = new Date(year + 1, 0, 1);
        const through = (now - start) / (end - start);
        const due = goal.target * through;
        const ahead = Math.round(done - due);
        const weeksLeft = (end - now) / (7 * 864e5);
        const left = goal.target - done;
        const share = Math.min(100, (done / goal.target) * 100);
        const pace = left <= 0
            ? `Done: ${fmt(done - goal.target)} past it`
            : `${ahead === 0 ? "Right on pace" : ahead > 0 ? `${plural(ahead, "watch", "watches")} ahead of pace` : `${plural(-ahead, "watch", "watches")} behind pace`} · ${weeksLeft >= 1 ? `about ${fmt(left / weeksLeft, 1)} a week to make it` : `${plural(left, "watch", "watches")} to go`}`;
        return `
            <section class="goal-card${left <= 0 ? " is-done" : ""}" aria-label="${year} goal">
                <div class="goal-head">
                    <h2>${year} goal</h2>
                    ${canEdit ? `<button type="button" class="link" data-goal-edit>Change</button>` : ""}
                </div>
                <p class="goal-figure"><strong>${fmt(done)}</strong> of ${fmt(goal.target)} watches</p>
                <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${goal.target}" aria-valuenow="${Math.min(done, goal.target)}" aria-label="${fmt(done)} of ${fmt(goal.target)} watches">
                    <span style="width:${share.toFixed(1)}%"></span>
                    <i style="left:${(through * 100).toFixed(1)}%" title="Where you'd be on pace today"></i>
                </div>
                <p class="goal-note">${pace}</p>
            </section>`;
    }

    // whether you can set the goal is only known once sign-in has loaded
    document.addEventListener("auth-changed", () => {
        if (!tabs.collection.rendered) return;
        const html = goalSection();
        const el = document.querySelector(".goal-card");
        if (el) el.outerHTML = html || "";
        else if (html) document.getElementById("statsRoot").insertAdjacentHTML("afterbegin", html);
    });

    async function editGoal() {
        const year = new Date().getFullYear();
        const goal = goals.find((g) => g.year === year);
        const value = await Auth.confirm({
            title: `Your ${year} goal`,
            message: `How many watches in ${year}? Every watch dated this year counts, rewatches too.${goal ? " Enter 0 to remove the goal." : ""}`,
            confirmLabel: "Save",
            input: { label: "Watches", type: "number" },
        });
        if (value == null) return;
        const target = Math.round(Number(value));
        try {
            if (!target && goal) await Auth.api("DELETE", `/api/goals/${year}`);
            else if (target > 0) await Auth.api("PUT", `/api/goals/${year}`, { target });
            else return;
            goals = await Auth.api("GET", "/api/goals");
            const el = document.querySelector(".goal-card");
            if (el) el.outerHTML = goalSection() || "";
            else render();
        } catch (e) {
            Auth.showError(e.message);
        }
    }

    // ---------- you vs the crowd: your rating against TMDB users' ----------

    // titles TMDB has a meaningful score for (enough votes), and your rating, as a 10 at most
    const CROWD_VOTES = 50;
    function crowdSection(F) {
        const R = F.filter((r) => r.r10 != null && r.voteAverage != null && (r.voteCount ?? 0) >= CROWD_VOTES)
            .map((r) => ({ r, diff: Math.round((r.r10 - r.voteAverage) * 10) / 10 }));
        if (R.length < 5) return "";
        const avgDiff = mean(R.map((x) => x.diff));
        const same = R.filter((x) => Math.abs(x.diff) < 0.5).length;
        const item = (x) => ({ label: x.r.name, value: x.diff, valueLabel: `${x.diff > 0 ? "+" : ""}${fmt(x.diff, 1)}`, full: `${x.r.name}: you ${fmt(x.r.rating, 1)}, TMDB ${fmt(x.r.voteAverage, 1)}` });
        const higher = R.filter((x) => x.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 10);
        const lower = R.filter((x) => x.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 10);
        const rows = (xs) => xs.map((x) => [x.r.name, fmt(x.r.rating, 1), fmt(x.r.voteAverage, 1), `${x.diff > 0 ? "+" : ""}${fmt(x.diff, 1)}`]);
        return section("s-crowd", "You vs the crowd", `Your rating against TMDB users' average, for ${plural(R.length, "rated title")} with at least ${CROWD_VOTES} votes there (an 11 counts as a 10). On average you rate ${fmt(Math.abs(avgDiff), 1)} ${avgDiff >= 0 ? "higher" : "lower"}, and ${plural(same, "title")} land within half a point.`, [
            card("You liked more", "Your rating minus TMDB's", guard(higher.length, (el) => divbars(el, { items: higher.map(item), label: "Titles you rated above TMDB users" }), "Nothing you rated above TMDB."), {
                head: ["Title", "You", "TMDB", "Difference"],
                rows: rows(higher),
            }),
            card("You liked less", "Your rating minus TMDB's", guard(lower.length, (el) => divbars(el, { items: lower.map(item), label: "Titles you rated below TMDB users" }), "Nothing you rated below TMDB."), {
                head: ["Title", "You", "TMDB", "Difference"],
                rows: rows(lower),
            }),
        ]);
    }

    // ---------- where it's from: original language and country (TMDB) ----------

    function originSection(F) {
        const L = F.filter((r) => r.originalLanguage);
        if (L.length < 5) return "";
        const top = (counts, name, n) => {
            const sorted = [...counts].sort((a, b) => b[1] - a[1]);
            const items = sorted.slice(0, n).map(([k, v]) => ({ label: name(k), value: v, full: name(k) }));
            const rest = sum(sorted.slice(n).map(([, v]) => v));
            if (rest) items.push({ label: "Others", value: rest, full: `${plural(sorted.length - n, "other")}`, color: OTHER });
            return items;
        };
        const langs = countBy(L, (r) => r.originalLanguage);
        const countries = new Map();
        for (const r of L) for (const c of r.countries ?? []) countries.set(c, (countries.get(c) ?? 0) + 1);
        const langItems = top(langs, TitleModal.languageName, 9);
        const countryItems = top(countries, TitleModal.countryName, 11);
        const avgBy = (code) => {
            const xs = L.filter((r) => r.originalLanguage === code && r.r10 != null).map((r) => r.r10);
            return xs.length ? fmt(mean(xs), 2) : "–";
        };
        return section("s-origin", "Where it's from", `The original language and the countries of ${plural(L.length, "title")}, from TMDB. ${fmt(langs.size)} languages, ${fmt(countries.size)} countries.`, [
            card("Languages", "Titles by original language", (el) => hbars(el, { items: langItems, label: "Titles by original language" }), {
                head: ["Language", "Titles", "Average rating"],
                rows: [...langs].sort((a, b) => b[1] - a[1]).map(([k, v]) => [TitleModal.languageName(k), v, avgBy(k)]),
            }),
            card("Countries", "A title can be from more than one", (el) => hbars(el, { items: countryItems, label: "Titles by country" }), {
                head: ["Country", "Titles"],
                rows: [...countries].sort((a, b) => b[1] - a[1]).map(([k, v]) => [TitleModal.countryName(k), v]),
            }),
        ]);
    }

    function timeSection(F) {
        const W = F.filter((r) => r.fy != null);
        if (!W.length) return section("s-time", "Watching over time", "", [card("No dates", "", (el) => empty(el))]);
        const years = yearSpan(W.map((r) => r.fy));
        const perYear = years.map((y) => {
            const ys = W.filter((r) => r.fy === y);
            return { label: String(y), values: [ys.filter((r) => r.type === "Film").length, ys.filter((r) => r.type === "Series").length] };
        });
        const typeSeries = [{ name: "Films", color: TYPE_COLOR.Film }, { name: "Series", color: TYPE_COLOR.Series }];

        // every dated watch in its year: a title's first, or a rewatch (the watches with no date can't be placed)
        const watches = F.flatMap((r) => (r.watches ?? []).map((w) => ({ w, first: w.date && w.date === r.firstWatch })));
        const dated = watches.filter((x) => x.w.date);
        const undated = watches.length - dated.length;
        const watchYears = yearSpan(dated.map((x) => Number(x.w.date.slice(0, 4))));
        const watchesPerYear = watchYears.map((y) => {
            const ys = dated.filter((x) => x.w.date.startsWith(String(y)));
            return { label: String(y), values: [ys.filter((x) => x.first).length, ys.filter((x) => !x.first).length] };
        });
        const watchSeries = [{ name: "First watches", color: slot(0) }, { name: "Rewatches", color: slot(3) }];

        // cumulative, month by month
        const byMonth = countBy(W, (r) => r.fy * 12 + r.fm);
        const m0 = Math.min(...byMonth.keys()), m1 = Math.max(...byMonth.keys());
        let acc = 0;
        const cumul = [];
        for (let k = m0; k <= m1; k++) {
            acc += byMonth.get(k) ?? 0;
            const y = Math.floor(k / 12), m = k % 12;
            cumul.push({ label: `${MONTHS[m]} ${y}`, tickLabel: String(y), tick: m === 0, value: acc });
        }

        const season = MONTHS.map((m, i) => ({ label: m[0], full: m, value: W.filter((r) => r.fm === i).length }));

        const avgByYear = years.map((y) => {
            const rs = W.filter((r) => r.fy === y && r.r10 != null).map((r) => r.r10);
            return { label: String(y), value: rs.length ? mean(rs) : null, n: rs.length };
        });

        return section("s-time", "Watching over time", "Grouped by month at the finest: titles imported from the old sheet only knew the month they were watched.", [
            card("Watches per year", `Every dated watch, rewatches included${undated ? ` · ${plural(undated, "watch", "watches")} with no date left out` : ""}`, (el) => columns(el, { items: watchesPerYear, series: watchSeries, label: "Watches per year, first watches and rewatches stacked" }), {
                size: "is-wide",
                extra: legend(watchSeries),
                head: ["Year", "First watches", "Rewatches"],
                rows: watchesPerYear.map((p) => [p.label, p.values[0], p.values[1]]),
            }),
            card("Titles first watched per year", "", (el) => columns(el, { items: perYear, series: typeSeries, label: "Titles first watched per year, films and series stacked" }), {
                size: "is-wide",
                extra: legend(typeSeries),
                head: ["Year", "Films", "Series"],
                rows: perYear.map((p) => [p.label, p.values[0], p.values[1]]),
            }),
            card("Collection growth", "Running total of titles, month by month", (el) => line(el, { points: cumul, label: "Running total of titles" }), {
                head: ["Month", "Running total"],
                rows: cumul.filter((_, i) => i % 3 === 0 || i === cumul.length - 1).map((p) => [p.label, p.value]),
            }),
            card("Every month at a glance", "Titles first watched, by month and year", (el) =>
                heatmap(el, {
                    rows: MONTHS,
                    cols: years.map((y) => `'${String(y).slice(2)}`),
                    value: (ri, ci) => byMonth.get(years[ci] * 12 + ri) ?? 0,
                    tipFor: (ri, ci, v) => [plural(v, "title"), `${MONTHS[ri]} ${years[ci]}`],
                    cell: 40,
                    label: "Heatmap of titles first watched per month",
                }),
                { size: "is-wide", head: ["Year", ...MONTHS], rows: [...years].reverse().map((y) => [y, ...MONTHS.map((_, m) => byMonth.get(y * 12 + m) ?? 0)]) },
            ),
            card("Seasonality", "Which months you start the most titles, all years together", (el) => columns(el, { items: season, label: "Titles by month of the year" }), {
                head: ["Month", "Titles"],
                rows: season.map((s) => [s.full, s.value]),
            }),
            card("Getting harsher?", "Average rating of the titles first watched each year", (el) =>
                line(el, { points: avgByYear, yMin: Math.max(0, Math.floor(Math.min(...avgByYear.filter((p) => p.value != null).map((p) => p.value))) - 1), yMax: 10, area: false, dots: true, valueFmt: (v) => fmt(v, 1), label: "Average rating per year" }),
                { head: ["Year", "Average rating", "Rated titles"], rows: avgByYear.filter((p) => p.n).map((p) => [p.label, fmt(p.value, 2), p.n]) },
            ),
        ]);
    }

    function ratingSection(F) {
        const R = F.filter((r) => r.rating != null);
        const bins = Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: R.filter((r) => !r.fav && Math.round(r.rating) === i).length }));
        bins.push({ label: "11", full: "11 · all-time favourite", value: R.filter((r) => r.fav).length });
        bins.forEach((b) => (b.tip = plural(b.value, "title")));

        // rewatch potential vs rating, as bubbles (both are whole numbers, so dots would sit on top of each other)
        const pairs = countBy(R.filter((r) => r.rewatch != null), (r) => `${r.rewatch}|${Math.round(r.rating)}`);
        const bubbles = [...pairs].map(([k, n]) => {
            const [x, y] = k.split("|").map(Number);
            return { x, y, n, label: `rewatch ${x}, rating ${y}`, tipV: plural(n, "title") };
        });

        const byWatch = [
            ["Watched once", (r) => r.watchCount <= 1],
            ["Twice", (r) => r.watchCount === 2],
            ["3–4 times", (r) => r.watchCount >= 3 && r.watchCount <= 4],
            ["5+ times", (r) => r.watchCount >= 5],
        ].map(([label, test]) => {
            const rs = R.filter(test).map((r) => r.r10);
            return { label, value: mean(rs) ?? 0, valueLabel: rs.length ? `${fmt(mean(rs), 2)}  (${rs.length})` : "–", tip: rs.length ? `${fmt(mean(rs), 2)} average` : "no titles", full: `${label} · ${plural(rs.length, "title")}` };
        });

        const typeAvg = ["Film", "Series"].map((t) => {
            const rs = R.filter((r) => r.type === t).map((r) => r.r10);
            return { label: t === "Film" ? "Films" : "Series", value: mean(rs) ?? 0, valueLabel: rs.length ? `${fmt(mean(rs), 2)}  (${rs.length})` : "–", color: TYPE_COLOR[t] };
        });

        return section("s-ratings", "Ratings", "Averages count an 11 (all-time favourite) as a 10.", [
            card("Rating distribution", `${plural(R.length, "rated title")} · the 11 bar is all-time favourites`, (el) =>
                columns(el, { items: bins, highlight: (it, i) => (i === 11 ? HI : undefined), label: "Number of titles per rating" }),
                { head: ["Rating", "Titles"], rows: bins.map((b) => [b.full ?? b.label, b.value]) },
            ),
            card("Rewatch potential vs rating", "Bubble size is the number of titles", guard(bubbles.length, (el) =>
                scatter(el, { points: bubbles, bubbles: true, xDomain: [-0.6, 10.6], yDomain: [-0.6, 11.6], xTicks: [0, 2, 4, 6, 8, 10], yTicks: [0, 2, 4, 6, 8, 10], xLabel: "Rewatch potential", yLabel: "Rating", label: "Rewatch potential against rating" })),
                { head: ["Rewatch potential", "Rating", "Titles"], rows: [...bubbles].sort((a, b) => b.n - a.n).map((b) => [b.x, b.y, b.n]) },
            ),
            card("Does rewatching mean loving it?", "Average rating by how often a title was watched (count)", (el) => hbars(el, { items: byWatch, max: 10, label: "Average rating by watch count" }), {
                head: ["Watched", "Average rating"],
                rows: byWatch.map((b) => [b.label, b.valueLabel]),
            }),
            card("Films vs series", "Average rating (count)", (el) => hbars(el, { items: typeAvg, max: 10, label: "Average rating, films and series" }), {
                extra: legend([{ name: "Films", color: TYPE_COLOR.Film }, { name: "Series", color: TYPE_COLOR.Series }]),
                head: ["Type", "Average rating"],
                rows: typeAvg.map((b) => [b.label, b.valueLabel]),
            }),
        ]);
    }

    function genreSection(F) {
        const counts = countBy(F.flatMap((r) => r.gkeys), (k) => k);
        const name = (k) => genreInfo.name.get(k) ?? k;
        const top7 = genreInfo.top.slice(0, SLOTS);
        const pie = top7.map((k) => ({ label: name(k), value: counts.get(k) ?? 0, color: genreInfo.color.get(k) }));
        const otherCount = sum([...counts].filter(([k]) => !top7.includes(k)).map(([, n]) => n));
        if (otherCount) pie.push({ label: "Everything else", value: otherCount, color: OTHER });

        const avg = [...counts]
            .filter(([, n]) => n >= 3)
            .map(([k, n]) => {
                const rs = F.filter((r) => r.gkeys.includes(k) && r.r10 != null).map((r) => r.r10);
                return { label: name(k), value: mean(rs) ?? 0, valueLabel: `${fmt(mean(rs), 2)}  (${n})`, full: `${name(k)} · ${plural(n, "title")}` };
            })
            .sort((a, b) => b.value - a.value);

        const top10 = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k);
        const co = (a, b) => F.filter((r) => r.gkeys.includes(a) && r.gkeys.includes(b)).length;
        // column headings: three letters, more where two genres would read the same ("Ani"mation / "Ani"me)
        const abbr = top10.map((k, i) => {
            for (let n = 3; n < 8; n++) {
                const a = name(k).slice(0, n);
                if (!top10.some((o, j) => j !== i && name(o).slice(0, n) === a)) return a;
            }
            return name(k);
        });

        const perTitle = [1, 2, 3, 4, 5].map((n) => ({ label: n === 5 ? "5+" : String(n), value: F.filter((r) => (n === 5 ? r.gkeys.length >= 5 : r.gkeys.length === n)).length }));
        perTitle.unshift({ label: "0", value: F.filter((r) => !r.gkeys.length).length });

        // genre mix per year, stacked; same colours as the donut
        const W = F.filter((r) => r.fy != null);
        const ys = yearSpan(W.map((r) => r.fy));
        const mixSeries = [...top7.map((k) => ({ name: name(k), color: genreInfo.color.get(k) })), { name: "Everything else", color: OTHER }];
        const mix = ys.map((y) => {
            const tags = W.filter((r) => r.fy === y).flatMap((r) => r.gkeys);
            const v = top7.map((k) => tags.filter((t) => t === k).length);
            v.push(tags.filter((t) => !top7.includes(t)).length);
            return { label: String(y), values: v };
        });

        return section("s-genres", "Genres", `${plural(counts.size, "genre")} across ${plural(F.length, "title")}. Most titles have more than one, so these count genre tags, not titles.`, [
            card("Genre share", "Top seven genres, then everything else", guard(pie.length, (el) => donut(el, { items: pie, centerLabel: "genre tags", label: "Share of genre tags" })), {
                head: ["Genre", "Tags"],
                rows: [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => [name(k), n]),
            }),
            card("Best-rated genres", "Average rating (titles) · genres with 3 or more titles", guard(avg.length, (el) => hbars(el, { items: avg, max: 10, label: "Average rating per genre" })), {
                head: ["Genre", "Average rating"],
                rows: avg.map((a) => [a.label, a.valueLabel]),
            }),
            card("Genres that go together", "How many titles share each pair of the top ten genres", guard(top10.length > 1, (el) =>
                heatmap(el, {
                    rows: top10.map(name),
                    cols: abbr,
                    value: (ri, ci) => (ri === ci ? 0 : co(top10[ri], top10[ci])),
                    tipFor: (ri, ci, v) => [plural(v, "title"), `${name(top10[ri])} + ${name(top10[ci])}`],
                    rowLabelW: 92,
                    cell: 30,
                    diagonal: true,
                    label: "Genre co-occurrence matrix",
                })),
                { head: ["Genre", ...top10.map(name)], rows: top10.map((a) => [name(a), ...top10.map((b) => (a === b ? "–" : co(a, b)))]) },
            ),
            card("Genres per title", "", (el) => columns(el, { items: perTitle, label: "Number of genres on each title" }), {
                head: ["Genres", "Titles"],
                rows: perTitle.map((p) => [p.label, p.value]),
            }),
            card("Genre mix by year", "Genre tags on the titles first watched each year", guard(mix.length, (el) => columns(el, { items: mix, series: mixSeries, showMax: false, label: "Genre tags per year, stacked by genre" })), {
                size: "is-wide",
                extra: legend(mixSeries),
                head: ["Year", ...mixSeries.map((s) => s.name)],
                rows: mix.map((m) => [m.label, ...m.values]),
            }),
        ]);
    }

    function collectionSection(F) {
        const MEDIA = ["4K Blu-ray", "Blu-ray", "DVD", "Other", "Not on disc"];
        const mediaColor = { "4K Blu-ray": slot(0), "Blu-ray": slot(1), DVD: slot(2), Other: slot(3), "Not on disc": OTHER };
        const media = MEDIA.map((m) => ({ label: m, value: F.filter((r) => r.medium === m).length, color: mediaColor[m] }));
        const owned = F.filter((r) => r.physicalFormats.length);
        const pack = ["Standard case", "Steelbook", "Box set"].map((p) => ({ label: p, value: owned.filter((r) => r.packaging.includes(p)).length }));

        // where the releases came from: each release once, however many titles it holds
        const rels = [...new Map(F.flatMap((r) => r.releases).map((x) => [x.id, x])).values()];
        const places = Object.keys(Shelf.PLACES).map((k, i) => {
            const rs = rels.filter((x) => x.purchasedFrom === k);
            const priced = rs.filter((x) => x.pricePaid != null);
            const spent = sum(priced.map((x) => x.pricePaid));
            // a fixed colour per shop, so a filter never repaints one; Other stays neutral
            return { key: k, label: Shelf.PLACES[k], n: rs.length, spent, avg: priced.length ? spent / priced.length : null, priced: priced.length, color: k === "Other" ? OTHER : slot(i) };
        }).filter((p) => p.n > 0);
        const shopPie = places.map((p) => ({ label: p.label, value: p.n, color: p.color }));
        const shopSpend = places.filter((p) => p.spent > 0).sort((a, b) => b.spent - a.spent)
            .map((p) => ({ label: p.label, value: p.spent, valueLabel: `${gbp(p.spent, 0)}  (${p.priced})`, color: p.color, tip: `${gbp(p.spent)} on ${plural(p.priced, "priced release")} · ${gbp(p.avg)} average`, full: p.label }));
        const shopAvg = places.filter((p) => p.avg != null).sort((a, b) => b.avg - a.avg)
            .map((p) => ({ label: p.label, value: p.avg, valueLabel: gbp(p.avg), color: p.color, full: `${p.label} · ${plural(p.priced, "priced release")}` }));

        const P = F.filter((r) => r.pricePaid != null);
        const buckets = [[0, 2], [2, 4], [4, 6], [6, 10], [10, 15], [15, 20], [20, Infinity]];
        const hist = buckets.map(([a, b]) => ({
            label: b === Infinity ? `£${a}+` : `£${a}–${b}`,
            value: P.filter((r) => r.pricePaid >= a && r.pricePaid < b).length,
        }));
        hist.forEach((h) => (h.tip = plural(h.value, "title")));
        const maxPrice = Math.max(10, ...P.map((r) => r.pricePaid));
        const priceTicks = [0, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= maxPrice * 1.2);
        const xTop = Math.max(maxPrice, priceTicks[priceTicks.length - 1]);
        const pts = P.filter((r) => r.rating != null).map((r) => ({ x: r.pricePaid, y: r.rating, label: r.name, color: TYPE_COLOR[r.type], tipV: `${gbp(r.pricePaid)} · ${fmt(r.rating, 1)}/10` }));

        const W = P.filter((r) => r.fy != null);
        const spendYears = yearSpan(W.map((r) => r.fy));
        const spend = spendYears.map((y) => ({ label: String(y), value: sum(W.filter((r) => r.fy === y).map((r) => r.pricePaid)) }));
        spend.forEach((s) => (s.tip = gbp(s.value)));

        const value = P.filter((r) => r.pricePaid > 0 && r.r10 != null)
            .map((r) => ({ label: r.name, value: r.r10 / r.pricePaid, valueLabel: `${fmt(r.r10 / r.pricePaid, 1)} pts/£`, tip: `${fmt(r.rating, 1)}/10 for ${gbp(r.pricePaid)}`, full: r.name }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8);
        const pricey = [...P].sort((a, b) => b.pricePaid - a.pricePaid).slice(0, 8).map((r) => ({ label: r.name, value: r.pricePaid, valueLabel: gbp(r.pricePaid), full: r.name }));

        return section("s-collection", "The shelf", `${plural(owned.length, "title")} on disc, ${plural(P.length, "title")} with a price paid.`, [
            card("Format", "Best format owned for each title", (el) => donut(el, { items: media, centerLabel: "titles", label: "Titles by disc format" }), {
                head: ["Format", "Titles"],
                rows: media.map((m) => [m.label, m.value]),
            }),
            card("Where you buy", "Releases by shop", guard(shopPie.length, (el) => donut(el, { items: shopPie, centerLabel: "releases", label: "Releases by shop" })), {
                head: ["Shop", "Releases", "Spent", "Average"],
                rows: places.map((p) => [p.label, p.n, gbp(p.spent), p.avg == null ? "–" : gbp(p.avg)]),
            }),
            card("Spend by shop", "Total paid (priced releases)", guard(shopSpend.length, (el) => hbars(el, { items: shopSpend, valueFmt: (v) => gbp(v, 0), label: "Money spent per shop" })), {
                head: ["Shop", "Spent", "Priced releases"],
                rows: shopSpend.map((s) => [s.label, gbp(s.value), s.valueLabel.split("(")[1].replace(")", "")]),
            }),
            card("Average price by shop", "", guard(shopAvg.length, (el) => hbars(el, { items: shopAvg, valueFmt: (v) => gbp(v), label: "Average price paid per shop" })), {
                head: ["Shop", "Average"],
                rows: shopAvg.map((s) => [s.label, s.valueLabel]),
            }),
            card("Packaging", "Titles on disc, by case (a title can be in more than one)", guard(owned.length, (el) => hbars(el, { items: pack, label: "Titles by packaging" })), {
                head: ["Packaging", "Titles"],
                rows: pack.map((p) => [p.label, p.value]),
            }),
            card("What you pay", "Titles by price paid", guard(P.length, (el) => columns(el, { items: hist, label: "Titles by price band" })), {
                head: ["Price", "Titles"],
                rows: hist.map((h) => [h.label, h.value]),
                note: P.length ? `Median ${gbp(median(P.map((r) => r.pricePaid)))} · mean ${gbp(mean(P.map((r) => r.pricePaid)))}` : "",
            }),
            card("Price vs rating", "Does paying more buy a better film? Price on a square-root scale", guard(pts.length, (el) =>
                scatter(el, { points: pts, xDomain: [0, xTop], xSqrt: true, yDomain: [-0.5, 11.5], xTicks: priceTicks, yTicks: [0, 2, 4, 6, 8, 10], xFmt: (v) => `£${v}`, xLabel: "Price paid", yLabel: "Rating", jitter: 0.22, label: "Price paid against rating" })),
                {
                    extra: legend([{ name: "Films", color: TYPE_COLOR.Film }, { name: "Series", color: TYPE_COLOR.Series }]),
                    head: ["Title", "Price", "Rating"],
                    rows: [...pts].sort((a, b) => b.x - a.x).map((p) => [p.label, gbp(p.x), fmt(p.y, 1)]),
                },
            ),
            card("Spend per year", "Price paid, by the year a title was first watched", guard(spend.length, (el) => columns(el, { items: spend, valueFmt: (v) => `£${fmt(v)}`, label: "Money spent per year" })), {
                head: ["Year", "Spent"],
                rows: spend.map((s) => [s.label, gbp(s.value)]),
            }),
            card("Best value", "Rating points per pound", guard(value.length, (el) => hbars(el, { items: value, label: "Best value titles" })), {
                head: ["Title", "Points per £", "Detail"],
                rows: value.map((v) => [v.label, fmt(v.value, 2), v.tip]),
            }),
            card("Biggest splurges", "Highest prices paid", guard(pricey.length, (el) => hbars(el, { items: pricey, label: "Most expensive titles" })), {
                head: ["Title", "Price"],
                rows: pricey.map((p) => [p.label, p.valueLabel]),
            }),
        ]);
    }

    function rewatchSection(F) {
        const wc = [
            ["0", (n) => n === 0],
            ["1", (n) => n === 1],
            ["2", (n) => n === 2],
            ["3", (n) => n === 3],
            ["4", (n) => n === 4],
            ["5", (n) => n === 5],
            ["6–9", (n) => n >= 6 && n <= 9],
            ["10+", (n) => n >= 10],
        ].map(([label, t]) => ({ label, value: F.filter((r) => t(r.watchCount)).length }));
        wc.forEach((w) => (w.tip = plural(w.value, "title")));
        const most = [...F].filter((r) => r.watchCount > 1).sort((a, b) => b.watchCount - a.watchCount || (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 10)
            .map((r) => ({ label: r.name, value: r.watchCount, valueLabel: `${r.watchCount}×`, full: r.name }));
        const spans = [...F].filter((r) => r.span > 0.08).sort((a, b) => b.span - a.span).slice(0, 10)
            .map((r) => ({ label: r.name, value: r.span, valueLabel: r.span >= 1 ? `${fmt(r.span, 1)} yrs` : `${fmt(r.span * 12)} mo`, tip: `${r.firstWatch} → ${r.latestWatch}`, full: r.name }));
        const pot = Array.from({ length: 11 }, (_, i) => ({ label: String(i), value: F.filter((r) => r.rewatch === i).length }));
        pot.forEach((p) => (p.tip = plural(p.value, "title")));

        return section("s-rewatch", "Rewatching", "", [
            card("How many times", "Titles by watch count", (el) => columns(el, { items: wc, label: "Titles by watch count" }), { head: ["Watched", "Titles"], rows: wc.map((w) => [w.label, w.value]) }),
            card("Most rewatched", "", guard(most.length, (el) => hbars(el, { items: most, label: "Most watched titles" }), "Nothing watched more than once."), { head: ["Title", "Watches"], rows: most.map((m) => [m.label, m.value]) }),
            card("Longest comebacks", "Time between the first and the latest watch", guard(spans.length, (el) => hbars(el, { items: spans, label: "Longest gap between first and latest watch" }), "No rewatches with dates yet."), {
                head: ["Title", "Gap", "Dates"],
                rows: spans.map((s) => [s.label, s.valueLabel, s.tip]),
            }),
            card("Rewatch potential", "How likely you are to watch it again, 0–10", (el) => columns(el, { items: pot, label: "Titles by rewatch potential" }), { head: ["Potential", "Titles"], rows: pot.map((p) => [p.label, p.value]) }),
        ]);
    }

    function bogdanSection(F) {
        const B = F.filter((r) => r.withBogdan), A = F.filter((r) => !r.withBogdan);
        const W = F.filter((r) => r.fy != null);
        const share = yearSpan(W.map((r) => r.fy)).map((y) => {
            const ys = W.filter((r) => r.fy === y);
            const n = ys.filter((r) => r.withBogdan).length;
            return { label: String(y), value: ys.length ? (n / ys.length) * 100 : 0, tip: ys.length ? `${pct((n / ys.length) * 100)} · ${n} of ${ys.length}` : "nothing watched" };
        });
        const dist = (rs) => {
            const rated = rs.filter((r) => r.rating != null);
            return Array.from({ length: 12 }, (_, i) => {
                const n = rated.filter((r) => (i === 11 ? r.fav : !r.fav && Math.round(r.rating) === i)).length;
                return { label: String(i), value: rated.length ? (n / rated.length) * 100 : 0, tip: `${pct(rated.length ? (n / rated.length) * 100 : 0)} · ${plural(n, "title")}` };
            });
        };
        const dB = dist(B), dA = dist(A);
        const yMax = Math.max(...dB.map((d) => d.value), ...dA.map((d) => d.value));
        const avgB = mean(B.filter((r) => r.r10 != null).map((r) => r.r10)), avgA = mean(A.filter((r) => r.r10 != null).map((r) => r.r10));
        const g = countBy(B.flatMap((r) => r.gkeys), (k) => k);
        const gTop = [...g].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ label: genreInfo.name.get(k) ?? k, value: n }));

        const html = section("s-bogdan", "With Bogdan", `${plural(B.length, "title")} watched together: ${pct(F.length ? (B.length / F.length) * 100 : null)} of the selection.`, [
            card("Share watched together", "Of the titles first watched each year", guard(share.length, (el) => columns(el, { items: share, yMax: 100, valueFmt: (v) => `${fmt(v)}%`, label: "Share of titles watched with Bogdan per year" })), {
                head: ["Year", "With Bogdan"],
                rows: share.map((s) => [s.label, s.tip]),
            }),
            card("Ratings, together vs not", `Share of each group's rated titles · average ${fmt(avgB, 2)} together, ${fmt(avgA, 2)} otherwise`, null, {
                size: "is-wide",
                extra: `<div class="viz-pair"><div><h4>With Bogdan</h4><div class="viz-body" data-pair="b"></div></div><div><h4>Without</h4><div class="viz-body" data-pair="a"></div></div></div>`,
                head: ["Rating", "With Bogdan", "Without"],
                rows: dB.map((d, i) => [i === 11 ? "11 (favourite)" : d.label, pct(d.value, 1), pct(dA[i].value, 1)]),
            }),
            card("What you watch together", "Most common genres with Bogdan", guard(gTop.length, (el) => hbars(el, { items: gTop, label: "Top genres watched with Bogdan" })), {
                head: ["Genre", "Titles"],
                rows: gTop.map((x) => [x.label, x.value]),
            }),
        ]);
        // The paired histograms share one card (and one y scale), so they are drawn here rather than by card().
        target.push(() => {
            const b = document.querySelector('[data-pair="b"]'), a = document.querySelector('[data-pair="a"]');
            const opts = { yMax, valueFmt: (v) => `${fmt(v)}%`, height: 180, highlight: (it, i) => (i === 11 ? HI : undefined) };
            if (b) columns(b, { items: dB, label: "Rating distribution with Bogdan", ...opts });
            if (a) columns(a, { items: dA, label: "Rating distribution without Bogdan", ...opts });
        });
        return html;
    }

    function eraSection(F) {
        const Y = F.filter((r) => r.releaseYear != null);
        const decades = Y.length ? Array.from({ length: Math.floor(Math.max(...Y.map((r) => r.releaseYear)) / 10) - Math.floor(Math.min(...Y.map((r) => r.releaseYear)) / 10) + 1 }, (_, i) => Math.floor(Math.min(...Y.map((r) => r.releaseYear)) / 10) * 10 + i * 10) : [];
        const dec = decades.map((d) => ({ label: `${String(d).slice(2)}s`, full: `${d}s`, value: Y.filter((r) => Math.floor(r.releaseYear / 10) * 10 === d).length }));
        dec.forEach((d) => (d.tip = plural(d.value, "title")));
        const aged = Y.filter((r) => r.fy != null);
        const ageB = [["Same year", 0, 0], ["1–2", 1, 2], ["3–5", 3, 5], ["6–10", 6, 10], ["11–20", 11, 20], ["21–40", 21, 40], ["40+", 41, 999]];
        const ages = ageB.map(([label, a, b]) => ({ label, value: aged.filter((r) => r.fy - r.releaseYear >= a && r.fy - r.releaseYear <= b).length }));
        ages.forEach((a) => (a.tip = plural(a.value, "title")));
        const pts = Y.filter((r) => r.rating != null).map((r) => ({ x: r.releaseYear, y: r.rating, label: r.name, color: TYPE_COLOR[r.type], tipV: `${r.releaseYear} · ${fmt(r.rating, 1)}/10` }));
        const x0 = decades[0] ?? 1950, x1 = (decades[decades.length - 1] ?? 2020) + 10;
        const coverage = `Only ${fmt(Y.length)} of ${plural(F.length, "title")} have a release year so far.`;

        return section("s-era", "Release era", coverage, [
            card("Release decade", "", guard(dec.length, (el) => columns(el, { items: dec, label: "Titles by release decade" })), { head: ["Decade", "Titles"], rows: dec.map((d) => [d.full, d.value]) }),
            card("How old when you saw it", "Years between release and first watch", guard(aged.length, (el) => columns(el, { items: ages, label: "Age of titles when first watched" })), { head: ["Age", "Titles"], rows: ages.map((a) => [a.label, a.value]) }),
            card("Release year vs rating", "", guard(pts.length, (el) =>
                scatter(el, { points: pts, xDomain: [x0, x1], yDomain: [-0.5, 11.5], xTicks: decades.filter((_, i) => decades.length < 6 || i % 2 === 0), yTicks: [0, 2, 4, 6, 8, 10], xFmt: (v) => String(v), xLabel: "Released", yLabel: "Rating", jitter: 0.22, label: "Release year against rating" })),
                {
                    extra: legend([{ name: "Films", color: TYPE_COLOR.Film }, { name: "Series", color: TYPE_COLOR.Series }]),
                    head: ["Title", "Released", "Rating"],
                    rows: [...pts].sort((a, b) => a.x - b.x).map((p) => [p.label, p.x, fmt(p.y, 1)]),
                },
            ),
        ]);
    }

    function seriesSection(F) {
        const S = F.filter((r) => r.type === "Series");
        if (!S.length) return "";
        const eps = [...S].sort((a, b) => (b.episodesTotal ?? 0) - (a.episodesTotal ?? 0)).slice(0, 12).map((r) => ({
            label: r.name,
            value: r.episodesTotal ?? 0,
            valueLabel: `${fmt(r.episodesTotal ?? 0)} eps${r.seasons ? ` · ${plural(r.seasons, "season")}` : ""}`,
            color: TYPE_COLOR.Series,
            full: r.name,
        }));
        return section("s-series", "Series", `${plural(S.length, "series", "series")}, ${fmt(sum(S.map((r) => r.episodesTotal ?? 0)))} episodes in all.`, [
            card("Episodes per series", "", (el) => hbars(el, { items: eps, color: TYPE_COLOR.Series, label: "Episodes per series" }), {
                size: "is-wide",
                head: ["Series", "Episodes", "Seasons"],
                rows: S.map((r) => [r.name, r.episodesTotal ?? "–", r.seasons ?? "–"]),
            }),
        ]);
    }

    function recordsSection(F) {
        const pick = (xs, cmp) => [...xs].sort(cmp)[0];
        const rated = F.filter((r) => r.rating != null);
        const priced = F.filter((r) => r.pricePaid > 0);
        const dated = F.filter((r) => r.firstWatch);
        const recs = [
            ["Highest rated", pick(rated, (a, b) => b.rating - a.rating || b.watchCount - a.watchCount), (r) => `${fmt(r.rating, 1)}/10`],
            ["Lowest rated", pick(rated, (a, b) => a.rating - b.rating), (r) => `${fmt(r.rating, 1)}/10`],
            ["Most watched", pick(F, (a, b) => b.watchCount - a.watchCount), (r) => `${r.watchCount}×`],
            ["Best value", pick(priced.filter((r) => r.r10 != null), (a, b) => b.r10 / b.pricePaid - a.r10 / a.pricePaid), (r) => `${fmt(r.rating, 1)}/10 for ${gbp(r.pricePaid)}`],
            ["Priciest", pick(priced, (a, b) => b.pricePaid - a.pricePaid), (r) => gbp(r.pricePaid)],
            ["Oldest release", pick(F.filter((r) => r.releaseYear), (a, b) => a.releaseYear - b.releaseYear), (r) => String(r.releaseYear)],
            ["Longest film", pick(F.filter((r) => r.type === "Film" && r.runtime), (a, b) => b.runtime - a.runtime), (r) => TitleModal.runtimeText(r)],
            ["Shortest film", pick(F.filter((r) => r.type === "Film" && r.runtime), (a, b) => a.runtime - b.runtime), (r) => TitleModal.runtimeText(r)],
            ["First ever logged", pick(dated, (a, b) => a.firstWatch.localeCompare(b.firstWatch)), (r) => `${MONTHS[r.fm]} ${r.fy}`],
            ["Latest addition", pick(dated, (a, b) => b.firstWatch.localeCompare(a.firstWatch)), (r) => `${MONTHS[r.fm]} ${r.fy}`],
        ].filter(([, r]) => r);
        if (!recs.length) return "";
        return `
            <section class="viz-section" aria-labelledby="s-records">
                <div class="viz-section-head"><h2 id="s-records">Records</h2></div>
                <div class="records">${recs
                    .map(
                        ([label, r, value]) => `
                    <a class="record" href="/?title=${r.id}" data-title="${r.id}">
                        ${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(r.name)}</span>`}
                        <span class="record-text">
                            <span class="record-label">${esc(label)}</span>
                            <span class="record-name">${esc(r.name)}</span>
                            <span class="record-value">${esc(value(r))}</span>
                        </span>
                    </a>`,
                    )
                    .join("")}</div>
            </section>`;
    }

    // ---------- length ----------

    function lengthSection(F) {
        const films = F.filter((r) => r.type === "Film" && r.runtime);
        if (films.length < 3) return "";
        const bands = [["Under 1h30", 0, 89], ["1h30–1h45", 90, 105], ["1h45–2h", 106, 120], ["2h–2h15", 121, 135], ["2h15–2h30", 136, 150], ["2h30–3h", 151, 180], ["Over 3h", 181, 9999]];
        const items = bands.map(([label, lo, hi]) => ({ label, value: films.filter((r) => r.runtime >= lo && r.runtime <= hi).length }));
        const avg = mean(films.map((r) => r.runtime));
        const R = films.filter((r) => r.r10 != null);
        const byBand = bands.map(([label, lo, hi]) => {
            const xs = R.filter((r) => r.runtime >= lo && r.runtime <= hi).map((r) => r.r10);
            return [label, xs.length ? fmt(mean(xs), 2) : "–", xs.length];
        });
        return section("s-length", "Length", `Films average ${TitleModal.runtimeText({ runtime: Math.round(avg) })}. Runtimes come from TMDB.`, [
            card("Film length", plural(films.length, "film"), (el) => columns(el, { items, label: "Films by length" }), {
                head: ["Length", "Films", "Average rating"],
                rows: byBand.map(([l, a], i) => [l, items[i].value, a]),
            }),
        ]);
    }

    // ---------- people (from TMDB credits: /api/titles/people) ----------

    let credits = null; // { people: { id: { name, photoUrl } }, titles: { titleId: { directors: [ids], cast: [ids] } } }
    let peopleSort = "titles";
    let peopleOpen = null; // "directors:123": the person whose titles are showing
    let peopleF = [];

    function tally(F, role) {
        const map = new Map();
        for (const r of F) {
            const ids = credits.titles[r.id]?.[role] ?? [];
            for (const id of new Set(ids)) {
                const p = map.get(id) ?? { id, titles: [], watches: 0, ratings: [] };
                p.titles.push(r);
                p.watches += r.watchCount || 0;
                if (r.r10 != null) p.ratings.push(r.r10);
                map.set(id, p);
            }
        }
        const key = peopleSort === "watches" ? (p) => [p.watches, p.titles.length] : (p) => [p.titles.length, p.watches];
        return [...map.values()]
            .map((p) => ({ ...p, ...(credits.people[p.id] ?? { name: "?" }) }))
            .sort((a, b) => {
                const [a1, a2] = key(a), [b1, b2] = key(b);
                return b1 - a1 || b2 - a2 || (mean(b.ratings) ?? 0) - (mean(a.ratings) ?? 0) || a.name.localeCompare(b.name);
            });
    }

    function peopleList(F, role, heading, emptyText) {
        const ranked = tally(F, role).slice(0, 12);
        if (!ranked.length) return `<div class="people-col"><h3>${heading}</h3><p class="viz-empty">${emptyText}</p></div>`;
        const open = peopleOpen?.startsWith(`${role}:`) ? Number(peopleOpen.split(":")[1]) : null;
        const shown = ranked.find((p) => p.id === open);
        return `
            <div class="people-col">
                <h3>${heading}</h3>
                <ol class="people-list">${ranked
                    .map((p, i) => `
                    <li>
                        <button type="button" class="person${p.id === open ? " is-open" : ""}" data-person="${role}:${p.id}" aria-expanded="${p.id === open}">
                            <span class="person-rank">${i + 1}</span>
                            ${p.photoUrl ? `<img src="${esc(p.photoUrl)}" alt="" loading="lazy">` : `<span class="person-nophoto" aria-hidden="true">${esc(p.name.split(" ").map((w) => w[0]).slice(0, 2).join(""))}</span>`}
                            <span class="person-text">
                                <span class="person-name">${esc(p.name)}</span>
                                <span class="person-figures">${plural(p.titles.length, "title")} · ${plural(p.watches, "watch", "watches")}${p.ratings.length ? ` · avg ${fmt(mean(p.ratings), 1)}` : ""}</span>
                            </span>
                        </button>
                    </li>`)
                    .join("")}</ol>
                ${shown ? `
                <a class="link person-page-link" href="/people/${shown.id}">${esc(shown.name)}'s page: everything they've made or been in →</a>
                <div class="person-titles" aria-label="${esc(shown.name)}'s titles">
                    ${shown.titles
                        .sort((a, b) => (b.r10 ?? -1) - (a.r10 ?? -1))
                        .map((r) => `
                        <a class="record" href="${Lists.link(r)}" data-title="${r.id}">
                            ${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(r.name)}</span>`}
                            <span class="record-text">
                                <span class="record-name">${esc(r.name)}</span>
                                <span class="record-value">${r.rating != null ? `${fmt(r.rating, 1)}/10 · ` : ""}${r.watchCount}×</span>
                            </span>
                        </a>`)
                        .join("")}
                </div>` : ""}
            </div>`;
    }

    const peopleInner = (F) => `
        <div class="viz-section-head">
            <h2 id="s-people">People</h2>
            <p>Who you watch most: a film's directors (a series' creators) and its ten top-billed actors, from TMDB. Pick someone to see their titles.</p>
        </div>
        <div class="chips people-sort" role="group" aria-label="Rank people by">
            ${[["titles", "By titles"], ["watches", "By watches"]].map(([v, l]) => `<button type="button" class="chip" data-people-sort="${v}" aria-pressed="${peopleSort === v}">${l}</button>`).join("")}
        </div>
        <div class="people">
            ${peopleList(F, "directors", "Directors &amp; creators", "No directors yet: TMDB details are still being fetched.")}
            ${peopleList(F, "cast", "Actors", "No cast yet: TMDB details are still being fetched.")}
        </div>`;

    function peopleSection(F) {
        if (!credits) return "";
        peopleF = F;
        return `<section class="viz-section" aria-labelledby="s-people" id="peopleSection">${peopleInner(F)}</section>`;
    }

    function redrawPeople() {
        const el = document.getElementById("peopleSection");
        if (el) el.innerHTML = peopleInner(peopleF);
    }

    document.getElementById("statsRoot").addEventListener("click", (e) => {
        if (e.target.closest("[data-goal-edit]")) return editGoal();
        const sort = e.target.closest("[data-people-sort]");
        const person = e.target.closest("[data-person]");
        if (sort) {
            peopleSort = sort.dataset.peopleSort;
            redrawPeople();
        } else if (person) {
            peopleOpen = peopleOpen === person.dataset.person ? null : person.dataset.person;
            redrawPeople();
        }
    });

    function qualitySection(F) {
        const n = F.length || 1;
        const fields = [
            ["First watch", (r) => r.firstWatch],
            ["Rating", (r) => r.rating != null],
            ["Genres", (r) => r.genres.length],
            ["Poster", (r) => r.posterUrl],
            ["Rewatch potential", (r) => r.rewatchPotential != null],
            ["Disc format", (r) => r.physicalFormats.length],
            ["Price paid", (r) => r.pricePaid != null],
            ["Comments", (r) => r.comments],
            ["Release year", (r) => r.releaseYear != null],
        ].map(([label, has]) => {
            const c = F.filter(has).length;
            return { label, value: (c / n) * 100, valueLabel: pct((c / n) * 100), tip: `${c} of ${F.length}`, full: label };
        }).sort((a, b) => b.value - a.value);
        return section("s-quality", "About the data", "", [
            card("How complete is it", "Share of titles with each field filled in", (el) => hbars(el, { items: fields, max: 100, label: "Field completeness" }), {
                head: ["Field", "Filled", "Titles"],
                rows: fields.map((f) => [f.label, f.valueLabel, f.tip]),
            }),
        ]);
    }

    // ---------- filters ----------

    function renderFilters() {
        const years = [...new Set(all.map((r) => r.fy).filter((y) => y != null))].sort();
        const el = document.getElementById("statsFilters");
        const opt = (y, sel) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}</option>`;
        el.innerHTML = `
            <div class="chips" role="group" aria-label="Type">
                ${[["all", "Everything"], ["Film", "Films"], ["Series", "Series"]].map(([v, l]) => `<button type="button" class="chip" data-type="${v}" aria-pressed="${filter.type === v}">${l}</button>`).join("")}
            </div>
            <label class="stats-range"><span class="label">First watched from</span>
                <select class="input" data-year="from">${years.map((y) => opt(y, filter.from ?? years[0])).join("")}</select></label>
            <label class="stats-range"><span class="label">to</span>
                <select class="input" data-year="to">${years.map((y) => opt(y, filter.to ?? years[years.length - 1])).join("")}</select></label>
            <button type="button" class="btn btn-small" id="resetFilters">Reset</button>
            <span class="result-count" id="statsCount" aria-live="polite"></span>`;
        el.querySelectorAll("[data-type]").forEach((b) =>
            b.addEventListener("click", () => {
                filter.type = b.dataset.type;
                el.querySelectorAll("[data-type]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
                render();
            }),
        );
        // select.js swaps each <select> for a themed button but keeps the native one and its "change" events.
        // When one end of the range pushes the other, the filters are redrawn so both show the new values.
        const from = el.querySelector('select[data-year="from"]'), to = el.querySelector('select[data-year="to"]');
        from.addEventListener("change", () => {
            filter.from = +from.value;
            const clamp = filter.to != null && filter.to < filter.from;
            if (clamp) filter.to = filter.from;
            if (clamp) renderFilters();
            render();
        });
        to.addEventListener("change", () => {
            filter.to = +to.value;
            const clamp = filter.from != null && filter.from > filter.to;
            if (clamp) filter.from = filter.to;
            if (clamp) renderFilters();
            render();
        });
        el.querySelector("#resetFilters").addEventListener("click", () => {
            filter.type = "all";
            filter.from = filter.to = null;
            renderFilters();
            render();
        });
    }

    // ---------- render ----------

    // [[value, label], …] into the marquee
    const setHero = (stats) =>
        (document.getElementById("stats").innerHTML = stats.map(([v, l]) => `<div class="stat"><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`).join(""));

    function heroStats(F) {
        const rated = F.filter((r) => r.r10 != null).map((r) => r.r10);
        setHero([
            [fmt(F.length), "titles"],
            [fmt(sum(F.map((r) => r.watchCount))), "watches"],
            [rated.length ? mean(rated).toFixed(2) : "–", "avg rating"],
            [fmt(new Set(F.flatMap((r) => r.gkeys)).size), "genres"],
        ]);
    }

    function render() {
        const F = filtered();
        target = tabs.collection.draws = [];
        heroStats(F);
        const count = document.getElementById("statsCount");
        if (count) count.textContent = F.length === all.length ? `All ${plural(all.length, "title")}` : `${fmt(F.length)} of ${plural(all.length, "title")}`;
        document.getElementById("statsRoot").innerHTML = F.length
            ? [goalSection(), kpis(F), timeSection(F), ratingSection(F), crowdSection(F), genreSection(F), originSection(F), peopleSection(F), collectionSection(F), rewatchSection(F), bogdanSection(F), eraSection(F), lengthSection(F), seriesSection(F), recordsSection(F), qualitySection(F)].join("")
            : `<div class="empty"><h2>Nothing matches</h2><p class="muted">Try a wider year range or a different type.</p></div>`;
        drawAll();
    }

    const drawAll = () => tabs[current].draws.forEach((d) => d());

    // ---------- tabs ----------

    // Start drawing a tab's charts into a fresh list (called by a tab's render before it builds cards).
    function beginTab(name) {
        tabs[name].draws = [];
        target = tabs[name].draws;
    }

    function showTab(name, { push = true } = {}) {
        if (!tabs[name]) name = "collection";
        current = name;
        document.querySelectorAll("[data-tab]").forEach((b) => {
            const on = b.dataset.tab === name;
            b.setAttribute("aria-selected", String(on));
            b.tabIndex = on ? 0 : -1;
            document.getElementById(b.getAttribute("aria-controls")).hidden = !on;
        });
        if (push) history.replaceState(null, "", name === "collection" ? location.pathname + location.search : `#${name}`);
        if (!tabs[name].rendered) {
            tabs[name].rendered = true;
            tabs[name].render();
        } else {
            tabs[name].hero?.();
            drawAll();
        }
        if (name === "collection") heroStats(filtered());
    }

    function initTabs() {
        const buttons = [...document.querySelectorAll("[data-tab]")];
        buttons.forEach((b, i) => {
            b.addEventListener("click", () => showTab(b.dataset.tab));
            b.addEventListener("keydown", (e) => {
                const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
                if (next == null) return;
                const t = buttons[(next + buttons.length) % buttons.length];
                t.focus();
                showTab(t.dataset.tab);
            });
        });
    }

    // Redraw at the new width when the layout changes size (charts are drawn in pixels, not stretched).
    let lastWidth = 0, pending;
    new ResizeObserver(([entry]) => {
        const w = Math.round(entry.contentRect.width);
        if (Math.abs(w - lastWidth) < 4) return;
        lastWidth = w;
        clearTimeout(pending);
        pending = setTimeout(drawAll, 120);
    }).observe(document.querySelector(".stats-page"));

    // ---------- a title, and its releases, over the page ----------

    // A record opens its title's popup here (js/title-modal.js) instead of leaving for the watchlog;
    // the releases listed on it open over it (js/release-dialogs.js).
    const releaseCache = new Map();
    async function fetchRelease(id) {
        const resp = await fetch(`/api/releases/${id}`, { cache: "no-store" });
        if (!resp.ok) return null;
        const r = await resp.json();
        releaseCache.set(id, r);
        return r;
    }
    const releaseCtx = {
        titles: () => new Map(everything.map((t) => [t.id, t])),
        find: (id) => releaseCache.get(id),
        // after an edit or delete: fresh numbers, and the title popup underneath shown as it is now
        async onChanged(saved) {
            const resp = await fetch("/api/titles", { cache: "no-store" });
            if (resp.ok) {
                setTitles(await resp.json());
                if (current === "collection") render();
                const shown = TitleModal.current();
                const row = shown && everything.find((t) => t.id === shown.id);
                if (row) TitleModal.open(row);
            }
            return saved ? fetchRelease(saved.id) : null;
        },
        openTitle(id) {
            const row = everything.find((t) => t.id === id);
            if (row) TitleModal.open(row, { front: true });
        },
    };
    TitleModal.configure({
        lookup: (type, id) => everything.find((t) => t.tmdbId === id && t.tmdbMediaType === type),
        // a watch changed in the popup: the numbers as they are now
        async onTitleChanged() {
            const resp = await fetch("/api/titles", { cache: "no-store" });
            if (!resp.ok) return;
            setTitles(await resp.json());
            if (current === "collection") render();
        },
        lookupTitle: (id) => everything.find((t) => t.id === id),
        async showRelease(id) {
            const r = await fetchRelease(id);
            if (r) ReleaseDialogs.open(r, releaseCtx);
        },
    });
    document.getElementById("statsRoot").addEventListener("click", (e) => {
        const a = e.target.closest("[data-title]");
        if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // new tab: the watchlog
        const row = everything.find((t) => t.id === Number(a.dataset.title));
        if (!row) return;
        e.preventDefault();
        TitleModal.open(row);
    });

    async function load() {
        const overlay = document.getElementById("loadingOverlay");
        try {
            // people are a nice-to-have: the page draws without them
            const people = fetch("/api/titles/people", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            const goalList = fetch("/api/goals", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
            const resp = await fetch("/api/titles", { cache: "no-store" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            setTitles(await resp.json());
            credits = await people;
            goals = await goalList;
            buildGenres();
            renderFilters();
            tabs.collection.rendered = true;
            render();
            initTabs();
            // #cex: the Releases tab's old name; #review-2025: Year in review on that year
            const wanted = location.hash.slice(1) === "cex" ? "releases" : location.hash.slice(1).replace(/-\d{4}$/, "");
            if (tabs[wanted] && wanted !== "collection") showTab(wanted, { push: location.hash === "#cex" });
        } catch (e) {
            document.getElementById("statsRoot").innerHTML = `<div class="empty"><h2>Couldn't load the watchlog</h2><p class="muted">${esc(e.message)}</p></div>`;
        } finally {
            overlay.classList.add("hidden");
        }
    }

    window.StatsKit = {
        card, section, empty, guard, kpiTiles, setHero, beginTab, slot, OTHER, MAIN, HI, MONTHS,
        gbp, pct, sum, mean, median, plural, countBy, yearSpan,
        titles: () => everything,
        watched: () => all,
        credits: () => credits,
        goals: () => goals,
        hoursText,
        addTab: (name, tab) => (tabs[name] = { draws: [], ...tab }),
        redraw: () => drawAll(),
    };

    load();
})();
