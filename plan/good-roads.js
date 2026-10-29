// Carve's drives near the route being planned, as the app's planner finds
// them (Carve/Home/PlanGoodRoads.swift and NearbyDrive, ported): the
// nearest few within three miles that aren't on the route already, where
// each would go in among the plan's points to add the least, and the
// points it adds. Pure, so scripts/plan-tests/good-roads.test.mjs checks it.
//
// The catalog is /drives/roads.json (build_area_pages.py write_roads):
// { t: token, s: slug, n: name, p: place, m: miles, min: minutes,
//   b: bends, c: climb feet, e: [start end, far end], r: polyline, i: card }.
// Points are [lon, lat], as the map's.

/// Near: within three miles of the route (NearbyDrive.within).
export const WITHIN_METERS = 3 * 1609.344;
/// Both ends this near the route: on it already (PlanRoads.onRoute).
export const ON_ROUTE_METERS = 400;
/// Straight lines run this much shorter than the roads between.
const DETOUR = 1.3;
/// A route's pace before it has a road to time, in m/s.
const DEFAULT_SPEED = 20;
/// The + sits where the road is at least this far from the route.
const CLEAR_METERS = 1500;

/// How twisty, the apps' RoadIntensity: its title, colour and line.
export const LEVELS = [
  { key: "leisurely", title: "Leisurely", below: 90, colour: "#3B8A3E", weight: 2.0, path: "M9 21L15 3" },
  { key: "sweeping", title: "Sweeping", below: 180, colour: "#C0860A", weight: 2.4, path: "M6 21C14 21 18 17 12 12C6 7 10 3 18 3" },
  { key: "twisty", title: "Twisty", below: 300, colour: "#D2591F", weight: 2.8, path: "M2 12Q4.5 3 7 12Q9.5 21 12 12Q14.5 3 17 12Q19.5 21 22 12" },
  { key: "intense", title: "Intense", below: Infinity, colour: "#9B1C1C", weight: 3.0, path: "M7 21L17 17.5L7 14L17 10.5L7 7L17 3.5" },
];

export function level(bends) {
  if (!Number.isFinite(bends)) return null;
  return LEVELS.find((l) => bends < l.below);
}

/// Google's encoded polyline, precision 5, as [lon, lat] points.
export function decode(text) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, byte;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < text.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    lat += next();
    lon += next();
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

export function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/// From p to the nearest place on the segment a–b, on a local flat frame.
function toSegment(p, a, b) {
  const k = Math.cos(p[1] * Math.PI / 180);
  const ax = (a[0] - p[0]) * k * 111320, ay = (a[1] - p[1]) * 110540;
  const bx = (b[0] - p[0]) * k * 111320, by = (b[1] - p[1]) * 110540;
  const dx = bx - ax, dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function toLine(p, line) {
  if (line.length === 1) return meters(p, line[0]);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, toSegment(p, line[i - 1], line[i]));
  return best;
}

function crosses(p1, p2, q1, q2) {
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = side(q1, q2, p1), d2 = side(q1, q2, p2), d3 = side(p1, p2, q1), d4 = side(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/// The nearest two lines come, segment by segment (0 where they cross).
export function between(a, b) {
  if (a.length === 1) return toLine(a[0], b);
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (crosses(a[i - 1], a[i], b[j - 1], b[j])) return 0;
      best = Math.min(best, toSegment(a[i - 1], b[j - 1], b[j]), toSegment(a[i], b[j - 1], b[j]),
        toSegment(b[j - 1], a[i - 1], a[i]), toSegment(b[j], a[i - 1], a[i]));
    }
  }
  return best;
}

function box(line, padding) {
  let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (const [lon, lat] of line) {
    s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon);
  }
  const dLat = padding / 111320;
  const dLon = padding / (111320 * Math.max(0.2, Math.cos((s + n) / 2 * Math.PI / 180)));
  return { s: s - dLat, n: n + dLat, w: w - dLon, e: e + dLon };
}
const overlaps = (a, b) => a.s <= b.n && b.s <= a.n && a.w <= b.e && b.w <= a.e;

export function length(line) {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += meters(line[i - 1], line[i]);
  return total;
}

/// The line's own point nearest `share` of the way along it.
export function along(share, line) {
  const total = length(line);
  if (!(total > 0)) return null;
  let travelled = 0, best = null, off = Infinity;
  line.forEach((point, i) => {
    if (i > 0) travelled += meters(line[i - 1], point);
    const here = Math.abs(travelled - share * total);
    if (here < off) { off = here; best = point; }
  });
  return best;
}

/// A road's line, decoded once.
export function lineOf(road) {
  if (!road._line) road._line = decode(road.r || "");
  return road._line;
}

/// Where a road from a to b adds least to the trip: between which two of
/// the chain's points (it goes in before the chain's point index + 1),
/// which end first, and about how many seconds it adds (a minute at least).
export function placement(a, b, roadSeconds, chain, metersPerSecond) {
  const pace = Number.isFinite(metersPerSecond) && metersPerSecond > 0 ? Math.max(metersPerSecond, 1) : DEFAULT_SPEED;
  const road = Number.isFinite(roadSeconds) ? Math.max(roadSeconds, 0) : 0;
  let best = { index: Math.max(chain.length - 2, 0), reversed: false, seconds: Infinity };
  for (let index = 0; index < chain.length - 1; index++) {
    const before = chain[index], after = chain[index + 1];
    const leg = meters(before, after);
    for (const reversed of [false, true]) {
      const [entry, exit] = reversed ? [b, a] : [a, b];
      const seconds = (meters(before, entry) + meters(exit, after) - leg) * DETOUR / pace + road;
      if (seconds < best.seconds) best = { index, reversed, seconds };
    }
  }
  if (chain.length === 1) best = { index: 0, reversed: meters(chain[0], b) < meters(chain[0], a), seconds: meters(chain[0], a) * DETOUR / pace + road };
  return { ...best, seconds: Math.max(Number.isFinite(best.seconds) ? best.seconds : road, 60) };
}

/// The point of a road, a sixth to five sixths along, farthest from the
/// route (the middle when it keeps well clear): where its chip goes.
export function addPoint(line, path) {
  const middle = along(0.5, line);
  if (!middle || path.length < 1) return middle;
  if (toLine(middle, path) >= CLEAR_METERS) return middle;
  let best = { point: middle, meters: toLine(middle, path) };
  for (let step = 1; step <= 10; step++) {
    for (const share of [0.5 + step / 30, 0.5 - step / 30]) {
      const point = along(share, line);
      if (!point) continue;
      const m = toLine(point, path);
      if (m >= CLEAR_METERS) return point;
      if (m > best.meters) best = { point, meters: m };
    }
  }
  return best.point;
}

const roadSecondsOf = (road, line) => (Number.isFinite(road.min) ? road.min * 60 : length(line) / 15.6);

/// The nearest `limit` roads to the route that aren't on it, each with its
/// placing. `path`: the route's line (its road, or straight lines between
/// its points, or its one point); `chain`: start, waypoints, end.
export function findRoads({ path, chain, metersPerSecond }, catalog, limit = 5) {
  if (!path.length || !chain.length) return [];
  const thin = path.length > 400 ? path.filter((_, i) => i % (Math.floor(path.length / 300) + 1) === 0).concat([path[path.length - 1]]) : path;
  const around = box(thin, WITHIN_METERS);
  const near = [];
  for (const road of catalog) {
    const line = lineOf(road);
    if (line.length < 2) continue;
    road._box ??= box(line, 0);
    if (!overlaps(road._box, around)) continue;
    const apart = between(thin, line);
    if (apart > WITHIN_METERS) continue;
    const first = line[0], last = line[line.length - 1];
    if (thin.length >= 2 && toLine(first, thin) <= ON_ROUTE_METERS && toLine(last, thin) <= ON_ROUTE_METERS) continue;
    near.push({ road, line, meters: apart });
  }
  near.sort((a, b) => a.meters - b.meters);
  return near.slice(0, limit).map(({ road, line, meters: apart }) => {
    const placed = placement(line[0], line[line.length - 1], roadSecondsOf(road, line), chain, metersPerSecond);
    return { road, line, meters: apart, ...placed, addAt: addPoint(line, thin) };
  });
}

/// Placed again against the plan as it is now (the app's add does this
/// too: a quick second add went in the wrong place).
export function replace(found, chain, metersPerSecond) {
  const { line, road } = found;
  return { ...found, ...placement(line[0], line[line.length - 1], roadSecondsOf(road, line), chain, metersPerSecond) };
}

/// The points a road adds: its first end, named for the road; two to five
/// points along it so the router keeps to it; its far end, by the
/// catalog's name for it (PlanRoads.points).
export function roadPoints(found) {
  const line = found.reversed ? [...found.line].reverse() : found.line;
  const count = Math.min(5, Math.max(2, Math.floor(length(line) / 30000)));
  const vias = [];
  for (let i = 1; i <= count; i++) {
    const point = along(i / (count + 1), line);
    if (point) vias.push({ at: point, label: null });
  }
  const ends = Array.isArray(found.road.e) && found.road.e.length === 2 ? found.road.e : null;
  const exit = ends ? (found.reversed ? ends[0] : ends[1]) || null : null;
  return [{ at: line[0], label: found.road.n }, ...vias, { at: line[line.length - 1], label: exit }];
}
