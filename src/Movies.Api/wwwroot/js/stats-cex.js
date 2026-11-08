// Stats page, Releases tab: every release on the shelf, what it cost and where it came from, and what the ones
// with a CeX link would fetch at CeX, wherever they were bought. Current prices and the value-over-time line come
// from the server's daily price snapshots (/api/cex/history). Then the discs traded in or sold: where they went,
// what came back, whether CeX paid its own price on the day, and how long they were kept. Built from the blocks
// js/stats.js shares as window.StatsKit.

(function () {
    const K = window.StatsKit;
    const { columns, hbars, lines, divbars, dumbbell, donut, scatter, heatmap, legend, fmt, esc } = window.Charts;
    const { card, section, empty, guard, gbp, pct, sum, mean, median, plural, slot, OTHER, MONTHS } = K;

    // one colour per measure, used the same way on every chart in this tab
    const M = {
        paid: { name: "Paid", color: slot(0) },
        cash: { name: "Cash", color: slot(1) },
        voucher: { name: "Voucher", color: slot(2) },
        sell: { name: "CeX sells for", color: slot(3) },
        back: { name: "Got back", color: slot(4) },
    };
    // where the sold ones went: CeX and eBay keep the colours they have as shops
    const CHANNEL_COLOR = { Cex: slot(0), Ebay: slot(2), FacebookMarketplace: slot(5), Other: OTHER };
    const DAY = 864e5;
    const dayNo = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
    // a length of time in days, as "1 year 4 months", "5 months", "12 days"
    function keptText(days) {
        if (days == null) return "–";
        if (days < 31) return plural(Math.round(days), "day");
        const months = Math.round(days / 30.44), y = Math.floor(months / 12), m = months % 12;
        return [y ? plural(y, "year") : "", m ? plural(m, "month") : ""].filter(Boolean).join(" ");
    }
    const signed = (n) => (n == null ? "–" : `${n < 0 ? "−" : "+"}${gbp(Math.abs(n))}`);
    const day = (iso) => {
        const [y, m, d] = iso.split("-").map(Number);
        return `${d} ${MONTHS[m - 1]} ${y}`;
    };
    // a round number at or below n, for an axis that doesn't start at zero
    const floorTo = (n) => {
        const step = 10 ** Math.floor(Math.log10(Math.max(n, 1)));
        return Math.max(0, Math.floor(n / step) * step);
    };

    let history = null; // [{ sku, boxName, category, points: [{ date, sell, cash, exchange }] }]
    let priceSort = "gain"; // the "Paid vs CeX's price" chart's order
    let priceDraw = null; // and how to draw it again in a new order
    let releases = null; // /api/releases
    let hero = [];
    const PLACES = Shelf.PLACES;

    // One row per release (a box set once, however many titles it holds). Every release on the shelf with a CeX
    // link that CeX has prices for counts towards the trade values, wherever it was bought; two copies count
    // twice. Traded in or sold ones (.sold) carry the sale, and CeX's prices nearest the day it went (.offer).
    function build() {
        const bySku = new Map(history.map((h) => [h.sku, h]));
        const titles = new Map(K.titles().map((t) => [t.id, t]));
        const sameName = new Map();
        for (const r of releases) sameName.set(r.name, (sameName.get(r.name) ?? 0) + 1);
        return releases.map((r) => {
            const h = r.cexSku ? bySku.get(r.cexSku) : null;
            const points = h?.points ?? [];
            const last = points[points.length - 1], first = points[0];
            const sold = !!r.soldVia;
            const near = sold ? Shelf.nearestPoint(points, r.soldOn) : null;
            return {
                id: r.id,
                // copies of the same title read "A Silent Voice (DVD)", "A Silent Voice (Blu-ray)"
                name: sameName.get(r.name) > 1 ? `${r.name} (${Shelf.label(r)})` : r.name,
                cexName: h?.boxName ?? r.cexBoxName,
                format: Shelf.label(r),
                rawFormat: r.format,
                edition: r.edition,
                place: r.purchasedFrom,
                atCex: r.purchasedFrom === "Cex",
                titles: r.titleIds.map((id) => titles.get(id)).filter(Boolean),
                paid: r.pricePaid ?? 0,
                priced: r.pricePaid != null,
                linked: !!r.cexSku,
                category: h?.category ?? (r.cexSku ? "Not priced yet" : "No CeX link"),
                points,
                latest: last ?? null,
                first: first ?? null,
                cashChange: last && first && last !== first ? last.cash - first.cash : null,
                // traded in or sold
                sold,
                channel: r.soldVia,
                soldOn: r.soldOn,
                got: r.soldFor,
                payout: r.payout,
                net: Shelf.saleNet(r),
                back: r.soldFor != null && r.pricePaid > 0 ? r.soldFor / r.pricePaid : null,
                keptDays: r.boughtOn && r.soldOn ? dayNo(r.soldOn) - dayNo(r.boughtOn) : null,
                // CeX's offer then: voucher for a voucher trade-in, otherwise cash
                offer: near ? { ...near, value: r.payout === "Voucher" ? near.point.exchange : near.point.cash } : null,
            };
        });
    }

    // Daily totals; an item missing on a day carries its last known price forward.
    function totalsByDay(items) {
        const dates = [...new Set(items.flatMap((i) => i.points.map((p) => p.date)))].sort();
        const known = new Map();
        const at = new Map(items.map((i) => [i.id, new Map(i.points.map((p) => [p.date, p]))]));
        return dates.map((date) => {
            for (const i of items) {
                const p = at.get(i.id).get(date);
                if (p) known.set(i.id, p);
            }
            const ps = [...known.values()];
            return { date, sell: sum(ps.map((p) => p.sell)), cash: sum(ps.map((p) => p.cash)), exchange: sum(ps.map((p) => p.exchange)), n: ps.length };
        });
    }

    function render() {
        K.beginTab("releases");
        const root = document.getElementById("releasesRoot");
        const ALL = build();
        if (!ALL.length) {
            root.innerHTML = `<div class="empty"><h2>No releases yet</h2><p class="muted">Add the discs on your shelf on the releases page and they show up here.</p></div>`;
            return;
        }
        // everything above "Traded in and sold" is what's on the shelf now
        const A = ALL.filter((i) => !i.sold), S = ALL.filter((i) => i.sold);
        const I = A.filter((i) => i.latest); // the ones CeX has prices for
        const linked = A.filter((i) => i.linked);
        const waiting = linked.length - I.length;
        const titleCount = new Set(A.flatMap((i) => i.titles.map((t) => t.id))).size;
        const atCex = A.filter((i) => i.atCex), elsewhere = A.filter((i) => !i.atCex);
        const paidAll = sum(A.map((i) => i.paid));

        const valued = I.length > 0;
        const paidValued = sum(I.map((i) => i.paid));
        const cash = sum(I.map((i) => i.latest.cash)), voucher = sum(I.map((i) => i.latest.exchange)), sell = sum(I.map((i) => i.latest.sell));
        const priced = I.filter((i) => i.priced && i.paid > 0);
        const gainers = priced.filter((i) => i.latest.cash > i.paid);
        const best = [...I].sort((a, b) => b.latest.cash - a.latest.cash)[0];
        const lastDate = valued ? I.map((i) => i.latest.date).sort().pop() : null;
        const firstDate = valued ? I.map((i) => i.first.date).sort()[0] : null;
        const margins = I.filter((i) => i.latest.sell > 0).map((i) => (i.latest.sell - i.latest.cash) / i.latest.sell);

        hero = [[fmt(A.length), "on the shelf"], [gbp(paidAll, 0), "paid"], [gbp(cash, 0), "cash"], [gbp(voucher, 0), "voucher"]];
        if (S.length) hero.push([gbp(sum(S.map((i) => i.got ?? 0)), 0), "back"]);
        K.setHero(hero);

        const tiles = [
            ["On the shelf", fmt(A.length), `${plural(titleCount, "title")} on them${S.length ? ` · ${fmt(S.length)} more gone` : ""}`],
            ["Paid for them all", gbp(paidAll), `${plural(A.filter((i) => i.priced).length, "release")} with a price`],
            ["Bought at CeX", fmt(atCex.length), `${gbp(sum(atCex.map((i) => i.paid)))} paid`],
            ["Bought elsewhere", fmt(elsewhere.length), `${gbp(sum(elsewhere.map((i) => i.paid)))} paid`],
            ["With a CeX link", fmt(linked.length), `${fmt(I.length)} priced by CeX${waiting ? ` · ${waiting} not yet` : ""}`],
        ];
        if (valued)
            tiles.push(
                ["Cash if sold today", gbp(cash), `${pct(paidValued ? (cash / paidValued) * 100 : null)} of what those cost`],
                ["Voucher if sold today", gbp(voucher), `${pct(paidValued ? (voucher / paidValued) * 100 : null)} of what those cost`],
                ["CeX sells them for", gbp(sell), "what it would cost to buy them all again"],
                ["Cash vs paid", signed(cash - paidValued), `on the ${plural(I.length, "release")} with a CeX price`],
                ["Voucher vs paid", signed(voucher - paidValued), voucher >= paidValued ? "you'd come out ahead" : "you'd be out of pocket"],
                ["Voucher bonus", gbp(voucher - cash), `${pct(cash ? ((voucher - cash) / cash) * 100 : null)} more than cash`],
                ["CeX's cut", pct(mean(margins) * 100), "average gap between their price and cash"],
                ["Worth more than paid", fmt(gainers.length), `of ${plural(priced.length, "priced release")}, in cash`],
                ["Most valuable", best ? gbp(best.latest.cash) : "–", best ? best.name : ""],
                ["Average cash per release", gbp(mean(I.map((i) => i.latest.cash))), `median ${gbp(median(I.map((i) => i.latest.cash)))}`],
                ["Prices from", day(lastDate).replace(/ \d{4}$/, ""), firstDate === lastDate ? `${lastDate.slice(0, 4)} · tracking started that day` : `${lastDate.slice(0, 4)} · tracked since ${day(firstDate)}`],
            );

        root.innerHTML = [
            K.kpiTiles(tiles),
            ...(A.length
                ? [
                      shopSection(A),
                      formatSection(A),
                      valueSection(A),
                      concentrationSection(A, I),
                      valued ? timeSection(I, totalsByDay(I), paidValued) : "",
                      valued ? priceSection(priced) : "",
                      valued ? sellSection(I, priced, { cash, voucher, sell, paidCex: paidValued }) : section("c-sell", "CeX trade values", linked.length
                          ? `The server checks CeX for the ${plural(linked.length, "release")} on the shelf with a CeX link a couple of minutes after it starts, then every day. Come back shortly.`
                          : "Add CeX links to releases (wherever you bought them) to see what CeX would pay for them.", []),
                      valued ? worthSection(I) : "",
                      tableSection(A),
                  ]
                : [section("c-shelf", "On the shelf", "Nothing: every release has been traded in or sold.", [])]),
            soldSection(S, ALL),
        ].join("");
        K.redraw();
    }

    // where the releases came from, and (for the ones with a CeX price) what they'd fetch now
    function shopSection(A) {
        const shops = Object.keys(PLACES).map((k, n) => {
            const rs = A.filter((i) => i.place === k);
            const v = rs.filter((i) => i.latest);
            return { key: k, label: PLACES[k], color: k === "Other" ? OTHER : slot(n), n: rs.length, paid: sum(rs.map((i) => i.paid)), valued: v.length, paidValued: sum(v.map((i) => i.paid)), cash: sum(v.map((i) => i.latest.cash)), voucher: sum(v.map((i) => i.latest.exchange)) };
        }).filter((s) => s.n > 0);
        const counts = shops.map((s) => ({ label: s.label, value: s.n, color: s.color }));
        const worth = shops.filter((s) => s.valued).sort((a, b) => b.cash - a.cash)
            .map((s) => ({ label: s.label, value: s.cash, valueLabel: `${gbp(s.cash, 0)} cash · ${gbp(s.paidValued, 0)} paid`, color: s.color, tip: `${plural(s.valued, "release")} with a CeX price: paid ${gbp(s.paidValued)}, cash ${gbp(s.cash)}, voucher ${gbp(s.voucher)}`, full: s.label }));
        return section("c-shops", "Where they came from", "The releases on the shelf now, by the shop they came from.", [
            card("Releases by shop", "", (el) => donut(el, { items: counts, centerLabel: "releases", label: "Releases by shop" }), {
                head: ["Shop", "Releases", "Paid"],
                rows: shops.map((s) => [s.label, s.n, gbp(s.paid)]),
            }),
            card("What each shop's buys would fetch", "Cash at CeX today, against what you paid for them (releases with a CeX price)", guard(worth.length, (el) => hbars(el, { items: worth, valueFmt: (v) => gbp(v, 0), label: "Cash value of releases by shop" }), "No CeX prices yet."), {
                head: ["Shop", "With a CeX price", "Paid", "Cash", "Voucher"],
                rows: shops.map((s) => [s.label, s.valued, gbp(s.paidValued), gbp(s.cash), gbp(s.voucher)]),
            }),
        ]);
    }

    // ---------- formats and editions ----------

    function formatSection(A) {
        const F = Object.keys(Shelf.FORMATS), E = Object.keys(Shelf.EDITIONS), P = Object.keys(PLACES);
        const count = (pred) => A.filter(pred).length;
        const usedP = P.filter((p) => count((i) => i.place === p));
        const fmtColor = (k) => slot(Shelf.FORMAT_SLOT[k]); // a colour per format, as on the release chips and the Watchlog tab

        const byFormat = F.map((k) => {
            const rs = A.filter((i) => i.rawFormat === k);
            const priced = rs.filter((i) => i.priced);
            const spent = sum(priced.map((i) => i.paid));
            return { k, label: Shelf.FORMATS[k], n: rs.length, priced: priced.length, spent, avg: priced.length ? spent / priced.length : null, median: median(priced.map((i) => i.paid)) };
        }).filter((f) => f.n);
        const spend = byFormat.map((f) => ({ label: f.label, value: f.spent, valueLabel: `${gbp(f.spent, 0)}  (${f.priced})`, color: fmtColor(f.k), tip: `${gbp(f.spent)} on ${plural(f.priced, "priced release")}`, full: f.label }));
        const avg = byFormat.filter((f) => f.avg != null).map((f) => ({ label: f.label, value: f.avg, valueLabel: `${gbp(f.avg)} · median ${gbp(f.median)}`, color: fmtColor(f.k), full: f.label }));

        // every priced release as a dot on its format's row
        const fmts = byFormat.map((f) => f.k);
        const strip = A.filter((i) => i.priced).map((i) => ({ x: i.paid, y: fmts.length - 1 - fmts.indexOf(i.rawFormat), label: i.name, color: fmtColor(i.rawFormat), tipV: `${gbp(i.paid)} · ${i.format}` }));
        const maxPaid = Math.max(10, ...strip.map((p) => p.x));
        const ticks = [0, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= maxPaid * 1.2);

        return section("c-formats", "Formats and editions", "On the shelf now, counted per release: a box set is one release however many titles it holds.", [
            card("Format × edition", "How many releases of each kind", (el) =>
                heatmap(el, {
                    rows: F.map((k) => Shelf.FORMATS[k]),
                    cols: E.map((k) => Shelf.EDITIONS[k]),
                    value: (ri, ci) => count((i) => i.rawFormat === F[ri] && i.edition === E[ci]),
                    tipFor: (ri, ci, v) => [plural(v, "release"), `${Shelf.FORMATS[F[ri]]} · ${Shelf.EDITIONS[E[ci]]}`],
                    rowLabelW: 86,
                    cell: 64,
                    colLabelEvery: 1,
                    label: "Releases by format and edition",
                }),
                { head: ["Format", ...E.map((k) => Shelf.EDITIONS[k])], rows: F.map((f) => [Shelf.FORMATS[f], ...E.map((e) => count((i) => i.rawFormat === f && i.edition === e))]) },
            ),
            card("Shop × format", "Where each format came from", guard(usedP.length, (el) =>
                heatmap(el, {
                    rows: usedP.map((k) => PLACES[k]),
                    cols: F.map((k) => Shelf.FORMATS[k].replace(" Blu-ray", "")),
                    value: (ri, ci) => count((i) => i.place === usedP[ri] && i.rawFormat === F[ci]),
                    tipFor: (ri, ci, v) => [plural(v, "release"), `${PLACES[usedP[ri]]} · ${Shelf.FORMATS[F[ci]]}`],
                    rowLabelW: 112,
                    cell: 64,
                    colLabelEvery: 1,
                    label: "Releases by shop and format",
                })),
                { head: ["Shop", ...F.map((k) => Shelf.FORMATS[k])], rows: usedP.map((p) => [PLACES[p], ...F.map((f) => count((i) => i.place === p && i.rawFormat === f))]) },
            ),
            card("Spend by format", "Total paid (priced releases)", guard(spend.length, (el) => hbars(el, { items: spend, valueFmt: (v) => gbp(v, 0), label: "Money spent per format" })), {
                head: ["Format", "Spent", "Priced releases"],
                rows: byFormat.map((f) => [f.label, gbp(f.spent), f.priced]),
            }),
            card("Average price by format", "", guard(avg.length, (el) => hbars(el, { items: avg, valueFmt: (v) => gbp(v), label: "Average price per format" })), {
                head: ["Format", "Average", "Median"],
                rows: byFormat.filter((f) => f.avg != null).map((f) => [f.label, gbp(f.avg), gbp(f.median)]),
            }),
            card("Every price, by format", "Each dot is a release · price on a square-root scale", guard(strip.length, (el) =>
                scatter(el, { points: strip, xDomain: [0, Math.max(maxPaid, ticks[ticks.length - 1])], xSqrt: true, yDomain: [-0.7, fmts.length - 0.3], xTicks: ticks, yTicks: fmts.map((_, n) => n), xFmt: (v) => `£${v}`, yFmt: (v) => Shelf.FORMATS[fmts[fmts.length - 1 - v]] ?? "", xLabel: "Paid", yLabel: "", jitter: 0.28, yLabelW: 86, height: 70 + fmts.length * 60, label: "Price paid per release, by format" })),
                { size: "is-wide", head: ["Release", "Format", "Paid"], rows: A.filter((i) => i.priced).sort((a, b) => b.paid - a.paid).map((i) => [i.name, i.format, gbp(i.paid)]) },
            ),
        ]);
    }

    // ---------- box sets and value for money ----------

    function valueSection(A) {
        const sizes = [1, 2, 3, 4].map((n) => {
            const v = A.filter((i) => (n === 4 ? i.titles.length >= 4 : i.titles.length === n)).length;
            return { label: n === 4 ? "4+" : String(n), value: v, tip: plural(v, "release") };
        });
        sizes.unshift({ label: "0", value: A.filter((i) => !i.titles.length).length, tip: "releases with no title linked" });

        const perTitle = (rs) => {
            const priced = rs.filter((i) => i.priced && i.titles.length);
            const titles = sum(priced.map((i) => i.titles.length));
            return { n: priced.length, titles, value: titles ? sum(priced.map((i) => i.paid)) / titles : null };
        };
        const sets = perTitle(A.filter((i) => i.titles.length > 1)), singles = perTitle(A.filter((i) => i.titles.length === 1));
        const setVsSingle = [
            { label: "Box sets & collections", value: sets.value ?? 0, valueLabel: sets.value == null ? "–" : `${gbp(sets.value)} a title`, color: slot(0), tip: `${plural(sets.n, "priced release")}, ${plural(sets.titles, "title")}`, full: "Releases with more than one title" },
            { label: "Single releases", value: singles.value ?? 0, valueLabel: singles.value == null ? "–" : `${gbp(singles.value)} a title`, color: slot(1), tip: `${plural(singles.n, "priced release")}`, full: "Releases with one title" },
        ];

        // what each watch has cost: the price over every watch of every title on the release
        const perWatch = A.filter((i) => i.priced && i.paid > 0 && i.titles.length)
            .map((i) => {
                const watches = sum(i.titles.map((t) => Math.max(1, t.watchCount || 0)));
                return { i, watches, cpw: i.paid / watches };
            });
        const cheapest = [...perWatch].sort((a, b) => a.cpw - b.cpw).slice(0, 10)
            .map(({ i, watches, cpw }) => ({ label: i.name, value: cpw, valueLabel: `${gbp(cpw)} a watch`, tip: `${gbp(i.paid)} over ${plural(watches, "watch", "watches")}`, full: i.name }));
        const dearest = [...perWatch].sort((a, b) => b.cpw - a.cpw).slice(0, 10)
            .map(({ i, watches, cpw }) => ({ label: i.name, value: cpw, valueLabel: `${gbp(cpw)} a watch`, tip: `${gbp(i.paid)} over ${plural(watches, "watch", "watches")}`, full: i.name }));

        // the genres on the shelf, each release once per genre
        const genres = new Map();
        for (const i of A) for (const g of new Set(i.titles.flatMap((t) => t.genres.map((x) => x.trim())).filter(Boolean)))
            genres.set(g.toLowerCase(), { name: genres.get(g.toLowerCase())?.name ?? g, n: (genres.get(g.toLowerCase())?.n ?? 0) + 1 });
        const topGenres = [...genres.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((g) => ({ label: g.name, value: g.n }));

        return section("c-value", "Box sets and value", "The releases on the shelf now.", [
            card("Titles per release", "Box sets and collections hold more than one", (el) => columns(el, { items: sizes, label: "Releases by number of titles" }), {
                head: ["Titles", "Releases"],
                rows: sizes.map((s) => [s.label, s.value]),
            }),
            card("Cost per title", "Box sets against single releases (priced releases)", (el) => hbars(el, { items: setVsSingle, label: "Average price per title, box sets and singles" }), {
                head: ["", "Per title", "Priced releases", "Titles"],
                rows: [["Box sets & collections", sets.value == null ? "–" : gbp(sets.value), sets.n, sets.titles], ["Single releases", singles.value == null ? "–" : gbp(singles.value), singles.n, singles.titles]],
            }),
            card("Cheapest per watch", "Price over every watch of its titles", guard(cheapest.length, (el) => hbars(el, { items: cheapest, valueFmt: (v) => gbp(v), label: "Releases with the lowest cost per watch" })), {
                head: ["Release", "Per watch", "Detail"],
                rows: cheapest.map((c) => [c.label, c.valueLabel, c.tip]),
            }),
            card("Dearest per watch", "Bought, but rarely played", guard(dearest.length, (el) => hbars(el, { items: dearest, valueFmt: (v) => gbp(v), label: "Releases with the highest cost per watch" })), {
                head: ["Release", "Per watch", "Detail"],
                rows: dearest.map((c) => [c.label, c.valueLabel, c.tip]),
            }),
            card("Genres on the shelf", "Releases holding each genre (top 12)", guard(topGenres.length, (el) => hbars(el, { items: topGenres, label: "Releases per genre" })), {
                head: ["Genre", "Releases"],
                rows: [...genres.values()].sort((a, b) => b.n - a.n).map((g) => [g.name, g.n]),
            }),
        ]);
    }

    // ---------- concentration ----------

    function concentrationSection(A, I) {
        // a Lorenz-style curve: the most expensive (or valuable) releases first, and the running share of the total
        const curve = (values) => {
            const v = values.filter((x) => x > 0).sort((a, b) => b - a);
            const total = sum(v);
            let acc = 0;
            return { n: v.length, pts: [0, ...v.map((x) => ((acc += x) / total) * 100)] };
        };
        const paid = curve(A.filter((i) => i.priced).map((i) => i.paid));
        const cash = curve(I.map((i) => i.latest.cash));
        const steps = 20; // resample both to a 0–100% axis of releases
        const at = (c, f) => (c.n ? c.pts[Math.round(f * c.n)] : null);
        const pts = Array.from({ length: steps + 1 }, (_, k) => ({ label: `top ${Math.round((k / steps) * 100)}% of releases`, tickLabel: `${Math.round((k / steps) * 100)}%`, tick: k % 4 === 0 }));
        const series = [
            { ...M.paid, name: "Share of what you paid", values: pts.map((_, k) => at(paid, k / steps)) },
            ...(cash.n ? [{ ...M.cash, name: "Share of the cash value", values: pts.map((_, k) => at(cash, k / steps)) }] : []),
        ];
        const share = (c, f) => (c.n ? at(c, f) : null);
        const note = [paid.n ? `The priciest 10% of releases took ${pct(share(paid, 0.1))} of the spend` : "", cash.n ? `the most valuable 10% hold ${pct(share(cash, 0.1))} of the cash value` : ""].filter(Boolean).join("; ");

        const rates = I.filter((i) => i.latest.sell > 0).map((i) => (i.latest.cash / i.latest.sell) * 100);
        const bands = [[0, 10], [10, 20], [20, 30], [30, 40], [40, 50], [50, Infinity]].map(([a, b]) => {
            const n = rates.filter((r) => r >= a && r < b).length;
            return { label: b === Infinity ? `${a}%+` : `${a}–${b}%`, value: n, tip: plural(n, "release") };
        });

        return section("c-concentration", "Where the money sits", `On the shelf now${note ? `: ${note[0].toLowerCase()}${note.slice(1)}` : ""}.`, [
            card("Concentration", "Running share of the total, most expensive releases first", guard(paid.n, (el) => lines(el, { points: pts, series, valueFmt: (v) => `${fmt(v)}%`, label: "Cumulative share of spend and value" })), {
                size: "is-wide",
                extra: legend(series),
                head: ["Releases", ...series.map((s) => s.name)],
                rows: pts.filter((_, k) => k % 2 === 0).map((p, n) => [p.tickLabel, ...series.map((s) => pct(s.values[n * 2], 1))]),
            }),
            card("CeX's offer against its own price", "Cash as a share of what CeX sells each release for", guard(rates.length, (el) => columns(el, { items: bands, label: "Releases by cash offer as a share of CeX's price" }), "No CeX prices yet."), {
                head: ["Cash ÷ CeX price", "Releases"],
                rows: bands.map((b) => [b.label, b.value]),
                note: rates.length ? `Median ${pct(median(rates))}: CeX would pay about ${pct(median(rates))} of its own shelf price in cash.` : "",
            }),
        ]);
    }

    function timeSection(I, days, paidCex) {
        const pts = days.map((d) => ({ label: day(d.date), tickLabel: day(d.date).replace(/ \d{4}$/, "") }));
        const series = [
            { ...M.sell, values: days.map((d) => d.sell) },
            { ...M.voucher, values: days.map((d) => d.exchange) },
            { ...M.cash, values: days.map((d) => d.cash) },
            { ...M.paid, values: days.map(() => paidCex) },
        ];
        const movers = I.filter((i) => i.cashChange)
            .sort((a, b) => Math.abs(b.cashChange) - Math.abs(a.cashChange))
            .slice(0, 12)
            .map((i) => ({ label: i.name, value: i.cashChange, valueLabel: signed(i.cashChange), tip: `${gbp(i.first.cash)} → ${gbp(i.latest.cash)} cash`, full: i.name }));

        // what the collection, built up by when each title was first watched, would fetch today
        const dated = I.flatMap((i) => i.titles.filter((t) => t.firstWatch).slice(0, 1).map((t) => ({ i, k: +t.firstWatch.slice(0, 4) * 12 + +t.firstWatch.slice(5, 7) - 1 })));
        const months = dated.length ? Array.from({ length: Math.max(...dated.map((d) => d.k)) - Math.min(...dated.map((d) => d.k)) + 1 }, (_, n) => Math.min(...dated.map((d) => d.k)) + n) : [];
        let accPaid = 0, accCash = 0, accVoucher = 0;
        const grow = months.map((k) => {
            for (const d of dated.filter((d) => d.k === k)) {
                accPaid += d.i.paid;
                accCash += d.i.latest.cash;
                accVoucher += d.i.latest.exchange;
            }
            return { k, paid: accPaid, cash: accCash, voucher: accVoucher };
        });
        const growPts = grow.map((g) => ({ label: `${MONTHS[g.k % 12]} ${Math.floor(g.k / 12)}`, tickLabel: String(Math.floor(g.k / 12)), tick: g.k % 12 === 0 }));
        const growSeries = [
            { ...M.voucher, values: grow.map((g) => g.voucher) },
            { ...M.cash, values: grow.map((g) => g.cash) },
            { ...M.paid, values: grow.map((g) => g.paid) },
        ];
        const single = days.length < 2;

        return section("c-time", "Value over time", single
            ? `What's on the shelf now. Price tracking started on ${day(days[0].date)}. The server records every item's CeX prices once a day, so this line grows a point a day.`
            : `What's on the shelf now, over ${plural(days.length, "day")} of daily CeX prices. An item CeX didn't answer for on a day keeps its last known price.`, [
            card("What it's all worth, day by day", "Totals across every release with a CeX link · the axis starts near the lowest value so changes show", (el) => lines(el, { points: pts, series, yMin: floorTo(Math.min(...series.flatMap((s) => s.values)) * 0.85), valueFmt: (v) => gbp(v, 0), label: "Collection value over time" }), {
                size: "is-wide",
                extra: legend(series),
                head: ["Day", "CeX sells for", "Voucher", "Cash", "Items priced"],
                rows: days.map((d) => [day(d.date), gbp(d.sell), gbp(d.exchange), gbp(d.cash), d.n]),
            }),
            card("Biggest movers", "Change in cash price since tracking began", guard(movers.length, (el) => divbars(el, { items: movers, label: "Biggest cash price changes" }), "No price changes yet: this fills in as the daily prices move."), {
                head: ["Item", "Change", "Cash"],
                rows: movers.map((m) => [m.label, m.valueLabel, m.tip]),
            }),
            card("The collection as it grew", "Running totals by when each title was first watched, at today's prices", guard(grow.length, (el) => lines(el, { points: growPts, series: growSeries, valueFmt: (v) => gbp(v, 0), label: "Paid and value today, accumulated by first watch date" })), {
                extra: legend(growSeries),
                head: ["Month", "Paid", "Cash today", "Voucher today"],
                rows: grow.filter((_, n) => n % 3 === 0 || n === grow.length - 1).map((g, n) => [growPts[grow.indexOf(g)].label, gbp(g.paid), gbp(g.cash), gbp(g.voucher)]),
            }),
        ]);
    }

    // Every priced release on one big chart: what you paid against what CeX sells it for now (their shop price).
    const PRICE_SORTS = [
        ["gain", "Biggest gain", (a, b) => b.diff - a.diff],
        ["loss", "Biggest loss", (a, b) => a.diff - b.diff],
        ["sell", "CeX price", (a, b) => b.sell - a.sell],
        ["paid", "Paid", (a, b) => b.paid - a.paid],
        ["name", "A–Z", (a, b) => a.name.localeCompare(b.name)],
    ];

    function priceSection(priced) {
        const rows = priced.map((i) => ({ name: i.name, paid: i.paid, sell: i.latest.sell, diff: i.latest.sell - i.paid }));
        const up = rows.filter((r) => r.diff > 0).length, down = rows.filter((r) => r.diff < 0).length;
        const top = Math.max(5, Math.ceil(Math.max(...rows.flatMap((r) => [r.paid, r.sell])) / 10) * 10);
        const diffLabel = (d) => (Math.abs(d) < 0.005 ? "same" : signed(d));
        const draw = (el) => {
            const by = (PRICE_SORTS.find(([k]) => k === priceSort) ?? PRICE_SORTS[0])[2];
            dumbbell(el, {
                items: [...rows].sort((a, b) => by(a, b) || a.name.localeCompare(b.name)).map((r) => ({
                    label: r.name, a: r.paid, b: r.sell, valueLabel: diffLabel(r.diff), full: r.name,
                    tip: `paid ${gbp(r.paid)} · CeX sells for ${gbp(r.sell)} · ${diffLabel(r.diff)}`,
                })),
                series: [M.paid, M.sell],
                xTicks: [0, 1, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= top),
                xFmt: (v) => `£${v}`,
                sqrt: true,
                label: "What you paid for each release against what CeX sells it for now",
            });
        };
        priceDraw = draw;
        const chips = `<div class="chips price-sort" role="group" aria-label="Order by">${PRICE_SORTS.map(([k, l]) => `<button type="button" class="chip" data-price-sort="${k}" aria-pressed="${priceSort === k}">${l}</button>`).join("")}</div>`;
        return section("c-price", "Paid vs CeX's price", "What each release on the shelf cost you, against what CeX sells it for today: their shop price, so what buying it again would cost.", [
            card("Release by release", `${plural(up, "release")} would cost more at CeX now than you paid, ${fmt(down)} less · square-root scale, so the cheap ones don't bunch up`, draw, {
                size: "is-wide",
                extra: `<div class="price-controls">${legend([M.paid, M.sell])}${chips}</div>`,
                head: ["Release", "Paid", "CeX sells for", "Difference"],
                rows: [...rows].sort((a, b) => b.diff - a.diff).map((r) => [r.name, gbp(r.paid), gbp(r.sell), diffLabel(r.diff)]),
            }),
        ]);
    }

    // the chart's order: only that chart is drawn again
    document.getElementById("releasesRoot")?.addEventListener("click", (e) => {
        const chip = e.target.closest("[data-price-sort]");
        if (!chip) return;
        priceSort = chip.dataset.priceSort;
        const cardEl = chip.closest(".viz-card");
        cardEl.querySelectorAll("[data-price-sort]").forEach((b) => b.setAttribute("aria-pressed", String(b === chip)));
        const body = cardEl.querySelector(".viz-body");
        if (body) priceDraw?.(body);
    });

    function sellSection(I, priced, t) {
        const compare = [
            { label: M.paid.name, value: t.paidCex, color: M.paid.color },
            { label: M.cash.name, value: t.cash, color: M.cash.color },
            { label: M.voucher.name, value: t.voucher, color: M.voucher.color },
            { label: M.sell.name, value: t.sell, color: M.sell.color },
        ].map((c) => ({ ...c, valueLabel: gbp(c.value) }));

        const pl = priced.map((i) => ({ label: i.name, value: i.latest.cash - i.paid, valueLabel: signed(i.latest.cash - i.paid), tip: `paid ${gbp(i.paid)} · cash ${gbp(i.latest.cash)} · voucher ${gbp(i.latest.exchange)}`, full: i.name }));
        const ups = [...pl].sort((a, b) => b.value - a.value).filter((p) => p.value > 0).slice(0, 8);
        const downs = [...pl].sort((a, b) => a.value - b.value).filter((p) => p.value < 0).slice(0, 8);

        const back = [[0, 25], [25, 50], [50, 75], [75, 100], [100, Infinity]].map(([a, b]) => {
            const n = priced.filter((i) => {
                const r = (i.latest.cash / i.paid) * 100;
                return r >= a && r < b;
            }).length;
            return { label: b === Infinity ? "100%+" : `${a}–${b}%`, value: n, tip: plural(n, "item") };
        });

        const maxP = Math.max(5, ...priced.map((i) => Math.max(i.paid, i.latest.cash)));
        const top = Math.ceil(maxP / 10) * 10;
        const scatterPts = priced.map((i) => ({ x: i.paid, y: i.latest.cash, label: i.name, tipV: `paid ${gbp(i.paid)} · cash ${gbp(i.latest.cash)}` }));
        const tickVals = [0, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= top);

        return section("c-sell", "If you sold today", "Everything on the shelf with a CeX price. Cash and voucher are what CeX would pay you; “CeX sells for” is their shop price.", [
            card("Paid vs what CeX would give", "", (el) => hbars(el, { items: compare, label: "Paid, cash, voucher and CeX's price" }), {
                head: ["", "Total"],
                rows: compare.map((c) => [c.label, c.valueLabel]),
            }),
            card("Paid vs cash, item by item", "Dots above the line would sell for more than you paid · square-root scales", guard(scatterPts.length, (el) =>
                scatter(el, { points: scatterPts, xDomain: [0, top], yDomain: [0, top], xSqrt: true, ySqrt: true, xTicks: tickVals, yTicks: tickVals.filter((v) => v <= top), xFmt: (v) => `£${v}`, yFmt: (v) => `£${v}`, xLabel: "Paid", yLabel: "Cash now", diagonal: "break-even", label: "Price paid against cash value" })),
                { head: ["Item", "Paid", "Cash"], rows: [...scatterPts].sort((a, b) => b.y - b.x - (a.y - a.x)).map((p) => [p.label, gbp(p.x), gbp(p.y)]) },
            ),
            card("How much you'd get back", "Cash as a share of the price paid", guard(priced.length, (el) => columns(el, { items: back, label: "Items by share of price recovered in cash" })), {
                head: ["Back in cash", "Items"],
                rows: back.map((b) => [b.label, b.value]),
            }),
            card("Best buys", "Cash today minus what you paid", guard(ups.length, (el) => divbars(el, { items: ups, label: "Items now worth more than paid" }), "Nothing would sell for more than you paid."), {
                head: ["Item", "Cash − paid", "Detail"],
                rows: ups.map((u) => [u.label, u.valueLabel, u.tip]),
            }),
            card("Biggest drops", "Cash today minus what you paid", guard(downs.length, (el) => divbars(el, { items: downs, label: "Items now worth less than paid" }), "Everything would sell for at least what you paid."), {
                head: ["Item", "Cash − paid", "Detail"],
                rows: downs.map((u) => [u.label, u.valueLabel, u.tip]),
            }),
        ]);
    }

    function worthSection(I) {
        const top = [...I].sort((a, b) => b.latest.cash - a.latest.cash).slice(0, 10)
            .map((i) => ({ label: i.name, value: i.latest.cash, valueLabel: `${gbp(i.latest.cash)} · ${gbp(i.latest.exchange)} voucher`, full: i.name, color: M.cash.color }));

        const cats = [...new Set(I.map((i) => i.category))]
            .map((c) => ({ c, items: I.filter((i) => i.category === c) }))
            .sort((a, b) => sum(b.items.map((i) => i.latest.cash)) - sum(a.items.map((i) => i.latest.cash)));
        const pie = cats.slice(0, 6).map((c, n) => ({ label: c.c, value: sum(c.items.map((i) => i.latest.cash)), color: slot(n) }));
        const rest = cats.slice(6);
        if (rest.length) pie.push({ label: "Everything else", value: sum(rest.flatMap((c) => c.items.map((i) => i.latest.cash))), color: OTHER });

        const bands = [[0, 1], [1, 2], [2, 5], [5, 10], [10, 20], [20, Infinity]].map(([a, b]) => {
            const n = I.filter((i) => i.latest.cash >= a && i.latest.cash < b).length;
            return { label: b === Infinity ? `£${a}+` : `£${a}–${b}`, value: n, tip: plural(n, "item") };
        });

        const cut = cats.filter((c) => c.items.some((i) => i.latest.sell > 0)).map((c) => {
            const ms = c.items.filter((i) => i.latest.sell > 0).map((i) => ((i.latest.sell - i.latest.cash) / i.latest.sell) * 100);
            return { label: c.c, value: mean(ms), valueLabel: `${pct(mean(ms))}  (${c.items.length})`, full: `${c.c} · ${plural(c.items.length, "item")}` };
        }).sort((a, b) => b.value - a.value);

        return section("c-worth", "What's worth what", "The releases on the shelf now, at CeX's prices today.", [
            card("Most valuable", "Cash price, with the voucher price alongside", (el) => hbars(el, { items: top, label: "Most valuable items" }), {
                head: ["Item", "Cash", "Voucher", "CeX sells for"],
                rows: [...I].sort((a, b) => b.latest.cash - a.latest.cash).slice(0, 10).map((i) => [i.name, gbp(i.latest.cash), gbp(i.latest.exchange), gbp(i.latest.sell)]),
            }),
            card("Value by CeX category", "Share of the cash value", (el) => donut(el, { items: pie, center: gbp(sum(pie.map((p) => p.value)), 0), centerLabel: "cash", valueFmt: (v) => gbp(v), label: "Cash value by category" }), {
                head: ["Category", "Items", "Cash", "Voucher"],
                rows: cats.map((c) => [c.c, c.items.length, gbp(sum(c.items.map((i) => i.latest.cash))), gbp(sum(c.items.map((i) => i.latest.exchange)))]),
            }),
            card("Items by cash value", "", (el) => columns(el, { items: bands, label: "Items by cash price band" }), {
                head: ["Cash", "Items"],
                rows: bands.map((b) => [b.label, b.value]),
            }),
            card("CeX's cut", "How far below their shop price they'd pay you in cash, by category (items)", guard(cut.length, (el) => hbars(el, { items: cut, max: 100, label: "CeX margin by category" })), {
                head: ["Category", "Average cut"],
                rows: cut.map((c) => [c.label, c.valueLabel]),
            }),
        ]);
    }

    function tableSection(A) {
        const rows = [...A].sort((a, b) => (b.latest?.cash ?? -1) - (a.latest?.cash ?? -1) || a.name.localeCompare(b.name));
        const money = (v) => (v == null ? "–" : gbp(v));
        const body = rows
            .map((i) => {
                const pl = i.priced && i.latest ? i.latest.cash - i.paid : null;
                return `<tr><th scope="row">${esc(i.name)}<span class="cex-table-titles">${esc(i.titles.map((t) => t.name).join(", "))}${i.cexName && i.cexName !== i.name ? ` · CeX: ${esc(i.cexName)}` : ""}</span></th><td>${esc(i.format)}</td><td>${esc(PLACES[i.place] ?? i.place)}</td><td>${esc(i.category)}</td><td>${i.priced ? gbp(i.paid) : "–"}</td><td>${money(i.latest?.sell)}</td><td>${money(i.latest?.cash)}</td><td>${money(i.latest?.exchange)}</td><td class="${pl == null ? "" : pl >= 0 ? "is-up" : "is-down"}">${signed(pl)}</td><td>${i.cashChange ? signed(i.cashChange) : "–"}</td></tr>`;
            })
            .join("");
        return `
            <section class="viz-section" aria-labelledby="c-all">
                <div class="viz-section-head"><h2 id="c-all">Every release on the shelf</h2><p>Sorted by cash value; releases without a CeX price come last. “Change” is the cash price since tracking began.</p></div>
                <article class="viz-card">
                    <div class="viz-table-wrap cex-table-wrap">
                        <table class="viz-table cex-table">
                            <thead><tr><th scope="col">Release</th><th scope="col">Format</th><th scope="col">Bought from</th><th scope="col">CeX category</th><th scope="col">Paid</th><th scope="col">Sells for</th><th scope="col">Cash</th><th scope="col">Voucher</th><th scope="col">Cash − paid</th><th scope="col">Change</th></tr></thead>
                            <tbody>${body}</tbody>
                        </table>
                    </div>
                </article>
            </section>`;
    }

    // ---------- traded in and sold ----------

    function soldSection(S, ALL) {
        const wrap = (intro, body = "") => `
            <section class="viz-section sold-section" aria-labelledby="c-sold">
                <div class="viz-section-head"><h2 id="c-sold">Traded in and sold</h2><p>${intro}</p></div>
                ${body}
            </section>`;
        if (!S.length)
            return wrap("Nothing traded in or sold yet. When a disc goes, tick “Traded in or sold” on it (on the releases page): it leaves the shelf, and shows up here with where it went and what you got back.");

        const tradeIns = S.filter((i) => i.channel === "Cex");
        const got = S.filter((i) => i.got != null);
        const back = sum(got.map((i) => i.got));
        const both = S.filter((i) => i.got != null && i.priced && i.paid > 0);
        const paidBoth = sum(both.map((i) => i.paid));
        const paidEver = sum(ALL.map((i) => i.paid));
        const kept = S.filter((i) => i.keptDays != null);
        const tiles = [
            ["Gone from the shelf", fmt(S.length), [tradeIns.length ? `${fmt(tradeIns.length)} traded in at CeX` : "", S.length > tradeIns.length ? `${fmt(S.length - tradeIns.length)} sold` : ""].filter(Boolean).join(" · ")],
            ["Money back", gbp(back), got.length === S.length ? (S.length === 1 ? "from the one disc" : `from all ${fmt(S.length)} discs`) : `from ${plural(got.length, "disc")} with a price`],
            ["Cost recovered", pct(paidBoth ? (sum(both.map((i) => i.got)) / paidBoth) * 100 : null), both.length ? `of the ${gbp(paidBoth)} those cost` : "needs what you paid and got"],
            ["Net spend", gbp(paidEver - back), `${gbp(paidEver)} paid for every release, less what came back`],
            ["Average per disc", gbp(mean(got.map((i) => i.got))), got.length ? `median ${gbp(median(got.map((i) => i.got)))}` : ""],
        ];
        if (kept.length) tiles.push(["Kept on average", keptText(mean(kept.map((i) => i.keptDays))), `${plural(kept.length, "disc")} with a purchase date`]);

        // where they went
        const chans = Object.keys(Shelf.CHANNELS)
            .map((k) => {
                const rs = S.filter((i) => i.channel === k);
                const rates = rs.filter((i) => i.back != null).map((i) => i.back * 100);
                return { k, label: Shelf.CHANNELS[k], color: CHANNEL_COLOR[k], n: rs.length, back: sum(rs.map((i) => i.got ?? 0)), rate: mean(rates) };
            })
            .filter((c) => c.n);

        // paid against got back, and the difference
        const pairs = S.filter((i) => i.priced && i.got != null).map((i) => ({ name: i.name, paid: i.paid, got: i.got, net: i.got - i.paid }));
        const top = Math.max(5, Math.ceil(Math.max(0, ...pairs.flatMap((p) => [p.paid, p.got])) / 10) * 10);
        const ahead = pairs.filter((p) => p.net >= 0).length;
        const byNet = [...pairs].sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
        // the best and the worst: all of them when they fit, otherwise the 8 at each end
        const deals = (byNet.length > 16 ? [...byNet.slice(0, 8), ...byNet.slice(-8)] : byNet)
            .map((p) => ({ label: p.name, value: p.net, valueLabel: signed(p.net), tip: `paid ${gbp(p.paid)} · got back ${gbp(p.got)}`, full: p.name }));

        // money back, month by month
        const monthOf = (iso) => +iso.slice(0, 4) * 12 + +iso.slice(5, 7) - 1;
        const dated = S.filter((i) => i.soldOn);
        const ks = dated.map((i) => monthOf(i.soldOn));
        const months = ks.length ? Array.from({ length: Math.max(...ks) - Math.min(...ks) + 1 }, (_, n) => Math.min(...ks) + n) : [];
        const monthly = months.map((k) => {
            const rs = dated.filter((i) => monthOf(i.soldOn) === k);
            const v = sum(rs.map((i) => i.got ?? 0));
            return { label: `${MONTHS[k % 12]} ${Math.floor(k / 12)}`, value: v, tip: `${gbp(v)} from ${plural(rs.length, "disc")}` };
        });

        // what came back as a share of what it cost
        const rated = S.filter((i) => i.back != null);
        const bands = [[0, 25], [25, 50], [50, 75], [75, 100], [100, Infinity]].map(([a, b]) => {
            const n = rated.filter((i) => i.back * 100 >= a && i.back * 100 < b).length;
            return { label: b === Infinity ? "100%+" : `${a}–${b}%`, value: n, tip: plural(n, "disc") };
        });

        // CeX trade-ins against CeX's own offer around the day (Shelf.nearestPoint)
        const checked = tradeIns.filter((i) => i.offer && i.got != null).map((i) => ({ i, diff: i.got - i.offer.value }));
        const off = checked.filter((c) => Math.abs(c.diff) >= 0.005).sort((a, b) => b.diff - a.diff);
        const offerWhen = (o) => (o.days === 0 ? "that day" : `${Math.abs(o.days)} ${Math.abs(o.days) === 1 ? "day" : "days"} ${o.days < 0 ? "before" : "after"}`);
        const fairNote = !tradeIns.length ? "No CeX trade-ins yet."
            : !checked.length ? "None of the trade-ins has a daily CeX price within a week of the day (or a price you got)."
            : off.length ? `${plural(checked.length - off.length, "trade-in")} matched CeX's price exactly.`
            : `All ${plural(checked.length, "trade-in")} matched CeX's price on the day.`;

        // how long they were kept
        const keptBands = [[0, 182, "Under 6 months"], [182, 365, "6–12 months"], [365, 730, "1–2 years"], [730, 1826, "2–5 years"], [1826, Infinity, "5 years+"]].map(([a, b, label]) => {
            const n = kept.filter((i) => i.keptDays >= a && i.keptDays < b).length;
            return { label, value: n, tip: plural(n, "disc") };
        });

        const cards = [
            card("Where they went", "Discs by where they were traded in or sold", (el) => donut(el, { items: chans.map((c) => ({ label: c.label, value: c.n, color: c.color })), centerLabel: S.length === 1 ? "disc" : "discs", label: "Discs by where they went" }), {
                head: ["Where", "Discs", "Money back", "Average return"],
                rows: chans.map((c) => [c.label, c.n, gbp(c.back), pct(c.rate)]),
                note: chans.map((c) => `${c.label} ${gbp(c.back)}${c.rate != null ? ` (${pct(c.rate)} of cost)` : ""}`).join(" · "),
            }),
            card("Money back by month", "What came back in each month", guard(monthly.length, (el) => columns(el, { items: monthly, valueFmt: (v) => gbp(v, 0), labelEvery: Math.max(1, Math.ceil(monthly.length / 8)), label: "Money back from sales, month by month" })), {
                head: ["Month", "Money back"],
                rows: monthly.map((m) => [m.label, gbp(m.value)]),
            }),
            card("Paid vs got back", `${plural(ahead, "disc")} made back what it cost or more, ${fmt(pairs.length - ahead)} didn't · square-root scale`, guard(pairs.length, (el) =>
                dumbbell(el, {
                    items: byNet.map((p) => ({ label: p.name, a: p.paid, b: p.got, valueLabel: signed(p.net), full: p.name, tip: `paid ${gbp(p.paid)} · got back ${gbp(p.got)} · ${signed(p.net)}` })),
                    series: [M.paid, M.back],
                    xTicks: [0, 1, 2, 5, 10, 20, 50, 100, 200].filter((v) => v <= top),
                    xFmt: (v) => `£${v}`,
                    sqrt: true,
                    label: "What you paid for each disc that went, against what you got back",
                }), "Needs both the price paid and the price you got."), {
                size: "is-wide",
                extra: legend([M.paid, M.back]),
                head: ["Disc", "Paid", "Got back", "Difference"],
                rows: byNet.map((p) => [p.name, gbp(p.paid), gbp(p.got), signed(p.net)]),
            }),
            card("Best and worst deals", "Got back minus what you paid, best first", guard(deals.length, (el) => divbars(el, { items: deals, label: "Best and worst sales" }), "Needs both the price paid and the price you got."), {
                head: ["Disc", "Got − paid", "Detail"],
                rows: deals.map((d) => [d.label, d.valueLabel, d.tip]),
            }),
            card("How much came back", "Discs by what you got as a share of what you paid", guard(rated.length, (el) => columns(el, { items: bands, yMax: Math.max(4, ...bands.map((b) => b.value)), label: "Discs by share of the price recovered" })), {
                head: ["Back", "Discs"],
                rows: bands.map((b) => [b.label, b.value]),
                note: rated.length ? `Median ${pct(median(rated.map((i) => i.back * 100)))} of the price back.` : "",
            }),
            card("Did CeX pay its price?", "What you got, against CeX's own cash (or voucher) price nearest the day", guard(off.length, (el) =>
                divbars(el, { items: off.map((c) => ({ label: c.i.name, value: c.diff, valueLabel: signed(c.diff), tip: `got ${gbp(c.i.got)} · CeX's ${c.i.payout === "Voucher" ? "voucher" : "cash"} price ${gbp(c.i.offer.value)} (${offerWhen(c.i.offer)})`, full: c.i.name })), label: "Trade-ins against CeX's price on the day" }), fairNote), {
                head: ["Disc", "Traded in", "Got", "CeX's price", "Difference", "Prices from"],
                rows: checked.map((c) => [c.i.name, Shelf.day(c.i.soldOn), `${gbp(c.i.got)} ${c.i.payout === "Voucher" ? "voucher" : "cash"}`, gbp(c.i.offer.value), signed(c.diff), offerWhen(c.i.offer)]),
                note: off.length ? fairNote : "",
            }),
            kept.length
                ? card("How long you kept them", "From the day you bought it to the day it went (discs with a purchase date)", (el) => columns(el, { items: keptBands, yMax: Math.max(4, ...keptBands.map((b) => b.value)), label: "Discs by how long they were kept" }), {
                      head: ["Kept", "Discs"],
                      rows: keptBands.map((b) => [b.label, b.value]),
                      note: `Median ${keptText(median(kept.map((i) => i.keptDays)))}.`,
                  })
                : "",
        ];

        const rows = [...S].sort((a, b) => (b.soldOn ?? "").localeCompare(a.soldOn ?? "") || a.name.localeCompare(b.name));
        const money = (v) => (v == null ? "–" : gbp(v));
        const table = `
            <article class="viz-card is-wide">
                <header class="viz-head"><h3>Every disc that went</h3><p class="viz-sub">Most recent first. “CeX's price” is its cash (or voucher) price nearest the day.</p></header>
                <div class="viz-table-wrap cex-table-wrap">
                    <table class="viz-table cex-table">
                        <thead><tr><th scope="col">Release</th><th scope="col">Where</th><th scope="col">When</th><th scope="col">Paid</th><th scope="col">Got back</th><th scope="col">Got − paid</th><th scope="col">CeX's price</th><th scope="col">Kept</th></tr></thead>
                        <tbody>${rows
                            .map((i) => `<tr><th scope="row">${esc(i.name)}<span class="cex-table-titles">${esc(i.titles.map((t) => t.name).join(", "))}</span></th><td>${esc(Shelf.CHANNELS[i.channel] ?? i.channel)}${i.channel === "Cex" && i.payout ? ` <span class="faint">(${i.payout === "Voucher" ? "voucher" : "cash"})</span>` : ""}</td><td>${esc(Shelf.day(i.soldOn))}</td><td>${i.priced ? gbp(i.paid) : "–"}</td><td>${money(i.got)}</td><td class="${i.net == null ? "" : i.net >= 0 ? "is-up" : "is-down"}">${signed(i.net)}</td><td>${i.offer ? gbp(i.offer.value) : "–"}</td><td>${i.keptDays == null ? "–" : esc(keptText(i.keptDays))}</td></tr>`)
                            .join("")}</tbody>
                    </table>
                </div>
            </article>`;

        return wrap(
            `${plural(S.length, "disc")} no longer on the shelf, kept here as history. Paid is what each cost; got back is what came back for it.`,
            `${K.kpiTiles(tiles)}<div class="viz-grid">${cards.join("")}${table}</div>`,
        );
    }

    K.addTab("releases", {
        async render() {
            const root = document.getElementById("releasesRoot");
            if (!history || !releases) {
                root.innerHTML = `<p class="viz-empty">Loading releases and CeX prices…</p>`;
                try {
                    const [h, r] = await Promise.all(["/api/cex/history", "/api/releases"].map(async (u) => {
                        const resp = await fetch(u, { cache: "no-store" });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                        return resp.json();
                    }));
                    [history, releases] = [h, r];
                } catch (e) {
                    root.innerHTML = `<div class="empty"><h2>Couldn't load the releases</h2><p class="muted">${esc(e.message)}</p></div>`;
                    return;
                }
            }
            render();
        },
        hero: () => hero.length && K.setHero(hero),
    });
})();
