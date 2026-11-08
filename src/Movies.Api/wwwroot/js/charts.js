// Small SVG chart kit for the stats page. Every colour is a CSS variable (the --chart-* slots and the
// theme's ink/line/surface tokens), so switching theme restyles the charts without redrawing them.
// Charts are drawn at the container's pixel width and redrawn when it resizes. Hover details come from
// data-v (value) and data-l (label) on any mark, shown by one shared tooltip.

(function () {
    const esc = (v) =>
        String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const fmt = (n, dp = 0) =>
        n == null || Number.isNaN(n) ? "–" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: dp, minimumFractionDigits: 0 });
    const tip = (v, l) => `data-v="${esc(v)}" data-l="${esc(l)}"`;
    // data-k: the thing a click highlights (see "click to highlight" below), named so a redraw or re-sort keeps it
    const key = (k) => `data-k="${esc(k)}"`;
    // data-s: which series a mark belongs to, for clicking the chart's legend
    const ser = (name) => (name ? `data-s="${esc(name)}"` : "");
    // what shows behind a highlighted row (a bar down its left) or column (a bar along its base); hidden until then
    const selRow = (x, y, w, h) => `<rect class="viz-sel" x="${x}" y="${y}" width="${w}" height="${h}"/><rect class="viz-sel-bar" x="${x}" y="${y}" width="3" height="${h}"/>`;
    const selCol = (x, y, w, h) => `<rect class="viz-sel" x="${x}" y="${y}" width="${w}" height="${h}"/><rect class="viz-sel-bar" x="${x}" y="${y + h - 3}" width="${w}" height="3"/>`;

    // Clean axis steps: 1, 2 or 5 × 10^k, about `count` of them.
    function ticks(max, count = 4) {
        if (!(max > 0)) return { step: 1, top: 1, list: [0, 1] };
        const raw = max / count;
        const mag = 10 ** Math.floor(Math.log10(raw));
        const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
        const top = Math.ceil(max / step) * step;
        const list = [];
        for (let v = 0; v <= top + step / 2; v += step) list.push(+v.toFixed(6));
        return { step, top, list };
    }

    // Bar with a 4px rounded data-end and a square base.
    function vbar(x, y, w, h, r = 4) {
        if (h <= 0) return "";
        r = Math.min(r, w / 2, h);
        return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    }
    function hbar(x, y, w, h, r = 4) {
        if (w <= 0) return "";
        r = Math.min(r, h / 2, w);
        return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    }

    const fit = (text, px) => {
        const n = Math.max(6, Math.floor(px / 6.6));
        return text.length > n ? text.slice(0, n - 1) + "…" : text;
    };
    const widthOf = (el) => Math.max(260, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 320));
    const svg = (w, h, body, label) =>
        `<svg class="viz-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;

    function yAxis(t, x0, x1, y, fmtTick = fmt) {
        return t.list
            .map((v) => {
                const yy = y(v);
                return `<line class="viz-gridline" x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}"/><text class="viz-tick" x="${x0 - 6}" y="${yy}" dy="0.32em" text-anchor="end">${esc(fmtTick(v))}</text>`;
            })
            .join("");
    }

    // ---------- columns (optionally stacked) ----------
    // items: [{ label, values: [n, …] }] or [{ label, value }]; series: [{ name, color }]
    function columns(el, { items, series = [{ name: "", color: "var(--viz-main)" }], height = 220, valueFmt = fmt, labelEvery, highlight, label = "", showMax = true, yMax }) {
        const W = widthOf(el), H = height;
        const m = { t: 18, r: 8, b: 26, l: 38 };
        const pw = W - m.l - m.r, ph = H - m.t - m.b;
        const vals = items.map((it) => it.values ?? [it.value]);
        const totals = vals.map((v) => v.reduce((a, b) => a + (b || 0), 0));
        const t = ticks(yMax ?? Math.max(...totals, 0));
        const y = (v) => m.t + ph - (v / t.top) * ph;
        const band = pw / Math.max(items.length, 1);
        const bw = Math.max(2, Math.min(24, band * 0.72));
        const every = labelEvery ?? Math.max(1, Math.ceil(items.length / Math.floor(pw / 42)));
        const maxI = totals.indexOf(Math.max(...totals));
        let body = yAxis(t, m.l, W - m.r, y, valueFmt);
        items.forEach((it, i) => {
            const cx = m.l + band * i + band / 2;
            let acc = 0;
            const segs = vals[i];
            body += `<g class="viz-item" ${key(it.full ?? it.label)}>${selCol(m.l + band * i, m.t, band, ph)}`;
            const top = segs.reduce((last, v, k) => (v > 0 ? k : last), -1);
            segs.forEach((v, k) => {
                if (!(v > 0)) return;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                const h = y0 - y1 - (k === top ? 0 : 2); // 2px surface gap between stacked segments
                const color = highlight?.(it, i) ?? series[k].color;
                const d = k === top ? vbar(cx - bw / 2, y1, bw, h) : `M${cx - bw / 2},${y1 + (y0 - y1 - h)}h${bw}v${h}h${-bw}Z`;
                body += `<path class="viz-mark" d="${d}" style="fill:${color}" ${series.length > 1 ? ser(series[k].name) : ""}/>`;
            });
            const lines = series.length > 1
                ? series.map((s, k) => `${s.name}: ${valueFmt(segs[k] || 0)}`).join(" · ")
                : "";
            body += `<rect class="viz-hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ph}" ${tip(it.tip ?? valueFmt(totals[i]), `${it.full ?? it.label}${lines ? " — " + lines : ""}`)}/></g>`;
            if (i % every === 0 || items.length <= 14)
                body += `<text class="viz-tick" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(it.label)}</text>`;
        });
        if (showMax && totals[maxI] > 0) {
            const cx = m.l + band * maxI + band / 2;
            body += `<text class="viz-value" x="${cx}" y="${y(totals[maxI]) - 6}" text-anchor="middle">${esc(valueFmt(totals[maxI]))}</text>`;
        }
        body += `<line class="viz-axis" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>`;
        el.innerHTML = svg(W, H, body, label);
        restore(el);
    }

    // ---------- horizontal bars ----------
    // items: [{ label, value, valueLabel?, color?, tip? }]
    function hbars(el, { items, max, valueFmt = fmt, label = "", color = "var(--viz-main)" }) {
        const W = widthOf(el);
        const row = 28, labelW = Math.min(170, Math.round(W * 0.38));
        // room for the longest value label at the bar tip, so it never runs off the edge
        const valueW = Math.max(40, ...items.map((it) => String(it.valueLabel ?? valueFmt(it.value)).length * 7 + 10));
        const H = items.length * row + 4;
        const top = max ?? Math.max(...items.map((i) => i.value), 0);
        const pw = W - labelW - valueW - 8;
        let body = "";
        items.forEach((it, i) => {
            const y = i * row + 4;
            const w = top > 0 ? (it.value / top) * pw : 0;
            const name = fit(it.label, labelW - 12);
            body += `<g class="viz-item" ${key(it.full ?? it.label)}>${selRow(0, y, W, row)}<text class="viz-label" x="${labelW - 8}" y="${y + 12}" dy="0.32em" text-anchor="end">${esc(name)}</text>`;
            body += `<path class="viz-mark" d="${hbar(labelW, y + 3, Math.max(w, 2), 18)}" style="fill:${it.color ?? color}"/>`;
            body += `<text class="viz-value" x="${labelW + Math.max(w, 2) + 6}" y="${y + 12}" dy="0.32em">${esc(it.valueLabel ?? valueFmt(it.value))}</text>`;
            body += `<rect class="viz-hit" x="0" y="${y}" width="${W}" height="${row}" ${tip(it.tip ?? it.valueLabel ?? valueFmt(it.value), it.full ?? it.label)}/></g>`;
        });
        el.innerHTML = svg(W, H, body, label);
        restore(el);
    }

    // ---------- line with area wash and crosshair ----------
    // points: [{ label, value }]
    function line(el, { points, height = 220, valueFmt = fmt, label = "", color = "var(--viz-main)", yMin, yMax, area = true, dots = false }) {
        const W = widthOf(el), H = height;
        const m = { t: 18, r: 14, b: 26, l: 34 };
        const pw = W - m.l - m.r, ph = H - m.t - m.b;
        const vs = points.map((p) => p.value).filter((v) => v != null);
        const lo = yMin ?? 0;
        const t = ticks((yMax ?? Math.max(...vs, 0)) - lo);
        const top = yMax ?? lo + t.top;
        const y = (v) => m.t + ph - ((v - lo) / (top - lo)) * ph;
        const x = (i) => m.l + (points.length < 2 ? pw / 2 : (i / (points.length - 1)) * pw);
        const tl = { list: t.list.map((v) => v + lo).filter((v) => v <= top), top };
        let body = yAxis(tl, m.l, W - m.r, y, valueFmt);
        const segs = [];
        let cur = [];
        points.forEach((p, i) => {
            if (p.value == null) {
                if (cur.length) segs.push(cur);
                cur = [];
            } else cur.push([x(i), y(p.value)]);
        });
        if (cur.length) segs.push(cur);
        for (const s of segs) {
            const d = s.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
            if (area && s.length > 1)
                body += `<path class="viz-area" d="${d}L${s[s.length - 1][0]},${y(lo)}L${s[0][0]},${y(lo)}Z" style="fill:${color}"/>`;
            body += `<path class="viz-line" d="${d}" style="stroke:${color}"/>`;
        }
        if (dots)
            points.forEach((p, i) => {
                if (p.value != null) body += `<circle class="viz-dot" cx="${x(i)}" cy="${y(p.value)}" r="4" style="fill:${color}"/>`;
            });
        // x labels: points flagged `tick` (or all of them), thinned to fit the width
        const room = Math.max(1, Math.floor(pw / 48));
        const cand = points.map((p, i) => i).filter((i) => points[i].tick ?? true);
        const every = Math.max(1, Math.ceil(cand.length / room));
        cand.forEach((i, k) => {
            if (k % every === 0) body += `<text class="viz-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(points[i].tickLabel ?? points[i].label)}</text>`;
        });
        const last = points.map((p, i) => [p, i]).filter(([p]) => p.value != null).pop();
        if (last)
            body += `<circle class="viz-dot" cx="${x(last[1])}" cy="${y(last[0].value)}" r="4" style="fill:${color}"/><text class="viz-value" x="${x(last[1]) - 8}" y="${y(last[0].value) - 10}" text-anchor="end">${esc(valueFmt(last[0].value))}</text>`;
        body += `<line class="viz-axis" x1="${m.l}" x2="${W - m.r}" y1="${y(lo)}" y2="${y(lo)}"/>`;
        body += `<g class="viz-pins"></g>`;
        body += `<g class="viz-cross" visibility="hidden"><line class="viz-crossline" y1="${m.t}" y2="${m.t + ph}"/><circle class="viz-dot" r="5" style="fill:${color}"/></g>`;
        body += `<rect class="viz-hover" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
        el.innerHTML = svg(W, H, body, label);
        const at = (e) => {
            const r = el.querySelector(".viz-hover").getBoundingClientRect();
            return Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1))));
        };
        pinnable(el, points, at, x, (i, labelled) => {
            const p = points[i];
            return `<line class="viz-pinline" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ph}"/>` +
                (p.value == null ? "" : `<circle class="viz-dot viz-pindot" cx="${x(i)}" cy="${y(p.value)}" r="5" style="fill:${color}"/>`) +
                (p.value == null || !labelled ? "" : `<text class="viz-value viz-pinvalue" x="${x(i)}" y="${m.t - 5}" text-anchor="middle">${esc(valueFmt(p.value))}</text>`);
        });

        const hover = el.querySelector(".viz-hover"), cross = el.querySelector(".viz-cross");
        const [ln, dot] = cross.children;
        hover.addEventListener("pointermove", (e) => {
            const r = hover.getBoundingClientRect();
            const i = Math.round(((e.clientX - r.left) / r.width) * (points.length - 1));
            const p = points[Math.max(0, Math.min(points.length - 1, i))];
            const idx = points.indexOf(p);
            ln.setAttribute("x1", x(idx));
            ln.setAttribute("x2", x(idx));
            if (p.value != null) {
                dot.setAttribute("cx", x(idx));
                dot.setAttribute("cy", y(p.value));
            }
            dot.setAttribute("visibility", p.value == null ? "hidden" : "visible");
            cross.setAttribute("visibility", "visible");
            Tip.show(e, p.value == null ? "–" : valueFmt(p.value), p.full ?? p.label);
        });
        hover.addEventListener("pointerleave", () => {
            cross.setAttribute("visibility", "hidden");
            Tip.hide();
        });
    }

    // ---------- donut + legend ----------
    // items: [{ label, value, color }]
    function donut(el, { items, label = "", center, centerLabel, valueFmt = fmt }) {
        const total = items.reduce((a, b) => a + b.value, 0);
        const S = 200, R = 92, r = 60, c = S / 2;
        const gap = items.filter((i) => i.value > 0).length > 1 ? 0.02 : 0; // 2px-ish surface gap between segments
        let a0 = -Math.PI / 2, body = "";
        const pt = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`;
        for (const it of items) {
            if (!(it.value > 0)) continue;
            const frac = it.value / total;
            let a1 = a0 + frac * Math.PI * 2;
            if (frac >= 0.9999) a1 = a0 + Math.PI * 2 - 0.0001;
            const s = a0 + gap / 2, e = a1 - gap / 2;
            const large = e - s > Math.PI ? 1 : 0;
            const d = `M${pt(R, s)}A${R},${R} 0 ${large} 1 ${pt(R, e)}L${pt(r, e)}A${r},${r} 0 ${large} 0 ${pt(r, s)}Z`;
            body += `<path class="viz-mark viz-seg" d="${d}" style="fill:${it.color}" ${key(it.label)} ${tip(`${valueFmt(it.value)} · ${fmt((frac * 100), 1)}%`, it.label)}/>`;
            a0 = a1;
        }
        body += `<text class="viz-center" x="${c}" y="${c - 4}" text-anchor="middle">${esc(center ?? fmt(total))}</text>`;
        body += `<text class="viz-center-label" x="${c}" y="${c + 18}" text-anchor="middle">${esc(centerLabel ?? "total")}</text>`;
        const legend = items
            .filter((i) => i.value > 0)
            .map(
                (it) =>
                    `<li ${key(it.label)} ${tip(`${valueFmt(it.value)} · ${fmt((it.value / total) * 100, 1)}%`, it.label)}><span class="viz-key" style="background:${it.color}"></span><span class="viz-legend-name">${esc(it.label)}</span><span class="viz-legend-value">${fmt((it.value / total) * 100, 0)}%</span></li>`,
            )
            .join("");
        el.innerHTML = `<div class="viz-donut"><svg class="viz-svg" viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(label)}">${body}</svg><ul class="viz-legend">${legend}</ul></div>`;
        restore(el);
    }

    // ---------- heatmap ----------
    // rows/cols: label arrays; value(ri, ci) -> number; tipFor(ri, ci, v) -> [value, label]
    function heatmap(el, { rows, cols, value, tipFor, label = "", cell: cellMax = 26, colLabelEvery, rowLabelW = 44, diagonal }) {
        const W = widthOf(el);
        const size = Math.max(10, Math.min(cellMax, Math.floor((W - rowLabelW - 4) / cols.length)));
        const rowEvery = size < 14 ? 2 : 1; // small cells: label every other row so labels don't overlap
        const top = 20;
        const H = top + rows.length * size + 4;
        let max = 0;
        rows.forEach((_, ri) => cols.forEach((_, ci) => (max = Math.max(max, value(ri, ci) || 0))));
        let body = "";
        const every = colLabelEvery ?? Math.max(1, Math.ceil(28 / size));
        cols.forEach((cl, ci) => {
            if (ci % every === 0)
                body += `<text class="viz-tick" x="${rowLabelW + ci * size + size / 2}" y="${top - 7}" text-anchor="middle">${esc(cl)}</text>`;
        });
        rows.forEach((rl, ri) => {
            const yy = top + ri * size;
            if (ri % rowEvery === 0)
                body += `<text class="viz-tick" x="${rowLabelW - 6}" y="${yy + size / 2}" dy="0.32em" text-anchor="end">${esc(rl)}</text>`;
            cols.forEach((_, ci) => {
                const v = value(ri, ci) || 0;
                const step = v <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 5)); // 5 sequential steps
                const [tv, tl] = tipFor ? tipFor(ri, ci, v) : [fmt(v), `${rl} · ${cols[ci]}`];
                const off = diagonal && ri === ci;
                body += `<rect class="viz-cell${off ? " is-diagonal" : ""}" data-step="${step}" x="${rowLabelW + ci * size + 1}" y="${yy + 1}" width="${size - 2}" height="${size - 2}" rx="${Math.min(4, size / 5)}" ${off ? "" : `${tip(tv, tl)} ${key(`${ri}:${ci}`)}`}/>`;
            });
        });
        el.innerHTML = svg(Math.max(W, rowLabelW + cols.length * size), H, body, label) + scaleLegend(max);
        restore(el);
    }
    function scaleLegend(max) {
        return `<div class="viz-scale" aria-hidden="true"><span>0</span>${[1, 2, 3, 4, 5].map((s) => `<i data-step="${s}"></i>`).join("")}<span>${fmt(max)}</span></div>`;
    }

    // ---------- scatter / bubble ----------
    // points: [{ x, y, label, color?, n? }]; bubbles: points share a spot and n sizes the dot
    function scatter(el, { points, xDomain, yDomain, xLabel = "", yLabel = "", height = 260, label = "", xFmt = fmt, yFmt = fmt, xTicks, yTicks, jitter = 0, bubbles = false, xSqrt = false, ySqrt = false, diagonal = false, yLabelW = 40 }) {
        const W = widthOf(el), H = height;
        const m = { t: 14, r: 14, b: 40, l: yLabelW };
        const pw = W - m.l - m.r, ph = H - m.t - m.b;
        const [x0, x1] = xDomain, [y0, y1] = yDomain;
        const sx = xSqrt ? (v) => Math.sqrt(Math.max(0, v)) : (v) => v;
        const x = (v) => m.l + ((sx(v) - sx(x0)) / (sx(x1) - sx(x0))) * pw;
        const sy = ySqrt ? (v) => Math.sqrt(Math.max(0, v)) : (v) => v;
        const y = (v) => m.t + ph - ((sy(v) - sy(y0)) / (sy(y1) - sy(y0))) * ph;
        let body = "";
        for (const v of yTicks) body += `<line class="viz-gridline" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="viz-tick" x="${m.l - 6}" y="${y(v)}" dy="0.32em" text-anchor="end">${esc(yFmt(v))}</text>`;
        for (const v of xTicks) body += `<text class="viz-tick" x="${x(v)}" y="${m.t + ph + 16}" text-anchor="middle">${esc(xFmt(v))}</text>`;
        body += `<line class="viz-axis" x1="${m.l}" x2="${W - m.r}" y1="${m.t + ph}" y2="${m.t + ph}"/>`;
        body += `<text class="viz-axis-title" x="${m.l + pw / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
        body += `<text class="viz-axis-title" transform="translate(11 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
        if (diagonal) {
            // y = x, e.g. "got back what you paid"
            const lo = Math.max(x0, y0), hi = Math.min(x1, y1);
            body += `<line class="viz-ref" x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}"/><text class="viz-axis-title" x="${x(hi) - 4}" y="${y(hi) + 14}" text-anchor="end">${esc(diagonal === true ? "y = x" : diagonal)}</text>`;
        }
        const maxN = Math.max(1, ...points.map((p) => p.n ?? 1));
        // deterministic jitter so redraws don't shuffle the dots
        const jit = (i, k) => (((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1) - 0.5) * 2 * jitter;
        points.forEach((p, i) => {
            const cx = x(p.x) + (bubbles ? 0 : jit(i, 1) * 3), cy = y(p.y + (bubbles ? 0 : jit(i, 2)));
            const rr = bubbles ? 4 + Math.sqrt((p.n ?? 1) / maxN) * 14 : 4;
            body += `<g class="viz-item" ${key(i)}><circle class="viz-mark viz-dot${bubbles ? " is-bubble" : ""}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" style="fill:${p.color ?? "var(--viz-main)"}"/>`;
            body += `<circle class="viz-hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${Math.max(12, rr + 2)}" ${tip(p.tipV ?? `${xLabel} ${xFmt(p.x)} · ${yLabel} ${yFmt(p.y)}`, p.label)}/></g>`;
        });
        el.innerHTML = svg(W, H, body, label);
        restore(el);
    }


    // ---------- several lines on one axis ----------
    // points: [{ label, tick?, tickLabel? }]; series: [{ name, color, values: [n|null, …] }]
    function lines(el, { points, series, height = 240, valueFmt = fmt, label = "", yMin = 0 }) {
        const W = widthOf(el), H = height;
        const m = { t: 18, r: 14, b: 26, l: 44 };
        const pw = W - m.l - m.r, ph = H - m.t - m.b;
        const vs = series.flatMap((s) => s.values).filter((v) => v != null);
        const t = ticks(Math.max(...vs, 0) - yMin);
        const top = yMin + t.top;
        const y = (v) => m.t + ph - ((v - yMin) / (top - yMin)) * ph;
        const x = (i) => m.l + (points.length < 2 ? pw / 2 : (i / (points.length - 1)) * pw);
        let body = yAxis({ list: t.list.map((v) => v + yMin) }, m.l, W - m.r, y, valueFmt);
        for (const s of series) {
            const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
            if (pts.length > 1) body += `<path class="viz-line" d="${pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("")}" style="stroke:${s.color}" ${ser(s.name)}/>`;
            const lastI = s.values.map((v, i) => (v == null ? -1 : i)).filter((i) => i >= 0).pop();
            if (lastI != null) body += `<circle class="viz-dot" cx="${x(lastI)}" cy="${y(s.values[lastI])}" r="4" style="fill:${s.color}" ${ser(s.name)}/>`;
            if (pts.length === 1 && points.length > 1) body += `<circle class="viz-dot" cx="${pts[0][0]}" cy="${pts[0][1]}" r="4" style="fill:${s.color}" ${ser(s.name)}/>`;
        }
        const room = Math.max(1, Math.floor(pw / 56));
        const cand = points.map((p, i) => i).filter((i) => points[i].tick ?? true);
        const every = Math.max(1, Math.ceil(cand.length / room));
        cand.forEach((i, k) => {
            if (k % every === 0) body += `<text class="viz-tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(points[i].tickLabel ?? points[i].label)}</text>`;
        });
        body += `<line class="viz-axis" x1="${m.l}" x2="${W - m.r}" y1="${y(yMin)}" y2="${y(yMin)}"/>`;
        body += `<g class="viz-pins"></g>`;
        body += `<g class="viz-cross" visibility="hidden"><line class="viz-crossline" y1="${m.t}" y2="${m.t + ph}"/></g>`;
        body += `<rect class="viz-hover" x="${m.l - 8}" y="${m.t}" width="${pw + 16}" height="${ph}" fill="transparent"/>`;
        el.innerHTML = svg(W, H, body, label);
        const at = (e) => {
            const r = el.querySelector(".viz-hover").getBoundingClientRect();
            return Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - 8) / (r.width - 16)) * (points.length - 1))));
        };
        pinnable(el, points, at, x, (i) =>
            `<line class="viz-pinline" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${m.t + ph}"/>` +
            series.map((s) => (s.values[i] == null ? "" : `<circle class="viz-dot viz-pindot" cx="${x(i)}" cy="${y(s.values[i])}" r="5" style="fill:${s.color}" ${ser(s.name)}/>`)).join(""));

        const hover = el.querySelector(".viz-hover"), cross = el.querySelector(".viz-cross"), ln = cross.firstChild;
        hover.addEventListener("pointermove", (e) => {
            const r = hover.getBoundingClientRect();
            const i = Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left - 8) / (r.width - 16)) * (points.length - 1))));
            ln.setAttribute("x1", x(i));
            ln.setAttribute("x2", x(i));
            cross.setAttribute("visibility", "visible");
            // one readout listing every series at this x
            Tip.show(e, points[i].full ?? points[i].label, series.map((s) => `${s.name}: ${s.values[i] == null ? "–" : valueFmt(s.values[i])}`).join("\n"));
        });
        hover.addEventListener("pointerleave", () => {
            cross.setAttribute("visibility", "hidden");
            Tip.hide();
        });
    }

    // ---------- diverging bars around zero (gains right, losses left) ----------
    // items: [{ label, value, valueLabel?, tip?, full? }]
    function divbars(el, { items, valueFmt = fmt, label = "" }) {
        const W = widthOf(el);
        const row = 28, labelW = Math.min(170, Math.round(W * 0.36));
        const valueW = Math.max(44, ...items.map((it) => String(it.valueLabel ?? valueFmt(it.value)).length * 7 + 10));
        const span = Math.max(...items.map((i) => Math.abs(i.value)), 0) || 1;
        const pw = W - labelW - 2 * valueW;
        const hasNeg = items.some((i) => i.value < 0), hasPos = items.some((i) => i.value > 0);
        // zero sits in the middle only when both signs are present
        const zero = labelW + valueW + (hasNeg && hasPos ? pw / 2 : hasNeg ? pw : 0);
        const scale = (hasNeg && hasPos ? pw / 2 : pw) / span;
        const H = items.length * row + 4;
        let body = `<line class="viz-axis" x1="${zero}" x2="${zero}" y1="0" y2="${H}"/>`;
        items.forEach((it, i) => {
            const y = i * row + 4, w = Math.max(2, Math.abs(it.value) * scale);
            const name = fit(it.label, labelW - 12);
            const pos = it.value >= 0;
            const d = pos ? hbar(zero, y + 3, w, 18) : `M${zero},${y + 3}H${zero - w + 4}Q${zero - w},${y + 3} ${zero - w},${y + 7}V${y + 17}Q${zero - w},${y + 21} ${zero - w + 4},${y + 21}H${zero}Z`;
            body += `<g class="viz-item" ${key(it.full ?? it.label)}>${selRow(0, y, W, row)}<text class="viz-label" x="${labelW - 8}" y="${y + 12}" dy="0.32em" text-anchor="end">${esc(name)}</text>`;
            body += `<path class="viz-mark" d="${d}" style="fill:${pos ? "var(--viz-pos)" : "var(--viz-neg)"}"/>`;
            body += `<text class="viz-value" x="${pos ? zero + w + 6 : zero - w - 6}" y="${y + 12}" dy="0.32em" text-anchor="${pos ? "start" : "end"}">${esc(it.valueLabel ?? valueFmt(it.value))}</text>`;
            body += `<rect class="viz-hit" x="0" y="${y}" width="${W}" height="${row}" ${tip(it.tip ?? it.valueLabel ?? valueFmt(it.value), it.full ?? it.label)}/></g>`;
        });
        el.innerHTML = svg(W, H, body, label);
        restore(el);
    }

    // ---------- dumbbell: two values per row, joined ----------
    // items: [{ label, a, b, valueLabel, tip, full }]; series: [{ name, color }, { name, color }] for a and b.
    // One row per item, a dot for each value on a shared axis (ticks top and bottom, since it can be tall).
    function dumbbell(el, { items, series, xTicks, xFmt = fmt, sqrt = false, label = "" }) {
        const W = widthOf(el);
        const row = 26, axisH = 22;
        const labelW = Math.min(280, Math.round(W * 0.34));
        const valueW = Math.max(48, ...items.map((it) => String(it.valueLabel ?? "").length * 7 + 12));
        const x0 = labelW, x1 = W - valueW - 10;
        const top = Math.max(...xTicks, ...items.flatMap((i) => [i.a, i.b]));
        const s = sqrt ? (v) => Math.sqrt(Math.max(0, v)) : (v) => v;
        const x = (v) => x0 + (s(v) / s(top)) * (x1 - x0);
        const H = axisH * 2 + items.length * row;
        const bottom = axisH + items.length * row;
        let body = "";
        items.forEach((_, i) => {
            if (i % 2 === 0) body += `<rect class="viz-band" x="0" y="${axisH + i * row}" width="${W}" height="${row}"/>`;
        });
        for (const v of xTicks) {
            const xx = x(v);
            body += `<line class="viz-gridline" x1="${xx}" x2="${xx}" y1="${axisH - 4}" y2="${bottom + 4}"/>`;
            body += `<text class="viz-tick" x="${xx}" y="${axisH - 9}" text-anchor="middle">${esc(xFmt(v))}</text>`;
            body += `<text class="viz-tick" x="${xx}" y="${bottom + 16}" text-anchor="middle">${esc(xFmt(v))}</text>`;
        }
        const [A, B] = series;
        items.forEach((it, i) => {
            const y = axisH + i * row, cy = y + row / 2;
            const xa = x(it.a), xb = x(it.b);
            body += `<g class="viz-item" ${key(it.full ?? it.label)}>${selRow(0, y, W, row)}<text class="viz-label" x="${labelW - 10}" y="${cy}" dy="0.32em" text-anchor="end">${esc(fit(it.label, labelW - 14))}</text>`;
            if (Math.abs(xb - xa) > 1) body += `<line class="viz-mark viz-link" x1="${xa.toFixed(1)}" x2="${xb.toFixed(1)}" y1="${cy}" y2="${cy}"/>`;
            body += `<circle class="viz-mark viz-dot" cx="${xa.toFixed(1)}" cy="${cy}" r="5.5" style="fill:${A.color}" ${ser(A.name)}/>`;
            body += `<circle class="viz-mark viz-dot" cx="${xb.toFixed(1)}" cy="${cy}" r="5.5" style="fill:${B.color}" ${ser(B.name)}/>`;
            if (it.valueLabel) body += `<text class="viz-value" x="${W - 4}" y="${cy}" dy="0.32em" text-anchor="end">${esc(it.valueLabel)}</text>`;
            body += `<rect class="viz-hit" x="0" y="${y}" width="${W}" height="${row}" ${tip(it.tip ?? `${A.name} ${xFmt(it.a)} · ${B.name} ${xFmt(it.b)}`, it.full ?? it.label)}/></g>`;
        });
        el.innerHTML = svg(W, H, body, label);
        restore(el);
    }

    // ---------- legend for multi-series charts ----------
    const legend = (series) =>
        `<ul class="viz-legend viz-legend-row">${series.map((s) => `<li ${ser(s.name)}><span class="viz-key" style="background:${s.color}"></span><span class="viz-legend-name">${esc(s.name)}</span></li>`).join("")}</ul>`;

    // ---------- table view ----------
    function table(head, rows) {
        return `<table class="viz-table"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
            .map((r) => `<tr>${r.map((c, i) => (i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join("")}</tr>`)
            .join("")}</tbody></table>`;
    }

    // ---------- click to highlight ----------
    // Clicking a mark (a bar, a row, a column, a dot, a slice, a cell) highlights it; clicking it again clears it, and
    // several can be on at once. On a line chart a click pins the readout at that point instead. Highlights are kept
    // per chart by key, so a redraw (a resize, or re-sorting the Paid vs CeX chart) keeps them on the same things.
    // Clicking a legend entry brings that series forward in its card (and dims the rest); click again to undo.
    const marked = new WeakMap(); // chart container -> Set of keys
    const keysOf = (el) => {
        if (!marked.has(el)) marked.set(el, new Set());
        return marked.get(el);
    };
    function restore(el) {
        el.dataset.vizHost = "";
        const on = marked.get(el);
        if (on?.size) el.querySelectorAll("[data-k]").forEach((n) => n.classList.toggle("is-marked", on.has(n.dataset.k)));
        focusSeries(el.closest(".viz-card"));
        syncClear(el.closest(".viz-card"));
    }
    // the series picked in a card's legend stand out on its chart
    function focusSeries(card) {
        if (!card) return;
        const focus = new Set([...card.querySelectorAll(".viz-legend-row li.is-focus")].map((x) => x.dataset.s));
        card.classList.toggle("has-focus", focus.size > 0);
        card.querySelectorAll(".viz-svg [data-s]").forEach((m) => m.classList.toggle("is-focus", focus.has(m.dataset.s)));
    }
    // line charts: pin(i, labelled) draws the pinned readout at point i, keyed by the point's label. A pin too close
    // to the one before it (x(i) in px) leaves its value out, so labels never pile up on each other.
    const pinners = new WeakMap(), pinDraws = new WeakMap();
    function pinnable(el, points, at, x, pin) {
        el.dataset.vizHost = "";
        const keyOf = (i) => String(points[i].full ?? points[i].label);
        const draw = () => {
            const on = keysOf(el);
            let lastX = -Infinity;
            el.querySelector(".viz-pins").innerHTML = points
                .map((_, i) => {
                    if (!on.has(keyOf(i))) return "";
                    const room = x(i) - lastX >= 40;
                    if (room) lastX = x(i);
                    return pin(i, room);
                })
                .join("");
            focusSeries(el.closest(".viz-card"));
            syncClear(el.closest(".viz-card"));
        };
        pinners.set(el, (e) => {
            const k = keyOf(at(e)), on = keysOf(el);
            on.has(k) ? on.delete(k) : on.add(k);
            draw();
        });
        pinDraws.set(el, draw);
        draw();
    }

    // A card with anything highlighted in it (marks, pins, a picked series, table rows) gets a "Clear highlights"
    // button in its header; it clears them all and goes away again.
    function syncClear(card) {
        if (!card) return;
        const any = !!card.querySelector(".is-marked, .viz-pinline, .viz-legend-row li.is-focus");
        let btn = card.querySelector(".viz-clear");
        if (!btn && any) {
            btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip viz-clear";
            btn.textContent = "Clear highlights";
            (card.querySelector(".viz-head") ?? card).prepend(btn);
        }
        if (btn) btn.hidden = !any;
    }
    function clearCard(card) {
        card.querySelectorAll("[data-viz-host]").forEach((host) => {
            marked.get(host)?.clear();
            pinDraws.get(host)?.();
        });
        card.querySelectorAll(".is-marked, .is-focus").forEach((n) => n.classList.remove("is-marked", "is-focus"));
        focusSeries(card);
        syncClear(card);
    }
    document.addEventListener("click", (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        const clear = t.closest(".viz-clear");
        if (clear) return clearCard(clear.closest(".viz-card"));
        const host = t.closest("[data-viz-host]");
        if (host && t.closest(".viz-hover")) return pinners.get(host)?.(e);
        const n = host && t.closest("[data-k]");
        if (n) {
            const on = keysOf(host), k = n.dataset.k;
            on.has(k) ? on.delete(k) : on.add(k);
            host.querySelectorAll("[data-k]").forEach((m) => m.dataset.k === k && m.classList.toggle("is-marked", on.has(k)));
            return syncClear(host.closest(".viz-card"));
        }
        // a series legend (drawn next to the chart, in the same card)
        const li = t.closest(".viz-legend-row li[data-s]");
        const card = li?.closest(".viz-card");
        if (!card) return;
        li.classList.toggle("is-focus");
        focusSeries(card);
        syncClear(card);
    });

    // ---------- shared tooltip ----------
    const Tip = (() => {
        let box;
        const ensure = () => {
            if (box) return box;
            box = document.createElement("div");
            box.className = "viz-tip";
            box.setAttribute("role", "status");
            box.innerHTML = `<strong></strong><span></span>`;
            document.body.appendChild(box);
            return box;
        };
        function show(e, value, labelText) {
            const b = ensure();
            b.firstChild.textContent = value;
            b.lastChild.textContent = labelText ?? "";
            b.classList.add("is-on");
            const pad = 14, r = b.getBoundingClientRect();
            let left = e.clientX + pad, top = e.clientY - r.height - pad;
            if (left + r.width > innerWidth - 8) left = e.clientX - r.width - pad;
            if (top < 8) top = e.clientY + pad;
            b.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
        }
        const hide = () => box?.classList.remove("is-on");
        document.addEventListener("pointermove", (e) => {
            const t = e.target.closest?.("[data-v]");
            if (t) show(e, t.dataset.v, t.dataset.l);
            else if (!e.target.closest?.(".viz-hover")) hide();
        });
        document.addEventListener("scroll", hide, { passive: true });
        return { show, hide };
    })();

    window.Charts = { columns, hbars, line, lines, divbars, dumbbell, donut, heatmap, scatter, legend, table, fmt, esc, syncClear };
})();
