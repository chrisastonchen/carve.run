// Carve's drives on the planner's map (the app's Explore roads, its
// catalog's road lines): each road's line, decoded from the catalog, how
// twisty it is as the apps mark it, and, for adding one to a route, the
// stretch of it that fits the route and where it goes in among the plan's
// points (the app's PlanGoodRoads: fit, placement and points). Pure, so
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

/// Shaping points along a stretch: 2 to 5 by its length (RoadOnMap.viaCount).
const viaCount = (m) => Math.min(5, Math.max(2, Math.floor(m / 30000)));

/// The points a road adds, in the order they're driven: the stretch's first
/// end, named for the road; points along it so the router keeps to it; its
/// far end, by the catalog's name for it only when the stretch reaches that
/// end of the road (PlanRoads.points).
export function roadPoints(found) {
  const line = found.reversed ? [...found.line].reverse() : found.line;
  const count = viaCount(length(line));
  const vias = [];
  for (let i = 1; i <= count; i++) {
    const point = shaping(i / (count + 1), line, 0.25 / (count + 1));
    if (point) vias.push({ at: point, label: null });
  }
  const reaches = found.reversed ? found.startsAtEnd !== false : found.endsAtEnd !== false;
  const ends = Array.isArray(found.road.e) && found.road.e.length === 2 ? found.road.e : null;
  const exit = reaches && ends ? (found.reversed ? ends[0] : ends[1]) || null : null;
  return [{ at: line[0], label: found.road.n }, ...vias, { at: line[line.length - 1], label: exit }];
}

/// A shaping point `share` of the way along: the line's own point there, or,
/// where its points are far apart (a trimmed stretch's few) and the nearest
/// is more than `slack` of the line off, the place on the line itself, so
/// shaping points never pile onto its ends or come out of order.
function shaping(share, line, slack) {
  const total = length(line);
  const vertex = along(share, line);
  if (!(total > 0) || !vertex) return null;
  const target = share * total;
  let travelled = 0;
  for (let i = 1; i < line.length; i++) {
    const span = meters(line[i - 1], line[i]);
    if (travelled + span >= target) {
      const f = span > 0 ? (target - travelled) / span : 0;
      const here = [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f];
      return meters(vertex, here) <= slack * total ? vertex : here;
    }
    travelled += span;
  }
  return vertex;
}

// ── The stretch of a road that fits the route (PlanRoads.fit, the app's
// 7ad7e52b8; the user, 2026-11-04: a road added whole meant driving to one
// end, all of it, and back). The road is tried in pieces, every entry and
// exit between them, both ways, in each leg of the plan it comes near; the
// best-scoring stretch that keeps these rules wins. ──────────────────────

/// A road this near the route along most of a stretch is on it already.
const ON_ROUTE = 400;
const ON_ROUTE_SHARE = 0.8;
/// A turn sharper than this onto the stretch or off it is a U-turn: the
/// road's heading over its first or last LOOK metres, against the route's
/// there and against the hop from the route to it.
const SHARPEST_TURN = 135;
const LOOK = 1000;
/// A hop to or from the route shorter than this has no heading to speak of.
const SHORT_HOP = 300;
/// Headway along the route: half the stretch's straight span, a quarter of its length.
const SPAN_HEADWAY = 0.5;
const LENGTH_HEADWAY = 0.25;
/// Worth adding: 3 km at least and a quarter of the road (10 km does, for a long one).
const SHORTEST_STRETCH = 3000;
const SHORTEST_SHARE = 0.25;
const ENOUGH_STRETCH = 10000;
/// It adds no more than 15 minutes, or 40% of the leg it goes in.
const MOST_ADDED_SECONDS = 15 * 60;
const MOST_ADDED_SHARE = 0.4;
/// A minute added weighs 0.6 of a minute on the road.
const ADDED_WEIGHT = 0.6;
/// The road is tried in about this many pieces, each at least PIECE long.
const PIECES = 40;
const PIECE = 500;
/// The app's NearbyDrive.within: legs this near the road are tried.
const WITHIN = 3 * 1609.344;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => { const l = len(v); return l > 1e-6 ? [v[0] / l, v[1] / l] : null; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const neg = (v) => (v ? [-v[0], -v[1]] : null);

/// A line on a flat frame (metres east and north), with how far along each point is.
class Track {
  constructor(points) {
    this.points = points;
    this.along = [0];
    for (let i = 1; i < points.length; i++) this.along.push(this.along[i - 1] + len(sub(points[i], points[i - 1])));
  }
  get length() { return this.along[this.along.length - 1] || 0; }
  segment(s) {
    let lo = 0, hi = Math.max(this.points.length - 2, 0);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.along[mid] <= s) lo = mid; else hi = mid - 1;
    }
    return lo;
  }
  point(s) {
    const p = this.points;
    if (p.length < 2) return p[0] || [0, 0];
    s = Math.min(Math.max(s, 0), this.length);
    const i = this.segment(s);
    const span = this.along[i + 1] - this.along[i];
    const f = span > 0 ? (s - this.along[i]) / span : 0;
    return [p[i][0] + (p[i + 1][0] - p[i][0]) * f, p[i][1] + (p[i + 1][1] - p[i][1]) * f];
  }
  heading(a, b) { return unit(sub(this.point(b), this.point(a))); }
  nearest(q) {
    let best = { along: 0, meters: Infinity };
    for (let i = 0; i < this.points.length - 1; i++) {
      const a = this.points[i], d = sub(this.points[i + 1], a);
      const l2 = dot(d, d);
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(q, a), d) / l2));
      const off = len(sub(q, [a[0] + d[0] * t, a[1] + d[1] * t]));
      if (off < best.meters) best = { along: this.along[i] + t * (this.along[i + 1] - this.along[i]), meters: off };
    }
    return best;
  }
  /// The part of `line` (these points, as [lon, lat]) from a to b metres along.
  slice(line, a, b) {
    const at = (s) => {
      s = Math.min(Math.max(s, 0), this.length);
      const i = this.segment(s);
      const span = this.along[i + 1] - this.along[i];
      const f = span > 0 ? (s - this.along[i]) / span : 0;
      return [line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f];
    };
    if (line.length !== this.points.length || line.length < 2) return line;
    const inside = line.filter((_, i) => this.along[i] > a && this.along[i] < b);
    return [at(a), ...inside, at(b)];
  }
}

const box = (points, pad) => {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
};
const meets = (a, b) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/// The plan on a flat frame: its line, thinned, and each leg's part of it.
function frameOf({ path, chain, metersPerSecond, pathIsRoad }) {
  if (!Array.isArray(path) || path.length < 2 || !Array.isArray(chain) || chain.length < 2) return null;
  const thin = path.length > 400 ? [...path.filter((_, i) => i % (Math.floor(path.length / 300) + 1) === 0), path[path.length - 1]] : path;
  const origin = chain[0];
  const scale = 111320 * Math.max(0.2, Math.cos(origin[1] * Math.PI / 180));
  const xy = (c) => [(c[0] - origin[0]) * scale, (c[1] - origin[1]) * 111320];
  const flat = thin.map(xy);
  const links = chain.map(xy);
  const marks = [0];
  for (const point of links.slice(1, -1)) {
    let best = { index: marks[marks.length - 1], meters: Infinity };
    for (let j = marks[marks.length - 1]; j < flat.length; j++) {
      const m = len(sub(flat[j], point));
      if (m < best.meters) best = { index: j, meters: m };
    }
    marks.push(best.index);
  }
  marks.push(flat.length - 1);
  const legs = [];
  for (let i = 0; i < links.length - 1; i++) {
    const lo = marks[i], hi = marks[i + 1];
    const track = new Track(hi > lo ? flat.slice(lo, hi + 1) : [links[i], links[i + 1]]);
    if (track.length < 1) continue;
    legs.push({ index: i, track, box: box(track.points, 0) });
  }
  const pace = Number.isFinite(metersPerSecond) && metersPerSecond > 0 ? Math.max(metersPerSecond, 1) : DEFAULT_SPEED;
  return { path: thin, xy, legs, pace, pathFactor: pathIsRoad ? 1 : DETOUR };
}

/// Metres from a point to the nearest place on a line, both [lon, lat].
function distanceTo(point, line) {
  const scale = 111320 * Math.cos(point[1] * Math.PI / 180);
  const xy = (c) => [(c[0] - point[0]) * scale, (c[1] - point[1]) * 111320];
  return new Track(line.map(xy)).nearest([0, 0]).meters;
}

/// The point of a stretch, between a sixth and five sixths of the way along,
/// farthest from the route, for marking it (PlanRoads.addPoint).
export function addPoint(line, path) {
  const middle = along(0.5, line);
  if (!middle || !Array.isArray(path) || path.length < 2) return middle;
  const clear = 1500;
  let best = { point: middle, meters: distanceTo(middle, path) };
  if (best.meters >= clear) return middle;
  for (let step = 1; step <= 10; step++) {
    for (const share of [0.5 + step / 30, 0.5 - step / 30]) {
      const point = along(share, line);
      if (!point) continue;
      const m = distanceTo(point, path);
      if (m >= clear) return point;
      if (m > best.meters) best = { point, meters: m };
    }
  }
  return best.point;
}

/// The best stretch of a road for the plan as it is now, or null when none
/// fits. `plan` is { path: the routed line (or straight lines between the
/// points), chain: start, waypoints, end, metersPerSecond, pathIsRoad }.
/// The result goes to roadPoints and goes in before the chain's point
/// index + 1, like placement's.
export function fitRoad(road, plan) {
  const frame = frameOf(plan);
  const line = lineOf(road);
  if (!frame || line.length < 2) return null;
  const track = new Track(line.map(frame.xy));
  const total = track.length;
  const shortest = Math.max(SHORTEST_STRETCH, Math.min(SHORTEST_SHARE * total, ENOUGH_STRETCH));
  if (total < shortest) return null;
  const roadSeconds = Number.isFinite(road.min) && road.min > 0 ? road.min * 60 : total / 15.6;
  const count = Math.max(1, Math.min(PIECES, Math.ceil(total / PIECE)));
  const at = Array.from({ length: count + 1 }, (_, j) => total * j / count);
  const q = at.map((s) => track.point(s));
  const ahead = at.map((s) => track.heading(s, s + LOOK));
  const behind = at.map((s) => track.heading(s - LOOK, s));
  const roadBox = box(track.points, WITHIN);
  const turn = Math.cos(SHARPEST_TURN * Math.PI / 180);
  const turns = (a, b) => !!(a && b) && dot(a, b) < turn;

  let best = null;
  for (const leg of frame.legs) {
    if (!meets(leg.box, roadBox)) continue;
    const route = leg.track;
    const foot = q.map((p) => route.nearest(p));
    const way = foot.map((f) => route.heading(f.along - 500, f.along + 500));
    const hopIn = q.map((p, j) => (foot[j].meters < SHORT_HOP ? null : unit(sub(p, route.point(foot[j].along - foot[j].meters)))));
    const hopOut = q.map((p, j) => (foot[j].meters < SHORT_HOP ? null : unit(sub(route.point(foot[j].along + foot[j].meters), p))));
    const near = [0];
    for (const f of foot) near.push(near[near.length - 1] + (f.meters <= ON_ROUTE ? 1 : 0));
    const legSeconds = route.length * frame.pathFactor / frame.pace;
    const most = Math.max(MOST_ADDED_SECONDS, MOST_ADDED_SHARE * legSeconds);
    for (const forward of [true, false]) {
      const entering = q.map((_, j) => {
        const r = forward ? ahead[j] : neg(behind[j]);
        return !!r && !turns(r, way[j]) && !turns(hopIn[j], r);
      });
      const leaving = q.map((_, j) => {
        const r = forward ? behind[j] : neg(ahead[j]);
        return !!r && !turns(r, way[j]) && !turns(r, hopOut[j]);
      });
      for (let a = 0; a < q.length; a++) {
        if (!entering[a]) continue;
        for (let b = 0; b < q.length; b++) {
          if (!(forward ? b > a : b < a) || !leaving[b]) continue;
          const stretch = Math.abs(at[b] - at[a]);
          if (stretch < shortest) continue;
          const headway = foot[b].along - foot[a].along;
          if (headway < SPAN_HEADWAY * len(sub(q[b], q[a])) || headway < LENGTH_HEADWAY * stretch) continue;
          const lo = Math.min(a, b), hi = Math.max(a, b);
          if (near[hi + 1] - near[lo] >= ON_ROUTE_SHARE * (hi - lo + 1)) continue;
          const stretchSeconds = roadSeconds * stretch / total;
          const added = (foot[a].meters + foot[b].meters) * DETOUR / frame.pace - headway * frame.pathFactor / frame.pace + stretchSeconds;
          if (added > most) continue;
          const score = stretchSeconds - ADDED_WEIGHT * added;
          if (!(score > 0) || score <= (best?.score ?? 0)) continue;
          best = { leg: leg.index, a, b, added, score, stretchSeconds };
        }
      }
    }
  }
  if (!best) return null;
  const lo = Math.min(best.a, best.b), hi = Math.max(best.a, best.b);
  const stretch = track.slice(line, at[lo], at[hi]);
  return {
    road, line: stretch, index: best.leg, reversed: best.b < best.a,
    seconds: Math.max(best.added, 60), roadSeconds: best.stretchSeconds,
    share: (at[hi] - at[lo]) / total, startsAtEnd: lo === 0, endsAtEnd: hi === count, score: best.score,
    addAt: addPoint(stretch, frame.path),
  };
}
