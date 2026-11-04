// The home page, signed in (the user, 2026-11-04): a light page built to get
// the app, with planning a drive the way in when they won't, then their own
// things, the roads and the events near them. Every module is always there;
// sign-up's answer (carve.intents, profile_intents) only changes the
// order after the app: invited → their drives, organize → plan, events →
// events, roads → roads, in that order of weight when they picked several.
import { level, lineOf } from "/plan/good-roads.js";
import { usesMiles } from "/plan/route-wire.js";
import { guessPlace, km } from "/assets/where.js";
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL, accessToken, store } from "/assets/carve-session.js";
import { heartButton, wireHearts } from "/assets/hearts.js";

const LIGHT_DEVICE = !window.matchMedia("(prefers-color-scheme: dark)").matches;
const MAP_STYLE = LIGHT_DEVICE ? "https://tiles.openfreemap.org/styles/liberty" : "/assets/map-dark.json?v=3";
const PHONE = "(max-width: 899px), (max-height: 500px) and (pointer: coarse)";
const INTENTS_KEY = "carve.intents";
const WEIGHT = ["invited", "organize", "events", "roads"];
const LEADS = { invited: "mine", organize: "plan", events: "events", roads: "roads" };
const ORDER = ["app", "plan", "mine", "roads", "events"];
const NO_PHOTO = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#E3EBDA"/>'
  + '<path d="M18 92C46 36 70 98 98 50c14-24 32-6 44-26" fill="none" stroke="#6A4CFF" stroke-width="6" stroke-linecap="round"/></svg>');

const $ = (id) => document.getElementById(id);
const phone = () => window.matchMedia(PHONE).matches;
const miles = usesMiles(navigator.language || "en-US");
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let place = null;
let roads = [];

/// The account's own, read as it: an object, or null when Carve says no.
async function mine(path, { method = "GET", body, count = false } = {}) {
  const token = await accessToken();
  if (!token) return null;
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(count ? { Prefer: "count=exact", Range: "0-0" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!response?.ok) return null;
  if (count) return Number((response.headers.get("content-range") || "").split("/")[1]) || 0;
  return response.json();
}

// ── the order: the app first, then what brought them ────────────────

function intents() {
  try {
    const list = JSON.parse(localStorage.getItem(INTENTS_KEY) || "null");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/// Another device's answer, when this browser has none (profile_intents, 0053; kept here once read).
async function savedIntents() {
  const session = store.get(SESSION_KEY);
  const rows = await mine(`/rest/v1/profile_intents?select=intents&id=eq.${String(session?.user?.id || "").toLowerCase()}`);
  const list = rows?.[0]?.intents;
  if (!Array.isArray(list)) return;
  try { localStorage.setItem(INTENTS_KEY, JSON.stringify(list)); } catch {}
  arrange();
}

function arrange() {
  const picked = WEIGHT.filter((w) => intents().includes(w)).map((w) => LEADS[w]);
  const order = ["app", ...picked, ...ORDER.filter((m) => m !== "app" && !picked.includes(m))];
  for (const module of document.querySelectorAll("#me [data-mod]")) module.style.order = String(order.indexOf(module.dataset.mod));
}

// ── the app ─────────────────────────────────────────────────────────

async function greet() {
  const session = store.get(SESSION_KEY);
  const rows = await mine(`/rest/v1/profiles?id=eq.${String(session?.user?.id || "").toLowerCase()}&select=display_name,username`);
  const first = String(rows?.[0]?.display_name || "").trim().split(/\s+/)[0];
  $("me-title").textContent = first ? `${first}, you're ready to drive with Carve.` : "You're ready to drive with Carve.";
}

// ── plan a drive: the good roads around them, on a small map ─────────

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/plan/vendor/maplibre-gl.css" });
  document.head.appendChild(css);
  return new Promise((done, fail) => {
    const tag = Object.assign(document.createElement("script"), { src: "/plan/vendor/maplibre-gl.js", onload: done, onerror: fail });
    document.head.appendChild(tag);
  });
}

async function drawMap() {
  try { await loadMapLibre(); } catch { return; }
  const near = nearest(25);
  const box = near.map((r) => lineOf(r)).flat()
    .reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [180, 90, -180, -90]);
  const map = new maplibregl.Map({
    container: "me-map", style: MAP_STYLE, interactive: false, attributionControl: { compact: true },
    bounds: place && near.length ? [[box[0], box[1]], [box[2], box[3]]] : [[-125, 25], [-67, 49]], fitBoundsOptions: { padding: 24, maxZoom: 9 },
  });
  map.on("load", () => {
    map.addSource("me-roads", { type: "geojson", data: {
      type: "FeatureCollection",
      features: near.map((r) => ({ type: "Feature", properties: { c: r.lv?.colour || "#6A4CFF" }, geometry: { type: "LineString", coordinates: lineOf(r) } })),
    } });
    map.addLayer({ id: "me-casing", type: "line", source: "me-roads", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 6 } });
    map.addLayer({ id: "me-line", type: "line", source: "me-roads", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "c"], "line-width": 3.5 } });
  });
  $("me-map-label").textContent = place && place.label !== "you" ? `Good roads around ${place.label}` : "Good roads near you";
}

/// Plan a drive: the planner on a computer; on a phone, the app (the web planner is for big screens).
function wirePlan() {
  $("me-plan").addEventListener("click", (event) => {
    if (!phone()) return;
    event.preventDefault();
    $("me-plan-sheet").showModal();
  });
  $("me-plan-sheet").addEventListener("click", (event) => {
    if (event.target === $("me-plan-sheet") || event.target.closest("[data-close]")) $("me-plan-sheet").close();
  });
}

// ── their own: upcoming drives, saved routes, saved events ───────────

async function counts(events) {
  const now = new Date().toISOString();
  const [plans, routes, saved] = await Promise.all([
    mine("/rest/v1/rpc/plans_mine", { method: "POST", body: {} }),
    mine("/rest/v1/routes?select=id&deleted_at=is.null", { count: true }),
    events ? mine(`/rest/v1/event_saves?select=event_id&hidden=is.false&starts_at=gt.${encodeURIComponent(now)}`, { count: true }) : null,
  ]);
  $("me-n-plans").textContent = Array.isArray(plans) ? String(plans.length) : "0";
  $("me-n-routes").textContent = String(routes ?? 0);
  $("me-t-events").hidden = !events;
  if (events) $("me-n-events").textContent = String(saved ?? 0);
}

// ── the roads near them ──────────────────────────────────────────────

function lengthText(r) {
  const n = miles ? (r.m || 0) : (r.m || 0) * 1.609;
  return `${n >= 20 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, "")} ${miles ? "mi" : "km"}`;
}

function nearest(count) {
  if (!place) return roads.filter((r) => r.f).sort((a, b) => (b.b || 0) - (a.b || 0)).slice(0, count);
  const at = [place.lon, place.lat];
  const ranked = [...roads].sort((a, b) => km(at, lineOf(a)[0]) - km(at, lineOf(b)[0])).slice(0, count * 3);
  const pictured = ranked.filter((r) => r.i);
  return (pictured.length >= count ? pictured : ranked).slice(0, count);
}

const BIG_PHOTO = /^\/assets\/drives\/[a-z0-9-]+\.jpg$/;
function photoHTML(src) {
  const img = `<img src="${escapeHTML(src || NO_PHOTO)}" alt="" loading="lazy" decoding="async">`;
  if (!BIG_PHOTO.test(src || "")) return img;
  const base = src.slice(0, -4);
  return `<picture class="pic"><source type="image/avif" srcset="${base}.w640.avif 640w, ${base}.w1280.avif 1280w" sizes="(max-width: 899px) 78vw, 300px">${img}</picture>`;
}

function renderRoads() {
  const picks = nearest(8);
  const where = place && place.label !== "you" ? place.label : "you";
  $("me-roads-title").textContent = `Roads near ${where}`;
  $("me-roads").innerHTML = picks.map((r) => `<li><a href="/drives/${encodeURIComponent(r.s)}/">
    <span class="ph">${photoHTML(r.i)}</span>
    <span class="t"><span class="n">${escapeHTML(r.n)}</span>
    <span class="m">${lengthText(r)}${r.lv ? ` · <span class="lv" style="color:${r.lv.colour}">${r.lv.title}</span>` : ""}</span></span></a>
    ${r.t ? heartButton(r.t, r.n) : ""}</li>`).join("")
    + `<li class="me-all"><a href="/drives/">See all roads near ${escapeHTML(where)} ›</a></li>`;
  wireHearts($("me-roads"), { onSaved: (on, problem) => say(problem || (on ? "Saved. You'll find this road in Carve." : "Removed from My Drives.")) });
}

let sayTimer = 0;
function say(text) {
  const note = $("me-note");
  note.textContent = text;
  note.hidden = false;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { note.hidden = true; }, 3500);
}

// ── the events near them: once the site has its events (events.js) ───

async function renderEvents() {
  let events;
  try {
    events = await import("/assets/events.js");
  } catch {
    return false;
  }
  if (!document.querySelector('link[href^="/assets/events.css"]')) {
    document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/assets/events.css" }));
  }
  const list = await events.loadEvents();
  let near = place ? events.nearby(list, place, { days: 30, maxKm: 160, count: 10 }) : [];
  if (place && !near.length) near = events.nearby(list, place, { days: 30, maxKm: 320, count: 10 });
  // Every module is always there (the user): none near them, the soonest anywhere.
  const anywhere = !near.length;
  if (anywhere) near = list.filter((ev) => events.within(ev, 30)).sort((a, b) => events.nextOn(a).start - events.nextOn(b).start).slice(0, 10);
  const where = place && place.label !== "you" ? place.label : "you";
  $("me-events-title").textContent = anywhere ? "Car events coming up" : `Events near ${where}`;
  $("me-events").innerHTML = near.map((ev) => `<li>${events.cardHTML(ev, place)}</li>`).join("")
    + `<li class="me-all"><a href="/events/">${anywhere ? "See all events" : `See all events near ${escapeHTML(where)}`} ›</a></li>`;
  events.finishPictures($("me-events"));
  $("me-events-mod").hidden = false;
  return true;
}

// ── start ────────────────────────────────────────────────────────────

/// Draws the signed-in home; false when the sign-in is gone (the page then shows the public home).
export async function startSignedHome() {
  if (!(await accessToken())) return false;
  $("me").hidden = false;
  arrange();
  try { if (localStorage.getItem(INTENTS_KEY) === null) savedIntents(); } catch {}
  wirePlan();
  greet();
  const [data, guess] = await Promise.all([
    fetch("/drives/roads.json").then((r) => r.json()).catch(() => []),
    guessPlace(),
  ]);
  roads = data.map((r, k) => Object.assign(r, { k, lv: level(r.b) })).filter((r) => lineOf(r).length > 1);
  place = guess;
  renderRoads();
  drawMap();
  const events = await renderEvents();
  counts(events);
  return true;
}
