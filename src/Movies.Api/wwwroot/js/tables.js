// Click a row in any data table, or a stat tile, to highlight it; click it again to clear it. Several can be marked
// at once, to compare them. Loaded on every page; the colours come from the theme (see .is-marked in site.css).
// Charts highlight their own bars, dots and slices (js/charts.js).
// The admin table view (.data-table, js/shelf.js) opens a record on click instead, and marks that row itself.

(function () {
    const ROWS = ".viz-table tbody tr, .table tbody tr, .kpi";
    // clicks on the row's own controls do what they always did
    const CONTROLS = "a, button, input, select, textarea, label, summary, [role='button']";

    document.addEventListener("click", (e) => {
        const row = e.target.closest(ROWS);
        if (!row || e.target.closest(CONTROLS)) return;
        // dragging across a row to copy its text isn't a click on it
        if (String(window.getSelection?.() ?? "").trim()) return;
        row.classList.toggle("is-marked");
        // a table inside a Stats card shares the card's "Clear highlights" button (js/charts.js)
        window.Charts?.syncClear(row.closest(".viz-card"));
    });
})();
