// One watch, added or edited in a dialog: from the title popup, "Watched again" and the Watches page.
// Needs auth.js and datepicker.js, loaded before this file.
//
//   WatchDialog.open({ title, watch, titles, onSaved })
//     title     the title it's a watch of; null to pick one (the Watches page's "Add a watch", from titles)
//     watch     the watch to edit ({ id, date, withBogdan, inCinema, notes }), or null to add one
//     defaults  for a new watch: { date, withBogdan, inCinema, notes } (the date is today unless given)
//     onSaved(title, { watchId, deleted })   after a save or a delete, with the title as it is now
//
//   WatchDialog.pipsHtml(row)   one dot per watch, for cards and lists (dated in order, then undated)
//   WatchDialog.label(watch)    "12 Aug 2025", or "Date unknown"

(function () {
    const { api, dialog, busy, esc } = Auth;
    const pad = (n) => String(n).padStart(2, "0");
    const todayIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const longDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const label = (w) => {
        if (!w.date) return "Date unknown";
        const [y, m, d] = w.date.split("-").map(Number);
        return longDate.format(new Date(y, m - 1, d));
    };
    const normalise = (t) => window.Lists?.normalise(t) ?? t;

    function open({ title = null, watch = null, titles = [], defaults = {}, onSaved }) {
        const isNew = !watch;
        const w = watch ?? { date: todayIso(), withBogdan: false, inCinema: false, notes: "", ...defaults };
        const uid = Math.random().toString(36).slice(2, 8);
        const heading = isNew ? (title ? `Watched ${esc(title.name)}` : "Add a watch") : `A watch of ${esc(title.name)}`;
        const d = dialog(
            heading,
            `
            <div data-error class="alert alert-error hidden" role="alert"></div>
            <form class="stack watch-form">
                ${title ? "" : `
                <div class="title-pick">
                    <label class="label" for="wd-title-${uid}">Title</label>
                    <input id="wd-title-${uid}" name="titleSearch" class="input" autocomplete="off" placeholder="Start typing a title…" role="combobox" aria-expanded="false" aria-controls="wd-titles-${uid}">
                    <ul class="title-pick-list hidden" id="wd-titles-${uid}" role="listbox"></ul>
                </div>`}
                <div>
                    <label class="label" for="wd-date-${uid}">Date</label>
                    <input id="wd-date-${uid}" name="date" data-date class="input" value="${esc(w.date ?? "")}" aria-describedby="wd-date-hint-${uid}">
                    <p class="field-hint" id="wd-date-hint-${uid}">Leave it empty if you don't know when.</p>
                </div>
                <div class="watch-checks">
                    <label class="check"><input type="checkbox" name="withBogdan" ${w.withBogdan ? "checked" : ""}> With Bogdan</label>
                    <label class="check"><input type="checkbox" name="inCinema" ${w.inCinema ? "checked" : ""}> In the cinema</label>
                </div>
                <div>
                    <label class="label" for="wd-notes-${uid}">Notes</label>
                    <textarea id="wd-notes-${uid}" name="notes" rows="3" maxlength="2000" class="input" placeholder="Where, who with, what you thought this time…">${esc(w.notes ?? "")}</textarea>
                </div>
                <div class="actions">
                    ${isNew ? "" : `<button type="button" class="btn btn-danger push" data-delete>Delete this watch</button>`}
                    <button type="button" class="btn" data-cancel>Cancel</button>
                    <button type="submit" class="btn btn-primary">${isNew ? "Add the watch" : "Save"}</button>
                </div>
            </form>`,
        );
        d.root.classList.add("watch-dialog");
        const form = d.$("form");
        DatePicker.attach(form.date);
        d.$("[data-cancel]").onclick = () => d.requestClose();

        // ---------- picking the title (the Watches page) ----------
        let picked = title;
        if (!title) {
            const box = form.titleSearch;
            const list = d.$(".title-pick-list");
            const sorted = [...titles].sort((a, b) => a.name.localeCompare(b.name));
            const show = () => {
                const q = box.value.trim().toLowerCase();
                const hits = (q ? sorted.filter((t) => t.name.toLowerCase().includes(q)) : sorted).slice(0, 8);
                list.innerHTML = hits
                    .map((t) => `<li role="option"><button type="button" data-pick="${t.id}">${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}</button></li>`)
                    .join("");
                list.classList.toggle("hidden", hits.length === 0 || (picked && box.value === picked.name));
                box.setAttribute("aria-expanded", String(!list.classList.contains("hidden")));
            };
            box.addEventListener("input", () => {
                picked = null;
                show();
            });
            box.addEventListener("focus", show);
            list.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus in the box
            list.addEventListener("click", (e) => {
                const b = e.target.closest("[data-pick]");
                if (!b) return;
                picked = titles.find((t) => t.id === Number(b.dataset.pick));
                box.value = picked.name;
                list.classList.add("hidden");
                form.date.focus();
            });
            box.addEventListener("blur", () => setTimeout(() => list.classList.add("hidden"), 100));
            box.focus();
        } else (isNew ? form.querySelector("[type=submit]") : form.date).focus();

        const read = () => ({
            date: DatePicker.iso(form.date),
            withBogdan: form.withBogdan.checked,
            inCinema: form.inCinema.checked,
            notes: form.notes.value.trim() || null,
        });
        const initial = JSON.stringify(read());
        let done = false;
        d.guard(() => !done && JSON.stringify(read()) !== initial);

        form.onsubmit = (e) => {
            e.preventDefault();
            const body = read();
            if (body.date === undefined) {
                form.date.focus();
                return d.error("That isn't a date. Use dd/mm/yyyy, or leave it empty.");
            }
            if (!picked) {
                form.titleSearch?.focus();
                return d.error("Pick the title you watched.");
            }
            busy(d, form.querySelector("[type=submit]"), async () => {
                let fresh, watchId = watch?.id;
                if (isNew) {
                    const r = await api("POST", `/api/titles/${picked.id}/watches`, body);
                    fresh = r.title;
                    watchId = r.watchId;
                } else fresh = await api("PUT", `/api/watches/${watch.id}`, body);
                done = true;
                d.close();
                await onSaved?.(normalise(fresh), { watchId });
            });
        };

        d.$("[data-delete]")?.addEventListener("click", async (e) => {
            const sure = await Auth.confirm({
                title: "Delete this watch?",
                message: `${label(w)}${title ? ` · ${title.name}` : ""}. It comes off the title's history and its count.`,
                confirmLabel: "Delete",
                danger: true,
            });
            if (!sure) return;
            busy(d, e.target, async () => {
                const fresh = await api("DELETE", `/api/watches/${watch.id}`);
                done = true;
                d.close();
                await onSaved?.(normalise(fresh), { watchId: watch.id, deleted: true });
            });
        });
        return d;
    }

    // One dot per watch: filled for a dated one, hollow when the date isn't known; in Bogdan's colour with
    // him, ringed for the cinema. After ten, a count of the rest.
    function pipsHtml(row, { max = 10 } = {}) {
        const ws = row.watches ?? [];
        if (!ws.length) return "";
        const dated = ws.filter((w) => w.date).length;
        const bogdan = ws.filter((w) => w.withBogdan).length;
        const cinema = ws.filter((w) => w.inCinema).length;
        const desc = [
            `${ws.length} ${ws.length === 1 ? "watch" : "watches"}`,
            dated < ws.length ? `${ws.length - dated} with no date` : "",
            bogdan ? `${bogdan} with Bogdan` : "",
            cinema ? `${cinema} in the cinema` : "",
        ].filter(Boolean).join(", ");
        const pips = ws
            .slice(0, max)
            .map((w) => `<span class="pip${w.date ? "" : " is-undated"}${w.withBogdan ? " is-bogdan" : ""}${w.inCinema ? " is-cinema" : ""}"></span>`)
            .join("");
        return `<span class="pips" role="img" aria-label="${esc(desc)}" title="${esc(desc)}">${pips}${ws.length > max ? `<span class="pip-more">+${ws.length - max}</span>` : ""}<span class="pip-count">${ws.length}×</span></span>`;
    }

    window.WatchDialog = { open, pipsHtml, label, todayIso };
})();
