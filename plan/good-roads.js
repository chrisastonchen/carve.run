// Carve's drives on the planner's map (the app's Explore roads, its
// catalog's road lines): each road's line, decoded from the catalog, how
// twisty it is as the apps mark it, and, for "Drive the whole road", where
// it goes in among the plan's points and the points it adds (the app's
// PlanGoodRoads.placement and .points). Pure, so
// scripts/plan-tests/good-roads.test.mjs checks it.
//
// The catalog is /drives/roads.json (build_area_pages.py write_roads):
// { t: token, s: slug, n: name, p: place, m: miles, min: minutes,
//   b: bends, c: climb feet, e: [start end, far end], r: polyline, i: card }.
// Points are [lon, lat], as the map's.

/// Straight lines run this much shorter than the roads between.
const DETOUR = 1.3;
/// A route's pace before it has a road to time, in m/s.
const DEFAULT_SPEED = 20;

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

/// A road's line, decoded once.
export function lineOf(road) {
  if (!road._line) road._line = decode(road.r || "");
  return road._line;
}

export function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

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
  if (chain.length === 1) best = { index: 0, reversed: meters(chain[0], b) < meters(chain[0], a), seconds: Math.min(meters(chain[0], a), meters(chain[0], b)) * DETOUR / pace + road };
  return { ...best, seconds: Math.max(Number.isFinite(best.seconds) ? best.seconds : road, 60) };
}

/// A road driven whole, placed against the plan's points (start,
/// waypoints, end): which way round, where, and about how long it adds.
export function wholeRoad(road, chain, metersPerSecond) {
  const line = lineOf(road);
  const roadSeconds = Number.isFinite(road.min) ? road.min * 60 : length(line) / 15.6;
  return { road, line, roadSeconds, ...placement(line[0], line[line.length - 1], roadSeconds, chain, metersPerSecond) };
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
