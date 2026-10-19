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
        el.className = `toast${kind === "error" ? " toast-error" : ""}`;
        el.setAttribute("role", kind === "error" ? "alert" : "status");
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), kind === "error" ? 8000 : 3000);
    }
    const showError = (m) => toast("error", m);
    const showSuccess = (m) => toast("success", m);

    // Class names from css/site.css, shared with admin.js and cex.js.
    const CLS = {
        input: "input",
        label: "label",
        btn: "btn",
        primary: "btn-primary",
        secondary: "",
        danger: "btn-danger",
        link: "link",
        error: "alert alert-error hidden",
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
        root.className = "overlay dialog-layer";
        const titleId = `dialog-${Math.random().toString(36).slice(2)}`;
        root.innerHTML = `
        <div class="panel panel-body${wide ? " panel-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
            <button type="button" data-close class="close" aria-label="Close">×</button>
            <h2 class="panel-heading" id="${titleId}">${title}</h2>
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
                if (opener?.isConnected) opener.focus();
                onClose?.();
            },
            error(msg) {
                const el = root.querySelector("[data-error]");
                if (!el) return showError(msg);
                el.textContent = msg || "";
                el.classList.toggle("hidden", !msg);
            },
        };
        const opener = document.activeElement;
        const onKey = (e) => {
            // only the popup on top: a title popup (js/title-modal.js) can sit over a dialog
            if (e.key === "Escape" && root === [...document.querySelectorAll(".overlay:not(.hidden)")].pop()) d.close();
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
            "Sign in",
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <form data-step="password" class="stack">
                <div><label class="label" for="login-user">Username</label><input id="login-user" name="userName" autocomplete="username" class="input" required></div>
                <div><label class="label" for="login-pass">Password</label><input id="login-pass" name="password" type="password" autocomplete="current-password" class="input" required></div>
                <label class="check"><input type="checkbox" name="rememberMe" checked> Keep me signed in</label>
                <button class="btn btn-primary btn-block">Continue</button>
            </form>
            <form data-step="mfa" class="stack hidden">
                <p class="muted" data-mfa-hint>Enter the 6-digit code from your authenticator app.</p>
                <div data-code><label class="label" for="login-code">Authentication code</label><input id="login-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="input input-code"></div>
                <div data-recovery class="hidden"><label class="label" for="login-recovery">Recovery code</label><input id="login-recovery" name="recoveryCode" autocomplete="off" class="input code"></div>
                <label class="check" data-remember><input type="checkbox" name="rememberDevice"> Don't ask again on this device for 30 days</label>
                <button class="btn btn-primary btn-block">Verify</button>
                <p style="text-align:center"><button type="button" data-toggle-recovery class="link">Use a recovery code instead</button></p>
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
        showSuccess(`Signed in as ${me.userName}`);
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
            "Set up two-factor authentication",
            `
            ${mustEnrolMfa() ? `<p class="alert alert-warn">You need two-factor authentication before you can make changes.</p>` : ""}
            <div data-error class="${CLS.error}" role="alert"></div>
            <div data-enrol class="stack">
                <p class="muted">1. Scan this QR code with an authenticator app (Aegis, 2FAS, Google Authenticator, 1Password…).</p>
                <div class="qr"><div data-qr></div></div>
                <p class="faint" style="text-align:center;font-size:13px">Can't scan? Enter this key manually:<br><code style="color:var(--ink);user-select:all">${esc(setup.sharedKey)}</code></p>
                <form class="stack">
                    <label class="muted" for="mfa-code">2. Enter the 6-digit code the app shows.</label>
                    <input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" class="input input-code" required>
                    <button class="btn btn-primary btn-block">Turn on two-factor</button>
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
            <p class="alert alert-ok">Two-factor authentication is on.</p>
            <p class="muted" style="margin-bottom:12px">Save these recovery codes somewhere safe, like a password manager. Each one works once if you lose your authenticator.</p>
            <div class="codes" style="margin-bottom:16px">
                ${codes.map((c) => `<div>${esc(c)}</div>`).join("")}
            </div>
            <div class="actions">
                <button type="button" data-copy class="btn">Copy</button>
                <button type="button" data-download class="btn push">Download</button>
                <button type="button" data-done class="btn btn-primary">I've saved them</button>
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
            "Your account",
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <p class="muted">Signed in as <b style="color:var(--ink)">${esc(me.userName)}</b>, ${esc(me.roles.join(", ") || "no role")}</p>

            <h3 class="subhead">Two-factor authentication</h3>
            <div class="boxed stack">
                ${
                    mfa.enabled
                        ? `<p class="status-on">On, with ${mfa.recoveryCodesLeft} recovery codes left</p>
                           <form data-regen class="inline-field">
                               <input name="code" inputmode="numeric" maxlength="7" placeholder="Current code" aria-label="Current authentication code" class="input" required>
                               <button class="btn">New recovery codes</button>
                           </form>
                           ${mfa.required ? "" : `<button type="button" data-disable class="btn btn-danger">Turn off two-factor</button>`}`
                        : `<p class="status-off">Off${mfa.required ? ". You need it to make changes." : ""}</p>
                           <button type="button" data-setup class="btn btn-primary">Set up two-factor</button>`
                }
                <div data-codes class="hidden"></div>
            </div>

            <h3 class="subhead">Change password</h3>
            <form data-password class="boxed stack">
                <input name="currentPassword" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password" class="input" required>
                <input name="newPassword" type="password" autocomplete="new-password" placeholder="New password, 12 or more characters" aria-label="New password" minlength="12" class="input" required>
                <button class="btn">Change password</button>
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
            "Users",
            `
            <div data-error class="${CLS.error}" role="alert"></div>
            <div data-notice class="alert alert-ok hidden"></div>
            <div class="table-wrap">
                <table class="table">
                    <thead><tr>
                        <th>User</th><th>Role</th><th>Two-factor</th><th>Status</th><th class="num">Actions</th>
                    </tr></thead>
                    <tbody data-rows></tbody>
                </table>
            </div>
            <h3 class="subhead">Add a user</h3>
            <form data-create class="boxed user-form">
                <div><label class="label" for="new-user">Username</label><input id="new-user" name="userName" autocomplete="off" class="input" required></div>
                <div><label class="label" for="new-pass">Password</label>
                    <div class="inline-field"><input id="new-pass" name="password" autocomplete="new-password" minlength="12" class="input code" required>
                    <button type="button" data-generate class="btn">Generate</button></div></div>
                <div><label class="label" for="new-role">Role</label><select id="new-role" name="role" class="input"><option>Editor</option><option>Admin</option></select></div>
                <button class="btn btn-primary">Add user</button>
            </form>
            <p class="faint" style="font-size:13px;margin-top:8px">New users set up two-factor authentication the first time they sign in.</p>`,
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
                <tr data-id="${esc(u.id)}" data-name="${esc(u.userName)}">
                    <td><b>${esc(u.userName)}</b>${self ? ' <span class="faint">(you)</span>' : ""}</td>
                    <td><select data-role class="input" style="width:auto;min-height:32px;padding:4px 28px 4px 8px" aria-label="Role for ${esc(u.userName)}" ${self ? "disabled" : ""}>
                        ${["Editor", "Admin"].map((r) => `<option ${r === role ? "selected" : ""}>${r}</option>`).join("")}
                    </select></td>
                    <td>${u.mfaEnabled ? '<span class="status-on">On</span>' : '<span class="status-off">Off</span>'}</td>
                    <td>${u.lockedOut ? '<span class="status-bad">Locked</span>' : '<span class="muted">Active</span>'}</td>
                    <td class="num">
                        ${self ? "" : `
                        <button data-act="${u.lockedOut ? "unlock" : "lock"}" class="btn btn-small">${u.lockedOut ? "Unlock" : "Lock"}</button>
                        <button data-act="reset-password" class="btn btn-small">Reset password</button>
                        ${u.mfaEnabled ? `<button data-act="reset-mfa" class="btn btn-small">Reset 2FA</button>` : ""}
                        <button data-act="delete" class="btn btn-small btn-danger">Delete</button>`}
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
                    notice(`New password for <b>${esc(name)}</b>: <code style="user-select:all">${esc(password)}</code>`);
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
                notice(`Created <b>${esc(userName)}</b> with password <code style="user-select:all">${esc(password)}</code>`);
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
        const footer = document.getElementById("authArea");
        if (footer) {
            if (!me.authenticated) {
                footer.innerHTML = `<button type="button" data-login class="link">Sign in</button>`;
                footer.querySelector("[data-login]").onclick = openLogin;
            } else {
                footer.innerHTML = `
                    <span>Signed in as <b>${esc(me.userName)}</b></span>
                    <button type="button" data-account class="link">Account</button>
                    ${me.isAdmin ? `<button type="button" data-users class="link">Users</button>` : ""}
                    ${me.canEdit && document.body.dataset.exportUrl ? `<a href="${document.body.dataset.exportUrl}" class="link">Export CSV</a>` : ""}
                    <button type="button" data-logout class="link">Sign out</button>`;
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
