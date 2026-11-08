// The release popup and the release editor, shared by the releases page and the collection page
// (which opens them over the title popup). Needs auth.js and shelf.js.
//
// ctx, given by the page:
//   titles()          Map of title id → title
//   find(id)          the release with that id
//   onChanged(saved)  after a save (saved) or delete (null): reload, return the fresh release to show
//   openTitle(id)     optional: show a title over the release instead of following its link
//   list()            optional: the releases on screen, in order; previous/next step through them
//   onStep(i)         optional: after stepping to list()[i], e.g. to keep the grid behind in step
//   onOpen(r), onClose(r)   optional
//
// Like the title popup, a release fills the screen on phones, with × and previous / count / next
// in a bar at the bottom; on a computer the arrows sit either side. Arrow keys and swipes step too.

(function () {
    const { api, dialog, busy, esc, CLS } = Auth;
    const { FORMATS, EDITIONS, PLACES, CHANNELS, money, day, isSold, saleLine, saleNet, signed, kept } = Shelf;

    // today in this browser, yyyy-mm-dd
    const todayIso = () => {
        const n = new Date();
        return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    };
    // the same, as a date field shows it (dd/mm/yyyy: js/datepicker.js)
    const todayText = () => todayIso().split("-").reverse().join("/");
    // the SKU in a CeX product link (or a bare SKU), as the server reads it; null otherwise
    function skuOf(link) {
        link = (link ?? "").trim();
        const m = /[?&]id=([^&#]+)/.exec(link);
        let sku = m ? m[1] : link;
        try {
            sku = decodeURIComponent(sku);
        } catch {
            return null;
        }
        return /^[A-Za-z0-9-]{1,40}$/.test(sku) ? sku : null;
    }

    const titlesOf = (r, ctx) =>
        r.titleIds.map((id) => ctx.titles().get(id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

    // The picture a release shows: your own cover, else CeX's photo; without either (or when it won't load),
    // its titles' posters.
    const pictureOf = (r) => r.coverUrl ?? r.imageUrl ?? null;
    // the art box's class: CeX's pack shots sit on white; your own covers on the poster background
    const artClass = (r) => (r.coverUrl ? " has-cover" : r.imageUrl ? " has-photo" : "");

    function art(r, ctx, { large = false, photo = true } = {}) {
        const picture = pictureOf(r);
        if (picture && photo) return `<img class="release-photo" data-release="${r.id}" src="${esc(picture)}" alt="" loading="lazy">`;
        const posters = titlesOf(r, ctx).filter((t) => t.posterUrl).slice(0, 4);
        if (posters.length === 0) return `<div class="no-poster">${esc(r.name)}</div>`;
        if (posters.length === 1) return `<img src="${esc(posters[0].posterUrl)}" alt="" loading="lazy">`;
        // a box set without a CeX photo: its titles' posters together
        return `<div class="release-collage n${posters.length}${large ? " is-large" : ""}">${posters.map((t) => `<img src="${esc(t.posterUrl)}" alt="" loading="lazy">`).join("")}</div>`;
    }

    // If CeX's photo won't load, show the titles' posters instead of an empty box.
    function photoFallback(root, ctx) {
        root.addEventListener(
            "error",
            (e) => {
                const img = e.target.closest?.(".release-photo");
                const r = img && ctx.find(Number(img.dataset.release));
                if (!r) return;
                const box = img.parentElement;
                box.classList.remove("has-photo", "has-cover");
                // only the picture: a sold disc's badge stays on the box
                img.outerHTML = art(r, ctx, { photo: false, large: box.classList.contains("release-detail-art") });
            },
            true,
        );
    }

    // ---------- one release ----------

    async function open(r, ctx, { stepped = false } = {}) {
        const ts = titlesOf(r, ctx);
        const canEdit = Auth.me.canEdit;
        const sold = isSold(r);
        const list = ctx.list?.() ?? [];
        const index = list.findIndex((x) => x.id === r.id);
        const canStep = index >= 0 && list.length > 1;
        const step = (by) => {
            const target = list[index + by];
            if (!target) return;
            d.close();
            open(target, ctx, { stepped: true });
            ctx.onStep?.(index + by);
        };
        // ← / → while this release is the popup on top, and not while typing
        const onArrow = (e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            if (d.root !== [...document.querySelectorAll(".overlay:not(.hidden)")].pop()) return;
            if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
            e.preventDefault();
            step(e.key === "ArrowLeft" ? -1 : 1);
        };
        const d = dialog(
            esc(r.name),
            `
            <div class="release-detail">
                <div class="release-detail-art release-art${artClass(r)}${sold ? " is-sold" : ""}">${art(r, ctx, { large: true })}</div>
                <div class="release-detail-info">
                    <div class="tags">
                        ${Shelf.formatTag(r, { text: FORMATS[r.format], edition: false })}
                        ${r.edition !== "Standard" ? Shelf.formatTag(r, { text: EDITIONS[r.edition] }) : ""}
                        ${ts.length ? "" : `<span class="tag tag-warn">No titles linked</span>`}
                    </div>
                    ${sold ? saleBanner(r) : ""}
                    <dl class="facts release-facts">
                        <dt>Paid</dt><dd>${r.pricePaid != null ? money(r.pricePaid) : "–"}${ts.length > 1 && r.pricePaid != null ? ` <span class="faint">(${money(r.pricePaid / ts.length)} a title)</span>` : ""}</dd>
                        <dt>Bought from</dt><dd>${esc(PLACES[r.purchasedFrom] ?? r.purchasedFrom)}</dd>
                        ${r.boughtOn ? `<dt>Bought</dt><dd>${esc(day(r.boughtOn))}</dd>` : ""}
                        ${r.cexBoxName ? `<dt>At CeX</dt><dd>${esc(r.cexBoxName)}</dd>` : ""}
                        <dt>Added</dt><dd>${esc(r.createdAt.slice(0, 10).split("-").reverse().join("/"))}</dd>
                        ${r.notes ? `<dt class="sr-only">Notes</dt><dd class="wide release-notes">${esc(r.notes)}</dd>` : ""}
                    </dl>
                    ${r.cexSku ? `<section class="release-cex"><h3>${sold ? "At CeX around the sale" : "At CeX today"}</h3><div data-cex class="stub-cex"><p class="muted pulse">${sold ? "Looking up CeX's prices then…" : "Checking prices…"}</p></div></section>` : ""}
                    ${canEdit ? `<div class="actions release-actions"><button type="button" data-edit class="btn">Edit</button><button type="button" data-delete class="btn btn-danger">Delete</button></div>` : ""}
                </div>
            </div>
            <section class="release-titles">
                <h3>${ts.length === 0 ? "Titles on it" : ts.length === 1 ? "The title on it" : `The ${ts.length} titles on it`}</h3>
                ${ts.length
                    ? `<ul class="release-title-list">${ts
                          .map((t) => `
                        <li><a href="${window.Lists ? Lists.link(t) : `/?title=${t.id}`}" class="release-title" data-title="${t.id}">
                            ${t.posterUrl ? `<img src="${esc(t.posterUrl.replace("/w500/", "/w185/"))}" alt="" loading="lazy">` : `<span class="record-noposter">${esc(t.name)}</span>`}
                            <span>${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}</span>
                        </a></li>`)
                          .join("")}</ul>`
                    : `<p class="release-warn" role="note"><strong>No titles are linked to this release.</strong> ${canEdit ? "Edit it and add the titles on it, so" : "Until they are,"} it doesn't count towards any title's copy, price or CeX value.</p>`}
            </section>`,
            {
                wide: true,
                onClose: () => {
                    document.removeEventListener("keydown", onArrow);
                    ctx.onClose?.(r);
                },
            },
        );
        d.root.classList.add("release-sheet");
        if (stepped) d.root.classList.add("is-stepped"); // no rise animation between neighbours
        if (canStep) {
            d.root.classList.add("has-nav");
            d.root.insertAdjacentHTML(
                "beforeend",
                `
                <button type="button" class="modal-nav modal-prev" data-prev aria-label="Previous release"${index === 0 ? " disabled" : ` title="Previous: ${esc(list[index - 1].name)}"`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" /></svg>
                </button>
                <button type="button" class="modal-nav modal-next" data-next aria-label="Next release"${index === list.length - 1 ? " disabled" : ` title="Next: ${esc(list[index + 1].name)}"`}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
                </button>
                <span class="modal-count" aria-live="polite">${index + 1} of ${list.length}</span>`,
            );
            d.$("[data-prev]").onclick = () => step(-1);
            d.$("[data-next]").onclick = () => step(1);
            document.addEventListener("keydown", onArrow);
            // swipe left / right on touch screens
            const panel = d.$(".panel");
            let x0 = null;
            let y0 = null;
            panel.addEventListener("touchstart", (e) => ([x0, y0] = [e.touches[0].clientX, e.touches[0].clientY]), { passive: true });
            panel.addEventListener(
                "touchend",
                (e) => {
                    if (x0 == null) return;
                    const dx = e.changedTouches[0].clientX - x0;
                    const dy = e.changedTouches[0].clientY - y0;
                    x0 = null;
                    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
                },
                { passive: true },
            );
        }
        ctx.onOpen?.(r);
        photoFallback(d.root, ctx);
        // where the page can show a title itself, a plain click opens it over the release (which stays open)
        if (ctx.openTitle)
            d.$$("[data-title]").forEach((a) =>
                a.addEventListener("click", (e) => {
                    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    ctx.openTitle(Number(a.dataset.title));
                }),
            );
        d.$("[data-edit]")?.addEventListener("click", () => {
            d.close();
            edit(r, [], ctx);
        });
        d.$("[data-delete]")?.addEventListener("click", () => remove(r, d, ctx));

        if (r.cexSku && sold) {
            await cexAroundSale(r, d);
        } else if (r.cexSku) {
            try {
                const c = await api("GET", `/api/cex/${encodeURIComponent(r.cexSku)}`);
                d.$("[data-cex]").innerHTML = `
                    <div class="cex-entry">
                        <a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" title="${esc(c.boxName)}">${esc(c.boxName)}</a>
                        <dl>
                            <div><dt>Sells for</dt><dd>£${c.sellPrice}</dd></div>
                            <div class="is-cash"><dt>Cash</dt><dd>£${c.cashPrice}</dd></div>
                            <div class="is-voucher"><dt>Voucher</dt><dd>£${c.exchangePrice}</dd></div>
                        </dl>
                    </div>`;
            } catch {
                if (d.root.isConnected) d.$("[data-cex]").innerHTML = `<p class="status-bad">CeX didn't return prices for <a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link">${esc(r.cexSku)}</a>.</p>`;
            }
        }
    }

    // "Traded in to CeX on 3 Nov 2026 for £2.00 cash", then paid against got back (and how long it was kept)
    function saleBanner(r) {
        const net = saleNet(r);
        const sums = [
            r.pricePaid != null ? `Paid ${money(r.pricePaid)}` : "",
            r.soldFor != null ? `got back ${money(r.soldFor)}` : "",
            net != null ? `<span class="${net >= 0 ? "is-up" : "is-down"}">${Math.abs(net) < 0.005 ? "broke even" : signed(net)}</span>${r.pricePaid > 0 ? ` (${Math.round((r.soldFor / r.pricePaid) * 100)}% back)` : ""}` : "",
            kept(r) ? `kept ${kept(r)}` : "",
        ].filter(Boolean);
        if (sums.length) sums[0] = sums[0][0].toUpperCase() + sums[0].slice(1);
        return `
            <section class="sale-banner" aria-label="No longer on the shelf">
                <p class="sale-eyebrow">No longer on the shelf</p>
                <p class="sale-line">${esc(saleLine(r))}</p>
                ${sums.length ? `<p class="sale-sums">${sums.join(" · ")}</p>` : ""}
            </section>`;
    }

    // A sold release's CeX prices from the daily snapshots nearest the day it went (Shelf.nearestPoint), and what
    // that says about the price you got. The section goes when there's no snapshot near enough.
    async function cexAroundSale(r, d) {
        const box = d.$("[data-cex]");
        try {
            const [h] = await api("GET", `/api/cex/history?sku=${encodeURIComponent(r.cexSku)}`);
            const near = h && Shelf.nearestPoint(h.points, r.soldOn);
            if (!d.root.isConnected) return;
            if (!near) return box.closest(".release-cex").remove();
            const { point: p, days } = near;
            const when = days === 0 ? "on the day" : `on ${day(p.date)}, ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ${days < 0 ? "before" : "after"}`;
            const offer = r.payout === "Voucher" ? p.exchange : p.cash;
            const diff = r.soldFor != null && r.soldVia === "Cex" ? r.soldFor - offer : null;
            box.innerHTML = `
                <div class="cex-entry">
                    <a href="${esc(r.cexUrl)}" target="_blank" rel="noopener" class="link" title="${esc(h.boxName)}">${esc(h.boxName ?? r.cexSku)}</a>
                    <dl>
                        <div><dt>Sells for</dt><dd>${money(p.sell)}</dd></div>
                        <div class="is-cash"><dt>Cash</dt><dd>${money(p.cash)}</dd></div>
                        <div class="is-voucher"><dt>Voucher</dt><dd>${money(p.exchange)}</dd></div>
                    </dl>
                </div>
                <p class="faint">CeX's prices ${esc(when)}${diff == null ? "" : `: you got ${Math.abs(diff) < 0.005 ? `exactly its ${r.payout === "Voucher" ? "voucher" : "cash"} price` : `${signed(diff)} ${diff > 0 ? "over" : "under"} its ${r.payout === "Voucher" ? "voucher" : "cash"} price`}`}.</p>`;
        } catch {
            if (d.root.isConnected) box.closest(".release-cex")?.remove();
        }
    }

    async function remove(r, d, ctx) {
        const sure = await Auth.confirm({ title: `Delete ${r.name}?`, message: "The disc goes; its titles stay where they are. This can't be undone.", confirmLabel: "Delete", danger: true });
        if (!sure) return;
        try {
            await api("DELETE", `/api/releases/${r.id}`);
            d.close();
            await ctx.onChanged(null);
            Auth.showSuccess(`Deleted ${r.name}`);
        } catch (e) {
            Auth.showError(e.message);
        }
    }

    // ---------- add / edit ----------

    // Pick titles by typing; picked ones are chips.
    function titlePicker(container, initialIds, titles) {
        const picked = [...initialIds];
        const all = [...titles.values()].sort((a, b) => a.name.localeCompare(b.name));
        const listId = `titlePick-${Math.random().toString(36).slice(2, 8)}`;
        container.className = "input chip-input";
        container.innerHTML = `<input placeholder="Type a title" autocomplete="off" role="combobox" aria-label="Add a title" aria-autocomplete="list" aria-controls="${listId}" aria-expanded="false"><ul class="suggest hidden" id="${listId}" role="listbox"></ul>`;
        const input = container.querySelector("input"), list = container.querySelector(".suggest");
        let matches = [], active = -1;
        const render = () => {
            container.querySelectorAll("[data-chip]").forEach((c) => c.remove());
            for (const id of picked) {
                const t = titles.get(id);
                const chip = document.createElement("span");
                chip.dataset.chip = "";
                chip.className = "chip-value";
                chip.innerHTML = `${esc(t?.name ?? `#${id}`)} <button type="button" aria-label="Remove ${esc(t?.name ?? id)}">×</button>`;
                chip.querySelector("button").onclick = (e) => {
                    e.stopPropagation();
                    picked.splice(picked.indexOf(id), 1);
                    render();
                };
                container.insertBefore(chip, input);
            }
        };
        const hide = () => {
            list.classList.add("hidden");
            input.setAttribute("aria-expanded", "false");
            active = -1;
        };
        const suggest = () => {
            const q = input.value.trim().toLowerCase();
            if (!q) return hide();
            matches = all.filter((t) => !picked.includes(t.id) && t.name.toLowerCase().includes(q)).slice(0, 12);
            if (!matches.length) return hide();
            list.innerHTML = matches
                .map((t, i) => `<li role="option" id="${listId}-${i}" data-i="${i}" aria-selected="${i === active}">${esc(t.name)}${t.releaseYear ? ` <span class="faint">${t.releaseYear}</span>` : ""}${t.list === "watchlist" ? ` <span class="faint">· on the watchlist</span>` : ""}</li>`)
                .join("");
            list.classList.remove("hidden");
            input.setAttribute("aria-expanded", "true");
        };
        const pick = (i) => {
            picked.push(matches[i].id);
            input.value = "";
            render();
            hide();
            input.focus();
        };
        input.addEventListener("input", () => {
            active = -1;
            suggest();
        });
        input.addEventListener("keydown", (e) => {
            const open = !list.classList.contains("hidden");
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
                e.preventDefault();
                active = (active + (e.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
                suggest();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (open) pick(Math.max(0, active));
            } else if (e.key === "Escape" && open) {
                e.preventDefault();
                e.stopPropagation(); // keep the dialog open
                hide();
            } else if (e.key === "Backspace" && !input.value && picked.length) {
                picked.pop();
                render();
            }
        });
        input.addEventListener("blur", () => setTimeout(hide, 150));
        list.addEventListener("mousedown", (e) => {
            const li = e.target.closest("[data-i]");
            e.preventDefault();
            if (li) pick(Number(li.dataset.i));
        });
        container.addEventListener("click", () => input.focus());
        render();
        return { get: () => picked };
    }

    // ---------- the editor's cover: your own picture, instead of CeX's ----------

    // A picture made small enough to keep (1200px at most on its longer side) as a JPEG. Transparency turns white.
    async function shrink(file, longest = 1200) {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const g = canvas.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that picture."))), "image/jpeg", 0.86));
    }

    // Searches on other sites for a cover, from what the form says now: the name (or its titles), format and
    // edition, and the barcode when the CeX link has one (CeX's product ids for discs are their barcodes).
    function findUrls(form, picker, r, ctx) {
        const titles = picker.get().map((id) => ctx.titles().get(id)?.name).filter(Boolean);
        const name = form.name.value.trim() || titles.join(" ") || r.cexBoxName || "";
        const edition = form.edition.value === "Standard" ? "" : EDITIONS[form.edition.value];
        const words = [name, FORMATS[form.format.value], edition].filter(Boolean).join(" ");
        const sku = skuOf(form.cexUrl.value);
        const barcode = sku && /^\d{8,14}$/.test(sku) ? sku : null;
        const q = encodeURIComponent;
        return {
            images: `https://www.google.com/search?tbm=isch&q=${q(`${words} cover`)}`,
            bluray: `https://www.google.com/search?tbm=isch&q=${q(`site:blu-ray.com ${words}`)}`,
            barcode: barcode ? `https://www.google.com/search?tbm=isch&q=${q(barcode)}` : null,
            amazon: `https://www.amazon.co.uk/s?k=${q(barcode ?? words)}`,
        };
    }

    // The form's Cover: shows what the release will look like, takes a picture (attached, dropped, pasted, or from
    // a link the server fetches) or removes yours, and saves that after the release (save(id)). Nothing is sent
    // until then.
    function coverField(d, form, r, ctx, picker) {
        const box = d.$("[data-cover-drop]");
        const preview = d.$("[data-cover-preview]");
        const status = d.$("[data-cover-status]");
        const fileInput = d.$("[data-cover-file]");
        const linkInput = d.$("[data-cover-url]");
        const fetchButton = d.$("[data-cover-fetch]");
        const state = { action: "keep", blob: null, url: null }; // keep | set | remove
        let problem = "";

        const shownNow = () => (state.action === "set" ? { ...r, coverUrl: state.url } : state.action === "remove" ? { ...r, coverUrl: null } : r);
        // a picture that won't load: the titles' posters, as on the cards
        preview.addEventListener(
            "error",
            (e) => {
                if (!e.target.classList?.contains("release-photo")) return;
                preview.classList.remove("has-photo", "has-cover");
                preview.innerHTML = art(shownNow(), ctx, { photo: false });
            },
            true,
        );

        function show() {
            const shown = shownNow();
            preview.className = `cover-preview release-art${artClass(shown)}`;
            preview.innerHTML = art(shown, ctx);
            const fallback = r.imageUrl ? "CeX's picture" : "the titles' posters";
            status.textContent = problem || (
                state.action === "set" ? "Your new picture: it's kept when you save."
                : state.action === "remove" ? `Your picture goes when you save, and ${fallback} show${r.imageUrl ? "s" : ""} instead.`
                : r.coverUrl ? "Your own picture."
                : r.imageUrl ? "CeX's picture. Attach your own to show it instead."
                : "No picture yet: the titles' posters show instead.");
            status.classList.toggle("status-bad", !!problem);
            d.$("[data-cover-remove]").classList.toggle("hidden", !(state.action === "keep" && r.coverUrl));
            d.$("[data-cover-undo]").classList.toggle("hidden", state.action === "keep");
        }
        function fail(message) {
            problem = message;
            show();
        }
        async function take(file) {
            if (!file?.type?.startsWith("image/")) return fail("That isn't a picture.");
            problem = "";
            status.textContent = "Reading the picture…";
            try {
                const blob = await shrink(file);
                if (state.url) URL.revokeObjectURL(state.url);
                Object.assign(state, { action: "set", blob, url: URL.createObjectURL(blob) });
                show();
            } catch {
                fail("Couldn't read that picture.");
            }
        }
        // the browser can't read another site's pictures: the server fetches it (public internet only)
        async function fromLink(link = linkInput.value.trim()) {
            if (!link) return linkInput.focus();
            fetchButton.disabled = true;
            problem = "";
            status.textContent = "Fetching the picture…";
            try {
                const resp = await fetch(`/api/releases/cover-from?url=${encodeURIComponent(link)}`, { credentials: "same-origin" });
                if (!resp.ok) {
                    const data = await resp.json().catch(() => null);
                    throw new Error(data?.errors?.Cover?.[0] ?? data?.detail ?? `Couldn't fetch that picture (${resp.status}).`);
                }
                await take(await resp.blob());
                if (!problem) linkInput.value = "";
            } catch (e) {
                fail(e.message);
            } finally {
                fetchButton.disabled = false;
            }
        }

        fileInput.addEventListener("change", () => {
            take(fileInput.files[0]);
            fileInput.value = "";
        });
        fetchButton.onclick = () => fromLink();
        // Enter in the link box fetches it rather than saving the form
        linkInput.addEventListener("keydown", (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            fromLink();
        });
        d.$("[data-cover-remove]").onclick = () => {
            problem = "";
            state.action = "remove";
            show();
        };
        d.$("[data-cover-undo]").onclick = () => {
            if (state.url) URL.revokeObjectURL(state.url);
            Object.assign(state, { action: "keep", blob: null, url: null });
            problem = "";
            show();
        };
        // a picture pasted anywhere in the form (text pastes as usual)
        d.root.addEventListener("paste", (e) => {
            const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
            if (!file) return;
            e.preventDefault();
            take(file);
        });
        // a file dropped on the field, or a picture dragged from another tab (its link)
        box.addEventListener("dragover", (e) => {
            e.preventDefault();
            box.classList.add("is-dropping");
        });
        box.addEventListener("dragleave", (e) => {
            if (!box.contains(e.relatedTarget)) box.classList.remove("is-dropping");
        });
        box.addEventListener("drop", (e) => {
            e.preventDefault();
            box.classList.remove("is-dropping");
            const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
            if (file) return take(file);
            const link = (e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text/plain") || "").split("\n").find((l) => /^https?:\/\//.test(l.trim()));
            if (link) {
                linkInput.value = link.trim();
                fromLink(link.trim());
            } else fail("Drop a picture, or a picture from another tab.");
        });

        // the searches follow the form: refreshed just before a link is followed (click, middle click or keyboard)
        const finds = d.$$("[data-find]");
        const refreshFinds = () => {
            const urls = findUrls(form, picker, r, ctx);
            for (const a of finds) {
                a.href = urls[a.dataset.find] ?? "#";
                a.classList.toggle("hidden", !urls[a.dataset.find]);
            }
        };
        finds.forEach((a) => ["pointerdown", "focus", "click"].forEach((ev) => a.addEventListener(ev, refreshFinds)));
        form.cexUrl.addEventListener("input", refreshFinds);
        refreshFinds();
        show();

        return {
            // for the unsaved-changes check
            change: () => (state.action === "set" ? `set:${state.blob.size}` : state.action),
            // after the release is saved: the fresh release, or null when the cover didn't change
            async save(id) {
                if (state.action === "set") return api("PUT", `/api/releases/${id}/cover`, state.blob);
                if (state.action === "remove") return api("DELETE", `/api/releases/${id}/cover`);
                return null;
            },
            dispose() {
                if (state.url) URL.revokeObjectURL(state.url);
            },
        };
    }

    function edit(r, presetTitleIds, ctx) {
        const isNew = !r;
        r = r ?? { name: "", format: "BluRay", edition: "Standard", pricePaid: null, purchasedFrom: "Other", boughtOn: null, notes: "", cexUrl: "", titleIds: presetTitleIds, soldVia: null };
        const wasSold = isSold(r);
        const v = (x) => (x == null ? "" : esc(x));
        const options = (map, current) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === current ? " selected" : ""}>${esc(l)}</option>`).join("");
        const payout = r.payout ?? "Cash";
        const d = dialog(
            isNew ? "Add a release" : `Edit ${esc(r.name)}`,
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="release-form stack">
                <div><label class="label" for="rel-name">Name</label>
                    <input id="rel-name" name="name" maxlength="300" class="input" value="${v(r.name)}" placeholder="Leave empty to use CeX's name"></div>
                <div class="row row-5">
                    <div><label class="label" for="rel-format">Format</label><select id="rel-format" name="format" class="input">${options(FORMATS, r.format)}</select></div>
                    <div><label class="label" for="rel-edition">Edition</label><select id="rel-edition" name="edition" class="input">${options(EDITIONS, r.edition)}</select></div>
                    <div><label class="label" for="rel-place">Bought from</label><select id="rel-place" name="purchasedFrom" class="input">${options(PLACES, r.purchasedFrom)}</select></div>
                    <div><label class="label" for="rel-price">Price paid (£)</label><input id="rel-price" name="pricePaid" type="number" min="0" step="0.01" class="input" value="${v(r.pricePaid)}"></div>
                    <div><label class="label" for="rel-bought">Bought on</label><input id="rel-bought" name="boughtOn" data-date class="input" value="${v(r.boughtOn)}" placeholder="If you know"></div>
                </div>
                <div><label class="label" for="rel-cex">CeX link <span class="faint">(for its CeX value: it doesn't have to be where you bought it)</span></label>
                    <input id="rel-cex" name="cexUrl" class="input code" value="${v(r.cexUrl)}" placeholder="https://uk.webuy.com/product-detail?id=…"></div>
                <div class="cover-field" data-cover-drop>
                    <span class="label" id="rel-cover-label">Cover</span>
                    <div class="cover-box">
                        <div class="cover-preview release-art" data-cover-preview role="img" aria-labelledby="rel-cover-label"></div>
                        <div class="cover-side">
                            <p class="cover-status" data-cover-status aria-live="polite"></p>
                            <div class="cover-buttons">
                                <label class="btn btn-small cover-attach">Attach a picture<input type="file" accept="image/*" data-cover-file class="sr-only"></label>
                                <button type="button" class="btn btn-small hidden" data-cover-remove>Remove your picture</button>
                                <button type="button" class="btn btn-small hidden" data-cover-undo>Undo</button>
                            </div>
                        </div>
                        <div class="cover-more">
                            <div class="cover-link">
                                <input class="input" data-cover-url inputmode="url" autocomplete="off" placeholder="…or paste a picture's link" aria-label="A picture's link">
                                <button type="button" class="btn btn-small" data-cover-fetch>Use link</button>
                            </div>
                            <p class="field-hint cover-find">Find one:
                                <a href="#" target="_blank" rel="noopener" data-find="images">Google Images</a>
                                <a href="#" target="_blank" rel="noopener" data-find="bluray">Blu-ray.com covers</a>
                                <a href="#" target="_blank" rel="noopener" data-find="barcode">by barcode</a>
                                <a href="#" target="_blank" rel="noopener" data-find="amazon">Amazon UK</a>
                            </p>
                            <p class="field-hint">You can also drop a picture (or a picture from another tab) here, or paste one.</p>
                        </div>
                    </div>
                </div>
                <div><span class="label">Titles on it</span><div data-titles></div></div>
                <div><label class="label" for="rel-notes">Notes</label><textarea id="rel-notes" name="notes" rows="2" maxlength="2000" class="input">${v(r.notes)}</textarea></div>
                <fieldset class="sale-fields${wasSold ? " is-open" : ""}">
                    <legend class="sr-only">Traded in or sold</legend>
                    <label class="check sale-toggle"><input type="checkbox" name="sold"${wasSold ? " checked" : ""}> Traded in or sold <span class="faint">it stays here as history, off the shelf</span></label>
                    <div class="sale-body${wasSold ? "" : " hidden"}" data-sale>
                        <div class="row row-3">
                            <div><label class="label" for="rel-via">Where</label><select id="rel-via" name="soldVia" class="input">${options(CHANNELS, r.soldVia ?? "Cex")}</select></div>
                            <div><label class="label" for="rel-sold-on">Date</label><input id="rel-sold-on" name="soldOn" data-date class="input" value="${v(r.soldOn ?? todayIso())}"></div>
                            <div><label class="label" for="rel-sold-for">Price I got (£)</label><input id="rel-sold-for" name="soldFor" type="number" min="0" step="0.01" class="input" value="${v(r.soldFor)}" placeholder="Optional"></div>
                        </div>
                        <div class="sale-payout" data-payout-row>
                            <span class="label" id="rel-payout-label">CeX paid in</span>
                            <div class="segmented" role="group" aria-labelledby="rel-payout-label">
                                <button type="button" data-payout="Cash" aria-pressed="${payout === "Cash"}">Cash</button>
                                <button type="button" data-payout="Voucher" aria-pressed="${payout === "Voucher"}">Voucher</button>
                            </div>
                            <input type="hidden" name="payout" value="${payout}">
                        </div>
                        <div class="sale-hint hidden" data-cex-hint aria-live="polite"></div>
                    </div>
                </fieldset>
                <div class="actions">
                    <button type="button" data-cancel class="btn">Cancel</button>
                    <button type="submit" class="btn btn-primary">${isNew ? "Add release" : "Save changes"}</button>
                </div>
            </form>`,
            { wide: true },
        );
        d.error("");
        const picker = titlePicker(d.$("[data-titles]"), r.titleIds, ctx.titles());
        const form = d.$("form");
        form.querySelectorAll("[data-date]").forEach(DatePicker.attach);
        const cover = coverField(d, form, r, ctx, picker);

        // ---------- traded in or sold ----------
        const saleBox = d.$("[data-sale]");
        const setPayout = (value) => {
            form.payout.value = value;
            d.$$("[data-payout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.payout === value)));
        };
        d.$$("[data-payout]").forEach((b) => (b.onclick = () => setPayout(b.dataset.payout)));
        // "CeX offers £2.00 cash · £3.00 voucher today", with a click to use either (never filled in by itself)
        const hint = d.$("[data-cex-hint]");
        const offers = new Map(); // sku → CeX's prices, or null when it had none
        async function showHint() {
            const sku = form.sold.checked && form.soldVia.value === "Cex" ? skuOf(form.cexUrl.value) : null;
            if (!sku) {
                hint.classList.add("hidden");
                return;
            }
            if (!offers.has(sku)) {
                hint.classList.remove("hidden");
                hint.innerHTML = `<p class="field-hint pulse">Checking what CeX offers…</p>`;
                offers.set(sku, await api("GET", `/api/cex/${encodeURIComponent(sku)}`).catch(() => null));
            }
            const c = offers.get(sku);
            // the link or channel may have changed while CeX answered
            if (!c || skuOf(form.cexUrl.value) !== sku || form.soldVia.value !== "Cex" || !form.sold.checked) {
                if (!c) hint.classList.add("hidden");
                return;
            }
            hint.classList.remove("hidden");
            hint.innerHTML = `
                <p class="field-hint">CeX offers <strong>${money(c.cashPrice)}</strong> cash · <strong>${money(c.exchangePrice)}</strong> voucher today</p>
                <div class="sale-hint-use">
                    <button type="button" class="btn btn-small" data-use="Cash">Use ${money(c.cashPrice)} cash</button>
                    <button type="button" class="btn btn-small" data-use="Voucher">Use ${money(c.exchangePrice)} voucher</button>
                </div>`;
            hint.querySelectorAll("[data-use]").forEach((b) => {
                b.onclick = () => {
                    form.soldFor.value = Number(b.dataset.use === "Voucher" ? c.exchangePrice : c.cashPrice).toFixed(2);
                    setPayout(b.dataset.use);
                };
            });
        }
        const showChannel = () => {
            d.$("[data-payout-row]").classList.toggle("hidden", form.soldVia.value !== "Cex");
            showHint();
        };
        form.soldVia.addEventListener("change", showChannel);
        form.cexUrl.addEventListener("change", showHint);
        form.sold.addEventListener("change", () => {
            const on = form.sold.checked;
            saleBox.classList.toggle("hidden", !on);
            form.querySelector(".sale-fields").classList.toggle("is-open", on);
            if (!on) {
                // unticked: the sale goes, and ticking again starts afresh (today, no price)
                form.soldVia.value = "Cex";
                form.soldVia.dispatchEvent(new Event("change"));
                form.soldOn.value = todayText();
                form.soldFor.value = "";
                setPayout("Cash");
            } else {
                if (!form.soldOn.value.trim()) form.soldOn.value = todayText();
                d.$("#rel-via")?.focus();
            }
            showChannel();
        });
        showChannel();

        const snapshot = () => JSON.stringify([[...new FormData(form)], picker.get(), cover.change()]);
        const initial = snapshot();
        d.guard(() => snapshot() !== initial);
        d.$("[data-cancel]").onclick = () => d.requestClose();
        form.onsubmit = (e) => {
            e.preventDefault();
            const boughtOn = DatePicker.iso(form.boughtOn);
            const sold = form.sold.checked;
            const soldOn = sold ? DatePicker.iso(form.soldOn) : null;
            const soldFor = sold && form.soldFor.value !== "" ? Number(form.soldFor.value) : null;
            const problem =
                boughtOn === undefined ? "The date you bought it isn't a date (dd/mm/yyyy)."
                : boughtOn && boughtOn > todayIso() ? "The date you bought it can't be in the future."
                : sold && soldOn === undefined ? "The date it went isn't a date (dd/mm/yyyy)."
                : sold && !soldOn ? "When did it go? A date is needed."
                : sold && soldOn > todayIso() ? "The date it went can't be in the future."
                : sold && boughtOn && soldOn < boughtOn ? "It can't have gone before you bought it."
                : soldFor != null && soldFor < 0 ? "The price you got can't be negative."
                : null;
            if (problem) {
                d.error(problem);
                return;
            }
            const body = {
                name: form.name.value.trim(),
                format: form.format.value,
                edition: form.edition.value,
                pricePaid: form.pricePaid.value === "" ? null : Number(form.pricePaid.value),
                purchasedFrom: form.purchasedFrom.value,
                boughtOn,
                cexUrl: form.cexUrl.value.trim() || null,
                notes: form.notes.value,
                titleIds: picker.get(),
                // unticked: all of it goes (the server clears the rest without a channel too)
                soldVia: sold ? form.soldVia.value : null,
                soldOn,
                soldFor,
                payout: sold && form.soldVia.value === "Cex" ? form.payout.value : null,
            };
            busy(d, form.querySelector("button[type=submit]"), async () => {
                let saved = isNew ? await api("POST", "/api/releases", body) : await api("PUT", `/api/releases/${r.id}`, body);
                // the release is saved: a picture that won't upload doesn't keep the form open (saving again would add it twice)
                let coverProblem = null;
                try {
                    saved = (await cover.save(saved.id)) ?? saved;
                } catch (e) {
                    coverProblem = e.message;
                }
                cover.dispose();
                d.close();
                const fresh = await ctx.onChanged(saved);
                const verb = !isSold(saved) ? (wasSold ? `Put ${saved.name} back on the shelf` : null) : !wasSold ? `Marked ${saved.name} as ${saved.soldVia === "Cex" ? "traded in" : "sold"}` : null;
                if (coverProblem) Auth.showError(`Saved ${saved.name}, but not its picture: ${coverProblem}`);
                else Auth.showSuccess(verb ?? (isNew ? `Added ${saved.name}` : `Saved ${saved.name}`));
                if (fresh) open(fresh, ctx);
            });
        };
        form.name.focus();
    }

    window.ReleaseDialogs = { art, artClass, photoFallback, open, edit };
})();
