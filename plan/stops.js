// The break check and stop suggestions (club sprint item 8, v1): from the
// planner's `along` answer, the stretches over 90 minutes with no stop,
// and for each the places that would break it, best first. Pure, for
// node: scripts/plan-tests/stops.test.mjs.

/// Longer than this without a stop is flagged (DevOps, 11/8).
export const BREAK_MINUTES = 90;
/// Suggestions for each long stretch.
export const PER_STRETCH = 3;

/// How much each kind suits a break: coffee and a rest area or gas (restrooms
/// likely) first, then food, then something to see.
const SUITS = { coffee: 3, rest_area: 2.8, gas: 2.5, food: 2, attraction: 1.5, viewpoint: 1.5 };

/// The stretches between start, stops and end, with their driving minutes
/// (time by distance, as the server times arrivals). → [{fromKm, toKm, minutes, long}]
export function stretches(answer) {
  const total = answer?.km || 0;
  const minutes = answer?.minutes || 0;
  if (!total || !minutes) return [];
  const marks = [0, ...(answer.stops || []).map((s) => s.km).filter((k) => k > 0 && k < total), total].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < marks.length; i++) {
    const m = Math.round(((marks[i] - marks[i - 1]) / total) * minutes);
    if (marks[i] - marks[i - 1] <= 0) continue;
    out.push({ fromKm: marks[i - 1], toKm: marks[i], minutes: m, long: m > BREAK_MINUTES });
  }
  return out;
}

/// The breaks a long stretch needs, spaced evenly so no part is over 90
/// minutes, each with a window to find a place in: [{atKm, fromKm, toKm}].
/// A window is the slack that keeps both sides at 90 minutes, and never
/// narrower than 12 minutes each way (so there's somewhere to look).
export function breaks(stretch) {
  const n = Math.max(1, Math.ceil(stretch.minutes / BREAK_MINUTES) - 1);
  const perMin = (stretch.toKm - stretch.fromKm) / Math.max(1, stretch.minutes);
  const part = stretch.minutes / (n + 1);
  const slack = Math.max(12, BREAK_MINUTES - part);
  return Array.from({ length: n }, (_, i) => {
    const at = part * (i + 1);
    return {
      atKm: stretch.fromKm + at * perMin,
      fromKm: Math.max(stretch.fromKm, stretch.fromKm + (at - slack) * perMin),
      toKm: Math.min(stretch.toKm, stretch.fromKm + (at + slack) * perMin),
    };
  });
}

/// The best places for one break: in its window, not closed when the
/// drive gets there, best suited, then nearest the window's middle.
export function suggestFor(w, candidates, most = PER_STRETCH) {
  const middle = w.atKm ?? (w.fromKm + w.toKm) / 2;
  const span = Math.max(1, w.toKm - w.fromKm);
  const score = (c) => (SUITS[c.kind] ?? 1) + (c.open === true ? 1 : 0) - Math.abs(c.km - middle) / span - Math.min(1, (c.offMeters || 0) / 2000);
  // One of each name: two Starbucks a mile apart are one choice.
  const names = new Set();
  return candidates
    .filter((c) => c.km >= w.fromKm && c.km <= w.toKm && c.open !== false)
    .sort((a, b) => score(b) - score(a))
    .filter((c) => !names.has(c.name) && names.add(c.name))
    .slice(0, most);
}

/// Sights along the way: viewpoints and attractions away from the route's
/// ends (a town's statues aren't a drive's sights), spread along it: the
/// best in each of `most` equal parts, viewpoints first.
export function sightsAlong(answer, most = 6) {
  const total = answer?.km || 0;
  if (!total) return [];
  const edge = Math.min(15, total * 0.1);
  const pool = (answer.candidates || []).filter((c) => (c.kind === "viewpoint" || c.kind === "attraction") && c.open !== false && c.km > edge && c.km < total - edge);
  const part = (total - 2 * edge) / most;
  const out = [];
  for (let i = 0; i < most; i++) {
    const inPart = pool.filter((c) => c.km >= edge + i * part && c.km < edge + (i + 1) * part);
    // National and state parks and their like first (Pinnacles over a
    // roadside vista, Chris's Cambria drive, 11/10), then views, then the nearest.
    inPart.sort((a, b) => rank(a) - rank(b) || (a.offMeters || 0) - (b.offMeters || 0));
    if (inPart[0]) out.push(inPart[0]);
  }
  return out;
}

/// A sight's standing: 0 a national or state park, monument, seashore or
/// lighthouse; 1 a view; 2 the rest.
const MAJOR = /\b(national (park|monument|seashore|forest|recreation area)|state (park|beach|historic park|reserve)|lighthouse)\b/i;
const rank = (c) => (MAJOR.test(c.name || "") ? 0 : c.kind === "viewpoint" || /\b(vista|overlook|lookout|viewpoint)\b/i.test(c.name || "") ? 1 : 2);

/// The whole check: each long stretch with its breaks and their
/// suggestions, and the sights along the way.
export function breakCheck(answer, sights = 6) {
  const all = stretches(answer);
  const candidates = answer?.candidates || [];
  return {
    long: all.filter((s) => s.long).map((s) => ({ ...s, breaks: breaks(s).map((b) => ({ ...b, suggestions: suggestFor(b, candidates) })) })),
    stretches: all,
    sights: sightsAlong(answer, sights),
  };
}

// ── words ────────────────────────────────────────────────────────────────

const KIND_WORDS = { gas: "Gas", coffee: "Coffee", food: "Food", rest_area: "Rest area", viewpoint: "Viewpoint", attraction: "Worth a look" };

/// "1 h 55" or "45 min".
export const minutesText = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`);

/// A break's heading when a stretch needs more than one: "Around mile 48".
export const breakText = (b, miles) => `Around ${atText(b.atKm, miles)}`;

/// "mile 48" or "km 77".
export const atText = (km, miles) => (miles ? `mile ${Math.round(km / 1.609344)}` : `km ${Math.round(km)}`);

/// A long stretch's warning: "1 h 55 with no stop, mile 14 to mile 105."
export const stretchText = (s, miles) => `${minutesText(s.minutes)} with no stop, ${atText(s.fromKm, miles)} to ${atText(s.toKm, miles)}.`;

/// A place's line: { title, detail }, detail like "Gas · mile 48 · open at 9:12 AM".
export function placeWords(c, miles, zone) {
  const parts = [KIND_WORDS[c.kind] || "Stop", atText(c.km, miles)];
  if (c.eta) {
    const at = new Date(c.eta).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) });
    parts.push(c.open === true ? `open at ${at}` : c.open === false ? `closed at ${at}` : `there about ${at}`);
  }
  return { title: c.name, detail: parts.join(" · "), address: c.address || "" };
}

// ── the group planner's "Along the way" card (the approved mock, 11/9) ──
// Rest stops (rest areas, gas, coffee, food: each says which, with no
// restroom claimed), Landmarks (attractions) and Vista points
// (viewpoints), each in route order, closed ones left out, a name once.
export const ALONG_TABS = [
  { key: "rest", label: "Rest stops", kinds: ["rest_area", "gas", "coffee", "food"] },
  { key: "landmarks", label: "Landmarks", kinds: ["attraction"] },
  { key: "vistas", label: "Vista points", kinds: ["viewpoint"] },
];

/// "On route", or "0.3 mi off route" / "0.5 km off route".
export function offRouteText(meters, miles) {
  if (!Number.isFinite(meters) || meters < 150) return "On route";
  const n = miles ? meters / 1609.344 : meters / 1000;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${miles ? "mi" : "km"} off route`;
}

/// The card's three lists from the planner's `along`: { rest, landmarks,
/// vistas }, each [{ place, title, sub }], at most `most` a list.
export function alongCard(answer, { miles = true, most = 8 } = {}) {
  const out = {};
  for (const tab of ALONG_TABS) {
    const seen = new Set();
    out[tab.key] = (answer?.candidates || [])
      .filter((c) => tab.kinds.includes(c.kind) && c.open !== false)
      .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
      .filter((c) => { const k = (c.name || "").toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, most)
      .map((c) => ({
        place: c,
        title: c.name,
        sub: [tab.key === "rest" ? KIND_WORDS[c.kind] : "", offRouteText(c.offMeters, miles)].filter(Boolean).join(" · "),
      }));
  }
  return out;
}
