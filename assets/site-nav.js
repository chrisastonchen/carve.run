// The site's bar and the phone's menu by who's looking (boards N3–N5;
// Chris 11/11): carve-site.js loads this on every page. The pages carry
// the signed-out bar (Plan · For Clubs · Explore · Events · Pricing ·
// Support); this draws it from who-words.js navFor for whoever's looking,
// signed out too (Plan ▾, Chris 11/12): Plan ▾ and My Clubs ▾ menus,
// Saved, Upgrade.
import { who, whoNow } from "/assets/who.js?v=b3c98f8ff6";
import { currentKey, navFor } from "/assets/who-words.js?v=f70bdee137";

const CSS = `
.bar .links .nav-m { position: relative; display: inline-flex; }
.bar .links .nav-b { display: inline-flex; align-items: center; gap: 4px; padding: 8px 12px; border: 0; border-radius: 999px; background: none; color: rgba(255,255,255,.86); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.bar .links .nav-b:hover, .bar .links .nav-b[aria-expanded="true"] { color: #fff; background: rgba(255,255,255,.08); }
.bar .links .nav-b[aria-current="page"] { color: #fff; background: rgba(255,255,255,.16); }
.bar .links .nav-b svg { width: 13px; height: 13px; }
.bar .links .nav-pop { position: absolute; z-index: 60; left: 0; top: calc(100% + 8px); min-width: 300px; padding: 6px; border-radius: 14px; background: #161B18; box-shadow: 0 14px 36px rgba(0,0,0,.4); display: flex; flex-direction: column; }
.bar .links .nav-pop[hidden] { display: none; }
.bar .links .nav-pop a { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 9px; color: #EEF1EE; background: none; font-size: 15px; font-weight: 700; text-decoration: none; white-space: normal; }
.bar .links .nav-pop a:hover, .bar .links .nav-pop a:focus-visible { background: #1D2A22; outline: none; }
.bar .links .nav-pop a span { font-size: 13px; font-weight: 600; color: #9AA39D; }
.bar .links .nav-pop hr { border: 0; height: 1px; background: #2A332E; margin: 4px 6px; }
/* One line each, and room for them all from 700 px (QA, 11/12: My Clubs in two lines at 768). */
.bar .links a, .bar .links .nav-b { white-space: nowrap; }
@media (min-width: 700px) and (max-width: 1023px) {
  .bar .links { gap: 0; }
  .bar .links a, .bar .links .nav-b { padding-left: 9px; padding-right: 9px; font-size: 15px; }
}
@media (min-width: 700px) and (max-width: 859px) {
  .bar { padding-left: 16px; padding-right: 12px; gap: 8px; }
  .bar .brand { margin-right: 2px; }
  .bar .wordmark { width: 92px; height: 14px; }
  .bar .links a, .bar .links .nav-b { padding-left: 5px; padding-right: 5px; font-size: 14px; }
}
@media (min-width: 700px) and (max-width: 759px) {
  .bar .links a, .bar .links .nav-b { padding-left: 4px; padding-right: 4px; }
  .bar .who-btn { gap: 6px; padding-right: 8px; }
}
.sheet .sheet-sub { padding: 12px 6px 12px 22px; font-size: 18px; font-weight: 600; }
.sheet .sheet-sub:has(.sheet-note) { display: flex; flex-direction: column; gap: 2px; }
.sheet .sheet-note { font-size: 14px; font-weight: 600; color: rgba(255,255,255,.68); }
.sheet .sheet-h { margin: 0; padding: 16px 6px 4px; border-bottom: 0; color: rgba(255,255,255,.7); font-size: 15px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
@media not all and (prefers-color-scheme: dark) {
  .bar .links .nav-pop { background: #fff; box-shadow: 0 14px 36px rgba(0,0,0,.18); }
  .bar .links .nav-pop a { color: #15181C; }
  .bar .links .nav-pop a:hover, .bar .links .nav-pop a:focus-visible { background: #EEF5F0; }
  .bar .links .nav-pop a span { color: #5D636C; }
  .bar .links .nav-pop hr { background: #E4E3DE; }
}`;

const CHEV = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/></svg>';
/// The static items carve.run's pages carry, swapped for these.
const STATIC = new Set(["/plan/", "/club/", "/drives/", "/events/", "/pricing/", "/support/", "/my-drives/", "/saved/"]);
const WIDE = new Set(["plan", "clubs", "events", "saved", "upgrade"]);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function menuLink(item) {
  const a = el("a");
  a.href = item.href;
  a.setAttribute("role", "menuitem");
  a.append(item.label);
  if (item.note) a.append(el("span", "", item.note));
  return a;
}

let openMenu = null;
function close() {
  if (!openMenu) return;
  openMenu.pop.hidden = true;
  openMenu.button.setAttribute("aria-expanded", "false");
  openMenu = null;
}

function barItem(item, cur) {
  if (!item.menu) {
    const a = el("a", WIDE.has(item.key) ? "wide-only" : "", item.label);
    a.href = item.href;
    a.dataset.nav = item.key;
    if (item.key === cur) a.setAttribute("aria-current", "page");
    return a;
  }
  const wrap = el("div", `nav-m${WIDE.has(item.key) ? " wide-only" : ""}`);
  wrap.dataset.nav = item.key;
  const button = el("button", "nav-b", item.label);
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  if (item.key === cur) button.setAttribute("aria-current", "page");
  button.insertAdjacentHTML("beforeend", CHEV);
  const pop = el("div", "nav-pop");
  pop.setAttribute("role", "menu");
  pop.hidden = true;
  // A rule before the last item (for myself; + Add a club).
  item.menu.forEach((m, i) => {
    if (i === item.menu.length - 1 && i > 0) pop.append(el("hr"));
    pop.append(menuLink(m));
  });
  button.addEventListener("click", () => {
    const opening = pop.hidden;
    close();
    if (!opening) return;
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    openMenu = { pop, button };
    pop.querySelector("a")?.focus();
  });
  wrap.append(button, pop);
  return wrap;
}

/// The phone's menu: the same items, a menu's links under its name.
function sheetItems(items, cur) {
  return items.flatMap((item) => {
    if (!item.menu) {
      const a = el("a", "", item.label);
      a.href = item.href;
      a.dataset.nav = item.key;
      if (item.key === cur) a.setAttribute("aria-current", "page");
      return [a];
    }
    const head = el("p", "sheet-h", item.label);
    head.dataset.nav = item.key;
    return [head, ...item.menu.map((m) => {
      const a = el("a", "sheet-sub", m.label);
      // A club's plan, as the desktop menu says it (QA, 11/11).
      if (m.note) a.append(el("span", "sheet-note", m.note));
      a.href = m.href;
      a.dataset.nav = item.key;
      return a;
    })];
  });
}

export function drawNav({ state, clubs }) {
  const items = navFor(state, clubs);
  const cur = currentKey(location.pathname);
  document.querySelectorAll(".bar nav.links").forEach((nav) => nav.replaceChildren(...items.map((item) => barItem(item, cur))));
  const sheet = document.getElementById("sheet");
  if (sheet) {
    for (const n of [...sheet.children]) if (n.dataset.nav || STATIC.has(n.getAttribute("href"))) n.remove();
    sheet.prepend(...sheetItems(items, cur));
  }
  document.documentElement.dataset.who = state;
}

let wired = false;
export function startNav() {
  if (!wired) {
    wired = true;
    const style = el("style");
    style.textContent = CSS;
    document.head.append(style);
    document.addEventListener("click", (e) => { if (openMenu && !e.target.closest(".nav-m")) close(); });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !openMenu) return;
      const button = openMenu.button;
      close();
      button.focus();
    });
  }
  const known = whoNow();
  if (known) drawNav(known);
  return who().then(drawNav).catch(() => {});
}

startNav();
