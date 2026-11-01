// Editing on the Watchlog and Watchlist pages: add, edit, watched again, mark as watched, move to the
// watchlist, delete. Needs auth.js, lists.js and editor.js, loaded before this file.

(function () {
    const { api, dialog, esc } = Auth;
    const { toRequest } = TitleEditor;

    // saved carries .list: when it's now on the other list it has left this page, so the popup closes
    async function afterSave(saved, message, action) {
        await App.reload();
        App.showSuccess(message, action);
        const fresh = saved.list === App.list ? App.getAll().find((r) => r.id === saved.id) : null;
        if (fresh) App.openModal(fresh);
        else App.closeModal();
    }

    const everything = () => [...App.getAll(), ...App.getOther()];

    // Ctrl/Cmd/Shift/middle click on an editor link opens the full page; a plain click opens the dialog.
    function editorLink(a, row) {
        a.onclick = (e) => {
            if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            openEditor(row);
        };
    }

    // the form in a dialog: a title to edit, or null to add one to this page's list
    function openEditor(row, { markWatched = false } = {}) {
        const list = row?.list ?? App.list;
        const heading = markWatched ? `Watched ${esc(row.name)}` : row ? `Edit ${esc(row.name)}` : list === "watchlist" ? "Add to watchlist" : "Add a title";
        const d = dialog(heading, "", { wide: true });
        const editor = TitleEditor.mount(d.body, row, {
            list,
            markWatched,
            allRows: everything(),
            pageLink: markWatched ? null : row ? Lists.editUrl(row.id) : Lists[list].newUrl,
            // its releases, and a new one, open over the form
            openRelease: (id) => App.showRelease(id),
            addRelease: () => App.addRelease(row.id),
            onCancel: () => d.requestClose(),
            async onSaved(saved, isNew) {
                d.close();
                const message = markWatched
                    ? saved.watchCount > 1
                        ? `Moved ${saved.name} to your Watchlog (watch number ${saved.watchCount})`
                        : `Moved ${saved.name} to your Watchlog`
                    : isNew
                      ? `Added ${saved.name}${list === "watchlist" ? " to your watchlist" : ""}`
                      : `Saved ${saved.name}`;
                await afterSave(saved, message);
            },
            // adding to the watchlist something already in the Watchlog: that title moved over instead
            async onMoved(saved) {
                d.close();
                await afterSave(saved, `Moved ${saved.name} to your watchlist`);
            },
        });
        d.guard(editor.isDirty);
    }

    async function save(row, changes, message, action) {
        try {
            const saved = Lists.normalise(await api("PUT", `/api/titles/${row.id}`, { ...toRequest(row), ...changes }));
            await afterSave(saved, message(saved), action?.(saved));
        } catch (e) {
            App.showError(e.message);
        }
    }

    // a watch dated today (with Bogdan, in the cinema and notes to fill in if you like); Undo takes it off again
    const addWatch = (row) =>
        WatchDialog.open({
            title: row,
            onSaved: (saved, { watchId }) =>
                afterSave(saved, `Added a watch of ${saved.name} (${saved.watchCount} in all)`, {
                    label: "Undo",
                    run: async () => {
                        try {
                            await afterSave(Lists.normalise(await api("DELETE", `/api/watches/${watchId}`)), `Took that watch of ${row.name} off again`);
                        } catch (e) {
                            App.showError(e.message);
                        }
                    },
                }),
        });

    // Onto the watchlist, keeping its watches and rating: it's waiting to be watched again. Undo puts it
    // back as it was, date and all.
    const moveToWatchlist = (row) =>
        save(row, { list: "Watchlist", watchlistAddedOn: TitleEditor.todayIso() }, (saved) => `Moved ${saved.name} to your watchlist`, (saved) => ({
            label: "Undo",
            run: () => save(saved, { list: "Watched", watchlistAddedOn: row.watchlistAddedOn ?? null }, (back) => `${back.name} is back in your Watchlog`),
        }));

    async function deleteTitle(row) {
        const sure = await Auth.confirm({
            title: `Delete ${row.name}?`,
            message: `It comes off your ${row.list === "watchlist" ? "watchlist" : "Watchlog"} for good${row.releases.length ? ", and off the discs it's on (the discs stay)" : ""}. This can't be undone.`,
            confirmLabel: "Delete",
            danger: true,
        });
        if (!sure) return;
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
            const url = Lists[App.list].newUrl;
            const what = App.list === "watchlist" ? "Add to watchlist" : "Add title";
            controls.innerHTML = `
                <span class="split">
                    <a href="${url}" class="btn btn-primary" data-add>${what}</a>
                    <a href="${url}" class="btn btn-primary split-end" title="${what} on its own page" aria-label="${what} on its own page">↗</a>
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
            const editUrl = Lists.editUrl(row.id);
            const onWatchlist = row.list === "watchlist";
            bar.innerHTML = `
                <span class="split">
                    <a href="${editUrl}" data-edit class="btn">Edit</a>
                    <a href="${editUrl}" class="btn split-end" title="Edit on its own page" aria-label="Edit on its own page">↗</a>
                </span>
                ${onWatchlist
                    ? `<button type="button" data-mark class="btn btn-primary" title="Rate it and move it to your Watchlog">Mark as watched</button>`
                    : `<button type="button" data-watch class="btn" title="Add a watch dated today (you can change the date, and add Bogdan, the cinema or a note)">Watched again</button>
                       <button type="button" data-move class="btn" title="Put it on your watchlist to watch again. It keeps its watches and rating">Move to watchlist</button>`}
                <button type="button" data-delete class="btn btn-danger">Delete</button>`;
            editorLink(bar.querySelector("[data-edit]"), row);
            if (onWatchlist) bar.querySelector("[data-mark]").onclick = () => openEditor(row, { markWatched: true });
            else {
                bar.querySelector("[data-watch]").onclick = () => addWatch(row);
                bar.querySelector("[data-move]").onclick = () => moveToWatchlist(row);
            }
            bar.querySelector("[data-delete]").onclick = () => deleteTitle(row);
        },
    };
})();
