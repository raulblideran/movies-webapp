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
        overlay.classList.add("opacity-0");
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
                          `<div data-store-id="${s.storeId}" class="px-4 py-3 cursor-pointer hover:bg-cyan-500/10 hover:text-cyan-400 transition-colors text-sm font-medium ${
                              selectedStore?.storeId === s.storeId ? "bg-green-500/10 text-green-400" : ""
                          }">${esc(s.storeName)}</div>`,
                  )
                  .join("")
            : `<div class="p-3 text-center text-gray-400 text-sm">No stores found</div>`;
        dropdown.querySelectorAll("[data-store-id]").forEach((opt) => {
            opt.onclick = () => selectStore(allStores.find((s) => s.storeId === Number(opt.dataset.storeId)));
        });
    }

    function selectStore(store) {
        selectedStore = store;
        document.getElementById("storeSearch").value = store.storeName;
        document.getElementById("storeDropdown").classList.add("hidden");
        savePreference(store.storeId);
        stock.clear();
        render();
        loadStock(items);
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
                o.classList.toggle("bg-cyan-500/20", i === selectedIndex);
                if (i === selectedIndex) o.scrollIntoView({ block: "nearest" });
            });

        input.addEventListener("input", () => {
            selectedIndex = -1;
            renderStoreDropdown(input.value);
            dropdown.classList.remove("hidden");
        });
        input.addEventListener("focus", () => {
            input.select();
            renderStoreDropdown("");
            dropdown.classList.remove("hidden");
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
                dropdown.classList.add("hidden");
                input.value = location_().storeName;
                input.blur();
            }
        });
        document.addEventListener("click", (e) => {
            if (!input.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.classList.add("hidden");
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
            }
        }
        await Promise.all([worker(), worker(), worker(), worker()]);
        if (sortByDistance) render();
    }

    function stockHtml(item) {
        if (!stock.has(item.id))
            return `<div class="pt-2 border-t border-slate-700/50 text-gray-500 text-xs text-center animate-pulse">Checking stock…</div>`;
        const stores = stock.get(item.id);
        if (stores === null)
            return `<div class="pt-2 border-t border-slate-700/50 text-gray-500 text-xs text-center">Stock unavailable</div>`;
        if (stores.length === 0)
            return `<div class="pt-2 border-t border-slate-700/50 text-red-400 font-semibold text-xs text-center">Not in stock</div>`;

        const nearest = stores[0];
        const isSelected = selectedStore && nearest.storeName === selectedStore.storeName;
        return `
            <div class="pt-2 border-t border-slate-700/50 flex items-center justify-between gap-2">
                <div class="flex-1 min-w-0">
                    <div class="${isSelected ? "text-yellow-400" : "text-green-400"} font-semibold text-xs truncate">${esc(nearest.storeName)}</div>
                    <div class="text-gray-400 text-[10px] mt-0.5">${kmToMiles(nearest.distanceKm).toFixed(1)} mi • ${nearest.quantity} in stock</div>
                </div>
                ${
                    stores.length > 1
                        ? `<button data-more class="px-2 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-500 text-cyan-400 rounded-md text-[10px] font-semibold transition-all flex-shrink-0">+${stores.length - 1}</button>`
                        : ""
                }
            </div>`;
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
                <div class="p-4 bg-slate-700/30 rounded-lg hover:bg-slate-700/50 transition-colors">
                    <div class="font-semibold mb-2 ${isSelected ? "text-yellow-400" : "text-white"}">${esc(s.storeName)}</div>
                    <div class="flex gap-4 text-sm">
                        <span class="text-green-400 font-semibold">${s.quantity} in stock</span>
                        <span class="text-cyan-400">${kmToMiles(s.distanceKm).toFixed(1)} mi from ${esc(locationName)}</span>
                    </div>
                </div>`;
            })
            .join("");
        overlay.classList.remove("hidden");
        const close = () => {
            overlay.classList.add("hidden");
            document.removeEventListener("keydown", onEscape);
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
        return `
        <a href="${esc(item.url)}" target="_blank" rel="noopener" data-item-id="${item.id}"
           class="group relative block bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-2xl overflow-hidden hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/20 hover:-translate-y-2 hover:scale-[1.02] transition-all duration-300">
            <div class="relative h-64 bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center overflow-hidden">
                <img src="${esc(item.imageUrl || PLACEHOLDER)}" alt="" class="max-w-[90%] max-h-[90%] object-contain drop-shadow-2xl">
                ${
                    canEdit
                        ? `<div class="absolute top-2 right-2 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                               <button data-edit title="Edit" class="w-8 h-8 rounded-lg bg-slate-900/80 border border-cyan-500/30 hover:border-cyan-400 text-sm">✏️</button>
                               <button data-delete title="Stop tracking" class="w-8 h-8 rounded-lg bg-slate-900/80 border border-red-500/30 hover:border-red-400 text-sm">🗑️</button>
                           </div>`
                        : ""
                }
            </div>
            <div class="p-3">
                <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="inline-block bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-900 px-2 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider truncate">${esc(item.category ?? "Product")}</div>
                    ${item.sellPrice != null ? `<div class="bg-red-900 text-white px-2 py-0.5 rounded-md text-xs font-bold">£${item.sellPrice}</div>` : ""}
                </div>
                <div class="text-white font-bold text-sm mb-2 line-clamp-2 leading-snug">${esc(item.title ?? `Product ${item.sku}`)}</div>
                ${item.notes ? `<div class="text-gray-400 text-[11px] italic mb-2 line-clamp-2">${esc(item.notes)}</div>` : ""}
                <div data-stock>${stockHtml(item)}</div>
            </div>
        </a>`;
    }

    function render() {
        const list = sortByDistance ? [...items].sort((a, b) => nearestDistance(a) - nearestDistance(b)) : items;
        grid.innerHTML = list.map(cardHtml).join("");
        document.getElementById("emptyState").classList.toggle("hidden", items.length > 0);
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
                <form class="flex gap-2">
                    <input name="url" autocomplete="off" placeholder="📋 Paste a CeX product link to start tracking it…"
                        class="flex-1 bg-slate-800/50 border border-cyan-500/30 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-all">
                    <button class="bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-900 font-bold px-5 rounded-xl text-sm hover:brightness-110 disabled:opacity-50">Add</button>
                </form>
                <p data-status class="text-xs mt-2 text-center min-h-[1rem]"></p>`;
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
            bar.innerHTML = `<div class="text-center"><button class="bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 px-4 py-2.5 rounded-lg text-sm font-semibold text-yellow-400">🛡️ Set up 2FA to edit</button></div>`;
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
        status.className = "text-xs mt-2 text-center min-h-[1rem] text-cyan-300 animate-pulse";
        status.textContent = "Looking it up on CeX…";
        try {
            const item = await Auth.api("POST", "/api/cex-items", { url });
            items.push(item);
            render();
            loadStock([item]);
            form.reset();
            status.className = "text-xs mt-2 text-center min-h-[1rem] text-green-400";
            status.textContent = `✅ Now tracking "${item.title}" (£${item.sellPrice})`;
        } catch (e) {
            status.className = "text-xs mt-2 text-center min-h-[1rem] text-red-400";
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
            "✏️ Edit tracked item",
            `
            <div data-error class="${CLS.error}"></div>
            <form class="space-y-4">
                <div class="flex gap-3 items-center">
                    <img src="${esc(item.imageUrl || PLACEHOLDER)}" class="w-16 h-16 object-contain rounded-lg bg-slate-900/60" alt="">
                    <div class="min-w-0">
                        <div class="text-white font-semibold text-sm">${esc(item.title ?? item.sku)}</div>
                        <div class="text-xs text-gray-400">£${item.sellPrice ?? "?"} · cash £${item.cashPrice ?? "?"} · voucher £${item.exchangePrice ?? "?"}</div>
                        <div class="text-[11px] text-gray-500">Prices captured ${esc(updated)}</div>
                    </div>
                </div>
                <div><label class="${CLS.label}">CeX link</label><input name="url" class="${CLS.input} font-mono text-xs" value="${esc(item.url)}"></div>
                <div><label class="${CLS.label}">Notes</label><textarea name="notes" rows="2" maxlength="1000" class="${CLS.input}" placeholder="e.g. birthday present, wait for under £10">${esc(item.notes ?? "")}</textarea></div>
                <div class="flex gap-2 justify-end">
                    <button type="button" data-refresh class="${CLS.btn} ${CLS.secondary} mr-auto">🔄 Refresh from CeX</button>
                    <button type="button" data-cancel class="${CLS.btn} ${CLS.secondary}">Cancel</button>
                    <button type="submit" class="${CLS.btn} ${CLS.primary}">Save</button>
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
                Auth.showSuccess(`Updated "${saved.title}" (£${saved.sellPrice})`);
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
        e.currentTarget.textContent = sortByDistance ? "Default Order" : "Sort by Distance";
        e.currentTarget.classList.toggle("bg-cyan-500/20", sortByDistance);
        e.currentTarget.classList.toggle("border-cyan-500", sortByDistance);
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
