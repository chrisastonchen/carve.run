// carve.run/saved/ (Chris, 11/13; club flow v11's bar): the routes this
// account made or saved (its own, the ones it made for its clubs, Carve's
// guides and other links it saved) and the events it set reminders for.
// /my-drives/ stays as it was, off the bar (DevOps, 11/13).
//
// Laid out as Explore (Chris, 11/25): the list on the left over a map of
// the routes; on a phone the list is the page and Map opens the map over
// it. Pointing at a route, in the list or on the map, lights its road and
// shows its card. Each route's line is its stored road (payload
// pathGeometry, ~1,700 points), so the map asks for the lines it shows:
// all of a short list, the ones in view of a long one; a dot at each start
// stands in until then.

import "/assets/site-bar.js?v=1a5c8ec6a0";
import { $, el, myOrgs, rpc, select, signedIn } from "/assets/club-api.js?v=3d6e3c082a";
import { boxOf, matching, pictureOf, routeLine, savedGroups, thinLine } from "/assets/saved-words.js?v=b6e23e2eca";
import { MAP_STYLE, NO_PHOTO, PHONE, addRoadLayers, railArrows } from "/assets/explore-map.js?v=8e77971e79";
import { cardHTML as eventCard, finishPictures, pinElement } from "/assets/events.js?v=b133592880";

const MOST = 500;
/// The clubs' drives looked through for their routes, at most.
const MOST_DRIVES = 30;
/// Lines asked for at once, and at most on the map.
const LINES_AT_ONCE = 10, MOST_LINES = 150;
/// A list this short has every line asked for at the start.
const ALL_LINES_UNDER = 40;
const US = [[-125, 24], [-66, 50]];
const phone = () => window.matchMedia(PHONE).matches;
// Miles in the US and the UK, as the planner's usesMiles.
const miles = () => /^en(-(US|GB))?$/i.test(navigator.language || "en-US");
const status = (text) => { $("s-status").textContent = text || ""; $("s-status").hidden = !text; };

let routes = [];
let catalog = {};
let groups = [];
let saves = { saved: [], events: new Map() };
let map = null;
let pointed = null;
let popup = null;
const lines = new Map(); // route id → [lon, lat] points
const asking = new Set();

/// The ids of the routes on this account's clubs' drives.
async function clubRoutes() {
  const ids = new Set();
  try {
    const orgs = await myOrgs();
    const drives = (await Promise.all(orgs.map((o) => rpc("org_drives", { p_org_id: o.id }).catch(() => [])))).flat().slice(0, MOST_DRIVES);
    const routes = await Promise.all(drives.map((d) => rpc("drive_routes", { p_drive_id: d.id }).catch(() => [])));
    for (const r of routes.flat()) if (r?.route_id) ids.add(r.route_id);
  } catch {}
  return ids;
}

/// Where a route opens. A computer opens it in the planner; a phone, its
/// page (Carve opens it if installed).
function hrefOf(route) {
  const opened = [route.opened, route.follows].filter(Boolean);
  const slug = opened.map((t) => catalog[t]).find(Boolean);
  const token = opened[0];
  const narrow = phone();
  return narrow && token ? `https://open.carve.run/${encodeURIComponent(token)}?then=page&ct=saved`
    : slug && narrow ? `/drives/${encodeURIComponent(slug)}/` : `/plan/?route=${encodeURIComponent(route.id)}`;
}
const slugOf = (route) => [route.opened, route.follows].filter(Boolean).map((t) => catalog[t]).find(Boolean);

function picture(route) {
  const img = el("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = pictureOf(route) || NO_PHOTO;
  img.addEventListener("error", () => { img.src = NO_PHOTO; }, { once: true });
  return img;
}

function row(route, k) {
  const li = el("li");
  const slug = slugOf(route);
  const a = el("a", "ex-row");
  a.href = hrefOf(route);
  a.dataset.k = String(k);
  // On a phone, the name in full (two lines at most) with its Guide tag
  // beside it, the facts on one line (Chris, 11/18); on a computer, the
  // Guide link at the row's end, as before.
  const t = el("span", "t");
  const name = el("span", "n");
  name.append(el("b", "", route.name || "Untitled route"));
  if (slug) name.append(el("span", "sx-tag", "Guide"));
  t.append(name, el("span", "m", routeLine(route, miles())));
  a.append(picture(route), t);
  li.append(a);
  if (slug) {
    const guide = el("a", "textlink sx-guide", "Guide");
    guide.href = `/drives/${encodeURIComponent(slug)}/`;
    li.append(guide);
  }
  return li;
}

function eventRow(save) {
  const ev = saves.events.get(String(save.event_id));
  const li = el("li");
  if (ev) { li.innerHTML = eventCard(ev, null); return li; }
  // Not in the events list (gone from it): its name and when, as it was saved.
  const card = el("span", "evc");
  const date = new Date(save.starts_at);
  const when = `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  card.append(el("span", "evc-n", save.name || "A car event"), el("span", "evc-m", [when, save.place].filter(Boolean).join(" · ")));
  li.append(card);
  return li;
}

async function savedEvents() {
  const now = new Date().toISOString();
  let events = { EVENTS_URL: null };
  try { events = await import("/assets/events.js?v=b133592880"); } catch {}
  const [saved, data] = await Promise.all([
    select("event_saves", `select=event_id,name,kind,place,starts_at&hidden=is.false&starts_at=gt.${encodeURIComponent(now)}&order=starts_at.asc`).catch(() => []),
    events.EVENTS_URL ? fetch(events.EVENTS_URL).then((r) => (r.ok ? r.json() : { events: [] })).catch(() => ({ events: [] })) : { events: [] },
  ]);
  const all = data.events || [];
  return { saved: Array.isArray(saved) ? saved : [], events: new Map(all.map((ev) => [String(ev.id), ev])) };
}

// ── the list ─────────────────────────────────────────────────────────

let updateRail = () => {};

function render() {
  const query = $("sx-q").value;
  const searching = !!query.trim();
  const shown = groups.map((g) => ({ ...g, routes: matching(g.routes, query) })).filter((g) => g.routes.length);
  $("s-routes").replaceChildren(...shown.map((g) => {
    const section = el("section", "sx-group");
    const head = el("div", "ex-head");
    head.append(el("h2", "", g.title));
    const list = el("ol", "ex-list");
    list.append(...g.routes.map((r) => row(r, routes.indexOf(r))));
    section.append(head, list);
    return section;
  }));
  const events = saves.saved.filter((s) => !searching || matching([s], query).length);
  $("s-events").hidden = !events.length;
  $("s-ev").replaceChildren(...events.map(eventRow));
  finishPictures($("s-ev"));
  updateRail();
  $("sx-none").hidden = !searching || shown.length || events.length;
  if (pointed != null && !document.querySelector(`.ex-row[data-k="${pointed}"]`)) point(null);
}

// ── the map ──────────────────────────────────────────────────────────

function features() {
  return {
    type: "FeatureCollection",
    features: routes.map((r, k) => (lines.get(r.id)?.length > 1 ? { type: "Feature", id: k, properties: { k }, geometry: { type: "LineString", coordinates: lines.get(r.id) } } : null)).filter(Boolean),
  };
}

function starts() {
  return {
    type: "FeatureCollection",
    features: routes.map((r, k) => (Number.isFinite(r.start_lon) && Number.isFinite(r.start_lat) ? { type: "Feature", id: k, properties: { k }, geometry: { type: "Point", coordinates: [r.start_lon, r.start_lat] } } : null)).filter(Boolean),
  };
}

const inView = (r, b) => { const x = boxOf(r); return x && x[2] >= b.getWest() && x[0] <= b.getEast() && x[3] >= b.getSouth() && x[1] <= b.getNorth(); };

/// The lines still to ask for: every one of a short list; else the ones in
/// view, up to MOST_LINES on the map. Asked LINES_AT_ONCE at a time.
async function askLines() {
  if (!map || lines.size >= MOST_LINES) return;
  const b = map.getBounds();
  const want = routes.filter((r) => !lines.has(r.id) && !asking.has(r.id) && (routes.length < ALL_LINES_UNDER || inView(r, b)))
    .slice(0, Math.max(0, MOST_LINES - lines.size));
  for (let i = 0; i < want.length; i += LINES_AT_ONCE) {
    const batch = want.slice(i, i + LINES_AT_ONCE);
    for (const r of batch) asking.add(r.id);
    try {
      const got = await select("routes", `select=id,line:payload->pathGeometry&id=in.(${batch.map((r) => encodeURIComponent(r.id)).join(",")})`);
      for (const r of got || []) lines.set(r.id, thinLine(r.line));
    } catch {}
    for (const r of batch) { asking.delete(r.id); if (!lines.has(r.id)) lines.set(r.id, []); }
    map.getSource("ex-roads")?.setData(features());
    if (pointed != null) map.setFeatureState({ source: "ex-roads", id: pointed }, { on: true });
  }
}

function cardHTML(r, link) {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const inner = `<img src="${esc(pictureOf(r) || NO_PHOTO)}" alt="" onerror="this.src='${NO_PHOTO}'"><span><span class="n">${esc(r.name || "Untitled route")}</span><br>
    <span class="m">${esc(routeLine(r, miles()))}</span><br>
    <span class="go">${link ? "Open the route ›" : "Click to open"}</span></span>`;
  return link ? `<a class="ex-card" href="${esc(hrefOf(r))}">${inner}</a>` : `<div class="ex-card">${inner}</div>`;
}

function point(k, { fromMap = false, sticky = false } = {}) {
  if (pointed === k) return;
  if (pointed != null && map?.getSource("ex-roads")) {
    map.setFeatureState({ source: "ex-roads", id: pointed }, { on: false });
    map.setFeatureState({ source: "ex-mids", id: pointed }, { on: false });
  }
  document.querySelectorAll(".ex-row.on").forEach((a) => a.classList.remove("on"));
  pointed = k;
  popup?.remove();
  popup = null;
  if (k == null || !map?.getSource("ex-roads")) return;
  const r = routes[k];
  map.setFeatureState({ source: "ex-roads", id: k }, { on: true });
  map.setFeatureState({ source: "ex-mids", id: k }, { on: true });
  const row = document.querySelector(`.ex-row[data-k="${k}"]`);
  row?.classList.add("on");
  if (fromMap && row && !phone()) row.scrollIntoView({ block: "nearest" });
  const line = lines.get(r.id);
  const at = line?.length ? line[Math.floor(line.length / 2)] : [r.start_lon, r.start_lat];
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: sticky, offset: 14, className: "ex-pop", maxWidth: "300px" })
    .setLngLat(at).setHTML(cardHTML(r, sticky)).addTo(map);
}

function padding() {
  if (phone()) return { top: 60, bottom: 90, left: 30, right: 30 };
  const panel = document.querySelector(".ex-panel");
  return { top: 70, bottom: 40, left: (panel?.getBoundingClientRect().right || 500) + 30, right: 40 };
}

/// Every saved route in view; none, the US.
function bounds() {
  const boxes = routes.map(boxOf).filter(Boolean);
  if (!boxes.length) return US;
  const b = boxes.reduce((acc, x) => [Math.min(acc[0], x[0]), Math.min(acc[1], x[1]), Math.max(acc[2], x[2]), Math.max(acc[3], x[3])], [180, 90, -180, -90]);
  return [[b[0], b[1]], [b[2], b[3]]];
}

function buildMap() {
  if (!window.maplibregl || map) return;
  map = new maplibregl.Map({ container: "ex-map", style: MAP_STYLE, attributionControl: { compact: true }, bounds: bounds(), fitBoundsOptions: { padding: padding(), maxZoom: 11 }, minZoom: 2, maxZoom: 15 });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("load", () => {
    map.addSource("ex-roads", { type: "geojson", data: features() });
    map.addSource("ex-mids", { type: "geojson", data: starts() });
    addRoadLayers(map, { lines: "ex-roads", dots: "ex-mids" });
    map.addLayer({ id: "ex-hit", type: "line", source: "ex-roads", minzoom: 6, paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0.01 } });
    map.addLayer({ id: "ex-dot-hit", type: "circle", source: "ex-mids", maxzoom: 6, paint: { "circle-radius": 12, "circle-opacity": 0.01 } });
    // The saved events' pins, as Explore's.
    for (const s of saves.saved) {
      const ev = saves.events.get(String(s.event_id));
      if (ev && Number.isFinite(ev.lon) && Number.isFinite(ev.lat)) new maplibregl.Marker({ element: pinElement(ev), anchor: "center" }).setLngLat([ev.lon, ev.lat]).addTo(map);
    }
    for (const layer of ["ex-hit", "ex-dot-hit"]) {
      map.on("mousemove", layer, (event) => {
        if (phone()) return;
        map.getCanvas().style.cursor = "pointer";
        point(event.features[0].properties.k, { fromMap: true });
      });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; if (!phone()) point(null); });
      map.on("click", layer, (event) => {
        const k = event.features[0].properties.k;
        // A computer opens the route; a phone has no pointing, so a tap shows its card first.
        if (phone()) { pointed = null; point(k, { sticky: true }); } else location.href = hrefOf(routes[k]);
      });
    }
    askLines();
  });
  map.on("moveend", () => askLines());
}

// ── wiring ───────────────────────────────────────────────────────────

function wire() {
  const scroll = $("ex-scroll");
  scroll.addEventListener("mouseover", (event) => {
    const row = event.target.closest(".ex-row[data-k]");
    if (row && !phone()) point(Number(row.dataset.k));
  });
  $("s-routes").addEventListener("mouseleave", () => { if (!phone()) point(null); });
  let typing;
  $("sx-q").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(render, 150); });
  const ex = $("ex"), toggle = $("ex-toggle");
  toggle.addEventListener("click", () => {
    const open = !ex.classList.contains("map-open");
    ex.classList.toggle("map-open", open);
    toggle.textContent = open ? "List" : "Map";
    toggle.setAttribute("aria-expanded", String(open));
    if (open) { map?.resize(); map?.fitBounds(bounds(), { padding: padding(), maxZoom: 11, duration: 0 }); } else point(null);
  });
  updateRail = railArrows($("s-ev"), $("s-events-h"));
  window.addEventListener("pageshow", (event) => { if (event.persisted) point(null); });
}

async function start() {
  wire();
  const mapReady = () => (window.maplibregl ? buildMap() : window.addEventListener("load", buildMap, { once: true }));
  if (!(await signedIn())) {
    status("");
    $("s-signin").hidden = false;
    $("s-new").hidden = true;
    $("sx-search").hidden = true;
    $("ex-toggle").hidden = true;
    $("s-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: "/saved/" }));
    mapReady();
    return;
  }
  const query = `select=id,name,distance_meters,duration_seconds,stop_count,updated_at,start_lat,start_lon,min_lat,min_lon,max_lat,max_lon,photo:payload->photo,opened:payload->>shareToken,follows:payload->>followsShareToken&deleted_at=is.null&order=updated_at.desc&limit=${MOST}`;
  const [found, club, tokens, events] = await Promise.all([
    select("routes", query).catch((failure) => failure),
    clubRoutes(),
    fetch("/drives/tokens.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    savedEvents(),
  ]);
  if (found instanceof Error) {
    mapReady();
    return status(found.code === "sign_in" ? "Please sign in again." : "Couldn't load what you saved. Check the connection and reload.");
  }
  routes = Array.isArray(found) ? found : [];
  catalog = tokens;
  saves = events;
  status("");
  groups = savedGroups(routes, club, catalog);
  render();
  const none = !routes.length && !events.saved.length;
  $("s-empty").hidden = !none;
  // One Plan a route: the empty state's, not the top's too.
  $("s-new").hidden = none;
  $("sx-search").hidden = none;
  $("ex-toggle").hidden = !routes.length;
  mapReady();
}

// The tests' look at the map, on this machine only (as the planner's __planner).
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.__saved = { map: () => map, lines: () => [...lines.keys()], drawn: () => map?.getSource("ex-roads")?._data?.features?.length ?? null, lit: (k) => !!map?.getFeatureState({ source: "ex-roads", id: k })?.on };
}

start();
