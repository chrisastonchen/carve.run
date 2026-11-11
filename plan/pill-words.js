// The planner's place pills (Chris, 11/11): a row of kinds of place over
// the map, one on at a time, its places as pins with a card and + Stop.
// Free for everyone: the planner's `nearby`, along the route when there's
// one, else in the map's view. Pure, for node:
// scripts/plan-tests/pill-words.test.mjs.

/// The pills, in order: the planner's kinds, and what each says.
export const PILLS = [
  { kind: "gas", label: "Gas" },
  { kind: "coffee", label: "Coffee" },
  { kind: "food", label: "Food" },
  { kind: "rest_area", label: "Rest areas" },
  { kind: "viewpoint", label: "Viewpoints" },
  { kind: "attraction", label: "Landmarks" },
];
export const labelOf = (kind) => PILLS.find((p) => p.kind === kind)?.label || "Places";

/// The card's kind line.
const KIND = { gas: "Gas", coffee: "Coffee", food: "Food", rest_area: "Rest area", viewpoint: "Viewpoint", attraction: "Landmark" };
export const kindText = (kind) => KIND[kind] || "Place";

/// At most one map-view search this often (a pan never searches by itself).
export const VIEW_EVERY_MS = 10_000;
/// The widest view searched, in degrees each way (the planner's own limit).
export const MOST_VIEW_DEGREES = 3;

export const WORDS = {
  searchArea: "Search this area",
  looking: "Looking…",
  zoomIn: "Zoom in to see places.",
  failed: "Couldn't look. Try again.",
  add: "+ Stop",
};

/// What a pill found, said when it's nothing: "No gas along the route."
export function noneText(kind, alongRoute) {
  const what = { gas: "gas", coffee: "coffee", food: "food", rest_area: "rest areas", viewpoint: "viewpoints", attraction: "landmarks" }[kind] || "places";
  return `No ${what} ${alongRoute ? "along the route" : "in this area"}.`;
}

/// The map's view for `nearby`, or null when it's too wide to ask about.
export function viewBox(bounds) {
  const west = Math.max(-180, bounds.west), east = Math.min(180, bounds.east);
  const south = Math.max(-90, bounds.south), north = Math.min(90, bounds.north);
  if (!(west < east && south < north)) return null;
  if (east - west > MOST_VIEW_DEGREES || north - south > MOST_VIEW_DEGREES) return null;
  const r = (v) => Math.round(v * 1e5) / 1e5;
  return { west: r(west), south: r(south), east: r(east), north: r(north) };
}

/// How long until a map-view search may go (0: now).
export const waitFor = (lastAt, now = Date.now()) => (lastAt == null ? 0 : Math.max(0, lastAt + VIEW_EVERY_MS - now));

/// What a route answer is for: its line and time. Another key, another ask.
export const pathKey = (path) => (path?.geometry?.length ? JSON.stringify([path.geometry.length, path.distanceMeters, path.durationSeconds, path.geometry[0], path.geometry[path.geometry.length - 1]]) : null);

const distanceText = (km, miles) => {
  const n = miles ? km / 1.609344 : km;
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${miles ? "mi" : "km"}`;
};
const offText = (metres, miles) => {
  if (!Number.isFinite(metres) || metres < 150) return "On the route";
  return `${distanceText(metres / 1000, miles)} off the route`;
};

/// `nearby`'s places as pins and cards: [{ place, kind, title, where }].
export function pillItems(answer, { miles = true } = {}) {
  return (answer?.places || []).filter((p) => p?.name && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => ({
    place: { name: p.name, lat: p.lat, lon: p.lon, address: p.address || "" },
    icon: p.kind,
    kind: kindText(p.kind),
    title: p.name,
    where: Number.isFinite(p.km) ? `${offText(p.offMeters, miles)} · ${distanceText(p.km, miles)} in` : p.address || "",
  }));
}
