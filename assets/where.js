// Where a visitor of carve.run likely is, for "great drives near you" on
// the home page and Explore (the user, 2026-10-29): a place they picked
// before (this browser only), else the town carve.run's edge sees the
// connection come from (/where, as the planner starts), else the data
// centre that served the page; either is trusted only when the browser's
// time zone is in the same country, so a VPN's far-off exit gets no guess
// rather than a wrong one. Nothing about where they are is kept.

export const PLACE_KEY = "carve.explore.place";

export const store = {
  get(key, where = localStorage) { try { return JSON.parse(where.getItem(key) || "null"); } catch { return null; } },
  set(key, value, where = localStorage) { try { where.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};

/// Kilometres between two [lon, lat] points.
export function km(a, b) {
  const rad = Math.PI / 180;
  const h = Math.sin((b[1] - a[1]) * rad / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin((b[0] - a[0]) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Cloudflare's data centres in the places Carve has drives, as the airport
// codes /cdn-cgi/trace names them: [lat, lon, the city to show]. They also
// name the town /where finds, when it's near one.
const COLOS = {
  ATL: [33.75, -84.39, "Atlanta"], AUS: [30.27, -97.74, "Austin"], BNA: [36.16, -86.78, "Nashville"], BOS: [42.36, -71.06, "Boston"],
  BUF: [42.89, -78.88, "Buffalo"], CLT: [35.23, -80.84, "Charlotte"], CMH: [39.96, -83.0, "Columbus"], DEN: [39.74, -104.99, "Denver"],
  DFW: [32.78, -96.8, "Dallas"], DTW: [42.33, -83.05, "Detroit"], EWR: [40.74, -74.17, "Newark"], IAD: [38.9, -77.04, "Washington"],
  IAH: [29.76, -95.37, "Houston"], IND: [39.77, -86.16, "Indianapolis"], JAX: [30.33, -81.66, "Jacksonville"], LAS: [36.17, -115.14, "Las Vegas"],
  LAX: [34.05, -118.24, "Los Angeles"], MCI: [39.1, -94.58, "Kansas City"], MEM: [35.15, -90.05, "Memphis"], MIA: [25.76, -80.19, "Miami"],
  MSP: [44.98, -93.27, "Minneapolis"], OMA: [41.26, -95.93, "Omaha"], ORD: [41.88, -87.63, "Chicago"], ORF: [36.85, -76.29, "Norfolk"],
  PDX: [45.52, -122.68, "Portland"], PHL: [39.95, -75.17, "Philadelphia"], PHX: [33.45, -112.07, "Phoenix"], PIT: [40.44, -80.0, "Pittsburgh"],
  RDU: [35.78, -78.64, "Raleigh"], RIC: [37.54, -77.44, "Richmond"], SAN: [32.72, -117.16, "San Diego"], SAT: [29.42, -98.49, "San Antonio"],
  SEA: [47.61, -122.33, "Seattle"], SFO: [37.77, -122.42, "San Francisco"], SJC: [37.34, -121.89, "San Jose"], SLC: [40.76, -111.89, "Salt Lake City"],
  SMF: [38.58, -121.49, "Sacramento"], STL: [38.63, -90.2, "St. Louis"], TPA: [27.95, -82.46, "Tampa"], MCO: [28.54, -81.38, "Orlando"],
  ABQ: [35.08, -106.65, "Albuquerque"], BOI: [43.62, -116.2, "Boise"], OKC: [35.47, -97.52, "Oklahoma City"], MSY: [29.95, -90.07, "New Orleans"],
  CLE: [41.5, -81.69, "Cleveland"], SDF: [38.25, -85.76, "Louisville"], HNL: [21.31, -157.86, "Honolulu"], ANC: [61.22, -149.9, "Anchorage"],
  RNO: [39.53, -119.81, "Reno"], ELP: [31.76, -106.49, "El Paso"], BDL: [41.76, -72.68, "Hartford"],
  YYZ: [43.65, -79.38, "Toronto"], YUL: [45.5, -73.57, "Montreal"], YVR: [49.28, -123.12, "Vancouver"], YYC: [51.05, -114.07, "Calgary"],
  YEG: [53.55, -113.49, "Edmonton"], YWG: [49.9, -97.14, "Winnipeg"], YOW: [45.42, -75.7, "Ottawa"], YHZ: [44.65, -63.58, "Halifax"],
  SYD: [-33.87, 151.21, "Sydney"], MEL: [-37.81, 144.96, "Melbourne"], BNE: [-27.47, 153.03, "Brisbane"], PER: [-31.95, 115.86, "Perth"],
  ADL: [-34.93, 138.6, "Adelaide"], CBR: [-35.28, 149.13, "Canberra"], HBA: [-42.88, 147.33, "Hobart"],
  AKL: [-36.85, 174.76, "Auckland"], CHC: [-43.53, 172.64, "Christchurch"], DXB: [25.2, 55.27, "Dubai"], AUH: [24.45, 54.38, "Abu Dhabi"],
};

/// The countries a browser's time zone can be in, roughly enough to tell a
/// VPN's far-off exit from the visitor's own place.
function zoneCountries() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|Regina|St_Johns|Montreal|Moncton|Whitehorse|Yellowknife)/.test(zone)) return ["CA"];
  if (/^(America|Pacific\/Honolulu|US\/)/.test(zone)) return ["US", "CA"];
  if (/^Australia\//.test(zone)) return ["AU"];
  if (/^Pacific\/(Auckland|Chatham)/.test(zone)) return ["NZ"];
  if (/^Asia\/Dubai/.test(zone)) return ["AE"];
  return [];
}

/// Roughly which country a point is in, for the time-zone check.
function countryAt(lat, lon) {
  if (lat > 22 && lat < 27 && lon > 51 && lon < 57) return "AE";
  if (lat < -9 && lat > -45 && lon > 112 && lon < 155) return "AU";
  if (lat < -33 && lat > -48 && lon > 165 && lon < 179) return "NZ";
  if (lat > 14 && lat < 72 && lon < -52 && lon > -170) return lat > 49 || (lat > 42 && lon > -83 && lon < -64 && lat > 44.8) ? "CA" : "US";
  return "";
}

/// The nearest city we can name, within about 60 miles, or "you".
function nameNear(lat, lon) {
  let best = null, bestKm = 100;
  for (const [y, x, label] of Object.values(COLOS)) {
    const d = km([lon, lat], [x, y]);
    if (d < bestKm) { best = label; bestKm = d; }
  }
  return best || "you";
}

/// Trusted only when the browser's time zone agrees on the country.
function plausible(lat, lon) {
  const zones = zoneCountries();
  const country = countryAt(lat, lon);
  return !!country && (zones.includes(country) || (country === "CA" && zones.includes("US")) || (country === "US" && zones.includes("CA")));
}

export async function guessPlace() {
  const saved = store.get(PLACE_KEY);
  if (saved && Number.isFinite(saved.lat)) return saved;
  // carve.run's own edge: the connection's town, to two decimals (cloudflare/map-worker.js).
  try {
    const response = await fetch("/where", { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const { lat, lon } = await response.json();
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return plausible(lat, lon) ? { lat, lon, label: nameNear(lat, lon), guessed: true } : null;
      }
    }
  } catch { /* fall through */ }
  // Else the data centre that served the page.
  try {
    const text = await (await fetch("/cdn-cgi/trace", { cache: "no-store" })).text();
    const at = COLOS[/colo=([A-Z]+)/.exec(text)?.[1]];
    if (!at || !plausible(at[0], at[1])) return null;
    return { lat: at[0], lon: at[1], label: at[2], guessed: true };
  } catch {
    return null; // off carve.run (no Cloudflare), or offline
  }
}
