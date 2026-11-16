// Where a new stop or waypoint goes in a route (plan.js): the gap between
// two of its points it lengthens least. A tie goes to the later gap, as the
// apps do (DevOps, 11/16): on an out-and-back or round trip a place on the
// way is as close to the leg out as the leg back, and a new stop shouldn't
// jump ahead of one already added.

/// Metres between two {lat, lon} points (haversine).
export function meters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/// The index in `waypoints` for `p`, given the route's ends: `start`, and
/// `end` (the start again on a round trip or out-and-back). With no start
/// or no end yet, places go on in the order they're picked.
export function bestSlot({ start, waypoints, end }, p) {
  if (!start || !end) return waypoints.length;
  const chain = [start, ...waypoints, end];
  let best = waypoints.length;
  let cost = Infinity;
  for (let i = 0; i < chain.length - 1; i++) {
    const added = meters(chain[i], p) + meters(p, chain[i + 1]) - meters(chain[i], chain[i + 1]);
    if (added <= cost) {
      cost = added;
      best = i;
    }
  }
  return best;
}
