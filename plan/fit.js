// Fitting the map to a route or to pins beside the panel. MapLibre adds
// the map's own padding (an easeTo or flyTo with padding leaves it set) to
// a fit's, so at 768 wide the two passed the map's width and the fit was
// refused: the planner stayed on the whole Bay Area (QA, 11/12). This asks
// for only what the map's padding doesn't already give, and never for more
// room than the map has.

/// The padding to give fitBounds for `want` around the bounds, on a map of
/// `width` × `height` already padded by `now`. Pure, for the tests.
export function fitRoom(want, now, width, height, least = 80) {
  const side = (a, b, room) => {
    const x = Math.max(0, a), y = Math.max(0, b);
    const most = Math.max(0, room - least);
    if (x + y <= most) return [x, y];
    const k = most / (x + y);
    return [Math.floor(x * k), Math.floor(y * k)];
  };
  const [left, right] = side(want.left - now.left, want.right - now.right, width - now.left - now.right);
  const [top, bottom] = side(want.top - now.top, want.bottom - now.bottom, height - now.top - now.bottom);
  return { top, bottom, left, right };
}

export function fitTo(map, bounds, want, options = {}) {
  const box = map.getContainer().getBoundingClientRect();
  map.fitBounds(bounds, { ...options, padding: fitRoom(want, map.getPadding(), box.width, box.height) });
}
