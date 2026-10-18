// Themed dropdowns. A native <select>'s option list can't be styled, so every <select class="input">
// (including ones added later, e.g. in dialogs) gets a button and a listbox drawn from the theme tokens.
// The native select stays in the form, hidden, and keeps the value: code reading .value or listening
// for "change" on it works unchanged.

(function () {
    const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let open = null; // { select, close }
    let uid = 0;

    function enhance(select) {
        if (select.dataset.themed) return;
        select.dataset.themed = "";
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${select.className} select-button`;
        button.style.cssText = select.style.cssText;
        button.setAttribute("aria-haspopup", "listbox");
        button.setAttribute("aria-expanded", "false");
        // The visible control takes over the label (<label for>) and accessible name.
        if (select.id) {
            button.id = select.id;
            select.removeAttribute("id");
        }
        if (select.hasAttribute("aria-label")) button.setAttribute("aria-label", select.getAttribute("aria-label"));
        select.classList.add("select-native");
        select.tabIndex = -1;
        select.setAttribute("aria-hidden", "true");
        select.after(button);

        const sync = () => {
            button.textContent = select.selectedOptions[0]?.textContent ?? "";
            button.disabled = select.disabled;
        };
        sync();
        select.addEventListener("change", sync);
        // busy() and re-renders toggle disabled on the select
        new MutationObserver(sync).observe(select, { attributes: true, attributeFilter: ["disabled"] });

        button.addEventListener("click", () => (open?.select === select ? open.close() : show(select, button)));
        button.addEventListener("keydown", (e) => {
            if (open?.select === select) return; // the open list handles keys
            if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
                e.preventDefault();
                show(select, button);
            }
        });
    }

    function show(select, button) {
        open?.close();
        const listId = `select-list-${++uid}`;
        const options = [...select.options];
        let active = Math.max(0, select.selectedIndex);

        const list = document.createElement("ul");
        list.className = "suggest select-list";
        list.id = listId;
        list.setAttribute("role", "listbox");
        list.innerHTML = options
            .map((o, i) => `<li role="option" id="${listId}-${i}" data-i="${i}" aria-selected="${o.selected}">${esc(o.textContent)}</li>`)
            .join("");
        document.body.appendChild(list);

        function highlight(i) {
            active = (i + options.length) % options.length;
            list.querySelectorAll("li").forEach((li, j) => li.classList.toggle("is-active", j === active));
            button.setAttribute("aria-activedescendant", `${listId}-${active}`);
            list.children[active].scrollIntoView({ block: "nearest" });
        }

        function place() {
            const r = button.getBoundingClientRect();
            list.style.minWidth = `${r.width}px`;
            const h = list.offsetHeight;
            const below = r.bottom + 6 + h <= window.innerHeight || r.top - 6 - h < 0;
            list.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
            list.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8))}px`;
        }

        function pick(i) {
            if (select.selectedIndex !== i) {
                select.selectedIndex = i;
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
            close();
            button.focus();
        }

        function onKey(e) {
            const keys = { ArrowDown: 1, ArrowUp: -1 };
            if (keys[e.key]) highlight(active + keys[e.key]);
            else if (e.key === "Home") highlight(0);
            else if (e.key === "End") highlight(options.length - 1);
            else if (e.key === "Enter" || e.key === " ") pick(active);
            else if (e.key === "Escape") close();
            else if (e.key === "Tab") return close();
            else if (e.key.length === 1) {
                // type-ahead: jump to the next option starting with that letter
                const k = e.key.toLowerCase();
                const next = options.findIndex((o, j) => j > active && o.textContent.trim().toLowerCase().startsWith(k));
                const first = options.findIndex((o) => o.textContent.trim().toLowerCase().startsWith(k));
                if (next >= 0 || first >= 0) highlight(next >= 0 ? next : first);
                else return;
            } else return;
            e.preventDefault();
            e.stopPropagation(); // keep Escape and arrows away from dialogs and the title modal
        }

        const onOutside = (e) => {
            if (!list.contains(e.target) && e.target !== button) close();
        };
        const onScroll = (e) => {
            if (!list.contains(e.target)) place();
        };

        // mousedown so the button keeps focus
        list.addEventListener("mousedown", (e) => {
            e.preventDefault();
            const li = e.target.closest("[data-i]");
            if (li) pick(Number(li.dataset.i));
        });
        list.addEventListener("mousemove", (e) => {
            const li = e.target.closest("[data-i]");
            if (li && Number(li.dataset.i) !== active) highlight(Number(li.dataset.i));
        });

        function close() {
            if (open?.select !== select) return;
            open = null;
            list.remove();
            button.setAttribute("aria-expanded", "false");
            button.removeAttribute("aria-controls");
            button.removeAttribute("aria-activedescendant");
            button.removeEventListener("keydown", onKey);
            button.removeEventListener("blur", close);
            document.removeEventListener("mousedown", onOutside, true);
            window.removeEventListener("scroll", onScroll, true);
            window.removeEventListener("resize", place);
        }

        button.setAttribute("aria-expanded", "true");
        button.setAttribute("aria-controls", listId);
        button.addEventListener("keydown", onKey);
        button.addEventListener("blur", close);
        document.addEventListener("mousedown", onOutside, true);
        window.addEventListener("scroll", onScroll, true);
        window.addEventListener("resize", place);
        open = { select, close };
        button.focus(); // keys go to the button while the list is open
        place();
        highlight(active);
    }

    function scan(root) {
        if (root.matches?.("select.input")) enhance(root);
        root.querySelectorAll?.("select.input").forEach(enhance);
    }

    scan(document);
    new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach((n) => n.nodeType === 1 && scan(n));
    }).observe(document.body, { childList: true, subtree: true });

    window.ThemedSelect = { enhance };
})();
