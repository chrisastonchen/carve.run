// The pre-drive report's words (O6b; 0101, App Dev's shapes 11/12): the
// crew's reviews by day, and planned against actual times for each leg
// and stop. Durations only, never clock times. Each review leads with its
// reviewer's name and the day it was driven (0105, DevOps 11/13): the
// server's display name or first name, never an email. Pure, for the
// tests (scripts/plan-tests/club-report-words.test.mjs).

/// The review vocabulary, worded as the apps word it (RouteReview.swift).
export const REASONS = {
  great_curves: "Great curves",
  great_views: "Great views",
  smooth_pavement: "Smooth pavement",
  good_stops: "Good stops",
  right_length: "Right length",
  rough_pavement: "Rough pavement",
  boring_stretches: "Boring stretches",
  confusing_turns: "Confusing turns",
  light_traffic: "Light traffic",
  lots_of_cyclists: "Lots of cyclists",
  heavy_traffic: "Heavy traffic",
  slow_drivers: "Slow drivers ahead",
  police_activity: "Police activity",
  great_weather: "Great weather",
  too_narrow: "Too narrow",
  unmarked: "Unmarked lanes",
};
export const RATINGS = { love: "Loved it", like: "Liked it", dislike: "Didn't like it" };

const reason = (code) => REASONS[code] || String(code || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/// One day's reviews, as shown: the rating, the roads with their verdict
/// and reasons, the whole drive's reasons, the note. Oldest first.
export function dayReviews(reviews = [], day) {
  return reviews
    .filter((r) => r.day === day)
    .map((r) => ({
      rating: RATINGS[r.rating] || "",
      tone: r.rating === "dislike" ? "bad" : r.rating === "love" ? "great" : "good",
      roads: (Array.isArray(r.roads) ? r.roads : [])
        .filter((road) => road && road.name)
        .map((road) => ({ name: road.name, good: road.verdict !== "bad", reasons: (road.reasons || []).map(reason) })),
      reasons: [...new Set([...(r.road_reasons || []), ...(r.day_reasons || [])])].map(reason),
      note: String(r.note || "").trim(),
      // 0103: a review of a route since swapped out of the day.
      earlier: r.earlier_route ? earlierTag(r.route_name) : "",
      by: byLine(r.reviewer_name, r.driven_on),
    }));
}

/// "Pia · Sat, Nov 14": who reviewed it and the day they drove it.
export function byLine(name, drivenOn) {
  const who = String(name || "").trim() || "A crew member";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(drivenOn || "");
  if (!m) return who;
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${who} · ${day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}`;
}

/// "On the earlier route: Skyline Loop", or without a name.
export function earlierTag(name) {
  return name ? `On the earlier route: ${name}` : "On the earlier route";
}

/// Minutes as "48 min" or "1 h 05 min"; "–" without a number.
export function minutesText(m) {
  if (!Number.isFinite(m)) return "–";
  const r = Math.round(Math.abs(m));
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")} min`;
}

/// Actual against planned: "6 min faster" (early), "12 min slower" (late),
/// "On plan". Tone: early, late or even; null without both numbers.
export function diffOf(planned, actual) {
  if (!Number.isFinite(planned) || !Number.isFinite(actual)) return null;
  const d = Math.round(actual - planned);
  if (d === 0) return { text: "On plan", tone: "even" };
  return d < 0 ? { text: `${minutesText(d)} faster`, tone: "early" } : { text: `${minutesText(d)} slower`, tone: "late" };
}

/// One day's times (drive_prerun_timings) as the table's rows and total.
/// A leg reads "Start → Coffee"; a stop "At Coffee". A stop every driver
/// passed says so and has no time. drivers: how many drove it (medians
/// of that many). timed: whether anything on the day has a time.
export function dayTimes(timings, dayId) {
  const rows = rowsOf((timings?.rows || []).filter((r) => r.day_id === dayId));
  const day = (timings?.days || []).find((d) => d.day_id === dayId) || null;
  return withTotal(rows, day);
}

/// A day's times on routes swapped out of it (0103's `earlier`), each
/// labelled, read-only: [{ tag, rows, total, timed }], timed ones only.
export function earlierTimes(timings, dayId) {
  return (timings?.earlier || [])
    .filter((e) => e.day_id === dayId)
    .map((e) => ({ tag: earlierTag(e.route_name), ...withTotal(rowsOf(e.rows || []), e) }))
    .filter((e) => e.timed);
}

function rowsOf(list) {
  return list.map((r) => {
    const stop = r.kind === "stop";
    const passedAll = stop && !Number.isFinite(r.actual_minutes) && (r.passed || 0) > 0;
    return {
      kind: stop ? "stop" : "leg",
      what: stop ? `At ${r.label || r.to || "a stop"}` : `${r.from || "Start"} → ${r.to || "End"}`,
      planned: minutesText(r.planned_minutes),
      actual: passedAll ? "Passed" : minutesText(r.actual_minutes),
      diff: passedAll ? null : diffOf(r.planned_minutes, r.actual_minutes),
      drivers: Number.isInteger(r.drivers) ? r.drivers : 0,
    };
  });
}

function withTotal(rows, day) {
  const timed = rows.some((r) => r.drivers > 0 && r.actual !== "–" && r.actual !== "Passed");
  const total = day && timed ? {
    planned: minutesText(day.planned_minutes),
    actual: minutesText(day.actual_minutes) + (day.total_partial ? "+" : ""),
    diff: day.total_partial ? null : diffOf(day.planned_minutes, day.actual_minutes),
    partial: !!day.total_partial,
  } : null;
  return { rows, total, timed };
}

/// What Update stop timers would change on a day, as the server does it
/// (0059 drive_stop_timers_update): each timed stop's stay to the nearest
/// 5 minutes, none under 3, 12 hours at most; passed stops left alone.
/// planned: the stop's stay now. → [{ what, from, to }], the ones that change.
export function stayTo(minutes) {
  if (!Number.isFinite(minutes)) return null;
  return minutes < 3 ? 0 : Math.min(720, Math.round(minutes / 5) * 5);
}
export function timerChanges(timings, dayId) {
  return (timings?.rows || [])
    .filter((r) => r.day_id === dayId && r.kind === "stop" && Number.isFinite(r.actual_minutes))
    .map((r) => ({ what: r.label || r.to || "Stop", from: Math.round(r.planned_minutes || 0), to: stayTo(r.actual_minutes) }))
    .filter((c) => c.to !== c.from);
}

/// The server's answer (updated: [{label, from_minutes, to_minutes}]) as a line.
export function timersSaid(updated = []) {
  if (!updated.length) return "The stop timers already match the pre-drive.";
  const one = (u) => `${u.label || "a stop"} ${u.to_minutes ? `to ${minutesText(u.to_minutes)}` : "to no timer"}`;
  return `Updated ${updated.length === 1 ? "1 stop" : `${updated.length} stops`}: ${updated.map(one).join(", ")}.`;
}

/// The day switch's buttons: "Day 1 · Sat, Nov 21", and whether there's
/// anything to read on it.
export function dayTabs(days = [], withReport = []) {
  return days.map((d, i) => ({ n: i + 1, id: d.id, label: `Day ${i + 1}${d.date ? ` · ${shortDate(d.date)}` : ""}`, ready: withReport.includes(i + 1) }));
}
function shortDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
