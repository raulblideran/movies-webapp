// Theme picker shared by every page. The default look lives in css/site.css; each other theme is
// one file in css/themes/ plus the hero artwork below. The choice is remembered per browser.
// An inline script in each page's <head> loads the saved theme's stylesheet before first paint.

(function () {
    const KEY = "theme";
    const v = document.documentElement.dataset.assetVersion || "";

    const xs = Array.from({ length: 14 }, (_, i) => `<i style="--i:${i}">✕</i>`).join("");
    const petals = Array.from({ length: 10 }, (_, i) => `<b style="--i:${i}"></b>`).join("");

    // Hero photos: film stills come from TMDB's image server (like the posters); the default
    // theme's cinema photos are CC BY 2.0 from Wikimedia Commons and live in img/.
    const TMDB = "https://image.tmdb.org/t/p";
    // pos: optional object-position, to keep an off-centre subject in frame when the photo is cropped
    const still = (film, path, pos) => ({
        film,
        pos,
        src: `${TMDB}/w1280${path}`,
        srcset: `${TMDB}/w780${path} 780w, ${TMDB}/w1280${path} 1280w, ${TMDB}/original${path} 3840w`,
        thumb: `${TMDB}/w300${path}`,
    });
    const SEATS_CREDIT = `Photo: <a class="link" href="https://commons.wikimedia.org/wiki/File:Empty_Movie_Theater_(54280927025).jpg" target="_blank" rel="noopener">Eden, Janine and Jim</a>, <a class="link" href="https://creativecommons.org/licenses/by/2.0" target="_blank" rel="noopener">CC BY 2.0</a>`;

    const THEMES = [
        {
            id: "house",
            name: "Picture house",
            note: "The default: a cinema marquee",
            swatch: "linear-gradient(135deg,#ffc861 50%,#3a0b12 50%)",
            color: "#240509",
            tagline: "Now showing",
            art: "",
            photos: [
                { src: "img/seats-1.jpg", thumb: "img/seats-1.jpg", credit: SEATS_CREDIT },
                { src: "img/seats-2.jpg", thumb: "img/seats-2.jpg", credit: SEATS_CREDIT.replace("Empty_Movie_Theater_(54280927025)", "Empty_Movie_Theater_Seats_(54279616742)") },
            ],
        },
        {
            id: "silent-voice",
            name: "A Silent Voice",
            note: "Spring sky over the bridge",
            swatch: "linear-gradient(135deg,#f4c6cf 50%,#8fc3e6 50%)",
            color: "#dcecf8",
            tagline: "I want you to help me live",
            art: `<div class="sv-xs">${xs}</div><div class="sv-petals">${petals}</div>`,
            photos: [
                still("A Silent Voice", "/q5HZvtyqG8Vz39Ee9uTQbLeEml.jpg"),
                still("A Silent Voice", "/5lAMQMWpXMsirvtLLvW7cJgEPkU.jpg"),
                still("A Silent Voice", "/aUHovhqOrvXV6j8QlLBbLrFLDHf.jpg"),
            ],
        },
        {
            id: "back-to-the-future",
            name: "Back to the Future",
            note: "Time circuits on",
            swatch: "linear-gradient(135deg,#ffd23f,#ff6a13 55%,#b3121b)",
            color: "#0c0a1c",
            tagline: "Where we're going, we don't need roads",
            art: `<div class="bttf-trail"></div><div class="bttf-trail"></div>`,
            photos: [
                still("Back to the Future", "/2H2YYbn8wDzYXtak83Md6PAwMdp.jpg"),
                still("Back to the Future", "/5bzPWQ2dFUl2aZKkp7ILJVVkRed.jpg"),
                still("Back to the Future", "/pZCLGHynFPOv8dve6u9waxknLth.jpg"),
            ],
        },
        {
            id: "lion-king",
            name: "The Lion King",
            note: "Sunrise over Pride Rock",
            swatch: "radial-gradient(circle at 60% 40%,#ffd36b 0 30%,#e8661c 31% 60%,#3a1406 61%)",
            color: "#c9521a",
            tagline: "Remember who you are",
            art: "",
            photos: [
                still("The Lion King", "/kAZ0AtzFlsP9tikLevnz2x84QA8.jpg"),
                still("The Lion King", "/wXfAvsPZqBDJ8U78F2IAzsUxtNh.jpg"),
                still("The Lion King", "/wXsQvli6tWqja51pYxXNG1LFIGV.jpg"),
            ],
        },
        {
            id: "halloween",
            name: "Halloween",
            note: "Haddonfield, 1978 and 2018",
            swatch: "radial-gradient(circle at 50% 55%,#ff7a1a 0 42%,#000 44%)",
            color: "#000000",
            tagline: "The night he came home",
            art: "",
            photos: [
                still("Halloween (1978)", "/aRka9neADW1M0Zf9lF8kW2jEgXe.jpg"),
                still("Halloween (1978)", "/nC2xGswJAOml7aBTDprujidXbLr.jpg"),
                still("Halloween (1978)", "/6Io0gvfEVpMQsB46yXOKCpSJOoJ.jpg"),
                still("Halloween (2018)", "/8VjIXC2x8SHwAO52rfFpejKL4wc.jpg"),
                still("Halloween (2018)", "/oaMqiKK46Pj9eP3udRrcA9u1PrK.jpg"),
                still("Halloween (2018)", "/hO1oTBGNxO5fBKVEuWnSpICJH7c.jpg"),
            ],
        },
        {
            id: "terrifier",
            name: "Terrifier",
            note: "Art's makeup, all three films",
            swatch: "linear-gradient(135deg,#fff 50%,#000 50%)",
            color: "#f2efe8",
            tagline: "He never speaks. He just smiles",
            art: "",
            photos: [
                still("Terrifier", "/kRQQrg4ItP7CMdr8PLZBYUNsOLf.jpg"),
                still("Terrifier", "/zDEh4zB0oRaYNmbOhkLN6weWusS.jpg"),
                still("Terrifier 2", "/rr7ygjnaoZIR6G3uD7tpeZIEvqN.jpg", "78% 25%"),
                still("Terrifier 2", "/y5Z0WesTjvn59jP6yo459eUsbli.jpg"),
                still("Terrifier 3", "/gMQibswELoKmB60imE7WFMlCuqY.jpg"),
                still("Terrifier 3", "/xlkclSE4aq7r3JsFIJRgs21zUew.jpg"),
            ],
        },
    ];

    const byId = (id) => THEMES.find((t) => t.id === id);

    function saved() {
        const fromUrl = byId(new URLSearchParams(location.search).get(KEY));
        if (fromUrl) return fromUrl.id;
        try {
            return byId(localStorage.getItem(KEY))?.id ?? "house";
        } catch {
            return "house";
        }
    }

    let current = saved();

    function applyArt(theme) {
        const photo = theme.photos[Math.floor(Math.random() * theme.photos.length)];
        const photoHtml = `<img class="hero-photo" src="${photo.src}"${photo.srcset ? ` srcset="${photo.srcset}" sizes="100vw"` : ""}${photo.pos ? ` style="object-position:${photo.pos}"` : ""} alt="" decoding="async"><div class="hero-shade"></div>`;
        document.querySelectorAll(".hero-art").forEach((el) => (el.innerHTML = photoHtml + theme.art));
        const tagline = document.getElementById("heroTagline");
        if (tagline) tagline.textContent = theme.tagline;
        const credit = document.getElementById("photoCredit");
        if (credit)
            credit.innerHTML =
                photo.credit ??
                `Still from ${photo.film} via <a class="link" href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>`;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.color);
    }

    function apply(id) {
        const theme = byId(id) ?? THEMES[0];
        current = theme.id;
        try {
            localStorage.setItem(KEY, theme.id);
        } catch {
            // storage unavailable: the theme lasts until the page is closed
        }

        let link = document.getElementById("themeCss");
        if (theme.id === "house") {
            link?.remove();
            delete document.documentElement.dataset.theme;
        } else {
            if (!link) {
                link = document.createElement("link");
                link.rel = "stylesheet";
                link.id = "themeCss";
                document.head.appendChild(link);
            }
            const href = `css/themes/${theme.id}.css${v ? `?v=${v}` : ""}`;
            if (link.getAttribute("href") !== href) link.setAttribute("href", href);
            document.documentElement.dataset.theme = theme.id;
        }
        applyArt(theme);
        renderPicker();
    }

    // ---------- picker ----------

    function renderPicker() {
        const slot = document.getElementById("themeSlot");
        if (!slot) return;
        const theme = byId(current);
        slot.innerHTML = `
            <div class="theme-picker">
                <button type="button" class="theme-button" aria-haspopup="menu" aria-expanded="false" data-theme-button>
                    <span class="swatch" style="background:${theme.swatch}"></span>
                    <span><span class="sr-only">Theme: </span>${theme.name}</span>
                </button>
                <div class="theme-menu hidden" role="menu" aria-label="Theme">
                    ${THEMES.map(
                        (t) => `
                        <button type="button" role="menuitemradio" aria-checked="${t.id === current}" data-theme-id="${t.id}">
                            <img class="theme-thumb" src="${t.photos[0].thumb}" alt="" loading="lazy">
                            <span><span class="theme-name">${t.name}</span><span class="theme-note">${t.note}</span></span>
                        </button>`,
                    ).join("")}
                </div>
            </div>`;

        const button = slot.querySelector("[data-theme-button]");
        const menu = slot.querySelector(".theme-menu");
        const items = [...menu.querySelectorAll("[data-theme-id]")];
        const setOpen = (open) => {
            menu.classList.toggle("hidden", !open);
            button.setAttribute("aria-expanded", String(open));
            if (open) (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0]).focus();
        };

        button.onclick = (e) => {
            e.stopPropagation();
            setOpen(menu.classList.contains("hidden"));
        };
        items.forEach((item) => {
            item.onclick = () => {
                apply(item.dataset.themeId);
                document.querySelector("[data-theme-button]")?.focus();
            };
        });
        menu.addEventListener("keydown", (e) => {
            const i = items.indexOf(document.activeElement);
            if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
            else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
            else if (e.key === "Escape") {
                setOpen(false);
                button.focus();
            } else return;
            e.preventDefault();
            e.stopPropagation();
        });
    }

    document.addEventListener("click", (e) => {
        const slot = document.getElementById("themeSlot");
        const menu = slot?.querySelector(".theme-menu");
        if (menu && !slot.contains(e.target) && !menu.classList.contains("hidden")) {
            menu.classList.add("hidden");
            slot.querySelector("[data-theme-button]")?.setAttribute("aria-expanded", "false");
        }
    });

    applyArt(byId(current));
    renderPicker();

    window.Theme = { list: THEMES, get current() { return current; }, apply };
})();
