// "Pick for me" on the watchlist: a random title from the ones on screen (so search and filters apply,
// e.g. films under 2h), revealed by a strip of posters that spins and slows to a stop. Needs auth.js,
// title-modal.js and app.js.

(function () {
    const button = document.getElementById("pickButton");
    if (!button) return;
    const { esc } = Auth;
    const TILE = 132; // a poster's width plus the gap, in px (matches .reel-tile in site.css)
    const SPIN_TILES = 28; // how far the strip travels before it lands
    let last = null; // "Spin again" won't land on the same title twice running
    let d = null;

    const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const randomOf = (xs) => xs[Math.floor(Math.random() * xs.length)];

    const tile = (r) => `
        <div class="reel-tile">${r.posterUrl ? `<img src="${esc(r.posterUrl.replace("/w500/", "/w185/"))}" alt="">` : `<span>${esc(r.name)}</span>`}</div>`;

    function resultHtml(r) {
        const facts = [r.type, r.releaseYear, TitleModal.runtimeText(r), r.genres.slice(0, 3).join(", ")].filter(Boolean);
        return `
            <h3 class="reel-name">${esc(r.name)}</h3>
            <p class="reel-facts">${facts.map(esc).join(" · ")}</p>
            ${r.watchCount ? `<p class="reel-facts">You've seen it ${r.watchCount === 1 ? "once" : `${r.watchCount} times`}${r.rating != null ? `, and rated it ${r.rating}/10` : ""}.</p>` : ""}
            <div class="actions">
                <button type="button" class="btn" data-spin>Spin again</button>
                <button type="button" class="btn btn-primary" data-open>Open it</button>
            </div>`;
    }

    function spin() {
        const rows = App.getShown();
        if (!rows.length) return App.showError("Nothing to pick from: clear the search or some filters.");
        const pool = rows.length > 1 ? rows.filter((r) => r.id !== last) : rows;
        const chosen = randomOf(pool);
        last = chosen.id;

        // random posters, the pick, and a couple after it so it lands in the middle
        const strip = [...Array.from({ length: SPIN_TILES }, () => randomOf(rows)), chosen, randomOf(rows), randomOf(rows)];
        if (!d || !d.root.isConnected) {
            d = Auth.dialog("Pick for me", "", { wide: true });
            d.root.classList.add("pick-dialog");
        }
        d.body.innerHTML = `
            <p class="reel-from muted">From ${rows.length === 1 ? "the only title" : `${rows.length} titles`} on screen</p>
            <div class="reel" aria-hidden="true">
                <div class="reel-strip">${strip.map(tile).join("")}</div>
                <div class="reel-marker"></div>
            </div>
            <div class="reel-result" aria-live="polite"></div>`;

        const reel = d.$(".reel");
        const stripEl = d.$(".reel-strip");
        const result = d.$(".reel-result");
        // the pick's centre under the marker in the middle of the reel
        const target = SPIN_TILES * TILE - (reel.clientWidth / 2 - TILE / 2);
        const land = () => {
            stripEl.querySelectorAll(".reel-tile")[SPIN_TILES].classList.add("is-picked");
            result.innerHTML = resultHtml(chosen);
            result.querySelector("[data-spin]").onclick = spin;
            result.querySelector("[data-open]").onclick = () => {
                d.close();
                App.openModal(chosen);
            };
            result.querySelector("[data-open]").focus();
        };
        if (reducedMotion()) {
            stripEl.style.transform = `translateX(${-target}px)`;
            return land();
        }
        stripEl.getBoundingClientRect(); // start from 0 before moving
        stripEl.classList.add("is-spinning");
        stripEl.style.transform = `translateX(${-target}px)`;
        stripEl.addEventListener("transitionend", land, { once: true });
    }

    button.onclick = spin;
})();
