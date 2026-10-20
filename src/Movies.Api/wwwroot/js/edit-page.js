// The full-page add/edit form at /titles/new and /titles/{id}/edit. Needs auth.js, datepicker.js and editor.js.

(function () {
    const { esc } = Auth;
    const id = Number(location.pathname.match(/^\/titles\/(\d+)\/edit/)?.[1]) || null;
    const root = document.getElementById("editorRoot");
    const heading = document.getElementById("pageTitle");
    let rows = null; // every title, once loaded
    let mounted = false;

    const titles = fetch("/api/titles", { cache: "no-store" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    });

    function setHeading(text) {
        heading.textContent = text;
        document.title = `${text} · Movie & Series Watchlog`;
    }
    setHeading(id ? "Edit title" : "Add a title");

    function message(html) {
        mounted = false;
        root.innerHTML = html;
    }

    async function render(me) {
        if (!me.canEdit) {
            const mfa = Auth.mustEnrolMfa();
            message(`
                <div class="empty">
                    <h2>${mfa ? "Set up 2FA first" : "Sign in to edit"}</h2>
                    <p class="muted">${mfa ? "You need two-factor authentication before you can make changes." : "Only editors can add or change titles."}</p>
                    <p style="margin-top:16px"><button type="button" class="btn btn-primary" data-go>${mfa ? "Set up 2FA" : "Sign in"}</button></p>
                </div>`);
            root.querySelector("[data-go]").onclick = mfa ? Auth.openMfaSetup : Auth.openLogin;
            return;
        }
        if (mounted) return;
        try {
            rows ??= await titles;
        } catch (e) {
            return message(`<p class="status-bad">Couldn't load the watchlog: ${esc(e.message)}</p>`);
        }
        const row = id ? rows.find((r) => r.id === id) : null;
        if (id && !row) {
            return message(`<div class="empty"><h2>Title not found</h2><p class="muted">It may have been deleted.</p></div>`);
        }
        if (row) setHeading(`Edit ${row.name}`);
        mounted = true;
        TitleEditor.mount(root, row, {
            allRows: rows,
            onCancel: () => (history.length > 1 && document.referrer.startsWith(location.origin) ? history.back() : (location.href = "/")),
            onSaved: (saved) => (location.href = `/?title=${saved.id}`),
        });
    }

    document.addEventListener("auth-changed", (e) => render(e.detail));
})();
