// The planner's first-visit tour (Chris, 11/20; mock v4, option 2): five
// steps, each a card ("N of 5", Skip tour, Next) beside a real control
// ringed in green. No dimming: the planner stays usable under it. Step 2
// waits for the visitor's own click on the map, then moves beside the menu
// it opens; step 4 points at a great road in view (no ring on the key).
// Both planners: /plan/ and a club day (?drive=…&day=…), with one "seen"
// flag in this browser for both, never the account's. A step whose control
// a planner hasn't got is left out and the rest count to four.

export const TOUR_KEY = "carve.plan.tour";

export const STEPS = [
  { key: "rows", title: "Choose a start and a destination", body: "Search for a place in these fields." },
  { key: "map", title: "Or use the map", body: "Click anywhere on the map.", menuBody: "Start, add a stop or end here." },
  { key: "pills", title: "Find places to stop", body: "Gas, coffee, food, viewpoints and more. Each one has + Stop to add it to your drive." },
  { key: "roads", title: "Take the great roads", body: "Dashed violet lines are great driving roads. Click one to add it to your route." },
  // Signed in (every club day too), no "No account until you save" (Product, 11/20).
  { key: "save", title: "Save Route", body: "No account until you save. Open the link on your phone to drive it in Carve.", signedInBody: "Open the link on your phone to drive it in Carve." },
];

/// The steps this planner has the controls for (the map and the roads are
/// always there), each with its place in the count, in the words for a
/// guest or someone signed in.
export function tourSteps(has, { signedIn = false } = {}) {
  const kept = STEPS.filter((s) => s.key === "map" || s.key === "roads" || has(s.key));
  return kept.map((s, i) => ({ ...s, body: signedIn && s.signedInBody ? s.signedInBody : s.body, n: i + 1, of: kept.length, last: i === kept.length - 1 }));
}

/// Whether this open of the planner gets the tour: the first empty one in
/// this browser, on a computer, not arriving with a route, nor in group
/// mode, and only where storage keeps the flag.
export function wantsTour({ storage, phone, group, arrived, empty, dialogOpen }) {
  if (phone || group || arrived || !empty || dialogOpen) return false;
  try {
    return storage.getItem(TOUR_KEY) === null;
  } catch {
    return false;
  }
}

/// Seen, from the moment it shows: Skip tour, Start planning and leaving
/// mid-tour all count. False when storage won't keep it (then no tour).
export function markSeen(storage) {
  try {
    storage.setItem(TOUR_KEY, "seen");
    return storage.getItem(TOUR_KEY) === "seen";
  } catch {
    return false;
  }
}

const GAP = 22; // the card's edge to what it points at
const WIDTH = 350;
const EDGE = 16; // kept off the window's edges

/// `h`: { $, el, roadPoint() → {x, y} | null (a great road on screen,
/// window coordinates), mapBox() → DOMRect (the map not under the panel),
/// saveButton() → this planner's save, over() → true once saved,
/// signedIn }. Shows
/// the tour; → { end() }.
export function startTour(h) {
  const targets = {
    rows: () => h.$("rows"),
    pills: () => h.$("place-pills"),
    save: () => h.saveButton(),
  };
  const visible = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0;
  const steps = tourSteps((key) => visible(targets[key]?.()), { signedIn: !!h.signedIn });
  let at = 0;
  let menuOpen = false; // step 2, after the visitor's click
  let frame = 0;
  let lastKey = "";

  const ring = h.el("div", "tour-ring");
  ring.setAttribute("aria-hidden", "true");
  const card = h.el("div", "tour-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", "tour-title");
  card.setAttribute("aria-describedby", "tour-body");
  card.tabIndex = -1;
  card.innerHTML = `<p class="tour-count num" id="tour-count"></p><h2 class="tour-title" id="tour-title"></h2><p class="tour-body" id="tour-body" aria-live="polite"></p><div class="tour-row"><button type="button" class="tour-skip" id="tour-skip">Skip tour</button><button type="button" class="tour-next" id="tour-next">Next</button></div>`;
  document.body.append(ring, card);
  const next = card.querySelector("#tour-next");
  const menu = h.$("click-menu");

  // The visitor's own click opens the map's menu: step 2 moves beside it.
  const watchMenu = new MutationObserver(() => {
    const step = steps[at];
    if (step?.key !== "map") return;
    if (!menu.hidden && !menuOpen) {
      menuOpen = true;
      fill();
    }
  });
  watchMenu.observe(menu, { attributes: true, attributeFilter: ["hidden", "style"] });

  function fill() {
    const step = steps[at];
    card.querySelector("#tour-count").textContent = `${step.n} of ${step.of}`;
    // Save's step says the button as it reads (Save Route, or a club day's Save and get the link).
    card.querySelector("#tour-title").textContent = step.key === "save" ? (document.getElementById("save")?.textContent.trim() || step.title) : step.title;
    card.querySelector("#tour-body").textContent = step.key === "map" && menuOpen ? step.menuBody : step.body;
    next.textContent = step.last ? "Start planning" : "Next";
    lastKey = "";
  }

  function go(i) {
    if (i >= steps.length) return end();
    at = i;
    menuOpen = false;
    fill();
  }

  /// Where the card goes this frame: beside its control, or the map's middle.
  function place() {
    if (h.over()) return end();
    frame = requestAnimationFrame(place);
    const step = steps[at];
    const vw = innerWidth, vh = innerHeight;
    const ch = card.offsetHeight;
    let ringOn = null;
    let x, y, side = "", arrow = 40;
    const beside = (r, preferRight = true) => {
      // Right of it, else left; level with its top, kept on screen.
      const right = r.right + GAP;
      const left = r.left - GAP - WIDTH;
      const roomRight = right + WIDTH <= vw - EDGE;
      side = preferRight ? (roomRight || left < EDGE ? "left" : "right") : (left >= EDGE ? "right" : "left");
      x = side === "left" ? right : left;
      const mid = r.top + Math.min(r.height, 120) / 2;
      y = Math.max(EDGE, Math.min(mid - 48, vh - ch - EDGE));
      arrow = Math.max(18, Math.min(mid - y - 9, ch - 36));
    };
    const box = h.mapBox();
    const middle = () => {
      side = "";
      x = Math.max(EDGE, box.left + (box.width - WIDTH) / 2);
      y = Math.max(EDGE, box.top + box.height / 2 - ch / 2 - 60);
    };
    if (step.key === "map") {
      if (menuOpen && visible(menu)) {
        ringOn = menu.getBoundingClientRect();
        beside(ringOn, false);
      } else if (menuOpen) {
        // Picked from the menu, or closed it: the card stays where it was.
        return;
      } else middle();
    } else if (step.key === "roads") {
      const p = h.roadPoint();
      if (p) {
        beside({ left: p.x, right: p.x, top: p.y, height: 0 });
        arrow = Math.max(18, Math.min(p.y - y - 9, ch - 36));
      } else middle();
    } else if (step.key === "pills") {
      const n = targets.pills();
      if (visible(n)) {
        // Pills scroll sideways: the ring is the row's part on screen.
        const r = n.getBoundingClientRect();
        const last = [...n.children].filter(visible).pop()?.getBoundingClientRect();
        ringOn = { left: r.left, top: r.top, width: Math.min(r.width, last ? last.right - r.left : r.width), height: r.height };
        side = "up";
        x = Math.max(EDGE, Math.min(r.left + 40, vw - WIDTH - EDGE));
        y = r.bottom + GAP;
        arrow = Math.max(18, Math.min(r.left + Math.min(ringOn.width, 320) / 2 - x - 9, WIDTH - 36));
      } else middle();
    } else {
      const n = targets[step.key]();
      if (visible(n)) {
        ringOn = n.getBoundingClientRect();
        beside(ringOn);
      } else middle();
    }
    const key = `${at}|${menuOpen}|${Math.round(x)}|${Math.round(y)}|${side}|${Math.round(arrow)}|${ringOn ? [ringOn.left, ringOn.top, ringOn.width, ringOn.height].map(Math.round).join(",") : ""}`;
    if (key === lastKey) return;
    lastKey = key;
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
    card.dataset.side = side;
    card.style.setProperty("--arrow", `${Math.round(arrow)}px`);
    ring.hidden = !ringOn;
    if (ringOn) {
      const pad = 6;
      ring.style.left = `${Math.round(ringOn.left - pad)}px`;
      ring.style.top = `${Math.round(ringOn.top - pad)}px`;
      ring.style.width = `${Math.round(ringOn.width + pad * 2)}px`;
      ring.style.height = `${Math.round(ringOn.height + pad * 2)}px`;
      ring.style.borderRadius = ringOn.height + pad * 2 < 64 ? "999px" : "18px";
    }
  }

  function end() {
    cancelAnimationFrame(frame);
    watchMenu.disconnect();
    removeEventListener("keydown", onKey);
    ring.remove();
    card.remove();
  }

  function onKey(event) {
    if (event.key === "Escape" && !event.defaultPrevented && menu.hidden) end();
  }

  // Next before a click on the map moves on to step 3.
  next.addEventListener("click", () => go(at + 1));
  card.querySelector("#tour-skip").addEventListener("click", end);
  addEventListener("keydown", onKey);
  go(0);
  place();
  // Keys start in the card (Tab: Skip tour, Next) with no outline on Next.
  card.focus({ preventScroll: true });
  return { end, get step() { return steps[at]?.key ?? null; } };
}
