// The place pills over the map (Chris, 11/11): Gas, Coffee, Food, Rest
// areas, Viewpoints, Landmarks in one row at the top left, one on at a
// time; a second tap hides it. Its places are pins with a card and + Stop.
// With a route: the planner's `nearby` along it, asked once per route and
// kind and reused. Without: `nearby` in the map's view, on a tap only; a
// moved map offers "Search this area" (never a search by itself), at most
// one view search each 10 s. Words: pill-words.js.

import { PILLS, WORDS, labelOf, noneText, pathKey, pillItems, viewBox, waitFor } from "./pill-words.js?v=1";
import { icon } from "./suggest.js?v=11";
import { mapsUrl } from "./suggest-words.js?v=8";

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
  let viewAt = null; // when the last view search went
  let waiting = null; // a view search held for the 10 s
  let shownFor = null; // the route key, or "view", the pins are for
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

  function say(text) {
    said.textContent = text;
    said.hidden = !text;
  }

  function clear() {
    popup?.remove();
    popup = null;
    for (const m of pins) m.remove();
    pins = [];
    shownFor = null;
  }

  function hide() {
    asked++;
    clearTimeout(waiting);
    waiting = null;
    on = null;
    clear();
    chip.hidden = true;
    say("");
    for (const b of row.children) b.setAttribute("aria-pressed", "false");
  }

  function tap(kind) {
    if (on === kind) return hide();
    hide();
    on = kind;
    row.querySelector(`[data-kind="${kind}"]`).setAttribute("aria-pressed", "true");
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
        say(WORDS.looking);
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
      say(WORDS.looking);
      return map.once("moveend", () => n === asked && look(kind));
    }
    const wait = waitFor(viewAt);
    if (wait) {
      say(WORDS.looking);
      waiting = setTimeout(() => n === asked && look(kind), wait);
      return;
    }
    const b = map.getBounds();
    const box = viewBox({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    if (!box) {
      clear();
      return say(WORDS.zoomIn);
    }
    viewAt = Date.now();
    say(WORDS.looking);
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
  }

  /// A place's card over its pin: what and where, + Stop, Google Maps.
  function card(items, i) {
    const item = items[i];
    pins.forEach((m, n) => m.getElement().classList.toggle("on", n === i));
    const box = h.el("div", "suggest-card");
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
    popup?.remove();
    // Near the top, the card opens below its pin, clear of the pills.
    const y = h.map().project([item.place.lon, item.place.lat]).y;
    popup = new window.maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 18, maxWidth: "280px", className: "suggest-popup", ...(y < 260 ? { anchor: "top" } : {}) })
      .setLngLat([item.place.lon, item.place.lat]).setDOMContent(box).addTo(h.map());
    add.focus({ preventScroll: true });
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
