// Along the way: Carve's drives a route runs along that may not be open,
// as the app tells it (RoadClosures.swift, the user, 2026-10-24): one the
// daily traffic check finds traffic routing around (drives/traffic.json),
// or one the catalog says is shut that month (roads.json's `cl`, the
// months it's usually closed through). Worked out here, from the
// catalog's road lines; nothing is asked of a server.

import { decode, meters } from "./good-roads.js?v=7";

/// How much of a road a route must run along to be on it: this many
/// meters, or this share of a short road (the app's numbers).
const SHARED_METERS = 2_000;
const SHARED_SHARE = 1 / 3;
/// A road's point counts as on the route within this distance of it.
const NEAR_METERS = 60;
const SAMPLE_METERS = 100;
/// Grid cells, in degrees: about 220 m north–south.
const CELL = 0.002;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/// Where a road is in `month` (1–12): closed, until when (null: it never
/// reopens), or open. The app's RoadSeason, without "closing".
export function season(closed, month) {
  const shut = new Set(closed || []);
  if (!shut.has(month)) return { closed: false };
  for (let k = 1; k <= 12; k++) {
    const m = ((month - 1 + k) % 12) + 1;
    if (!shut.has(m)) return { closed: true, reopens: m };
  }
  return { closed: true, reopens: null };
}

/// Points every `step` meters along a [lon, lat] line.
export function resample(line, step) {
  if (!line.length) return [];
  const out = [line[0]];
  let last = line[0];
  let carried = 0;
  for (const next of line.slice(1)) {
    const segment = meters(last, next);
    if (segment <= 0) continue;
    let at = step - carried;
    while (at <= segment) {
      const t = at / segment;
      out.push([last[0] + (next[0] - last[0]) * t, last[1] + (next[1] - last[1]) * t]);
      at += step;
    }
    carried = segment - (at - step);
    last = next;
  }
  return out;
}

function box(points) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lon, lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function padded(b, m) {
  const lat = m / 111_320;
  const lon = m / (111_320 * Math.max(0.1, Math.cos(((b.minLat + b.maxLat) / 2) * Math.PI / 180)));
  return { minLat: b.minLat - lat, maxLat: b.maxLat + lat, minLon: b.minLon - lon, maxLon: b.maxLon + lon };
}

const overlaps = (a, b) => a.minLat <= b.maxLat && b.minLat <= a.maxLat && a.minLon <= b.maxLon && b.minLon <= a.maxLon;

/// The route's points by cell, for "is anything near here" without a scan.
function grid(points) {
  const cells = new Map();
  const key = (y, x) => `${y},${x}`;
  for (const p of points) {
    const k = key(Math.floor(p[1] / CELL), Math.floor(p[0] / CELL));
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  return (p, within) => {
    const y = Math.floor(p[1] / CELL), x = Math.floor(p[0] / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const q of cells.get(key(y + dy, x + dx)) || []) if (meters(p, q) <= within) return true;
    }
    return false;
  };
}

/// Whether the route covers enough of `line`.
export function runsAlong(line, near) {
  const samples = resample(line, SAMPLE_METERS);
  const total = samples.length * SAMPLE_METERS;
  let shared = 0;
  for (const p of samples) {
    if (!near(p, NEAR_METERS)) continue;
    shared += SAMPLE_METERS;
    if (shared >= SHARED_METERS) return true;
  }
  return shared >= Math.max(SAMPLE_METERS * 5, total * SHARED_SHARE);
}

/// The catalog roads `path` ([lon, lat]) runs along that may be shut in
/// `month` (1–12): { token, slug, name, kind: "traffic" | "season",
/// reopens, itself }, traffic first. `flagged` is traffic.json's slugs;
/// `itself` the token of the drive the route is, if it is one.
export function closures(path, roads, flagged, month, itself = null) {
  if (!path || path.length < 2 || !roads?.length) return [];
  const area = padded(box(path), NEAR_METERS);
  let near = null;
  const out = [];
  for (const road of roads) {
    const flag = flagged.has(road.s);
    const shut = road.cl ? season(road.cl, month) : { closed: false };
    if (!flag && !shut.closed) continue;
    const line = road._line || (road._line = decode(road.r || ""));
    if (line.length < 2 || !overlaps(area, box(line))) continue;
    const isItself = road.t === itself;
    if (!isItself) {
      near ||= grid(resample(path, NEAR_METERS / 2));
      if (!runsAlong(line, near)) continue;
    }
    const base = { token: road.t, slug: road.s, name: road.n, itself: isItself };
    if (flag) out.push({ ...base, kind: "traffic" });
    if (shut.closed) out.push({ ...base, kind: "season", reopens: shut.reopens });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "traffic" ? -1 : 1));
}

/// The app's words for each (RoadClosures.title and .words).
export function closureTitle(hint) {
  if (hint.kind === "traffic") return hint.itself ? "Possible closure" : `Possible closure on ${hint.name}`;
  return hint.itself ? "Usually closed now" : `${hint.name} is usually closed now`;
}

export function closureWords(hint) {
  if (hint.kind === "traffic") {
    return hint.itself
      ? "Live traffic data suggests a detour around this road. Check conditions before you go."
      : "This route runs along it, and live traffic data suggests a detour around it. Check conditions before you go.";
  }
  const back = hint.reopens ? ` It usually reopens in ${MONTHS[hint.reopens - 1]}.` : "";
  return hint.itself
    ? `This road closes for the season.${back} Check conditions before you go.`
    : `This route runs along a road that closes for the season.${back} Check conditions before you go.`;
}
