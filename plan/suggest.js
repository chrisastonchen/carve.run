// Smart planning in the planner (Chris, 11/10; board O5 v37): "✦ Suggest"
// under the start (meeting places: the planner's `meet` there), under the
// stops (`along` the route) and under the destination (`meet` there).
// Suggestions are map pins, labelled by kind, with a card: what it is,
// where, Use as start / Add as a stop / Use as destination, Google Maps ↗.
// Nothing on the route changes until one is picked. Individual, and a paid
// club's organizers (who hold Apex): for others, tapping an action opens
// the upsell (no label beside it); the planner's 403 says the same.

import { SOLO, SUGGEST, alongSuggestions, mapsUrl, meetDay, meetSaid, meetSuggestions, needsFirst } from "./suggest-words.js?v=8";
import { fitTo } from "./fit.js?v=1";
import { openStreetView } from "./street-view.js?v=1";

/// Each kind's icon (24 px, stroked in the pin's colour; no emoji).
const ICONS = {
  gas: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 3v6a2 2 0 0 0 4 0V8l-3-3"/>',
  coffee: '<path d="M4 8h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 9h2a3 3 0 0 1 0 6h-2M7 2v3M11 2v3M15 2v3"/>',
  food: '<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2 1-3 4-3 7v4h3"/>',
  park: '<path d="M12 22v-5M12 2 6 11h3l-4 6h14l-4-6h3z"/>',
  rest_area: '<path d="M4 9h16M5 9V6h14v3M3 13h18M6 13v6M18 13v6"/>',
  viewpoint: '<path d="m3 20 6-9 4 6 3-4 5 7z"/><circle cx="17" cy="5.5" r="2"/>',
  attraction: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
};
export const icon = (kind) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.attraction}</svg>`;

/// `hooks` from plan.js: { el, planner, plan, map, mapReady, choosePlace,
/// addStop, miles, zone, upcoming, smart, signedIn, signIn, fitPadding,
/// mapCentre, driveDay, lock }. → { row(which), changed(), close(), refresh() }
export function initSuggest(h) {
  let open = null; // { which, key, items, pins, popup, active }
  const said = { start: "", along: "", end: "" };
  const upsell = { start: false, along: false, end: false };
  let asked = 0;

  /// What a suggestion answer is for: the field's place, or the route.
  const keyOf = (which) => {
    const p = h.plan();
    if (which === "along") return JSON.stringify([p.path?.geometry?.length, p.path?.distanceMeters, (p.waypoints || []).map((w) => [w.lat, w.lon, w.type, w.stayMinutes])]);
    const at = which === "start" ? p.start : p.end;
    return JSON.stringify(at ? [at.lat, at.lon] : null);
  };

  function close() {
    listing(false);
    if (!open) return;
    open.popup?.remove();
    for (const m of open.pins) m.remove();
    open = null;
  }

  // ── The list (Chris, 11/13): the same places the map pins show, in a
  // list in place of the schedule, ‹ Back to the schedule; each row's
  // button does what its pin card's does. Opens only with places to show.
  const $ = (id) => document.getElementById(id);
  function listing(on) {
    $("plan-view")?.classList.toggle("listing", on);
    if ($("suggest-list")) $("suggest-list").hidden = !on;
  }
  function list(which) {
    if (!open || !$("suggest-list")) return;
    $("suggest-list-h").textContent = SUGGEST[which].list;
    $("suggest-list-said").textContent = said[which] || "";
    $("suggest-items").replaceChildren(...open.items.map((item, i) => {
      const li = h.el("li", `suggest-item tall${open.active === i ? " on" : ""}`);
      const see = h.el("button", "suggest-item-go");
      see.type = "button";
      // One tile in all three lists (Chris, 11/13: Meeting places' photos
      // too small): an 80 px square the row's height, the icon until a photo comes.
      const mark = h.el("span", "suggest-item-icon suggest-tile");
      mark.dataset.kind = item.icon;
      mark.dataset.i = String(i);
      mark.innerHTML = icon(item.icon);
      const words = h.el("span", "suggest-item-words");
      words.append(h.el("b", "", item.title), h.el("span", "", [item.kind, item.where].filter(Boolean).join(" · ")));
      for (const f of item.facts || []) words.append(h.el("span", "suggest-item-fact", f));
      see.append(mark, words);
      see.setAttribute("aria-label", `${item.title}, ${item.kind}: show on the map`);
      see.addEventListener("click", () => { card(i, { focus: false }); markList(); });
      const pick = h.el("button", "pill green small suggest-pick", SUGGEST[which].pick);
      pick.type = "button";
      pick.addEventListener("click", () => use(which, item.place));
      li.append(see, pick);
      return li;
    }));
    listing(true);
    paintPhotos();
    $("suggest-list-h").focus({ preventScroll: true });
  }

  // ── Photos (Chris approved Product's mock v4, 11/13): asked once the
  // places show, filled in as they come; a place with none keeps its icon.
  // The planner's photos action (OSM, Commons by name, Mapillary nearby).
  // A place the planner ran out of time on (left out, not "none") is
  // asked once more a few seconds later (DevOps, 11/14).
  const PHOTO_AGAIN_MS = 3000;
  async function askPhotos(mine, only = null) {
    const ids = only ?? mine.items.slice(0, 12).map((_, i) => i);
    try {
      const answer = await h.planner("photos", { places: ids.map((i) => ({ id: String(i), name: mine.items[i].title, lat: mine.items[i].place.lat, lon: mine.items[i].place.lon })) });
      if (open !== mine) return;
      mine.photos ??= [];
      const said = new Set();
      for (const p of answer?.photos || []) {
        if (!p || !("photo" in p)) continue;
        said.add(Number(p.id));
        if (p.photo) mine.photos[Number(p.id)] = p.photo;
      }
      mine.token = answer?.viewer?.token || mine.token || null;
      paintPhotos();
      if (mine.active >= 0 && mine.photos[mine.active]) card(mine.active, { focus: false });
      const left = ids.filter((i) => !said.has(i));
      if (!only && left.length) setTimeout(() => { if (open === mine) askPhotos(mine, left); }, PHOTO_AGAIN_MS);
    } catch {
      // No photos this time: the icons stay.
    }
  }

  /// A photo into its box, faded in once loaded; a broken one leaves the icon.
  function photoInto(box, photo, cls) {
    box.querySelector(`img.${cls}`)?.remove();
    if (!photo?.thumb) return;
    const img = h.el("img", cls);
    img.alt = "";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("load", () => { img.classList.add("in"); box.classList.add("has-photo"); });
    img.addEventListener("error", () => { img.remove(); box.classList.remove("has-photo"); });
    img.src = photo.thumb;
    box.append(img);
  }

  /// A photo opens: a street view full screen, a Commons photo its page.
  function openPhoto(i) {
    const photo = open?.photos?.[i];
    if (!photo) return;
    if (photo.src === "mapillary" && open.token) openStreetView({ place: open.items[i].title, imageId: photo.mapillary_id, token: open.token });
    else if (photo.link) window.open(photo.link, "_blank", "noopener");
  }

  function paintPhotos() {
    if (!open?.photos || !$("suggest-items")) return;
    document.querySelectorAll("#suggest-items .suggest-item-icon").forEach((mark) => {
      const i = Number(mark.dataset.i);
      const photo = open.photos[i];
      photoInto(mark, photo, "suggest-photo");
      mark.classList.toggle("opens", !!photo);
      if (photo && !mark.dataset.wired) {
        mark.dataset.wired = "1";
        mark.addEventListener("click", (e) => { if (!open?.photos?.[i]) return; e.stopPropagation(); openPhoto(i); });
      }
    });
    $("suggest-credit").replaceChildren(...creditLine(open.items, open.photos));
  }

  /// One line under the list for every photo in it (mock v4).
  function creditLine(items, photos) {
    const parts = [];
    const files = photos.map((p, i) => [p, items[i]]).filter(([p]) => p && p.src !== "mapillary");
    if (files.length) {
      parts.push("Photos: ");
      files.forEach(([p, item], n) => {
        if (n) parts.push("; ");
        parts.push(`${item.title}${p.author ? ` by ${p.author}` : ""} · `);
        const a = h.el("a", "", p.licence);
        a.href = p.link;
        a.target = "_blank";
        a.rel = "noopener";
        parts.push(a);
      });
      parts.push(". ");
    }
    if (photos.some((p) => p?.src === "mapillary")) parts.push("Street views © Mapillary contributors · CC BY-SA.");
    return parts;
  }
  const markList = () => [...document.querySelectorAll("#suggest-items .suggest-item")].forEach((li, n) => li.classList.toggle("on", n === open?.active));
  function backToSchedule() {
    const which = open?.which;
    listing(false);
    if (which) document.querySelector(`.suggest-row[data-suggest="${which}"] .suggest-go`)?.focus();
  }
  $("suggest-back")?.addEventListener("click", backToSchedule);

  function rerender() {
    for (const which of ["start", "along", "end"]) {
      const old = document.querySelector(`.suggest-row[data-suggest="${which}"]`);
      if (old) old.replaceWith(row(which));
    }
  }

  /// The row under a field: the action, its Individual label, what it said.
  function row(which) {
    const li = h.el("li", "suggest-row");
    li.dataset.suggest = which;
    const go = h.el("button", "suggest-go", SUGGEST[which].link);
    go.type = "button";
    go.setAttribute("aria-describedby", `suggest-said-${which}`);
    if (open?.which === which) go.setAttribute("aria-pressed", "true");
    li.append(go);
    // Shown: a way to put them away (Chris, 11/10).
    if (open?.which === which) {
      const hide = h.el("button", "suggest-hide", "✕ Hide suggestions");
      hide.type = "button";
      hide.addEventListener("click", () => {
        close();
        said[which] = "";
        rerender();
        go.focus();
      });
      li.append(hide);
    }
    const locked = h.smart() === false;
    const note = h.el("p", "suggest-said", said[which]);
    note.id = `suggest-said-${which}`;
    note.setAttribute("role", "status");
    li.append(note);
    if (locked && upsell[which]) li.append(upsellBox());
    go.addEventListener("click", () => ask(which));
    return li;
  }

  function upsellBox() {
    const box = h.el("p", "suggest-upsell");
    box.append(`${SOLO.note} `);
    const see = h.el("a", "textlink", SOLO.see);
    see.href = "/pricing/";
    box.append(see);
    if (!h.signedIn()) {
      const signIn = h.el("button", "textlink", SOLO.signIn);
      signIn.type = "button";
      signIn.addEventListener("click", () => h.signIn());
      box.append(" · ", signIn);
    }
    return box;
  }

  async function ask(which) {
    if (h.smart() === false) {
      // Not on Individual: the upsell, in place of an ask that would be refused.
      upsell[which] = !upsell[which];
      return rerender();
    }
    if (open?.which === which) {
      close();
      said[which] = "";
      return rerender();
    }
    const p = h.plan();
    const first = needsFirst(which, p);
    if (first) {
      said[which] = first;
      return rerender();
    }
    close();
    const n = ++asked;
    for (const k of Object.keys(said)) said[k] = "";
    said[which] = SUGGEST[which].looking;
    rerender();
    try {
      const shown = which === "along" ? await alongAsk(p) : await meetAsk(which, p);
      if (n !== asked) return;
      said[which] = shown.said;
      if (shown.items.length) show(which, shown.items, shown.from);
    } catch (failure) {
      if (n !== asked) return;
      if (failure.upgrade) {
        h.lock();
        upsell[which] = true;
        said[which] = "";
      } else said[which] = failure.message || "Couldn't look. Try again.";
    }
    rerender();
  }

  async function meetAsk(which, p) {
    const at = (which === "start" ? p.start : p.end) || (which === "start" ? h.mapCentre() : null);
    const day = meetDay(h.driveDay() || {}, h.upcoming(p.leaveAt) ? p.leaveAt : null, h.zone);
    const answer = await h.planner("meet", { at: { lat: at.lat, lon: at.lon }, ...(day ? { day } : {}) });
    const items = meetSuggestions(answer.spots, at, which, { miles: h.miles, meet: day?.meet || null });
    return { items, said: meetSaid(items.length, which), from: at };
  }

  async function alongAsk(p) {
    const stops = (p.waypoints || []).filter((w) => w.type === "stop").map((w) => ({ lat: w.lat, lon: w.lon, stayMinutes: w.stayMinutes || 0 }));
    const leaveAt = h.upcoming(p.leaveAt) ? p.leaveAt : null;
    const answer = await h.planner("along", { path: p.path.geometry, durationSeconds: p.path.durationSeconds, stops, ...(leaveAt ? { leaveAt, zone: h.zone } : {}) });
    return { ...alongSuggestions(answer, { miles: h.miles, zone: h.zone, timed: !!leaveAt }), from: null };
  }

  /// The pins, the first one's card, and the map around them.
  function show(which, items, from) {
    const map = h.map();
    if (!map || !h.mapReady()) return;
    const maplibregl = window.maplibregl;
    open = { which, key: keyOf(which), items, pins: [], popup: null, active: -1 };
    items.forEach((item, i) => {
      const pin = h.el("button", "suggest-pin");
      pin.type = "button";
      pin.dataset.kind = item.icon;
      pin.innerHTML = icon(item.icon);
      pin.setAttribute("aria-label", `${item.kind}: ${item.title}`);
      pin.addEventListener("click", (e) => { e.stopPropagation(); card(i); });
      open.pins.push(new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([item.place.lon, item.place.lat]).addTo(map));
    });
    // The suggestions with what they're for: along the route, its start and
    // end; near a field, that place. Fitted only when they aren't all in
    // view already; in view, centred at the same zoom, so asking again
    // never zooms out further (Chris, 11/10).
    const p = h.plan();
    const ends = which === "along" ? [p.start, p.end].filter(Boolean) : from ? [from] : [];
    const all = [...items.map((x) => x.place), ...ends];
    const bounds = all.reduce((b, s) => b.extend([s.lon, s.lat]), new maplibregl.LngLatBounds([all[0].lon, all[0].lat], [all[0].lon, all[0].lat]));
    const pad = h.fitPadding();
    const padding = { top: pad.top + 60, bottom: pad.bottom + 40, left: pad.left + 40, right: pad.right + 40 };
    const box = map.getContainer().getBoundingClientRect();
    const inView = all.every((s) => {
      const pt = map.project([s.lon, s.lat]);
      return pt.x >= padding.left && pt.x <= box.width - padding.right && pt.y >= padding.top && pt.y <= box.height - padding.bottom;
    });
    if (inView) map.easeTo({ center: bounds.getCenter(), padding, duration: 400 });
    else fitTo(map, bounds, padding, { maxZoom: 14, duration: 400 });
    card(0, { focus: false });
    rerender();
    list(which);
    askPhotos(open);
  }

  /// One suggestion's card, over its pin.
  function card(i, { focus = true } = {}) {
    if (!open) return;
    const item = open.items[i];
    open.active = i;
    open.pins.forEach((m, n) => m.getElement().classList.toggle("on", n === i));
    const box = h.el("div", "suggest-card");
    const photo = open.photos?.[i] || null;
    if (photo) box.append(cardPhoto(i, photo));
    const kind = h.el("p", "suggest-kind");
    kind.innerHTML = icon(item.icon);
    kind.append(item.kind);
    box.append(kind, h.el("p", "suggest-title", item.title));
    if (item.where) box.append(h.el("p", "suggest-where", item.where));
    for (const f of item.facts || []) box.append(h.el("p", "suggest-fact", f));
    const acts = h.el("div", "suggest-acts");
    const pick = h.el("button", "pill green small suggest-pick", SUGGEST[open.which].pick);
    pick.type = "button";
    const which = open.which;
    pick.addEventListener("click", () => use(which, item.place));
    const maps = h.el("a", "suggest-maps", "Google Maps ↗");
    maps.href = mapsUrl(item.place);
    maps.target = "_blank";
    maps.rel = "noopener";
    acts.append(pick, maps);
    box.append(acts);
    open.popup?.remove();
    open.popup = new window.maplibregl.Popup({ closeButton: !photo, closeOnClick: false, focusAfterOpen: focus, offset: 18, maxWidth: "280px", className: photo ? "suggest-popup with-photo" : "suggest-popup" })
      .setLngLat([item.place.lon, item.place.lat]).setDOMContent(box).addTo(h.map());
    if (focus) pick.focus({ preventScroll: true });
    markList();
  }

  /// The card's photo (mock v4): 136 px on top, ✕, its credit, and expand
  /// (the street view, or a Commons photo's page); "Over 3 yrs old" on a
  /// street view taken more than 3 years ago.
  function cardPhoto(i, photo) {
    const ph = h.el("div", "suggest-ph");
    photoInto(ph, photo, "suggest-ph-img");
    ph.querySelector("img")?.addEventListener("error", () => ph.remove());
    const taken = Date.parse(photo.captured_at || "");
    if (photo.src === "mapillary" && Number.isFinite(taken) && Date.now() - taken > 3 * 365.25 * 86400_000) ph.append(h.el("span", "suggest-ph-old", "Over 3 yrs old"));
    const x = h.el("button", "suggest-ph-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => { open?.popup?.remove(); });
    const credit = h.el("span", "suggest-ph-credit", photo.src === "mapillary" ? photo.credit : `Photo: ${photo.credit}`);
    const exp = h.el("button", "suggest-ph-exp");
    exp.type = "button";
    exp.setAttribute("aria-label", photo.src === "mapillary" ? "Open the street view" : "Open the photo's page");
    exp.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
    exp.addEventListener("click", () => openPhoto(i));
    ph.addEventListener("click", (e) => { if (e.target === ph || e.target.tagName === "IMG") openPhoto(i); });
    ph.append(x, credit, exp);
    return ph;
  }

  /// A pick: the field takes it, and the suggestions go.
  function use(which, place) {
    close();
    said[which] = "";
    if (which === "along") h.addStop(place);
    else h.choosePlace(which, undefined, place);
  }

  /// The route or a field moved: an answer for the old one goes.
  function changed() {
    if (open && keyOf(open.which) !== open.key) {
      said[open.which] = "";
      close();
    }
  }

  // Escape puts them away too.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !open || e.defaultPrevented) return;
    const which = open.which;
    close();
    said[which] = "";
    rerender();
  });

  return { row, changed, close, refresh: rerender };
}
