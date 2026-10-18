// Themed date picker. The native <input type="date"> popup can't be styled, so date fields are
// text inputs (dd/mm/yyyy, typing works too) with a calendar popover built from the theme tokens.
//
//   DatePicker.attach(input)   input: <input data-date value="yyyy-mm-dd">
//   DatePicker.iso(input)      "yyyy-mm-dd", null when empty, undefined when the text isn't a date

(function () {
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    const pad = (n) => String(n).padStart(2, "0");
    const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const toText = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    const sameDay = (a, b) => a && b && toIso(a) === toIso(b);
    const today = () => {
        const n = new Date();
        return new Date(n.getFullYear(), n.getMonth(), n.getDate());
    };

    function fromIso(iso) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
        return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    }

    // "15/4/2020", "15-04-20", "15.04.2020" or "2020-04-15". Returns a Date, null (empty) or undefined (invalid).
    function parse(text) {
        text = text.trim();
        if (!text) return null;
        let y, m, d;
        let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
        if (match) [, y, m, d] = match.map(Number);
        else if ((match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(text))) {
            [, d, m, y] = match.map(Number);
            if (y < 100) y += 2000;
        } else return undefined;
        const date = new Date(y, m - 1, d);
        return date.getMonth() === m - 1 && date.getDate() === d ? date : undefined;
    }

    let open = null; // the one popover that's showing: { input, el, close }

    function attach(input) {
        const initial = fromIso(input.value);
        input.type = "text";
        input.value = initial ? toText(initial) : "";
        input.placeholder = "dd/mm/yyyy";
        input.inputMode = "numeric";
        input.autocomplete = "off";

        const wrap = document.createElement("div");
        wrap.className = "date-field";
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "date-toggle";
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-label", "Choose a date");
        button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4"/></svg>`;
        wrap.appendChild(button);

        // Tidy what was typed into dd/mm/yyyy once it parses.
        input.addEventListener("change", () => {
            const d = parse(input.value);
            if (d) input.value = toText(d);
            input.classList.toggle("is-invalid", d === undefined);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown" && e.altKey) {
                e.preventDefault();
                show(input, button);
            }
        });
        button.onclick = () => (open?.input === input ? open.close(true) : show(input, button));
    }

    function show(input, button) {
        open?.close(false);
        const selected = parse(input.value) || null;
        let focus = selected || today();
        let view = "days";

        const el = document.createElement("div");
        el.className = "datepicker";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", "Choose a date");
        document.body.appendChild(el);

        function cell(label, attrs, classes) {
            return `<button type="button" class="${classes.filter(Boolean).join(" ")}" ${attrs}>${label}</button>`;
        }

        function render() {
            const y = focus.getFullYear();
            const m = focus.getMonth();
            let title, body;
            if (view === "days") {
                title = `${MONTHS[m]} ${y}`;
                const first = new Date(y, m, 1);
                const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
                const rows = [];
                for (let w = 0; w < 6; w++) {
                    const cells = [];
                    for (let i = 0; i < 7; i++) {
                        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
                        cells.push(`<td role="gridcell">${cell(
                            d.getDate(),
                            `data-iso="${toIso(d)}" tabindex="${sameDay(d, focus) ? 0 : -1}" aria-label="${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}"${sameDay(d, selected) ? ' aria-selected="true"' : ""}${sameDay(d, today()) ? ' aria-current="date"' : ""}`,
                            ["dp-day", d.getMonth() !== m && "is-outside"],
                        )}</td>`);
                    }
                    rows.push(`<tr>${cells.join("")}</tr>`);
                }
                body = `<table class="dp-grid" role="grid" aria-label="${title}">
                    <thead><tr>${DAYS.map((d) => `<th scope="col" abbr="${d}">${d}</th>`).join("")}</tr></thead>
                    <tbody>${rows.join("")}</tbody></table>`;
            } else if (view === "months") {
                title = String(y);
                body = `<div class="dp-cells">${MONTHS.map((name, i) =>
                    cell(name.slice(0, 3), `data-month="${i}" tabindex="${i === m ? 0 : -1}" aria-label="${name} ${y}"${selected && selected.getFullYear() === y && selected.getMonth() === i ? ' aria-selected="true"' : ""}`, ["dp-cell"]),
                ).join("")}</div>`;
            } else {
                const from = y - (y % 12);
                title = `${from}–${from + 11}`;
                body = `<div class="dp-cells">${Array.from({ length: 12 }, (_, i) => from + i).map((yr) =>
                    cell(yr, `data-year="${yr}" tabindex="${yr === y ? 0 : -1}"${selected?.getFullYear() === yr ? ' aria-selected="true"' : ""}`, ["dp-cell"]),
                ).join("")}</div>`;
            }
            const unit = { days: "month", months: "year", years: "12 years" }[view];
            el.innerHTML = `
                <div class="dp-head">
                    <button type="button" class="dp-nav" data-step="-1" aria-label="Previous ${unit}">‹</button>
                    <button type="button" class="dp-title" data-zoom ${view === "years" ? "disabled" : ""} aria-live="polite">${title}</button>
                    <button type="button" class="dp-nav" data-step="1" aria-label="Next ${unit}">›</button>
                </div>
                ${body}
                <div class="dp-foot">
                    <button type="button" class="btn btn-small" data-today>Today</button>
                    <button type="button" class="btn btn-small" data-clear>Clear</button>
                </div>`;
            if (el.isConnected) place();
        }

        function focusCurrent() {
            el.querySelector('.dp-grid [tabindex="0"], .dp-cells [tabindex="0"]')?.focus();
        }

        function moveTo(date) {
            focus = date;
            render();
            focusCurrent();
        }

        function pick(date) {
            input.value = date ? toText(date) : "";
            input.classList.remove("is-invalid");
            input.dispatchEvent(new Event("change", { bubbles: true }));
            close(true);
        }

        function place() {
            const r = input.parentNode.getBoundingClientRect();
            const h = el.offsetHeight;
            const w = el.offsetWidth;
            const below = r.bottom + 6 + h <= window.innerHeight || r.top - 6 - h < 0;
            el.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
            el.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        }

        el.addEventListener("click", (e) => {
            const b = e.target.closest("button");
            if (!b || !el.contains(b)) return;
            const y = focus.getFullYear();
            const m = focus.getMonth();
            if (b.dataset.iso) return pick(fromIso(b.dataset.iso));
            if (b.dataset.month) {
                view = "days";
                return moveTo(new Date(y, Number(b.dataset.month), Math.min(focus.getDate(), 28)));
            }
            if (b.dataset.year) {
                view = "months";
                return moveTo(new Date(Number(b.dataset.year), m, Math.min(focus.getDate(), 28)));
            }
            if (b.dataset.step) {
                const s = Number(b.dataset.step);
                const d = Math.min(focus.getDate(), 28);
                focus = view === "days" ? new Date(y, m + s, d) : new Date(y + s * (view === "months" ? 1 : 12), m, d);
                render();
                return el.querySelector(`[data-step="${s}"]`).focus();
            }
            if (b.hasAttribute("data-zoom")) {
                view = view === "days" ? "months" : "years";
                render();
                return el.querySelector("[data-zoom]:not(:disabled)")?.focus() ?? focusCurrent();
            }
            if (b.hasAttribute("data-today")) return pick(today());
            if (b.hasAttribute("data-clear")) return pick(null);
        });

        el.addEventListener("keydown", (e) => {
            // keep Escape (and arrows) away from the dialog and the title modal behind
            e.stopPropagation();
            if (e.key === "Escape") {
                e.preventDefault();
                if (view !== "days") {
                    view = view === "years" ? "months" : "days";
                    render();
                    return focusCurrent();
                }
                return close(true);
            }
            if (e.key === "Tab") {
                // keep focus inside the popover
                const items = [...el.querySelectorAll("button:not(:disabled)")].filter((b) => b.tabIndex === 0);
                const i = items.indexOf(document.activeElement);
                const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i + 1) % items.length;
                e.preventDefault();
                return items[next].focus();
            }
            const inGrid = e.target.closest(".dp-grid, .dp-cells");
            if (!inGrid) return;
            const y = focus.getFullYear();
            const m = focus.getMonth();
            const d = focus.getDate();
            const deltas =
                view === "days"
                    ? { ArrowLeft: [0, 0, -1], ArrowRight: [0, 0, 1], ArrowUp: [0, 0, -7], ArrowDown: [0, 0, 7], PageUp: e.shiftKey ? [-1, 0, 0] : [0, -1, 0], PageDown: e.shiftKey ? [1, 0, 0] : [0, 1, 0] }
                    : view === "months"
                      ? { ArrowLeft: [0, -1, 0], ArrowRight: [0, 1, 0], ArrowUp: [0, -3, 0], ArrowDown: [0, 3, 0], PageUp: [-1, 0, 0], PageDown: [1, 0, 0] }
                      : { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [-3, 0, 0], ArrowDown: [3, 0, 0], PageUp: [-12, 0, 0], PageDown: [12, 0, 0] };
            if (deltas[e.key]) {
                e.preventDefault();
                const [dy, dm, dd] = deltas[e.key];
                // month/year steps keep the day where possible (31 Jan + 1 month = 28/29 Feb)
                const target = dd ? new Date(y, m, d + dd) : new Date(y + dy, m + dm, 1);
                if (!dd) target.setDate(Math.min(d, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
                moveTo(target);
            } else if (view === "days" && (e.key === "Home" || e.key === "End")) {
                e.preventDefault();
                const dow = (focus.getDay() + 6) % 7;
                moveTo(new Date(y, m, d + (e.key === "Home" ? -dow : 6 - dow)));
            }
        });

        const onOutside = (e) => {
            if (!el.contains(e.target) && !input.parentNode.contains(e.target)) close(false);
        };
        const onScroll = (e) => {
            if (!el.contains(e.target)) place();
        };

        function close(refocus) {
            if (open?.el !== el) return;
            open = null;
            el.remove();
            button.setAttribute("aria-expanded", "false");
            document.removeEventListener("mousedown", onOutside, true);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", place);
            if (refocus) input.focus();
        }

        render();
        place();
        button.setAttribute("aria-expanded", "true");
        document.addEventListener("mousedown", onOutside, true);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", place);
        open = { input, el, close };
        focusCurrent();
    }

    function iso(input) {
        const d = parse(input.value);
        return d ? toIso(d) : d;
    }

    window.DatePicker = { attach, iso, parse };
})();
