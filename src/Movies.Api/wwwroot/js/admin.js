// Sign-in, MFA, user management and title editing. Inert for anonymous visitors.

(function () {
    const esc = (v) => App.escapeHtml(v);

    const CLS = {
        input: "w-full px-3 py-2 border border-white/10 bg-black/40 text-white rounded-lg text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 hover:border-white/20",
        label: "block mb-1 text-[11px] uppercase tracking-wider text-gray-400 font-semibold",
        btn: "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        primary: "bg-gradient-to-r from-primary to-red-600 text-white hover:shadow-[0_8px_20px_rgba(233,69,96,0.5)]",
        secondary: "bg-white/5 hover:bg-white/10 border border-white/15 text-white",
        danger: "bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-400",
        link: "text-gray-400 hover:text-primary underline-offset-2 hover:underline cursor-pointer",
        error: "hidden mb-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm",
    };

    let me = { authenticated: false };

    // ---------- API ----------

    async function api(method, url, body) {
        const init = { method, credentials: "same-origin", headers: {} };
        if (body !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
        }
        const resp = await fetch(url, init);
        const text = resp.status === 204 ? "" : await resp.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }
        if (!resp.ok) {
            let msg =
                data?.detail ||
                (resp.status === 429 ? "Too many attempts. Wait a minute and try again." : null) ||
                (resp.status === 401 ? "Please sign in again." : null) ||
                (resp.status === 403 ? "You don't have permission to do that." : null) ||
                data?.title ||
                `Request failed (${resp.status})`;
            if (data?.errors) msg = Object.values(data.errors).flat().join(" ");
            if (resp.status === 401 || resp.status === 403) refreshMe();
            const err = new Error(msg);
            err.status = resp.status;
            throw err;
        }
        return data;
    }

    async function refreshMe() {
        try {
            me = await api("GET", "/api/auth/me");
        } catch {
            me = { authenticated: false };
        }
        render();
        return me;
    }

    const mustEnrolMfa = () => me.authenticated && me.mfaRequired && !me.mfaEnabled;

    // ---------- dialogs ----------

    function dialog(title, bodyHtml, { wide = false, onClose } = {}) {
        const root = document.createElement("div");
        root.setAttribute("data-admin-dialog", "");
        root.className =
            "fixed inset-0 z-[1100] bg-black/85 flex items-center justify-center p-5 animate-fadeIn";
        root.innerHTML = `
        <div class="bg-gradient-to-br from-[#1a1a1a] to-[#2a0a0a] rounded-3xl ${wide ? "max-w-4xl" : "max-w-md"} w-full max-h-[90vh] overflow-y-auto relative border-2 border-primary/50 shadow-2xl animate-slideUp p-7">
            <button type="button" data-close class="absolute top-4 right-4 bg-black/70 border-2 border-primary text-white text-2xl w-10 h-10 rounded-full cursor-pointer flex items-center justify-center transition-all duration-300 hover:bg-primary hover:rotate-90">×</button>
            <h2 class="text-2xl font-black text-white mb-5 pr-12">${title}</h2>
            <div data-body>${bodyHtml}</div>
        </div>`;
        const d = {
            root,
            $: (sel) => root.querySelector(sel),
            $$: (sel) => [...root.querySelectorAll(sel)],
            body: root.querySelector("[data-body]"),
            close() {
                root.remove();
                document.removeEventListener("keydown", onKey);
                onClose?.();
            },
            error(msg) {
                const el = root.querySelector("[data-error]");
                if (!el) return App.showError(msg);
                el.textContent = msg || "";
                el.classList.toggle("hidden", !msg);
            },
        };
        const onKey = (e) => {
            if (e.key === "Escape" && root === [...document.querySelectorAll("[data-admin-dialog]")].pop()) d.close();
        };
        root.querySelector("[data-close]").onclick = () => d.close();
        root.addEventListener("mousedown", (e) => {
            if (e.target === root) d.close();
        });
        document.addEventListener("keydown", onKey);
        document.body.appendChild(root);
        root.querySelector("input:not([type=hidden]), select, textarea")?.focus();
        return d;
    }

    // Disable the submit button while a request runs, and surface errors in the dialog.
    async function busy(d, button, fn) {
        d.error("");
        button.disabled = true;
        try {
            return await fn();
        } catch (e) {
            d.error(e.message);
        } finally {
            button.disabled = false;
        }
    }

    // ---------- sign in ----------

    function openLogin() {
        const d = dialog(
            "🔐 Sign in",
            `
            <div data-error class="${CLS.error}"></div>
            <form data-step="password" class="space-y-4">
                <div><label class="${CLS.label}">Username</label><input name="userName" autocomplete="username" class="${CLS.input}" required></div>
                <div><label class="${CLS.label}">Password</label><input name="password" type="password" autocomplete="current-password" class="${CLS.input}" required></div>
                <label class="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" name="rememberMe" checked> Keep me signed in</label>
                <button class="${CLS.btn} ${CLS.primary} w-full justify-center">Continue</button>
            </form>
            <form data-step="mfa" class="space-y-4 hidden">
                <p class="text-sm text-gray-300" data-mfa-hint>Enter the 6-digit code from your authenticator app.</p>
                <div data-code><label class="${CLS.label}">Authentication code</label><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="${CLS.input} text-center text-2xl tracking-[0.4em]"></div>
                <div data-recovery class="hidden"><label class="${CLS.label}">Recovery code</label><input name="recoveryCode" autocomplete="off" class="${CLS.input} font-mono"></div>
                <label class="flex items-center gap-2 text-sm text-gray-300" data-remember><input type="checkbox" name="rememberDevice"> Don't ask again on this device for 30 days</label>
                <button class="${CLS.btn} ${CLS.primary} w-full justify-center">Verify</button>
                <div class="text-center text-xs"><a data-toggle-recovery class="${CLS.link}">Use a recovery code instead</a></div>
            </form>`,
        );

        const pw = d.$('[data-step="password"]');
        const mfa = d.$('[data-step="mfa"]');
        let useRecovery = false;

        pw.onsubmit = (e) => {
            e.preventDefault();
            busy(d, pw.querySelector("button"), async () => {
                const res = await api("POST", "/api/auth/login", {
                    userName: pw.userName.value,
                    password: pw.password.value,
                    rememberMe: pw.rememberMe.checked,
                });
                if (res.requiresMfa) {
                    pw.classList.add("hidden");
                    mfa.classList.remove("hidden");
                    mfa.code.focus();
                } else {
                    await signedIn(d);
                }
            });
        };

        d.$("[data-toggle-recovery]").onclick = () => {
            useRecovery = !useRecovery;
            d.$("[data-code]").classList.toggle("hidden", useRecovery);
            d.$("[data-recovery]").classList.toggle("hidden", !useRecovery);
            d.$("[data-remember]").classList.toggle("hidden", useRecovery);
            d.$("[data-toggle-recovery]").textContent = useRecovery
                ? "Use your authenticator app instead"
                : "Use a recovery code instead";
            (useRecovery ? mfa.recoveryCode : mfa.code).focus();
        };

        mfa.onsubmit = (e) => {
            e.preventDefault();
            busy(d, mfa.querySelector("button"), async () => {
                await api(
                    "POST",
                    "/api/auth/login/mfa",
                    useRecovery
                        ? { recoveryCode: mfa.recoveryCode.value }
                        : { code: mfa.code.value, rememberDevice: mfa.rememberDevice.checked },
                );
                await signedIn(d);
            });
        };
    }

    async function signedIn(d) {
        d.close();
        await refreshMe();
        App.showSuccess(`👋 Signed in as ${me.userName}`);
        if (mustEnrolMfa()) openMfaSetup();
    }

    async function signOut() {
        await api("POST", "/api/auth/logout").catch(() => {});
        await refreshMe();
        App.closeModal();
        App.showSuccess("Signed out");
    }

    // ---------- MFA enrolment ----------

    async function openMfaSetup() {
        let setup;
        try {
            setup = await api("POST", "/api/account/mfa/setup");
        } catch (e) {
            return App.showError(e.message);
        }
        const d = dialog(
            "🛡️ Set up two-factor authentication",
            `
            ${mustEnrolMfa() ? `<p class="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 text-sm">Two-factor authentication is required before you can make changes.</p>` : ""}
            <div data-error class="${CLS.error}"></div>
            <div data-enrol class="space-y-4">
                <p class="text-sm text-gray-300">1. Scan this QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…).</p>
                <div class="flex justify-center"><div data-qr class="bg-white p-3 rounded-xl"></div></div>
                <p class="text-xs text-gray-400 text-center">Can't scan? Enter this key manually:<br><code class="text-sm text-white break-all select-all">${esc(setup.sharedKey)}</code></p>
                <form class="space-y-3">
                    <p class="text-sm text-gray-300">2. Enter the 6-digit code the app shows.</p>
                    <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="${CLS.input} text-center text-2xl tracking-[0.4em]" required>
                    <button class="${CLS.btn} ${CLS.primary} w-full justify-center">Turn on two-factor</button>
                </form>
            </div>
            <div data-codes class="hidden"></div>`,
        );

        const qr = d.$("[data-qr]");
        if (window.QRCode) {
            new QRCode(qr, { text: setup.otpauthUri, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
        } else {
            qr.parentElement.remove();
        }

        const form = d.$("form");
        form.code.focus();
        form.onsubmit = (e) => {
            e.preventDefault();
            busy(d, form.querySelector("button"), async () => {
                const res = await api("POST", "/api/account/mfa/enable", { code: form.code.value });
                d.$("[data-enrol]").classList.add("hidden");
                showRecoveryCodes(d, res.recoveryCodes);
                await refreshMe();
            });
        };
    }

    function showRecoveryCodes(d, codes) {
        const el = d.$("[data-codes]");
        el.classList.remove("hidden");
        el.innerHTML = `
            <p class="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">✅ Two-factor authentication is on.</p>
            <p class="text-sm text-gray-300 mb-3">Save these recovery codes somewhere safe (a password manager). Each one works once if you lose your authenticator.</p>
            <div class="grid grid-cols-2 gap-2 p-4 rounded-xl bg-black/40 border border-white/10 font-mono text-sm text-white mb-4 select-all">
                ${codes.map((c) => `<div>${esc(c)}</div>`).join("")}
            </div>
            <div class="flex gap-2 flex-wrap">
                <button type="button" data-copy class="${CLS.btn} ${CLS.secondary}">📋 Copy</button>
                <button type="button" data-download class="${CLS.btn} ${CLS.secondary}">💾 Download</button>
                <button type="button" data-done class="${CLS.btn} ${CLS.primary} ml-auto">I've saved them</button>
            </div>`;
        const text = `Movies recovery codes for ${me.userName ?? ""}\n\n${codes.join("\n")}\n`;
        el.querySelector("[data-copy]").onclick = async () => {
            await navigator.clipboard?.writeText(text);
            App.showSuccess("Copied");
        };
        el.querySelector("[data-download]").onclick = () => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            a.download = "movies-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(a.href);
        };
        el.querySelector("[data-done]").onclick = () => d.close();
    }

    // ---------- account ----------

    async function openAccount() {
        let mfa;
        try {
            mfa = await api("GET", "/api/account/mfa");
        } catch (e) {
            return App.showError(e.message);
        }
        const d = dialog(
            "👤 Your account",
            `
            <div data-error class="${CLS.error}"></div>
            <p class="text-sm text-gray-300 mb-5">Signed in as <b class="text-white">${esc(me.userName)}</b> · ${esc(me.roles.join(", "))}</p>

            <h3 class="${CLS.label} !text-primary">Two-factor authentication</h3>
            <div class="mb-6 p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
                ${
                    mfa.enabled
                        ? `<p class="text-sm text-green-400">✅ On · ${mfa.recoveryCodesLeft} recovery codes left</p>
                           <form data-regen class="flex gap-2">
                               <input name="code" inputmode="numeric" maxlength="7" placeholder="Current code" class="${CLS.input}" required>
                               <button class="${CLS.btn} ${CLS.secondary} whitespace-nowrap">New recovery codes</button>
                           </form>
                           ${mfa.required ? "" : `<button type="button" data-disable class="${CLS.btn} ${CLS.danger}">Turn off</button>`}`
                        : `<p class="text-sm text-yellow-300">⚠️ Off${mfa.required ? " (required to make changes)" : ""}</p>
                           <button type="button" data-setup class="${CLS.btn} ${CLS.primary}">Set up two-factor</button>`
                }
                <div data-codes class="hidden"></div>
            </div>

            <h3 class="${CLS.label} !text-primary">Change password</h3>
            <form data-password class="space-y-3 p-4 rounded-xl bg-white/5 border border-white/10">
                <input name="currentPassword" type="password" autocomplete="current-password" placeholder="Current password" class="${CLS.input}" required>
                <input name="newPassword" type="password" autocomplete="new-password" placeholder="New password (12+ characters)" minlength="12" class="${CLS.input}" required>
                <button class="${CLS.btn} ${CLS.secondary}">Change password</button>
            </form>`,
        );

        d.$("[data-setup]")?.addEventListener("click", () => {
            d.close();
            openMfaSetup();
        });

        const regen = d.$("[data-regen]");
        if (regen)
            regen.onsubmit = (e) => {
                e.preventDefault();
                busy(d, regen.querySelector("button"), async () => {
                    const res = await api("POST", "/api/account/mfa/recovery-codes", { code: regen.code.value });
                    regen.remove();
                    showRecoveryCodes(d, res.recoveryCodes);
                });
            };

        d.$("[data-disable]")?.addEventListener("click", (e) => {
            const password = window.prompt("Enter your password to turn off two-factor authentication");
            if (!password) return;
            busy(d, e.currentTarget, async () => {
                await api("POST", "/api/account/mfa/disable", { password });
                d.close();
                await refreshMe();
                App.showSuccess("Two-factor authentication turned off");
            });
        });

        const pwForm = d.$("[data-password]");
        pwForm.onsubmit = (e) => {
            e.preventDefault();
            busy(d, pwForm.querySelector("button"), async () => {
                await api("POST", "/api/account/password", {
                    currentPassword: pwForm.currentPassword.value,
                    newPassword: pwForm.newPassword.value,
                });
                pwForm.reset();
                App.showSuccess("Password changed");
            });
        };
    }

    // ---------- users (Admin) ----------

    function randomPassword() {
        const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = crypto.getRandomValues(new Uint8Array(20));
        return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
    }

    async function openUsers() {
        const d = dialog(
            "👥 Users",
            `
            <div data-error class="${CLS.error}"></div>
            <div data-notice class="hidden mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-300 text-sm"></div>
            <div class="overflow-x-auto mb-6">
                <table class="w-full text-sm">
                    <thead><tr class="text-left text-[11px] uppercase tracking-wider text-gray-400">
                        <th class="py-2 pr-3">User</th><th class="py-2 pr-3">Role</th><th class="py-2 pr-3">2FA</th><th class="py-2 pr-3">Status</th><th class="py-2 text-right">Actions</th>
                    </tr></thead>
                    <tbody data-rows></tbody>
                </table>
            </div>
            <h3 class="${CLS.label} !text-primary">Add user</h3>
            <form data-create class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end p-4 rounded-xl bg-white/5 border border-white/10">
                <div><label class="${CLS.label}">Username</label><input name="userName" autocomplete="off" class="${CLS.input}" required></div>
                <div><label class="${CLS.label}">Password</label>
                    <div class="flex gap-1"><input name="password" autocomplete="new-password" minlength="12" class="${CLS.input} font-mono" required>
                    <button type="button" data-generate title="Generate" class="${CLS.btn} ${CLS.secondary} !px-3">🎲</button></div></div>
                <div><label class="${CLS.label}">Role</label><select name="role" class="${CLS.input}"><option>Editor</option><option>Admin</option></select></div>
                <button class="${CLS.btn} ${CLS.primary}">Add</button>
            </form>
            <p class="text-xs text-gray-500 mt-2">New users are asked to set up two-factor authentication when they first sign in.</p>`,
            { wide: true },
        );

        const notice = (msg) => {
            const el = d.$("[data-notice]");
            el.innerHTML = msg;
            el.classList.toggle("hidden", !msg);
        };

        async function load() {
            const users = await api("GET", "/api/users");
            d.$("[data-rows]").innerHTML = users
                .map((u) => {
                    const self = u.userName === me.userName;
                    const role = u.roles[0] ?? "";
                    return `
                <tr class="border-t border-white/10" data-id="${esc(u.id)}" data-name="${esc(u.userName)}">
                    <td class="py-2 pr-3 text-white font-semibold">${esc(u.userName)}${self ? ' <span class="text-xs text-gray-500">(you)</span>' : ""}</td>
                    <td class="py-2 pr-3"><select data-role class="${CLS.input} !py-1 !w-auto" ${self ? "disabled" : ""}>
                        ${["Editor", "Admin"].map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`).join("")}
                    </select></td>
                    <td class="py-2 pr-3">${u.mfaEnabled ? '<span class="text-green-400">On</span>' : '<span class="text-yellow-300">Off</span>'}</td>
                    <td class="py-2 pr-3">${u.lockedOut ? '<span class="text-red-400">Locked</span>' : '<span class="text-gray-300">Active</span>'}</td>
                    <td class="py-2 text-right whitespace-nowrap space-x-1">
                        ${self ? "" : `
                        <button data-act="${u.lockedOut ? "unlock" : "lock"}" class="${CLS.btn} ${CLS.secondary} !px-2 !py-1 text-xs">${u.lockedOut ? "Unlock" : "Lock"}</button>
                        <button data-act="reset-password" class="${CLS.btn} ${CLS.secondary} !px-2 !py-1 text-xs">Reset password</button>
                        ${u.mfaEnabled ? `<button data-act="reset-mfa" class="${CLS.btn} ${CLS.secondary} !px-2 !py-1 text-xs">Reset 2FA</button>` : ""}
                        <button data-act="delete" class="${CLS.btn} ${CLS.danger} !px-2 !py-1 text-xs">Delete</button>`}
                    </td>
                </tr>`;
                })
                .join("");
        }

        d.$("[data-rows]").addEventListener("change", (e) => {
            if (!e.target.matches("[data-role]")) return;
            const id = e.target.closest("tr").dataset.id;
            busy(d, e.target, async () => {
                await api("PUT", `/api/users/${id}/role`, { role: e.target.value });
                await load();
            });
        });

        d.$("[data-rows]").addEventListener("click", (e) => {
            const btn = e.target.closest("[data-act]");
            if (!btn) return;
            const tr = btn.closest("tr");
            const { id, name } = tr.dataset;
            const act = btn.dataset.act;
            const confirmText = {
                lock: `Lock ${name}? They'll be signed out and can't sign in until unlocked.`,
                "reset-mfa": `Reset two-factor for ${name}? They'll have to enrol again on next sign-in.`,
                delete: `Delete ${name}? This can't be undone.`,
                "reset-password": `Reset ${name}'s password? A new random password will be shown once.`,
            }[act];
            if (confirmText && !window.confirm(confirmText)) return;
            notice("");
            busy(d, btn, async () => {
                if (act === "delete") await api("DELETE", `/api/users/${id}`);
                else if (act === "reset-password") {
                    const password = randomPassword();
                    await api("POST", `/api/users/${id}/reset-password`, { password });
                    notice(`New password for <b>${esc(name)}</b>: <code class="select-all text-white">${esc(password)}</code>`);
                } else await api("POST", `/api/users/${id}/${act}`);
                await load();
            });
        });

        const form = d.$("[data-create]");
        d.$("[data-generate]").onclick = () => (form.password.value = randomPassword());
        form.onsubmit = (e) => {
            e.preventDefault();
            busy(d, form.querySelector("button[type=submit], button:not([type])"), async () => {
                const userName = form.userName.value.trim();
                const password = form.password.value;
                await api("POST", "/api/users", { userName, password, role: form.role.value });
                form.reset();
                notice(`Created <b>${esc(userName)}</b> with password <code class="select-all text-white">${esc(password)}</code>`);
                await load();
            });
        };

        try {
            await load();
        } catch (e) {
            d.error(e.message);
        }
    }

    // ---------- title editing ----------

    const thisMonth = () => new Date().toISOString().slice(0, 7) + "-01";
    const toMonthInput = (iso) => (iso ? iso.slice(0, 7) : "");
    const fromMonthInput = (v) => (v ? `${v}-01` : null);
    const numOrNull = (v) => (v === "" || v == null ? null : Number(v));

    function toRequest(row) {
        return {
            name: row.name,
            type: row.type,
            firstWatch: row.firstWatch,
            latestWatch: row.latestWatch,
            watchCount: row.watchCount,
            rating: row.rating,
            rewatchPotential: row.rewatchPotential,
            genres: row.genres,
            physicalFormats: row.physicalFormats,
            seasons: row.seasons,
            episodesTotal: row.episodesTotal,
            withBogdan: row.withBogdan,
            dateWithBogdan: row.dateWithBogdan,
            comments: row.comments,
            releaseYear: row.releaseYear,
            pricePaid: row.pricePaid,
            cexLinks: row.cexLinks,
            tmdbId: row.tmdbId,
            tmdbMediaType: row.tmdbMediaType,
            posterPath: row.posterPath,
        };
    }

    async function afterSave(saved, message) {
        await App.reload();
        App.showSuccess(message);
        const fresh = App.getAll().find((r) => r.id === saved.id);
        if (fresh) App.openModal(fresh);
        else App.closeModal();
    }

    function chipInput(container, initial, suggestions, listId) {
        const values = [...initial];
        container.className = `${CLS.input} flex flex-wrap gap-1.5 items-center min-h-[42px] cursor-text`;
        container.innerHTML = `<datalist id="${listId}">${suggestions.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
        const input = document.createElement("input");
        input.setAttribute("list", listId);
        input.className = "flex-1 min-w-[100px] bg-transparent outline-none text-sm text-white";
        input.placeholder = "Type and press Enter";

        function render() {
            container.querySelectorAll("[data-chip]").forEach((c) => c.remove());
            values.forEach((v, i) => {
                const chip = document.createElement("span");
                chip.dataset.chip = "";
                chip.className = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 border border-primary/40 text-xs text-white";
                chip.innerHTML = `${esc(v)} <button type="button" class="text-gray-300 hover:text-white">×</button>`;
                chip.querySelector("button").onclick = () => {
                    values.splice(i, 1);
                    render();
                };
                container.insertBefore(chip, input);
            });
        }
        function commit() {
            for (const part of input.value.split(",")) {
                const v = part.trim();
                if (v && !values.some((x) => x.toLowerCase() === v.toLowerCase())) values.push(v);
            }
            input.value = "";
            render();
        }
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
            } else if (e.key === "Backspace" && !input.value && values.length) {
                values.pop();
                render();
            }
        });
        input.addEventListener("change", commit); // picking from the datalist
        input.addEventListener("blur", commit);
        container.addEventListener("click", () => input.focus());
        container.appendChild(input);
        render();
        return { get: () => (commit(), values) };
    }

    function unique(getList) {
        const map = new Map();
        for (const r of App.getAll()) for (const v of getList(r)) if (!map.has(v.toLowerCase())) map.set(v.toLowerCase(), v);
        return [...map.values()].sort((a, b) => a.localeCompare(b));
    }

    function openEditor(row) {
        const isNew = !row;
        row = row ?? {
            name: "",
            type: "Film",
            watchCount: 1,
            firstWatch: thisMonth(),
            latestWatch: thisMonth(),
            genres: [],
            physicalFormats: [],
            cexLinks: [],
            withBogdan: false,
        };
        const poster = { tmdbId: row.tmdbId ?? null, tmdbMediaType: row.tmdbMediaType ?? null, posterPath: row.posterPath ?? null };
        const f = (label, html, cls = "") => `<div class="${cls}"><label class="${CLS.label}">${label}</label>${html}</div>`;
        const v = (x) => (x == null ? "" : esc(x));

        const d = dialog(
            isNew ? "➕ Add title" : `✏️ Edit ${esc(row.name)}`,
            `
            <div data-error class="${CLS.error}"></div>
            <form class="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-6">
                <div class="space-y-2">
                    <div data-poster class="w-full aspect-[2/3] rounded-xl bg-gradient-to-br from-primary/20 to-black/40 flex items-center justify-center text-4xl overflow-hidden">🎬</div>
                    <button type="button" data-find class="${CLS.btn} ${CLS.secondary} w-full justify-center">🔎 Find poster</button>
                    <button type="button" data-clear-poster class="${CLS.btn} ${CLS.secondary} w-full justify-center text-xs">Remove poster</button>
                </div>
                <div class="space-y-4">
                    <div class="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
                        ${f("Name", `<input name="name" required maxlength="300" class="${CLS.input}" value="${v(row.name)}">`)}
                        ${f("Type", `<select name="type" class="${CLS.input}">${["Film", "Series"].map((t) => `<option ${t === row.type ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
                    </div>
                    <div data-results class="hidden"></div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${f("Rating /10", `<input name="rating" type="number" min="0" max="11" step="0.5" placeholder="?" class="${CLS.input}" value="${v(row.rating)}">`)}
                        ${f("Rewatch /10", `<input name="rewatchPotential" type="number" min="0" max="10" step="1" class="${CLS.input}" value="${v(row.rewatchPotential)}">`)}
                        ${f("Watch count", `<input name="watchCount" type="number" min="0" step="1" class="${CLS.input}" value="${v(row.watchCount)}">`)}
                        ${f("Release year", `<input name="releaseYear" type="number" min="1870" max="2200" class="${CLS.input}" value="${v(row.releaseYear)}">`)}
                    </div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        ${f("1st watch", `<input name="firstWatch" type="month" class="${CLS.input}" value="${toMonthInput(row.firstWatch)}">`)}
                        ${f("Latest watch", `<input name="latestWatch" type="month" class="${CLS.input}" value="${toMonthInput(row.latestWatch)}">`)}
                        ${f("Seasons", `<input name="seasons" type="number" min="0" class="${CLS.input}" value="${v(row.seasons)}">`)}
                        ${f("Episodes", `<input name="episodesTotal" type="number" min="0" class="${CLS.input}" value="${v(row.episodesTotal)}">`)}
                    </div>
                    ${f("Genres", `<div data-genres></div>`)}
                    ${f("Physical formats", `<div data-formats></div>`)}
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 items-end">
                        <label class="flex items-center gap-2 text-sm text-gray-300 pb-2"><input type="checkbox" name="withBogdan" ${row.withBogdan ? "checked" : ""}> 👥 Watched with Bogdan</label>
                        ${f("Date with Bogdan", `<input name="dateWithBogdan" type="month" class="${CLS.input}" value="${toMonthInput(row.dateWithBogdan)}">`)}
                        ${f("Price paid (£)", `<input name="pricePaid" type="number" min="0" step="0.01" class="${CLS.input}" value="${v(row.pricePaid)}">`)}
                    </div>
                    ${f("CeX links (one per line)", `<textarea name="cexLinks" rows="2" class="${CLS.input} font-mono text-xs">${esc(row.cexLinks.join("\n"))}</textarea>`)}
                    ${f("Comments", `<textarea name="comments" rows="3" maxlength="4000" class="${CLS.input}">${v(row.comments)}</textarea>`)}
                    <div class="flex gap-2 justify-end pt-2">
                        <button type="button" data-cancel class="${CLS.btn} ${CLS.secondary}">Cancel</button>
                        <button type="submit" class="${CLS.btn} ${CLS.primary}">${isNew ? "Add title" : "Save changes"}</button>
                    </div>
                </div>
            </form>`,
            { wide: true },
        );

        const form = d.$("form");
        const genres = chipInput(d.$("[data-genres]"), row.genres, unique((r) => r.genres), "genreOptions");
        const formats = chipInput(d.$("[data-formats]"), row.physicalFormats, unique((r) => r.physicalFormats), "formatOptions");

        const renderPoster = () => {
            const el = d.$("[data-poster]");
            el.innerHTML = poster.posterPath
                ? `<img src="https://image.tmdb.org/t/p/w500${esc(poster.posterPath)}" class="w-full h-full object-cover" alt="">`
                : "🎬";
        };
        renderPoster();

        d.$("[data-clear-poster]").onclick = () => {
            Object.assign(poster, { tmdbId: null, tmdbMediaType: null, posterPath: null });
            renderPoster();
        };

        d.$("[data-find]").onclick = (e) => {
            const name = form.name.value.trim();
            if (!name) return d.error("Enter a name first.");
            const params = new URLSearchParams({ q: name });
            if (form.releaseYear.value) params.set("year", form.releaseYear.value);
            if (genres.get().some((g) => g.toLowerCase().includes("anime"))) params.set("anime", "true");
            busy(d, e.currentTarget, async () => {
                const results = await api("GET", `/api/tmdb/search?${params}`);
                const box = d.$("[data-results]");
                box.classList.remove("hidden");
                box.innerHTML = results.length
                    ? `<div class="flex gap-2 overflow-x-auto pb-2">${results
                          .map(
                              (r, i) => `
                        <button type="button" data-pick="${i}" title="${esc(r.title)} (${esc(r.year ?? "?")})" class="shrink-0 w-24 text-left rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all">
                            <img src="${esc(r.posterUrl)}" class="w-24 h-36 object-cover" alt="">
                            <div class="text-[10px] text-gray-300 p-1 truncate">${esc(r.title)}</div>
                            <div class="text-[10px] text-gray-500 px-1 pb-1">${esc(r.year ?? "?")} · ${r.mediaType === "tv" ? "TV" : "Film"}</div>
                        </button>`,
                          )
                          .join("")}</div>`
                    : `<p class="text-sm text-gray-400">No posters found. Try correcting the name or the release year.</p>`;
                box.querySelectorAll("[data-pick]").forEach((b) => {
                    b.onclick = () => {
                        const r = results[Number(b.dataset.pick)];
                        Object.assign(poster, { tmdbId: r.id, tmdbMediaType: r.mediaType, posterPath: r.posterPath });
                        if (!form.releaseYear.value && r.year) form.releaseYear.value = r.year;
                        renderPoster();
                        box.classList.add("hidden");
                    };
                });
            });
        };

        d.$("[data-cancel]").onclick = () => d.close();

        form.onsubmit = (e) => {
            e.preventDefault();
            const body = {
                name: form.name.value.trim(),
                type: form.type.value,
                rating: numOrNull(form.rating.value),
                rewatchPotential: numOrNull(form.rewatchPotential.value),
                watchCount: numOrNull(form.watchCount.value) ?? 0,
                releaseYear: numOrNull(form.releaseYear.value),
                firstWatch: fromMonthInput(form.firstWatch.value),
                latestWatch: fromMonthInput(form.latestWatch.value),
                seasons: numOrNull(form.seasons.value),
                episodesTotal: numOrNull(form.episodesTotal.value),
                genres: genres.get(),
                physicalFormats: formats.get(),
                withBogdan: form.withBogdan.checked,
                dateWithBogdan: fromMonthInput(form.dateWithBogdan.value),
                pricePaid: numOrNull(form.pricePaid.value),
                cexLinks: form.cexLinks.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
                comments: form.comments.value,
                ...poster,
            };
            busy(d, form.querySelector("button[type=submit]"), async () => {
                const saved = isNew
                    ? await api("POST", "/api/titles", body)
                    : await api("PUT", `/api/titles/${row.id}`, body);
                d.close();
                await afterSave(saved, isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
            });
        };
    }

    async function addWatch(row) {
        const body = toRequest(row);
        body.watchCount = (row.watchCount || 0) + 1;
        body.latestWatch = thisMonth();
        body.firstWatch = row.firstWatch ?? thisMonth();
        try {
            const saved = await api("PUT", `/api/titles/${row.id}`, body);
            await afterSave(saved, `+1 watch for ${saved.name} (${saved.watchCount} total)`);
        } catch (e) {
            App.showError(e.message);
        }
    }

    async function deleteTitle(row) {
        if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
        try {
            await api("DELETE", `/api/titles/${row.id}`);
            App.closeModal();
            await App.reload();
            App.showSuccess(`Deleted ${row.name}`);
        } catch (e) {
            App.showError(e.message);
        }
    }

    // ---------- page integration ----------

    function render() {
        const footer = document.getElementById("adminFooter");
        const controls = document.getElementById("adminControls");
        controls.innerHTML = "";

        if (!me.authenticated) {
            footer.innerHTML = `<a data-login class="${CLS.link}">🔐 Admin</a>`;
            footer.querySelector("[data-login]").onclick = openLogin;
            return;
        }

        footer.innerHTML = `
            Signed in as <b class="text-gray-300">${esc(me.userName)}</b>
            · <a data-account class="${CLS.link}">Account</a>
            ${me.isAdmin ? `· <a data-users class="${CLS.link}">Users</a>` : ""}
            ${me.canEdit ? `· <a href="/api/export.csv" class="${CLS.link}">Export CSV</a>` : ""}
            · <a data-logout class="${CLS.link}">Sign out</a>`;
        footer.querySelector("[data-account]").onclick = openAccount;
        footer.querySelector("[data-users]")?.addEventListener("click", openUsers);
        footer.querySelector("[data-logout]").onclick = signOut;

        if (me.canEdit) {
            const add = document.createElement("button");
            add.className =
                "flex items-center gap-2 bg-primary/10 hover:bg-primary/20 border border-primary/30 px-4 py-2.5 rounded-lg text-sm font-semibold text-primary transition-all cursor-pointer";
            add.innerHTML = "<span>➕ Add</span>";
            add.onclick = () => openEditor(null);
            controls.appendChild(add);
        } else if (mustEnrolMfa()) {
            const setup = document.createElement("button");
            setup.className =
                "flex items-center gap-2 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 px-4 py-2.5 rounded-lg text-sm font-semibold text-yellow-400 transition-all cursor-pointer";
            setup.innerHTML = "<span>🛡️ Set up 2FA to edit</span>";
            setup.onclick = openMfaSetup;
            controls.appendChild(setup);
        }
    }

    window.Admin = {
        onModalOpened(row) {
            const bar = document.getElementById("modalAdminBar");
            if (!bar || !me.canEdit) return;
            bar.className = "flex gap-2 flex-wrap mb-5 pb-5 border-b border-white/10";
            bar.innerHTML = `
                <button data-edit class="${CLS.btn} ${CLS.secondary}">✏️ Edit</button>
                <button data-watch class="${CLS.btn} ${CLS.secondary}" title="Increase the watch count and set the latest watch to this month">➕ Watched again</button>
                <button data-delete class="${CLS.btn} ${CLS.danger}">🗑️ Delete</button>`;
            bar.querySelector("[data-edit]").onclick = () => openEditor(row);
            bar.querySelector("[data-watch]").onclick = () => addWatch(row);
            bar.querySelector("[data-delete]").onclick = () => deleteTitle(row);
        },
    };

    refreshMe().then(() => {
        if (!me.authenticated && (location.hash === "#login" || new URLSearchParams(location.search).has("admin")))
            openLogin();
    });
})();
