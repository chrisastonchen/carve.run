// carve.run/plan: plan a drive on a big screen, save it to your Carve
// account, and open it on your phone by link or QR code (2026-10-29, for
// car clubs whose planners plan tours on computers).
//
// Planning needs no account. Everything that costs money (places, roads,
// map matching, elevation) goes through Carve's `planner` function, which
// holds the Mapbox key and a daily budget, so no key ever lives in web/.
// The map itself is MapLibre on OpenFreeMap's tiles, which need no key.
// Saving writes the `routes` row and its `shares` row straight to the
// backend with the planner's own sign-in, exactly as the apps' sync does,
// so carve.run/<token> opens the same road in every live build.
//
// Built to work with content blockers and with storage switched off: no
// analytics or third-party scripts (MapLibre and the QR code are served
// from carve.run), and anything kept in browser storage falls back to
// memory for the tab.
import {
  MAX_WAYPOINTS, MAX_STOPS, MOST_NAME_CHARACTERS, MOST_LABEL_CHARACTERS,
  appleDate, newShareToken, newUUID, routePayload, routeRow, markerLabels,
  usesMiles, formatDistance, formatDuration, linkKind, readGPX, turnKind, clip,
} from "./route-wire.js";

const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
/// On a local preview (scripts/plan-tests/dev-server.mjs) the functions are
/// served next to the page, so it can be tried before they're deployed.
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const FUNCTIONS = LOCAL ? `${location.origin}/functions/v1` : `${SUPABASE_URL}/functions/v1`;
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const SITE = "https://carve.run";
const APP_STORE = "https://apps.apple.com/app/carve-route-planner/id6808087716";

/// Typing pauses this long before a search goes out, and three letters
/// come first: a lookup per keystroke would spend the day's budget.
const SEARCH_DELAY_MS = 300;
const SEARCH_MIN_CHARS = 3;
/// Edits settle this long before the road is asked for again.
const ROUTE_DELAY_MS = 350;
const HISTORY_LIMIT = 60;
/// Road chips keep this far from pins and from each other, in pixels.
const CHIP_CLEARANCE = 44;
const STAY_CHOICES = [15, 30, 45, 60, 90, 120];

const $ = (id) => document.getElementById(id);
const miles = usesMiles(navigator.language);
const isAndroid = /android/i.test(navigator.userAgent || "");

// ── storage that may be switched off ─────────────────────────────────

const memory = new Map();
let storageWorks = true;
const store = {
  get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      storageWorks = false;
      return memory.get(key) ?? null;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      storageWorks = false;
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      storageWorks = false;
    }
  },
};
const DRAFT_KEY = "carve.plan.draft";
const SESSION_KEY = "carve.plan.session";
const PENDING_SAVE_KEY = "carve.plan.pending-save";

// ── state ────────────────────────────────────────────────────────────

/// One place on the route: { id, lat, lon, label, type?, stayMinutes? }.
function blankPlan() {
  return {
    id: null, token: null, createdAt: null, ownerId: null,
    name: "", start: null, end: null, waypoints: [],
    trip: "oneWay", style: "balanced",
    path: null, roads: [], frozen: false, imported: null,
    elevationProfile: null, blurb: null, profile: null,
  };
}
let plan = blankPlan();
let session = null;
let profile = null;
let saved = false;
const history = { back: [], forward: [] };

function snapshot() {
  const { start, end, waypoints, trip, path, roads, frozen } = plan;
  return JSON.stringify({ start, end, waypoints, trip, path, roads, frozen });
}
function remember() {
  history.back.push(snapshot());
  if (history.back.length > HISTORY_LIMIT) history.back.shift();
  history.forward.length = 0;
}
function restore(json) {
  Object.assign(plan, JSON.parse(json));
  plan.elevationProfile = null;
  plan.blurb = null;
  changed({ reroute: !plan.frozen, record: false });
}
function undo() {
  if (!history.back.length) return;
  history.forward.push(snapshot());
  restore(history.back.pop());
}
function redo() {
  if (!history.forward.length) return;
  history.back.push(snapshot());
  restore(history.forward.pop());
}

const loops = () => plan.trip === "roundTrip" || plan.trip === "outAndBack";
const stopCount = () => plan.waypoints.filter((w) => w.type === "stop").length;
const routable = () => plan.start && (loops() ? plan.waypoints.length > 0 : plan.end);

/// Every edit goes through here: remembered for undo, the frozen road let
/// go when the geometry moved (FR-7: an edit re-routes), the draft kept.
function edit(fn, { geometry = true } = {}) {
  remember();
  fn();
  if (geometry) {
    plan.frozen = false;
    plan.elevationProfile = null;
    plan.blurb = null;
  }
  changed({ reroute: geometry });
}
function changed({ reroute = false, record = true } = {}) {
  if (record) saveDraft();
  render();
  if (reroute) scheduleRoute();
}

let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => store.set(DRAFT_KEY, { plan, saved }), 250);
}

// ── network ──────────────────────────────────────────────────────────

class Failure extends Error {}

async function planner(action, body = {}) {
  let response;
  try {
    response = await fetch(`${FUNCTIONS}/planner`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Failure(data.error || "Something went wrong. Try again.");
  return data;
}

async function rest(path, { method = "GET", body, headers = {} } = {}) {
  const token = await accessToken();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token || SUPABASE_KEY}`,
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!response.ok) {
    const failure = new Failure(friendlyRestError(response.status, data));
    failure.status = response.status;
    failure.data = data;
    throw failure;
  }
  return data;
}

function friendlyRestError(status, data) {
  const code = data?.code;
  if (code === "54000") return "Your account is at its limit for saved routes. Delete a few in the app and try again.";
  if (status === 401 || status === 403) return "Please sign in again.";
  return data?.msg || data?.message || data?.error_description || "Couldn't save. Try again.";
}

// ── auth (GoTrue over plain fetch) ───────────────────────────────────

function keepSession(data) {
  if (!data?.access_token) return;
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user?.id, email: data.user?.email },
  };
  store.set(SESSION_KEY, session);
}

async function accessToken() {
  if (!session) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!response.ok) throw new Error();
    keepSession(await response.json());
    return session.access_token;
  } catch {
    signedOut();
    return null;
  }
}

async function auth(path, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw new Failure("Too many tries. Wait a minute and try again.");
    if (path === "verify") throw new Failure("That code didn't work. Check it, or send a new one.");
    throw new Failure(data.msg || data.error_description || "Couldn't send the code. Check the address.");
  }
  return data;
}

async function loadProfile() {
  if (!session?.user?.id) return null;
  const rows = await rest(`/rest/v1/profiles?id=eq.${session.user.id.toLowerCase()}&select=id,username,avatar_url`);
  profile = rows?.[0] || null;
  renderWho();
  return profile;
}

function signedOut() {
  session = null;
  profile = null;
  store.remove(SESSION_KEY);
  renderWho();
}

/// Back from Apple or Google: GoTrue puts the session in the fragment.
async function readOAuthReturn() {
  if (!location.hash.includes("access_token=")) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  history_replace();
  const access = params.get("access_token");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${access}` } });
  if (!response.ok) return false;
  const user = await response.json();
  keepSession({
    access_token: access,
    refresh_token: params.get("refresh_token"),
    expires_at: Number(params.get("expires_at")) || undefined,
    expires_in: Number(params.get("expires_in")) || 3600,
    user,
  });
  return true;
}
function history_replace() {
  try {
    window.history.replaceState(null, "", location.pathname + location.search);
  } catch {}
}

// ── the map ──────────────────────────────────────────────────────────

let map = null;
let mapReady = false;
const pins = [];
let chips = [];
let tempPin = null;

function webglWorks() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function panelRight() {
  const box = $("panel").getBoundingClientRect();
  return box.right + 16;
}
function fitPadding() {
  return { top: 70, bottom: 70, right: 80, left: Math.round(panelRight()) + 30 };
}

function setUpMap() {
  if (!window.maplibregl || !webglWorks()) {
    $("no-map").hidden = false;
    return;
  }
  map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: [-98.5, 39.5],
    zoom: 3.6,
    attributionControl: { compact: false },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addSource("route", { type: "geojson", data: emptyLine() });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 11 } }, firstLabel);
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2E92FF", "line-width": 6 } }, firstLabel);
    mapReady = true;
    drawRoute();
    drawPins();
    if (routable()) fitRoute();
  });
  map.on("click", onMapClick);
  map.on("moveend", placeChips);
  map.on("movestart", closeClickMenu);
}

const emptyLine = () => ({ type: "FeatureCollection", features: [] });

function drawRoute() {
  if (!mapReady) return;
  const line = plan.path?.geometry?.length ? plan.path.geometry : chainLine();
  map.getSource("route").setData(line.length >= 2
    ? { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} }
    : emptyLine());
  map.setPaintProperty("route-line", "line-dasharray", plan.path ? null : ["literal", [1.5, 1.5]]);
  placeChips();
}

/// Straight lines between the points while the road is on its way.
function chainLine() {
  const points = [plan.start, ...plan.waypoints, loops() ? plan.start : plan.end].filter(Boolean);
  return points.map((p) => [p.lon, p.lat]);
}

function pinElement(kind, label) {
  const el = document.createElement("div");
  el.className = `pin ${kind}`;
  if (label) el.textContent = label;
  el.addEventListener("click", (event) => event.stopPropagation());
  return el;
}

function drawPins() {
  if (!mapReady) return;
  for (const marker of pins) marker.remove();
  pins.length = 0;
  const labels = markerLabels(plan.waypoints);
  const add = (point, kind, label, onMove, title) => {
    const el = pinElement(kind, label);
    el.title = title;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([point.lon, point.lat]).addTo(map);
    marker.on("dragend", () => {
      const { lng, lat } = marker.getLngLat();
      edit(() => onMove(round(lat), round(lng)));
      if (kind === "stop" || kind === "start" || kind === "dest") nameSpot(point);
    });
    pins.push(marker);
  };
  if (plan.start) add(plan.start, "start", "", (lat, lon) => Object.assign(plan.start, { lat, lon, label: plan.start.label }), "Start: drag to move");
  plan.waypoints.forEach((w, i) => add(w, w.type === "stop" ? "stop" : "wp", labels[i], (lat, lon) => Object.assign(w, { lat, lon, road: null }), w.type === "stop" ? "Stop: drag to move" : "Waypoint: drag to move"));
  if (plan.end && !loops()) add(plan.end, "dest", "", (lat, lon) => Object.assign(plan.end, { lat, lon }), "Destination: drag to move");
}

const round = (n) => Math.round(n * 1e6) / 1e6;

function fitRoute() {
  if (!mapReady) return;
  const line = plan.path?.geometry?.length ? plan.path.geometry : chainLine();
  if (!line.length) return;
  if (line.length === 1) {
    map.easeTo({ center: line[0], zoom: 11, padding: fitPadding() });
    return;
  }
  const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
  map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 13, duration: 600 });
}

/// Whether the whole road shows beside the panel; if not, the map moves.
function routeInView() {
  if (!mapReady || !plan.path?.geometry?.length) return true;
  const box = map.getContainer().getBoundingClientRect();
  const left = panelRight() - box.left;
  return plan.path.geometry.every((c, i) => {
    if (i % 20) return true;
    const p = map.project(c);
    return p.x > left && p.x < box.width && p.y > 0 && p.y < box.height;
  });
}

/// Road names along the line, where they don't sit on a pin, each other
/// or the panel: roads driven a mile or more, named by the planner.
function placeChips() {
  for (const chip of chips) chip.remove();
  chips = [];
  if (!mapReady || !plan.path?.geometry?.length || !plan.roads?.length) return;
  const taken = pins.map((p) => map.project(p.getLngLat()));
  const leftEdge = panelRight();
  const box = map.getContainer().getBoundingClientRect();
  const byLength = [...plan.roads].sort((a, b) => b.meters - a.meters);
  for (const road of byLength) {
    const mid = plan.path.geometry[Math.floor((road.from + road.to) / 2)];
    if (!mid) continue;
    const at = map.project(mid);
    if (at.x < leftEdge - box.left + 40 || at.x > box.width - 60 || at.y < 30 || at.y > box.height - 50) continue;
    if (taken.some((p) => Math.hypot(p.x - at.x, p.y - at.y) < CHIP_CLEARANCE * 1.6)) continue;
    taken.push(at);
    const el = document.createElement("span");
    el.className = "road-chip";
    el.textContent = road.name;
    el.setAttribute("aria-hidden", "true");
    chips.push(new maplibregl.Marker({ element: el }).setLngLat(mid).addTo(map));
    if (chips.length >= 8) break;
  }
}

// ── clicking the map: a small menu, the likeliest choice first ───────

let menuAt = null;
function onMapClick(event) {
  if (saved) return;
  const { lng, lat } = event.lngLat;
  menuAt = { lat: round(lat), lon: round(lng) };
  const choices = [
    { key: "start", label: "Start here", icon: '<i class="k-start" style="width:14px;height:14px;border-radius:50%;background:var(--start)"></i>' },
    { key: "stop", label: "Add a stop", icon: '<i style="width:14px;height:14px;border-radius:50%;background:var(--stop)"></i>' },
    { key: "wp", label: "Add a waypoint", icon: '<i style="width:12px;height:12px;border-radius:50%;background:var(--wp);margin:0 1px"></i>' },
  ];
  if (!loops()) choices.push({ key: "end", label: "End here", icon: '<i style="width:14px;height:14px;border-radius:4px;background:var(--ink)"></i>' });
  const likeliest = !plan.start ? "start" : !plan.end && !loops() ? "end" : "wp";
  choices.sort((a, b) => (a.key === likeliest ? -1 : b.key === likeliest ? 1 : 0));
  const menu = $("click-menu");
  menu.innerHTML = "";
  choices.forEach((choice, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.innerHTML = `${choice.icon}<span>${choice.label}</span>`;
    if (i === 0) button.classList.add("on");
    button.addEventListener("click", () => {
      closeClickMenu();
      placeAt(choice.key, menuAt);
    });
    menu.append(button);
  });
  const point = event.point;
  const box = map.getContainer().getBoundingClientRect();
  menu.style.left = `${Math.min(point.x + 18, box.width - 240)}px`;
  menu.style.top = `${Math.max(12, Math.min(point.y - 110, box.height - 230))}px`;
  menu.hidden = false;
  tempPin?.remove();
  tempPin = new maplibregl.Marker({ element: pinElement("temp", "") }).setLngLat([lng, lat]).addTo(map);
  menu.querySelector("button").focus();
}

function closeClickMenu() {
  $("click-menu").hidden = true;
  tempPin?.remove();
  tempPin = null;
}

function placeAt(kind, at) {
  const spot = { id: newUUID(() => crypto.randomUUID()), lat: at.lat, lon: at.lon, label: null };
  if (kind === "start") edit(() => (plan.start = spot));
  else if (kind === "end") edit(() => (plan.end = spot));
  else {
    if (plan.waypoints.length >= MAX_WAYPOINTS) return toast(`A route holds up to ${MAX_WAYPOINTS} stops and waypoints.`, true);
    let type = kind === "stop" ? "stop" : "marker";
    if (type === "stop" && stopCount() >= MAX_STOPS) {
      type = "marker";
      toast(`A route has up to ${MAX_STOPS} stops, so this is a waypoint.`);
    }
    edit(() => plan.waypoints.splice(bestSlot(spot), 0, { ...spot, type }));
  }
  if (kind !== "wp") nameSpot(spot);
}

/// Where a new point adds the least distance to the chain.
function bestSlot(p) {
  const chain = [plan.start, ...plan.waypoints, loops() ? plan.start : plan.end];
  if (!plan.start) return 0;
  if (!chain[chain.length - 1]) return plan.waypoints.length;
  let best = plan.waypoints.length;
  let cost = Infinity;
  for (let i = 0; i < chain.length - 1; i++) {
    const added = meters(chain[i], p) + meters(p, chain[i + 1]) - meters(chain[i], chain[i + 1]);
    if (added < cost) {
      cost = added;
      best = i;
    }
  }
  return best;
}

function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/// A place clicked on the map gets a name to show in the list.
async function nameSpot(spot) {
  try {
    const { name } = await planner("reverse", { at: { lat: spot.lat, lon: spot.lon } });
    const target = [plan.start, plan.end, ...plan.waypoints].find((p) => p && p.id === spot.id);
    if (target && name) {
      target.label = clip(name, MOST_LABEL_CHARACTERS);
      changed();
    }
  } catch {
    // Unnamed is fine: the row says what it is.
  }
}

// ── routing ──────────────────────────────────────────────────────────

let routeTimer = 0;
let routeAsk = 0;
function scheduleRoute() {
  clearTimeout(routeTimer);
  plan.path = null;
  plan.roads = [];
  drawRoute();
  renderFigures();
  if (!routable()) return;
  routeTimer = setTimeout(route, ROUTE_DELAY_MS);
}

async function route() {
  const ask = ++routeAsk;
  const end = loops() ? plan.start : plan.end;
  try {
    const result = await planner("route", {
      start: { lat: plan.start.lat, lon: plan.start.lon },
      end: { lat: end.lat, lon: end.lon },
      waypoints: plan.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
      style: plan.style || "balanced",
      trip: plan.trip,
      avoids: [],
    });
    if (ask !== routeAsk) return;
    plan.path = result.path;
    plan.roads = result.roads || [];
    nameWaypointsByRoad();
    saveDraft();
    render();
    if (!routeInView()) fitRoute();
  } catch (failure) {
    if (ask !== routeAsk) return;
    toast(failure.message, true);
  }
}

/// A waypoint with no name of its own is called by the road it sits on.
function nameWaypointsByRoad() {
  const line = plan.path?.geometry;
  if (!line?.length || !plan.roads?.length) return;
  for (const w of plan.waypoints) {
    if (w.label || w.type === "stop") continue;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < line.length; i += 1) {
      const d = (line[i][0] - w.lon) ** 2 + (line[i][1] - w.lat) ** 2;
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    const road = plan.roads.find((r) => r.from <= nearest && nearest <= r.to);
    w.road = road?.name || null;
  }
}

// ── the list ─────────────────────────────────────────────────────────

let adding = false;
let focusAfterRender = null;

function render() {
  const hasAny = !!(plan.start || plan.end || plan.waypoints.length);
  $("intro").hidden = hasAny;
  $("bring").hidden = hasAny;
  $("map-hint").hidden = hasAny || saved || !map;
  $("legend").hidden = !hasAny || !map;
  $("undo").disabled = !history.back.length;
  $("redo").disabled = !history.forward.length;
  $("trip").value = plan.trip;
  if (document.activeElement !== $("route-name")) $("route-name").value = plan.name || "";
  renderNotice();
  renderRows();
  renderFigures();
  drawRoute();
  drawPins();
  $("save").disabled = !plan.path;
  $("save").textContent = plan.id ? "Save changes" : "Save and get the link";
}

function renderNotice() {
  const shown = !!plan.imported && !plan.imported.dismissed;
  $("import-notice").hidden = !shown;
  if (!shown) return;
  $("import-title").textContent = `Imported from ${plan.imported.source}`;
  $("import-detail").textContent = plan.imported.matched
    ? `Matched to its roads · ${plan.imported.turns} turns`
    : "Some of it couldn't be matched to roads, so it's drawn as it was";
}

function renderFigures() {
  const distance = plan.path ? formatDistance(plan.path.distanceMeters, miles) : null;
  $("fig-dist").textContent = distance ? distance.value : "–";
  $("fig-dist-unit").textContent = distance ? distance.unit : miles ? "miles" : "km";
  const stays = plan.waypoints.reduce((sum, w) => sum + (w.type === "stop" ? w.stayMinutes || 0 : 0), 0);
  $("fig-time").textContent = plan.path ? formatDuration(plan.path.durationSeconds + stays * 60) : "–";
  const stops = stopCount();
  $("fig-stops").textContent = String(stops);
  $("fig-stops-unit").textContent = stops === 1 ? "stop" : "stops";
}

function renderRows() {
  const list = $("rows");
  list.innerHTML = "";
  const labels = markerLabels(plan.waypoints);
  list.append(placeRow({ role: "start", point: plan.start, placeholder: "Choose a start" }));
  plan.waypoints.forEach((w, i) => list.append(placeRow({ role: "waypoint", point: w, index: i, label: labels[i] })));
  list.append(addRow());
  if (loops()) {
    const li = el("li", "row dest");
    li.append(el("span", "badge dest"), textCell(plan.trip === "outAndBack" ? "Back the same way to the start" : "Back to the start"));
    list.append(li);
  } else {
    list.append(placeRow({ role: "end", point: plan.end, placeholder: "Choose a destination" }));
  }
  $("rows-hint").textContent = plan.start ? "Drag a row to reorder." : "Or click the map.";
  if (focusAfterRender) {
    const target = list.querySelector(focusAfterRender);
    focusAfterRender = null;
    target?.focus();
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function textCell(text) {
  const cell = el("div", "cell");
  cell.append(el("span", "dim", text));
  cell.style.minHeight = "46px";
  cell.style.justifyContent = "center";
  return cell;
}

function rowName(point, role) {
  if (!point) return "";
  if (point.label) return point.label;
  if (role === "waypoint") return point.type === "stop" ? "Stop" : point.road || "Waypoint";
  return role === "start" ? "Start" : "Destination";
}

function placeRow({ role, point, index, label, placeholder }) {
  const li = el("li", `row${role === "end" ? " dest" : ""}`);
  li.dataset.role = role;
  if (index !== undefined) li.dataset.index = String(index);
  if (role === "start") li.append(el("span", "badge start"));
  else if (role === "end") li.append(el("span", "badge dest"));
  else li.append(el("span", `badge ${point.type === "stop" ? "stop" : "wp"}`, label));

  const cell = el("div", "cell");
  const wrap = el("span", "input-wrap");
  const input = el("input", `row-input${point ? "" : " empty"}`);
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = rowName(point, role);
  input.placeholder = placeholder || "Search for a place";
  input.setAttribute("aria-label", role === "start" ? "Start" : role === "end" ? "Destination" : `${point.type === "stop" ? "Stop" : "Waypoint"} ${label}`);
  input.dataset.focus = role === "waypoint" ? `w${index}` : role;
  wrap.append(input);
  if (point) {
    const clear = el("button", "clear", "×");
    clear.type = "button";
    clear.setAttribute("aria-label", "Remove");
    clear.title = "Remove";
    clear.addEventListener("click", () => removePoint(role, index));
    wrap.append(clear);
  }
  cell.append(wrap);
  if (role === "waypoint") cell.append(kindRow(point, index));
  li.append(cell);
  attachSearch(li, input, (place) => choosePlace(role, index, place));

  const grip = el("button", `grip${point ? "" : " off"}`);
  grip.type = "button";
  grip.innerHTML = '<svg aria-hidden="true"><use href="#i-grip"/></svg>';
  grip.setAttribute("aria-label", "Drag to reorder. Or use the arrow keys.");
  grip.tabIndex = point ? 0 : -1;
  li.append(grip);
  if (point) makeDraggable(li, grip, role, index);
  return li;
}

function kindRow(point, index) {
  const row = el("div", "kind-row");
  const seg = el("div", "seg");
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "Stop or waypoint");
  for (const [type, text] of [["stop", "Stop"], ["marker", "Waypoint"]]) {
    const button = el("button", "", text);
    button.type = "button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", String(point.type === type));
    button.addEventListener("click", () => {
      if (point.type === type) return;
      if (type === "stop" && stopCount() >= MAX_STOPS) return toast(`A route has up to ${MAX_STOPS} stops.`, true);
      edit(() => {
        point.type = type;
        if (type !== "stop") delete point.stayMinutes;
      }, { geometry: false });
      if (type === "stop" && !point.label) nameSpot(point);
    });
    seg.append(button);
  }
  row.append(seg);
  if (point.type === "stop") {
    const stay = el("span", "stay");
    stay.innerHTML = '<svg aria-hidden="true"><use href="#i-clock"/></svg>';
    const select = el("select");
    select.setAttribute("aria-label", "Time to stay");
    select.append(new Option("Add stay time", "0"));
    for (const minutes of STAY_CHOICES) select.append(new Option(`Stay ${minutes < 60 ? `${minutes} min` : formatDuration(minutes * 60).replace(" h", " hr")}`, String(minutes)));
    select.value = String(point.stayMinutes || 0);
    select.addEventListener("change", () => edit(() => {
      const minutes = Number(select.value);
      if (minutes) point.stayMinutes = minutes;
      else delete point.stayMinutes;
    }, { geometry: false }));
    stay.append(select);
    row.append(stay);
  }
  return row;
}

function addRow() {
  const li = el("li", "row");
  li.dataset.role = "add";
  li.append(el("span", "badge new", "+"));
  if (!adding) {
    const button = el("button", "add-row", "Add a stop or waypoint");
    button.type = "button";
    button.disabled = !plan.start;
    button.title = plan.start ? "" : "Choose a start first";
    button.addEventListener("click", () => {
      adding = true;
      focusAfterRender = '[data-focus="add"]';
      renderRows();
    });
    li.append(button);
    return li;
  }
  const cell = el("div", "cell");
  const wrap = el("span", "input-wrap");
  const input = el("input", "row-input empty");
  input.placeholder = "Search for a stop";
  input.setAttribute("aria-label", "New stop");
  input.dataset.focus = "add";
  wrap.append(input);
  cell.append(wrap);
  li.append(cell);
  attachSearch(li, input, (place) => {
    adding = false;
    choosePlace("add", undefined, place);
  }, () => {
    adding = false;
    renderRows();
  });
  return li;
}

function removePoint(role, index) {
  edit(() => {
    if (role === "start") plan.start = null;
    else if (role === "end") plan.end = null;
    else plan.waypoints.splice(index, 1);
  });
}

function choosePlace(role, index, place) {
  const spot = { id: newUUID(() => crypto.randomUUID()), lat: place.lat, lon: place.lon, label: clip(place.name, MOST_LABEL_CHARACTERS) };
  edit(() => {
    if (role === "start") plan.start = spot;
    else if (role === "end") plan.end = spot;
    else if (role === "waypoint") Object.assign(plan.waypoints[index], { lat: spot.lat, lon: spot.lon, label: spot.label, road: null });
    else {
      const type = stopCount() < MAX_STOPS ? "stop" : "marker";
      plan.waypoints.splice(bestSlot(spot), 0, { ...spot, type });
    }
  });
  if (mapReady) map.easeTo({ center: [spot.lon, spot.lat], zoom: Math.max(map.getZoom(), 9), padding: fitPadding() });
  if (role === "add") {
    adding = true;
    focusAfterRender = '[data-focus="add"]';
    renderRows();
  }
}

// typeahead: three letters and a pause, then up to six places near the map
function attachSearch(li, input, onPick, onLeave) {
  let timer = 0;
  let results = [];
  let active = 0;
  let list = null;
  const original = input.value;
  const close = () => {
    list?.remove();
    list = null;
    li.classList.remove("searching");
  };
  const show = (query) => {
    close();
    li.classList.add("searching");
    list = el("ul", "suggest");
    list.setAttribute("role", "listbox");
    if (!results.length) {
      list.append(el("li", "none", "No places found"));
    }
    results.forEach((place, i) => {
      const item = el("li");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === active));
      item.innerHTML = '<svg aria-hidden="true"><use href="#i-pin"/></svg>';
      const text = el("span");
      const name = el("span", "n");
      const lower = place.name.toLowerCase();
      const at = lower.indexOf(query.toLowerCase());
      if (at >= 0) {
        name.append(place.name.slice(0, at));
        name.append(el("b", "", place.name.slice(at, at + query.length)));
        name.append(place.name.slice(at + query.length));
      } else {
        name.textContent = place.name;
      }
      text.append(name, el("span", "a", place.address || ""));
      item.append(text);
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        close();
        onPick(place);
      });
      list.append(item);
    });
    li.append(list);
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < SEARCH_MIN_CHARS) return close();
    timer = setTimeout(async () => {
      try {
        const near = mapReady ? map.getCenter() : null;
        const data = await planner("search", { query, ...(near ? { near: { lat: near.lat, lon: near.lng } } : {}) });
        if (input.value.trim() !== query) return;
        results = data.places || [];
        active = 0;
        show(query);
      } catch (failure) {
        toast(failure.message, true);
      }
    }, SEARCH_DELAY_MS);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
      input.value = original;
      input.blur();
      return;
    }
    if (!list || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length;
      [...list.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const place = results[active];
      close();
      onPick(place);
    }
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      close();
      if (input.value !== original) input.value = original;
      onLeave?.();
    }, 120);
  });
}

// drag to reorder (and the arrow keys on the handle)
let dragFrom = null;
function makeDraggable(li, grip, role, index) {
  const position = role === "start" ? 0 : role === "end" ? plan.waypoints.length + 1 : index + 1;
  grip.addEventListener("pointerdown", () => (li.draggable = true));
  li.addEventListener("dragstart", (event) => {
    dragFrom = position;
    li.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(position));
  });
  li.addEventListener("dragend", () => {
    li.draggable = false;
    li.classList.remove("dragging");
    document.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"));
  });
  li.addEventListener("dragover", (event) => {
    if (dragFrom === null) return;
    event.preventDefault();
    document.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"));
    li.classList.add("drop-before");
  });
  li.addEventListener("drop", (event) => {
    event.preventDefault();
    const from = dragFrom;
    dragFrom = null;
    if (from !== null && from !== position) move(from, position);
  });
  grip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const to = position + (event.key === "ArrowUp" ? -1 : 1);
    move(position, to);
    focusAfterRender = `.row:nth-child(${Math.max(1, Math.min(to + 1, plan.waypoints.length + 3))}) .grip`;
    renderRows();
  });
}

/// Moves a place along [start, …waypoints, end]; whatever lands first is
/// the start and last the destination, and a former end takes a
/// waypoint's place in between.
function move(from, to) {
  const chain = [plan.start, ...plan.waypoints, loops() ? null : plan.end];
  const last = chain.length - 1;
  if (to < 0 || to > last || !chain[from]) return;
  edit(() => {
    const [item] = chain.splice(from, 1);
    chain.splice(to, 0, item);
    const filled = chain;
    const start = filled[0];
    const end = loops() ? null : filled[filled.length - 1];
    const middle = filled.slice(1, loops() ? undefined : -1).filter(Boolean);
    plan.start = start ? strip(start) : null;
    if (!loops()) plan.end = end ? strip(end) : null;
    plan.waypoints = middle.map((p) => (p.type ? p : { ...p, type: "marker" }));
  });
}
const strip = ({ id, lat, lon, label }) => ({ id, lat, lon, label });

// ── bringing a route in ──────────────────────────────────────────────

async function importLink(text) {
  const link = linkKind(text);
  if (!link || link.kind === "unknown") return toast("That link isn't one Carve can read. Try a Google Maps, Ride with GPS or Carve link.", true);
  busy(true, "Bringing it in…");
  try {
    if (link.kind === "rwgps") {
      const response = await fetch(`${FUNCTIONS}/ride-with-gps`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify(link.ref),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) throw new Failure("That route is private. In Ride with GPS, export it as a GPX file and open that here.");
      if (!response.ok) throw new Failure(data.error === "Not found." ? "Ride with GPS couldn't find that route." : data.error || "Ride with GPS didn't answer. Try again.");
      const found = data.route;
      await importTrack({
        name: found.name,
        track: found.track_points.map((p) => [p.x, p.y]),
        places: (found.points_of_interest || []).map((p) => ({ lat: p.lat, lon: p.lng, name: p.name })),
      }, "Ride with GPS");
    } else if (link.kind === "google") {
      const near = mapReady ? map.getCenter() : null;
      const route = await planner("link", { url: link.url, ...(near ? { here: { lat: near.lat, lon: near.lng } } : {}) });
      loadStops(route, "Google Maps");
    } else if (link.kind === "carve") {
      await importCarve(link.token);
    }
    $("link-in").value = "";
  } catch (failure) {
    toast(failure.message, true);
  } finally {
    busy(false);
  }
}

async function importTrack(track, source) {
  const { route } = await planner("import", { track: track.track, places: track.places, name: track.name });
  remember();
  plan = {
    ...blankPlan(),
    name: route.name || track.name || "",
    start: spotFrom(route.start),
    end: route.trip === "roundTrip" ? null : spotFrom(route.end),
    waypoints: route.waypoints.map((w) => ({ ...spotFrom(w), type: w.type === "stop" ? "stop" : "marker" })),
    trip: route.trip === "roundTrip" ? "roundTrip" : "oneWay",
    style: route.style || "shortest",
    path: route.path,
    roads: route.roads || [],
    frozen: true,
    imported: { source, matched: route.matched !== false, turns: route.path.instructions.length },
  };
  nameWaypointsByRoad();
  changed();
  fitRoute();
  // A track's ends come with no names: look them up for the list.
  if (!plan.start.label) nameSpot(plan.start);
  if (plan.end && !plan.end.label) nameSpot(plan.end);
}

function loadStops(route, source) {
  remember();
  plan = {
    ...blankPlan(),
    name: route.name || "",
    start: spotFrom(route.start),
    end: route.trip === "roundTrip" ? null : spotFrom(route.end),
    waypoints: (route.waypoints || []).map((w) => ({ ...spotFrom(w), type: w.type === "stop" ? "stop" : "marker" })),
    trip: route.trip === "roundTrip" ? "roundTrip" : "oneWay",
    style: route.style || "balanced",
  };
  toast(`Brought in from ${source}.`);
  changed({ reroute: true });
  fitRoute();
}

const spotFrom = (p) => (p ? { id: newUUID(() => crypto.randomUUID()), lat: p.lat ?? p.latitude, lon: p.lon ?? p.longitude, label: clip(p.name ?? p.label, MOST_LABEL_CHARACTERS) } : null);

/// Someone's Carve link: its current version, as a copy to plan from.
async function importCarve(token) {
  const rows = await rest("/rest/v1/rpc/redeem_share_token", { method: "POST", body: { share_token: token } });
  const payload = rows?.[0]?.payload;
  if (!payload) throw new Failure("That Carve link couldn't be found.");
  const all = payload.allWaypoints?.length > (payload.waypoints?.length || 0) ? payload.allWaypoints : payload.waypoints || [];
  remember();
  plan = {
    ...blankPlan(),
    name: payload.name || "",
    start: spotFrom(payload.start),
    end: payload.tripType === "roundtrip" ? null : spotFrom(payload.end),
    waypoints: all.map((w) => ({ ...spotFrom({ ...w.location, label: w.label }), type: w.type === "stop" ? "stop" : "marker", ...(w.stayMinutes ? { stayMinutes: w.stayMinutes } : {}) })),
    trip: payload.tripType === "roundtrip" ? (payload.returnsSameWay ? "outAndBack" : "roundTrip") : "oneWay",
    style: payload.balancesRoads ? "balanced" : payload.routingPreference || "scenic",
    path: payload.pathGeometry?.length ? {
      geometry: payload.pathGeometry.map((c) => [c.longitude, c.latitude]),
      instructions: payload.turnInstructions || [],
      distanceMeters: payload.pathDistanceMeters || 0,
      durationSeconds: payload.pathDurationSeconds || 0,
    } : null,
    frozen: !!payload.pathGeometry?.length,
    imported: { source: "a Carve link", matched: true, turns: payload.turnInstructions?.length || 0 },
  };
  changed({ reroute: !plan.path });
  fitRoute();
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) return toast("That file is too big to be a drive.", true);
  busy(true, "Bringing it in…");
  try {
    const doc = new DOMParser().parseFromString(await file.text(), "application/xml");
    let track;
    try {
      track = readGPX(doc);
    } catch (error) {
      throw new Failure(error.message === "no-track" ? "That GPX file has no route or track in it." : "That file isn't a GPX file Carve can read.");
    }
    await importTrack(track, "a GPX file");
  } catch (failure) {
    toast(failure.message, true);
  } finally {
    busy(false);
  }
}

// ── saving ───────────────────────────────────────────────────────────

async function save() {
  if (!plan.path) return;
  plan.name = clip($("route-name").value, MOST_NAME_CHARACTERS) || suggestedName();
  if (!session || !(await accessToken())) {
    store.set(DRAFT_KEY, { plan, saved });
    openAccount();
    return;
  }
  if (!profile && !(await loadProfile().catch(() => null))) {
    openAccount("username");
    return;
  }
  $("save").disabled = true;
  busy(true, "Saving…");
  try {
    if (!plan.id || plan.ownerId !== session.user.id) {
      plan.id = newUUID(() => crypto.randomUUID());
      plan.token = newShareToken((n) => crypto.getRandomValues(new Uint8Array(n)));
      plan.createdAt = appleDate();
      plan.ownerId = session.user.id;
    }
    await writeRoute();
    await rest("/rest/v1/shares", {
      method: "POST",
      body: [{ token: plan.token, route_id: plan.id.toLowerCase() }],
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
    saved = true;
    store.remove(PENDING_SAVE_KEY);
    saveDraft();
    showSaved();
    enrich();
  } catch (failure) {
    toast(failure.message, true);
  } finally {
    busy(false);
    $("save").disabled = false;
  }
}

async function writeRoute() {
  const payload = routePayload(plan);
  await rest("/rest/v1/routes", {
    method: "POST",
    body: [routeRow(plan, session.user.id, payload)],
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  });
}

/// "Main Street, Ramona" is Ramona when a place stands for a whole end.
const town = (label) => (label ? label.split(",").map((s) => s.trim()).filter(Boolean).pop() : null);

function suggestedName() {
  const from = town(plan.start?.label);
  const to = loops() ? null : town(plan.end?.label);
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : "My drive";
}

/// After the save: elevation and curves for the card, then the summary
/// the app shows, written by the same `describe` function and saved onto
/// the route so the phone has them too.
async function enrich() {
  const path = plan.path.geometry;
  try {
    if (!plan.profile) plan.profile = await planner("profile", { path });
    plan.elevationProfile = plan.profile.elevationProfile || null;
    renderSavedFacts();
  } catch {
    // The card reads fine without them.
  }
  if (plan.blurb) return renderBlurb();
  try {
    const { facts } = await planner("facts", {
      name: plan.name,
      distanceMeters: plan.path.distanceMeters,
      durationSeconds: plan.path.durationSeconds,
      instructions: plan.path.instructions.map((t) => t.text),
      roads: plan.roads.map((r) => r.name),
      waypoints: plan.waypoints.map((w) => ({ type: w.type, ...(w.label ? { name: w.label } : {}) })),
      trip: plan.trip,
      style: plan.style,
      ...(plan.elevationProfile ? { elevationProfile: plan.elevationProfile } : {}),
    });
    // The gateway checks a real sign-in here, never the publishable key.
    const token = await accessToken();
    if (!token) throw new Error("signed out");
    const response = await fetch(`${FUNCTIONS}/describe`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(facts),
    });
    const data = await response.json().catch(() => ({}));
    plan.blurb = clip(data.description, 600);
  } catch {
    plan.blurb = null;
  }
  renderBlurb();
  if (plan.blurb || plan.elevationProfile) {
    try {
      await writeRoute();
      saveDraft();
    } catch {
      // The route is saved; the extras arrive when the app opens it.
    }
  }
}

// ── the saved card ───────────────────────────────────────────────────

const shareLink = () => `${SITE}/${plan.token}`;

function showSaved() {
  $("plan-view").hidden = true;
  $("saved-view").hidden = false;
  $("map-hint").hidden = true;
  closeClickMenu();
  $("s-name").textContent = plan.name;
  const ends = [town(plan.start?.label), loops() ? "back" : town(plan.end?.label)].filter(Boolean).join(" → ");
  const tripWord = { oneWay: "One way", roundTrip: "Round trip", outAndBack: "Out and back" }[plan.trip];
  const stops = stopCount();
  $("s-sub").textContent = [ends, tripWord, stops ? `${stops} stop${stops === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  $("link-out").value = shareLink().replace("https://", "");
  drawQR();
  renderSavedFacts();
  renderBlurb(true);
}

function renderSavedFacts() {
  const facts = $("s-facts");
  facts.innerHTML = "";
  const p = plan.profile;
  const label = p?.intensity?.title;
  if (label) {
    const chip = el("span", "chip", label);
    chip.style.background = { Leisurely: "#5E9E6E", Sweeping: "#C0860A", Twisty: "#D2591F", Intense: "#9B1C1C" }[label] || "#5D636C";
    facts.append(chip);
  }
  const distance = formatDistance(plan.path.distanceMeters, miles);
  const add = (bold, rest) => {
    if (facts.childElementCount) facts.append(el("span", "sep"));
    const span = el("span");
    span.append(el("b", "", bold), rest ? ` ${rest}` : "");
    facts.append(span);
  };
  add(distance.value, distance.unit === "miles" ? "mi" : "km");
  add(formatDuration(plan.path.durationSeconds));
  if (p?.climbMeters) add(heightText(p.climbMeters), "climb");
  if (p?.elevationProfile?.metersAboveSea?.length > 1) {
    $("elev-unit").hidden = false;
    $("elev-text").textContent = `↑ ${heightText(p.climbMeters || 0)} · ↓ ${heightText(p.descentMeters || 0)}`;
    drawElevation(p.elevationProfile.metersAboveSea);
  }
  if (p?.curves?.profile?.length) {
    $("curve-unit").hidden = false;
    $("curve-text").textContent = p.curves.summary || label || "";
    $("curve-bar").setAttribute("aria-label", `Curves along the drive: ${p.curves.summary || label || ""}`);
    $("curve-bar").style.background = curveGradient(p.curves.profile);
  }
}

const heightText = (m) => (miles ? `${Math.round(m * 3.28084).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);

function drawElevation(samples) {
  const svg = $("elev");
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const span = Math.max(hi - lo, 1);
  const points = samples.map((v, i) => `${((i / (samples.length - 1)) * 372).toFixed(1)} ${(42 - ((v - lo) / span) * 38).toFixed(1)}`);
  svg.innerHTML = `<path d="M${points.join(" L")} V44 H0Z" fill="#0A84FF" fill-opacity=".16"/><path d="M${points.join(" L")}" fill="none" stroke="#0A84FF" stroke-width="2.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
}

/// The drive pages' colours: pale blue for gentle through pink for hairpins.
function curveGradient(values) {
  const stops = ["#8FD8FF", "#5B7CFA", "#9B4DEB", "#FF3D8B"];
  const colour = (v) => stops[Math.min(stops.length - 1, Math.floor(Math.max(0, Math.min(0.999, v)) * stops.length))];
  const parts = values.map((v, i) => `${colour(v)} ${((i / Math.max(values.length - 1, 1)) * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

function renderBlurb(waiting = false) {
  const has = !!plan.blurb;
  $("blurb").hidden = !has;
  $("blurb").textContent = plan.blurb || "";
  $("shimmer").hidden = has || !waiting;
  $("about-state").textContent = has ? "" : waiting ? "Writing…" : "Couldn't write one this time";
  $("about").hidden = !has && !waiting && !plan.path;
}

let qrModel = null;
function drawQR() {
  if (!window.qrcode) return;
  qrModel = qrcode(0, "M");
  qrModel.addData(shareLink());
  qrModel.make();
  const box = $("qr");
  box.innerHTML = qrModel.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  box.setAttribute("aria-label", `QR code for ${shareLink()}`);
}

function downloadQR() {
  if (!qrModel) return;
  const count = qrModel.getModuleCount();
  const scale = 24;
  const margin = 4 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = count * scale + margin * 2;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111113";
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qrModel.isDark(r, c)) ctx.fillRect(margin + c * scale, margin + r * scale, scale, scale);
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${(plan.name || "carve-route").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "carve-route"}-qr.png`;
  a.click();
}

// ── printing: page 1 the QR sheet, page 2 the turns ──────────────────

const ARROWS = {
  start: '<circle cx="12" cy="12" r="7" fill="#2E9E52"/>',
  left: '<path d="M17 21V12a3 3 0 0 0-3-3H5M9 5L5 9l4 4" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  right: '<path d="M7 21V12a3 3 0 0 1 3-3h9M15 5l4 4-4 4" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  keepleft: '<path d="M15 21v-7L8 6M14 6H8v6" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  keepright: '<path d="M9 21v-7l7-8M10 6h6v6" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  straight: '<path d="M12 21V4M7 9l5-5 5 5" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  uturn: '<path d="M8 21V9a4 4 0 0 1 8 0v8M12 13l4 4 4-4" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  roundabout: '<circle cx="12" cy="10" r="4" fill="none" stroke="#111" stroke-width="2.4"/><path d="M12 21v-7" stroke="#111" stroke-width="2.6" stroke-linecap="round"/>',
  arrive: '<path d="M6 21V4M6 4h11l-2 4 2 4H6" fill="#111" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/>',
  stop: '<circle cx="12" cy="12" r="8" fill="#E4731C"/>',
};
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function printDirections() {
  const unitMeters = miles ? 1609.344 : 1000;
  const unit = miles ? "mi" : "km";
  const turns = plan.path.instructions;
  const labels = markerLabels(plan.waypoints);
  // Each stop goes in after the turn nearest to it.
  const stopsAfter = new Map();
  plan.waypoints.forEach((w, i) => {
    if (w.type !== "stop") return;
    let best = 0;
    let nearest = Infinity;
    turns.forEach((t, k) => {
      const d = meters({ lat: t.location.latitude, lon: t.location.longitude }, w);
      if (d < nearest) {
        nearest = d;
        best = k;
      }
    });
    if (!stopsAfter.has(best)) stopsAfter.set(best, []);
    stopsAfter.get(best).push({ label: labels[i], name: w.label || `Stop ${labels[i]}`, stay: w.stayMinutes });
  });
  let mile = 0;
  let rows = "";
  turns.forEach((t, k) => {
    const kind = k === 0 ? "start" : turnKind(t.text);
    rows += `<tr><td class="n">${k + 1}</td><td class="ic"><svg viewBox="0 0 24 24">${ARROWS[kind] || ARROWS.straight}</svg></td><td>${escapeHTML(t.text)}</td><td class="d">${t.arrives ? "" : `${(t.distanceMeters / unitMeters).toFixed(1)} ${unit}`}</td><td class="m">${(mile / unitMeters).toFixed(1)}</td></tr>`;
    for (const stop of stopsAfter.get(k) || []) {
      rows += `<tr class="stoprow"><td class="n"></td><td class="ic"><svg viewBox="0 0 24 24">${ARROWS.stop}</svg></td><td>Stop ${stop.label} · ${escapeHTML(stop.name)}${stop.stay ? ` · stay ${stop.stay} min` : ""}</td><td class="d"></td><td class="m">${((mile + t.distanceMeters) / unitMeters).toFixed(1)}</td></tr>`;
    }
    mile += t.distanceMeters;
  });
  const distance = formatDistance(plan.path.distanceMeters, miles);
  const sub = `${distance.value} ${distance.unit} · about ${formatDuration(plan.path.durationSeconds)}${$("s-sub").textContent ? ` · ${escapeHTML($("s-sub").textContent)}` : ""}`;
  const qr = qrModel ? qrModel.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) : "";
  const link = shareLink().replace("https://", "");
  $("printout").innerHTML = `
    <section class="pp">
      <svg class="wm"><use href="#i-wordmark"/></svg>
      <h1>${escapeHTML(plan.name)}</h1>
      <p class="sub">${sub}</p>
      <div class="scanrow"><div class="qrbig">${qr}</div><div><b>Scan with your phone's camera to drive it in Carve</b><span>Turn by turn on the exact roads, even with no signal.</span><span class="url">${link}</span></div></div>
      ${plan.blurb ? `<p style="margin-top:18pt;font-size:12pt;line-height:1.5">${escapeHTML(plan.blurb)}</p>` : ""}
      <p class="foot-note">No Carve yet? It's free on iPhone and Android. The link takes you to the store first.</p>
    </section>
    <section class="pp">
      <svg class="wm"><use href="#i-wordmark"/></svg>
      <h1 style="font-size:22pt">${escapeHTML(plan.name)}: turn by turn</h1>
      <p class="sub">${sub} · ${link}</p>
      <table><thead><tr><th></th><th></th><th>Direction</th><th style="text-align:right">Then</th><th style="text-align:right">${miles ? "Mile" : "Km"}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="foot-note">Directions are the route as planned in Carve. Watch for road signs and closures.</p>
    </section>`;
  window.print();
}

// ── account dialog ───────────────────────────────────────────────────

let emailForCode = "";
function openAccount(step = "choose") {
  const dialog = $("account");
  setStep(step);
  if (!dialog.open) dialog.showModal();
}
function setStep(step) {
  for (const node of $("account").querySelectorAll("[data-step]")) node.hidden = node.dataset.step !== step;
  $("acc-error").hidden = true;
  const focus = { email: "email", code: "code", username: "username" }[step];
  if (focus) setTimeout(() => $(focus).focus(), 30);
}
function accountError(message) {
  $("acc-error").textContent = message;
  $("acc-error").hidden = false;
}

function oauth(provider) {
  store.set(DRAFT_KEY, { plan, saved });
  store.set(PENDING_SAVE_KEY, true);
  if (!storageWorks) {
    accountError("This browser isn't keeping data, so signing in with " + (provider === "apple" ? "Apple" : "Google") + " would lose your route. Use email instead.");
    return;
  }
  const back = `${location.origin}/plan/`;
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(back)}`;
}

async function afterSignIn() {
  renderWho();
  const found = await loadProfile().catch(() => null);
  if (!found) return setStep("username");
  $("account").close();
  await save();
}

function renderWho() {
  const signedIn = !!session;
  $("sign-in").hidden = signedIn;
  $("who").hidden = !signedIn;
  if (!signedIn) return;
  $("who-name").textContent = profile?.username || session.user.email?.split("@")[0] || "Account";
  const avatar = $("avatar");
  const url = profile?.avatar_url;
  if (url && /^https:\/\//.test(url)) {
    avatar.innerHTML = "";
    const img = el("img");
    img.alt = "";
    img.src = url;
    avatar.append(img);
  } else {
    avatar.innerHTML = '<svg aria-hidden="true"><use href="#i-car"/></svg>';
  }
}

// ── small things ─────────────────────────────────────────────────────

let toastTimer = 0;
function toast(message, bad = false) {
  const node = $("toast");
  node.textContent = message;
  node.classList.toggle("bad", bad);
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (node.hidden = true), bad ? 6000 : 3200);
}
let busyMessage = null;
function busy(on, message) {
  document.body.style.cursor = on ? "progress" : "";
  if (on && message) {
    busyMessage = message;
    toast(message);
  } else if (!on && busyMessage && $("toast").textContent === busyMessage) {
    $("toast").hidden = true;
    busyMessage = null;
  }
}

function showPlan() {
  saved = false;
  $("saved-view").hidden = true;
  $("plan-view").hidden = false;
  render();
  saveDraft();
}

function planAnother() {
  plan = blankPlan();
  saved = false;
  history.back.length = 0;
  history.forward.length = 0;
  store.remove(DRAFT_KEY);
  showPlan();
}

function osAwareGetApp() {
  if (!isAndroid) return;
  document.querySelectorAll("[data-get-app]").forEach((a) => (a.href = "/android/"));
  document.querySelectorAll("[data-get-icon]").forEach((u) => u.setAttribute("href", "#i-android"));
  document.querySelectorAll("[data-get-label]").forEach((s) => (s.textContent = "Get Carve for Android"));
}

// ── wiring ───────────────────────────────────────────────────────────

function wire() {
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing && !saved) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    }
    if (event.key === "Escape") closeClickMenu();
    if (!$("click-menu").hidden && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const items = [...$("click-menu").querySelectorAll("button")];
      const at = items.indexOf(document.activeElement);
      items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      event.preventDefault();
    }
  });
  $("trip").addEventListener("change", () => edit(() => (plan.trip = $("trip").value)));
  $("route-name").addEventListener("input", () => {
    plan.name = $("route-name").value;
    saveDraft();
  });
  $("import-dismiss").addEventListener("click", () => {
    if (plan.imported) plan.imported.dismissed = true;
    changed();
  });
  $("link-form").addEventListener("submit", (event) => {
    event.preventDefault();
    importLink($("link-in").value);
  });
  $("gpx-btn").addEventListener("click", () => $("gpx").click());
  $("gpx").addEventListener("change", () => importFile($("gpx").files[0]));
  const app = document.querySelector(".app");
  app.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    $("drop").hidden = false;
  });
  $("drop").addEventListener("dragleave", () => ($("drop").hidden = true));
  app.addEventListener("drop", (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    $("drop").hidden = true;
    importFile(event.dataTransfer.files[0]);
  });
  $("save").addEventListener("click", save);
  $("edit").addEventListener("click", showPlan);
  $("plan-another").addEventListener("click", planAnother);
  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareLink());
      toast("Link copied.");
    } catch {
      $("link-out").select();
      toast("Press ⌘C or Ctrl+C to copy.");
    }
  });
  $("qr-download").addEventListener("click", downloadQR);
  $("print").addEventListener("click", printDirections);

  $("sign-in").addEventListener("click", () => openAccount());
  $("who-btn").addEventListener("click", () => {
    const open = $("who-menu").hidden;
    $("who-menu").hidden = !open;
    $("who-btn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (event) => {
    if (!$("who").contains(event.target)) $("who-menu").hidden = true;
  });
  $("sign-out").addEventListener("click", async () => {
    const token = session?.access_token;
    signedOut();
    $("who-menu").hidden = true;
    if (token) fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } }).catch(() => {});
  });
  $("menu-btn").addEventListener("click", () => {
    const open = $("sheet").hidden;
    $("sheet").hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", String(open));
  });

  $("acc-close").addEventListener("click", () => $("account").close());
  $("with-apple").addEventListener("click", () => oauth("apple"));
  $("with-google").addEventListener("click", () => oauth("google"));
  $("with-email").addEventListener("click", () => setStep("email"));
  $("account").querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => setStep(b.closest("[data-step]").dataset.step === "code" ? "email" : "choose")));
  $("email-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    emailForCode = $("email").value.trim().toLowerCase();
    try {
      await auth("otp", { email: emailForCode, create_user: true });
      $("code-to").textContent = emailForCode;
      $("code").value = "";
      setStep("code");
    } catch (failure) {
      accountError(failure.message);
    }
  });
  $("resend").addEventListener("click", async () => {
    try {
      await auth("otp", { email: emailForCode, create_user: true });
      toast("A new code is on its way.");
    } catch (failure) {
      accountError(failure.message);
    }
  });
  $("code-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      keepSession(await auth("verify", { type: "email", email: emailForCode, token: $("code").value.trim() }));
      await afterSignIn();
    } catch (failure) {
      accountError(failure.message);
    }
  });
  $("username-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("username").value.trim();
    try {
      const rows = await rest("/rest/v1/profiles", {
        method: "POST",
        body: { id: session.user.id.toLowerCase(), username },
        headers: { Prefer: "return=representation" },
      });
      profile = rows?.[0] || { username };
      renderWho();
      $("account").close();
      await save();
    } catch (failure) {
      accountError(failure.status === 409 ? "That username is taken. Try another." : failure.message);
    }
  });
}

async function start() {
  osAwareGetApp();
  if (window.matchMedia("(max-width: 699px)").matches) {
    wire();
    return;
  }
  const draft = store.get(DRAFT_KEY);
  if (draft?.plan) {
    plan = { ...blankPlan(), ...draft.plan };
    saved = !!draft.saved;
  }
  session = store.get(SESSION_KEY);
  const cameBack = await readOAuthReturn().catch(() => false);
  wire();
  renderWho();
  setUpMap();
  render();
  if (LOCAL) window.__planner = { get plan() { return plan; }, showSaved, enrich, render, importTrack, placeAt, printDirections };
  if (saved && plan.token) {
    showSaved();
    renderBlurb(false);
  } else if (routable() && !plan.path) {
    scheduleRoute();
  }
  if (session) {
    await loadProfile().catch(() => null);
    if (cameBack && store.get(PENDING_SAVE_KEY)) {
      if (!profile) openAccount("username");
      else save();
    }
  }
  if (!storageWorks) toast("This browser isn't keeping data, so a reload starts the route over.");
}

start();
