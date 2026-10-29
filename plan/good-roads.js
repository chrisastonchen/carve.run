// Carve's drives on the planner's map (the app's Explore roads, its
// catalog's road lines): each road's line, decoded from the catalog, and
// how twisty it is, as the apps mark it. Pure, so
// scripts/plan-tests/good-roads.test.mjs checks it.
//
// The catalog is /drives/roads.json (build_area_pages.py write_roads):
// { t: token, s: slug, n: name, p: place, m: miles, min: minutes,
//   b: bends, c: climb feet, e: [start end, far end], r: polyline, i: card }.
// Points are [lon, lat], as the map's.

/// How twisty, the apps' RoadIntensity: its title, colour and line.
export const LEVELS = [
  { key: "leisurely", title: "Leisurely", below: 90, colour: "#3B8A3E", weight: 2.0, path: "M9 21L15 3" },
  { key: "sweeping", title: "Sweeping", below: 180, colour: "#C0860A", weight: 2.4, path: "M6 21C14 21 18 17 12 12C6 7 10 3 18 3" },
  { key: "twisty", title: "Twisty", below: 300, colour: "#D2591F", weight: 2.8, path: "M2 12Q4.5 3 7 12Q9.5 21 12 12Q14.5 3 17 12Q19.5 21 22 12" },
  { key: "intense", title: "Intense", below: Infinity, colour: "#9B1C1C", weight: 3.0, path: "M7 21L17 17.5L7 14L17 10.5L7 7L17 3.5" },
];

export function level(bends) {
  if (!Number.isFinite(bends)) return null;
  return LEVELS.find((l) => bends < l.below);
}

/// Google's encoded polyline, precision 5, as [lon, lat] points.
export function decode(text) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  const next = () => {
    let result = 0, shift = 0, byte;
    do {
      byte = text.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < text.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < text.length) {
    lat += next();
    lon += next();
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

/// A road's line, decoded once.
export function lineOf(road) {
  if (!road._line) road._line = decode(road.r || "");
  return road._line;
}
