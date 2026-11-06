// Car events on the site (the user, 2026-11-03): Cars & Coffee, cruises,
// shows, track days and autocross, as places on the maps, cards in Explore
// and on the home page, and a page each at /e/<token>. The data is
// /events/events.json, written each morning by the events routine (the app
// reads the same file); its shape is in the app repo's docs/Events-Plan.md.
// Kinds, colours and the picture order match the app's.
import { usesMiles } from "/plan/route-wire.js";
import { km } from "/assets/where.js?v=5c9e34f7e8";

export const EVENTS_URL = "/events/events.json";
/** The maps show what's on in the next two weeks, as the app does. */
export const MAP_DAYS = 14;

const ICONS = {
  coffee: '<path d="M4 7.5h12.2v5.2a5.3 5.3 0 0 1-5.3 5.3H9.3A5.3 5.3 0 0 1 4 12.7z"/><path d="M16.2 9h1.4a2.7 2.7 0 0 1 0 5.4h-1.6" fill="none" stroke="currentColor" stroke-width="1.9"/><rect x="2.5" y="19.4" width="16" height="1.9" rx=".95"/>',
  cruise: '<path d="M1.8 15.4v-2c0-.8.5-1.5 1.3-1.7l2.6-.7 2.6-3.3c.4-.5 1-.8 1.7-.8h5.2c.7 0 1.3.3 1.7.9l2.2 3.1 2.2.6c.7.2 1.2.9 1.2 1.6v2.3c0 .5-.4.9-.9.9h-1.1a2.7 2.7 0 0 0-5.3 0H8.7a2.7 2.7 0 0 0-5.3 0H2.7c-.5 0-.9-.4-.9-.9z"/><circle cx="6.05" cy="16.6" r="1.95"/><circle cx="17.4" cy="16.6" r="1.95"/>',
  show: '<path d="M7 3h10v1.6h3.2v2.2a4.6 4.6 0 0 1-4 4.6 5.2 5.2 0 0 1-3 2.9V17h3v1.6h1.3V21H6.5v-2.4h1.3V17h3v-2.7a5.2 5.2 0 0 1-3-2.9 4.6 4.6 0 0 1-4-4.6V4.6H7zm0 3.4H5.6v.4c0 1.1.6 2 1.5 2.5A5 5 0 0 1 7 8.4zm10 0v2c0 .4 0 .7-.1 1.1a2.8 2.8 0 0 0 1.5-2.5v-.6z"/>',
  track: '<path d="M5,4h2v16H5V4zM7,4h2v2H7V4zM11,4h2v2h-2V4zM15,4h2v2h-2V4zM19,4h2v2h-2V4zM9,6h2v2H9V6zM13,6h2v2h-2V6zM17,6h2v2h-2V6zM7,8h2v2H7V8zM11,8h2v2h-2V8zM15,8h2v2h-2V8zM19,8h2v2h-2V8zM9,10h2v2H9v-2zM13,10h2v2h-2v-2zM17,10h2v2h-2v-2z"/>',
  autocross: '<path d="M10.3 3h3.4l1.1 4.2H9.2zM8.8 9h6.4l1 3.9H7.8zM7.3 14.7h9.4l1.1 4.3H6.2z"/><rect x="3" y="19.6" width="18" height="1.9" rx=".95"/>',
};

export const KINDS = {
  coffee: { label: "Cars & Coffee", colour: "#8F5410" },
  cruise: { label: "Cruise", colour: "#1F5BBF" },
  show: { label: "Car Show", colour: "#6741C2" },
  track: { label: "Track Day", colour: "#B8301E" },
  autocross: { label: "Autocross", colour: "#0B726B" },
};

export const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.4 15.4c-.4.7.1 1.6.9 1.6h13.4c.8 0 1.3-.9.9-1.6L18 12.6V9a6 6 0 0 0-6-6zM9.8 18.6a2.3 2.3 0 0 0 4.4 0z" fill="currentColor"/></svg>';

export const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Only https links from the file, never anything else it might hold. */
export const safeURL = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : "");
const miles = usesMiles(navigator.language || "en-US");

export function kindOf(ev) { return KINDS[ev.kind] || KINDS.show; }

export function icon(kind, cls = "") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[kind] || ICONS.show}</svg>`;
}

/** Closed to the public: the routine's flag, else the name, or "closed to the public" in its words (build_event_pages.py members_only). */
export function membersOnly(ev) {
  if (typeof ev.membersOnly === "boolean") return ev.membersOnly;
  return /members?[- ]only|closed to the public/i.test(ev.name || "") || /closed to the public/i.test(ev.about?.text || "");
}

/** Repeats of one event: the same name at the same place (build_event_pages.py series_key). */
export function seriesKey(ev) {
  if (ev.series) return String(ev.series);
  const name = String(ev.name || "").replace(/\s+/g, " ").trim().toLowerCase();
  return `${name}|${Number(ev.lat).toFixed(2)}|${Number(ev.lon).toFixed(2)}`;
}

/** One result per repeating event, its next date (the user, 2026-11-03). */
function oneEach(events, now = new Date()) {
  const first = new Map();
  for (const ev of events) {
    const n = nextOn(ev, now);
    if (!n) continue;
    const key = seriesKey(ev), had = first.get(key);
    if (!had || n.start < nextOn(had, now).start) first.set(key, ev);
  }
  const keep = new Set(first.values());
  return events.filter((ev) => keep.has(ev) || !nextOn(ev, now));
}

let loading = null;
/** The events, once per page, repeats folded; an empty list if the file can't be had. */
export function loadEvents() {
  loading ||= fetch(EVENTS_URL).then((r) => (r.ok ? r.json() : { events: [] }))
    .then((d) => oneEach((Array.isArray(d?.events) ? d.events : []).filter((ev) => Number.isFinite(ev.lat) && Number.isFinite(ev.lon) && ev.token)))
    .catch(() => []);
  return loading;
}

/** Its next date that hasn't ended: {start, end} as Dates, or null. */
export function nextOn(ev, now = new Date()) {
  for (const n of ev.next || []) {
    const start = new Date(n.start), end = new Date(n.end || n.start);
    if (!Number.isNaN(start.getTime()) && end > now) return { start, end };
  }
  return null;
}

/** On within the next `days` days (or on now). */
export function within(ev, days, now = new Date()) {
  const n = nextOn(ev, now);
  return !!n && n.start - now < days * 864e5;
}

const fmt = (ev, opts) => new Intl.DateTimeFormat("en-US", { timeZone: ev.timeZone || undefined, ...opts });
const timeText = (ev, d) => fmt(ev, { hour: "numeric", minute: "2-digit" }).format(d).replace(":00", "");

/** "Sun, Nov 8 at 8 AM"; just the day when the time isn't known. */
export function whenText(ev, n = nextOn(ev), { weekday = true } = {}) {
  if (!n) return "No dates listed";
  const day = fmt(ev, { ...(weekday ? { weekday: "short" } : {}), month: "short", day: "numeric" }).format(n.start);
  return ev.timeUnknown ? day : `${day} at ${timeText(ev, n.start)}`;
}

/** "8 AM to 11 AM" (or "" when the time isn't known). */
export function spanText(ev, n = nextOn(ev)) {
  if (!n || ev.timeUnknown) return "";
  const end = n.end > n.start ? ` to ${timeText(ev, n.end)}` : "";
  return `${timeText(ev, n.start)}${end}`;
}

/** The weekday and day, for a date tile. */
export function dateTile(ev, n = nextOn(ev)) {
  if (!n) return { weekday: "", day: "" };
  return { weekday: fmt(ev, { weekday: "short" }).format(n.start), day: fmt(ev, { day: "numeric" }).format(n.start) };
}

export const town = (ev) => String(ev.locality || "").split(",")[0].trim();

/** "2.1 mi" from a place ({lat, lon}), or "". */
export function distanceText(ev, place) {
  if (!place) return "";
  const d = km([place.lon, place.lat], [ev.lon, ev.lat]);
  const n = miles ? d / 1.609 : d;
  return `${n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.round(n)} ${miles ? "mi" : "km"}`;
}

export function distanceKm(ev, place) { return place ? km([place.lon, place.lat], [ev.lon, ev.lat]) : Infinity; }

export const pageOf = (ev) => `/e/${encodeURIComponent(ev.token)}`;

/** Soonest first among those on within `days` and `maxKm` of the place. */
export function nearby(events, place, { days = MAP_DAYS, maxKm = 160, count = 12 } = {}) {
  if (!place) return [];
  return events.filter((ev) => within(ev, days) && distanceKm(ev, place) <= maxKm)
    .sort((a, b) => nextOn(a).start - nextOn(b).start || distanceKm(a, place) - distanceKm(b, place))
    .slice(0, count);
}

// ── the picture: its photo, else its organizer's logo, else its circuit, else a poster ──

export function pictureHTML(ev, { compact = false } = {}) {
  const k = kindOf(ev);
  const img = safeURL(ev.image?.url);
  if (img) {
    // Always credit the photo (Commons licences need it). Cards are links already, so they carry the words; the event page links to the source.
    const by = escapeHTML(ev.image.credit || "");
    const who = !by ? "" : compact ? `<span class="evp-credit sm">${by}</span>`
      : `<span class="evp-credit">Photo: ${safeURL(ev.image.page) ? `<a href="${escapeHTML(ev.image.page)}" rel="nofollow noopener" target="_blank">${by}</a>` : by}</span>`;
    return `<span class="evp evp-photo"><img src="${escapeHTML(img)}" alt="" loading="lazy" data-ev-fallback>${who}</span>`;
  }
  const logo = safeURL(ev.logo?.url);
  if (logo && Array.isArray(ev.logo.crop) && ev.logo.crop.length === 4) {
    const bg = /^#[0-9a-f]{6}$/i.test(ev.logo.background || "") ? ev.logo.background : "#F2F2EE";
    return `<span class="evp evp-logo" style="background:${bg}"><span class="evp-trim" data-crop="${ev.logo.crop.map(Number).join(",")}">`
      + `<img src="${escapeHTML(logo)}" alt="" loading="lazy" data-ev-fallback></span></span>`;
  }
  if (Array.isArray(ev.circuit) && ev.circuit.length) return circuitHTML(ev, compact);
  return posterHTML(ev);
}

function circuitHTML(ev, compact) {
  const k = kindOf(ev);
  const d = ev.circuit.map((line) => line.filter((p) => p.length === 2)
    .map(([x, y], i) => `${i ? "L" : "M"}${(x * 100).toFixed(2)} ${(y * 100).toFixed(2)}`).join("")).join("");
  const w = compact ? 2.4 : 2;
  const id = `ck${Math.random().toString(36).slice(2, 8)}`;
  return `<span class="evp evp-circuit"><svg viewBox="-28 -28 156 156" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><pattern id="${id}" width="15.6" height="15.6" patternUnits="userSpaceOnUse" x="-28" y="-28"><rect width="7.8" height="7.8" fill="#fff" fill-opacity=".06"/><rect x="7.8" y="7.8" width="7.8" height="7.8" fill="#fff" fill-opacity=".06"/></pattern>
    <filter id="${id}b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${compact ? 2.2 : 3}"/></filter></defs>
    <rect x="-28" y="-28" width="156" height="156" fill="#000"/><rect x="-28" y="-28" width="156" height="156" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${k.colour}" stroke-width="${w * 4}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}b)" opacity=".9"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${w * 2}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}b)"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function posterHTML(ev) {
  const k = kindOf(ev);
  return `<span class="evp evp-poster" style="--k:${k.colour}">${icon(ev.kind, "evp-icon")}<span class="evp-town">${escapeHTML(town(ev))}</span></span>`;
}

/** After the pictures are in the page: trim each logo to its box; a picture that won't load gives way to the poster. */
export function finishPictures(root = document) {
  root.querySelectorAll(".evp-trim:not([data-done])").forEach((trim) => {
    trim.dataset.done = "1";
    const img = trim.querySelector("img");
    const fit = () => {
      const [x, y, w, h] = trim.dataset.crop.split(",").map(Number);
      const cw = img.naturalWidth * w, ch = img.naturalHeight * h;
      const box = trim.parentElement.getBoundingClientRect();
      if (!cw || !ch || !box.width || !box.height) return;
      // As wide as fits, up to 78% across and 52% down, like the app.
      const s = Math.min((box.width * 0.78) / cw, (box.height * 0.52) / ch);
      trim.style.width = `${(cw * s / box.width) * 100}%`;
      trim.style.height = `${(ch * s / box.height) * 100}%`;
      img.style.width = `${100 / w}%`;
      img.style.left = `${(-x / w) * 100}%`;
      img.style.top = `${(-y / h) * 100}%`;
      trim.classList.add("on");
    };
    if (img.complete && img.naturalWidth) fit(); else img.addEventListener("load", fit, { once: true });
  });
  root.querySelectorAll("img[data-ev-fallback]").forEach((img) => {
    img.removeAttribute("data-ev-fallback");
    img.addEventListener("error", () => {
      const pic = img.closest(".evp");
      const ev = pic && byToken.get(pic.closest("[data-ev]")?.dataset.ev);
      if (ev) pic.outerHTML = posterHTML(ev);
    }, { once: true });
  });
}

const byToken = new Map();

/** A square card, as the app's Nearby Events: the kind, the picture, the bell; the name and when · where · how far under it. */
export function cardHTML(ev, place) {
  byToken.set(ev.token, ev);
  const k = kindOf(ev);
  const bits = [membersOnly(ev) ? "Members only" : "", whenText(ev), town(ev), distanceText(ev, place)].filter(Boolean).map(escapeHTML).join(" · ");
  return `<a class="evc" href="${pageOf(ev)}" data-ev="${escapeHTML(ev.token)}">
    <span class="evc-pic">${pictureHTML(ev, { compact: true })}<span class="evc-kind" style="background:${k.colour}">${escapeHTML(k.label)}</span>`
    + `<span class="evc-bell" title="Remind me in the app">${BELL}<span class="visually-hidden">Reminders are in the app</span></span></span>
    <span class="evc-n">${escapeHTML(ev.name)}</span><span class="evc-m">${bits}</span></a>`;
}

/** A pin: a rounded square in the kind's colour, white edge, white icon. */
export function pinElement(ev) {
  byToken.set(ev.token, ev);
  const a = document.createElement("a");
  a.className = "evpin";
  a.href = pageOf(ev);
  a.style.background = kindOf(ev).colour;
  a.title = `${ev.name} · ${whenText(ev)}`;
  a.setAttribute("aria-label", `${kindOf(ev).label}: ${ev.name}, ${whenText(ev)}`);
  a.innerHTML = icon(ev.kind);
  return a;
}

/** The next two weeks' events as pins on a MapLibre map; returns them, to take off again. */
export async function addPins(map, { onOpen, newTab = false } = {}) {
  const events = (await loadEvents()).filter((ev) => within(ev, MAP_DAYS));
  return events.map((ev) => {
    const el = pinElement(ev);
    // The planner opens an event beside the plan, not in its place.
    if (newTab) { el.target = "_blank"; el.rel = "noopener"; }
    if (onOpen) el.addEventListener("click", (event) => { if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); onOpen(ev); } });
    return new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([ev.lon, ev.lat]).addTo(map);
  });
}

const APP_STORE = "https://apps.apple.com/app/carve-route-planner/id6808087716";

/** A phone, where /plan/ only says "Plan on a bigger screen" (plan.js). */
export const onPhone = () => window.matchMedia("(max-width: 699px)").matches;

export const onAndroid = () => /android/i.test(navigator.userAgent || "");

/**
 * Into the app at this event. iPhone: open.carve.run, another host than the
 * page's, so the app opens where it's installed (Safari won't for a link to
 * its own page); without it, the Worker offers the App Store and comes back
 * here. Android has no events yet (2026-11-03): its app page, never an
 * intent the app can't open.
 */
export function openInApp(ev) {
  const ua = navigator.userAgent || "";
  if (onAndroid()) {
    location.href = "/android/";
  } else if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    location.href = `https://open.carve.run/e/${encodeURIComponent(ev.token)}`;
  } else {
    location.href = window.carveStoreUrl ? window.carveStoreUrl(APP_STORE) : APP_STORE;
  }
}

/** The planner's front door, as the home page uses it: this event as the destination. On a phone, the app (the user, 2026-11-03). */
export function planThere(ev) {
  if (onPhone()) return openInApp(ev);
  try {
    sessionStorage.setItem("carve.plan.handoff", JSON.stringify({ kind: "stops", to: { name: ev.venue || ev.name, lat: ev.lat, lon: ev.lon }, at: Date.now() }));
  } catch {
    // No storage: the planner opens empty.
  }
  location.href = "/plan/";
}
