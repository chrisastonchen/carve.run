// A club drive's day link: its weather and road conditions, worked out as
// the apps do (android core weather/RoadConditions.kt, RouteWeather.kt,
// ForecastAlong.kt; iOS RoadConditions.swift, RoadClosures.swift). Same
// thresholds, same words. Pure, so node can test it:
// scripts/plan-tests/day-words.test.mjs. day-extras.js fetches and draws.
// Times are epoch milliseconds; coordinates are { lat, lon }.

const HOUR = 3_600_000;
const RAD = Math.PI / 180;

// ── conditions (RouteWeather.kt WeatherConditions, WeatherKind) ──

const LABELS = {
  blowingDust: "Blowing Dust", clear: "Clear", cloudy: "Cloudy", foggy: "Foggy", haze: "Haze", mostlyClear: "Mostly Clear",
  mostlyCloudy: "Mostly Cloudy", partlyCloudy: "Partly Cloudy", smoky: "Smoky", breezy: "Breezy", windy: "Windy",
  drizzle: "Drizzle", heavyRain: "Heavy Rain", isolatedThunderstorms: "Isolated Thunderstorms", rain: "Rain",
  sunShowers: "Sun Showers", scatteredThunderstorms: "Scattered Thunderstorms", strongStorms: "Strong Storms",
  thunderstorms: "Thunderstorms", frigid: "Frigid", hail: "Hail", hot: "Hot", flurries: "Flurries", sleet: "Sleet",
  snow: "Snow", sunFlurries: "Sun Flurries", wintryMix: "Wintry Mix", blizzard: "Blizzard", blowingSnow: "Blowing Snow",
  freezingDrizzle: "Freezing Drizzle", freezingRain: "Freezing Rain", heavySnow: "Heavy Snow", hurricane: "Hurricane",
  tropicalStorm: "Tropical Storm",
};
export const WET = new Set(["drizzle", "rain", "heavyRain", "sunShowers", "freezingDrizzle", "freezingRain", "hail",
  "isolatedThunderstorms", "scatteredThunderstorms", "thunderstorms", "strongStorms", "tropicalStorm", "hurricane"]);
export const FROZEN = new Set(["snow", "heavySnow", "flurries", "sunFlurries", "blowingSnow", "blizzard", "sleet", "wintryMix",
  "freezingDrizzle", "freezingRain", "hail"]);

/// "Mostly Clear"; a code this page doesn't know, spaced out of its camel case.
export function label(condition) {
  const c = String(condition || "");
  return LABELS[c] || c.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (x) => x.toUpperCase());
}
/// "Drizzle", "Fog", "Snow": said in a sentence.
export function noun(condition) {
  if (condition === "foggy") return "Fog";
  if (condition === "sunShowers") return "Showers";
  if (["isolatedThunderstorms", "scatteredThunderstorms", "strongStorms"].includes(condition)) return "Thunderstorms";
  if (condition === "sunFlurries") return "Flurries";
  return label(condition);
}

// ── units (Units.kt, TemperatureUnit) ──

const roundAway = (v) => Math.sign(v) * Math.round(Math.abs(v));
export const units = (imperial) => ({
  imperial,
  speed: (mps) => `${roundAway(Math.max(0, imperial ? mps * 2.236936 : mps * 3.6))} ${imperial ? "mph" : "km/h"}`,
  wholeDistance: (m) => `${roundAway(Math.max(0, imperial ? m / 1609.344 : m / 1000))} ${imperial ? "mi" : "km"}`,
});
export const degrees = (fahrenheit) => (c) => `${Math.round(fahrenheit ? (c * 9) / 5 + 32 : c)}°`;

/// "8:45 am" where the drive is.
export function clock(ms, zone) {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone || undefined }).replace("AM", "am").replace("PM", "pm");
}

// ── the day: when, and how far ahead ──

/// The drive's day and hh:mm where it is, as an instant.
export function zonedInstant(date, hhmm, zone) {
  const [y, m, d] = String(date).split("-").map(Number);
  const [h, min] = String(hhmm || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h || 0, min || 0);
  // The zone's offset at that moment, twice (once more across a change).
  const offset = (t) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone || "UTC", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

/// Days from today where the drive is to its date: 0 today, 1 tomorrow.
export function daysAhead(date, zone, now = Date.now()) {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: zone || undefined });
  const a = Date.UTC(...today.split("-").map((x, i) => (i === 1 ? x - 1 : +x)));
  const [y, m, d] = String(date).split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86_400_000);
}

/// What a day link shows, by how far ahead its day is (Chris and Product,
/// 11/11): the forecast and its rows within 7 days; detours and hazards
/// today or tomorrow; seasonal closures any day to come.
export function shows(ahead) {
  return { weather: ahead >= 0 && ahead <= 7, live: ahead === 0 || ahead === 1, season: ahead >= 0 };
}

// ── along the route (RouteForecast, RoadConditions.stretches) ──

export function distance(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function bearing(a, b) {
  const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
export function angleDelta(a, b) {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}
export function cumulative(path) {
  const along = [0];
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + distance(path[i - 1], path[i]));
  return along;
}
export function pointAt(meters, path, along) {
  let low = 0, high = along.length;
  while (low < high) { const mid = (low + high) >> 1; if (along[mid] >= meters) high = mid; else low = mid + 1; }
  if (low <= 0 || low >= along.length) return low <= 0 ? path[0] : path[path.length - 1];
  const a = path[low - 1], b = path[low], span = along[low] - along[low - 1];
  const t = span > 0 ? (meters - along[low - 1]) / span : 0;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/// About every kilometre, at most 60: where, how far along, which way, and
/// when you'd be there.
export function stretches(path, passAt) {
  if (!path || path.length < 2) return [];
  const along = cumulative(path);
  const total = along[along.length - 1];
  if (!(total > 0)) return [];
  const count = Math.min(60, Math.max(4, Math.floor(total / 1000)));
  const out = [];
  for (let i = 0; i <= count; i++) {
    const fraction = i / count;
    const here = pointAt(fraction * total, path, along);
    const ahead = pointAt(Math.min(total, fraction * total + 200), path, along);
    const behind = pointAt(Math.max(0, fraction * total - 200), path, along);
    out.push({ fraction, at: here, passAt: passAt(fraction), bearing: fraction < 1 ? bearing(here, ahead) : bearing(behind, here), meters: fraction * total });
  }
  return out;
}

/// How far along `path` the point nearest `spot` is, 0…1.
export function fractionOf(spot, path) {
  const along = cumulative(path), total = along[along.length - 1] || 1;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length; i++) { const d = distance(spot, path[i]); if (d < bestD) { bestD = d; best = i; } }
  return along[best] / total;
}

/// The hour nearest when it's passed, within an hour and a half.
export function nearest(hours, ms) {
  let best = null, gap = Infinity;
  for (const h of hours || []) { const g = Math.abs(h.date + HOUR / 2 - ms); if (g < gap) { gap = g; best = h; } }
  return best && gap <= (3 * HOUR) / 2 ? best : null;
}

// ── road conditions (RoadConditions.kt) ──

export const ICE_CELSIUS = 3, DEW_POINT_GAP = 2, FOG_METERS = 1000, GUST_KPH = 40;
export const LOW_SUN_DEGREES = 15, SUN_AHEAD_DEGREES = 25, TEMPERATURE_GAP = 3, WET_HOURS = 3, MOST_ALERTS = 5, NEAR_SHARE = 0.12;
const SEVERITY = { note: 0, caution: 1, warning: 2 };
const row = (kind, severity, title, detail, url = null) => ({ kind, severity, title, detail, ...(url ? { url } : {}) });
const join = (a, b) => [a, b].filter(Boolean).join(" ");

/// "near Livermore", or nothing when the nearest named place is far off.
export function near(fraction, places) {
  let place = null;
  for (const p of places || []) if (!place || Math.abs(p.fraction - fraction) < Math.abs(place.fraction - fraction)) place = p;
  if (!place || !place.name || Math.abs(place.fraction - fraction) > NEAR_SHARE) return "";
  return `near ${place.name}`;
}

/// Whether rain or snow fell in the `window` hours before `ms`.
export function fell(hours, ms, window) {
  return (hours || []).some((h) => h.date < ms && h.date >= ms - window * HOUR &&
    ((h.precipitationMm || 0) > 0.2 || WET.has(h.condition) || FROZEN.has(h.condition)));
}

/// A web page, https with a host, or nothing: all an alert may open.
export function webLink(url) {
  try { const u = new URL(String(url)); return u.protocol === "https:" && u.host ? String(url) : null; } catch { return null; }
}

export function alertRows(alerts) {
  const seen = new Set();
  const out = [];
  for (const a of alerts || []) {
    if (!a?.summary || seen.has(a.summary)) continue;
    seen.add(a.summary);
    out.push(row("alert", "warning", a.summary, a.source || "", webLink(a.url)));
  }
  return out.slice(0, MOST_ALERTS);
}

const SIXTEEN = ["north", "north-northeast", "northeast", "east-northeast", "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest", "west", "west-northwest", "northwest", "north-northwest"];
export function compass(deg, points) {
  const n = ((deg % 360) + 360) % 360;
  if (points === 8) return SIXTEEN.filter((_, i) => i % 2 === 0)[Math.round(n / 45) % 8];
  return SIXTEEN[Math.round(n / 22.5) % 16];
}

export function windRow(kph, from, u) {
  const title = kph < 6 ? "Calm" : kph < 20 ? "Light breeze" : kph < 39 ? "Breezy" : "Windy";
  const speed = u.speed(kph / 3.6);
  return row("wind", "note", title, from == null ? speed : `${speed} from the ${compass(from, 16)}`);
}

/// Where the sun is: degrees up and clockwise from north (SunPosition).
export function sunAt(ms, at) {
  const days = ms / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const anomaly = ((357.529 + 0.98560028 * days) % 360) * RAD;
  const meanLongitude = (280.459 + 0.98564736 * days) % 360;
  const longitude = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 0.00000036 * days) * RAD;
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude));
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(longitude));
  const sidereal = (18.697374558 + 24.06570982441908 * days) % 24;
  const ha = (sidereal * 15 + at.lon) * RAD - ra;
  const lat = at.lat * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { elevation: elevation / RAD, azimuth: (azimuth / RAD + 360) % 360 };
}

export function lowSun(list, u, zone) {
  let run = [], found = [];
  for (const s of list) {
    const sun = sunAt(s.passAt, s.at);
    if (sun.elevation > 0 && sun.elevation < LOW_SUN_DEGREES && angleDelta(sun.azimuth, s.bearing) < SUN_AHEAD_DEGREES) run.push(s);
    else if (run.length) { if (run.length > found.length) found = run; run = []; }
  }
  if (run.length > found.length) found = run;
  const first = found[0];
  if (!first) return null;
  let length = 0;
  for (let i = 1; i < found.length; i++) length += distance(found[i - 1].at, found[i].at);
  const words = length >= 800 ? `, for about ${u.wholeDistance(length)}` : "";
  return row("lowSun", "caution", "Low sun ahead", `Heading ${compass(first.bearing, 8)} around ${clock(first.passAt, zone)}${words}`);
}

/// The forecast's rows, hour by hour: each stretch with its area's `hours`.
export function hourlyRows(list, places, u, temp, zone) {
  const readings = list.map((s) => [s, nearest(s.hours, s.passAt)]).filter(([, h]) => h);
  if (!readings.length) return [];
  const out = [];
  const place = (s) => near(s.fraction, places);
  const at = (s) => `around ${clock(s.passAt, zone)}`;

  const snow = readings.find(([, h]) => FROZEN.has(h.condition));
  if (snow) {
    const [s, h] = snow;
    out.push(row("snow", "warning", `${noun(h.condition)} on the road`, join(place(s), at(s))));
  } else {
    for (const [s, h] of readings) {
      if (h.temperatureCelsius > ICE_CELSIUS) continue;
      const why = fell(s.hours, s.passAt, 24) ? "and it rained in the last day"
        : h.dewPointCelsius != null && h.temperatureCelsius - h.dewPointCelsius <= DEW_POINT_GAP ? "with the air near its dew point" : null;
      if (!why) continue;
      out.push(row("ice", "warning", "Ice possible", `${temp(h.temperatureCelsius)} ${join(place(s), at(s))}, ${why}`));
      break;
    }
  }

  const fog = readings.find(([, h]) => h.condition === "foggy" || (h.visibilityMeters ?? Infinity) < FOG_METERS);
  if (fog) out.push(row("fog", "caution", "Fog", `Under ${u.imperial ? "half a mile" : "1 km"} to see ${join(place(fog[0]), at(fog[0]))}`));

  const gusts = readings.flatMap(([s, h]) => {
    const gust = h.gustKph ?? h.windKph;
    if (gust == null || gust < GUST_KPH) return [];
    const across = h.windFromDegrees != null ? Math.abs(Math.sin(angleDelta(h.windFromDegrees, s.bearing) * RAD)) : 0;
    return [[s, gust, across]];
  });
  if (gusts.length) {
    const [s, gust, across] = gusts.reduce((a, b) => (b[1] * Math.max(b[2], 0.3) > a[1] * Math.max(a[2], 0.3) ? b : a));
    const crossing = across >= Math.sin(45 * RAD);
    out.push(row("crosswind", "caution", crossing ? "Strong crosswind" : "Gusty", `Gusts to ${u.speed(gust / 3.6)}${crossing ? " across the road" : ""} ${place(s)}`.trim()));
  }

  const wet = readings.find(([, h]) => WET.has(h.condition));
  const wetBefore = readings.find(([s]) => fell(s.hours, s.passAt, WET_HOURS));
  if (wet) {
    out.push(row("wet", "caution", "Wet road", `${noun(wet[1].condition)} ${join(place(wet[0]), at(wet[0]))}`));
  } else if (wetBefore) {
    out.push(row("wet", "caution", "Wet road", join("Rain in the hours before,", place(wetBefore[0])).replace(/^[,\s]+|[,\s]+$/g, "")));
  } else if (!readings.some(([, h]) => FROZEN.has(h.condition))) {
    const knowsPast = readings.some(([s]) => (s.hours || []).some((h) => h.date <= s.passAt - 12 * HOUR));
    if (!readings.some(([s]) => fell(s.hours, s.passAt, 24))) out.push(row("dry", "note", "Dry road", knowsPast ? "No rain in the last day" : "No rain expected"));
  }

  const sun = lowSun(list, u, zone);
  if (sun) out.push(sun);

  const start = readings[0][1];
  let warmest = null;
  for (const p of (places || []).slice(1)) {
    let n = null;
    for (const r of readings) if (!n || Math.abs(r[0].fraction - p.fraction) < Math.abs(n[0].fraction - p.fraction)) n = r;
    if (n && (!warmest || Math.abs(n[1].temperatureCelsius - start.temperatureCelsius) > Math.abs(warmest[2].temperatureCelsius - start.temperatureCelsius))) warmest = [p, n[0], n[1]];
  }
  if (warmest && Math.abs(warmest[2].temperatureCelsius - start.temperatureCelsius) >= TEMPERATURE_GAP) {
    const [p, s, h] = warmest;
    const cooler = h.temperatureCelsius < start.temperatureCelsius;
    out.push(row("temperature", "note", `${cooler ? "Cooler" : "Warmer"} at ${p.name}`, `${temp(h.temperatureCelsius)} when you get there, at ${clock(s.passAt, zone)}`));
  }

  if (!gusts.length) {
    const winds = readings.filter(([, h]) => h.windKph != null);
    if (winds.length) out.push(windRow(winds.reduce((a, [, h]) => a + h.windKph, 0) / winds.length, winds.find(([, h]) => h.windFromDegrees != null)?.[1].windFromDegrees ?? null, u));
  }
  return out;
}

export function pavementRow(pavement, name) {
  const title = pavement.iri < 95 ? "Smooth pavement" : pavement.iri <= 170 ? "Fair pavement" : "Rough pavement";
  return row("pavement", "note", name ? `${title} on ${name}` : title, pavement.year ? `From the federal highway survey, ${pavement.year}` : "From the federal highway survey");
}

/// Warnings first, then cautions, then notes, in their order within each.
export function ordered(rows) {
  return rows.map((r, i) => [r, i]).sort((a, b) => SEVERITY[b[0].severity] - SEVERITY[a[0].severity] || a[1] - b[1]).map(([r]) => r);
}

// ── catalog roads the route runs along (RoadClosures.swift) ──

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const SHARED_METERS = 2000, SHARED_SHARE = 1 / 3, NEAR_METERS = 60, SAMPLE_METERS = 100;

/// A Google polyline (precision 5) as points.
export function decodeLine(text) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => { let r = 0, s = 0, b; do { b = text.charCodeAt(i++) - 63; r |= (b & 31) << s; s += 5; } while (b >= 32 && i <= text.length); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < (text || "").length) { lat += next(); lon += next(); out.push({ lat: lat / 1e5, lon: lon / 1e5 }); }
  return out;
}

export function resample(line, step) {
  if (!line.length) return [];
  let last = line[0];
  const out = [last];
  let carried = 0;
  for (const next of line.slice(1)) {
    const segment = distance(last, next);
    if (!(segment > 0)) continue;
    let at = step - carried;
    while (at <= segment) { const t = at / segment; out.push({ lat: last.lat + (next.lat - last.lat) * t, lon: last.lon + (next.lon - last.lon) * t }); at += step; }
    carried = segment - (at - step);
    last = next;
  }
  return out;
}

const CELL = 0.002;
function grid(points) {
  const cells = new Map();
  for (const p of points) { const k = `${Math.floor(p.lat / CELL)},${Math.floor(p.lon / CELL)}`; (cells.get(k) || cells.set(k, []).get(k)).push(p); }
  return (p, meters) => {
    const y = Math.floor(p.lat / CELL), x = Math.floor(p.lon / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of cells.get(`${y + dy},${x + dx}`) || []) if (distance(p, q) <= meters) return true;
    return false;
  };
}
const box = (pts) => ({ minLat: Math.min(...pts.map((p) => p.lat)), maxLat: Math.max(...pts.map((p) => p.lat)), minLon: Math.min(...pts.map((p) => p.lon)), maxLon: Math.max(...pts.map((p) => p.lon)) });

/// Whether the route covers enough of `line`.
export function runsAlong(line, has) {
  const samples = resample(line, SAMPLE_METERS);
  const total = samples.length * SAMPLE_METERS;
  let shared = 0;
  for (const p of samples) if (has(p, NEAR_METERS)) { shared += SAMPLE_METERS; if (shared >= SHARED_METERS) return true; }
  return shared >= Math.max(SAMPLE_METERS * 5, total * SHARED_SHARE);
}

/// The catalog's roads (area.json drives) this route runs along.
export function catalogRoads(path, drives) {
  if (!path || path.length < 2) return [];
  const b = box(path);
  const padLat = NEAR_METERS / 111_320, padLon = NEAR_METERS / (111_320 * Math.max(0.1, Math.cos(((b.minLat + b.maxLat) / 2) * RAD)));
  const has = grid(resample(path, NEAR_METERS / 2));
  const out = [];
  for (const d of drives || []) {
    if (!d?.road) continue;
    const line = decodeLine(d.road);
    if (line.length < 2) continue;
    const c = box(line);
    if (c.minLat > b.maxLat + padLat || c.maxLat < b.minLat - padLat || c.minLon > b.maxLon + padLon || c.maxLon < b.minLon - padLon) continue;
    if (runsAlong(line, has)) out.push(d);
  }
  return out;
}

/// A road shut in `month` (1–12), and the month it usually reopens.
export function season(closed, month) {
  const shut = new Set(closed || []);
  if (!shut.has(month)) return null;
  for (let k = 1; k <= 12; k++) { const m = ((month - 1 + k) % 12) + 1; if (!shut.has(m)) return { reopens: m }; }
  return { reopens: null };
}

/// The catalog's rows for the drive's day: seasonal closures in its month;
/// with `live`, the traffic check's detours (traffic.json's flagged);
/// pavement from the federal survey (stored, so any day).
export function catalogRows(roads, { month, live, flagged = {} }) {
  const out = [];
  for (const d of roads) {
    const shut = season(d.closed, month);
    if (shut) out.push(row("seasonal", "warning", `${d.name} is usually closed in ${MONTHS[month - 1]}`, "Closed for the season most years; check before you go"));
    if (live && flagged[d.slug]) out.push(row("detour", "caution", `Possible closure on ${d.name}`, "This route runs along it, and live traffic data suggests a detour around it. Check conditions before you go."));
  }
  const paved = roads.find((d) => d.pavement && Number.isFinite(d.pavement.iri));
  if (paved) out.push(pavementRow(paved.pavement, paved.name));
  return out;
}

// ── hazards (0065 hazards_on_route; HazardKind.swift's titles) ──

const HAZARD_TITLES = { police: "Police", hazard: "Road hazard", crash: "Crash", debris: "Something in the road", surface: "Bump or pothole" };
export function hazardRows(hazards, path, places, zone) {
  const out = [];
  for (const h of hazards || []) {
    const title = HAZARD_TITLES[h.kind];
    if (!title || !Number.isFinite(h.lat) || !Number.isFinite(h.lon)) continue;
    const where = near(fractionOf({ lat: h.lat, lon: h.lon }, path), places);
    const when = Date.parse(h.reported_at);
    out.push(row("hazard", "caution", title, join(`Reported${Number.isFinite(when) ? ` at ${clock(when, zone)}` : ""}`, where)));
  }
  return out;
}

// ── the forecast along the way (ForecastAlong.kt) ──

/// The ends, and between them each place whose sky or temperature (by
/// 3 °C) differs from the last one kept: [{ name, passAt, hour }].
export function forecastChanges(markers) {
  if (markers.length <= 2) return markers;
  const kept = [markers[0]];
  for (const m of markers.slice(1, -1)) {
    const last = kept[kept.length - 1].hour;
    if (!m.hour || !last) continue;
    if (m.hour.condition !== last.condition || Math.abs(m.hour.temperatureCelsius - last.temperatureCelsius) >= 3) kept.push(m);
  }
  return [...kept, markers[markers.length - 1]];
}
