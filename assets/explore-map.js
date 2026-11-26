// Explore's map, shared with /saved/ (Chris, 11/25: Saved is laid out as
// Explore): its style, the phone breakpoint, the picture for a row without
// one, and the drawn roads, a dashed purple line on a white casing that
// glows while pointed at, with a dot for each under zoom 6.

// The map follows the device's theme, light unless it's set to dark (the
// user, 2026-11-02); map-dark.json is scripts/map_dark_style.py's.
export const LIGHT_DEVICE = !window.matchMedia("(prefers-color-scheme: dark)").matches;
export const MAP_STYLE = LIGHT_DEVICE ? "https://tiles.openfreemap.org/styles/liberty" : "/assets/map-dark.json?v=a36458fffd";
export const PHONE = "(max-width: 699px), (max-height: 560px)";
export const NO_PHOTO = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 110"><rect width="160" height="110" fill="#E3EBDA"/>'
  + '<path d="M18 86C46 30 70 92 98 44c14-24 32-6 44-26" fill="none" stroke="#6A4CFF" stroke-width="6" stroke-linecap="round"/></svg>');

/// The roads' layers: `lines` is a source of LineStrings, `dots` one of
/// Points, both with feature ids; a feature's state `on` lights it.
export function addRoadLayers(map, { lines, dots }) {
  const on = (a, b) => ["case", ["boolean", ["feature-state", "on"], false], a, b];
  // The lines load at every zoom, unseen below 5, and the dots fade out
  // over the zoom after 6: a zoom past 6 then has lines to stretch while
  // sharper ones are cut. With lines from 6 only and dots up to it, the map
  // went blank until they came (the user, 2026-10-30, on a phone).
  map.addLayer({ id: "ex-glow", type: "line", source: lines, layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#6A4CFF", "line-width": on(16, 0), "line-blur": 6, "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, on(0.5, 0)] } });
  map.addLayer({ id: "ex-casing", type: "line", source: lines, layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fff", "line-width": on(9, 6), "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, 0.9] } });
  map.addLayer({ id: "ex-line", type: "line", source: lines, layout: { "line-join": "round" },
    paint: { "line-color": "#6A4CFF", "line-width": ["interpolate", ["linear"], ["zoom"], 4, on(4, 1.5), 9, on(5, 3)],
      "line-dasharray": ["literal", [2, 1.6]], "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, on(1, 0.8)] } });
  // Under zoom 6 a road is a speck: a dot shows where each drive is.
  map.addLayer({ id: "ex-dots", type: "circle", source: dots, maxzoom: 7,
    paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, on(6, 3), 6, on(8, 5)], "circle-color": "#6A4CFF",
      "circle-stroke-color": "#fff", "circle-stroke-width": on(2, 1),
      "circle-opacity": ["interpolate", ["linear"], ["zoom"], 6, 1, 7, 0], "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 6, 1, 7, 0] } });
}

// Back and forward arrows over a rail of cards, for a mouse (the user,
// 2026-11-04); a phone or trackpad swipes. A press moves by the cards that
// fit, so none is skipped. Put after `title`; → the update, for after the
// rail's cards change.
const ARROW = (d) => `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function railArrows(rail, title) {
  const arrows = document.createElement("div");
  arrows.className = "ev-arrows";
  arrows.id = `${rail.id}-arrows`;
  arrows.innerHTML = `<button type="button" class="ev-arrow" data-step="-1" aria-label="Back" aria-controls="${rail.id}">${ARROW("M15 5l-7 7 7 7")}</button>`
    + `<button type="button" class="ev-arrow" data-step="1" aria-label="Forward" aria-controls="${rail.id}">${ARROW("M9 5l7 7-7 7")}</button>`;
  title.after(arrows);
  const update = () => {
    const [back, forward] = arrows.children;
    const end = rail.scrollWidth - rail.clientWidth;
    arrows.hidden = end <= 1;
    back.disabled = rail.scrollLeft <= 1;
    forward.disabled = rail.scrollLeft >= end - 1;
  };
  arrows.addEventListener("click", (event) => {
    const button = event.target.closest(".ev-arrow");
    const card = rail.firstElementChild;
    if (!button || !card) return;
    const gap = parseFloat(getComputedStyle(rail).columnGap) || 0;
    const fit = Math.max(1, Math.floor((rail.clientWidth + gap) / (card.offsetWidth + gap)));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollBy({ left: Number(button.dataset.step) * fit * (card.offsetWidth + gap), behavior: still ? "auto" : "smooth" });
  });
  rail.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  return update;
}
