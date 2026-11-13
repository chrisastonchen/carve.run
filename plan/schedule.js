// A club drive's day as a schedule (club flow mock v11, Chris 11/13): the
// clock time at every stop, worked out from the leave time, each leg's
// drive time and each stop's timer; a leg over two hours said where it
// falls. Only on a drive's day (DevOps, 11/13: not on the public planner).
// Pure, for the tests (scripts/plan-tests/club-flow-words.test.mjs).

/// Past this the schedule says a stretch has no break (Chris, 11/13: two
/// hours, so 1 h 36 min against 90 doesn't read as a rounding error).
/// Suggest stops keeps spacing them at stops.js's BREAK_MINUTES (90).
export const BREAK_WARN_MINUTES = 120;

const RADIUS = 6371008.8;
function metres([lon1, lat1], [lon2, lat2]) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * RADIUS * Math.asin(Math.sqrt(a));
}

/// Each leg, start → each stop (not markers) → end: { seconds, meters }.
/// The route's time is shared out by distance along its road, as
/// route-wire.js's legDurationsSeconds does; a stop it can't place makes
/// an empty leg, so the legs stay lined up with the stops. Null without a road.
export function legsOf(plan) {
  const line = plan?.path?.geometry;
  const total = plan?.path?.durationSeconds;
  if (!Array.isArray(line) || line.length < 2 || !(total > 0)) return null;
  const along = [0];
  for (let i = 1; i < line.length; i++) along.push(along[i - 1] + metres(line[i - 1], line[i]));
  const length = along[along.length - 1];
  if (!(length > 0)) return null;
  const cuts = [0];
  let from = 0;
  for (const s of (plan.waypoints || []).filter((w) => w.type === "stop")) {
    let best = -1, bestD = Infinity;
    for (let i = from; i < line.length; i++) {
      const d = metres(line[i], [s.lon, s.lat]);
      if (d < bestD) { best = i; bestD = d; }
      if (bestD <= 150 && d > 400) break;
    }
    cuts.push(best < 0 ? cuts[cuts.length - 1] : along[best]);
    if (best >= 0) from = best;
  }
  cuts.push(length);
  const legs = [];
  for (let i = 1; i < cuts.length; i++) {
    const m = cuts[i] - cuts[i - 1];
    legs.push({ seconds: Math.round((m / length) * total), meters: Math.round(m) });
  }
  return legs;
}

/// The day's schedule from its leave time (minutes after midnight):
/// { leave, stops: [{ arrive, leave, stay }] (the stops in order), arrive,
/// legs, long: [leg index…] over BREAK_WARN_MINUTES }. Null without legs.
export function scheduleOf(plan, leaveMinutes) {
  const legs = legsOf(plan);
  if (!legs || !Number.isFinite(leaveMinutes)) return null;
  const stops = (plan.waypoints || []).filter((w) => w.type === "stop");
  let t = leaveMinutes;
  const out = [];
  stops.forEach((s, i) => {
    const arrive = t + legs[i].seconds / 60;
    const stay = Math.max(0, Number(s.stayMinutes) || 0);
    out.push({ arrive, leave: arrive + stay, stay });
    t = arrive + stay;
  });
  const arrive = t + legs[legs.length - 1].seconds / 60;
  const long = legs.map((l, i) => (l.seconds / 60 > BREAK_WARN_MINUTES ? i : -1)).filter((i) => i >= 0);
  return { leave: leaveMinutes, stops: out, arrive, legs, long };
}

/// A clock time as the mock writes it: "8:30", "12:25" (the day's own
/// times, no AM/PM); past midnight it carries on ("1:05").
export function clock(minutes) {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")}`;
}

/// "52 min", "1 h 34 min".
export function legTime(seconds) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/// A leg's line: "52 min · 31 mi".
export function legLine(leg, miles = true) {
  const d = miles ? `${Math.round(leg.meters / 1609.344)} mi` : `${Math.round(leg.meters / 1000)} km`;
  return `${legTime(leg.seconds)} · ${d}`;
}

/// The break line under a long leg: "1 h 34 min without a break."
export const breakLine = (leg) => `${legTime(leg.seconds)} without a break.`;
