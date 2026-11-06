// An event's page (/e/<token>, scripts/events/build_event_pages.py): the
// page holds the event's data; this draws the picture, the map with its pin,
// how far it is, the dates still to come, and the buttons.
import "/assets/site-bar.js?v=7ba2c7c7a9";
import { guessPlace } from "/assets/where.js?v=5c9e34f7e8";
import {
  distanceText, escapeHTML, finishPictures, icon, kindOf, membersOnly, nextOn, onAndroid, onPhone, openInApp, pictureHTML, pinElement, planThere, safeURL,
  spanText, whenText,
} from "/assets/events.js?v=bb6f2616de";

const LIGHT_DEVICE = !window.matchMedia("(prefers-color-scheme: dark)").matches;
const MAP_STYLE = LIGHT_DEVICE ? "https://tiles.openfreemap.org/styles/liberty" : "/assets/map-dark.json?v=a36458fffd";

const data = document.getElementById("event-data");
const ev = data ? JSON.parse(data.textContent) : null;

function upcoming(now = new Date()) {
  return (ev.next || []).map((n) => ({ start: new Date(n.start), end: new Date(n.end || n.start) })).filter((n) => n.end > now);
}

/** "today", "yesterday", or the date. */
function checkedText(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const then = new Date(y, m - 1, d), today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today - then) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Chinook Pass · 42 mi of road · 18 mi away" (build_event_pages.py road_line is the same). */
function roadLine(r) {
  const away = r.d < 1 ? "under a mile away" : `${r.d} mi away`;
  const length = r.m ? `${Math.round(r.m)} mi of road · ` : "";
  return `<a href="/drives/${r.s}/">${escapeHTML(r.n)}</a> <span>${length}${away}</span>`;
}

function render(place) {
  const k = kindOf(ev);
  const dates = upcoming();
  const n = dates[0] || null;
  const now = new Date();
  const where = [ev.venue, distanceText(ev, place) ? `${distanceText(ev, place)} away` : ev.locality].filter(Boolean).join(" · ");
  const when = n
    ? `<b>${escapeHTML(whenText(ev, n, { weekday: true }).replace(/ at .*/, ""))}${spanText(ev, n) ? `, ${escapeHTML(spanText(ev, n))}` : ""}</b>`
    : '<b class="evx-off">No dates to come</b>';
  const extra = [ev.repeats, n && n.start <= now ? "On now" : ""].filter(Boolean);
  const rows = [
    ["Cars", ev.cars], ["Cost", /^(none|null|unknown)$/i.test(String(ev.cost || "").trim()) ? null : ev.cost],
    ["Next dates", dates.length > 1 ? dates.slice(0, 4).map((d) => whenText(ev, d).replace(/ at .*/, "")).join(" · ") : null],
  ].filter(([, v]) => v).map(([t, v]) => [t, escapeHTML(v)]);
  // The same event's other dates, each its own page (build_event_pages.py otherDates).
  const others = (ev.otherDates || []).filter((o) => /^[A-Za-z0-9]{4,16}$/.test(o.token || "") && new Date(o.start) > now).slice(0, 6);
  if (others.length) {
    rows.push(["Other dates", others.map((o) => `<a href="/e/${o.token}">${escapeHTML(whenText(ev, { start: new Date(o.start) }).replace(/ at .*/, ""))}</a>`).join(" · ")]);
  }
  const closed = membersOnly(ev);
  // Carve's own words lead (build_event_pages.py summary); the organizer's follow, under their name.
  const about = ev.about?.text && ev.about.source !== "carve" ? "<h2>From the organizer</h2>" + String(ev.about.text).split(/\n\s*\n/).map((para) => para.trim()).filter(Boolean)
    .map((para) => `<p class="evx-about">${escapeHTML(para)}</p>`).join("")
    + (ev.about.source === "organizer" && safeURL(ev.about.page) ? `<p class="evx-from"><a href="${escapeHTML(ev.about.page)}" rel="nofollow noopener">From the organizer's page</a></p>` : "") : "";
  const roads = (ev.roads || []).filter((r) => /^[a-z0-9-]+$/.test(r.s || ""));
  const getting = ev.near || roads.length
    ? "<h2>Getting there</h2>" + (ev.near ? `<p class="evx-near">${escapeHTML(ev.near)}</p>` : "")
      + (roads.length ? `<p class="evx-near">Good roads nearby, with Carve's guides:</p><ul class="evx-roads">${roads.map((r) => `<li>${roadLine(r)}</li>`).join("")}</ul>` : "")
    : "";
  const register = safeURL(ev.registerUrl);
  const source = safeURL(ev.sourceUrl);
  const subject = encodeURIComponent(`Event: ${ev.name} (${ev.token})`);
  document.getElementById("evx").outerHTML = `<article class="evx" id="evx" data-ev="${escapeHTML(ev.token)}">
  <div class="evx-pic">${pictureHTML(ev)}</div>
  <span class="evx-kind" style="background:${k.colour}">${icon(ev.kind)}${escapeHTML(k.label)}</span>${closed ? '<span class="evx-members">Members only</span>' : ""}
  <h1>${escapeHTML(ev.name)}</h1>
  <p class="sub">${escapeHTML(where)}</p>
  <div class="evx-when">${when}${extra.map((x) => `<span>${escapeHTML(x)}</span>`).join("")}</div>
  ${closed ? '<p class="evx-closed">Members only: this event isn\'t open to the public.</p>' : ""}
  ${ev.summary ? `<p class="evx-summary">${escapeHTML(ev.summary)}</p>` : ""}
  ${rows.length ? `<dl>${rows.map(([t, v]) => `<dt>${t}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
  <div class="evx-actions">
    ${register ? `<a class="pill white" href="${escapeHTML(register)}" rel="nofollow noopener" target="_blank">Register with the Organizer ↗</a>` : ""}
    <button type="button" class="pill green" id="evx-plan">Plan a Drive There</button>
    <a class="pill grey" href="/e/${encodeURIComponent(ev.token)}" id="evx-app">Open in the app</a>
  </div>
  ${getting}
  ${about}
  <p class="evx-checked">Last checked ${escapeHTML(checkedText(ev.lastConfirmed))}${source ? ` · <a href="${escapeHTML(source)}" rel="nofollow noopener">organizer's page</a>` : ""}</p>
  <p class="evx-report"><a href="mailto:support@carve.run?subject=${subject}">Report a problem with this event</a></p>
</article>`;
  finishPictures(document);
  const plan = document.getElementById("evx-plan");
  // An Android phone: the app can't open an event yet, and /plan/ is for computers.
  if (onAndroid() && onPhone()) plan.hidden = true;
  else plan.addEventListener("click", () => planThere(ev));
  wireApp(document.getElementById("evx-app"));
}

/** Into the app (events.js openInApp), on an iPad. A phone's Plan a Drive There opens the app already; Android has no events in the app yet. */
function wireApp(a) {
  const ua = navigator.userAgent || "";
  const touch = /android|iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (!touch || onPhone() || onAndroid()) { a.hidden = true; return; }
  a.addEventListener("click", (event) => { event.preventDefault(); openInApp(ev); });
}

function buildMap() {
  if (!window.maplibregl) return;
  const map = new maplibregl.Map({
    container: "rv-map", style: MAP_STYLE, attributionControl: { compact: true },
    center: [ev.lon, ev.lat], zoom: 12.5, minZoom: 3, maxZoom: 17,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  const pin = pinElement(ev);
  pin.removeAttribute("href");
  pin.classList.add("big");
  new maplibregl.Marker({ element: pin, anchor: "center" }).setLngLat([ev.lon, ev.lat]).addTo(map);
  // The card covers the map's left on a computer: the pin sits in what's left.
  if (window.matchMedia("(min-width: 700px)").matches) map.jumpTo({ center: [ev.lon, ev.lat], padding: { left: 512, top: 0, right: 0, bottom: 0 } });
}

// On a phone, the route pages' "open in the app" bar, locked to the bottom
// (the user, 2026-11-04; route-view.css shows it). Closed, it stays closed for
// the visit, on every page with one. Android's app has no events yet: it gets Carve.
const BANNER_KEY = "carve.banner.closed";

function wireBanner() {
  const close = () => document.documentElement.classList.add("banner-closed");
  try { if (sessionStorage.getItem(BANNER_KEY)) close(); } catch {}
  const android = onAndroid();
  const bar = document.createElement("div");
  bar.className = "app-banner";
  bar.innerHTML = `<button type="button" class="x" aria-label="Close"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke-width="2.4" stroke-linecap="round"/></svg></button>`
    + `<a href="/e/${encodeURIComponent(ev.token)}"><img src="/assets/icon-128.png?v=87d1534580" alt="" width="40" height="40">`
    + `<span class="why">${android ? "Plan your drive<br>in the app" : "See this event<br>in the app"}</span><span class="open">${android ? "Get" : "Open"}</span></a>`;
  bar.querySelector(".x").addEventListener("click", () => {
    close();
    try { sessionStorage.setItem(BANNER_KEY, "1"); } catch {}
  });
  bar.querySelector("a").addEventListener("click", (event) => { event.preventDefault(); openInApp(ev); });
  document.querySelector(".rv")?.append(bar);
}

if (ev) {
  wireBanner();
  render(null);
  guessPlace().then((place) => { if (place) render(place); }).catch(() => {});
  if (window.maplibregl) buildMap(); else window.addEventListener("load", buildMap, { once: true });
}
