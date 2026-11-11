// The map's Layers tile (Chris, 11/11): a square in the map's lower-left
// corner showing the other view (a small picture bundled with the page, so
// a planner load spends no satellite tiles); a click toggles Map and
// Satellite. Satellite is Mapbox's imagery through carve.run's Worker
// (/tiles/sat/{z}/{x}/{y}: no key in the page, cached at the edge, a hard
// monthly cap), laid under everything Carve draws, with the labels on top.
// Past the cap the Worker answers 429 and the map goes back to Map.
// The tile shows only once the Worker answers for satellite.

export const LAYER_KEY = "carve.plan.layer";
export const TILES = "/tiles/sat/{z}/{x}/{y}";
export const OFF_WORDS = "Satellite is off until next month.";
export const FAILED_WORDS = "Couldn't load satellite. Try again.";
/// The HEAD's answer, once a browser session: "on", "off" (the cap) or "no".
const SESSION_KEY = "carve.plan.satellite";
const SOURCE = "satellite";
const LAYER = "satellite";
const ATTRIBUTION = '<a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noopener">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a> <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener"><strong>Improve this map</strong></a>';
const PREVIEW = { map: "/plan/layers-map.avif?v=1", satellite: "/plan/layers-satellite.avif?v=1" };

const remembered = () => { try { return localStorage.getItem(LAYER_KEY) === "satellite"; } catch { return false; } };
const remember = (on) => { try { localStorage.setItem(LAYER_KEY, on ? "satellite" : "map"); } catch {} };

/// `h`: { map, below, toast, visible }: `below()` is the lowest layer Carve
/// draws (the imagery goes under it); `visible()` whether the plan's map is
/// showing (not the saved view). Call once the map's style has loaded.
/// → { shown(visible) }
export function initLayers(h) {
  const button = document.getElementById("layers");
  const img = document.getElementById("layers-img");
  let on = false;
  let works = false;
  // A picture that can't be had leaves the tile's own colour, never a broken image.
  img.addEventListener("error", () => { img.style.visibility = "hidden"; });
  img.addEventListener("load", () => { img.style.visibility = ""; });

  function paint() {
    button.setAttribute("aria-pressed", String(on));
    img.src = on ? PREVIEW.map : PREVIEW.satellite;
  }

  function add() {
    const map = h.map();
    if (!map.getSource(SOURCE)) map.addSource(SOURCE, { type: "raster", tiles: [location.origin + TILES], tileSize: 256, maxzoom: 19, attribution: ATTRIBUTION });
    if (!map.getLayer(LAYER)) map.addLayer({ id: LAYER, type: "raster", source: SOURCE }, h.below());
  }

  function remove() {
    const map = h.map();
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  }

  function set(next, keep = true) {
    on = next;
    if (on) add(); else remove();
    if (keep) remember(on);
    paint();
  }

  button.addEventListener("click", () => set(!on));

  // Past the month's cap the Worker answers 429; it can't count, 503: back
  // to Map either way, said once.
  h.map().on("error", (e) => {
    const status = e?.error?.status;
    if (!on || e?.sourceId !== SOURCE || (status !== 429 && status !== 503)) return;
    set(false, false);
    h.toast(status === 429 ? OFF_WORDS : FAILED_WORDS);
    if (status === 429) {
      works = false;
      button.hidden = true;
      try { sessionStorage.setItem(SESSION_KEY, "off"); } catch {}
    }
  });

  /// Whether satellite is on: the Worker's HEAD (the month's room; it never
  /// spends a tile), asked once a browser session.
  const answered = (state) => {
    if (state === "off" && remembered()) h.toast(OFF_WORDS);
    if (state !== "on") return;
    works = true;
    button.hidden = !h.visible();
    paint();
    if (remembered()) set(true, false);
  };
  let kept = null;
  try { kept = sessionStorage.getItem(SESSION_KEY); } catch {}
  if (kept) answered(kept);
  else {
    fetch(location.origin + TILES.replace("{z}/{x}/{y}", "0/0/0"), { method: "HEAD" })
      .then((r) => {
        const state = r.ok ? "on" : r.status === 429 ? "off" : "no";
        // "no" (no Worker route yet, or it couldn't tell) isn't kept: the next load asks again.
        if (state !== "no") try { sessionStorage.setItem(SESSION_KEY, state); } catch {}
        answered(state);
      })
      .catch(() => {});
  }

  /// Shown beside the plan only (and only once satellite works).
  function shown(visible) {
    button.hidden = !visible || !works;
  }

  return { shown };
}
