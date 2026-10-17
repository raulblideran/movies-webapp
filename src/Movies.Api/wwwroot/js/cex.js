// CeX stock tracker: tracked items come from /api/cex-items, stock per store from /api/cex/{sku}/stores.
// Signed-in editors can paste a link to track it, and edit/refresh/delete cards. Needs auth.js.

(function () {
    const esc = Auth.esc;
    const DEFAULT_LOCATION = { storeName: "Doncaster", latitude: 53.52228, longitude: -1.13534 };
    const PREF_KEY = "cexStorePreference";

    let allStores = [];
    let selectedStore = null;
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

    const kmToMiles = (km) => km * 0.621371;
    const location_ = () => selectedStore ?? DEFAULT_LOCATION;
    const nearestDistance = (item) => stock.get(item.id)?.[0]?.distanceKm ?? Infinity;

    function hideLoading() {
        const overlay = document.getElementById("loadingOverlay");
        overlay.classList.add("is-fading");
        setTimeout(() => overlay.classList.add("hidden"), 300);
    }

    function loadPreference() {
        try {
            const prefs = JSON.parse(localStorage.getItem(PREF_KEY) ?? "null");
            return prefs?.type === "store" ? prefs.storeId : null;
        } catch {
            return null;
        }
    }

    function savePreference(storeId) {
        try {
            localStorage.setItem(PREF_KEY, JSON.stringify({ type: "store", storeId }));
        } catch {
            // storage unavailable: the choice just won't be remembered
        }
    }

    // ---------- store picker ----------

    function renderStoreDropdown(filterText = "") {
        const dropdown = document.getElementById("storeDropdown");
        const filtered = allStores.filter((s) => s.storeName.toLowerCase().includes(filterText.toLowerCase()));
        dropdown.innerHTML = filtered.length
            ? filtered
                  .map(
                      (s) =>
                          `<div data-store-id="${s.storeId}" role="option" aria-selected="${selectedStore?.storeId === s.storeId}" class="${
                              selectedStore?.storeId === s.storeId ? "is-selected" : ""
                          }">${esc(s.storeName)}</div>`,
                  )
                  .join("")
            : `<div class="faint" style="padding:10px;text-align:center">No stores match</div>`;
        dropdown.querySelectorAll("[data-store-id]").forEach((opt) => {
            opt.onclick = () => selectStore(allStores.find((s) => s.storeId === Number(opt.dataset.storeId)));
        });
    }

    function selectStore(store) {
        selectedStore = store;
        document.getElementById("storeSearch").value = store.storeName;
        setDropdown(false);
        savePreference(store.storeId);
        stock.clear();
        render();
        loadStock(items);
    }

    function setDropdown(open) {
        document.getElementById("storeDropdown").classList.toggle("hidden", !open);
        document.getElementById("storeSearch").setAttribute("aria-expanded", String(open));
    }

    function initStoreSelector() {
        const input = document.getElementById("storeSearch");
        const dropdown = document.getElementById("storeDropdown");
        const savedId = loadPreference();
        selectedStore =
            allStores.find((s) => s.storeId === savedId) ??
            allStores.find((s) => s.storeName === DEFAULT_LOCATION.storeName) ??
            null;
        input.value = location_().storeName;

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
                input.value = location_().storeName;
                input.blur();
            }
        });
        document.addEventListener("click", (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                setDropdown(false);
                if (!input.value.trim()) input.value = location_().storeName;
            }
        });
    }

    // ---------- stock ----------

    async function loadStock(list) {
        const { latitude, longitude } = location_();
        const queue = [...list];
        async function worker() {
            while (queue.length) {
                const item = queue.shift();
                try {
                    stock.set(item.id, await getJson(`/api/cex/${encodeURIComponent(item.sku)}/stores?lat=${latitude}&lon=${longitude}`));
                } catch {
                    stock.set(item.id, null);
                }
                updateStock(item);
                renderStats();
            }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (sortByDistance) render();
    }

    function stockHtml(item) {
        if (!stock.has(item.id)) return `<div class="stock stock-wait pulse">Checking stock…</div>`;
        const stores = stock.get(item.id);
        if (stores === null) return `<div class="stock stock-wait">Stock unavailable right now</div>`;
        if (stores.length === 0) return `<div class="stock stock-none">Not in stock anywhere</div>`;

        const nearest = stores[0];
        const isSelected = selectedStore && nearest.storeName === selectedStore.storeName;
        return `
            <div class="stock">
                <div style="min-width:0">
                    <div class="stock-store${isSelected ? " is-home" : ""}">${esc(nearest.storeName)}</div>
                    <div class="stock-meta">${kmToMiles(nearest.distanceKm).toFixed(1)} mi, ${nearest.quantity} in stock</div>
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
        const near = checked.filter((i) => (stock.get(i.id)?.[0]?.distanceKm ?? Infinity) <= 16.1).length;
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
        const locationName = location_().storeName;
        document.getElementById("modalBody").innerHTML = stores
            .map((s) => {
                const isSelected = selectedStore && s.storeName === selectedStore.storeName;
                return `
                <div class="store-row">
                    <strong class="${isSelected ? "is-home" : ""}">${esc(s.storeName)}</strong>
                    <span><span class="status-on">${s.quantity} in stock</span>, ${kmToMiles(s.distanceKm).toFixed(1)} mi from ${esc(locationName)}</span>
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
        document.getElementById("modalClose").onclick = close;
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };
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
        d.$("[data-cancel]").onclick = () => d.close();
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
        if (!window.confirm(`Stop tracking "${item.title ?? item.sku}"?`)) return;
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

    document.addEventListener("auth-changed", (e) => {
        const wasEditing = canEdit;
        canEdit = e.detail.canEdit === true;
        renderAdminBar(e.detail);
        if (canEdit !== wasEditing) render();
    });

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
            ]);
        } catch (e) {
            Auth.showError("Couldn't load the tracked items: " + e.message);
        }
        initStoreSelector();
        render();
        hideLoading();
        loadStock(items);
    })();
})();
