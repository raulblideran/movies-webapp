// Coming soon, on the Watchlist page: films not out yet from franchises you've started and the directors
// you watch most (/api/coming-soon, worked out on the server twice a day). Ones with a date come first, in
// date order; the ones only announced are folded away. An editor can put any of them on the watchlist.
// The section can be hidden, and stays hidden in this browser.

(function () {
    const section = document.getElementById("comingSoon");
    if (!section) return;
    const body = document.getElementById("comingSoonBody");
    const toggle = document.getElementById("comingSoonToggle");
    const esc = (v) => App.escapeHtml(v);
    const KEY = "comingSoon:hidden";
    let items = [];

    const storage = {
        get: () => {
            try {
                return localStorage.getItem(KEY) === "1";
            } catch {
                return false;
            }
        },
        set: (v) => {
            try {
                v ? localStorage.setItem(KEY, "1") : localStorage.removeItem(KEY);
            } catch {
                // storage unavailable: it's shown next time
            }
        },
    };

    function setHidden(hidden) {
        body.hidden = hidden;
        toggle.textContent = hidden ? `Show${items.length ? ` (${shown().length})` : ""}` : "Hide";
        toggle.setAttribute("aria-expanded", String(!hidden));
        section.classList.toggle("is-collapsed", hidden);
    }
    toggle.onclick = () => {
        const hidden = !body.hidden;
        storage.set(hidden);
        setHidden(hidden);
    };

    const { untilText, dateText } = Lists;

    // not the ones already on either list (added since the server worked the list out)
    function shown() {
        const have = new Set([...App.getAll(), ...App.getOther()].filter((t) => t.tmdbMediaType === "movie").map((t) => t.tmdbId));
        return items.filter((i) => !have.has(i.id));
    }

    function card(i) {
        const canAdd = !!window.Auth?.me?.canEdit;
        return `
            <article class="soon-card">
                <a class="soon-poster" href="https://www.themoviedb.org/movie/${i.id}" target="_blank" rel="noopener" title="${esc(i.title)} on TMDB">
                    ${i.posterUrl ? `<img src="${esc(i.posterUrl.replace("/w500/", "/w342/"))}" alt="" loading="lazy">` : `<span class="soon-blank">${esc(i.title)}</span>`}
                </a>
                <div class="soon-text">
                    <h3>${esc(i.title)}</h3>
                    <p class="soon-when">${i.releaseDate ? `<time datetime="${i.releaseDate}">${dateText(i.releaseDate)}</time> <span class="faint">· ${untilText(i.releaseDate)}</span>` : "Date not announced"}</p>
                    <p class="soon-why">${i.reasons.map(esc).join("<br>")}</p>
                    ${canAdd ? `<button type="button" class="btn btn-small" data-soon-add="${i.id}">+ Watchlist</button>` : ""}
                </div>
            </article>`;
    }

    function render() {
        const list = shown();
        section.classList.toggle("hidden", list.length === 0);
        if (!list.length) return;
        const dated = list.filter((i) => i.releaseDate);
        const tba = list.filter((i) => !i.releaseDate);
        body.innerHTML = `
            ${dated.length ? `<div class="soon-strip">${dated.map(card).join("")}</div>` : ""}
            ${tba.length ? `
            <details class="soon-tba"${dated.length ? "" : " open"}>
                <summary>Announced, no date yet <span class="count">${tba.length}</span></summary>
                <div class="soon-strip">${tba.map(card).join("")}</div>
            </details>` : ""}`;
        body.querySelectorAll("[data-soon-add]").forEach((b) => {
            b.onclick = async () => {
                const item = items.find((i) => i.id === Number(b.dataset.soonAdd));
                b.disabled = true;
                b.textContent = "Adding…";
                await App.addToWatchlist([{ id: item.id, title: item.title }]);
                render();
            };
        });
        setHidden(storage.get());
    }

    async function load() {
        try {
            const resp = await fetch("/api/coming-soon");
            if (!resp.ok) return;
            items = await resp.json();
            render();
        } catch {
            // nice to have: the watchlist works without it
        }
    }

    // after the watchlist itself, so the films already on it are left out; again once sign-in is known
    window.addEventListener("load", load);
    document.addEventListener("auth-changed", () => items.length && render());
})();
