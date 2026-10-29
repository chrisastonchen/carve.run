// A route's page — a drive's guide, a shared link — brought to life: the
// live map of its road with the planner's marks (the flags, the stops'
// letters, the waypoints' numbers), the QR code's download, the printed
// directions, the link to copy, Edit for the route's owner, and the bar's
// account. The page's words are already there (page_parts.py, or
// share_page.js for a shared link); this only adds what needs the route.
//
// The route comes from the backend by its share token, as the share page
// and the apps redeem it; a page without one (no token, no network, no
// WebGL) keeps its picture of the road and still reads.
import { markerLabels, turnKind, formatDistance, formatDuration, usesMiles } from "/plan/route-wire.js";

const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
const SESSION_KEY = "carve.plan.session";
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PANEL_GAP = 30;

const $ = (id) => document.getElementById(id);
const miles = usesMiles(navigator.language || "en-US");
// The one-column layout: a phone, or one held sideways (route-view.css).
const PHONE = "(max-width: 699px), (max-height: 560px)";
const phone = () => window.matchMedia(PHONE).matches;
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── the bar: the phone's menu, Get the App, the account ──────────────

const session = readStore(SESSION_KEY);
const signedIn = !!session?.user?.id;

function wireBar() {
  const button = $("menu-btn");
  const sheet = $("sheet");
  if (button && sheet) {
    button.addEventListener("click", () => {
      const open = sheet.hidden;
      sheet.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) sheet.querySelector("a")?.focus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || sheet.hidden) return;
      sheet.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.focus();
    });
  }
  if (/android/i.test(navigator.userAgent || "")) {
    document.querySelectorAll("[data-get-app]").forEach((a) => (a.href = "/android/"));
    document.querySelectorAll("[data-get-icon]").forEach((u) => u.setAttribute("href", "#i-android"));
  }
  const signIn = $("sign-in");
  const who = $("who");
  if (!signedIn) {
    if (signIn) signIn.hidden = false;
    return;
  }
  if (who) who.hidden = false;
  $("who-name").textContent = session.user.email ? session.user.email.split("@")[0] : "Account";
  $("who-btn")?.addEventListener("click", () => {
    const menu = $("who-menu");
    menu.hidden = !menu.hidden;
    $("who-btn").setAttribute("aria-expanded", String(!menu.hidden));
  });
  $("sign-out")?.addEventListener("click", () => {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    location.reload();
  });
  loadProfile();
}

/// The planner's account, as the planner shows it: username and picture.
async function loadProfile() {
  if (!(session.expires_at > Date.now() / 1000)) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id.toLowerCase()}&select=username,avatar_url`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) return;
    const profile = (await response.json())[0];
    if (!profile) return;
    if (profile.username) $("who-name").textContent = profile.username;
    const url = profile.avatar_url;
    if (url && /^https:\/\//.test(url)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      $("avatar").replaceChildren(img);
    }
  } catch {
    // The name from the email stays.
  }
}

// ── the route ────────────────────────────────────────────────────────

/// The shared route's row, asked again for a few seconds: a link shared
/// the moment its route was saved can be a second ahead of the backend.
async function routeRow(token, attempts = 1) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/redeem_share_token`, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ share_token: token }),
      });
      if (response.ok) {
        const row = (await response.json())[0];
        if (row) return row;
      } else if (response.status >= 500) {
        return null;
      }
    } catch {
      // Offline: try again, then keep the picture.
    }
  }
  return null;
}

/// Its places in the app's order: every waypoint (allWaypoints when the
/// wire's 30 were thinned for older builds), stops and markers.
function placesOf(payload) {
  const list = Array.isArray(payload.allWaypoints) && payload.allWaypoints.length ? payload.allWaypoints : payload.waypoints || [];
  return list
    .filter((w) => w && w.location && Number.isFinite(w.location.latitude) && Number.isFinite(w.location.longitude))
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((w) => ({
      lat: w.location.latitude, lon: w.location.longitude, type: w.type === "stop" ? "stop" : "marker",
      label: String(w.label || "").trim(),
      // Whatever the stored route says, a stay is a whole number of minutes
      // (a string here was markup on carve.run: the QA pass, 2026-10-29).
      stayMinutes: Number.isInteger(w.stayMinutes) && w.stayMinutes > 0 && w.stayMinutes <= 1440 ? w.stayMinutes : undefined,
    }));
}

/// A round trip, or a drive that ends where it began (within ~150 m).
function loops(payload) {
  if (payload.tripType === "roundtrip") return true;
  const a = payload.start, b = payload.end;
  if (!a || !b) return false;
  const rad = Math.PI / 180;
  const dy = (b.latitude - a.latitude) * 111000;
  const dx = (b.longitude - a.longitude) * 111000 * Math.cos(a.latitude * rad);
  return Math.hypot(dx, dy) < 150;
}

// ── the map ──────────────────────────────────────────────────────────

const MARKS = {
  start: '<svg aria-hidden="true"><use href="#i-flag"/></svg>',
  dest: '<svg aria-hidden="true"><use href="#i-flag-checkered"/></svg>',
};

function webglWorks() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function pin(kind, label, title) {
  const el = document.createElement("div");
  el.className = `pin ${kind}`;
  el.style.cursor = "default";
  if (kind === "start" || kind === "dest") el.innerHTML = MARKS[kind];
  else el.textContent = label;
  el.title = title;
  return el;
}

function padding() {
  if (phone()) return { top: 36, bottom: 36, left: 30, right: 30 };
  const panel = document.querySelector(".rv .panel");
  const right = panel ? panel.getBoundingClientRect().right : 0;
  return { top: 70, bottom: 80, right: 80, left: Math.round(right) + PANEL_GAP };
}

/// MapLibre loads after this module (it's big, and nothing else waits for it).
function mapLibre() {
  if (window.maplibregl) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.querySelector('script[src*="maplibre-gl.js"]');
    script?.addEventListener("load", () => resolve(!!window.maplibregl), { once: true });
    script?.addEventListener("error", () => resolve(false), { once: true });
    window.addEventListener("load", () => resolve(!!window.maplibregl), { once: true });
  });
}

async function drawMap(host, payload) {
  if (!(await mapLibre()) || !webglWorks()) return;
  const line = (payload.pathGeometry || [])
    .filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    .map((c) => [c.longitude, c.latitude]);
  if (line.length < 2) return;
  const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
  const box = document.createElement("div");
  box.className = "map";
  host.append(box);
  const map = new maplibregl.Map({
    container: box,
    style: MAP_STYLE,
    bounds,
    fitBoundsOptions: { padding: padding(), maxZoom: 14 },
    attributionControl: { compact: false },
    dragRotate: false,
    pitchWithRotate: false,
    // On a phone a finger scrolls the page; two move the map.
    cooperativeGestures: phone(),
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    const firstLabel = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addSource("route", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: {} } });
    map.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#ffffff", "line-width": 11 } }, firstLabel);
    map.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#2E92FF", "line-width": 6 } }, firstLabel);
    const places = placesOf(payload);
    const labels = markerLabels(places);
    const add = (lon, lat, el) => {
      const marker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
      // MapLibre calls every marker "Map marker"; this one says what it is.
      el.setAttribute("aria-label", el.title);
      return marker;
    };
    places.forEach((p, i) => {
      const stop = p.type === "stop";
      add(p.lon, p.lat, pin(stop ? "stop" : "wp", labels[i], `${stop ? "Stop" : "Waypoint"} ${labels[i]}${p.label ? `: ${p.label}` : ""}`));
    });
    const start = payload.start;
    if (start) add(start.longitude, start.latitude, pin("start", "", "Start"));
    const end = payload.end;
    if (end && !loops(payload)) add(end.longitude, end.latitude, pin("dest", "", "Destination"));
    host.classList.add("live");
    const legend = $("rv-legend");
    if (legend && !phone()) legend.hidden = false;
    map.fitBounds(bounds, { padding: padding(), maxZoom: 14, duration: 0 });
  });
  // Refit to a new window size once the map has taken it, unless the
  // reader has moved the map themselves.
  let moved = false;
  map.on("dragstart", () => (moved = true));
  map.on("zoomstart", (event) => { if (event.originalEvent) moved = true; });
  map.on("resize", () => { if (!moved) map.fitBounds(bounds, { padding: padding(), maxZoom: 14, duration: 0 }); });
}

// ── into the app: the code, the link, the printed turns ─────────────

let qrModel = null;

function shareLink(token) {
  return `https://carve.run/${token}`;
}

/// The code's model, from the vendored library once it has loaded.
function codeFor(link) {
  if (!qrModel && window.qrcode) {
    qrModel = qrcode(0, "M");
    qrModel.addData(link);
    qrModel.make();
  }
  return qrModel;
}

/// The link, its code and Download need only the token: they work before,
/// and without, the route (a slow phone, the backend down).
function wireLink(token, name) {
  const link = shareLink(token);
  const box = $("rv-qr");
  if (box && !box.querySelector("svg") && codeFor(link)) {
    box.innerHTML = qrModel.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    box.setAttribute("aria-label", `QR code for ${link}`);
  }
  const out = $("rv-link");
  if (out) out.value = link.replace("https://", "");
  $("rv-copy")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(link);
      $("rv-copy").textContent = "Copied";
      setTimeout(() => ($("rv-copy").textContent = "Copy link"), 1800);
    } catch {
      out?.select();
    }
  });
  $("rv-download")?.addEventListener("click", () => {
    codeFor(link);
    downloadQR(document.querySelector("h1")?.textContent || name);
  });
}

/// Print directions, once the route's turns are here.
function wirePrint(token, payload, row) {
  const print = $("rv-print");
  if (!print) return;
  const turns = payload.turnInstructions || [];
  if (!turns.length) return;
  print.addEventListener("click", () => {
    codeFor(shareLink(token));
    printDirections(token, payload, row);
  });
  print.hidden = false;
}

function downloadQR(name) {
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
  a.download = `${(name || "carve-route").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "carve-route"}-qr.png`;
  a.click();
}

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

function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/// Two pages, as the planner prints them: the code to scan, then every turn.
function printDirections(token, payload, row) {
  const unitMeters = miles ? 1609.344 : 1000;
  const unit = miles ? "mi" : "km";
  const turns = payload.turnInstructions || [];
  const places = placesOf(payload);
  const labels = markerLabels(places);
  const stopsAfter = new Map();
  places.forEach((w, i) => {
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
      rows += `<tr class="stoprow"><td class="n"></td><td class="ic"><svg viewBox="0 0 24 24">${ARROWS.stop}</svg></td><td>Stop ${stop.label} · ${escapeHTML(stop.name)}${stop.stay ? ` · stay ${Number(stop.stay)} min` : ""}</td><td class="d"></td><td class="m">${((mile + t.distanceMeters) / unitMeters).toFixed(1)}</td></tr>`;
    }
    mile += t.distanceMeters;
  });
  const name = row.name || payload.name || "A Carve route";
  const distance = formatDistance(row.distance_meters || mile, miles);
  const time = row.duration_seconds ? ` · about ${formatDuration(row.duration_seconds)}` : "";
  const sub = `${distance.value} ${distance.unit}${time}`;
  const qr = qrModel ? qrModel.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) : "";
  const link = shareLink(token).replace("https://", "");
  $("printout").innerHTML = `
    <section class="pp">
      <svg class="wm"><use href="#i-wordmark"/></svg>
      <h1>${escapeHTML(name)}</h1>
      <p class="sub">${sub}</p>
      <div class="scanrow"><div class="qrbig">${qr}</div><div><b>Scan with your phone's camera to drive it in Carve</b><span>Turn by turn on the exact roads, even with no signal.</span><span class="url">${link}</span></div></div>
      ${payload.blurb ? `<p style="margin-top:18pt;font-size:12pt;line-height:1.5">${escapeHTML(payload.blurb)}</p>` : ""}
      <p class="foot-note">No Carve yet? It's free on iPhone and Android. The link takes you to the store first.</p>
    </section>
    <section class="pp">
      <svg class="wm"><use href="#i-wordmark"/></svg>
      <h1 style="font-size:22pt">${escapeHTML(name)}: turn by turn</h1>
      <p class="sub">${sub} · ${link}</p>
      <table><thead><tr><th></th><th></th><th>Direction</th><th style="text-align:right">Then</th><th style="text-align:right">${miles ? "Mile" : "Km"}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="foot-note">Directions are the route as planned in Carve. Watch for road signs and closures.</p>
    </section>`;
  // Afterwards the browser's own Print gives the page again.
  window.addEventListener("afterprint", () => ($("printout").innerHTML = ""), { once: true });
  window.print();
}

/// A shared route's Along the way, from the route itself: every stop and
/// waypoint in the map's marks (the share link's own list has stops only).
function listAlong(payload) {
  const list = document.querySelector(".along[data-from-route]");
  if (!list) return;
  const places = placesOf(payload);
  const labels = markerLabels(places);
  const mark = (kind, text) => {
    const span = document.createElement("span");
    span.className = `badge ${kind}`;
    if (kind === "start" || kind === "dest") span.innerHTML = MARKS[kind];
    else span.textContent = text;
    return span;
  };
  const row = (badge, name) => {
    const li = document.createElement("li");
    const what = document.createElement("div");
    what.className = "what";
    const strong = document.createElement("strong");
    strong.textContent = name;
    what.append(strong);
    li.append(badge, what);
    return li;
  };
  const rows = [row(mark("start"), "Start")];
  places.forEach((p, i) => rows.push(row(mark(p.type === "stop" ? "stop" : "wp", labels[i]),
    p.label || (p.type === "stop" ? `Stop ${labels[i]}` : `Waypoint ${labels[i]}`))));
  rows.push(loops(payload) ? row(mark("start"), "Back to the start") : row(mark("dest"), "Destination"));
  list.replaceChildren(...rows);
}

/// Along the way, marked as the map marks it: a place the route has by name
/// takes its letter (a stop) or number (a waypoint); the rest keep theirs.
function markAlong(payload) {
  const places = placesOf(payload);
  const labels = markerLabels(places);
  const key = (s) => String(s || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const byName = new Map();
  places.forEach((p, i) => {
    if (p.label && !byName.has(key(p.label))) byName.set(key(p.label), { stop: p.type === "stop", label: labels[i] });
  });
  document.querySelectorAll(".along li[data-place]").forEach((li) => {
    const found = byName.get(key(li.dataset.place));
    const badge = li.querySelector(".badge");
    if (!found || !badge) return;
    badge.className = `badge ${found.stop ? "stop" : "wp"}`;
    badge.textContent = found.label;
  });
}

// ── the owner's Edit, and the app's pitch for those without it ───────

/// The share link keeps its owner private, so ask the routes table as the
/// visitor: row-level security answers only the route's owner.
async function ownsRoute(row) {
  if (!signedIn || !row.id || !(session.expires_at > Date.now() / 1000)) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/routes?id=eq.${encodeURIComponent(String(row.id).toLowerCase())}&select=owner_id`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) return false;
    const found = (await response.json())[0];
    return !!found && String(found.owner_id).toLowerCase() === String(session.user.id).toLowerCase();
  } catch {
    return false;
  }
}

async function wireOwner(token, row) {
  const mine = await ownsRoute(row);
  const edit = $("rv-edit");
  if (edit && mine && !phone()) {
    edit.href = `/plan/?edit=${encodeURIComponent(token)}`;
    edit.hidden = false;
    edit.closest(".rv-head")?.classList.add("with-edit");
  }
}

// ── start ────────────────────────────────────────────────────────────

// The bar doesn't wait for the route (a bad link still has its menu).
wireBar();
wireBanner();

// The phone's "open in the app" bar: closed, it stays closed for the visit.
// The share page adds its bar later, so the click is caught on the page.
function wireBanner() {
  const BANNER_KEY = "carve.banner.closed";
  const close = () => document.documentElement.classList.add("banner-closed");
  try { if (sessionStorage.getItem(BANNER_KEY)) close(); } catch {}
  document.addEventListener("click", (event) => {
    if (!event.target.closest?.("[data-close-banner]")) return;
    close();
    try { sessionStorage.setItem(BANNER_KEY, "1"); } catch {}
  });
}

async function start() {
  // Someone signed in to Carve has the app's pitch already.
  if (signedIn) $("rv-app")?.setAttribute("hidden", "");
  const host = $("rv-map");
  const token = host?.dataset.token;
  if (!token) return;
  wireLink(token, "carve-route");
  const row = window.carveRouteRow || (await routeRow(token, host.dataset.wait ? 5 : 1));
  if (!row) return;
  window.dispatchEvent(new CustomEvent("carve:row", { detail: row }));
  const payload = row.payload || {};
  drawMap(host, payload);
  markAlong(payload);
  listAlong(payload);
  wirePrint(token, payload, row);
  wireOwner(token, row);
}

// share_page.js may already hold the row; it says when it's ready.
if (document.documentElement.dataset.routeWait === "page" && !window.carveRouteReady) {
  window.addEventListener("carve:route", start, { once: true });
} else {
  start();
}
