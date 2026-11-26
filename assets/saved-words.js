// carve.run/saved/'s words (Chris, 11/13): the routes this account made or
// saved, grouped, and the events it set reminders for. Pure, for the tests
// (scripts/plan-tests/saved-words.test.mjs).

/// The groups, in order, with their headings.
export const GROUPS = [
  { key: "club", title: "For your club" },
  { key: "mine", title: "Your routes" },
  { key: "carve", title: "From Carve" },
  { key: "links", title: "Saved from links" },
];

/// Which group a route is in. `route`: a routes row as /saved/ reads it
/// ({ id, opened: payload.shareToken, follows: payload.followsShareToken }).
/// `club`: the ids of the routes on this account's clubs' drives.
/// `catalog`: Carve's guides by share token (drives/tokens.json).
export function groupOf(route, club = new Set(), catalog = {}) {
  if (club.has(route.id)) return "club";
  if ([route.opened, route.follows].some((t) => t && catalog[t])) return "carve";
  if (route.follows) return "links";
  return "mine";
}

/// The routes in their groups, each group newest first as they came:
/// [{ key, title, routes }], empty groups left out.
export function savedGroups(routes = [], club = new Set(), catalog = {}) {
  const by = new Map(GROUPS.map((g) => [g.key, []]));
  for (const r of routes) by.get(groupOf(r, club, catalog)).push(r);
  return GROUPS.map((g) => ({ ...g, routes: by.get(g.key) })).filter((g) => g.routes.length);
}

/// A route's line: "98 mi · 2 h 03 min · 2 stops".
export function routeLine(route, miles = true) {
  const m = Number(route?.distance_meters) || 0;
  const s = Number(route?.duration_seconds) || 0;
  const stops = Number(route?.stop_count) || 0;
  const min = Math.round(s / 60);
  return [
    m ? (miles ? `${Math.round(m / 1609.344)} mi` : `${Math.round(m / 1000)} km`) : "",
    s ? (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`) : "",
    stops ? `${stops} ${stops === 1 ? "stop" : "stops"}` : "",
  ].filter(Boolean).join(" · ");
}

// ── the map (Chris, 11/25: Saved laid out as Explore) ──

/// Where a route's picture comes from, as My Drives shows it: its photo
/// (on Carve's own hosts), else its link's map (the Worker draws it), else
/// none (Explore's sketch stands in).
const PHOTO_HOSTS = ["carve.run", "uvaabajzkzupecemzsug.supabase.co"];
export function pictureOf(route) {
  try {
    const url = new URL(route?.photo?.url);
    if (url.protocol === "https:" && PHOTO_HOSTS.includes(url.hostname)) return url.href;
  } catch {}
  return route?.opened ? `/map/${encodeURIComponent(route.opened)}.png` : null;
}

/// A route's box as [west, south, east, north], from its row's bounds.
export function boxOf(route) {
  const raw = [route?.min_lon, route?.min_lat, route?.max_lon, route?.max_lat];
  if (raw.some((v) => v == null || v === "")) return null;
  const b = raw.map(Number);
  return b.every(Number.isFinite) ? b : null;
}

/// A stored line ({latitude, longitude} points) as at most `most` [lon, lat]
/// points, every nth kept and the last one always.
export function thinLine(points, most = 300) {
  const pts = (Array.isArray(points) ? points : []).filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude));
  const step = Math.max(1, Math.ceil(pts.length / most));
  const out = pts.filter((_, i) => i % step === 0).map((p) => [p.longitude, p.latitude]);
  const last = pts.at(-1);
  if (last && step > 1) out.push([last.longitude, last.latitude]);
  return out;
}

/// The routes whose names have every word typed.
export function matching(routes, query) {
  const words = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? routes.filter((r) => words.every((w) => String(r.name || "").toLowerCase().includes(w))) : routes;
}
