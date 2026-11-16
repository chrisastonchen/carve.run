// The place pills over the map (Chris, 11/11): Gas, Coffee, Food, Rest
// areas, Viewpoints, Landmarks in one row at the top left, one on at a
// time; a second tap hides it. Its places are pins with a card and + Stop.
// With a route: the planner's `nearby` along it, asked once per route and
// kind and reused. Without: `nearby` in the map's view, on a tap only; a
// moved map offers "Search this area" (never a search by itself), at most
// one view search each 10 s. Each pin's card shows its place's photo
// (Chris, 11/15: every map pin, as ✦ Suggest's do; pin-photo.js). Words:
// pill-words.js.

import { PILLS, WORDS, labelOf, noneText, pathKey, pillItems, viewBox, waitFor } from "./pill-words.js?v=2";
import { icon } from "./suggest.js?v=15";
import { mapsUrl } from "./suggest-words.js?v=9";
import { askPhotos, cardPhoto, openPhoto } from "./pin-photo.js?v=1";

/// `h` from plan.js: { el, planner, plan, map, mapReady, addStop, miles,
/// closeSuggest }. → { changed(), hide(), shown(on) }
export function initPills(h) {
  const row = document.getElementById("place-pills");
  const chip = document.getElementById("place-chip");
  const said = document.getElementById("place-said");
  let on = null; // the kind shown
  let pins = [];
  let popup = null;
  let asked = 0;
  let lastView = null; // the last view search: { at, kind, box }
  let waiting = null; // a view search held for the 10 s
  let shownFor = null; // the route key, or "view", the pins are for
  let shownItems = null; // the places the pins are for: their photos come here
  let photos = []; // by the place's index
  let token = null; // the street view's, from the photos answer
  let active = -1; // the place whose card is open
  const routeAnswers = new Map(); // `${pathKey}|${kind}` → answer

  for (const p of PILLS) {
    const b = h.el("button", "place-pill");
    b.type = "button";
    b.dataset.kind = p.kind;
    b.setAttribute("aria-pressed", "false");
    b.innerHTML = icon(p.kind);
    b.append(p.label);
    b.addEventListener("click", () => tap(p.kind));
    row.append(b);
  }
  // More to the right (a tablet shows two or three, QA 11/12): the row's
  // end fades until it's scrolled to.
  const more = () => row.classList.toggle("more", row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
  row.addEventListener("scroll", more, { passive: true });
  new ResizeObserver(more).observe(row);
  chip.addEventListener("click", () => {
    chip.hidden = true;
    look(on);
  });

  /// The line under the row: busy, a small spinner beside "Looking…"
  /// while a search runs (Chris, 11/15).
  function say(text, busy = false) {
    said.textContent = text;
    said.hidden = !text;
    said.classList.toggle("busy", busy && !!text);
    said.setAttribute("aria-busy", busy && text ? "true" : "false");
  }

  function clear() {
    popup?.remove();
    popup = null;
    for (const m of pins) m.remove();
    pins = [];
    shownFor = null;
    shownItems = null;
    photos = [];
    active = -1;
  }

  function hide() {
    asked++;
    clearTimeout(waiting);
    waiting = null;
    on = null;
    clear();
    chip.hidden = true;
    say("");
    for (const b of row.children) press(b, false);
  }

  /// A pill on shows ✕ at its end: a second tap clears it, so its name
  /// says so (Chris, 11/15).
  function press(b, on) {
    b.setAttribute("aria-pressed", String(on));
    b.querySelector(".place-x")?.remove();
    if (on) {
      const x = h.el("span", "place-x", "✕");
      x.setAttribute("aria-hidden", "true");
      b.append(x);
      b.setAttribute("aria-label", `Clear ${labelOf(b.dataset.kind)}`);
    } else b.removeAttribute("aria-label");
  }

  function tap(kind) {
    if (on === kind) return hide();
    hide();
    on = kind;
    press(row.querySelector(`[data-kind="${kind}"]`), true);
    h.closeSuggest();
    look(kind);
  }

  /// The pill's places: along the route, else in the view.
  async function look(kind) {
    const p = h.plan();
    const route = pathKey(p.path);
    const n = ++asked;
    chip.hidden = true;
    if (route) {
      const k = `${route}|${kind}`;
      let answer = routeAnswers.get(k);
      if (!answer) {
        say(WORDS.looking, true);
        try {
          answer = await h.planner("nearby", { category: kind, path: p.path.geometry, durationSeconds: p.path.durationSeconds });
        } catch (failure) {
          if (n === asked) say(failure.message || WORDS.failed);
          return;
        }
        if (routeAnswers.size > 30) routeAnswers.delete(routeAnswers.keys().next().value);
        routeAnswers.set(k, answer);
      }
      if (n !== asked) return;
      return show(kind, pillItems(answer, { miles: h.miles }), route, true);
    }
    const map = h.map();
    if (!map || !h.mapReady()) return;
    // Only once the map has stopped moving, and no more than each 10 s.
    if (map.isMoving()) {
      say(WORDS.looking, true);
      return map.once("moveend", () => n === asked && look(kind));
    }
    const b = map.getBounds();
    const box = viewBox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    if (!box) {
      clear();
      return say(WORDS.zoomIn);
    }
    // Only the same pill in the same view waits; anything else goes now.
    const wait = waitFor(lastView, kind, box);
    if (wait) {
      say(WORDS.looking, true);
      waiting = setTimeout(() => n === asked && look(kind), wait);
      return;
    }
    lastView = { at: Date.now(), kind, box };
    say(WORDS.looking, true);
    let answer;
    try {
      answer = await h.planner("nearby", { category: kind, bbox: box });
    } catch (failure) {
      if (n === asked) say(failure.message || WORDS.failed);
      return;
    }
    if (n !== asked) return;
    show(kind, pillItems(answer, { miles: h.miles }), "view", false);
  }

  function show(kind, items, forKey, alongRoute) {
    clear();
    shownFor = forKey;
    say(items.length ? "" : noneText(kind, alongRoute));
    const map = h.map();
    if (!map || !h.mapReady()) return;
    items.forEach((item, i) => {
      const pin = h.el("button", "suggest-pin place-pin");
      pin.type = "button";
      pin.dataset.kind = item.icon;
      pin.innerHTML = icon(item.icon);
      pin.setAttribute("aria-label", `${item.kind}: ${item.title}`);
      pin.addEventListener("click", (e) => { e.stopPropagation(); card(items, i); });
      pins.push(new window.maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([item.place.lon, item.place.lat]).addTo(map));
    });
    // Their photos, for the cards: one that's open when its photo comes
    // is drawn again with it.
    shownItems = items;
    askPhotos(h.planner, items, {
      still: () => shownItems === items,
      got: (answer) => {
        answer.photos.forEach((p, i) => { photos[i] = p; });
        token = answer.token || token;
        if (active >= 0 && photos[active] && popup) card(items, active, { focus: false });
      },
    });
  }

  /// A place's card over its pin: its photo, what and where, + Stop,
  /// Google Maps.
  function card(items, i, { focus = true } = {}) {
    const item = items[i];
    active = i;
    pins.forEach((m, n) => m.getElement().classList.toggle("on", n === i));
    const box = h.el("div", "suggest-card");
    const photo = photos[i] || null;
    if (photo) box.append(cardPhoto(photo, { onOpen: () => openPhoto(photo, item.title, token), onClose: () => { popup?.remove(); popup = null; } }));
    const kind = h.el("p", "suggest-kind");
    kind.innerHTML = icon(item.icon);
    kind.append(item.kind);
    box.append(kind, h.el("p", "suggest-title", item.title));
    if (item.where) box.append(h.el("p", "suggest-where", item.where));
    const acts = h.el("div", "suggest-acts");
    const add = h.el("button", "pill green small place-add", WORDS.add);
    add.type = "button";
    add.addEventListener("click", () => {
      popup?.remove();
      popup = null;
      h.addStop(item.place);
    });
    const maps = h.el("a", "suggest-maps", "Google Maps ↗");
    maps.href = mapsUrl(item.place);
    maps.target = "_blank";
    maps.rel = "noopener";
    acts.append(add, maps);
    box.append(acts);
    // The old card goes without saying no card is open.
    const old = popup;
    popup = null;
    old?.remove();
    // Near the top, the card opens below its pin, clear of the pills.
    const y = h.map().project([item.place.lon, item.place.lat]).y;
    popup = new window.maplibregl.Popup({ closeButton: !photo, closeOnClick: false, offset: 18, maxWidth: "280px", className: photo ? "suggest-popup with-photo" : "suggest-popup", ...(y < 260 ? { anchor: "top" } : {}) })
      .setLngLat([item.place.lon, item.place.lat]).setDOMContent(box).addTo(h.map());
    const mine = popup;
    mine.on("close", () => { if (popup === mine) { popup = null; active = -1; } });
    if (focus) add.focus({ preventScroll: true });
  }

  // A moved map with a view's pins: offered, never searched by itself.
  const watchMap = () => {
    const map = h.map();
    if (!map) return setTimeout(watchMap, 500);
    map.on("moveend", () => {
      if (on && !pathKey(h.plan().path) && shownFor !== null) chip.hidden = false;
    });
  };
  watchMap();

  /// The route changed: a pill that's on follows it (a new route, or none).
  let following = null;
  function changed() {
    if (!on || shownFor === null) return;
    const route = pathKey(h.plan().path);
    if (!route) {
      // No route now (or one on its way): its pins go; the view is a tap away.
      if (shownFor !== "view") {
        clear();
        shownFor = "gone";
        chip.hidden = false;
      }
      return;
    }
    if (shownFor === route) return;
    clearTimeout(following);
    following = setTimeout(() => on && pathKey(h.plan().path) === route && look(on), 800);
  }

  // Escape closes a card first, then the pill.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !on || e.defaultPrevented) return;
    if (popup) {
      popup.remove();
      popup = null;
      return;
    }
    hide();
  });

  /// Shown only beside the plan (not the saved view, not without a map).
  function shown(visible) {
    row.hidden = !visible;
    if (!visible) hide();
  }

  return { changed, hide, shown, label: labelOf };
}
