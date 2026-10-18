// Collection editing (add/edit/watched again/delete). Needs auth.js, loaded before this file.

(function () {
    const { api, dialog, esc } = Auth;

    // ---------- title editing (the form itself is in editor.js) ----------

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

    // Ctrl/Cmd/Shift/middle click on an editor link opens the full page; a plain click opens the dialog.
    function editorLink(a, row) {
        a.onclick = (e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            openEditor(row);
        };
    }

    function openEditor(row) {
        const d = dialog(row ? `Edit ${esc(row.name)}` : "Add a title", "", { wide: true });
        TitleEditor.mount(d.body, row, {
            allRows: App.getAll(),
            pageLink: row ? `/titles/${row.id}/edit` : "/titles/new",
            onCancel: () => d.close(),
            async onSaved(saved, isNew) {
                d.close();
                await afterSave(saved, isNew ? `Added ${saved.name}` : `Saved ${saved.name}`);
            },
        });
    }

    async function addWatch(row) {
        const body = toRequest(row);
        body.watchCount = (row.watchCount || 0) + 1;
        body.latestWatch = TitleEditor.todayIso();
        body.firstWatch = row.firstWatch ?? body.latestWatch;
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

    document.addEventListener("auth-changed", (e) => {
        const me = e.detail;
        const controls = document.getElementById("adminControls");
        controls.innerHTML = "";
        if (me.canEdit) {
            controls.innerHTML = `
                <span class="split">
                    <a href="/titles/new" class="btn btn-primary" data-add>Add title</a>
                    <a href="/titles/new" class="btn btn-primary split-end" title="Add a title on its own page" aria-label="Add a title on its own page">↗</a>
                </span>`;
            editorLink(controls.querySelector("[data-add]"), null);
        } else if (Auth.mustEnrolMfa()) {
            const setup = document.createElement("button");
            setup.type = "button";
            setup.className = "btn btn-warn";
            setup.textContent = "Set up 2FA to edit";
            setup.onclick = Auth.openMfaSetup;
            controls.appendChild(setup);
        }
    });

    window.Admin = {
        onModalOpened(row) {
            const bar = document.getElementById("modalAdminBar");
            if (!bar || !Auth.me.canEdit) return;
            bar.className = "modal-actions";
            bar.innerHTML = `
                <span class="split">
                    <a href="/titles/${row.id}/edit" data-edit class="btn">Edit</a>
                    <a href="/titles/${row.id}/edit" class="btn split-end" title="Edit on its own page" aria-label="Edit on its own page">↗</a>
                </span>
                <button type="button" data-watch class="btn" title="Add one to the watch count and set the latest watch to today">Watched again</button>
                <button type="button" data-delete class="btn btn-danger">Delete</button>`;
            editorLink(bar.querySelector("[data-edit]"), row);
            bar.querySelector("[data-watch]").onclick = () => addWatch(row);
            bar.querySelector("[data-delete]").onclick = () => deleteTitle(row);
        },
    };
})();
