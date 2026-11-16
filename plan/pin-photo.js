// A map pin's photo (Chris approved Product's mock v4, 11/13; on every pin,
// the place pills' too, Chris 11/15): asked once the places show (the
// planner's `photos`: OSM, Commons by name, Mapillary nearby), filled in as
// they come; a place with none keeps its icon. A place the planner ran out
// of time on (left out, not "none") is asked once more a few seconds later
// (DevOps, 11/14). A street view opens full screen; a Commons photo in the
// same shell (street-view.js). Used by suggest.js and place-pills.js.

import { openPhotoView, openStreetView } from "./street-view.js?v=2";

export const PHOTO_AGAIN_MS = 3000;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/// The planner's photos for `items` (their first 12): got({ photos, token })
/// each time some come (photos by the item's index), while still() holds.
export async function askPhotos(planner, items, { still, got, only = null }) {
  const ids = only ?? items.slice(0, 12).map((_, i) => i);
  try {
    const answer = await planner("photos", { places: ids.map((i) => ({ id: String(i), name: items[i].title, lat: items[i].place.lat, lon: items[i].place.lon })) });
    if (!still()) return;
    const photos = [];
    const said = new Set();
    for (const p of answer?.photos || []) {
      if (!p || !("photo" in p)) continue;
      said.add(Number(p.id));
      if (p.photo) photos[Number(p.id)] = p.photo;
    }
    got({ photos, token: answer?.viewer?.token || null });
    const left = ids.filter((i) => !said.has(i));
    if (!only && left.length) setTimeout(() => { if (still()) askPhotos(planner, items, { still, got, only: left }); }, PHOTO_AGAIN_MS);
  } catch {
    // No photos this time: the icons stay.
  }
}

/// A photo into its box, faded in once loaded; a broken one leaves the icon.
export function photoInto(box, photo, cls) {
  box.querySelector(`img.${cls}`)?.remove();
  if (!photo?.thumb) return;
  const img = el("img", cls);
  img.alt = "";
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.addEventListener("load", () => { img.classList.add("in"); box.classList.add("has-photo"); });
  img.addEventListener("error", () => { img.remove(); box.classList.remove("has-photo"); });
  img.src = photo.thumb;
  box.append(img);
}

/// A photo opens full screen: a street view, or a Commons photo in the
/// same shell (Chris, 11/15: not Commons's file page).
export function openPhoto(photo, place, token) {
  if (!photo) return;
  if (photo.src === "mapillary") { if (token) openStreetView({ place, imageId: photo.mapillary_id, token }); }
  else if (photo.thumb) openPhotoView({ place, photo });
}

/// The card's photo (mock v4): 136 px on top, ✕, its credit, and expand
/// (the street view, or the Commons photo); "Over 3 yrs old" on a street
/// view taken more than 3 years ago. onOpen: expand; onClose: ✕.
export function cardPhoto(photo, { onOpen, onClose }) {
  const ph = el("div", "suggest-ph");
  photoInto(ph, photo, "suggest-ph-img");
  ph.querySelector("img")?.addEventListener("error", () => ph.remove());
  const taken = Date.parse(photo.captured_at || "");
  if (photo.src === "mapillary" && Number.isFinite(taken) && Date.now() - taken > 3 * 365.25 * 86400_000) ph.append(el("span", "suggest-ph-old", "Over 3 yrs old"));
  const x = el("button", "suggest-ph-x", "×");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.addEventListener("click", onClose);
  const credit = el("span", "suggest-ph-credit", photo.src === "mapillary" ? photo.credit : `Photo: ${photo.credit}`);
  const exp = el("button", "suggest-ph-exp");
  exp.type = "button";
  exp.setAttribute("aria-label", photo.src === "mapillary" ? "Open the street view" : "Open the photo");
  exp.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
  exp.addEventListener("click", onOpen);
  ph.addEventListener("click", (e) => { if (e.target === ph || e.target.tagName === "IMG") onOpen(); });
  ph.append(x, credit, exp);
  return ph;
}
