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
/// end, named for the road; points along it so the router keeps to it,
/// named for the road too; its far end, by the catalog's name for it when
/// the stretch reaches that end of the road, else the road's (PlanRoads.points;
/// the QA, 2026-11-04: named for their towns, "Woodside" three times).
export function roadPoints(found) {
  const line = found.reversed ? [...found.line].reverse() : found.line;
  const count = viaCount(length(line));
  const vias = [];
  for (let i = 1; i <= count; i++) {
    const point = shaping(i / (count + 1), line, 0.25 / (count + 1));
    if (point) vias.push({ at: point, label: found.road.n });
  }
  const reaches = found.reversed ? found.startsAtEnd !== false : found.endsAtEnd !== false;
  const ends = Array.isArray(found.road.e) && found.road.e.length === 2 ? found.road.e : null;
  const exit = (reaches && ends ? (found.reversed ? ends[0] : ends[1]) : null) || found.road.n;
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
/// The stretch's ends don't run on away from the route (the app's
/// 9d8666788; the user, 2026-11-04: Skyline added to the Page Mill
/// junction, and the trip drove on to Saratoga Gap to turn round). Over its
/// last LOOK metres the stretch keeps closing on the route or making
/// headway along it: its distance off, less how far along, rises no more
/// than this above its least; its first LOOK metres, mirrored (distance off
/// plus how far along). The router carries straight on through a waypoint,
/// so an exit past the place the trip leaves the road is a U-turn.
const OVERSHOOT = 150;
/// The road is looked at about this often for that.
const OVERSHOOT_STEP = 100;
/// Where the road meets the route (comes within SHORT_HOP of it, anywhere
/// on it), the stretch's exit is at least CLEARANCE short of the meeting
/// and its entry at least that past one: the catalog's line is coarse
/// (Skyline's points are a kilometre apart), so a point at the junction can
/// land past it. The meeting is where it's closest, give or take MEET_SLACK.
const CLEARANCE = 300;
const MEET_SLACK = 50;
/// The app's NearbyDrive.within: legs this near the road are tried.
const WITHIN = 3 * 1609.344;
/// Both of a road's ends this near the route, at two places along it in its
/// order: the whole road, entered at the earlier and left at the later,
/// whatever the 15-minute cap says (Chris, 11/10: Highway 9 from Saratoga to
/// Santa Cruz off 85 and 17 added 49 minutes; capped, the stretch began 6 km
/// up the hill, reached only by turning round on Skyline). The routed check
/// still takes it out for a real U-turn or far more time than it said.
const ENDS_NEAR = 5000;

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
  return { path: thin, xy, line: new Track(flat), legs, pace, pathFactor: pathIsRoad ? 1 : DETOUR };
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
  // Finer places along the road, SUB to a piece, for the ends' overshoot:
  // piece j is fine[j * SUB].
  const SUB = Math.max(1, Math.min(5, Math.floor(total / count / OVERSHOOT_STEP)));
  const fine = Array.from({ length: count * SUB + 1 }, (_, i) => total * i / (count * SUB));
  const fineAt = fine.map((s) => track.point(s));
  const reach = Math.ceil(LOOK / (total / (count * SUB)));

  // Where the road meets the route (within a short hop), anywhere on it: a
  // leg's own, or one before or after (the QA, 2026-11-04: La Honda Road
  // driven back down the road the trip set off on). Each run of such
  // places, and the first and last of its closest.
  const off = fineAt.map((p) => frame.line.nearest(p).meters);
  const meetings = [];
  for (let i = 0; i < fine.length;) {
    if (off[i] > SHORT_HOP) { i++; continue; }
    let j = i;
    while (j + 1 < fine.length && off[j + 1] <= SHORT_HOP) j++;
    const closest = Math.min(...off.slice(i, j + 1)) + MEET_SLACK;
    const nearest = [];
    for (let k = i; k <= j; k++) if (off[k] <= closest) nearest.push(k);
    meetings.push({ lo: i, hi: j, first: nearest[0], last: nearest[nearest.length - 1] });
    i = j + 1;
  }
  /// Whether a stretch from piece a to piece b keeps clear of where it
  /// meets the route: its exit CLEARANCE short of the last meeting it
  /// reaches (unless that's where it was entered), its entry CLEARANCE past
  /// the first (unless that's where it's left).
  const clearOfMeetings = (a, b) => {
    const entry = a * SUB, exit = b * SUB;
    const lo = Math.min(entry, exit), hi = Math.max(entry, exit);
    const on = meetings.filter((m) => m.hi >= lo && m.lo <= hi);
    if (!on.length) return true;
    const forward = exit > entry;
    // Metres from one place to another the way it's driven.
    const ahead = (from, to) => (forward ? fine[to] - fine[from] : fine[from] - fine[to]);
    const last = forward ? on[on.length - 1] : on[0], first = forward ? on[0] : on[on.length - 1];
    const holds = (m, i) => m.lo <= i && i <= m.hi;
    if (!holds(last, entry) && ahead(forward ? last.first : last.last, exit) > -CLEARANCE) return false;
    if (!holds(first, exit) && ahead(forward ? first.last : first.first, entry) < CLEARANCE) return false;
    return true;
  };

  let best = null;
  let whole = null; // the whole road, both ends by the route in its order
  for (const leg of frame.legs) {
    if (!meets(leg.box, roadBox)) continue;
    const route = leg.track;
    const foot = q.map((p) => route.nearest(p));
    const way = foot.map((f) => route.heading(f.along - 500, f.along + 500));
    const hopIn = q.map((p, j) => (foot[j].meters < SHORT_HOP ? null : unit(sub(p, route.point(foot[j].along - foot[j].meters)))));
    const hopOut = q.map((p, j) => (foot[j].meters < SHORT_HOP ? null : unit(sub(route.point(foot[j].along + foot[j].meters), p))));
    // Off the route less along it (the exit's last stretch must bring it
    // down), and off plus along (the entry's first must not): an end past a
    // junction the route turns at runs away from it with no headway.
    const fineFoot = fineAt.map((p) => route.nearest(p));
    const closing = fineFoot.map((f) => f.meters - f.along);
    const opening = fineFoot.map((f) => f.meters + f.along);
    /// Whether the end at piece j, its stretch on the side `inward` (+1:
    /// further along the road), keeps `value` within OVERSHOOT of its least
    /// over the stretch's LOOK metres.
    const clear = (j, inward, value) => {
      const end = j * SUB;
      const other = Math.min(Math.max(end + inward * reach, 0), fine.length - 1);
      const least = Math.min(...value.slice(Math.min(end, other), Math.max(end, other) + 1));
      return value[end] - least <= OVERSHOOT;
    };
    // How far along the leg each piece is, the leg run on straight past its
    // ends: one nearest its first (or last) LOOK metres is behind its start
    // (or past its end) by as far as it lies back along the leg's way over
    // them (the app's 824e7db72; the QA, 2026-11-04: La Honda Road from
    // Woodside, behind the start, the trip driving there first).
    const startWay = route.heading(0, LOOK), endWay = route.heading(route.length - LOOK, route.length);
    const legStart = route.point(0), legEnd = route.point(route.length);
    const legAlong = q.map((p, j) => {
      let s = foot[j].along;
      if (s < LOOK && startWay) s = Math.min(s, dot(sub(p, legStart), startWay));
      if (s > route.length - LOOK && endWay) s = Math.max(s, route.length + dot(sub(p, legEnd), endWay));
      return s;
    });
    const near = [0];
    for (const f of foot) near.push(near[near.length - 1] + (f.meters <= ON_ROUTE ? 1 : 0));
    const legSeconds = route.length * frame.pathFactor / frame.pace;
    const most = Math.max(MOST_ADDED_SECONDS, MOST_ADDED_SHARE * legSeconds);
    for (const forward of [true, false]) {
      const entering = q.map((_, j) => {
        const r = forward ? ahead[j] : neg(behind[j]);
        return !!r && !turns(r, way[j]) && !turns(hopIn[j], r) && clear(j, forward ? 1 : -1, opening);
      });
      const leaving = q.map((_, j) => {
        const r = forward ? behind[j] : neg(ahead[j]);
        return !!r && !turns(r, way[j]) && !turns(r, hopOut[j]) && clear(j, forward ? -1 : 1, closing);
      });
      for (let a = 0; a < q.length; a++) {
        if (!entering[a]) continue;
        for (let b = 0; b < q.length; b++) {
          if (!(forward ? b > a : b < a) || !leaving[b]) continue;
          const stretch = Math.abs(at[b] - at[a]);
          if (stretch < shortest) continue;
          // In the leg's order: not entered behind where it starts, nor left
          // past where it ends.
          if (legAlong[a] < -CLEARANCE || legAlong[b] > route.length + CLEARANCE) continue;
          const headway = foot[b].along - foot[a].along;
          if (headway < SPAN_HEADWAY * len(sub(q[b], q[a])) || headway < LENGTH_HEADWAY * stretch) continue;
          const lo = Math.min(a, b), hi = Math.max(a, b);
          if (near[hi + 1] - near[lo] >= ON_ROUTE_SHARE * (hi - lo + 1) || !clearOfMeetings(a, b)) continue;
          const stretchSeconds = roadSeconds * stretch / total;
          const added = (foot[a].meters + foot[b].meters) * DETOUR / frame.pace - headway * frame.pathFactor / frame.pace + stretchSeconds;
          const score = stretchSeconds - ADDED_WEIGHT * added;
          if (lo === 0 && hi === count && foot[a].meters <= ENDS_NEAR && foot[b].meters <= ENDS_NEAR && score > 0 && score > (whole?.score ?? 0)) {
            whole = { leg: leg.index, a, b, added, score, stretchSeconds };
          }
          if (added > most) continue;
          if (!(score > 0) || score <= (best?.score ?? 0)) continue;
          best = { leg: leg.index, a, b, added, score, stretchSeconds };
        }
      }
    }
  }
  if (whole) best = whole;
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

/// Whether the route runs along the road already: both its ends by the
/// route, or ON_ROUTE_SHARE of it within ON_ROUTE of it (PlanRoads.isOnRoute).
export function isOnRoute(road, plan) {
  const frame = frameOf(plan);
  const line = lineOf(road);
  if (!frame || line.length < 2) return false;
  if (distanceTo(line[0], frame.path) <= ON_ROUTE && distanceTo(line[line.length - 1], frame.path) <= ON_ROUTE) return true;
  const track = new Track(line.map(frame.xy)), path = new Track(frame.path.map(frame.xy));
  let near = 0;
  for (let i = 0; i <= 50; i++) if (path.nearest(track.point(track.length * i / 50)).meters <= ON_ROUTE) near++;
  return near >= ON_ROUTE_SHARE * 51;
}

// ── A U-turn on the routed line (the app's 9d8666788; the user,
// 2026-11-04: adding a road must never make a U-turn) ────────────────────

/// Two passes this near are the same road driven back.
const RETRACE_MATCH = 80;
/// Driven back at least this far each way, it's a U-turn: less is the two
/// sides of a sharp junction. Looked for this far out from the turn first,
/// then any of RETRACE_FROM.
const SHORTEST_RETRACE = 150;
const RETRACE_FROM = [SHORTEST_RETRACE, 300, 500, 750, 1000];
/// A road's end this near the out-and-back is on it.
const ON_U_TURN = 150;
/// A trimmed end goes this far short of where the out-and-back begins.
const TRIM_BACK = 200;
/// Routed, a road that adds more than this share of what was said, plus
/// this, doesn't go in (the QA, 2026-11-04: +20 min said, +55 driven). A
/// backstop only (the user, 2026-11-04: Skyline, +15 said and +30 driven,
/// refused at 1.5 and 5 min; the app's 975963ede): +15 said goes in up to +45.
export const PROMISE_SHARE = 2;
export const PROMISE_SLACK = 15 * 60;

/// A flat frame about a line's first point, both ways.
function flatAbout(origin) {
  const scale = 111320 * Math.max(0.2, Math.cos(origin[1] * Math.PI / 180));
  return {
    xy: (c) => [(c[0] - origin[0]) * scale, (c[1] - origin[1]) * 111320],
    lonLat: (p) => [origin[0] + p[0] / scale, origin[1] + p[1] / 111320],
  };
}

/// Whether the routed line drives out and back through the added stretch's
/// entry or exit (the router carries on past a waypoint and turns round
/// wherever it can), and if so, where that end goes instead: short of where
/// the out-and-back begins (an exit) or past where it ends (an entry). Null:
/// no U-turn at either end (PlanRoads.uTurnEnds).
export function uTurnEnds(path, entry, exit) {
  if (!Array.isArray(path) || path.length < 3) return null;
  const { xy, lonLat } = flatAbout(path[0]);
  const track = new Track(path.map(xy));
  const together = (s, d) => s - d >= 0 && s + d <= track.length && len(sub(track.point(s - d), track.point(s + d))) < RETRACE_MATCH;
  // Each out-and-back, from where it leaves the road it came by to where
  // it's back: metres along the line.
  // Looked for every 25 m, not only at the line's points, and as far out as
  // a kilometre: a turn round a block (Directions loops one rather than turn
  // at a waypoint; the app's 824e7db72) has its two passes apart until
  // they're back on the road they came by.
  const runs = [];
  for (let s = 0; s <= track.length; s += 25) {
    let d = RETRACE_FROM.find((from) => together(s, from));
    if (d === undefined) continue;
    while (together(s, d + 25)) d += 25;
    const last = runs[runs.length - 1];
    if (last && s - d <= last.hi) runs[runs.length - 1] = { lo: Math.min(last.lo, s - d), hi: Math.max(last.hi, s + d) };
    else runs.push({ lo: s - d, hi: s + d });
  }
  const through = (point) => {
    const p = xy(point);
    return runs.find((run) => {
      for (let s = run.lo; s <= run.hi; s += 25) if (len(sub(track.point(s), p)) < ON_U_TURN) return true;
      return false;
    });
  };
  const inRun = through(entry), outRun = through(exit);
  const back = inRun ? lonLat(track.point(inRun.hi + TRIM_BACK)) : null;
  const short = outRun ? lonLat(track.point(outRun.lo - TRIM_BACK)) : null;
  return back || short ? { entry: back, exit: short } : null;
}

/// The fitted road with its stretch cut to a new entry or exit (in the
/// order it's driven), each on the stretch. Null: not on it, or what's left
/// is shorter than a stretch can be (PlanRoads.trimmed).
export function trimmed(found, entry, exit) {
  const driven = found.reversed ? [...found.line].reverse() : found.line;
  if (driven.length < 2) return null;
  const { xy } = flatAbout(driven[0]);
  const track = new Track(driven.map(xy));
  let from = 0, to = track.length;
  if (entry) {
    const at = track.nearest(xy(entry));
    if (!(at.meters < ON_U_TURN)) return null;
    from = at.along;
  }
  if (exit) {
    const at = track.nearest(xy(exit));
    if (!(at.meters < ON_U_TURN)) return null;
    to = at.along;
  }
  const whole = length(lineOf(found.road));
  if (to - from < Math.max(SHORTEST_STRETCH, Math.min(SHORTEST_SHARE * whole, ENOUGH_STRETCH))) return null;
  const cut = track.slice(driven, from, to);
  const share = (to - from) / Math.max(track.length, 1);
  // A cut end no longer reaches the catalog's end there.
  const [cutsFirst, cutsLast] = found.reversed ? [!!exit, !!entry] : [!!entry, !!exit];
  return {
    ...found, line: found.reversed ? cut.reverse() : cut,
    share: (Number.isFinite(found.share) ? found.share : 1) * share,
    roadSeconds: Number.isFinite(found.roadSeconds) ? found.roadSeconds * share : found.roadSeconds,
    startsAtEnd: found.startsAtEnd !== false && !cutsFirst, endsAtEnd: found.endsAtEnd !== false && !cutsLast,
  };
}

/// What to do once the plan with a just-added road is routed (HomePlan's
/// checkRouted): "keep" it; "retry" with `road`, its U-turning end cut back
/// (once, while `trying`); or "remove" it, saying `why`. `promised` is the
/// seconds it was said to add, `before` the routed trip's seconds before it
/// went in (none: no promise check), `now` the trip's now.
export function routedVerdict(found, { path, promised, before, now, trying, duration }) {
  const points = roadPoints(found);
  const ends = uTurnEnds(path, points[0].at, points[points.length - 1].at);
  const name = found.road.n;
  if (ends) {
    const cut = trying ? trimmed(found, ends.entry, ends.exit) : null;
    return cut ? { action: "retry", road: cut } : { action: "remove", why: `${name} needs a U-turn on this route, so it wasn't added.` };
  }
  if (Number.isFinite(before) && Number.isFinite(now) && now - before > PROMISE_SHARE * promised + PROMISE_SLACK) {
    return { action: "remove", why: `${name} would add ${duration(now - before)} here, not ${duration(promised)}, so it wasn't added.` };
  }
  return { action: "keep" };
}
