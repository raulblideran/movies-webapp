// Shared sign-in, two-factor, account and user management for every page.
// Pages listen for the "auth-changed" event (detail = current user) to show their own edit controls.

(function () {
    const esc = (v) =>
        String(v ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

    // Use the page's own toasts when it has them, otherwise a small built-in one.
    function toast(kind, message) {
        const pageToast = kind === "error" ? window.App?.showError : window.App?.showSuccess;
        if (pageToast) return pageToast(message);
        const el = document.createElement("div");
        el.className = `fixed top-5 right-5 z-[1200] p-4 rounded-xl max-w-md backdrop-blur-md text-sm shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${
            kind === "error"
                ? "bg-red-500/10 border border-red-500/30 text-red-400"
                : "bg-green-500/10 border border-green-500/30 text-green-400"
        }`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), kind === "error" ? 8000 : 3000);
    }
    const showError = (m) => toast("error", m);
    const showSuccess = (m) => toast("success", m);

    const CLS = {
        input: "w-full px-3 py-2 border border-white/10 bg-black/40 text-white rounded-lg text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 hover:border-white/20",
        label: "block mb-1 text-[11px] uppercase tracking-wider text-gray-400 font-semibold",
        btn: "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed",
        primary: "bg-gradient-to-r from-primary to-primary-dark text-white hover:brightness-110",
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
        <div class="bg-gradient-to-br from-[#1a1a1a] to-[var(--dialog-tint,#2a0a0a)] rounded-3xl ${wide ? "max-w-4xl" : "max-w-md"} w-full max-h-[90vh] overflow-y-auto relative border-2 border-primary/50 shadow-2xl animate-slideUp p-7">
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
                if (!el) return showError(msg);
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
        showSuccess(`👋 Signed in as ${me.userName}`);
        if (mustEnrolMfa()) openMfaSetup();
    }

    async function signOut() {
        await api("POST", "/api/auth/logout").catch(() => {});
        await refreshMe();
        window.App?.closeModal?.();
        showSuccess("Signed out");
    }

    // ---------- MFA enrolment ----------

    async function openMfaSetup() {
        let setup;
        try {
            setup = await api("POST", "/api/account/mfa/setup");
        } catch (e) {
            return showError(e.message);
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
            showSuccess("Copied");
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
            return showError(e.message);
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
                showSuccess("Two-factor authentication turned off");
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
                showSuccess("Password changed");
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

    // ---------- page integration ----------

    function render() {
        const footer = document.getElementById("adminFooter");
        if (footer) {
            if (!me.authenticated) {
                footer.innerHTML = `<a data-login class="${CLS.link}">🔐 Admin</a>`;
                footer.querySelector("[data-login]").onclick = openLogin;
            } else {
                footer.innerHTML = `
                    Signed in as <b class="text-gray-300">${esc(me.userName)}</b>
                    · <a data-account class="${CLS.link}">Account</a>
                    ${me.isAdmin ? `· <a data-users class="${CLS.link}">Users</a>` : ""}
                    ${me.canEdit && document.body.dataset.exportUrl ? `· <a href="${document.body.dataset.exportUrl}" class="${CLS.link}">Export CSV</a>` : ""}
                    · <a data-logout class="${CLS.link}">Sign out</a>`;
                footer.querySelector("[data-account]").onclick = openAccount;
                footer.querySelector("[data-users]")?.addEventListener("click", openUsers);
                footer.querySelector("[data-logout]").onclick = signOut;
            }
        }
        document.dispatchEvent(new CustomEvent("auth-changed", { detail: me }));
    }

    window.Auth = {
        get me() {
            return me;
        },
        mustEnrolMfa,
        api,
        dialog,
        busy,
        esc,
        CLS,
        showError,
        showSuccess,
        openLogin,
        openMfaSetup,
    };

    refreshMe().then(() => {
        if (!me.authenticated && (location.hash === "#login" || new URLSearchParams(location.search).has("admin")))
            openLogin();
    });
})();
