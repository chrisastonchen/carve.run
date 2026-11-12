// Smart planning's words (Chris, 11/10; board O5 v37): the three Suggest
// actions under the planner's fields, and what a suggestion's pin and card
// say. Pure, for node: scripts/plan-tests/suggest-words.test.mjs.

import { atText, breakCheck, minutesText, offRouteText, suggestFor } from "./stops.js?v=2";
import { clockText, spotWords } from "./meet-words.js";

/// The three actions: the link under the field, and what a pick does.
export const SUGGEST = {
  start: { link: "✦ Suggest a meeting place", pick: "Use as start", looking: "Looking for meeting places…" },
  along: { link: "✦ Suggest stops along the route", pick: "Add as a stop", looking: "Looking along the route…" },
  end: { link: "✦ Suggest near the end", pick: "Use as destination", looking: "Looking near the destination…" },
};

/// What the action needs first, said beside it; null when it can run.
export function needsFirst(which, plan) {
  if (which === "along" && !plan?.path) return plan?.start && !plan?.end && !loops(plan) ? "Choose a destination first." : "Choose a start and a destination first.";
  if (which === "end" && !plan?.end) return "Choose a destination first.";
  return null;
}

const loops = (plan) => plan?.trip === "roundTrip" || plan?.trip === "outAndBack";

/// Without Apex: what tapping an action says (no label beside it; Chris,
/// 11/11: "Very ugly").
export const SOLO = { note: "Suggestions are on Solo.", see: "See Solo", signIn: "Sign in" };

/// A pin's short label, by kind.
const PIN = { gas: "Gas", coffee: "Coffee", food: "Food", rest_area: "Rest", viewpoint: "View", attraction: "Sight", park: "Park", parking: "Parking" };
/// The card's kind line.
const KIND = { gas: "Gas", coffee: "Coffee", food: "Food", rest_area: "Rest area", viewpoint: "Viewpoint", attraction: "Worth a look", park: "Park", parking: "Parking" };

export const pinLabel = (kind) => PIN[kind] || "Stop";
export const kindText = (kind) => KIND[kind] || "Stop";

/// Metres between two points.
export function metresBetween(a, b) {
  const r = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/// "0.3 mi from the start", "1.2 km from the destination"; "At the start" when close.
export function fromText(metres, which, miles = true) {
  const where = which === "end" ? "the destination" : "the start";
  if (!Number.isFinite(metres) || metres < 60) return `At ${where}`;
  const n = miles ? metres / 1609.344 : metres / 1000;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${miles ? "mi" : "km"} from ${where}`;
}

/// Google Maps at the place (its coordinates: a name alone can find another).
export const mapsUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)}%2C${p.lon.toFixed(6)}`;

/// `meet`'s spots as suggestions: [{ place, pin, kind, title, where, facts }].
/// `from` is the field's place; `meet` the meet time ("08:00") or null.
export function meetSuggestions(spots, from, which, { miles = true, meet = null } = {}) {
  return (spots || []).map((s) => {
    const w = spotWords(s, meet);
    return {
      place: { name: s.name, lat: s.lat, lon: s.lon, address: s.address || "", town: s.town || "" },
      icon: "parking",
      pin: pinLabel("parking"),
      kind: kindText("parking"),
      title: w.title,
      where: [from ? fromText(metresBetween(from, s), which, miles) : "", w.address].filter(Boolean).join(" · "),
      facts: w.facts,
    };
  });
}

/// The most along-the-route pins at once, all told; and the most picked to
/// spread along the route before each picked gas station's neighbours join.
export const MOST_ALONG = 24;
export const MOST_SPREAD = 16;
/// Gas stations this close along the route are one cluster (King City's
/// several by the exit, Chris 11/10): all shown once one is picked.
export const GAS_CLUSTER_KM = 1.5;
/// Farther than this between gas stations: the one before says so.
export const GAS_GAP_KM = 60;

/// A sight's own kind for its icon: a park, a view, else a sight.
export function kindOf(c) {
  if (c.kind !== "attraction" && c.kind !== "viewpoint") return c.kind;
  if (/\b(park|preserve|reserve|forest|beach|lake|gardens?|arboretum)\b/i.test(c.name || "")) return "park";
  if (c.kind === "viewpoint" || /\b(vista|overlook|lookout|viewpoint|view)\b/i.test(c.name || "")) return "viewpoint";
  return "attraction";
}

/// `along`'s answer as suggestions, in route order (Chris, 11/10: gas
/// matters most on a long rural drive):
/// 1. the last gas before a gap over GAS_GAP_KM, saying how far;
/// 2. at each break a stretch over 90 minutes needs (his M1): its best gas,
///    its best coffee or food, and a rest area;
/// 3. every rest area (one where several sit together: Camp Roberts has
///    four names);
/// 4. a few sights, spread out;
/// 5. along the rest of the route, in four parts, a gas and a coffee or
///    food in each, while there's room (MOST_SPREAD);
/// 6. then every other gas station in a picked one's cluster, up to
///    MOST_ALONG in all.
/// Closed ones out; a place once (by id, or the same name within 1.5 km;
/// a cluster's stations by id).
/// → { items, said }
export function alongSuggestions(answer, { miles = true, zone = null, timed = false } = {}) {
  const total = answer?.km || 0;
  const open = (answer?.candidates || []).filter((c) => c.name && c.open !== false);
  const picked = [];
  const notes = new Map();
  const same = (a, b) => a.id === b.id || (a.name.toLowerCase() === b.name.toLowerCase() && Math.abs((a.km ?? 0) - (b.km ?? 0)) < 1.5)
    || (a.kind === "rest_area" && b.kind === "rest_area" && Math.abs((a.km ?? 0) - (b.km ?? 0)) < 3);
  const take = (c, note) => {
    if (!c || picked.length >= MOST_SPREAD || picked.some((p) => same(p, c))) return;
    picked.push(c);
    if (note) notes.set(c, note);
  };
  const byKm = (a, b) => (a.km ?? 0) - (b.km ?? 0);
  const gas = open.filter((c) => c.kind === "gas").sort(byKm);
  const eat = open.filter((c) => c.kind === "coffee" || c.kind === "food");
  const rests = open.filter((c) => c.kind === "rest_area").sort(byKm);
  const best = (pool, w) => suggestFor(w, pool, 1)[0];
  // 1. The last gas for a while.
  gas.forEach((g, i) => {
    const gap = (gas[i + 1]?.km ?? total) - g.km;
    if (gap > GAS_GAP_KM) take(g, `Last gas for ${distanceText(gap, miles)}`);
  });
  // 2. What each break needs.
  const check = breakCheck(answer);
  for (const s of check.long) for (const b of s.breaks) {
    take(best(gas, b));
    take(best(eat, b));
    take(best(rests, b));
  }
  // 3. Rest areas.
  rests.forEach((r) => take(r));
  // 4. Sights.
  check.sights.slice(0, 4).forEach((c) => take(c));
  // 5. The rest of the route, a part at a time (not the first and last 5%).
  const edge = total * 0.05;
  for (let i = 0; i < 4 && total; i++) {
    const from = edge + ((total - 2 * edge) * i) / 4;
    const w = { fromKm: from, toKm: from + (total - 2 * edge) / 4 };
    take(best(gas, w));
    take(best(eat, w));
  }
  // 6. A picked gas station's neighbours: the whole cluster on the map.
  const near = picked.filter((p) => p.kind === "gas")
    .flatMap((p) => gas.filter((g) => g !== p && Math.abs((g.km ?? 0) - (p.km ?? 0)) <= GAS_CLUSTER_KM).map((g) => [g, Math.abs((g.km ?? 0) - (p.km ?? 0))]))
    .sort((a, b) => a[1] - b[1]);
  for (const [g] of near) if (picked.length < MOST_ALONG && !picked.some((p) => p.id === g.id)) picked.push(g);
  picked.sort(byKm);
  const items = picked.map((c) => {
    const kind = kindOf(c);
    return {
      place: { name: c.name, lat: c.lat, lon: c.lon, address: c.address || "" },
      icon: kind,
      pin: pinLabel(kind),
      kind: kindText(kind),
      title: c.name,
      where: `${offRouteText(c.offMeters, miles)} · ${distanceText(c.km, miles)} in`,
      facts: [notes.get(c), c.eta ? openText(c, zone) : ""].filter(Boolean),
    };
  });
  const long = check.long;
  const lead = !check.stretches.length ? ""
    : long.length === 1 ? `${minutesText(long[0].minutes)} with no stop, ${atText(long[0].fromKm, miles)} to ${atText(long[0].toKm, miles)}.`
    : long.length ? `${long.length} stretches over 1 h 30 without a stop.`
    : "No stretch over 1 h 30 without a stop.";
  const said = items.length
    ? [lead, `${items.length === 1 ? "1 place" : `${items.length} places`} on the map.`, timed ? "" : "Set when you'll leave to see what's open."].filter(Boolean).join(" ")
    : "Nothing found along this route.";
  return { items, said };
}

/// "37 mi", "60 km".
export const distanceText = (km, miles = true) => (miles ? `${Math.round(km / 1.609344)} mi` : `${Math.round(km)} km`);

function openText(c, zone) {
  const at = new Date(c.eta).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) });
  return c.open === true ? `Open when you get there, ${at}` : `You get there about ${at}`;
}

/// What a meet search says once it's back.
export function meetSaid(count, which) {
  const near = which === "end" ? "the destination" : "the start";
  return count ? `${count === 1 ? "1 place" : `${count} places`} near ${near} on the map.` : `No car parks found near ${near}. Search for a place instead.`;
}

/// The day and meet time `meet` takes: the drive day's, else the leave time's.
export function meetDay({ date, meet } = {}, leaveAt = null, zone = null) {
  if (date && meet) return { date, meet: meet.slice(0, 5) };
  if (!Number.isFinite(leaveAt)) return null;
  const d = new Date(leaveAt);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(zone ? { timeZone: zone } : {}) }).formatToParts(d).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, meet: `${parts.hour}:${parts.minute}` };
}

export { clockText };
