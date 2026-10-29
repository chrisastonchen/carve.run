// The route as the apps store it, made in the browser: the `routes` row
// and its payload (the app's Codable `Route`, field for field), the share
// token, and the files and links a planner brings in. No DOM and no
// network here, so scripts/plan-tests can run it under node.
//
// The payload has to read in every live build. Builds up to 1.3.2 stop on
// a route with more than 30 waypoints, so `waypoints` keeps at most 30
// (every stop, markers spread between) and the full list rides beside it
// as `allWaypoints`, which those builds skip (docs/Share-Links.md, "More
// than 30 waypoints"; iOS RouteWire, Android WireRoute).

/// Route.maxIntermediateWaypoints.
export const MAX_WAYPOINTS = 100;
/// Route.olderBuildsWaypointLimit.
export const OLDER_BUILDS_WAYPOINT_LIMIT = 30;
/// Route.maxStops.
export const MAX_STOPS = 10;
/// Route.mostNameCharacters, Waypoint.mostLabelCharacters.
export const MOST_NAME_CHARACTERS = 120;
export const MOST_LABEL_CHARACTERS = 80;

/// RouteShareCodec.tokenAlphabet: no 0/O or 1/l/I, so a link read aloud or
/// typed from paper survives.
export const TOKEN_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const TOKEN_LENGTH = 10;

/// Seconds between 1970 and 2001: Swift's JSONEncoder writes a Date as
/// seconds since 2001-01-01, and the apps read nothing else.
const APPLE_EPOCH_OFFSET = 978307200;

export function appleDate(ms = Date.now()) {
  return ms / 1000 - APPLE_EPOCH_OFFSET;
}

/// A share token as the apps mint one: ten characters, uniform over the
/// alphabet (bytes past the last whole multiple are drawn again).
export function newShareToken(randomBytes) {
  const n = TOKEN_ALPHABET.length;
  const ceiling = 256 - (256 % n);
  let token = "";
  while (token.length < TOKEN_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < ceiling && token.length < TOKEN_LENGTH) token += TOKEN_ALPHABET[byte % n];
    }
  }
  return token;
}

/// An uppercase UUID, as Swift's UUID encodes.
export function newUUID(randomUUID) {
  return randomUUID().toUpperCase();
}

export function clip(text, most) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed ? Array.from(trimmed).slice(0, most).join("") : null;
}

/// Route.thinned: every stop kept (up to the limit), markers picked evenly
/// for the slots left, order renumbered from 0.
export function thinned(waypoints, limit) {
  if (waypoints.length <= limit) return waypoints;
  const stops = waypoints.map((w, i) => (w.type === "stop" ? i : -1)).filter((i) => i >= 0).slice(0, limit);
  const markers = waypoints.map((w, i) => (w.type !== "stop" ? i : -1)).filter((i) => i >= 0);
  const slots = limit - stops.length;
  const picked = [];
  for (let k = 0; k < slots; k++) picked.push(markers[Math.floor(((k + 0.5) * markers.length) / slots)]);
  const kept = new Set([...stops, ...picked]);
  return waypoints.filter((_, i) => kept.has(i)).map((w, order) => ({ ...w, order }));
}

const coordinate = (p) => ({ latitude: p.lat, longitude: p.lon });

/// The waypoint as Waypoint encodes: no nil keys.
function wireWaypoint(w, order) {
  const out = { id: w.id, order, location: coordinate(w), type: w.type === "stop" ? "stop" : "marker" };
  const label = clip(w.label, MOST_LABEL_CHARACTERS);
  if (label) out.label = label;
  if (w.type === "stop" && Number.isInteger(w.stayMinutes) && w.stayMinutes > 0) out.stayMinutes = w.stayMinutes;
  return out;
}

/// The road style as Route stores it: Balanced is its own key so builds
/// up to 15 read it as Scenic instead of failing to decode the route.
function styleKeys(style) {
  if (style === "balanced") return { balancesRoads: true };
  if (style === "shortest") return { routingPreference: "shortest" };
  if (style === "scenic") return { routingPreference: "scenic" };
  return {};
}

/// The Route payload. `plan` is the page's own state:
///   { id, token, createdAt, name, start, end, waypoints:[{id,lat,lon,type,label,stayMinutes}],
///     trip: "oneWay"|"roundTrip"|"outAndBack", style, path:{geometry:[[lon,lat]],instructions,distanceMeters,durationSeconds},
///     elevationProfile?, blurb? }
export function routePayload(plan, now = appleDate()) {
  const all = plan.waypoints.slice(0, MAX_WAYPOINTS).map(wireWaypoint);
  const loops = plan.trip === "roundTrip" || plan.trip === "outAndBack";
  const end = loops ? plan.start : plan.end;
  const payload = {
    // What the planner doesn't make but a route it edits had: its photo, its maker.
    ...(plan.kept && typeof plan.kept === "object" ? plan.kept : {}),
    id: plan.id,
    name: clip(plan.name, MOST_NAME_CHARACTERS) || "Untitled drive",
    start: coordinate(plan.start),
    end: coordinate(end),
    waypoints: thinned(all, OLDER_BUILDS_WAYPOINT_LIMIT),
    pathGeometry: plan.path.geometry.map(([lon, lat]) => ({ latitude: lat, longitude: lon })),
    turnInstructions: plan.path.instructions,
    pathDistanceMeters: plan.path.distanceMeters,
    pathDurationSeconds: plan.path.durationSeconds,
    createdAt: plan.createdAt,
    updatedAt: now,
    shareToken: plan.token,
    ...styleKeys(plan.style),
  };
  if (loops) payload.tripType = "roundtrip";
  if (plan.trip === "outAndBack" && all.length > 0) payload.returnsSameWay = true;
  if (plan.elevationProfile) payload.elevationProfile = plan.elevationProfile;
  if (plan.blurb) payload.blurb = plan.blurb;
  if (all.length > OLDER_BUILDS_WAYPOINT_LIMIT) payload.allWaypoints = all;
  return payload;
}

/// The `routes` row the app pushes (SupabaseRoutes.swift RemoteRoutePush):
/// the bbox covers the chain and the frozen road, ids are lowercase.
export function routeRow(plan, ownerId, payload) {
  const points = [payload.start, ...payload.waypoints.map((w) => w.location), payload.end, ...payload.pathGeometry];
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  return {
    id: plan.id.toLowerCase(),
    owner_id: ownerId.toLowerCase(),
    name: payload.name,
    visibility: "private",
    start_lat: payload.start.latitude,
    start_lon: payload.start.longitude,
    end_lat: payload.end.latitude,
    end_lon: payload.end.longitude,
    min_lat: Math.min(...lats),
    min_lon: Math.min(...lons),
    max_lat: Math.max(...lats),
    max_lon: Math.max(...lons),
    distance_meters: payload.pathDistanceMeters,
    duration_seconds: payload.pathDurationSeconds,
    stop_count: (payload.allWaypoints || payload.waypoints).filter((w) => w.type === "stop").length,
    origin_route_id: null,
    payload,
  };
}

/// Letters for stops (A, B, … Z, AA), numbers for waypoints, in route
/// order: the app's own labels.
export function markerLabels(waypoints) {
  let stops = 0;
  let markers = 0;
  return waypoints.map((w) => {
    if (w.type === "stop") {
      let n = stops++;
      let label = "";
      do {
        label = String.fromCharCode(65 + (n % 26)) + label;
        n = Math.floor(n / 26) - 1;
      } while (n >= 0);
      return label;
    }
    markers += 1;
    return String(markers);
  });
}

/// Miles where people drive in miles; kilometres everywhere else.
const MILES_REGIONS = new Set(["US", "GB", "LR", "MM"]);
export function usesMiles(locale) {
  const region = (locale || "").split(/[-_]/)[1]?.toUpperCase();
  return region ? MILES_REGIONS.has(region) : (locale || "").toLowerCase().startsWith("en");
}

export function formatDistance(meters, miles) {
  const value = miles ? meters / 1609.344 : meters / 1000;
  return { value: value >= 100 ? value.toFixed(0) : value.toFixed(1), unit: miles ? "miles" : "km" };
}

export function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m}` : `${h} h`;
}

/// Where a link points, read the way the apps' importer reads it.
export function linkKind(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const is = (domain) => host === domain || host.endsWith(`.${domain}`);
  if (is("ridewithgps.com") || is("rwgps.com")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.findIndex((p) => p === "routes" || p === "trips");
    const id = at >= 0 ? parseInt((parts[at + 1] || "").split(".")[0], 10) : NaN;
    if (!(id > 0)) return { kind: "unknown" };
    return { kind: "rwgps", ref: { kind: parts[at], id, privacyCode: url.searchParams.get("privacy_code") || undefined } };
  }
  if (is("carve.run")) {
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts[0] === "r" ? parts[1] : parts[0];
    if (token && /^[A-Za-z0-9]{10}$|^[0-9a-f]{32}$/.test(token)) return { kind: "carve", token, data: url.searchParams.get("d") };
    return { kind: "unknown" };
  }
  if (is("google.com") || is("goo.gl") || host === "maps.app.goo.gl") return { kind: "google", url: url.href };
  return { kind: "unknown" };
}

/// A GPX file (1.0 and 1.1), as GPXFile.read: its tracks end to end, or
/// failing those its route points; named waypoints as places. `doc` is a
/// parsed XML Document (DOMParser in the page).
export function readGPX(doc) {
  const root = doc?.documentElement;
  if (!root || root.localName !== "gpx") throw new Error("not-gpx");
  const all = (name) => Array.from(doc.getElementsByTagNameNS("*", name));
  const point = (el) => {
    const lat = parseFloat(el.getAttribute("lat"));
    const lon = parseFloat(el.getAttribute("lon"));
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
  };
  const nameOf = (el) => {
    const child = Array.from(el.children).find((c) => c.localName === "name");
    return clip(child?.textContent, MOST_LABEL_CHARACTERS);
  };
  const trackPoints = all("trkpt").map(point).filter(Boolean);
  const routePoints = all("rtept").map((el) => ({ at: point(el), name: nameOf(el) })).filter((p) => p.at);
  const line = trackPoints.length >= 2 ? trackPoints : routePoints.map((p) => p.at);
  if (line.length < 2) throw new Error("no-track");
  const places = all("wpt").map((el) => ({ at: point(el), name: nameOf(el) })).filter((p) => p.at);
  if (trackPoints.length < 2) places.push(...routePoints.filter((p) => p.name));
  const topName = (tag) => {
    const el = all(tag)[0];
    return el ? nameOf(el) : null;
  };
  return {
    name: topName("metadata") || topName("trk") || topName("rte"),
    track: line,
    places: places.map((p) => ({ lon: p.at[0], lat: p.at[1], name: p.name })),
  };
}

/// What a turn's arrow is, from its words: the printed directions and the
/// list draw one per turn.
export function turnKind(text) {
  const t = (text || "").toLowerCase();
  if (/arrive|destination/.test(t)) return "arrive";
  if (/u-turn|turn around|make a u/.test(t)) return "uturn";
  if (/roundabout|rotary/.test(t)) return "roundabout";
  if (/slight left|bear left|keep left/.test(t)) return "keepleft";
  if (/slight right|bear right|keep right/.test(t)) return "keepright";
  if (/sharp left|turn left|\bleft\b/.test(t)) return "left";
  if (/sharp right|turn right|\bright\b/.test(t)) return "right";
  if (/^(head|drive|start)/.test(t)) return "start";
  return "straight";
}
