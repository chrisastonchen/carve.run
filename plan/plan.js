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
import { level, lineOf, roadPoints, wholeRoad } from "./good-roads.js?v=3";

const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
// Cloudflare Turnstile's public site key: guests prove they're a browser
// once an hour before the planner spends anything on them. Empty, no check.
const TURNSTILE_SITE_KEY = "0x4AAAAAAFqn1SkCkqJfDpRa";
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
const PENDING_EDIT_KEY = "carve.plan.pending-edit";
const OAUTH_STATE_KEY = "carve.plan.oauth-state";
const VIEW_KEY = "carve.plan.view";
/// The guest's hour-long pass, kept so a reload doesn't run the bot check
/// again (the user, 2026-10-29: Safari showed it on every refresh).
const PASS_KEY = "carve.plan.pass";

// ── state ────────────────────────────────────────────────────────────

/// One place on the route: { id, lat, lon, label, type?, stayMinutes? }.
function blankPlan() {
  return {
    id: null, token: null, createdAt: null, ownerId: null,
    name: "", start: null, end: null, waypoints: [],
    trip: "oneWay", style: "balanced",
    path: null, roads: [], frozen: false, imported: null,
    turnaroundId: null, oneWayEnd: null,
    elevationProfile: null, blurb: null, profile: null,
  };
}
let plan = blankPlan();
let session = null;
let profile = null;
let saved = false;
const history = { back: [], forward: [] };

/// Everything an undo puts back (not the route's identity: undoing an
/// edit of a saved route still saves over that route).
function snapshot() {
  const { name, nameMade, madeName, start, end, waypoints, trip, style, path, roads, frozen, imported, turnaroundId, oneWayEnd } = plan;
  return JSON.stringify({ name, nameMade, madeName, start, end, waypoints, trip, style, path, roads, frozen, imported, turnaroundId, oneWayEnd });
}

/// Bumped whenever the plan is replaced or put back: an answer that set
/// off for an earlier plan (a road, an import, a profile) is dropped.
let planEpoch = 0;
function settle() {
  planEpoch++;
  clearTimeout(routeTimer);
  routeAsk++;
}

/// One way, round trip or out and back, as the app does it
/// (RouteAuthoringModel.setTripType): a one-way drive made a loop keeps
/// its destination as the last stop, so it still runs the whole road
/// before turning for home; made one-way again, that stop is the
/// destination once more.
function setTrip(next) {
  if (next === plan.trip) return;
  const wasLoop = loops();
  edit(() => {
    plan.trip = next;
    const isLoop = loops();
    if (!wasLoop && isLoop) {
      plan.oneWayEnd = plan.end;
      plan.turnaroundId = null;
      const end = plan.end;
      const same = end && plan.start && end.lat === plan.start.lat && end.lon === plan.start.lon;
      if (end && plan.start && !same && plan.waypoints.length < MAX_WAYPOINTS) {
        const type = stopCount() < MAX_STOPS ? "stop" : "marker";
        const kept = { ...end, id: newUUID(() => crypto.randomUUID()), type };
        plan.waypoints.push(kept);
        plan.turnaroundId = kept.id;
      }
      plan.end = null;
    } else if (wasLoop && !isLoop) {
      const last = plan.waypoints[plan.waypoints.length - 1];
      if (plan.turnaroundId && last?.id === plan.turnaroundId) {
        plan.waypoints.pop();
        const { stayMinutes, type, road, ...place } = last;
        plan.end = place;
      } else if (plan.oneWayEnd) {
        plan.end = plan.oneWayEnd;
      }
      plan.turnaroundId = null;
      plan.oneWayEnd = null;
    }
  });
}
function remember() {
  history.back.push(snapshot());
  if (history.back.length > HISTORY_LIMIT) history.back.shift();
  history.forward.length = 0;
}
function restore(json) {
  settle();
  Object.assign(plan, JSON.parse(json));
  plan.elevationProfile = null;
  plan.profile = null;
  plan.blurb = null;
  // The road came back with the snapshot; ask again only if it didn't.
  changed({ reroute: !plan.path });
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
    // Elevation, curves and the summary were the old road's.
    plan.frozen = false;
    plan.elevationProfile = null;
    plan.profile = null;
    plan.blurb = null;
  }
  changed({ reroute: geometry });
}
function changed({ reroute = false, record = true, keepTyping = false } = {}) {
  if (record) saveDraft();
  render({ keepTyping });
  if (reroute) scheduleRoute();
}

/// Someone is typing in a row: an answer arriving (a road, a place's name)
/// waits to redraw the rows until they leave it, or the field, its text and
/// its suggestions would vanish under them (the QA pass, 2026-10-29).
let rowsWaiting = false;
const typingInRows = () => document.activeElement?.tagName === "INPUT" && !!document.activeElement.closest("#rows");
function rowsAfterTyping() {
  if (!rowsWaiting || typingInRows()) return;
  rowsWaiting = false;
  renderRows();
}

let draftTimer = 0;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => store.set(DRAFT_KEY, { plan, saved }), 250);
}

// ── network ──────────────────────────────────────────────────────────

class Failure extends Error {}

/// The planner, as this planner: their account when signed in, otherwise
/// a guest with this hour's pass (fetched again once if it's turned down).
async function planner(action, body = {}, retried = false) {
  const token = await accessToken().catch(() => null);
  const pass = token ? null : currentPass();
  let response;
  try {
    response = await fetch(`${FUNCTIONS}/planner`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}` },
      body: JSON.stringify({ action, ...body, ...(pass ? { pass } : {}) }),
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (data.needsPass && !retried) {
    guestPass = null;
    store.remove(PASS_KEY);
    if (await fetchPass()) return planner(action, body, true);
    openAccount("choose", { saving: false });
    throw new Failure("Couldn't check this browser. Sign in to keep planning. It's free.");
  }
  if (data.signIn) openAccount("choose", { saving: false });
  throw new Failure(data.error || "Something went wrong. Try again.");
}

// ── the guest's pass ─────────────────────────────────────────────────

let guestPass = (() => {
  const kept = store.get(PASS_KEY);
  return kept && typeof kept.pass === "string" && Number.isFinite(kept.expires) ? kept : null;
})();
let passOnItsWay = null;
let turnstileWidget = null;

const currentPass = () => (guestPass && guestPass.expires - 60 > Date.now() / 1000 ? guestPass.pass : null);

/// Turnstile's check, then the planner's pass for it. Most people never
/// see a thing; a doubtful browser gets one checkbox. False when the check
/// can't run here at all.
function fetchPass() {
  if (!TURNSTILE_SITE_KEY || LOCAL) return Promise.resolve(false);
  if (currentPass()) return Promise.resolve(true);
  passOnItsWay ??= (async () => {
    try {
      const token = await turnstileToken();
      if (!token) return false;
      const response = await fetch(`${FUNCTIONS}/planner`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        body: JSON.stringify({ action: "pass", token }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pass) return false;
      guestPass = { pass: data.pass, expires: data.expires };
      store.set(PASS_KEY, guestPass);
      return true;
    } catch {
      return false;
    } finally {
      passOnItsWay = null;
    }
  })();
  return passOnItsWay;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve(!!window.turnstile);
    script.onerror = () => resolve(false);
    document.head.append(script);
    setTimeout(() => resolve(!!window.turnstile), 10000);
  });
}

async function turnstileToken() {
  if (!(await loadTurnstile())) return null;
  return new Promise((resolve) => {
    const done = (token) => {
      $("bot-check").hidden = true;
      resolve(token);
    };
    const options = {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: "interaction-only",
      theme: "light",
      callback: (token) => done(token),
      "error-callback": () => done(null),
      "expired-callback": () => done(null),
      "before-interactive-callback": () => ($("bot-check").hidden = false),
    };
    try {
      if (turnstileWidget !== null) {
        window.turnstile.remove(turnstileWidget);
      }
      turnstileWidget = window.turnstile.render("#bot-check-widget", options);
    } catch {
      done(null);
    }
  });
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
  const began = store.get(OAUTH_STATE_KEY);
  store.remove(OAUTH_STATE_KEY);
  history_replace();
  if (!(typeof began === "number" && Date.now() - began < 15 * 60_000)) return false;
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
  // Where this browser left the map, or the whole country until the
  // visitor's town comes back.
  const view = store.get(VIEW_KEY);
  const remembered = Array.isArray(view?.center) && view.center.length === 2 && view.center.every(Number.isFinite) && Number.isFinite(view.zoom);
  map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: remembered ? view.center : [-98.5, 39.5],
    zoom: remembered ? view.zoom : 3.6,
    attributionControl: { compact: false },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  // The browser asks for the visitor's location only when this is clicked.
  map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: false, timeout: 10000 },
    fitBoundsOptions: { maxZoom: 11 },
    trackUserLocation: false,
  }), "top-right");
  if (!remembered && !plan.start && !plan.end) startNearVisitor();
  map.on("load", () => {
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addSource("route", { type: "geojson", data: emptyLine() });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 11 } }, firstLabel);
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2E92FF", "line-width": 6 } }, firstLabel);
    // Carve's drives: dashed violet (the app's colour for a drive that
    // isn't yours), under the route's own line; from about a state's width
    // in, where they're roads and not a tangle. Quiet beside the route —
    // thin, see-through, barely edged — until pointed at (the user,
    // 2026-10-29: the bright ones fought the blue route for attention).
    const pointedAt = (on, off) => ["case", ["boolean", ["feature-state", "hover"], false], on, off];
    map.addSource("good-roads", { type: "geojson", data: emptyLine(), promoteId: "t" });
    // Pointed at, it glows.
    map.addLayer({ id: "good-roads-glow", type: "line", source: "good-roads", minzoom: GOOD_ROADS_ZOOM, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#6A4CFF", "line-width": pointedAt(14, 0), "line-blur": 5, "line-opacity": pointedAt(0.55, 0) } }, "route-casing");
    map.addLayer({ id: "good-roads-casing", type: "line", source: "good-roads", minzoom: GOOD_ROADS_ZOOM, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": pointedAt(7, 5), "line-opacity": pointedAt(0.9, 0.5) } }, "route-casing");
    map.addLayer({ id: "good-roads-line", type: "line", source: "good-roads", minzoom: GOOD_ROADS_ZOOM, layout: { "line-join": "round" }, paint: { "line-color": "#6A4CFF", "line-width": pointedAt(3.5, 2.6), "line-opacity": pointedAt(1, 0.62), "line-dasharray": ["literal", [2, 1.6]] } }, "route-casing");
    // A wide, invisible line to point at: a 3.5 px one is hard to hit.
    map.addLayer({ id: "good-roads-hit", type: "line", source: "good-roads", minzoom: GOOD_ROADS_ZOOM, paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0.01 } }, "route-casing");
    map.on("mousemove", "good-roads-hit", (event) => hoverRoad(event));
    map.on("mouseleave", "good-roads-hit", () => hoverRoad(null));
    showGoodRoads();
    mapReady = true;
    syncRoadsKey();
    drawRoute();
    drawPins();
    if (routable()) fitRoute();
  });
  map.on("click", onMapClick);
  map.on("moveend", placeChips);
  map.on("zoomend", syncRoadsKey);
  map.on("moveend", () => {
    const center = map.getCenter();
    store.set(VIEW_KEY, { center: [Number(center.lng.toFixed(4)), Number(center.lat.toFixed(4))], zoom: Number(map.getZoom().toFixed(2)) });
  });
  map.on("movestart", closeClickMenu);
}

/// The visitor's town, roughly, from carve.run's own edge (no prompt, no
/// third party): the map starts there unless they've already moved it.
async function startNearVisitor() {
  if (LOCAL) return;
  try {
    const response = await fetch("/where", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!response.ok) return;
    const { lat, lon } = await response.json();
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (map.getZoom() > 4 || plan.start || plan.end) return;
    map.jumpTo({ center: [lon, lat], zoom: 9 });
  } catch {
    // The whole country, then.
  }
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

// ── good roads: Carve's drives on the map ────────────────────────────
// Every one of Carve's drives in view, a dashed violet line (the app's
// Explore roads), from the planner's first look, route or no route.
// Pointing at one shows its name beside the cursor; a click on it is a
// click on the map (its menu: Start here, Add a stop…), with the road's
// card beside the menu. No adding a whole road: from a start to a
// destination it pulled the route miles the wrong way and back (the user,
// 2026-10-29).

/// The map's key: what the dashed lines are, while they're on the map.
function syncRoadsKey() {
  $("legend").hidden = !mapReady || saved || map.getZoom() < GOOD_ROADS_ZOOM;
}

/// Below this zoom, a country of dashed lines is a tangle, not roads.
const GOOD_ROADS_ZOOM = 6;
let roadsByToken = new Map();

async function showGoodRoads() {
  let rows = [];
  try {
    const response = await fetch("/drives/roads.json", { cache: "default" });
    if (response.ok) rows = await response.json();
  } catch {
    // No roads, then: the planner works the same without them.
  }
  if (!Array.isArray(rows) || !mapReady) return;
  roadsByToken = new Map(rows.map((road) => [road.t, road]));
  map.getSource("good-roads").setData({
    type: "FeatureCollection",
    features: rows.filter((road) => lineOf(road).length >= 2).map((road) => ({
      type: "Feature", geometry: { type: "LineString", coordinates: lineOf(road) }, properties: { t: road.t },
    })),
  });
}

const roadAt = (point) => {
  if (!map.getLayer("good-roads-hit")) return null;
  const token = map.queryRenderedFeatures(point, { layers: ["good-roads-hit"] })[0]?.properties?.t;
  return token ? roadsByToken.get(token) : null;
};

/// The road's bend, white in its level's colour, as the apps mark it.
function twistMark(road, size = 14) {
  const l = level(road.b);
  if (!l) return "";
  return `<span class="twist" style="background:${l.colour}" title="${l.title}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${l.path}" fill="none" stroke="#fff" stroke-width="${l.weight + 0.6}" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

/// The name beside the cursor while it's on a road; gone off it.
let pointedRoad = null;
function hoverRoad(event) {
  const tag = $("road-hover");
  const road = event && !saved ? roadAt(event.point) : null;
  // The road pointed at stands out from the rest.
  if ((road?.t ?? null) !== pointedRoad) {
    if (pointedRoad) map.setFeatureState({ source: "good-roads", id: pointedRoad }, { hover: false });
    pointedRoad = road?.t ?? null;
    if (pointedRoad) map.setFeatureState({ source: "good-roads", id: pointedRoad }, { hover: true });
  }
  if (!road) {
    tag.hidden = true;
    map.getCanvas().style.cursor = "";
    return;
  }
  map.getCanvas().style.cursor = "pointer";
  if (tag.dataset.t !== road.t) {
    tag.dataset.t = road.t;
    tag.innerHTML = `${twistMark(road)}<span>${escapeHTML(road.n)}</span>`;
  }
  tag.style.transform = `translate(${event.point.x + 16}px, ${event.point.y - 44}px)`;
  tag.hidden = false;
}

/// The road, as the click menu's header: its picture, name, how twisty,
/// length and time, and its page.
function roadHeader(road) {
  const head = el("div", "road-head");
  const l = level(road.b);
  const length = Number.isFinite(road.m) ? formatDistance(road.m * 1609.344, miles) : null;
  const facts = [
    l ? `<span class="lvl" style="color:${l.colour}">${l.title}</span>` : "",
    length ? `${length.value} ${length.unit}` : "",
    Number.isFinite(road.min) ? formatDuration(road.min * 60) : "",
  ].filter(Boolean).map((f) => `<span class="fig">${f}</span>`).join("");
  head.innerHTML = `
    ${road.i ? `<img src="${escapeHTML(road.i)}" alt="">` : ""}
    <div class="rh-body">
      <div class="rh-name">${twistMark(road, 13)}<b>${escapeHTML(road.n)}</b></div>
      <div class="rh-facts">${facts}</div>
      <a href="/drives/${encodeURIComponent(road.s)}/" target="_blank" rel="noopener">About this road →</a>
    </div>`;
  return head;
}

/// The plan's points in order, as [lon, lat]: start, waypoints, end (the
/// start again on a loop).
function chainPoints() {
  const points = [plan.start, ...plan.waypoints];
  points.push(loops() ? plan.start : plan.end);
  return points.filter(Boolean).map((p) => [p.lon, p.lat]);
}

const routePace = () => (plan.path?.durationSeconds > 0 ? plan.path.distanceMeters / plan.path.durationSeconds : NaN);

/// What a plan is, for telling whether it's still the drive it came from:
/// its ends, its points and their kinds, its trip and its name.
function roadShape() {
  const at = (p) => (p ? [p.lat, p.lon] : null);
  return JSON.stringify([at(plan.start), at(plan.end), plan.waypoints.map((w) => [w.lat, w.lon, w.type, w.stayMinutes || 0]), plan.trip, plan.name || ""]);
}

/// "Drive the whole road": in where it adds least, from the nearer end;
/// its first end named for the road, points along it to keep the router
/// on it, its far end by the catalog's name (the app's PlanRoads.points).
/// With no route yet, it is the route: its ends the start and the end.
function driveWholeRoad(road) {
  const placed = wholeRoad(road, chainPoints(), routePace());
  const points = roadPoints(placed);
  const spot = (p) => ({ id: newUUID(() => crypto.randomUUID()), lat: round(p.at[1]), lon: round(p.at[0]), label: p.label ? clip(p.label, MOST_LABEL_CHARACTERS) : null });
  const fresh = !plan.start && !plan.end;
  const added = fresh ? points.slice(1, -1) : points;
  if (plan.waypoints.length + added.length > MAX_WAYPOINTS) {
    return toast(`A route holds up to ${MAX_WAYPOINTS} stops and waypoints.`, true);
  }
  edit(() => {
    if (fresh) {
      plan.start = spot(points[0]);
      if (!loops()) plan.end = spot(points[points.length - 1]);
    }
    const at = fresh || !plan.start ? plan.waypoints.length : Math.min(placed.index, plan.waypoints.length);
    plan.waypoints.splice(at, 0, ...added.map((p) => ({ ...spot(p), type: "marker" })));
  });
  // The whole plan is this drive: Save opens its page while it stays so.
  plan.fromRoad = fresh ? { slug: road.s, shape: roadShape() } : null;
  saveDraft();
  const length = Number.isFinite(road.m) ? formatDistance(road.m * 1609.344, miles) : null;
  toast(`Added ${road.n}${length ? `: +${length.value} ${length.unit}, about ${formatDuration(fresh ? placed.roadSeconds : placed.seconds)}` : ""}.`);
}

/// Straight lines between the points while the road is on its way.
function chainLine() {
  const points = [plan.start, ...plan.waypoints, loops() ? plan.start : plan.end].filter(Boolean);
  return points.map((p) => [p.lon, p.lat]);
}

/// The app's marks: a flag for the start, a checkered flag for the end.
const MARKS = {
  start: '<svg aria-hidden="true"><use href="#i-flag"/></svg>',
  dest: '<svg aria-hidden="true"><use href="#i-flag-checkered"/></svg>',
};

/// A pin: the map moves the wrapper, so the mark inside can grow on hover
/// without its scale carrying the pin's position off with it.
function pinElement(kind, label) {
  const wrap = document.createElement("div");
  wrap.className = "pin-wrap";
  const el = document.createElement("div");
  el.className = `pin ${kind}`;
  if (kind === "start" || kind === "dest") el.innerHTML = MARKS[kind];
  else if (label) el.textContent = label;
  wrap.append(el);
  wrap.addEventListener("click", (event) => event.stopPropagation());
  return wrap;
}

function drawPins() {
  if (!mapReady) return;
  for (const marker of pins) marker.remove();
  pins.length = 0;
  const labels = markerLabels(plan.waypoints);
  const add = (point, kind, label, onMove, title) => {
    const el = pinElement(kind, label);
    el.setAttribute("aria-label", title);
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([point.lon, point.lat]).addTo(map);
    el.addEventListener("mouseenter", () => showPinTip(point, kind, label, marker));
    el.addEventListener("mouseleave", hidePinTip);
    marker.on("dragstart", hidePinTip);
    marker.on("dragend", () => {
      const { lng, lat } = marker.getLngLat();
      edit(() => onMove(round(lat), round(lng)));
      if (kind === "stop" || kind === "start" || kind === "dest") nameSpot(point);
    });
    pins.push(marker);
  };
  if (plan.start) add(plan.start, "start", "", (lat, lon) => Object.assign(plan.start, { lat, lon, label: plan.start.label }), "Start: drag to move");
  plan.waypoints.forEach((w, i) => add(w, w.type === "stop" ? "stop" : "wp", labels[i], (lat, lon) => Object.assign(w, { lat, lon, road: null, ...(w.type === "stop" ? {} : { label: null }) }), w.type === "stop" ? "Stop: drag to move" : "Waypoint: drag to move"));
  if (plan.end && !loops()) add(plan.end, "dest", "", (lat, lon) => Object.assign(plan.end, { lat, lon }), "Destination: drag to move");
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/// Over a pin: what it is, its place, a stop's stay, and that it moves.
function showPinTip(point, kind, label, marker) {
  const what = { start: "Start", dest: "Destination", stop: `Stop ${label}`, wp: `Waypoint ${label}` }[kind];
  const name = point.label || (point.road ? `On ${point.road}` : kind === "start" || kind === "dest" ? "" : "On the route");
  const stay = kind === "stop" && point.stayMinutes ? `Stay ${stayWords(point.stayMinutes)}` : "";
  const tip = $("pin-tip");
  tip.innerHTML = `<b class="pt-${kind}">${what}</b>${name ? `<span>${escapeHTML(name)}</span>` : ""}${stay ? `<span class="dim">${stay}</span>` : ""}<span class="dim small">Drag to move</span>`;
  const at = map.project(marker.getLngLat());
  tip.hidden = false;
  tip.style.transform = `translate(${Math.round(at.x - tip.offsetWidth / 2)}px, ${Math.round(at.y - tip.offsetHeight - 30)}px)`;
  marker.getElement().style.zIndex = "5";
}
function hidePinTip() {
  $("pin-tip").hidden = true;
  for (const marker of pins) marker.getElement().style.zIndex = "";
}

function markBadge(kind) {
  const badge = el("span", `badge ${kind}`);
  badge.innerHTML = MARKS[kind];
  return badge;
}

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
  // A click away from an open menu only closes it.
  if (!$("click-menu").hidden) return closeClickMenu();
  const { lng, lat } = event.lngLat;
  menuAt = { lat: round(lat), lon: round(lng) };
  // The marks the rows use: flags for the ends, the next letter or number.
  const stops = stopCount();
  const nextStop = markerLabels([...plan.waypoints.filter((w) => w.type === "stop"), { type: "stop" }]).pop();
  const nextWaypoint = String(plan.waypoints.length - stops + 1);
  // Always in this order; the likeliest lit (the user, 2026-10-29).
  const choices = [
    { key: "start", label: "Start here", icon: `<span class="badge start">${MARKS.start}</span>` },
    { key: "wp", label: "Add a waypoint", icon: `<span class="badge wp">${nextWaypoint}</span>` },
    { key: "stop", label: "Add a stop", icon: `<span class="badge stop">${nextStop}</span>` },
  ];
  if (!loops()) choices.push({ key: "end", label: "End here", icon: `<span class="badge dest">${MARKS.dest}</span>` });
  const likeliest = !plan.start ? "start" : !plan.end && !loops() ? "end" : "wp";
  const menu = $("click-menu");
  menu.innerHTML = "";
  const item = (html, onPick, className = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    if (className) button.className = className;
    button.innerHTML = html;
    button.addEventListener("click", () => {
      closeClickMenu();
      onPick();
    });
    menu.append(button);
    return button;
  };
  // On one of Carve's drives: the road first, then what to do here.
  const point = event.point;
  const road = roadAt(point);
  menu.classList.toggle("with-road", !!road);
  if (road) menu.append(roadHeader(road));
  let lit = null;
  for (const choice of choices) {
    const button = item(`${choice.icon}<span>${choice.label}</span>`, () => placeAt(choice.key, menuAt));
    if (choice.key === likeliest) (lit = button).classList.add("on");
  }
  if (road) {
    const whole = wholeRoad(road, chainPoints(), routePace());
    const length = Number.isFinite(road.m) ? formatDistance(road.m * 1609.344, miles) : null;
    const time = chainPoints().length ? `adds about ${formatDuration(whole.seconds)}` : `about ${formatDuration(whole.roadSeconds)}`;
    item(`<span class="badge whole"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20C5 13 19 15 19 8V4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="3.2 3"/></svg></span><span class="two"><span>Drive the whole road</span><small>${length ? `${length.value} ${length.unit} · ` : ""}${time}</small></span>`, () => driveWholeRoad(road), "whole");
  }
  item("Cancel", () => {}, "cancel");
  const box = map.getContainer().getBoundingClientRect();
  menu.hidden = false;
  const width = menu.offsetWidth, height = menu.offsetHeight;
  // Beside the spot, kept on the map.
  menu.style.left = `${point.x + 18 + width <= box.width - 8 ? point.x + 18 : Math.max(8, point.x - 18 - width)}px`;
  menu.style.top = `${Math.max(12, Math.min(point.y - (road ? 160 : 110), box.height - height - 12))}px`;
  $("road-hover").hidden = true;
  tempPin?.remove();
  tempPin = new maplibregl.Marker({ element: pinElement("temp", "") }).setLngLat([lng, lat]).addTo(map);
  (lit || menu.querySelector("button")).focus();
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
  // Before there's a start, places go on in the order they're picked.
  if (!plan.start) return plan.waypoints.length;
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
    const { name, town } = await planner("reverse", { at: { lat: spot.lat, lon: spot.lon } });
    const target = [plan.start, plan.end, ...plan.waypoints].find((p) => p && p.id === spot.id);
    if (target && name) {
      target.label = clip(name, MOST_LABEL_CHARACTERS);
      if (town) target.town = town;
      else delete target.town;
      changed({ keepTyping: true });
    }
  } catch {
    // Unnamed is fine: the row says what it is.
  }
}

/// The start's and destination's towns, for the drive's name: looked up
/// once for an end that came without one (a Google link's, an import's).
function findTowns() {
  for (const end of [plan.start, plan.end]) {
    if (!end || end.town || end.townAsked) continue;
    end.townAsked = true;
    planner("reverse", { at: { lat: end.lat, lon: end.lon } })
      .then(({ town }) => {
        if (!town) return;
        end.town = town;
        changed({ keepTyping: true });
      })
      .catch(() => {});
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
    render({ keepTyping: true });
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
/// Which way in an empty panel shows: "plan" (the rows) or "import".
let startMode = "plan";

function setStartMode(mode) {
  startMode = mode;
  $("tab-plan").setAttribute("aria-selected", String(mode === "plan"));
  $("tab-import").setAttribute("aria-selected", String(mode === "import"));
  $("mode-note").textContent = mode === "import"
    ? "Already have a route? Paste a link from Google Maps, Ride with GPS or Carve, or open a GPX file."
    : "Plan a route by searching or clicking on the map.";
  render();
  if (mode === "import") $("link-in").focus();
}

function render({ keepTyping = false } = {}) {
  const hasAny = !!(plan.start || plan.end || plan.waypoints.length);
  // Once there's a route, the panel is the route: the switch goes, and an
  // import that just landed shows in the rows.
  if (hasAny && startMode !== "plan") {
    startMode = "plan";
    $("tab-plan").setAttribute("aria-selected", "true");
    $("tab-import").setAttribute("aria-selected", "false");
  }
  const importing = startMode === "import";
  $("intro").hidden = hasAny;
  $("bring").hidden = !importing;
  $("rows").hidden = importing;
  $("map-hint").hidden = hasAny || saved || !map;
  syncRoadsKey();
  $("undo").disabled = !history.back.length;
  $("redo").disabled = !history.forward.length;
  $("start-over").disabled = !hasAny && !plan.name;
  // The history buttons come with the first place.
  $("history-buttons").hidden = !hasAny && !history.back.length && !history.forward.length;
  // The trip only means something once there's a start.
  $("head-left").hidden = !plan.start;
  $("list-head").hidden = importing || ($("head-left").hidden && $("history-buttons").hidden);
  // The figures, the name and Save are there from the start, Save greyed
  // until there's a route; "Sign up or log in" stays under them for a guest
  // (the user, 2026-10-29).
  $("foot").hidden = importing;
  $("join").hidden = !!session;
  $("trip").value = plan.trip;
  if (document.activeElement !== $("route-name")) $("route-name").value = plan.name || "";
  renderNotice();
  if (keepTyping && typingInRows()) rowsWaiting = true;
  else {
    rowsWaiting = false;
    renderRows();
  }
  renderFigures();
  drawRoute();
  drawPins();
  findTowns();
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

function syncImportButton() {
  $("link-go").disabled = !$("link-in").value.trim();
}

function renderFigures() {
  const distance = plan.path ? formatDistance(plan.path.distanceMeters, miles) : null;
  roll($("fig-dist"), distance ? distance.value : "–");
  $("fig-dist-unit").textContent = distance ? distance.unit : miles ? "miles" : "km";
  const stays = plan.waypoints.reduce((sum, w) => sum + (w.type === "stop" ? w.stayMinutes || 0 : 0), 0);
  roll($("fig-time"), plan.path ? formatDuration(plan.path.durationSeconds + stays * 60) : "–");
  const stops = stopCount();
  roll($("fig-stops"), String(stops));
  $("fig-stops-unit").textContent = stops === 1 ? "stop" : "stops";
}

const STILL = window.matchMedia?.("(prefers-reduced-motion: reduce)");

/// A figure that rolls to its new value like a slot machine's reels (the
/// user, 2026-10-29): each digit a strip of 0–9 twice over, spun from the
/// digit it showed (or 0) to the new one on the second turn, left to right.
/// Only when it changes; still for reduced motion. Read aloud as text.
function roll(node, text) {
  if (node.dataset.shown === text) return;
  const before = node.dataset.shown || "";
  node.dataset.shown = text;
  if (STILL?.matches || !/\d/.test(text)) {
    node.textContent = text;
    return;
  }
  node.textContent = "";
  const spoken = el("span", "visually-hidden", text);
  const shown = el("span", "rolling");
  shown.setAttribute("aria-hidden", "true");
  node.append(spoken, shown);
  // The old digits, lined up from the right with the new ones.
  const old = before.padStart(text.length, " ").slice(-text.length);
  const reels = [];
  [...text].forEach((ch, i) => {
    // Not a digit: in a box like a reel's, so it sits on the same line.
    if (!/\d/.test(ch)) return shown.append(el("span", "slot", ch === " " ? "\u00a0" : ch));
    const slot = el("span", "slot");
    const reel = el("span", "reel");
    reel.innerHTML = "0123456789".repeat(2).split("").map((d) => `<span>${d}</span>`).join("");
    const from = /\d/.test(old[i]) ? Number(old[i]) : 0;
    reel.style.transform = `translateY(${-from * 5}%)`;
    slot.append(reel);
    shown.append(slot);
    reels.push([reel, 10 + Number(ch), reels.length]);
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const [reel, to, order] of reels) {
      reel.style.transitionDelay = `${order * 70}ms`;
      reel.style.transform = `translateY(${-to * 5}%)`;
    }
  }));
}

function renderRows() {
  const list = $("rows");
  list.innerHTML = "";
  const labels = markerLabels(plan.waypoints);
  list.append(placeRow({ role: "start", point: plan.start, placeholder: "Choose a start" }));
  plan.waypoints.forEach((w, i) => list.append(placeRow({ role: "waypoint", point: w, index: i, label: labels[i] })));
  // Always there, even empty, so the list reads start, stops, destination
  // (the user, 2026-10-29).
  list.append(addRow());
  if (loops()) {
    const li = el("li", "row dest");
    li.append(markBadge("dest"), textCell(plan.trip === "outAndBack" ? "Back the same way to the start" : "Back to the start"));
    list.append(li);
  } else {
    list.append(placeRow({ role: "end", point: plan.end, placeholder: "Choose a destination" }));
  }
  // The empty panel already says to search or click the map.
  $("rows-hint").hidden = plan.waypoints.length < 2 || startMode === "import";
  $("rows-hint").textContent = "Drag a row to reorder.";
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
  if (role === "start") li.append(markBadge("start"));
  else if (role === "end") li.append(markBadge("dest"));
  else li.append(el("span", `badge ${point.type === "stop" ? "stop" : "wp"}`, label));

  const cell = el("div", "cell");
  const wrap = el("span", "input-wrap");
  const input = el("input", `row-input${point ? "" : " empty"}`);
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = rowName(point, role);
  input.title = input.value;
  input.placeholder = placeholder || "Search for a place";
  input.setAttribute("aria-label", role === "start" ? "Start" : role === "end" ? "Destination" : `${point.type === "stop" ? "Stop" : "Waypoint"} ${label}`);
  input.dataset.focus = role === "waypoint" ? `w${index}` : role;
  wrap.append(input);
  if (role === "waypoint" && point.type === "stop") {
    input.classList.add("timed");
    wrap.append(stayControl(point));
  }
  const line = el("div", "field-line");
  line.append(wrap);
  if (role === "waypoint") line.append(kindSwitch(point));
  cell.append(line);
  li.append(cell);
  attachSearch(li, input, (place) => choosePlace(role, index, place));

  // Only what's between the ends moves; the start and destination stay put.
  const movable = role === "waypoint";
  const grip = el(movable ? "button" : "span", `grip${movable ? "" : " off"}`);
  if (movable) {
    grip.type = "button";
    grip.innerHTML = '<svg aria-hidden="true"><use href="#i-grip"/></svg>';
    grip.setAttribute("aria-label", "Drag to reorder. Or use the arrow keys.");
  }
  li.append(grip);
  if (movable) makeDraggable(li, grip, index);
  else if (role === "end") acceptDrops(li, plan.waypoints.length);
  // Removing takes the whole row, so it sits outside the field, past the
  // handle, and shows when the row is pointed at.
  if (point) {
    const clear = el("button", "clear", "×");
    clear.type = "button";
    clear.setAttribute("aria-label", "Remove this row");
    clear.title = "Remove";
    clear.addEventListener("click", () => removePoint(role, index));
    li.append(clear);
  } else {
    li.append(el("span", "clear off"));
  }
  return li;
}

/// Stop or waypoint: a quiet dropdown beside the field.
function kindSwitch(point) {
  return kindSelect(point.type === "stop" ? "stop" : "marker", (type) => {
    edit(() => {
      point.type = type;
      if (type !== "stop") delete point.stayMinutes;
    }, { geometry: false });
    if (type === "stop" && !point.label) nameSpot(point);
  });
}

function kindSelect(value, onChange) {
  const wrap = el("span", "kind");
  const select = el("select");
  select.setAttribute("aria-label", "Stop or waypoint");
  select.append(new Option("Waypoint", "marker"), new Option("Stop", "stop"));
  select.value = value;
  select.addEventListener("change", () => {
    if (select.value === "stop" && stopCount() >= MAX_STOPS) {
      select.value = "marker";
      return toast(`A route has up to ${MAX_STOPS} stops.`, true);
    }
    onChange(select.value);
  });
  wrap.append(select);
  wrap.insertAdjacentHTML("beforeend", '<svg aria-hidden="true"><use href="#i-chev"/></svg>');
  return wrap;
}

/// How long a stop's stay is: a timer button, filled once there's a time.
function stayControl(point) {
  const stayText = (minutes) => `Stay ${minutes < 60 ? `${minutes} min` : formatDuration(minutes * 60).replace(" h", " hr")}`;
  const stay = el("span", `stay${point.stayMinutes ? " set" : ""}`);
  stay.innerHTML = '<svg aria-hidden="true"><use href="#i-clock"/></svg>';
  stay.title = point.stayMinutes ? stayText(point.stayMinutes) : "Add stay time";
  const select = el("select");
  select.setAttribute("aria-label", point.stayMinutes ? `Time to stay: ${stayText(point.stayMinutes)}` : "Add stay time");
  select.append(new Option("No stay time", "0"));
  for (const minutes of STAY_CHOICES) select.append(new Option(stayText(minutes), String(minutes)));
  select.value = String(point.stayMinutes || 0);
  select.addEventListener("change", () => edit(() => {
    const minutes = Number(select.value);
    if (minutes) point.stayMinutes = minutes;
    else delete point.stayMinutes;
  }, { geometry: false }));
  stay.append(select);
  return stay;
}

/// What the next added place becomes; waypoint unless chosen otherwise.
let addType = "marker";

function addRow() {
  const li = el("li", "row");
  li.dataset.role = "add";
  li.append(el("span", "badge new", "+"));
  const cell = el("div", "cell");
  const line = el("div", "field-line");
  cell.append(line);
  li.append(cell);
  // A plain search field, like the start's and the destination's: a pick
  // becomes a waypoint, whose row then has the Stop/Waypoint dropdown; it
  // works before there's a start or a destination (the user, 2026-10-29).
  const wrap = el("span", "input-wrap");
  const input = el("input", "row-input empty");
  input.placeholder = "Add a stop or waypoint";
  input.setAttribute("aria-label", "Add a stop or waypoint");
  input.dataset.focus = "add";
  wrap.append(input);
  line.append(wrap);
  li.append(el("span", "grip off"), el("span", "clear off"));
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
  if (role === "add" && plan.waypoints.length >= MAX_WAYPOINTS) {
    return toast(`A route holds up to ${MAX_WAYPOINTS} stops and waypoints.`, true);
  }
  const spot = { id: newUUID(() => crypto.randomUUID()), lat: place.lat, lon: place.lon, label: clip(place.name, MOST_LABEL_CHARACTERS), ...(place.town ? { town: place.town } : {}) };
  edit(() => {
    if (role === "start") plan.start = spot;
    else if (role === "end") plan.end = spot;
    else if (role === "waypoint") Object.assign(plan.waypoints[index], { lat: spot.lat, lon: spot.lon, label: spot.label, road: null });
    else {
      const type = addType === "stop" && stopCount() < MAX_STOPS ? "stop" : "marker";
      if (addType === "stop" && type !== "stop") toast(`A route has up to ${MAX_STOPS} stops, so this one is a waypoint.`);
      addType = "marker";
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

// typeahead: three letters and a pause, then up to six places near the map.
// Suggestions say where they are only once picked: the pair is one Search
// Box session, which a pick ends.
function attachSearch(li, input, onPick, onLeave) {
  let timer = 0;
  let results = [];
  let active = 0;
  let list = null;
  let session = crypto.randomUUID();
  const original = input.value;
  const pick = async (suggestion) => {
    // Already placed (an answer from before suggestions): nothing to look up.
    if (Number.isFinite(suggestion.lat) && Number.isFinite(suggestion.lon)) return onPick(suggestion);
    try {
      const data = await planner("place", { id: suggestion.id, session });
      session = crypto.randomUUID();
      onPick({ ...data.place, name: suggestion.name });
    } catch (failure) {
      toast(failure.message, true);
    }
  };
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
        pick(place);
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
        const data = await planner("search", { query, session, ...(near ? { near: { lat: near.lat, lon: near.lng } } : {}) });
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
      pick(place);
    }
  });
  input.addEventListener("focus", () => input.select());
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      // Choosing stop or waypoint for a new row keeps the row open.
      if (document.activeElement?.closest?.(".kind") && li.contains(document.activeElement)) return;
      close();
      if (input.value !== original) input.value = original;
      onLeave?.();
      rowsAfterTyping();
    }, 120);
  });
}

// drag to reorder the stops and waypoints (and the arrow keys on the handle)
let dragFrom = null;
function makeDraggable(li, grip, index) {
  grip.addEventListener("pointerdown", () => (li.draggable = true));
  li.addEventListener("dragstart", (event) => {
    dragFrom = index;
    li.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
  });
  li.addEventListener("dragend", () => {
    li.draggable = false;
    li.classList.remove("dragging");
    document.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"));
  });
  acceptDrops(li, index);
  grip.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const to = Math.max(0, Math.min(index + (event.key === "ArrowUp" ? -1 : 1), plan.waypoints.length - 1));
    if (to === index) return;
    move(index, to);
    focusAfterRender = `[data-role="waypoint"][data-index="${to}"] .grip`;
    renderRows();
  });
}

/// A row a dragged stop or waypoint can be dropped on, landing before it
/// (the destination's row: after the last one).
function acceptDrops(li, slot) {
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
    if (from === null) return;
    move(from, slot > from ? slot - 1 : slot);
  });
}

/// Moves a stop or waypoint to another place between the ends.
function move(from, to) {
  const count = plan.waypoints.length;
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) return;
  edit(() => {
    const [item] = plan.waypoints.splice(from, 1);
    plan.waypoints.splice(to, 0, item);
  });
}

// ── bringing a route in ──────────────────────────────────────────────

async function importLink(text) {
  const link = linkKind(text);
  if (!link || link.kind === "unknown") return toast("That link isn't one Carve can read. Try a Google Maps, Ride with GPS or Carve link.", true);
  busy(true, "Bringing it in…");
  try {
    if (link.kind === "rwgps") {
      // The track goes to the planner next: have the pass before asking.
      if (!session) await fetchPass();
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
    syncImportButton();
  } catch (failure) {
    toast(failure.message, true);
  } finally {
    busy(false);
  }
}

async function importTrack(track, source) {
  const epoch = planEpoch;
  const { route } = await planner("import", { track: track.track, places: track.places, name: track.name });
  if (epoch !== planEpoch) return;
  remember();
  settle();
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
  // A place the track's maker named at an end names it ("BJ's Restaurants",
  // not the street it's on), as the importer's stops are named (the user,
  // 2026-10-29); the same 200 m as the importer's end reach.
  for (const spot of [plan.start, plan.end]) {
    const place = spot && (track.places || []).find((p) => p.name && meters(p, spot) <= 200);
    if (place) spot.label = clip(place.name, MOST_LABEL_CHARACTERS);
  }
  nameWaypointsByRoad();
  changed();
  fitRoute();
  // Ends with no name of their own: look them up for the list.
  if (!plan.start.label) nameSpot(plan.start);
  if (plan.end && !plan.end.label) nameSpot(plan.end);
}

function loadStops(route, source) {
  remember();
  settle();
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
  const epoch = planEpoch;
  const rows = await rest("/rest/v1/rpc/redeem_share_token", { method: "POST", body: { share_token: token } });
  if (epoch !== planEpoch) return;
  const payload = rows?.[0]?.payload;
  if (!payload) throw new Failure("That Carve link couldn't be found.");
  settle();
  const all = payload.allWaypoints?.length > (payload.waypoints?.length || 0) ? payload.allWaypoints : payload.waypoints || [];
  remember();
  plan = {
    ...blankPlan(),
    name: payload.name || "",
    start: spotFrom(payload.start),
    end: payload.tripType === "roundtrip" ? null : spotFrom(payload.end),
    waypoints: all.map((w) => ({
      ...spotFrom({ ...w.location, label: typeof w.label === "string" ? w.label : "" }),
      type: w.type === "stop" ? "stop" : "marker",
      // A stay is a whole number of minutes, whatever the link's route says.
      ...(Number.isInteger(w.stayMinutes) && w.stayMinutes > 0 && w.stayMinutes <= 1440 ? { stayMinutes: w.stayMinutes } : {}),
    })),
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

/// Edit from a route's page (/plan/?edit=<token>): the owner's route, to
/// change and save in place; anyone else's, a copy to make their own.
async function editShared(token) {
  if (!/^[A-Za-z0-9]{10}$/.test(token)) return;
  busy(true, "Opening your route…");
  try {
    const rows = await rest("/rest/v1/rpc/redeem_share_token", { method: "POST", body: { share_token: token } });
    const row = rows?.[0];
    if (!row) throw new Failure("That route couldn't be found.");
    // The share keeps its owner private: the routes table answers its owner.
    const owned = session ? await rest(`/rest/v1/routes?id=eq.${encodeURIComponent(String(row.id).toLowerCase())}&select=owner_id`).catch(() => null) : null;
    const mine = !!owned?.[0] && String(owned[0].owner_id).toLowerCase() === String(session.user.id).toLowerCase();
    await importCarve(token);
    if (mine) {
      const payload = row.payload || {};
      plan.id = String(payload.id || row.id).toUpperCase();
      plan.token = token;
      plan.createdAt = payload.createdAt || null;
      plan.ownerId = session.user.id;
      plan.imported = null;
      plan.kept = {
        ...(payload.photo ? { photo: payload.photo } : {}),
        ...(payload.author ? { author: payload.author } : {}),
      };
      changed();
    } else {
      toast("That's someone else's route. Saving makes a copy of your own.");
    }
  } catch (failure) {
    toast(failure.message, true);
  } finally {
    busy(false);
  }
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
  // One of Carve's drives, whole and untouched: its own page, with more
  // than a copy would have (the user, 2026-10-29). Changed at all, it's
  // the planner's own route.
  if (plan.fromRoad && plan.fromRoad.shape === roadShape()) {
    location.href = `/drives/${encodeURIComponent(plan.fromRoad.slug)}/`;
    return;
  }
  // A name the planner made follows the route ("From El Granada" moved to
  // Belmont is "From Belmont"); one they typed is theirs.
  const typed = clip($("route-name").value, MOST_NAME_CHARACTERS);
  // The field holds the made name until someone changes it.
  const madeHere = !typed || (plan.nameMade && typed === plan.madeName);
  plan.name = madeHere ? suggestedName() : typed;
  plan.nameMade = madeHere;
  plan.madeName = madeHere ? plan.name : null;
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
/// An end's town: the one it was found in, or (until that's known) its
/// name up to the first comma.
const town = (point) => point?.town || (point?.label ? point.label.split(",")[0].trim() : null) || null;

/// Town to town: "Escondido to Julian", never street to street.
function suggestedName() {
  const from = town(plan.start);
  const to = loops() ? null : town(plan.end);
  if (from && to) return `${from} to ${to}`;
  return from ? `From ${from}` : "My drive";
}

/// After the save: elevation and curves for the card, then the summary
/// the app shows, written by the same `describe` function and saved onto
/// the route so the phone has them too.
async function enrich() {
  // All of this is for the road just saved: an edit since (Edit, then a
  // change) or a new plan drops what arrives for the old one.
  const road = plan.path;
  const same = () => saved && plan.path === road;
  const path = road.geometry;
  try {
    if (!plan.profile) {
      const profiled = await planner("profile", { path });
      if (!same()) return;
      plan.profile = profiled;
    }
    plan.elevationProfile = plan.profile.elevationProfile || null;
    renderSavedFacts();
  } catch {
    // The card reads fine without them.
  }
  if (!same()) return;
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
    if (!same()) return;
    plan.blurb = clip(data.description, 600);
  } catch {
    if (!same()) return;
    plan.blurb = null;
  }
  renderBlurb();
  if (plan.blurb || plan.elevationProfile) {
    try {
      if (!same()) return;
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
  $("legend").hidden = true;
  $("saved-view").hidden = false;
  $("map-hint").hidden = true;
  closeClickMenu();
  $("s-name").textContent = plan.name;
  const ends = [town(plan.start), loops() ? "back" : town(plan.end)].filter(Boolean).join(" → ");
  const tripWord = { oneWay: "One way", roundTrip: "Round trip", outAndBack: "Out and back" }[plan.trip];
  const stops = stopCount();
  $("s-sub").textContent = [ends, tripWord, stops ? `${stops} stop${stops === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  $("link-out").value = shareLink().replace("https://", "");
  drawQR();
  renderSavedFacts();
  renderBlurb(true);
  renderAlong();
  renderNearby();
}

/// The start, the stops and waypoints, the end, with the map's marks.
function renderAlong() {
  const list = $("along-list");
  list.innerHTML = "";
  const labels = markerLabels(plan.waypoints);
  const row = (badge, name) => {
    const li = el("li");
    li.append(badge, el("span", "", name));
    list.append(li);
  };
  if (plan.start) row(markBadge("start"), plan.start.label || "Start");
  plan.waypoints.forEach((w, i) => row(el("span", `badge ${w.type === "stop" ? "stop" : "wp"}`, labels[i]), w.label || (w.type === "stop" ? `Stop ${labels[i]}` : w.road || `Waypoint ${labels[i]}`)));
  if (loops()) row(markBadge("dest"), "Back to the start");
  else if (plan.end) row(markBadge("dest"), plan.end.label || "Destination");
  $("along-unit").hidden = list.childElementCount < 2;
}

/// Up to four of Carve's drives within about 250 km of the start
/// (drives/near.json, as a shared route's page lists them).
let nearbyAsk = 0;
async function renderNearby() {
  const ask = ++nearbyAsk;
  const box = $("near-cards");
  box.innerHTML = "";
  $("near-unit").hidden = true;
  if (!plan.start) return;
  try {
    const response = await fetch("/drives/near.json", { cache: "default" });
    if (!response.ok) return;
    const all = await response.json();
    if (ask !== nearbyAsk) return;
    const near = all
      .map((d) => [meters({ lat: d.a, lon: d.o }, plan.start), d])
      .filter(([m]) => m < 250000)
      .sort((x, y) => x[0] - y[0])
      .slice(0, 4);
    for (const [, d] of near) {
      const a = el("a");
      a.href = `/drives/${d.s}/`;
      const img = el("img");
      img.src = d.c;
      img.alt = "";
      img.loading = "lazy";
      const length = miles ? `${d.m} mi` : `${Math.round(d.m * 1.609344)} km`;
      a.append(img, el("span", "n", d.n), el("span", "m", length));
      const li = el("li");
      li.append(a);
      box.append(li);
    }
    $("near-unit").hidden = !near.length;
  } catch {
    // Nothing near, then.
  }
}

function renderSavedFacts() {
  const facts = $("s-facts");
  facts.innerHTML = "";
  $("elev-unit").hidden = true;
  $("curve-unit").hidden = true;
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

/// "30 min", "2 hr", "1 hr 30": as the stop's timer lists it.
const stayWords = (minutes) => (minutes < 60 ? `${minutes} min` : formatDuration(minutes * 60).replace(" h", " hr"));

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
      rows += `<tr class="stoprow"><td class="n"></td><td class="ic"><svg viewBox="0 0 24 24">${ARROWS.stop}</svg></td><td>Stop ${stop.label} · ${escapeHTML(stop.name)}${stop.stay ? ` · stay ${stayWords(Number(stop.stay))}` : ""}</td><td class="d"></td><td class="m">${((mile + t.distanceMeters) / unitMeters).toFixed(1)}</td></tr>`;
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
/// Sign-in: to save the drive, or (`saving: false`) to keep planning
/// once a guest's share runs out.
let saveAfterSignIn = true;
function openAccount(step = "choose", { saving = true, title } = {}) {
  saveAfterSignIn = saving;
  $("acc-title").textContent = title || (saving ? "Sign in to save your route" : "Keep planning");
  // What an account is for, in a line (the user, 2026-10-29).
  $("acc-sub").textContent = saving
    ? "Then it will be ready to drive in the Carve app with turn-by-turn, offline maps, CarPlay and Android Auto, and live group tracking."
    : "Then your routes will be ready to drive in the Carve app with turn-by-turn, offline maps, CarPlay and Android Auto, and live group tracking.";
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
  store.set(PENDING_SAVE_KEY, saveAfterSignIn);
  if (!storageWorks) {
    accountError("This browser isn't keeping data, so signing in with " + (provider === "apple" ? "Apple" : "Google") + " would lose your route. Use email instead.");
    return;
  }
  // A return is only taken in the browser that set off this sign-in, within
  // a quarter hour (a link carrying someone else's tokens would sign the
  // visitor in as them: the QA pass, 2026-10-29). The return address stays
  // exactly the one allowed in Supabase.
  store.set(OAUTH_STATE_KEY, Date.now());
  const back = `${location.origin}/plan/`;
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(back)}`;
}

async function afterSignIn() {
  renderWho();
  const found = await loadProfile().catch(() => null);
  if (!found) return setStep("username");
  $("account").close();
  const pendingEdit = store.get(PENDING_EDIT_KEY);
  if (pendingEdit) {
    store.remove(PENDING_EDIT_KEY);
    return editShared(pendingEdit);
  }
  if (saveAfterSignIn) await save();
}

function renderWho() {
  const signedIn = !!session;
  $("sign-in").hidden = signedIn;
  $("who").hidden = !signedIn;
  // "No account until you save" is for guests.
  if (signedIn) $("join").hidden = true;
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
  // Anything still on its way belongs to the plan being cleared.
  settle();
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
  // A click anywhere off the map menu closes it (the map's own clicks do
  // that in onMapClick, so they don't also open a new one).
  document.addEventListener("pointerdown", (event) => {
    if ($("click-menu").hidden || $("click-menu").contains(event.target) || $("map").contains(event.target)) return;
    closeClickMenu();
  });
  $("redo").addEventListener("click", redo);
  $("start-over").addEventListener("click", () => $("start-over-dialog").showModal());
  $("start-over-dialog").addEventListener("close", () => {
    if ($("start-over-dialog").returnValue !== "clear") return;
    planAnother();
    if (mapReady) map.easeTo({ zoom: Math.min(map.getZoom(), 9) });
  });
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
  $("trip").addEventListener("change", () => setTrip($("trip").value));
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
    if ($("link-in").value.trim()) importLink($("link-in").value);
  });
  // Import lights up green once there's a link to import (the user, 2026-10-29).
  $("link-in").addEventListener("input", syncImportButton);
  syncImportButton();
  $("gpx-btn").addEventListener("click", () => $("gpx").click());
  $("gpx").addEventListener("change", () => importFile($("gpx").files[0]));
  const app = document.querySelector(".app");
  // On the Import tab its drop box lights up for a file; elsewhere the
  // whole window does. Dropped anywhere, it comes in.
  const dropBox = $("gpx-btn");
  app.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    if (!$("bring").hidden && !saved) dropBox.classList.add("over");
    else $("drop").hidden = false;
  });
  app.addEventListener("dragleave", (event) => {
    if (!event.relatedTarget || !app.contains(event.relatedTarget)) dropBox.classList.remove("over");
  });
  $("drop").addEventListener("dragleave", () => ($("drop").hidden = true));
  app.addEventListener("drop", (event) => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    $("drop").hidden = true;
    dropBox.classList.remove("over");
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

  $("sign-in").addEventListener("click", () => openAccount("choose", { saving: false, title: "Sign in" }));
  $("join-create").addEventListener("click", () => openAccount("choose", { saving: false, title: "Create an account" }));
  $("tab-plan").addEventListener("click", () => setStartMode("plan"));
  $("tab-import").addEventListener("click", () => setStartMode("import"));
  $("join-login").addEventListener("click", () => openAccount("choose", { saving: false, title: "Log in" }));
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
    // Signed out, the page starts again as a guest's (the user, 2026-10-29);
    // the plan comes back from the draft.
    store.set(DRAFT_KEY, { plan, saved });
    const loggedOut = token
      ? fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) }).catch(() => {})
      : Promise.resolve();
    loggedOut.finally(() => location.reload());
  });
  $("menu-btn").addEventListener("click", () => {
    const open = $("sheet").hidden;
    $("sheet").hidden = !open;
    $("menu-btn").setAttribute("aria-expanded", String(open));
  });

  $("acc-close").addEventListener("click", () => $("account").close());
  // Closing the sign-in without signing in forgets the route it was for.
  $("account").addEventListener("close", () => { if (!session) store.remove(PENDING_EDIT_KEY); });
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
  const narrow = window.matchMedia("(max-width: 699px)");
  if (narrow.matches) {
    wire();
    // A window opened narrow and then widened gets the planner.
    narrow.addEventListener("change", (event) => { if (!event.matches) location.reload(); }, { once: true });
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
  // A guest's check runs while they look at the map, not when they search.
  if (!session) fetchPass();
  if (LOCAL) window.__planner = { get plan() { return plan; }, suggestedName, showSaved, enrich, render, importTrack, placeAt, printDirections };
  if (saved && plan.token) {
    showSaved();
    renderBlurb(false);
  } else if (routable() && !plan.path) {
    scheduleRoute();
  }
  if (session) {
    await loadProfile().catch(() => null);
    const pendingEdit = store.get(PENDING_EDIT_KEY);
    if (cameBack && pendingEdit) {
      store.remove(PENDING_EDIT_KEY);
      if (profile) await editShared(pendingEdit);
    } else if (cameBack && store.get(PENDING_SAVE_KEY)) {
      if (!profile) openAccount("username");
      else save();
    }
  }
  // From a route's page: its owner's Edit, or the bar's Sign in.
  const editing = new URLSearchParams(location.search).get("edit");
  if (editing) {
    try { window.history.replaceState(null, "", "/plan/"); } catch {}
    if (!/^[A-Za-z0-9]{10}$/.test(editing)) toast("That edit link isn't a Carve route.", true);
    else if (session) await editShared(editing);
    else {
      store.set(PENDING_EDIT_KEY, editing);
      openAccount("choose", { saving: false, title: "Sign in to edit" });
    }
  } else if (location.hash === "#sign-in") {
    try { window.history.replaceState(null, "", "/plan/"); } catch {}
    if (!session) openAccount("choose", { saving: false, title: "Sign in" });
  }
  await takeHandoff();
  if (!storageWorks) toast("This browser isn't keeping data, so a reload starts the route over.");
}

// What the home page's front door sent along (assets/home.js handOff; the
// user, 2026-10-29): a link (Google Maps, Ride with GPS, a Carve drive), a
// GPX file's text, or a start and destination as typed. Kept in this tab's
// sessionStorage, never the address bar, and used once.
const HANDOFF_KEY = "carve.plan.handoff";

async function takeHandoff() {
  let handoff = null;
  try {
    handoff = JSON.parse(sessionStorage.getItem(HANDOFF_KEY) || "null");
    sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    return;
  }
  if (!handoff || !(Date.now() - handoff.at < 10 * 60 * 1000)) return;
  if (handoff.kind === "link" && handoff.url) return importLink(handoff.url);
  if (handoff.kind === "gpx" && handoff.text) return importFile(new File([handoff.text], handoff.name || "route.gpx"));
  if (handoff.kind !== "stops") return;
  // Each typed place becomes the search's best answer near the map; one it
  // can't find stays typed in its row, to search from there.
  const missed = [];
  for (const [role, query] of [["start", handoff.from], ["end", handoff.to]]) {
    if (!query) continue;
    try {
      // One search session per place, as the rows' typeahead has (attachSearch).
      const searchSession = crypto.randomUUID();
      const near = mapReady ? map.getCenter() : null;
      const found = (await planner("search", { query, session: searchSession, ...(near ? { near: { lat: near.lat, lon: near.lng } } : {}) })).places?.[0];
      if (!found) throw new Failure("");
      const place = Number.isFinite(found.lat) ? found : { ...(await planner("place", { id: found.id, session: searchSession })).place, name: found.name };
      choosePlace(role, undefined, place);
    } catch {
      missed.push([role, query]);
    }
  }
  missed.forEach(([role, query], i) => {
    const input = document.querySelector(`[data-focus="${role}"]`);
    if (!input) return;
    input.value = query;
    if (!i) { input.focus(); input.dispatchEvent(new Event("input")); }
  });
}

start();
