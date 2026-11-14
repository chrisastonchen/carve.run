// A street view, full screen over the planner (Chris approved Product's
// mock v4, 11/13): MapillaryJS (vendor/mapillary, MIT), loaded only the
// first time one is opened. The place's name and the capture date ("Over
// 3 yrs old" after it when it is), ‹ Back and Forward › along the same
// capture run with where it is in it, the credit with a link to the image
// on Mapillary, "360° · drag to look around" on a panorama, ✕ and Esc to
// close (focus kept inside, and given back). The token is Mapillary's
// client token, from the planner's photos answer; it's never in web/.

const VENDOR = "/plan/vendor/mapillary/";
const SECONDS_OLD = 3 * 365.25 * 86400;
let loading = null;

/// MapillaryJS, once: its script and stylesheet. → window.mapillary.
function load() {
  if (window.mapillary) return Promise.resolve(window.mapillary);
  loading ||= new Promise((done, fail) => {
    const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${VENDOR}mapillary.css?v=412` });
    document.head.append(css);
    const js = Object.assign(document.createElement("script"), { src: `${VENDOR}mapillary.js?v=412`, async: true });
    js.onload = () => (window.mapillary ? done(window.mapillary) : fail(new Error("no viewer")));
    js.onerror = () => { loading = null; fail(new Error("couldn't load")); };
    document.head.append(js);
  });
  return loading;
}

/// "Jun 10, 2023" and whether it's over 3 years old.
export function dateOf(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return { text: "", old: false };
  return { text: new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }), old: (now - ms) / 1000 > SECONDS_OLD };
}

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/// The image ids of a capture run, in order (Mapillary's image_ids).
async function runOf(sequenceId, token) {
  try {
    const res = await fetch(`https://graph.mapillary.com/image_ids?sequence_id=${encodeURIComponent(sequenceId)}`, { headers: { Authorization: `OAuth ${token}` } });
    const ids = res.ok ? ((await res.json()).data || []).map((x) => String(x.id)) : [];
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

/// Opens the viewer on `imageId`. `back`: what has the focus after.
export async function openStreetView({ place, imageId, token, back = document.activeElement }) {
  const box = el("div", "sv");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", `Street view: ${place}`);
  const stage = el("div", "sv-stage");
  const head = el("div", "sv-head");
  const name = el("b", "", place);
  const when = el("span", "sv-date");
  head.append(name, when);
  const close = el("button", "sv-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close the street view");
  const steps = el("div", "sv-steps");
  const prev = el("button", "", "‹ Back");
  prev.type = "button";
  prev.setAttribute("aria-label", "Step back along the road");
  const pos = el("span", "sv-pos");
  const next = el("button", "", "Forward ›");
  next.type = "button";
  next.setAttribute("aria-label", "Step forward along the road");
  steps.append(prev, pos, next);
  const credit = el("div", "sv-credit", "© Mapillary contributors · CC BY-SA · ");
  const on = el("a", "", "View on Mapillary ↗");
  on.target = "_blank";
  on.rel = "noopener";
  on.href = `https://www.mapillary.com/app/?pKey=${encodeURIComponent(imageId)}`;
  credit.append(on);
  const pano = el("div", "sv-360", "360° · drag to look around");
  pano.hidden = true;
  const said = el("p", "sv-said");
  said.setAttribute("role", "status");
  box.append(stage, el("div", "sv-top"), el("div", "sv-bottom"), head, close, steps, credit, pano, said);
  document.body.append(box);
  document.body.classList.add("sv-open");
  close.focus();

  let viewer = null;
  let run = null;
  let at = imageId;
  const shut = () => {
    document.removeEventListener("keydown", keys, true);
    try { viewer?.remove(); } catch {}
    box.remove();
    document.body.classList.remove("sv-open");
    if (back && document.contains(back)) back.focus();
  };
  // Esc closes; Tab stays inside.
  function keys(e) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); shut(); return; }
    if (e.key !== "Tab") return;
    const stops = [...box.querySelectorAll("button:not([disabled]), a[href]")];
    if (!stops.length) return;
    const first = stops[0], last = stops[stops.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener("keydown", keys, true);
  close.addEventListener("click", shut);

  const place_ = () => {
    const i = run ? run.indexOf(at) : -1;
    pos.textContent = run && i >= 0 ? `${i + 1} of ${run.length}` : "";
    prev.disabled = !run || i <= 0;
    next.disabled = !run || i < 0 || i >= run.length - 1;
    on.href = `https://www.mapillary.com/app/?pKey=${encodeURIComponent(at)}`;
  };
  const step = (by) => {
    const i = run ? run.indexOf(at) : -1;
    const to = run?.[i + by];
    if (to) viewer.moveTo(to).catch(() => {});
  };
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  place_();

  try {
    const mly = await load();
    if (!box.isConnected) return;
    viewer = new mly.Viewer({ accessToken: token, container: stage, component: { cover: false, sequence: false, attribution: false, bearing: false, zoom: false } });
    viewer.on("image", async (e) => {
      const image = e.image;
      at = String(image.id);
      const d = dateOf(image.capturedAt);
      when.textContent = d.text;
      if (d.old) {
        when.append(" · ");
        when.append(el("span", "sv-old", "Over 3 yrs old"));
      }
      const spherical = image.cameraType === "spherical" || image.cameraType === "equirectangular";
      pano.hidden = !spherical;
      box.classList.toggle("pano", spherical);
      if (!run && image.sequenceId) run = await runOf(image.sequenceId, token);
      place_();
    });
    // The image itself, so a missing one is said, not a blank screen.
    await viewer.moveTo(imageId);
  } catch {
    box.classList.add("failed");
    said.textContent = "Couldn't open the street view.";
    steps.hidden = true;
  }
  return { close: shut };
}
