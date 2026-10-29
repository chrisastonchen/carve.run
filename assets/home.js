// The home page (the user, 2026-10-29): the great roads near the visitor,
// as cards (a row on a computer, a deck to swipe on a phone) and, on a
// computer, on a map beside a small front door to the planner. The door
// never plans anything itself: what's typed, dropped or pasted goes to
// /plan, which picks it up (sessionStorage "carve.plan.handoff", never the
// address bar). On a phone the three steps play the app's own clips.
import "/assets/site-bar.js";
import { level, lineOf } from "/plan/good-roads.js";
import { usesMiles } from "/plan/route-wire.js";
import { PLACE_KEY, guessPlace, km, store } from "/assets/where.js";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const WIDE = "(min-width: 900px)";
const HANDOFF_KEY = "carve.plan.handoff";
const NO_PHOTO = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#E3EBDA"/>'
  + '<path d="M18 92C46 36 70 98 98 50c14-24 32-6 44-26" fill="none" stroke="#6A4CFF" stroke-width="6" stroke-linecap="round"/></svg>');

const $ = (id) => document.getElementById(id);
const wide = () => window.matchMedia(WIDE).matches;
const miles = usesMiles(navigator.language || "en-US");
const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let roads = [];
let place = null;

// ── the drives near you ──────────────────────────────────────────────

function lengthText(r) {
  const m = r.m || 0;
  const n = miles ? m : m * 1.609;
  return `${n >= 20 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, "")} ${miles ? "mi" : "km"}`;
}

function awayText(r) {
  if (!place) return r.p || "";
  const d = km([place.lon, place.lat], lineOf(r)[0]) * 1.3; // by road, roughly
  const hours = d / 70;
  return hours < 0.4 ? "Right by you" : hours < 1 ? `${Math.round(hours * 60 / 5) * 5} min away` : `${Math.round(hours * 2) / 2} hr away`;
}

function nearest(count) {
  if (!place) {
    // No idea where: the legendary drives, those on the visitor's own continent first (by time zone).
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const home = /^America\//.test(zone) ? ([x, y]) => x < -50 && y > 14 : /^Australia\//.test(zone) ? ([x, y]) => x > 112 && y < -9
      : /^Pacific\/Auckland/.test(zone) ? ([x, y]) => x > 165 && y < -33 : () => false;
    const legends = roads.filter((r) => r.f);
    const mine = legends.filter((r) => home(lineOf(r)[0]));
    return (mine.length >= count ? mine : legends).sort((a, b) => (b.b || 0) - (a.b || 0)).slice(0, count);
  }
  const at = [place.lon, place.lat];
  const ranked = [...roads].sort((a, b) => km(at, lineOf(a)[0]) - km(at, lineOf(b)[0])).slice(0, count * 3);
  // A card is its photo: the nearest drives that have one, unless too few do.
  const pictured = ranked.filter((r) => r.i);
  return (pictured.length >= count ? pictured : ranked).slice(0, count);
}

function renderNear() {
  const list = $("near-list");
  const picks = nearest(wide() ? 4 : 8);
  list.classList.remove("loading");
  list.innerHTML = picks.map((r) => `<li><a href="/drives/${encodeURIComponent(r.s)}/">
    <span class="ph"><img src="${escapeHTML(r.i || NO_PHOTO)}" alt="" loading="lazy"></span>
    <span class="t"><span class="away">${escapeHTML(awayText(r))}</span><span class="n">${escapeHTML(r.n)}</span>
    <span class="m">${lengthText(r)}${r.lv ? ` · <span class="lv" style="color:${r.lv.colour}">${r.lv.title}</span>` : ""}${wide() ? ` · ${escapeHTML(awayText(r))}` : ""}</span></span></a></li>`).join("");
  $("near-title").textContent = place ? `Great drives near ${place.label === "you" ? "you" : place.label}` : "Legendary drives to start with";
  // The front door's start, from where we think they are: most people only type where to.
  const field = $("door-from");
  if (place && (!field.value || field.value === field.dataset.label)) {
    const label = place.label === "you" ? "My location" : place.label;
    Object.assign(field.dataset, { label, lat: String(place.lat), lon: String(place.lon) });
    field.value = label;
  }
  const chip = $("near-chip");
  chip.hidden = !place;
  if (place) $("near-name").textContent = place.label === "you" ? "you" : place.label;
}

// ── the map, on a computer ───────────────────────────────────────────

let map = null;
let popup = null;
let pointed = null;

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve();
  const css = Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/plan/vendor/maplibre-gl.css" });
  document.head.appendChild(css);
  return new Promise((done, fail) => {
    const tag = Object.assign(document.createElement("script"), { src: "/plan/vendor/maplibre-gl.js", onload: done, onerror: fail });
    document.head.appendChild(tag);
  });
}

function bigCard(r) {
  return `<div class="road-card"><img src="${escapeHTML(r.i || NO_PHOTO)}" alt="">
    <div><div class="n">${escapeHTML(r.n)}</div><div class="m">${(r.e || []).map(escapeHTML).join(" to ")} · ${lengthText(r)}${r.lv ? ` · <b style="color:${r.lv.colour}">${r.lv.title}</b>` : ""}</div></div>
    <a class="hb green" href="/plan/" data-plan="${escapeHTML(r.t)}">Plan a drive on this road</a>
    <a class="guide" href="/drives/${encodeURIComponent(r.s)}/">Read the drive guide</a></div>`;
}

function smallCard(r) {
  return `<div class="road-card small"><img src="${escapeHTML(r.i || NO_PHOTO)}" alt="">
    <div><div class="n">${escapeHTML(r.n)}</div><div class="m">${lengthText(r)}${r.lv ? ` · ${r.lv.title}` : ""}</div></div></div>`;
}

function show(r, html, sticky) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: sticky, closeOnClick: sticky, offset: 14, className: "road-pop", maxWidth: "320px" })
    .setLngLat(lineOf(r)[Math.floor(lineOf(r).length / 2)]).setHTML(html).addTo(map);
  popup.on("close", () => { if (popup?._sticky) popup = null; });
  popup._sticky = sticky;
}

let chosen = null;

function choose(r) {
  chosen = r.k;
  popup?.remove(); popup = null;
  light(r.k);
  const line = lineOf(r);
  const b = line.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [180, 90, -180, -90]);
  // The road in the open space between the hero's card and the road's card.
  const panel = $("road-panel");
  panel.innerHTML = `<button type="button" class="x" aria-label="Close">×</button>${bigCard(r)}`;
  panel.hidden = false;
  const pad = heroPadding();
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { ...pad, top: 70, bottom: 50, right: panel.offsetWidth + 48 }, maxZoom: 13, duration: 900 });
}

function unchoose() {
  chosen = null;
  $("road-panel").hidden = true;
  light(null);
}

function light(k) {
  if (k == null && chosen != null) k = chosen;
  if (pointed === k) return;
  for (const source of ["home-roads", "home-mids"]) {
    if (pointed != null) map.setFeatureState({ source, id: pointed }, { on: false });
    if (k != null) map.setFeatureState({ source, id: k }, { on: true });
  }
  pointed = k;
}

/// The map shows its roads beside the card that floats over its left side.
function heroPadding() {
  const card = document.querySelector(".hero-copy").getBoundingClientRect();
  const box = $("hero-map").getBoundingClientRect();
  return { top: 80, bottom: 40, left: Math.max(40, card.right - box.left + 40), right: 50 };
}

function fitNear() {
  if (!place && map) { map.fitBounds([[-125, 25], [-67, 49]], { padding: heroPadding(), duration: 0 }); return; }
  const near = nearest(25);
  if (!near.length || !map) return;
  const b = near.map((r) => lineOf(r)).flat().reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: heroPadding(), maxZoom: 7.5, duration: 0 });
}

async function buildMap() {
  try { await loadMapLibre(); } catch { return; }
  map = new maplibregl.Map({
    container: "hero-map", style: MAP_STYLE, center: [-98, 39], zoom: 3.4, minZoom: 3, maxZoom: 14,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  // A road's card opens it in the planner: its Carve link, handed over like a pasted one.
  $("road-panel").addEventListener("click", (event) => { if (event.target.closest(".x")) unchoose(); });
  $("hero-map").addEventListener("click", (event) => {
    const link = event.target.closest("[data-plan]");
    if (!link) return;
    event.preventDefault();
    handOff({ kind: "link", url: `https://carve.run/${link.dataset.plan}` });
  });
  map.on("load", () => {
    map.addSource("home-roads", { type: "geojson", data: {
      type: "FeatureCollection",
      features: roads.map((r) => ({ type: "Feature", id: r.k, properties: { k: r.k }, geometry: { type: "LineString", coordinates: lineOf(r) } })),
    } });
    // Zoomed out, a dot for each drive, as Explore shows them; zoomed in, its road.
    map.addSource("home-mids", { type: "geojson", data: {
      type: "FeatureCollection",
      features: roads.map((r) => ({ type: "Feature", id: r.k, properties: { k: r.k }, geometry: { type: "Point", coordinates: lineOf(r)[Math.floor(lineOf(r).length / 2)] } })),
    } });
    const on = (a, b) => ["case", ["boolean", ["feature-state", "on"], false], a, b];
    map.addLayer({ id: "home-glow", type: "line", source: "home-roads", minzoom: 7, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#6A4CFF", "line-width": on(16, 0), "line-blur": 6, "line-opacity": on(0.45, 0) } });
    map.addLayer({ id: "home-casing", type: "line", source: "home-roads", minzoom: 7, layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#fff", "line-width": on(9, 6), "line-opacity": 0.85 } });
    map.addLayer({ id: "home-line", type: "line", source: "home-roads", minzoom: 7, layout: { "line-join": "round" },
      paint: { "line-color": "#6A4CFF", "line-width": on(5, 3), "line-dasharray": ["literal", [2, 1.6]], "line-opacity": on(1, 0.8) } });
    map.addLayer({ id: "home-dots", type: "circle", source: "home-mids", maxzoom: 7,
      paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, on(6, 3.5), 7, on(8, 5.5)], "circle-color": "#6A4CFF",
        "circle-stroke-color": "#fff", "circle-stroke-width": on(2, 1.2) } });
    map.addLayer({ id: "home-hit", type: "line", source: "home-roads", minzoom: 7, paint: { "line-color": "#000", "line-width": 18, "line-opacity": 0.01 } });
    map.addLayer({ id: "home-dot-hit", type: "circle", source: "home-mids", maxzoom: 7, paint: { "circle-radius": 12, "circle-opacity": 0.01 } });
    fitNear();
    for (const layer of ["home-hit", "home-dot-hit"]) {
      map.on("mousemove", layer, (event) => {
        map.getCanvas().style.cursor = "pointer";
        const k = event.features[0].properties.k;
        if (pointed === k) return;
        light(k);
        if (k !== chosen) show(roads[k], smallCard(roads[k]), false);
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
        popup?.remove(); popup = null;
        light(chosen);
      });
      // Clicking a road zooms to the whole of it and shows its card beside it,
      // its photo first; the planner is a click on the card away.
      map.on("click", layer, (event) => choose(roads[event.features[0].properties.k]));
    }
  });
}

// ── the front door to the planner ────────────────────────────────────

function handOff(what) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...what, at: Date.now() }));
  } catch {
    // Too big to keep (a huge GPX) or no storage: the planner opens empty.
  }
  location.href = "/plan/";
}

function wireDoor() {
  const tabs = [$("tab-plan"), $("tab-bring")];
  const panes = [$("pane-plan"), $("pane-bring")];
  tabs.forEach((tab, i) => tab.addEventListener("click", () => {
    tabs.forEach((t, j) => t.setAttribute("aria-selected", String(i === j)));
    panes.forEach((p, j) => { p.hidden = i !== j; });
  }));
  $("pane-plan").addEventListener("submit", (event) => {
    event.preventDefault();
    const fromText = $("door-from").value.trim(), to = $("door-to").value.trim();
    // The start filled in from where we think they are goes as the place itself, no search.
    const field = $("door-from");
    const from = field.dataset.lat && fromText === field.dataset.label
      ? { name: fromText, lat: Number(field.dataset.lat), lon: Number(field.dataset.lon) } : fromText;
    if (!fromText && !to) { location.href = "/plan/"; return; }
    handOff({ kind: "stops", from, to });
  });
  const err = (text) => { $("door-err").textContent = text; $("door-err").hidden = !text; };
  const takeFile = (file) => {
    if (!file) return;
    if (!/\.gpx$/i.test(file.name)) { err("That isn't a GPX file. Ride with GPS, Garmin and most apps can export one."); return; }
    if (file.size > 3_000_000) { err("That file is too big to bring along. Open it in the planner's Import tab instead."); return; }
    const reader = new FileReader();
    reader.onload = () => handOff({ kind: "gpx", name: file.name, text: String(reader.result) });
    reader.readAsText(file);
  };
  $("door-file").addEventListener("change", (event) => takeFile(event.target.files[0]));
  const drop = $("door-drop");
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("over"); takeFile(event.dataTransfer.files[0]); });
  $("door-paste").addEventListener("submit", (event) => {
    event.preventDefault();
    const url = $("door-link").value.trim();
    if (!/^https?:\/\/(?:[\w-]+\.)*(?:google\.[a-z.]+|goo\.gl|ridewithgps\.com|carve\.run)\//i.test(url)) {
      err("Paste a link from Google Maps, Ride with GPS or Carve.");
      return;
    }
    handOff({ kind: "link", url });
  });
}

// ── the place ────────────────────────────────────────────────────────

function locate() {
  if (!navigator.geolocation) { location.href = "/drives/"; return; }
  navigator.geolocation.getCurrentPosition((at) => {
    place = { lat: at.coords.latitude, lon: at.coords.longitude, label: "you" };
    store.set(PLACE_KEY, place);
    renderNear();
    fitNear();
  }, () => { location.href = "/drives/"; }, { timeout: 10000, maximumAge: 600000 });
}

// ── the app's clips, on a phone ──────────────────────────────────────

function wireClips(box) {
  const scenes = box.dataset.clips.split("|").map((s) => { const [name, caption] = s.split(":"); return { name, caption }; });
  box.innerHTML = `<div class="frame"><img class="still" alt="" src="/assets/${scenes[0].name}-first.jpg"><video muted playsinline preload="none" aria-hidden="true"></video></div>
    <span class="cap"></span><div class="dots">${scenes.map((s, i) => `<button type="button" aria-label="${escapeHTML(s.caption)}"></button>`).join("")}</div>`;
  const still = box.querySelector(".still"), video = box.querySelector("video"), cap = box.querySelector(".cap");
  const dots = [...box.querySelectorAll(".dots button")];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let at = 0, visible = false;
  const go = (i) => {
    at = (i + scenes.length) % scenes.length;
    const s = scenes[at];
    cap.textContent = s.caption;
    dots.forEach((d, j) => d.setAttribute("aria-current", String(j === at)));
    video.classList.remove("on");
    still.src = `/assets/${s.name}-${reduce ? "last" : "first"}.jpg`;
    if (reduce) return;
    video.src = `/assets/${s.name}.mp4`;
    if (visible) video.play().catch(() => {});
  };
  video.addEventListener("playing", () => video.classList.add("on"));
  video.addEventListener("ended", () => go(at + 1));
  video.addEventListener("error", () => setTimeout(() => go(at + 1), 2500));
  dots.forEach((d, i) => d.addEventListener("click", () => go(i)));
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (reduce) return;
    if (visible) { if (!video.getAttribute("src")) go(at); else video.play().catch(() => {}); }
    else video.pause();
  }, { threshold: 0.4 }).observe(box);
  cap.textContent = scenes[0].caption;
  dots[0].setAttribute("aria-current", "true");
}


// ── the three steps, played in turn ──────────────────────────────────
// Each scene rests as a picture; while the section is on screen they play
// one after another, 1, 2, 3, then rest a moment and go again. A scene is
// classes added on a timeline (home.css); the drive's cars move along its road.

const SCENES = {
  1: { length: 6800, cues: [[0, "run"], [500, "a"], [1300, "b"], [2900, "imp"], [3300, "o1"], [3550, "o2"], [3800, "o3"], [4500, "pick"]] },
  2: { length: 5600, cues: [[0, "run"], [500, "tap"], [700, "copied"], [1500, "send"], [2200, "m1"], [2550, "m2"], [2900, "m3"], [3800, "print"]] },
  3: { length: 8000, cues: [[0, "run"], [1400, "hz"], [4300, "ns"]] },
};

function placeCars(box, shift = 0) {
  const road = box.querySelector(".drive-route");
  if (!road) return;
  const length = road.getTotalLength();
  box.querySelectorAll(".car").forEach((car) => {
    const at = Math.min(0.97, Number(car.dataset.at) + shift);
    const p = road.getPointAtLength(at * length);
    car.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
  });
}

function playScene(box, scene) {
  return new Promise((done) => {
    const timers = scene.cues.map(([at, cls]) => setTimeout(() => box.classList.add(cls), at));
    let frame = 0;
    if (box.classList.contains("vis-drive")) {
      const start = performance.now();
      const tick = (now) => {
        const f = Math.min(1, (now - start) / scene.length);
        placeCars(box, 0.22 * Math.sin(f * Math.PI / 2));
        if (f < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    setTimeout(() => {
      timers.forEach(clearTimeout);
      cancelAnimationFrame(frame);
      box.classList.remove(...scene.cues.map(([, cls]) => cls));
      placeCars(box);
      done();
    }, scene.length);
  });
}

function wireSteps() {
  const boxes = [...document.querySelectorAll(".vis[data-step]")];
  boxes.forEach((box) => placeCars(box));
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  let visible = false, running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    while (visible) {
      for (const box of boxes) {
        if (!visible || box.offsetParent === null) continue;
        await playScene(box, SCENES[box.dataset.step]);
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
    running = false;
  };
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) loop();
  }, { threshold: 0.35 }).observe(document.querySelector(".steps"));
}

// ── start ────────────────────────────────────────────────────────────

function riseIn() {
  const items = document.querySelectorAll(".rise");
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    items.forEach((el) => el.classList.add("in"));
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -10% 0px", threshold: 0.12 });
  items.forEach((el) => io.observe(el));
}

async function main() {
  riseIn();
  wireDoor();
  wireSteps();
  $("near-change").addEventListener("click", locate);
  $("hero-locate").addEventListener("click", locate);
  if (!wide()) document.querySelectorAll(".seq").forEach(wireClips);
  const [data, guess] = await Promise.all([
    fetch("/drives/roads.json").then((r) => r.json()).catch(() => []),
    guessPlace(),
  ]);
  roads = data.map((r, k) => Object.assign(r, { k, lv: level(r.b) })).filter((r) => lineOf(r).length > 1);
  roads.forEach((r, k) => { r.k = k; });
  place = guess;
  renderNear();
  if (wide()) buildMap();
}

main();
