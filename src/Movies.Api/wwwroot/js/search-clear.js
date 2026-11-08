// A clear (✕) button in every search box: the page searches (type="search"), the TMDB search in the editor
// (inputmode="search"), and the pickers marked data-clearable. It shows while there's text (CSS:
// :placeholder-shown), empties the box, tells the page (an "input" event, as typing would) and keeps the focus there.
// Loaded on every page; boxes that come later (dialogs) get one as they appear.

(function () {
    const BOXES = 'input[type="search"], input[inputmode="search"], input[data-clearable]';
    const ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>`;

    function enhance(input) {
        // once only: wrapping the box is itself a change the observer below sees
        if ("clearReady" in input.dataset || input.parentElement?.classList.contains("clearable")) return;
        input.dataset.clearReady = "";
        // the button hides while the box shows its placeholder, so every box needs one
        if (!input.hasAttribute("placeholder")) input.setAttribute("placeholder", " ");
        const wrap = document.createElement("span");
        wrap.className = "clearable";
        input.replaceWith(wrap);
        wrap.appendChild(input);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "input-clear";
        btn.setAttribute("aria-label", "Clear search");
        btn.innerHTML = ICON;
        // don't take the focus from the box (pickers close their list when it leaves)
        btn.addEventListener("pointerdown", (e) => e.preventDefault());
        btn.addEventListener("click", () => {
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
        });
        wrap.appendChild(btn);
    }

    const scan = (root) => {
        if (root.matches?.(BOXES)) enhance(root);
        root.querySelectorAll?.(BOXES).forEach(enhance);
    };
    const start = () => {
        scan(document);
        new MutationObserver((changes) => changes.forEach((c) => c.addedNodes.forEach((n) => n.nodeType === 1 && scan(n)))).observe(document.body, { childList: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
})();
