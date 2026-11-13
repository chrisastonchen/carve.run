// A club drive's day link, for anyone with it (Chris, 11/10–11): the
// day's weather along the route at its meet time, the weather warnings and
// the apps' road-card rows within 7 days; seasonal closures and pavement
// from the catalog any day to come; the traffic check's detours and
// drivers' hazard reports today or tomorrow. Nothing applies, nothing
// shows. Plain route links (no club drive) get none of it.
// The rules and words are day-words.js's, the apps'.

import { SUPABASE_KEY, SUPABASE_URL } from "/assets/carve-session.js?v=a3869ea508";
import {
  alertRows, catalogRoads, catalogRows, clock, daysAhead, degrees, forecastChanges, fractionOf, hazardRows, hourlyRows,
  label, nearest, ordered, shows, stretches, units, zonedInstant,
} from "/assets/day-words.js?v=fa3c08a5f0";
import { dayHeadline } from "/assets/club-words.js?v=768f355b17";
import { ROUTE_APEX_UI } from "/plan/club-flags.js?v=4";

// The token as /r/ reads it (carve.run/<token>, /r/<token>, /r/?t=), or ?k=.
const segments = location.pathname.split("/").filter(Boolean);
const params = new URLSearchParams(location.search);
const token = [segments[0] === "r" ? segments[1] : segments.length === 1 ? segments[0] : null, params.get("t"), params.get("k")]
  .find((t) => /^[A-Za-z0-9]{10}$/.test(t || ""));
const imperial = /-US$|^en$/i.test(navigator.language || "en-US");
const U = units(imperial), T = degrees(imperial);
const MOST_POINTS = 12;

async function rpc(name, body) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
const json = (url) => fetch(url, { cache: "default" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/// The route's row (route-view.js fetches it), as soon as there is one.
const routeRow = () => new Promise((done) => {
  if (window.carveRouteRow) return done(window.carveRouteRow);
  window.addEventListener("carve:row", (e) => done(e.detail || null), { once: true });
  setTimeout(() => done(window.carveRouteRow || null), 15000);
});

/// The country WeatherKit's warnings are asked for, roughly from where the
/// route starts; none outside these, and the function asks without.
function countryAt({ lat, lon }) {
  if (lat > 24 && lat < 49.4 && lon > -125 && lon < -66) return "US";
  if (lat > 51 && lat < 72 && lon > -170 && lon < -129) return "US";
  if (lat > 18.5 && lat < 22.5 && lon > -161 && lon < -154) return "US";
  if (lat > -44 && lat < -10 && lon > 112 && lon < 154) return "AU";
  if (lat > -48 && lat < -34 && lon > 166 && lon < 179) return "NZ";
  return null;
}

async function weather(list, at, zone) {
  // Up to twelve places along it, evenly; each stretch takes its area's.
  const step = Math.max(1, Math.ceil(list.length / MOST_POINTS));
  const points = list.filter((_, i) => i % step === 0).slice(0, MOST_POINTS - 1).concat(list[list.length - 1]).map((s) => ({ lat: s.at.lat, lon: s.at.lon }));
  const country = countryAt(points[0]);
  const response = await fetch(`${SUPABASE_URL}/functions/v1/weather`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ points, at: new Date(at).toISOString(), timeZone: zone || "UTC", ...(country ? { countryCode: country } : {}) }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const areas = (data?.areas || []).map((a) => ({ ...a, hours: (a.hours || []).map((h) => ({ ...h, date: Date.parse(h.date) })) }));
  if (!areas.length) return null;
  const areaOf = (p) => areas.reduce((best, a) => ((a.lat - p.lat) ** 2 + (a.lon - p.lon) ** 2 < (best.lat - p.lat) ** 2 + (best.lon - p.lon) ** 2 ? a : best));
  return { list: list.map((s) => ({ ...s, hours: areaOf(s.at).hours })), alerts: areas.flatMap((a) => a.alerts || []) };
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function draw({ when, forecast, rows }) {
  const card = document.querySelector(".rv .scroll");
  if (!card || (!forecast.length && !rows.length)) return;
  const section = el("section", "sect dx");
  section.id = "dx";
  section.append(el("h2", "", `On ${when}`));
  if (forecast.length) {
    const list = el("ul", "dx-weather");
    list.setAttribute("aria-label", "Weather along the way");
    for (const m of forecast) {
      const li = el("li");
      li.append(el("b", "", m.name), el("span", "", `${clock(m.passAt, m.zone)} · ${label(m.hour.condition)} · ${T(m.hour.temperatureCelsius)}${m.hour.precipitationChance >= 0.2 ? ` · ${Math.round(m.hour.precipitationChance * 100)}% rain` : ""}`));
      list.append(li);
    }
    section.append(list);
  }
  if (rows.length) {
    const list = el("ul", "dx-rows");
    list.setAttribute("aria-label", "Road conditions");
    for (const r of rows) {
      const li = el("li", `dx-row ${r.severity}`);
      li.append(el("b", "", r.title));
      if (r.detail) li.append(el("span", "", r.detail));
      if (r.url) { const a = el("a", "", "Read it"); a.href = r.url; a.rel = "noopener"; a.target = "_blank"; li.append(a); }
      list.append(li);
    }
    section.append(list);
  }
  // WeatherKit's attribution, wherever its data shows.
  if (forecast.length || rows.some((r) => r.fromWeather)) {
    const src = el("p", "dx-src", "Weather from ");
    const a = el("a", "", "Apple Weather");
    a.href = "https://weatherkit.apple.com/legal-attribution.html";
    a.rel = "noopener";
    src.append(a);
    section.append(src);
  }
  card.insertBefore(section, card.querySelector(".rv-links"));
  window.carveDayExtras = { forecast: forecast.length, rows: rows.map((r) => r.title) };
}

/// Whose drive and which day, above the route's name (Chris, 11/11).
async function drawHeadline(drive) {
  const line = dayHeadline(drive);
  if (!line) return;
  const title = document.querySelector(".rv .rv-head h1");
  if (!title || document.getElementById("dx-day")) return;
  const p = el("p", "dx-day", line);
  p.id = "dx-day";
  title.before(p);
}

async function start() {
  if (!token) return;
  let drive = null;
  try { drive = await rpc("route_drive", { p_share_token: token }); } catch { return; }
  if (!drive?.day_date) return;
  drawHeadline(drive);
  // Apex on this route, free from the club (board A1), when it's switched on.
  if (ROUTE_APEX_UI) import("/assets/apex-card.js?v=ddd3fc2076").then((m) => m.drawApexCard(token, drive.time_zone)).catch(() => {});
  const zone = drive.time_zone || "UTC";
  const ahead = daysAhead(drive.day_date, zone);
  const what = shows(ahead);
  if (!what.season) return;
  const row = await routeRow();
  const p = row?.payload || {};
  const path = (p.pathGeometry || []).map((q) => ({ lat: q.latitude, lon: q.longitude }));
  if (path.length < 2) return;
  const leave = zonedInstant(drive.day_date, drive.leave || drive.meet || "09:00", zone);
  const seconds = row.duration_seconds || p.pathDurationSeconds || 0;
  const list = stretches(path, (f) => leave + f * seconds * 1000);
  const places = [
    { fraction: 0, name: drive.start_name || p.startName || "" },
    ...(p.waypoints || []).filter((w) => w.type === "stop" && w.location && (w.label || "").trim())
      .map((w) => ({ fraction: fractionOf({ lat: w.location.latitude, lon: w.location.longitude }, path), name: w.label.trim() })),
    { fraction: 1, name: p.endName || "" },
  ].filter((x) => x.name);
  const month = Number(String(drive.day_date).slice(5, 7));

  const [catalog, traffic, hazards, sky] = await Promise.all([
    json("/drives/area.json"),
    what.live ? json("/drives/traffic.json") : null,
    what.live ? rpc("hazards_on_route", { p_share_token: token }).catch(() => []) : [],
    what.weather ? weather(list, Math.max(leave, Date.now()), zone).catch(() => null) : null,
  ]);
  const rows = [];
  if (sky) rows.push(...[...alertRows(sky.alerts), ...hourlyRows(sky.list, places, U, T, zone)].map((r) => ({ ...r, fromWeather: true })));
  rows.push(...catalogRows(catalogRoads(path, catalog?.drives || []), { month, live: what.live, flagged: traffic?.flagged || {} }));
  if (what.live) rows.push(...hazardRows(Array.isArray(hazards) ? hazards : [], path, places, zone));

  let forecast = [];
  if (sky) {
    const markers = places.map((pl) => {
      const s = sky.list.reduce((a, b) => (Math.abs(b.fraction - pl.fraction) < Math.abs(a.fraction - pl.fraction) ? b : a));
      return { name: pl.name, passAt: s.passAt, zone, hour: nearest(s.hours, s.passAt) };
    }).filter((m) => m.hour);
    forecast = forecastChanges(markers);
  }
  const when = new Date(zonedInstant(drive.day_date, "12:00", zone)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone });
  draw({ when, forecast, rows: ordered(rows) });
}

start();
