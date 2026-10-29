// Explore (/drives/): every Carve drive on one map, and a list of the ones
// in view beside it (the user, 2026-10-29). Pointing at a drive, in the list
// or on the map, lights its road and shows its card on the map; clicking it
// opens its page, whose Back comes back here with the list as it was.
//
// The drives are /drives/roads.json (build_area_pages.py write_roads), the
// same lines the planner draws as good roads. The map starts where the
// visitor likely is (where.js); without a guess, the whole map, legends first.
import "/assets/site-bar.js";
import { level, lineOf } from "/plan/good-roads.js";
import { usesMiles } from "/plan/route-wire.js";
import { PLACE_KEY, guessPlace, km, store } from "/assets/where.js";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PHONE = "(max-width: 699px), (max-height: 560px)";
const VIEW_KEY = "carve.explore.view";
const LIST_MAX = 60;
const NO_PHOTO = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110"><rect width="160" height="110" fill="#E3EBDA"/>'
  + '<path d="M18 86C46 30 70 92 98 44c14-24 32-6 44-26" fill="none" stroke="#6A4CFF" stroke-width="6" stroke-linecap="round"/></svg>');

const $ = (id) => document.getElementById(id);
const phone = () => window.matchMedia(PHONE).matches;
const miles = usesMiles(navigator.language || "en-US");
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ── the drives ───────────────────────────────────────────────────────

let roads = [];
let place = null;
let map = null;
let pointed = null;
let popup = null;
const filters = { levels: new Set(), length: "", query: "" };

function prepare(list) {
  list.forEach((road, k) => {
    const line = lineOf(road);
    let west = 180, south = 90, east = -180, north = -90;
    for (const [x, y] of line) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
    road.k = k;
    road.box = [west, south, east, north];
    road.mid = line[Math.floor(line.length / 2)] || [0, 0];
    road.lv = level(road.b);
    road.photo = road.i || NO_PHOTO;
    road.text = `${road.n} ${road.p || ""} ${(road.e || []).join(" ")}`.toLowerCase();
  });
  return list.filter((r) => lineOf(r).length > 1);
}


function lengthText(road) {
  const m = road.m || 0;
  if (!miles) { const k = m * 1.609; return `${k >= 20 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")} km`; }
  return `${m >= 20 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, "")} mi`;
}

function awayText(road) {
  if (!place) return "";
  const d = km([place.lon, place.lat], lineOf(road)[0]);
  const n = miles ? d / 1.609 : d;
  return n < 2 ? "Right by you" : `${Math.round(n)} ${miles ? "mi" : "km"} away`;
}

function passes(road) {
  if (filters.levels.size && !(road.lv && filters.levels.has(road.lv.key))) return false;
  if (filters.length) {
    const [lo, hi] = filters.length.split("-").map(Number);
    if (!(road.m >= lo && road.m < hi)) return false;
  }
  if (filters.query) return filters.query.split(/\s+/).every((word) => road.text.includes(word));
  return true;
}

function inView(road, bounds) {
  const [w, s, e, n] = road.box;
  return e >= bounds.getWest() && w <= bounds.getEast() && n >= bounds.getSouth() && s <= bounds.getNorth();
}

// ── the list ─────────────────────────────────────────────────────────

let shown = [];

function render() {
  const list = $("ex-list");
  const searching = !!filters.query;
  const passing = roads.filter(passes);
  let pool = passing;
  if (map && !searching) pool = pool.filter((r) => inView(r, map.getBounds()));
  const from = place ? [place.lon, place.lat] : map ? map.getCenter().toArray() : [-98, 39];
  // Before it knows where the visitor is, the legendary drives lead, then the twistiest.
  const anywhere = !place && !moved && !searching;
  pool.sort(anywhere ? (a, b) => (b.f || 0) - (a.f || 0) || (b.b || 0) - (a.b || 0)
    : (a, b) => km(from, lineOf(a)[0]) - km(from, lineOf(b)[0]));
  shown = pool.slice(0, LIST_MAX);
  $("ex-title").textContent = searching ? (pool.length ? `${pool.length} ${pool.length === 1 ? "drive" : "drives"} found` : "No drives found")
    : place && !moved ? `Drives near ${place.label || "you"}` : anywhere ? "Legendary drives and more" : "Drives on the map";
  list.innerHTML = shown.map((r) => `<li><a class="ex-row" href="/drives/${encodeURIComponent(r.s)}/" data-k="${r.k}">
    <img src="${escapeHTML(r.photo)}" alt="" loading="lazy">
    <span class="t"><span class="n">${escapeHTML(r.n)}</span>
    <span class="m">${lengthText(r)}${r.lv ? ` · <span class="lv" style="color:${r.lv.colour}">${r.lv.title}</span>` : ""}</span>
    <span class="a">${escapeHTML(awayText(r) || r.p || "")}</span></span></a></li>`).join("")
    || `<li class="ex-empty">${searching ? "Try a road's name, a town or a state." : "No drives here yet. Zoom out, or search a state."}</li>`;
  const more = pool.length - shown.length;
  $("ex-more").hidden = more <= 0;
  $("ex-more").textContent = more > 0 ? `${more} more on the map: zoom in, or narrow it down with the filters.` : "";
  if (map?.getLayer("ex-hidden")) map.setFilter("ex-hidden", ["!", ["in", ["get", "k"], ["literal", passing.map((r) => r.k)]]]);
}

// ── the map ──────────────────────────────────────────────────────────

let moved = false;

function features() {
  return {
    type: "FeatureCollection",
    features: roads.map((r) => ({ type: "Feature", id: r.k, properties: { k: r.k }, geometry: { type: "LineString", coordinates: lineOf(r) } })),
  };
}

function midpoints() {
  return { type: "FeatureCollection", features: roads.map((r) => ({ type: "Feature", id: r.k, properties: { k: r.k }, geometry: { type: "Point", coordinates: r.mid } })) };
}

function cardHTML(r, link) {
  const inner = `<img src="${escapeHTML(r.photo)}" alt=""><span><span class="n">${escapeHTML(r.n)}</span><br>
    <span class="m">${lengthText(r)}${r.lv ? ` · ${r.lv.title}` : ""}${place ? ` · ${escapeHTML(awayText(r))}` : ""}</span><br>
    <span class="go">${link ? "Open the drive ›" : "Click to open"}</span></span>`;
  return link ? `<a class="ex-card" href="/drives/${encodeURIComponent(r.s)}/">${inner}</a>` : `<div class="ex-card">${inner}</div>`;
}

function point(k, { fromMap = false, sticky = false } = {}) {
  if (pointed === k) return;
  if (pointed != null && map) map.setFeatureState({ source: "ex-roads", id: pointed }, { on: false });
  document.querySelectorAll(".ex-row.on").forEach((a) => a.classList.remove("on"));
  pointed = k;
  popup?.remove();
  popup = null;
  if (k == null || !map) return;
  const r = roads[k];
  map.setFeatureState({ source: "ex-roads", id: k }, { on: true });
  const row = document.querySelector(`.ex-row[data-k="${k}"]`);
  row?.classList.add("on");
  if (fromMap && row && !phone()) row.scrollIntoView({ block: "nearest" });
  popup = new maplibregl.Popup({ closeButton: false, closeOnClick: sticky, offset: 14, className: "ex-pop", maxWidth: "300px" })
    .setLngLat(r.mid).setHTML(cardHTML(r, sticky)).addTo(map);
}

function remember() {
  if (!map) return;
  const c = map.getCenter();
  store.set(VIEW_KEY, { lon: c.lng, lat: c.lat, zoom: map.getZoom(), moved, scroll: $("ex-scroll").scrollTop || window.scrollY,
    levels: [...filters.levels], length: filters.length, query: $("ex-q").value }, sessionStorage);
}

function open(k) {
  remember();
  location.href = `/drives/${encodeURIComponent(roads[k].s)}/`;
}

function padding() {
  if (phone()) return { top: 60, bottom: 90, left: 30, right: 30 };
  const panel = document.querySelector(".ex-panel");
  return { top: 70, bottom: 40, left: (panel?.getBoundingClientRect().right || 500) + 30, right: 40 };
}

function fitTo(list, maxZoom = 9) {
  if (!map || !list.length) return;
  const b = list.reduce((acc, r) => [Math.min(acc[0], r.box[0]), Math.min(acc[1], r.box[1]), Math.max(acc[2], r.box[2]), Math.max(acc[3], r.box[3])],
    [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: padding(), maxZoom, duration: 600 });
}

/// Where to look first: the place, with the dozen drives nearest it in view.
function startView(saved) {
  if (saved) return { center: [saved.lon, saved.lat], zoom: saved.zoom };
  if (!place) return { bounds: [[-125, 24], [-66, 50]] };
  const near = [...roads].sort((a, b) => km([place.lon, place.lat], lineOf(a)[0]) - km([place.lon, place.lat], lineOf(b)[0])).slice(0, 12);
  return { near };
}

function buildMap(saved) {
  if (!window.maplibregl) return;
  const view = startView(saved);
  map = new maplibregl.Map({
    container: "ex-map", style: MAP_STYLE, attributionControl: { compact: true },
    center: view.center || [-98, 39], zoom: view.zoom ?? 3.4, minZoom: 2, maxZoom: 15,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.on("load", () => {
    map.addSource("ex-roads", { type: "geojson", data: features() });
    map.addSource("ex-mids", { type: "geojson", data: midpoints() });
    const on = (a, b) => ["case", ["boolean", ["feature-state", "on"], false], a, b];
    map.addLayer({ id: "ex-glow", type: "line", source: "ex-roads", minzoom: 6, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#6A4CFF", "line-width": on(16, 0), "line-blur": 6, "line-opacity": on(0.5, 0) } });
    map.addLayer({ id: "ex-casing", type: "line", source: "ex-roads", minzoom: 6, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff", "line-width": on(9, 6), "line-opacity": 0.9 } });
    map.addLayer({ id: "ex-line", type: "line", source: "ex-roads", minzoom: 6, layout: { "line-join": "round" },
      paint: { "line-color": "#6A4CFF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, on(4, 1.5), 9, on(5, 3)],
        "line-dasharray": ["literal", [2, 1.6]], "line-opacity": on(1, 0.8) } });
    // Under zoom 6 a road is a speck: a dot shows where each drive is.
    map.addLayer({ id: "ex-dots", type: "circle", source: "ex-mids", maxzoom: 6,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, on(6, 3), 6, on(8, 5)], "circle-color": "#6A4CFF",
        "circle-stroke-color": "#fff", "circle-stroke-width": on(2, 1) } });
    // Drives the filters leave out sit under a pale veil, not gone.
    map.addLayer({ id: "ex-hidden", type: "line", source: "ex-roads", minzoom: 6, filter: ["==", ["get", "k"], -1], paint: { "line-color": "#EFEDE6", "line-width": 6, "line-opacity": 0.85 } });
    map.addLayer({ id: "ex-hit", type: "line", source: "ex-roads", minzoom: 6, paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0.01 } });
    map.addLayer({ id: "ex-dot-hit", type: "circle", source: "ex-mids", maxzoom: 6, paint: { "circle-radius": 12, "circle-opacity": 0.01 } });
    if (view.near) fitTo(view.near, 10);
    else if (view.bounds) map.fitBounds(view.bounds, { padding: padding(), duration: 0 });
    render();
    for (const layer of ["ex-hit", "ex-dot-hit"]) {
      map.on("mousemove", layer, (event) => {
        if (phone()) return;
        map.getCanvas().style.cursor = "pointer";
        point(event.features[0].properties.k, { fromMap: true });
      });
      map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; if (!phone()) point(null); });
      map.on("click", layer, (event) => {
        const k = event.features[0].properties.k;
        // A computer opens the drive; a phone has no pointing, so a tap shows its card first.
        if (phone()) { pointed = null; point(k, { sticky: true }); } else open(k);
      });
    }
  });
  let userMove = false;
  map.on("movestart", (event) => { userMove = !!event.originalEvent; });
  map.on("moveend", () => {
    if (userMove) moved = true;
    if (!filters.query) render();
  });
}

// ── wiring ───────────────────────────────────────────────────────────

function setPlace(next) {
  place = next;
  moved = false;
  if (next && !next.guessed) store.set(PLACE_KEY, next);
  const where = $("ex-where");
  where.hidden = !place;
  where.textContent = "Change";
  if (map && place) fitTo(startView(null).near || [], 10);
  render();
}

function wire() {
  const list = $("ex-list");
  list.addEventListener("mouseover", (event) => {
    const row = event.target.closest(".ex-row");
    if (row && !phone()) point(Number(row.dataset.k));
  });
  list.addEventListener("mouseleave", () => { if (!phone()) point(null); });
  list.addEventListener("click", (event) => {
    const row = event.target.closest(".ex-row");
    if (!row || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(Number(row.dataset.k));
  });

  let typing;
  $("ex-q").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => {
      filters.query = $("ex-q").value.trim().toLowerCase();
      render();
      if (filters.query && shown.length) fitTo(roads.filter(passes).slice(0, 300), 10);
    }, 180);
  });
  document.querySelectorAll(".ex-chip").forEach((chip) => chip.addEventListener("click", () => {
    const key = chip.dataset.level;
    filters.levels.has(key) ? filters.levels.delete(key) : filters.levels.add(key);
    chip.setAttribute("aria-pressed", String(filters.levels.has(key)));
    render();
  }));
  $("ex-length").addEventListener("change", (event) => { filters.length = event.target.value; render(); });

  const locate = () => {
    if (!navigator.geolocation) return;
    $("ex-locate").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (at) => { $("ex-locate").disabled = false; setPlace({ lat: at.coords.latitude, lon: at.coords.longitude, label: "you" }); },
      () => { $("ex-locate").disabled = false; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  };
  $("ex-locate").addEventListener("click", locate);
  $("ex-where").addEventListener("click", () => { $("ex-q").focus(); $("ex-q").placeholder = "Search a town, road or state"; });

  const ex = $("ex"), toggle = $("ex-toggle");
  toggle.addEventListener("click", () => {
    const open = !ex.classList.contains("map-open");
    ex.classList.toggle("map-open", open);
    toggle.textContent = open ? "List" : "Map";
    toggle.setAttribute("aria-expanded", String(open));
    if (open) map?.resize();
    else point(null);
  });
  window.addEventListener("pagehide", remember);
  // Back from a drive restores this page as it was; the card it was opened from can go.
  window.addEventListener("pageshow", (event) => { if (event.persisted) point(null); });
}

async function main() {
  wire();
  const saved = store.get(VIEW_KEY, sessionStorage);
  if (saved) {
    filters.levels = new Set(saved.levels || []);
    filters.length = saved.length || "";
    filters.query = (saved.query || "").trim().toLowerCase();
    $("ex-q").value = saved.query || "";
    $("ex-length").value = filters.length;
    document.querySelectorAll(".ex-chip").forEach((c) => c.setAttribute("aria-pressed", String(filters.levels.has(c.dataset.level))));
    moved = !!saved.moved;
  }
  const [data, guess] = await Promise.all([
    fetch("/drives/roads.json").then((r) => r.json()).catch(() => []),
    guessPlace(),
  ]);
  roads = prepare(data);
  place = guess;
  $("ex-where").hidden = !place;
  $("ex-where").textContent = "Change";
  render();
  const start = () => buildMap(saved);
  if (window.maplibregl) start(); else window.addEventListener("load", start, { once: true });
  if (saved?.scroll) requestAnimationFrame(() => { $("ex-scroll").scrollTop = saved.scroll; if (phone()) window.scrollTo(0, saved.scroll); });
}

main();
