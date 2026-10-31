// The full-page add/edit form at /titles/new, /watchlist/new and /titles/{id}/edit (either list: the
// title says which). Needs auth.js, lists.js, datepicker.js and editor.js.

(function () {
    const { esc } = Auth;
    const id = Number(location.pathname.match(/^\/titles\/(\d+)\/edit/)?.[1]) || null;
    const newList = location.pathname.startsWith("/watchlist/") ? "watchlist" : "watched";
    const root = document.getElementById("editorRoot");
    const heading = document.getElementById("pageTitle");
    let rows = null; // every title on both lists, once loaded
    let mounted = false;

    const titles = Lists.loadAll();

    function setHeading(text) {
        heading.textContent = text;
        document.title = `${text} · Movie & Series Watchlog`;
    }
    // the back link goes to the title's list
    function setList(list) {
        const back = document.getElementById("backLink");
        back.href = Lists[list].page;
        back.textContent = `← Back to the ${Lists[list].name.toLowerCase()}`;
    }
    setHeading(id ? "Edit title" : newList === "watchlist" ? "Add to watchlist" : "Add a title");
    setList(newList);

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
            return message(`<p class="status-bad">Couldn't load the titles: ${esc(e.message)}</p>`);
        }
        const row = id ? rows.find((r) => r.id === id) : null;
        if (id && !row) {
            return message(`<div class="empty"><h2>Title not found</h2><p class="muted">It may have been deleted.</p></div>`);
        }
        if (row) {
            setHeading(`Edit ${row.name}`);
            setList(row.list);
        }
        mounted = true;
        TitleEditor.mount(root, row, {
            list: newList,
            allRows: rows,
            onCancel: () => (history.length > 1 && document.referrer.startsWith(location.origin) ? history.back() : (location.href = Lists[row?.list ?? newList].page)),
            onSaved: (saved) => (location.href = Lists.link(saved)),
            onMoved: (saved) => (location.href = Lists.link(saved)),
        });
    }

    document.addEventListener("auth-changed", (e) => render(e.detail));
})();
