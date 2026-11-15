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

/// A Commons thumbnail at Commons's standard widths (it serves 960, 1280
/// and 1920, not 1600): a srcset for the screen; null for another URL.
export function commonsSizes(thumb) {
  const m = /^(https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/?#]+\/)\d+px-([^/?#]+)/.exec(String(thumb || ""));
  if (!m) return null;
  return [960, 1280, 1920].map((w) => `${m[1]}${w}px-${m[2]} ${w}w`).join(", ");
}

/// The shell both viewers share: the stage, the name, ✕, Esc and Tab kept
/// inside, focus given back. → { box, stage, head, said, shut }.
function shell(label, place, closeLabel, back, onShut = () => {}) {
  const box = el("div", "sv");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", label);
  const stage = el("div", "sv-stage");
  const head = el("div", "sv-head");
  head.append(el("b", "", place));
  const close = el("button", "sv-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", closeLabel);
  const said = el("p", "sv-said");
  said.setAttribute("role", "status");
  box.append(stage, el("div", "sv-top"), el("div", "sv-bottom"), head, close);
  const shut = () => {
    document.removeEventListener("keydown", keys, true);
    onShut();
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
  return { box, stage, head, close, said, shut, show: () => { document.body.append(box); document.body.classList.add("sv-open"); close.focus(); } };
}

/// A Commons photo full screen (Chris, 11/15: not Commons's file page), in
/// the street view's shell: the larger picture, the place's name, "Photo:
/// <author> · <licence>" with the licence linking to the file's page on
/// Commons (a new tab), ✕ and Esc. `back`: what has the focus after.
export function openPhotoView({ place, photo, back = document.activeElement }) {
  const v = shell(`Photo: ${place}`, place, "Close the photo", back);
  v.box.classList.add("sv-photo");
  const img = el("img", "sv-img");
  img.alt = place;
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  const sizes = commonsSizes(photo.thumb);
  img.addEventListener("load", () => v.box.classList.add("in"));
  // A size Commons won't make: the thumbnail the card had; none: said.
  img.addEventListener("error", () => {
    if (img.srcset) { img.removeAttribute("srcset"); img.src = photo.thumb; return; }
    img.remove();
    v.said.textContent = "Couldn't open the photo.";
  });
  if (sizes) { img.sizes = "100vw"; img.srcset = sizes; }
  img.src = photo.thumb;
  v.stage.append(img);
  const credit = el("div", "sv-credit", `Photo: ${photo.author ? `${photo.author} · ` : ""}`);
  const licence = el("a", "", photo.licence || "Wikimedia Commons");
  licence.href = photo.link;
  licence.target = "_blank";
  licence.rel = "noopener";
  credit.append(licence);
  v.box.append(credit, v.said);
  v.show();
  return { close: v.shut };
}

/// Opens the viewer on `imageId`. `back`: what has the focus after.
export async function openStreetView({ place, imageId, token, back = document.activeElement }) {
  let viewer = null;
  const v = shell(`Street view: ${place}`, place, "Close the street view", back, () => { try { viewer?.remove(); } catch {} });
  const { box, stage, said, shut } = v;
  const when = el("span", "sv-date");
  v.head.append(when);
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
  box.append(steps, credit, pano, said);
  v.show();

  let run = null;
  let at = imageId;
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
