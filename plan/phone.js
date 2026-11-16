// The planner on a phone (Product's mocks, approved by Chris 11/15): the
// map full screen and the panel a sheet over it at three heights, low (the
// totals and the button), half and full, dragged by its handle or tapped.
// The totals and the button stay at the bottom at every height (the panel's
// .foot). Only while html.phone is on (a window 699 px or narrower);
// wider, the panel is the desktop card again.

export const PHONE = "(max-width: 699px)";
const HEIGHTS = ["low", "half", "full"];
const SNAP_MS = 240;

/// The sheet: { set(height), height(), top() }. onMove(top) after each
/// settle, so the map can keep what's shown clear of it.
export function initPhoneSheet({ panel, onMove = () => {} }) {
  const root = document.documentElement;
  const grab = document.createElement("button");
  grab.type = "button";
  grab.className = "sheet-grab";
  grab.innerHTML = "<i></i>";
  panel.prepend(grab);
  let height = "half";

  const bar = () => parseFloat(getComputedStyle(root).getPropertyValue("--bar")) || 64;
  const viewH = () => window.innerHeight;
  // Each height's top edge, in px from the top of the window.
  function topOf(h) {
    const H = viewH();
    const above = bar() + (panel.classList.contains("drive-mode") ? 52 : 0);
    // Low: the visible feet (the totals and button, and Sign up or log in) and the handle.
    const feet = [...panel.querySelectorAll(".view:not([hidden]) > .foot:not([hidden])")].reduce((sum, f) => sum + f.offsetHeight, 0);
    const low = H - (feet || 120) - 22;
    if (h === "full") return above + 10;
    if (h === "low") return Math.max(above + 10, low);
    return Math.max(above + 10, Math.min(low, Math.round(H * 0.46)));
  }
  function place(top, animate) {
    panel.style.transition = animate ? `top ${SNAP_MS}ms cubic-bezier(.2,.8,.2,1)` : "none";
    panel.style.top = `${Math.round(top)}px`;
    // The map's credits ride on the sheet (plan.css).
    root.style.setProperty("--sheet-gap", `${Math.max(0, Math.round(viewH() - top))}px`);
  }
  function set(h, { animate = true } = {}) {
    if (!root.classList.contains("phone")) return;
    height = HEIGHTS.includes(h) ? h : "half";
    root.dataset.sheet = height;
    // The keyboard up: the sheet stays fitted above it (keyboard()).
    if (root.classList.contains("keyboard")) return;
    grab.setAttribute("aria-label", height === "full" ? "Show more of the map" : "Show more of the route");
    grab.setAttribute("aria-expanded", String(height === "full"));
    place(topOf(height), animate);
    setTimeout(() => onMove(topOf(height)), animate ? SNAP_MS : 0);
  }

  // Dragging the handle (or the totals): follows the finger, then settles
  // on the nearest height, or the next one along on a flick.
  let drag = null;
  function down(event) {
    if (!root.classList.contains("phone") || event.button > 0) return;
    drag = { y: event.clientY, top: panel.getBoundingClientRect().top, t: event.timeStamp, moved: false, id: event.pointerId, el: event.currentTarget };
    try { drag.el.setPointerCapture(event.pointerId); } catch {}
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dy = event.clientY - drag.y;
    if (Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    event.preventDefault();
    place(Math.min(topOf("low"), Math.max(topOf("full"), drag.top + dy)), false);
  }
  function up(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      // A tap on the handle: one height up; from full, back to half.
      if (d.el === grab) set(height === "full" ? "half" : height === "low" ? "half" : "full");
      return;
    }
    const top = panel.getBoundingClientRect().top;
    const speed = (event.clientY - d.y) / Math.max(1, event.timeStamp - d.t);
    // Where the finger was headed: a flick carries on a little.
    const aim = top + Math.max(-1.5, Math.min(1.5, speed)) * 160;
    set(HEIGHTS.reduce((a, b) => (Math.abs(topOf(b) - aim) < Math.abs(topOf(a) - aim) ? b : a)));
  }
  for (const el of [grab, ...panel.querySelectorAll(".foot .figures")]) {
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }
  // Typing in the sheet: all of it, so the keyboard doesn't cover the field.
  panel.addEventListener("focusin", (event) => {
    if (root.classList.contains("phone") && event.target.matches("input:not([type=checkbox]):not([type=radio]), textarea") && height !== "full") set("full");
  });
  // The keyboard (QA's iOS pass, 11/16: the search scrolled up under the
  // status bar; a gap of map between the rows and the keyboard): while
  // something in the sheet is typed in, the sheet is exactly what's on
  // screen above the keyboard, below the status bar; it goes back after.
  const vv = window.visualViewport;
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const typing = () => !!document.activeElement?.matches?.("input, textarea") && panel.contains(document.activeElement);
  // The screen's full height, from when nothing is typed in: iOS 26 shrinks
  // innerHeight with the keyboard sometimes (QA's probe: 472 with it up), so
  // "is the keyboard up" can't be measured against innerHeight then.
  let fullHeight = window.innerHeight;
  const noteFull = () => { if (!typing()) fullHeight = Math.max(window.innerHeight, vv ? vv.height : 0); };
  function keyboard() {
    if (!vv || !root.classList.contains("phone")) return;
    noteFull();
    const up = typing() && vv.height < Math.max(fullHeight, window.innerHeight) - 120;
    // The document stays put: iOS scrolls it to show a field (QA, 11/16).
    if (up && (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop)) {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
    if (up) {
      const safeTop = probe.offsetHeight;
      const top = vv.offsetTop + Math.max(8, safeTop + 4);
      root.classList.add("keyboard");
      panel.style.transition = "none";
      panel.style.top = `${Math.round(top)}px`;
      panel.style.bottom = "auto";
      panel.style.height = `${Math.max(120, Math.round(vv.offsetTop + vv.height - top))}px`;
      // The field in view inside the sheet (never the page scrolled).
      const field = document.activeElement;
      const box = field.closest(".scroll");
      if (box && !field.closest(".phone-add-pin")) {
        const f = field.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (f.bottom > b.bottom - 12) box.scrollTop += f.bottom - b.bottom + 24;
        else if (f.top < b.top + 12) box.scrollTop -= b.top - f.top + 24;
      }
    } else if (root.classList.contains("keyboard")) {
      root.classList.remove("keyboard");
      panel.style.bottom = "";
      panel.style.height = "";
      set(height, { animate: false });
    }
  }
  vv?.addEventListener("resize", keyboard);
  vv?.addEventListener("scroll", keyboard);
  // The keyboard slides in over about 300 ms: looked at again while it does.
  panel.addEventListener("focusin", () => { for (const ms of [60, 200, 400, 700]) setTimeout(keyboard, ms); });
  panel.addEventListener("focusout", () => setTimeout(keyboard, 50));
  window.addEventListener("orientationchange", () => { fullHeight = 0; setTimeout(noteFull, 400); });
  let resized = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resized);
    resized = setTimeout(() => { if (root.classList.contains("phone") && !drag) set(height, { animate: false }); }, 120);
  });
  return { set, height: () => height, top: () => topOf(height) };
}

/// Your own drive opened on a phone (screen 1): the app, or here. Shown
/// once per phone; after Continue in browser /plan/ opens straight to the
/// planner, after Get the app it asks again (the app may not be there).
export const CHOICE_KEY = "carve.plan.phone";
export function initPhoneChoice({ gate, store, onBrowser }) {
  if (store.get(CHOICE_KEY) === "browser") return false;
  document.documentElement.classList.add("phone-choice");
  gate.querySelector("#gate-open").addEventListener("click", () => store.set(CHOICE_KEY, "app"), { capture: true });
  gate.querySelector("#gate-browser").addEventListener("click", () => {
    store.set(CHOICE_KEY, "browser");
    document.documentElement.classList.remove("phone-choice");
    onBrowser();
  });
  return true;
}

/// A sheet of actions over the planner (a row's ⋯, a long press on the
/// map): a title, a line under it, and items, each { label, sub, run,
/// danger } or a node of its own. A tap outside or ✕ closes it.
export function actionSheet({ title, sub = "", items, label = title }) {
  const d = document.createElement("dialog");
  d.className = "act-sheet";
  d.setAttribute("aria-label", label);
  const head = document.createElement("div");
  head.className = "act-head";
  const words = document.createElement("div");
  const h = document.createElement("h2");
  h.textContent = title;
  words.append(h);
  if (sub) { const p = document.createElement("p"); p.textContent = sub; words.append(p); }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "act-x";
  x.setAttribute("aria-label", "Close");
  x.textContent = "✕";
  x.addEventListener("click", () => d.close());
  head.append(words, x);
  d.append(head);
  for (const item of items) {
    if (item instanceof Node) { d.append(item); continue; }
    const b = document.createElement("button");
    b.type = "button";
    b.className = `act${item.danger ? " danger" : ""}`;
    b.textContent = item.label;
    if (item.sub) { const s = document.createElement("span"); s.className = "sub"; s.textContent = item.sub; b.append(s); }
    b.addEventListener("click", () => { d.close(); item.run(); });
    d.append(b);
  }
  // A tap on the dimmed map around it.
  d.addEventListener("click", (event) => { if (event.target === d) d.close(); });
  d.addEventListener("close", () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

/// A long press on a row picks it up (no handle on a phone); it follows
/// the finger and drops before the row it's over. canDrag(li) → its index
/// or null; drop(from, to).
export function initRowDrag(list, { canDrag, drop, slots }) {
  let press = null;
  let drag = null;
  const clear = () => list.querySelectorAll(".drop-before").forEach((n) => n.classList.remove("drop-before"));
  list.addEventListener("touchstart", (event) => {
    if (!document.documentElement.classList.contains("phone") || event.touches.length > 1) return;
    const li = event.target.closest("li");
    // The name too (text on a phone, it's most of the row).
    if (!li || event.target.closest("button:not(.row-name), select, a, input, textarea")) return;
    const from = canDrag(li);
    if (from == null) return;
    const t = event.touches[0];
    press = { li, from, x: t.clientX, y: t.clientY, timer: setTimeout(() => {
      drag = { li, from, y: press.y, to: null };
      document.activeElement?.blur?.();
      li.classList.add("dragging", "lifted");
      navigator.vibrate?.(8);
    }, 420) };
  }, { passive: true });
  list.addEventListener("touchmove", (event) => {
    const t = event.touches[0];
    if (press && !drag && Math.hypot(t.clientX - press.x, t.clientY - press.y) > 8) { clearTimeout(press.timer); press = null; return; }
    if (!drag) return;
    event.preventDefault();
    drag.li.style.transform = `translateY(${t.clientY - drag.y}px)`;
    clear();
    drag.to = null;
    for (const [li, slot] of slots()) {
      if (li === drag.li) continue;
      const r = li.getBoundingClientRect();
      if (t.clientY >= r.top && t.clientY < r.bottom) { li.classList.add("drop-before"); drag.to = slot; break; }
    }
  }, { passive: false });
  const end = () => {
    if (press) clearTimeout(press.timer);
    press = null;
    if (!drag) return;
    const d = drag;
    drag = null;
    d.li.classList.remove("dragging", "lifted");
    d.li.style.transform = "";
    clear();
    if (d.to != null) drop(d.from, d.to > d.from ? d.to - 1 : d.to);
  };
  list.addEventListener("touchend", end);
  list.addEventListener("touchcancel", end);
}
