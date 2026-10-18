// Shared by the collection pages: how releases are labelled, and the admin-only table view.
// Needs auth.js (for Auth.me and esc).

(function () {
    const esc = (v) =>
        String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const FORMATS = { Dvd: "DVD", BluRay: "Blu-ray", UltraHdBluRay: "4K Blu-ray" };
    const EDITIONS = { Standard: "Standard", Steelbook: "Steelbook", BoxSet: "Box set" };
    // "4K Blu-ray Steelbook"; a standard edition is just the format
    const label = (r) => `${FORMATS[r.format] ?? r.format}${r.edition && r.edition !== "Standard" ? ` ${EDITIONS[r.edition] ?? r.edition}` : ""}`;
    // A title's part of what its releases cost (a box set's price is shared between its titles). Null when nothing has a price.
    const titleShare = (title) => {
        const priced = title.releases.filter((r) => r.pricePaid != null);
        return priced.length ? priced.reduce((s, r) => s + r.pricePaid / Math.max(1, r.titleCount), 0) : null;
    };
    const money = (v) => (v == null ? "" : `£${Number(v).toFixed(2)}`);

    // ---------- table view ----------
    // columns: [{ key, label, value: row => sortable value, html?: row => cell html, num?: true, wrap?: true }]
    function renderTable(container, { rows, columns, sort, onSort, onRow, caption }) {
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
                                `<tr tabindex="0" data-i="${i}">${columns
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
            const open = () => onRow?.(sorted[Number(tr.dataset.i)], sorted);
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

    window.Shelf = { FORMATS, EDITIONS, label, titleShare, money, esc, renderTable, viewToggle };
})();
