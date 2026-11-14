// A drive's picture on Club home's next-drive card and the drive page's day
// cards (Chris, 11/13; DevOps approved 11/14): the route's own photo with a
// small satellite view of the route in its corner; with no photo, the
// satellite view with the route's line across the card; with satellite off
// (the month's cap, or no answer), the plain line on the card's ground, as
// before. The satellite view is drawn once in the page from the Worker's
// tiles (/tiles/sat, metered by tile-budget and kept at the edge 30 days)
// into a still picture: no live map, at most 3 × 3 tiles a card and 2 × 2 an inset,
// and only for cards on screen. Mapbox and OpenStreetMap credited on it,
// the photo's author under the photo.

export const TILE = 256;
export const TILES = "/tiles/sat/{z}/{x}/{y}";
/// The planner's own answer for the session (layers.js): "on" or "off".
const SESSION_KEY = "carve.plan.satellite";
const MOST_ZOOM = 16;
const LEAST_ZOOM = 3;

/// Web Mercator: a point to world pixels at zoom z.
export function worldPx(lon, lat, z) {
  const size = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size];
}

/// The view for a route's points in a w×h picture: the deepest zoom that
/// fits it with `pad` around, centred; the tiles that cover it, and where
/// each goes. A picture up to 512 px a side takes at most 3 × 3 tiles.
/// → { z, ox, oy, tiles: [{ z, x, y, dx, dy }], at(lon, lat) } or null.
export function viewFor(points, w, h, { pad = 24 } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude));
  if (pts.length < 2 || !(w > 0) || !(h > 0)) return null;
  for (let z = MOST_ZOOM; z >= LEAST_ZOOM; z--) {
    const px = pts.map((p) => worldPx(p.longitude, p.latitude, z));
    const xs = px.map((p) => p[0]), ys = px.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (x1 - x0 > w - 2 * pad || y1 - y0 > h - 2 * pad) continue;
    const ox = Math.round((x0 + x1) / 2 - w / 2), oy = Math.round((y0 + y1) / 2 - h / 2);
    const tiles = [];
    const n = 2 ** z;
    for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + h - 1) / TILE); ty++) {
      for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + w - 1) / TILE); tx++) {
        if (ty < 0 || ty >= n) continue;
        tiles.push({ z, x: ((tx % n) + n) % n, y: ty, dx: tx * TILE - ox, dy: ty * TILE - oy });
      }
    }
    return { z, ox, oy, tiles, at: (lon, lat) => { const [x, y] = worldPx(lon, lat, z); return [x - ox, y - oy]; } };
  }
  return null;
}

/// Whether satellite is on this session: the planner's answer if it has
/// one, else the Worker's HEAD (spends nothing). → Promise<boolean>
let state = null;
export function satelliteOn() {
  if (state) return state;
  let kept = null;
  try { kept = sessionStorage.getItem(SESSION_KEY); } catch {}
  if (kept) return (state = Promise.resolve(kept === "on"));
  return (state = fetch(TILES.replace("{z}/{x}/{y}", "0/0/0"), { method: "HEAD" })
    .then((r) => {
      const said = r.ok ? "on" : r.status === 429 ? "off" : null;
      if (said) try { sessionStorage.setItem(SESSION_KEY, said); } catch {}
      return r.ok;
    })
    .catch(() => false));
}
/// The cap reached mid-session: satellite off for the rest of it.
function turnOff() {
  try { sessionStorage.setItem(SESSION_KEY, "off"); } catch {}
  state = Promise.resolve(false);
}

const tile = async (t) => {
  const r = await fetch(TILES.replace("{z}", t.z).replace("{x}", t.x).replace("{y}", t.y));
  if (r.status === 429) turnOff();
  if (!r.ok) throw new Error(`tile ${r.status}`);
  return createImageBitmap(await r.blob());
};

/// The satellite view of a route with its line, as a picture URL (a blob,
/// kept for the page). → Promise<string|null>
const drawn = new Map();
export function satellitePicture(payload, w, h, { pad, line = 3, ends = true } = {}) {
  const geo = payload?.pathGeometry || [];
  const key = `${geo.length}|${geo[0]?.latitude},${geo[0]?.longitude}|${geo.at(-1)?.latitude},${geo.at(-1)?.longitude}|${w}x${h}`;
  if (drawn.has(key)) return drawn.get(key);
  const made = (async () => {
    if (!(await satelliteOn())) return null;
    const view = viewFor(geo, w, h, { pad });
    if (!view) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    const images = await Promise.all(view.tiles.map(tile));
    view.tiles.forEach((t, i) => g.drawImage(images[i], t.dx, t.dy));
    // A touch darker, so the line and the words over it read.
    g.fillStyle = "rgba(8, 12, 10, .18)";
    g.fillRect(0, 0, w, h);
    const pts = geo.filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude)).map((p) => view.at(p.longitude, p.latitude));
    g.lineJoin = g.lineCap = "round";
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = "rgba(6, 30, 18, .7)";
    g.lineWidth = line + 3;
    g.stroke();
    g.strokeStyle = "#6FD39A";
    g.lineWidth = line;
    g.stroke();
    if (ends) {
      for (const [[x, y], fill] of [[pts[0], "#FFFFFF"], [pts.at(-1), "#2FA866"]]) {
        g.beginPath();
        g.arc(x, y, line + 2.5, 0, 2 * Math.PI);
        g.fillStyle = fill;
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = "rgba(6, 30, 18, .8)";
        g.stroke();
      }
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.86));
    return blob ? URL.createObjectURL(blob) : null;
  })().catch(() => null);
  drawn.set(key, made);
  made.then((url) => { if (!url) drawn.delete(key); });
  return made;
}

const SAT_CREDIT = "© Mapbox © OpenStreetMap";
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
/// The small print in the picture's corner: the photo's author (a link to
/// its page) and, with satellite shown, Mapbox's and OpenStreetMap's.
function credits(photo, satellite) {
  const p = el("small", "cv-credit");
  if (photo?.credit) {
    const a = el("a", "", photo.credit);
    a.href = photo.creditURL || photo.url;
    a.target = "_blank";
    a.rel = "noopener";
    p.append(a);
  }
  if (photo?.credit && satellite) p.append(" · ");
  if (satellite) p.append(SAT_CREDIT);
  return p;
}

/// The picture into a card's shape box, once it's on screen. The box keeps
/// its plain line (shapeSvg) until a better picture is ready, and for good
/// when satellite is off and there's no photo.
export function coverInto(box, payload) {
  if (!box || !payload) return;
  const photo = payload.photo?.url ? payload.photo : null;
  const go = async () => {
    const r = box.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 40 || h < 40) return;
    if (photo) {
      const img = el("img", "cv-photo");
      img.alt = "";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = photo.url;
      await img.decode().catch(() => null);
      if (!img.naturalWidth) return; // a broken photo: the line stays, as with none
      const inset = await satellitePicture(payload, 96, 64, { pad: 8, line: 2, ends: false });
      const keep = [...box.querySelectorAll(".cd-chip")];
      box.replaceChildren(img, ...keep);
      if (inset) {
        const small = el("img", "cv-inset");
        small.alt = "";
        small.src = inset;
        box.append(small);
      }
      box.append(credits(photo, !!inset));
      box.classList.add("cv-cover", "cv-cover-photo");
      return;
    }
    // Drawn at most 480 px a side (3 × 3 tiles at most), shown at the card's size.
    const s = Math.min(1, 480 / w, 480 / h);
    const sat = await satellitePicture(payload, Math.round(w * s), Math.round(h * s), { pad: Math.round(28 * s) });
    if (!sat) return;
    const img = el("img", "cv-sat");
    img.alt = "";
    img.src = sat;
    const keep = [...box.querySelectorAll(".cd-chip")];
    box.replaceChildren(img, ...keep, credits(null, true));
    box.classList.add("cv-cover", "cv-cover-sat");
  };
  if (!("IntersectionObserver" in window)) return void go();
  const seen = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    seen.disconnect();
    go();
  }, { rootMargin: "120px" });
  seen.observe(box);
}
