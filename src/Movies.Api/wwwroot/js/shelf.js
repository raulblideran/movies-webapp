// Shared by the collection pages: how releases are labelled (and, once traded in or sold, how that reads), and
// the admin-only table view.
// Needs auth.js (for Auth.me and esc).

(function () {
    const esc = (v) =>
        String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const FORMATS = { Dvd: "DVD", BluRay: "Blu-ray", UltraHdBluRay: "4K Blu-ray" };
    const EDITIONS = { Standard: "Standard", Steelbook: "Steelbook", BoxSet: "Box set" };
    // where a release was bought, in the order the editor lists them
    const PLACES = { Cex: "CeX", Hmv: "HMV", Ebay: "eBay", Zavvi: "Zavvi", Amazon: "Amazon", ForbiddenPlanet: "Forbidden Planet", DoorwayToDorkness: "Doorway to Dorkness", Other: "Other" };
    // "4K Blu-ray Steelbook"; a standard edition is just the format
    const label = (r) => `${FORMATS[r.format] ?? r.format}${r.edition && r.edition !== "Standard" ? ` ${EDITIONS[r.edition] ?? r.edition}` : ""}`;
    // Each format's colour: the theme's chart slot (0 = --chart-1), the same in the Stats charts. 4K gold, Blu-ray blue, DVD green.
    const FORMAT_SLOT = { UltraHdBluRay: 0, BluRay: 1, Dvd: 2 };
    // A release's chip, coloured by its format; a steelbook has a sheen, a box set looks stacked (css: .tag-fmt).
    // text: the label (default "4K Blu-ray Steelbook"); edition: false for a chip about the format alone.
    function formatTag(r, { text = label(r), edition = true } = {}) {
        const kind = { Dvd: "dvd", BluRay: "bluray", UltraHdBluRay: "uhd" }[r.format] ?? "other";
        const ed = !edition ? "" : r.edition === "Steelbook" ? " tag-steelbook" : r.edition === "BoxSet" ? " tag-boxset" : "";
        return `<span class="tag tag-fmt tag-${kind}${ed}">${esc(text)}</span>`;
    }
    // A title's part of what its releases cost (a box set's price is shared between its titles). Null when nothing has a price.
    const titleShare = (title) => {
        const priced = title.releases.filter((r) => r.pricePaid != null);
        return priced.length ? priced.reduce((s, r) => s + r.pricePaid / Math.max(1, r.titleCount), 0) : null;
    };
    const money = (v) => (v == null ? "" : `£${Number(v).toFixed(2)}`);

    // ---------- traded in or sold ----------
    // A release with .soldVia has left the shelf: where it went, when (.soldOn), for how much (.soldFor) and, for a
    // CeX trade-in, whether it was cash or voucher (.payout). It's kept as history.

    // where a release can go, in the order the editor lists them
    const CHANNELS = { Cex: "CeX", Ebay: "eBay", FacebookMarketplace: "Facebook Marketplace", Other: "Somewhere else" };
    const SHORT_CHANNELS = { ...CHANNELS, FacebookMarketplace: "FB Marketplace", Other: "Other" };
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    // "3 Nov 2026"
    const day = (iso) => {
        if (!iso) return "";
        const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
        return `${d} ${MONTHS[m - 1]} ${y}`;
    };
    const isSold = (r) => !!r?.soldVia;
    // "Traded in" for CeX, "Sold" for the rest
    const saleVerb = (r) => (r.soldVia === "Cex" ? "Traded in" : "Sold");
    // the card badge: "Traded in · CeX", "Sold · eBay", "Sold · FB Marketplace", "Sold"
    const saleBadge = (r) => (r.soldVia === "Other" ? "Sold" : `${saleVerb(r)} · ${SHORT_CHANNELS[r.soldVia] ?? r.soldVia}`);
    // "£2.00 cash", "£3.00 in vouchers", "£4.50"
    const salePrice = (r) => (r.soldFor == null ? "" : `${money(r.soldFor)}${r.soldVia === "Cex" && r.payout ? (r.payout === "Voucher" ? " in vouchers" : " cash") : ""}`);
    // "Traded in to CeX on 3 Nov 2026 for £2.00 cash", "Sold on eBay on 3 Nov 2026 for £4.50", "Sold on 3 Nov 2026"
    function saleLine(r) {
        const where = { Cex: "Traded in to CeX", Ebay: "Sold on eBay", FacebookMarketplace: "Sold on Facebook Marketplace" }[r.soldVia] ?? "Sold";
        return `${where}${r.soldOn ? ` on ${day(r.soldOn)}` : ""}${r.soldFor != null ? ` for ${salePrice(r)}` : ""}`;
    }
    // what came back less what it cost; null without both prices
    const saleNet = (r) => (r.soldFor != null && r.pricePaid != null ? r.soldFor - r.pricePaid : null);
    // "+£1.50", "−£3.00"
    const signed = (n) => (n == null ? "" : `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`);
    // The daily CeX snapshot nearest a sale: the latest on or before the day (up to a week before), otherwise the
    // first in the 3 days after. points: [{ date, sell, cash, exchange }], oldest first. Returns { point, days }
    // (days from the sale: negative before it), or null.
    function nearestPoint(points, soldOn) {
        if (!points?.length || !soldOn) return null;
        const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
        const sale = t(soldOn);
        const before = points.filter((p) => t(p.date) <= sale && sale - t(p.date) <= 7).pop();
        const after = before ? null : points.find((p) => t(p.date) > sale && t(p.date) - sale <= 3);
        const point = before ?? after;
        return point ? { point, days: Math.round(t(point.date) - sale) } : null;
    }
    // how long a disc was kept: "2 years 7 months", "5 months", "12 days"; null without both dates
    function kept(r) {
        if (!r.boughtOn || !r.soldOn) return null;
        const [y1, m1, d1] = r.boughtOn.split("-").map(Number);
        const [y2, m2, d2] = r.soldOn.split("-").map(Number);
        let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
        if (months < 1) {
            const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
            return days === 1 ? "1 day" : `${days} days`;
        }
        const years = Math.floor(months / 12);
        months %= 12;
        const part = (n, w) => (n ? `${n} ${w}${n === 1 ? "" : "s"}` : "");
        return [part(years, "year"), part(months, "month")].filter(Boolean).join(" ");
    }

    // ---------- table view ----------
    // columns: [{ key, label, value: row => sortable value, html?: row => cell html, num?: true, wrap?: true }]
    // The row last opened stays highlighted (by its id, so it survives re-sorting and saving), to show where you were.
    function renderTable(container, { rows, columns, sort, onSort, onRow, caption }) {
        const marked = container.dataset.marked;
        const col = columns.find((c) => c.key === sort?.key);
        const sorted = col
            ? [...rows].sort((a, b) => {
                  const x = col.value(a), y = col.value(b);
                  const empty = (v) => v == null || v === "";
                  if (empty(x) !== empty(y)) return empty(x) ? 1 : -1; // blanks last either way
                  const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
                  return sort.dir === "desc" ? -c : c;
              })
            : rows;
        container.innerHTML = `
            <div class="data-table-wrap">
                <table class="data-table">
                    ${caption ? `<caption class="sr-only">${esc(caption)}</caption>` : ""}
                    <thead><tr>${columns
                        .map((c) => {
                            const on = c.key === sort?.key;
                            return `<th scope="col"${c.num ? ' class="num"' : ""} aria-sort="${on ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}"><button type="button" data-sort-key="${c.key}">${esc(c.label)}<span aria-hidden="true">${on ? (sort.dir === "desc" ? " ▼" : " ▲") : ""}</span></button></th>`;
                        })
                        .join("")}</tr></thead>
                    <tbody>${sorted
                        .map(
                            (r, i) =>
                                `<tr tabindex="0" data-i="${i}"${r.id != null && String(r.id) === marked ? ' class="is-marked"' : ""}>${columns
                                    .map((c, k) => {
                                        const v = c.html ? c.html(r) : esc(c.value(r) ?? "");
                                        const cls = [c.num && "num", c.wrap && "wrap"].filter(Boolean).join(" ");
                                        return k === 0 ? `<th scope="row">${v}</th>` : `<td${cls ? ` class="${cls}"` : ""}>${v}</td>`;
                                    })
                                    .join("")}</tr>`,
                        )
                        .join("")}</tbody>
                </table>
            </div>`;
        container.querySelectorAll("[data-sort-key]").forEach((b) => {
            b.onclick = () => {
                const key = b.dataset.sortKey;
                onSort({ key, dir: sort?.key === key && sort.dir === "asc" ? "desc" : "asc" });
            };
        });
        container.querySelectorAll("tbody tr").forEach((tr) => {
            const open = () => {
                const row = sorted[Number(tr.dataset.i)];
                container.querySelectorAll("tbody tr.is-marked").forEach((m) => m.classList.remove("is-marked"));
                tr.classList.add("is-marked");
                if (row.id != null) container.dataset.marked = String(row.id);
                onRow?.(row, sorted);
            };
            tr.onclick = open;
            tr.onkeydown = (e) => {
                if (e.key === "Enter") open();
            };
        });
        return sorted;
    }

    // Grid / table switch, shown to admins only. The choice is remembered per page in this browser.
    function viewToggle(slot, page, onChange) {
        const key = `view:${page}`;
        const read = () => {
            try {
                return localStorage.getItem(key) === "table" ? "table" : "grid";
            } catch {
                return "grid";
            }
        };
        let view = "grid";
        function render() {
            const admin = window.Auth?.me?.isAdmin;
            view = admin ? read() : "grid";
            slot.innerHTML = admin
                ? `<div class="segmented" role="group" aria-label="View">
                       <button type="button" data-view="grid" aria-pressed="${view === "grid"}">Grid</button>
                       <button type="button" data-view="table" aria-pressed="${view === "table"}">Table</button>
                   </div>`
                : "";
            slot.querySelectorAll("[data-view]").forEach((b) => {
                b.onclick = () => {
                    try {
                        localStorage.setItem(key, b.dataset.view);
                    } catch {
                        // storage unavailable: the choice lasts until the page is closed
                    }
                    render();
                    onChange(view);
                };
            });
        }
        document.addEventListener("auth-changed", () => {
            const before = view;
            render();
            if (view !== before) onChange(view);
        });
        render();
        return { get: () => view };
    }

    // When CeX refused the site, it stops asking for 6 hours. Says so under a CeX price (or the lack of one),
    // with "Ask CeX now" for editors; retry() asks again once the pause is lifted.
    async function cexPause(container, retry) {
        let until = null;
        try {
            until = (await (await fetch("/api/cex/status", { credentials: "same-origin" })).json()).pausedUntil;
        } catch {}
        if (!until || !container.isConnected) return;
        const at = new Date(until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        const note = document.createElement("div");
        note.className = "cex-paused";
        note.innerHTML = `<p>CeX turned the site away for asking too often, so it isn't asking again until ${esc(at)}.</p>${
            window.Auth?.me?.canEdit ? `<button type="button" class="btn btn-small">Ask CeX now</button>` : ""}`;
        note.querySelector("button")?.addEventListener("click", async (e) => {
            e.currentTarget.disabled = true;
            try {
                await Auth.api("POST", "/api/cex/resume");
                retry();
            } catch (err) {
                note.querySelector("p").textContent = err.message;
            }
        });
        container.appendChild(note);
    }

    window.Shelf = {
        FORMATS, EDITIONS, PLACES, CHANNELS, FORMAT_SLOT, label, formatTag, titleShare, money, esc, renderTable, viewToggle,
        day, isSold, saleVerb, saleBadge, salePrice, saleLine, saleNet, signed, kept, nearestPoint, cexPause,
    };
})();
