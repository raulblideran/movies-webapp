// Stats page, CeX tab: what the collection's own CeX products are worth. Current prices and the value-over-time
// line come from the server's daily price snapshots (/api/cex/history); what was paid comes from the titles.
// Built from the blocks js/stats.js shares as window.StatsKit.

(function () {
    const K = window.StatsKit;
    const { columns, hbars, lines, divbars, donut, scatter, legend, fmt, esc } = window.Charts;
    const { card, section, empty, guard, gbp, pct, sum, mean, median, plural, slot, OTHER, MONTHS } = K;

    // one colour per measure, used the same way on every chart in this tab
    const M = {
        paid: { name: "Paid", color: slot(0) },
        cash: { name: "Cash", color: slot(1) },
        voucher: { name: "Voucher", color: slot(2) },
        sell: { name: "CeX sells for", color: slot(3) },
    };
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
    let hero = [];

    // One row per CeX product: latest prices, the titles on it, and what its releases cost.
    function build() {
        const bySku = new Map(history.map((h) => [h.sku, h]));
        const items = new Map();
        const seen = new Set();
        for (const t of K.titles()) {
            for (const r of t.releases.filter((r) => r.cexSku)) {
                const it = items.get(r.cexSku) ?? { sku: r.cexSku, titles: [], paid: 0, priced: false };
                if (!it.titles.includes(t)) it.titles.push(t);
                if (!seen.has(r.id) && r.pricePaid != null) {
                    it.paid += r.pricePaid; // once per release, however many titles share it
                    it.priced = true;
                }
                seen.add(r.id);
                items.set(r.cexSku, it);
            }
        }
        for (const it of items.values()) {
            const h = bySku.get(it.sku);
            it.name = h?.boxName ?? it.titles.map((t) => t.name).join(" / ");
            it.category = h?.category ?? "Unknown";
            it.points = h?.points ?? [];
            const last = it.points[it.points.length - 1], first = it.points[0];
            it.latest = last ?? null;
            it.first = first ?? null;
            it.cashChange = last && first && last !== first ? last.cash - first.cash : null;
        }
        return [...items.values()];
    }

    // Daily totals; an item missing on a day carries its last known price forward.
    function totalsByDay(items) {
        const dates = [...new Set(items.flatMap((i) => i.points.map((p) => p.date)))].sort();
        const known = new Map();
        const at = new Map(items.map((i) => [i.sku, new Map(i.points.map((p) => [p.date, p]))]));
        return dates.map((date) => {
            for (const i of items) {
                const p = at.get(i.sku).get(date);
                if (p) known.set(i.sku, p);
            }
            const ps = [...known.values()];
            return { date, sell: sum(ps.map((p) => p.sell)), cash: sum(ps.map((p) => p.cash)), exchange: sum(ps.map((p) => p.exchange)), n: ps.length };
        });
    }

    function render() {
        K.beginTab("cex");
        const root = document.getElementById("cexRoot");
        const all = build();
        const I = all.filter((i) => i.latest);
        const waiting = all.length - I.length;
        if (!all.length) {
            root.innerHTML = `<div class="empty"><h2>No CeX links yet</h2><p class="muted">Add CeX product links to releases and their prices show up here.</p></div>`;
            return;
        }
        if (!I.length) {
            root.innerHTML = `<div class="empty"><h2>Prices not recorded yet</h2><p class="muted">The server checks CeX for all ${plural(all.length, "linked product")} a couple of minutes after it starts, then every day. Come back shortly.</p></div>`;
            return;
        }

        const paidCex = sum(I.map((i) => i.paid));
        const cash = sum(I.map((i) => i.latest.cash)), voucher = sum(I.map((i) => i.latest.exchange)), sell = sum(I.map((i) => i.latest.sell));
        const elsewhere = new Map(K.titles().flatMap((t) => t.releases.filter((r) => !r.cexSku && r.pricePaid != null).map((r) => [r.id, r])));
        const paidOther = sum([...elsewhere.values()].map((r) => r.pricePaid));
        const priced = I.filter((i) => i.priced && i.paid > 0);
        const gainers = priced.filter((i) => i.latest.cash > i.paid);
        const best = [...I].sort((a, b) => b.latest.cash - a.latest.cash)[0];
        const lastDate = I.map((i) => i.latest.date).sort().pop();
        const firstDate = I.map((i) => i.first.date).sort()[0];
        const margins = I.filter((i) => i.latest.sell > 0).map((i) => (i.latest.sell - i.latest.cash) / i.latest.sell);
        const days = totalsByDay(I);

        hero = [[gbp(cash, 0), "cash"], [gbp(voucher, 0), "voucher"], [gbp(paidCex, 0), "paid"], [fmt(I.length), "items"]];
        K.setHero(hero);

        const kpis = K.kpiTiles([
            ["CeX items", fmt(I.length), `${plural(new Set(I.flatMap((i) => i.titles.map((t) => t.id))).size, "title")} linked${waiting ? ` · ${waiting} not priced yet` : ""}`],
            ["Cash if sold today", gbp(cash), `${pct(paidCex ? (cash / paidCex) * 100 : null)} of what you paid`],
            ["Voucher if sold today", gbp(voucher), `${pct(paidCex ? (voucher / paidCex) * 100 : null)} of what you paid`],
            ["CeX sells them for", gbp(sell), "what it would cost to buy them all again"],
            ["Paid at CeX", gbp(paidCex), `${plural(priced.length, "item")} with a price`],
            ["Paid elsewhere", gbp(paidOther), "releases without a CeX link"],
            ["Cash vs paid", signed(cash - paidCex), cash >= paidCex ? "you'd come out ahead" : "you'd be out of pocket"],
            ["Voucher vs paid", signed(voucher - paidCex), voucher >= paidCex ? "you'd come out ahead" : "you'd be out of pocket"],
            ["Voucher bonus", gbp(voucher - cash), `${pct(cash ? ((voucher - cash) / cash) * 100 : null)} more than cash`],
            ["CeX's cut", pct(mean(margins) * 100), "average gap between their price and cash"],
            ["Worth more than paid", fmt(gainers.length), `of ${plural(priced.length, "priced item")}, in cash`],
            ["Most valuable", best ? gbp(best.latest.cash) : "–", best ? best.name : ""],
            ["Average cash per item", gbp(mean(I.map((i) => i.latest.cash))), `median ${gbp(median(I.map((i) => i.latest.cash)))}`],
            ["Prices from", day(lastDate).replace(/ \d{4}$/, ""), firstDate === lastDate ? `${lastDate.slice(0, 4)} · tracking started that day` : `${lastDate.slice(0, 4)} · tracked since ${day(firstDate)}`],
        ]);

        root.innerHTML = [
            kpis,
            timeSection(I, days, paidCex),
            sellSection(I, priced, { cash, voucher, sell, paidCex }),
            worthSection(I),
            tableSection(I),
        ].join("");
        K.redraw();
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
            ? `Price tracking started on ${day(days[0].date)}. The server records every item's CeX prices once a day, so this line grows a point a day.`
            : `${plural(days.length, "day")} of daily CeX prices. An item CeX didn't answer for on a day keeps its last known price.`, [
            card("What it's all worth, day by day", "Totals across every CeX item · the axis starts near the lowest value so changes show", (el) => lines(el, { points: pts, series, yMin: floorTo(Math.min(...series.flatMap((s) => s.values)) * 0.85), valueFmt: (v) => gbp(v, 0), label: "Collection value over time" }), {
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

        return section("c-sell", "If you sold today", "Cash and voucher are what CeX would pay you; “CeX sells for” is their shop price.", [
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

        return section("c-worth", "What's worth what", "", [
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

    function tableSection(I) {
        const rows = [...I].sort((a, b) => b.latest.cash - a.latest.cash);
        const body = rows
            .map((i) => {
                const pl = i.priced ? i.latest.cash - i.paid : null;
                return `<tr><th scope="row">${esc(i.name)}<span class="cex-table-titles">${esc(i.titles.map((t) => t.name).join(", "))}</span></th><td>${esc(i.category)}</td><td>${i.priced ? gbp(i.paid) : "–"}</td><td>${gbp(i.latest.sell)}</td><td>${gbp(i.latest.cash)}</td><td>${gbp(i.latest.exchange)}</td><td class="${pl == null ? "" : pl >= 0 ? "is-up" : "is-down"}">${signed(pl)}</td><td>${i.cashChange ? signed(i.cashChange) : "–"}</td></tr>`;
            })
            .join("");
        return `
            <section class="viz-section" aria-labelledby="c-all">
                <div class="viz-section-head"><h2 id="c-all">Every item</h2><p>Sorted by cash value. “Change” is the cash price since tracking began.</p></div>
                <article class="viz-card">
                    <div class="viz-table-wrap cex-table-wrap">
                        <table class="viz-table cex-table">
                            <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Paid</th><th scope="col">Sells for</th><th scope="col">Cash</th><th scope="col">Voucher</th><th scope="col">Cash − paid</th><th scope="col">Change</th></tr></thead>
                            <tbody>${body}</tbody>
                        </table>
                    </div>
                </article>
            </section>`;
    }

    K.addTab("cex", {
        async render() {
            const root = document.getElementById("cexRoot");
            if (!history) {
                root.innerHTML = `<p class="viz-empty">Loading CeX prices…</p>`;
                try {
                    const resp = await fetch("/api/cex/history", { cache: "no-store" });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    history = await resp.json();
                } catch (e) {
                    root.innerHTML = `<div class="empty"><h2>Couldn't load CeX prices</h2><p class="muted">${esc(e.message)}</p></div>`;
                    return;
                }
            }
            render();
        },
        hero: () => hero.length && K.setHero(hero),
    });
})();
