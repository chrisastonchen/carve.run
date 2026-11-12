// Dragging cards into zones with Pointer Events (the Groups board, the
// user's UX pass 11/9: names should move like cards, on touch too). The
// board wires it (groups-board.js); this file only moves things.
//
// - Mouse drags from anywhere on a card; touch and pen from the handle, or
//   from the card after a long press, so a swipe still scrolls the board.
// - A press that moves less than `threshold` px is a click, and buttons,
//   links and fields inside a card never start a drag.
// - `getIds(id)` says what moves with the card (the board's selection).
// - Escape cancels. While over a zone it has the class `over`; the moving
//   cards have `dragging`; the ghost is a copy with `drag-ghost`, the only
//   element given inline styles (its position). Any animation is the CSS's,
//   which can respect prefers-reduced-motion.
// - Near an edge of a scroller (the board's sideways columns, the page),
//   it scrolls.
// The geometry (hitTest, edgeScroll) is pure and tested without a DOM.

/// Which zone a point is in, and where in its list: the number of the
/// zone's cards whose middle is above the point. `zones` are rects
/// ({left, top, right, bottom}) with their cards' {top, bottom} in order,
/// the moving cards left out. → {zone, index} or null outside them all.
export function hitTest(point, zones) {
  for (let zone = 0; zone < zones.length; zone++) {
    const z = zones[zone];
    if (point.x < z.left || point.x > z.right || point.y < z.top || point.y > z.bottom) continue;
    const index = (z.items || []).filter((it) => (it.top + it.bottom) / 2 < point.y).length;
    return { zone, index };
  }
  return null;
}

/// How far to scroll this frame: toward the start or end when the pointer
/// is within `edge` px of it, faster the closer, at most `max`; else 0.
export function edgeScroll(pos, start, end, { edge = 40, max = 18 } = {}) {
  if (end - start <= edge * 2) return 0;
  if (pos < start + edge) return -Math.ceil(max * Math.min(1, (start + edge - pos) / edge));
  if (pos > end - edge) return Math.ceil(max * Math.min(1, (pos - (end - edge)) / edge));
  return 0;
}

const NOT_A_GRIP = "button, a, input, select, textarea, label, [contenteditable]";

/// Wire `root`: cards match `item` (each with data-id), zones match `zone`.
/// onDrop(ids, zoneEl, index), index among the zone's cards not moving.
/// `scrollers`: elements that scroll while dragging (the page always does).
/// → { destroy, get dragging }.
export function makeDraggable(root, {
  item, zone, handle = null, getIds = (id) => [id], onDrop,
  scrollers = [], threshold = 6, longPress = 350,
}) {
  let press = null; // {id, card, x, y, pointerId, type, armed, timer}
  let drag = null; // {ids, cards, ghost, dx, dy, over, at: {x, y}, frame}
  let swallowClick = false;
  const doc = root.ownerDocument;
  const win = doc.defaultView;

  function down(e) {
    if (press || drag || e.button > 0) return;
    const card = e.target.closest?.(item);
    if (!card || !root.contains(card)) return;
    const onHandle = !!(handle && e.target.closest(handle));
    const control = e.target.closest(NOT_A_GRIP);
    if (control && card.contains(control) && !(onHandle && control.closest(handle))) return;
    const touchy = e.pointerType === "touch" || e.pointerType === "pen";
    press = { id: card.dataset.id, card, x: e.clientX, y: e.clientY, pointerId: e.pointerId, armed: !touchy || onHandle, timer: 0 };
    // Touch away from the handle: a long press arms it; moving first is a scroll.
    if (!press.armed) press.timer = win.setTimeout(() => { if (press) press.armed = true; }, longPress);
  }

  function move(e) {
    if (drag) {
      if (e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      drag.at = { x: e.clientX, y: e.clientY };
      place();
      return;
    }
    if (!press || e.pointerId !== press.pointerId) return;
    const far = Math.hypot(e.clientX - press.x, e.clientY - press.y) > threshold;
    if (!far) return;
    if (!press.armed) return cancelPress(); // a scroll
    start(e);
  }

  function start(e) {
    const ids = getIds(press.id) || [press.id];
    const cards = [...root.querySelectorAll(item)].filter((c) => ids.includes(c.dataset.id));
    const r = press.card.getBoundingClientRect();
    const ghost = press.card.cloneNode(true);
    ghost.classList.add("drag-ghost");
    ghost.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    if (cards.length > 1) ghost.dataset.count = String(cards.length);
    Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, pointerEvents: "none", zIndex: "1000", margin: "0" });
    doc.body.append(ghost);
    for (const c of cards) c.classList.add("dragging");
    drag = { ids, cards, ghost, dx: press.x - r.left, dy: press.y - r.top, over: null, at: { x: e.clientX, y: e.clientY }, pointerId: press.pointerId, frame: 0 };
    try { press.card.setPointerCapture?.(press.pointerId); } catch { /* gone */ }
    cancelPress();
    place();
    drag.frame = win.requestAnimationFrame(tick);
  }

  /// The ghost under the pointer, and the zone it's over.
  function place() {
    const { ghost, at } = drag;
    ghost.style.left = `${at.x - drag.dx}px`;
    ghost.style.top = `${at.y - drag.dy}px`;
    const hit = target();
    const over = hit ? hit.el : null;
    if (over !== drag.over) {
      drag.over?.classList.remove("over");
      over?.classList.add("over");
      drag.over = over;
    }
  }

  function target() {
    const els = [...root.querySelectorAll(zone)];
    const rects = els.map((el) => {
      const r = el.getBoundingClientRect();
      const items = [...el.querySelectorAll(item)].filter((c) => !drag.ids.includes(c.dataset.id)).map((c) => c.getBoundingClientRect());
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, items };
    });
    const hit = hitTest(drag.at, rects);
    return hit ? { el: els[hit.zone], index: hit.index } : null;
  }

  // Scroll while near an edge: each scroller sideways and down, then the page.
  function tick() {
    if (!drag) return;
    let moved = false;
    for (const s of scrollers) {
      const r = s.getBoundingClientRect();
      if (drag.at.y < r.top || drag.at.y > r.bottom) continue;
      const dx = edgeScroll(drag.at.x, r.left, r.right);
      const dy = edgeScroll(drag.at.y, r.top, r.bottom);
      if (dx || dy) { s.scrollBy(dx, dy); moved = true; }
    }
    const py = edgeScroll(drag.at.y, 0, win.innerHeight);
    if (py) { win.scrollBy(0, py); moved = true; }
    if (moved) place();
    drag.frame = win.requestAnimationFrame(tick);
  }

  function up(e) {
    if (press && e.pointerId === press.pointerId) cancelPress();
    if (!drag || e.pointerId !== drag.pointerId) return;
    const hit = target();
    const { ids } = drag;
    end();
    // The click that follows a drag isn't a click on the card.
    swallowClick = true;
    win.setTimeout(() => { swallowClick = false; }, 0);
    if (hit) onDrop(ids, hit.el, hit.index);
  }

  function end() {
    win.cancelAnimationFrame(drag.frame);
    drag.ghost.remove();
    for (const c of drag.cards) c.classList.remove("dragging");
    drag.over?.classList.remove("over");
    drag = null;
  }

  function cancelPress() {
    if (press?.timer) win.clearTimeout(press.timer);
    press = null;
  }

  function key(e) {
    if (e.key !== "Escape" || !drag) return;
    e.preventDefault();
    end();
  }
  function click(e) {
    if (!swallowClick) return;
    e.stopPropagation();
    e.preventDefault();
    swallowClick = false;
  }
  // While a touch drag is on, the page mustn't scroll under it.
  function touchmove(e) { if (drag || press?.armed) e.preventDefault(); }
  function cancel(e) {
    if (press && e.pointerId === press.pointerId) cancelPress();
    if (drag && e.pointerId === drag.pointerId) end();
  }

  root.addEventListener("pointerdown", down);
  doc.addEventListener("pointermove", move, { passive: false });
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel);
  doc.addEventListener("keydown", key);
  root.addEventListener("click", click, true);
  root.addEventListener("touchmove", touchmove, { passive: false });
  return {
    get dragging() { return !!drag; },
    destroy() {
      if (drag) end();
      cancelPress();
      root.removeEventListener("pointerdown", down);
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", cancel);
      doc.removeEventListener("keydown", key);
      root.removeEventListener("click", click, true);
      root.removeEventListener("touchmove", touchmove);
    },
  };
}
