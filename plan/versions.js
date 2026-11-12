// Pre-run route versions (the user, 11/8 late; Club only): version 1 is
// the route the crew drives on the pre-run; the first edit after it keeps
// version 1 frozen and makes version 2, which Send the route sends. This
// is the pure part: when a leg needs freezing, and "What changed since
// the pre-run" in plain lines. scripts/plan-tests/versions.test.mjs.

const R = 6_371_000;
const metres = (a, b) => {
  if (!a || !b) return Infinity;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/// Two places this close are the same place.
const SAME_METERS = 150;

const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
/// A day's pre-run date: the one set, else the week before.
export function prerunDateOf(drive, day) {
  const set = drive.prerun?.dates?.[day.id];
  if (set) return set;
  if (!day.date) return null;
  const t = new Date(`${day.date}T12:00:00`);
  t.setDate(t.getDate() - 7);
  return iso(t);
}
/// The last pre-run of the drive (Send the route warns before it).
export const lastPrerun = (drive) => drive.days.map((d) => prerunDateOf(drive, d)).filter(Boolean).sort().at(-1) || null;
export const todayIso = () => iso(new Date());

/// Is this the day after its pre-run, or later? (`today` and `prerunDate`
/// are "YYYY-MM-DD" in the drive's zone.)
export const afterPrerun = (prerunDate, today) => !!prerunDate && today > prerunDate;

/// The road of a plan: where it goes, not its name or note.
const roadKey = (p) => JSON.stringify([p?.start && [p.start.lat, p.start.lon], p?.end && [p.end.lat, p.end.lon],
  (p?.waypoints || []).map((w) => [w.lat, w.lon, w.type]), p?.trip, p?.style, p?.avoids || [], p?.path?.geometry?.length || 0]);

/// A changed leg after the pre-run: keep `before` as version 1, once.
/// → the leg to save (unchanged when there's nothing to freeze).
export function withVersions(leg, before, after, { prerunDate, today }) {
  if (leg.v1 || !before?.path || !afterPrerun(prerunDate, today)) return leg;
  if (roadKey(before) === roadKey(after)) return leg;
  return { ...leg, v1: before };
}

const placeName = (p, fallback) => (p?.label || p?.name || "").trim() || fallback;
const milesOf = (m) => Math.round(m / 1609.344);
const kmOf = (m) => Math.round(m / 1000);
const timeText = (s) => {
  const m = Math.round(Math.abs(s) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
};

/// "What changed since the pre-run", one line each, in the order a lead
/// reads it: the ends, the stops, the roads, then distance and time.
export function changesSince(v1, v2, { miles = true } = {}) {
  if (!v1 || !v2) return [];
  const out = [];
  if (metres(v1.start, v2.start) > SAME_METERS) out.push(`The start is now ${placeName(v2.start, "somewhere else")}.`);
  if (metres(v1.end, v2.end) > SAME_METERS) out.push(`The end is now ${placeName(v2.end, "somewhere else")}.`);
  const stops = (p) => (p.waypoints || []).filter((w) => w.type === "stop");
  const before = stops(v1), after = stops(v2);
  const matched = new Set();
  for (const s of after) {
    const same = before.find((b) => !matched.has(b) && (b.id === s.id || metres(b, s) <= SAME_METERS));
    if (!same) { out.push(`New stop: ${placeName(s, "a stop")}.`); continue; }
    matched.add(same);
    if (metres(same, s) > SAME_METERS) out.push(`${placeName(s, "A stop")} moved.`);
    else if ((same.stayMinutes || 0) !== (s.stayMinutes || 0)) out.push(`${placeName(s, "A stop")} is now ${s.stayMinutes ? `${s.stayMinutes} min` : "a quick stop"}.`);
  }
  for (const b of before) if (!matched.has(b)) out.push(`No longer stopping at ${placeName(b, "a stop")}.`);
  const roads = (p) => new Set((p.roads || []).filter((r) => (r.meters || 0) >= 1609).map((r) => r.name).filter(Boolean));
  const r1 = roads(v1), r2 = roads(v2);
  const now = [...r2].filter((n) => !r1.has(n)).slice(0, 3);
  const gone = [...r1].filter((n) => !r2.has(n)).slice(0, 3);
  if (now.length) out.push(`Now on ${now.join(", ")}.`);
  if (gone.length) out.push(`No longer on ${gone.join(", ")}.`);
  const d1 = v1.path?.distanceMeters, d2 = v2.path?.distanceMeters;
  if (Number.isFinite(d1) && Number.isFinite(d2)) {
    const diff = miles ? milesOf(d2) - milesOf(d1) : kmOf(d2) - kmOf(d1);
    const unit = miles ? "miles" : "km";
    if (Math.abs(diff) >= 1) out.push(`${Math.abs(diff)} ${unit} ${diff > 0 ? "longer" : "shorter"}, ${miles ? milesOf(d2) : kmOf(d2)} ${unit} in all.`);
  }
  const t1 = v1.path?.durationSeconds, t2 = v2.path?.durationSeconds;
  if (Number.isFinite(t1) && Number.isFinite(t2) && Math.abs(t2 - t1) >= 300) {
    out.push(`${timeText(t2 - t1)} ${t2 > t1 ? "more" : "less"} driving.`);
  }
  return out.length ? out : ["Only small changes since the pre-run."];
}

/// The whole drive's lines: each day's legs, labelled when there's more than one.
export function driveChanges(drive, { miles = true } = {}) {
  const lines = [];
  const many = drive.days.length > 1;
  drive.days.forEach((d, i) => {
    for (const leg of d.legs || []) {
      if (!leg.v1 || !leg.plan) continue;
      const head = many || (d.legs || []).length > 1 ? `${many ? `Day ${i + 1}` : ""}${leg.label ? `${many ? ", " : ""}${leg.label}` : ""}: ` : "";
      for (const line of changesSince(leg.v1, leg.plan, { miles })) lines.push(head + line);
    }
  });
  return lines;
}
