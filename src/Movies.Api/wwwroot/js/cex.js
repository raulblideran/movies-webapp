// CeX stock tracker: tracked items come from /api/cex-items, stock per store from /api/cex/{sku}/stores.
// Distances are from a chosen store, or from home: the signed-in user's address (set under Account),
// whose coordinates never reach the browser (/api/cex/{sku}/stores/home).
// Signed-in editors can paste a link to track it, and edit/refresh/delete cards. Needs auth.js.

(function () {
    const esc = Auth.esc;
    const DEFAULT_LOCATION = { storeName: "Doncaster", latitude: 53.52228, longitude: -1.13534 };
    const PREF_KEY = "cexStorePreference";

    let allStores = [];
    let selectedStore = null;
    let home = null; // { postcode } when the signed-in user has an address
    let useHome = false;
    let started = false;
    let generation = 0; // bumped when the location changes, so lookups for the old one are dropped
    let sortByDistance = false;
    let items = [];
    const stock = new Map(); // item id -> array of stores (empty = none in stock), null = lookup failed
    let canEdit = false;

    const grid = document.getElementById("grid");

    // ---------- helpers ----------

    async function getJson(url) {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.json();
    }

    const location_ = () => selectedStore ?? DEFAULT_LOCATION;
    const homeLabel = () => `Home, ${home.postcode}`;
    const locationLabel = () => (useHome ? homeLabel() : location_().storeName);
    const nearestDistance = (item) => stock.get(item.id)?.[0]?.distanceMiles ?? Infinity;

    function hideLoading() {
        const overlay = document.getElementById("loadingOverlay");
        overlay.classList.add("is-fading");
        setTimeout(() => overlay.classList.add("hidden"), 300);
    }

    // { type: "home" } or { type: "store", storeId, overHome }. overHome: the store was picked while home was on offer,
    // so it wins over home next time too. A store picked before there was an address doesn't.
    function loadPreference() {
        try {
            return JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
        } catch {
            return null;
        }
    }

    function savePreference(pref) {
        try {
            localStorage.setItem(PREF_KEY, JSON.stringify(pref));
        } catch {
            // storage unavailable: the choice just won't be remembered
        }
    }

    // Where distances are measured from, by preference: home when there's an address, unless a store was picked over it.
    function preferredChoice() {
        const pref = loadPreference();
        if (home && !(pref?.type === "store" && pref.overHome)) return "home";
        return (
            allStores.find((s) => pref?.type === "store" && s.storeId === pref.storeId) ??
            allStores.find((s) => s.storeName === DEFAULT_LOCATION.storeName) ??
            null
        );
    }

    // choice: "home", or a store (null = the default location)
    function applyChoice(choice) {
        useHome = choice === "home";
        if (!useHome) selectedStore = choice;
        document.getElementById("storeSearch").value = locationLabel();
        generation++;
        stock.clear();
        render();
        loadStock(items);
    }

    // ---------- store picker ----------

    function renderStoreDropdown(filterText = "") {
        const dropdown = document.getElementById("storeDropdown");
        const q = filterText.toLowerCase();
        const showHome = home && homeLabel().toLowerCase().includes(q);
        const filtered = allStores.filter((s) => s.storeName.toLowerCase().includes(q));
        const option = (id, label, selected, extra = "") =>
            `<div data-store-id="${id}" role="option" aria-selected="${selected}" class="${selected ? "is-selected" : ""}${extra}">${label}</div>`;
        dropdown.innerHTML =
            showHome || filtered.length
                ? (showHome ? option("home", esc(homeLabel()), useHome, " home-option") : "") +
                  filtered.map((s) => option(s.storeId, esc(s.storeName), !useHome && selectedStore?.storeId === s.storeId)).join("")
                : `<div class="faint" style="padding:10px;text-align:center">No stores match</div>`;
        dropdown.querySelectorAll("[data-store-id]").forEach((opt) => {
            opt.onclick = () =>
                opt.dataset.storeId === "home"
                    ? select("home")
                    : select(allStores.find((s) => s.storeId === Number(opt.dataset.storeId)));
        });
    }

    function select(choice) {
        setDropdown(false);
        savePreference(choice === "home" ? { type: "home" } : { type: "store", storeId: choice.storeId, overHome: !!home });
        applyChoice(choice);
    }

    function setDropdown(open) {
        document.getElementById("storeDropdown").classList.toggle("hidden", !open);
        document.getElementById("storeSearch").setAttribute("aria-expanded", String(open));
    }

    function initStoreSelector() {
        const input = document.getElementById("storeSearch");
        const dropdown = document.getElementById("storeDropdown");
        const choice = preferredChoice();
        useHome = choice === "home";
        if (!useHome) selectedStore = choice;
        input.value = locationLabel();

        let selectedIndex = -1;
        const options = () => dropdown.querySelectorAll("[data-store-id]");
        const highlight = () =>
            options().forEach((o, i) => {
                o.classList.toggle("is-highlighted", i === selectedIndex);
                if (i === selectedIndex) o.scrollIntoView({ block: "nearest" });
            });

        input.addEventListener("input", () => {
            selectedIndex = -1;
            renderStoreDropdown(input.value);
            setDropdown(true);
        });
        input.addEventListener("focus", () => {
            input.select();
            renderStoreDropdown("");
            setDropdown(true);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, options().length - 1);
                highlight();
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                highlight();
            } else if (e.key === "Enter" && selectedIndex >= 0) {
                e.preventDefault();
                options()[selectedIndex].click();
            } else if (e.key === "Escape") {
                setDropdown(false);
                input.value = locationLabel();
                input.blur();
            }
        });
        // a click outside the picker (its clear button counts as inside) puts the chosen store back
        const picker = input.closest(".store-picker");
        document.addEventListener("click", (e) => {
            if (!picker.contains(e.target) && !dropdown.contains(e.target)) {
                setDropdown(false);
                if (!input.value.trim()) input.value = locationLabel();
            }
        });
    }

    // ---------- stock ----------

    async function loadStock(list) {
        const { latitude, longitude } = location_();
        const from = useHome ? "/home" : `?lat=${latitude}&lon=${longitude}`;
        const run = generation;
        const queue = [...list];
        async function worker() {
            while (queue.length && run === generation) {
                const item = queue.shift();
                let stores;
                try {
                    stores = await getJson(`/api/cex/${encodeURIComponent(item.sku)}/stores${from}`);
                } catch {
                    stores = null;
                }
                if (run !== generation) return;
                stock.set(item.id, stores);
                updateStock(item);
                renderStats();
            }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (sortByDistance && run === generation) render();
    }

    function stockHtml(item) {
        if (!stock.has(item.id)) return `<div class="stock stock-wait pulse">Checking stock…</div>`;
        const stores = stock.get(item.id);
        if (stores === null) return `<div class="stock stock-wait">Stock unavailable right now</div>`;
        if (stores.length === 0) return `<div class="stock stock-none">Not in stock anywhere</div>`;

        const nearest = stores[0];
        const isSelected = !useHome && selectedStore && nearest.storeName === selectedStore.storeName;
        return `
            <div class="stock">
                <div style="min-width:0">
                    <div class="stock-store${isSelected ? " is-home" : ""}">${esc(nearest.storeName)}</div>
                    <div class="stock-meta">${nearest.distanceMiles.toFixed(1)} mi, ${nearest.quantity} in stock</div>
                </div>
                ${
                    stores.length > 1
                        ? `<button type="button" data-more class="btn btn-small" aria-label="Show all ${stores.length} stores">+${stores.length - 1}</button>`
                        : ""
                }
            </div>`;
    }

    function renderStats() {
        const el = document.getElementById("stats");
        if (!el) return;
        const checked = items.filter((i) => stock.has(i.id));
        const inStock = checked.filter((i) => stock.get(i.id)?.length > 0).length;
        const near = checked.filter((i) => (stock.get(i.id)?.[0]?.distanceMiles ?? Infinity) <= 10).length;
        const stats = [[items.length, "tracked"]];
        if (checked.length === items.length && items.length) stats.push([inStock, "in stock"], [near, "within 10 mi"]);
        el.innerHTML = stats.map(([v, l]) => `<div class="stat"><dt>${l}</dt><dd>${v}</dd></div>`).join("");
    }

    function updateStock(item) {
        const card = grid.querySelector(`[data-item-id="${item.id}"]`);
        const slot = card?.querySelector("[data-stock]");
        if (!slot) return;
        slot.innerHTML = stockHtml(item);
        slot.querySelector("[data-more]")?.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            showStoresModal(item.title ?? item.sku, stock.get(item.id));
        });
    }

    function showStoresModal(title, stores) {
        const overlay = document.getElementById("modalOverlay");
        document.getElementById("modalTitle").textContent = title;
        const locationName = useHome ? "home" : location_().storeName;
        document.getElementById("modalBody").innerHTML = stores
            .map((s) => {
                const isSelected = !useHome && selectedStore && s.storeName === selectedStore.storeName;
                return `
                <div class="store-row">
                    <strong class="${isSelected ? "is-home" : ""}">${esc(s.storeName)}</strong>
                    <span><span class="status-on">${s.quantity} in stock</span>, ${s.distanceMiles.toFixed(1)} mi from ${esc(locationName)}</span>
                </div>`;
            })
            .join("");
        const opener = document.activeElement;
        overlay.classList.remove("hidden");
        document.getElementById("modalClose").focus();
        const close = () => {
            overlay.classList.add("hidden");
            document.removeEventListener("keydown", onEscape);
            if (opener?.isConnected) opener.focus();
        };
        const onEscape = (e) => {
            if (e.key === "Escape") close();
        };
        document.getElementById("modalClose").onclick = close; // × or Esc, not the backdrop
        document.addEventListener("keydown", onEscape);
    }

    // ---------- cards ----------

    const PLACEHOLDER =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-size='40' fill='%23475569'%3E📦%3C/text%3E%3C/svg%3E";

    function cardHtml(item) {
        const title = item.title ?? `Product ${item.sku}`;
        return `
        <a href="${esc(item.url)}" target="_blank" rel="noopener" data-item-id="${item.id}" class="product">
            <div class="product-image">
                <img src="${esc(item.imageUrl || PLACEHOLDER)}" alt="" loading="lazy">
                ${item.sellPrice != null ? `<span class="price-tag">£${item.sellPrice}</span>` : ""}
                ${
                    canEdit
                        ? `<div class="product-tools">
                               <button type="button" data-edit class="btn btn-small" aria-label="Edit ${esc(title)}">Edit</button>
                               <button type="button" data-delete class="btn btn-small btn-danger" aria-label="Stop tracking ${esc(title)}">Remove</button>
                           </div>`
                        : ""
                }
            </div>
            <div class="product-body">
                <div class="product-category">${esc(item.category ?? "Product")}</div>
                <h3 class="product-title">${esc(title)}</h3>
                ${item.notes ? `<p class="product-notes">${esc(item.notes)}</p>` : ""}
                <div data-stock>${stockHtml(item)}</div>
            </div>
        </a>`;
    }

    function render() {
        const list = sortByDistance ? [...items].sort((a, b) => nearestDistance(a) - nearestDistance(b)) : items;
        grid.innerHTML = list.map(cardHtml).join("");
        document.getElementById("emptyState").classList.toggle("hidden", items.length > 0);
        renderStats();
        for (const item of list) {
            updateStock(item);
            const card = grid.querySelector(`[data-item-id="${item.id}"]`);
            card.querySelector("[data-edit]")?.addEventListener("click", (e) => {
                e.preventDefault();
                openEditor(item);
            });
            card.querySelector("[data-delete]")?.addEventListener("click", (e) => {
                e.preventDefault();
                deleteItem(item);
            });
        }
    }

    // ---------- editing (signed in) ----------

    function renderAdminBar(me) {
        const bar = document.getElementById("adminBar");
        if (me.canEdit) {
            bar.classList.remove("hidden");
            bar.innerHTML = `
                <form>
                    <input name="url" autocomplete="off" class="input" aria-label="CeX product link"
                        placeholder="Paste a CeX product link to start tracking it">
                    <button class="btn btn-primary">Track</button>
                </form>
                <p data-status class="track-status" aria-live="polite"></p>`;
            const form = bar.querySelector("form");
            form.onsubmit = (e) => {
                e.preventDefault();
                addItem(form);
            };
            // Capture as soon as a link is pasted.
            form.url.addEventListener("paste", () =>
                setTimeout(() => {
                    if (/webuy\.com|[?&]id=/.test(form.url.value)) addItem(form);
                }, 0),
            );
        } else if (Auth.mustEnrolMfa()) {
            bar.classList.remove("hidden");
            bar.innerHTML = `<div style="text-align:center"><button type="button" class="btn btn-warn">Set up 2FA to edit</button></div>`;
            bar.querySelector("button").onclick = Auth.openMfaSetup;
        } else {
            bar.classList.add("hidden");
            bar.innerHTML = "";
        }
    }

    async function addItem(form) {
        const status = document.getElementById("adminBar").querySelector("[data-status]");
        const button = form.querySelector("button");
        const url = form.url.value.trim();
        if (!url || button.disabled) return;
        button.disabled = true;
        status.className = "track-status is-working pulse";
        status.textContent = "Looking it up on CeX…";
        try {
            const item = await Auth.api("POST", "/api/cex-items", { url });
            items.push(item);
            render();
            loadStock([item]);
            form.reset();
            status.className = "track-status is-ok";
            status.textContent = `Now tracking ${item.title}, £${item.sellPrice}`;
        } catch (e) {
            status.className = "track-status is-error";
            status.textContent = e.message;
        } finally {
            button.disabled = false;
            form.url.focus();
        }
    }

    function openEditor(item) {
        const { CLS } = Auth;
        const updated = item.refreshedAt ? new Date(item.refreshedAt).toLocaleString() : "never";
        const d = Auth.dialog(
            "Edit tracked item",
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form class="stack">
                <div class="item-summary">
                    <img src="${esc(item.imageUrl || PLACEHOLDER)}" alt="">
                    <div style="min-width:0">
                        <div><b>${esc(item.title ?? item.sku)}</b></div>
                        <div class="muted" style="font-size:14px">£${item.sellPrice ?? "?"} to buy, £${item.cashPrice ?? "?"} cash, £${item.exchangePrice ?? "?"} voucher</div>
                        <div class="faint" style="font-size:13px">Prices from ${esc(updated)}</div>
                    </div>
                </div>
                <div><label class="label" for="cex-url">CeX link</label><input id="cex-url" name="url" class="input code" value="${esc(item.url)}"></div>
                <div><label class="label" for="cex-notes">Notes</label><textarea id="cex-notes" name="notes" rows="2" maxlength="1000" class="input" placeholder="For example: birthday present, wait for under £10">${esc(item.notes ?? "")}</textarea></div>
                <div class="actions">
                    <button type="button" data-refresh class="btn push">Refresh from CeX</button>
                    <button type="button" data-cancel class="btn">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>`,
        );
        const form = d.$("form");
        const replace = (saved) => {
            items = items.map((i) => (i.id === saved.id ? saved : i));
            if (saved.sku !== item.sku) stock.delete(saved.id);
            render();
            if (saved.sku !== item.sku) loadStock([saved]);
        };
        const snapshot = () => JSON.stringify([...new FormData(form)]);
        const initial = snapshot();
        d.guard(() => snapshot() !== initial);
        d.$("[data-cancel]").onclick = () => d.requestClose();
        d.$("[data-refresh]").onclick = (e) =>
            Auth.busy(d, e.currentTarget, async () => {
                const saved = await Auth.api("POST", `/api/cex-items/${item.id}/refresh`);
                replace(saved);
                d.close();
                Auth.showSuccess(`Refreshed ${saved.title}: £${saved.sellPrice}`);
            });
        form.onsubmit = (e) => {
            e.preventDefault();
            Auth.busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = await Auth.api("PUT", `/api/cex-items/${item.id}`, {
                    url: form.url.value.trim(),
                    notes: form.notes.value,
                });
                replace(saved);
                d.close();
                Auth.showSuccess(`Saved "${saved.title}"`);
            });
        };
    }

    async function deleteItem(item) {
        const sure = await Auth.confirm({ title: `Stop tracking ${item.title ?? item.sku}?`, message: "It comes off the tracker, with its stock checks.", confirmLabel: "Stop tracking", danger: true });
        if (!sure) return;
        try {
            await Auth.api("DELETE", `/api/cex-items/${item.id}`);
            items = items.filter((i) => i.id !== item.id);
            stock.delete(item.id);
            render();
            Auth.showSuccess(`Stopped tracking "${item.title ?? item.sku}"`);
        } catch (e) {
            Auth.showError(e.message);
        }
    }

    // ---------- home (the signed-in user's address) ----------

    let homeKnown;
    const firstHome = new Promise((resolve) => (homeKnown = resolve));

    async function fetchHome(me) {
        if (!me.authenticated) return null;
        try {
            const res = await Auth.api("GET", "/api/account/address");
            return res.postcode ? { postcode: res.postcode } : null;
        } catch {
            return null;
        }
    }

    // prefer: switch to home now (the address was just saved), whatever was picked before
    function setHome(next, { prefer = false } = {}) {
        const changed = home?.postcode !== next?.postcode;
        home = next;
        if (!started || (!changed && !prefer)) return;
        if (prefer && home) savePreference({ type: "home" });
        const choice = preferredChoice();
        if (choice === "home" ? !useHome || changed : useHome || choice !== selectedStore) applyChoice(choice);
    }

    document.addEventListener("auth-changed", async (e) => {
        const wasEditing = canEdit;
        canEdit = e.detail.canEdit === true;
        renderAdminBar(e.detail);
        if (canEdit !== wasEditing) render();
        setHome(await fetchHome(e.detail));
        homeKnown();
    });

    document.addEventListener("home-changed", (e) => setHome(e.detail, { prefer: true }));

    // ---------- start ----------

    document.getElementById("sortBtn").addEventListener("click", (e) => {
        sortByDistance = !sortByDistance;
        e.currentTarget.setAttribute("aria-pressed", String(sortByDistance));
        e.currentTarget.classList.toggle("btn-primary", sortByDistance);
        render();
    });

    (async function init() {
        try {
            [allStores, items] = await Promise.all([
                getJson("/api/cex/stores").catch(() => []),
                getJson("/api/cex-items"),
                // whether there's a home to measure from (don't wait long: a store works meanwhile)
                Promise.race([firstHome, new Promise((r) => setTimeout(r, 3000))]),
            ]);
        } catch (e) {
            Auth.showError("Couldn't load the tracked items: " + e.message);
        }
        started = true;
        initStoreSelector();
        render();
        hideLoading();
        loadStock(items);
    })();
})();
