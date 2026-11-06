// A region's car events (carve.run/events/<region>/): the kind filters.
// The page lists every event without this; it only shows the filters and hides the rest.
//
// The hub (/events/): the events near where we think the visitor is, as
// cards, soonest first (the user, 2026-11-04: a real list, not only links).
import { KINDS, cardHTML, finishPictures, loadEvents, nearby, nextOn } from "/assets/events.js?v=bb6f2616de";
import { PLACE_KEY, guessPlace, km, store } from "/assets/where.js?v=5c9e34f7e8";

const NEAR_DAYS = 30;
const NEAR_COUNT = 24;

const bar = document.querySelector(".evr-kinds:not(#evr-near-kinds)");
if (bar) {
  bar.hidden = false;
  bar.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const kind = button.dataset.kind;
    for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button));
    for (const li of document.querySelectorAll(".evl")) li.hidden = Boolean(kind) && li.dataset.kind !== kind;
    for (const week of document.querySelectorAll(".evr-week")) week.hidden = !week.querySelector(".evl:not([hidden])");
  });
}

const $ = (id) => document.getElementById(id);
const near = $("evr-near");
if (near) nearYou();

async function nearYou() {
  const metros = (() => { try { return JSON.parse($("evr-metros").textContent); } catch { return []; } })();
  const [events, guess] = await Promise.all([loadEvents(), guessPlace().catch(() => null)]);
  let place = guess;
  let kind = "";

  const draw = () => {
    // Within 100 miles if there are any; else twice that; else the soonest anywhere.
    let list = place ? nearby(events, place, { days: NEAR_DAYS, maxKm: 160, count: NEAR_COUNT }) : [];
    if (place && !list.length) list = nearby(events, place, { days: NEAR_DAYS, maxKm: 320, count: NEAR_COUNT });
    const anywhere = !list.length;
    if (anywhere) {
      list = events.filter((ev) => nextOn(ev)).sort((a, b) => nextOn(a).start - nextOn(b).start).slice(0, 12);
    }
    const label = place && place.label && place.label !== "you" ? place.label : "you";
    $("evr-near-title").textContent = anywhere ? "Coming up across the US" : `Coming up near ${label}`;
    $("evr-near-none").hidden = !(place && anywhere);
    $("evr-near-none").textContent = place && anywhere ? `No car events near ${label} in the next ${NEAR_DAYS} days.` : "";
    $("evr-locate").hidden = !navigator.geolocation || label === "you" && !!place && !place.guessed;

    // The kinds here, as chips, when there's more than one.
    const kinds = [...new Set(list.map((ev) => ev.kind))].filter((k) => KINDS[k]);
    if (kind && !kinds.includes(kind)) kind = "";
    const chips = $("evr-near-kinds");
    chips.hidden = kinds.length < 2;
    chips.innerHTML = [["", "All", list.length], ...kinds.map((k) => [k, KINDS[k].label, list.filter((ev) => ev.kind === k).length])]
      .map(([k, name, n]) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${name} <span>${n}</span></button>`).join("");
    const shown = kind ? list.filter((ev) => ev.kind === kind) : list;
    $("evr-near-list").innerHTML = shown.map((ev) => `<li>${cardHTML(ev, anywhere ? null : place)}</li>`).join("");
    finishPictures($("evr-near-list"));

    // On to the metro's own page, when they're in one.
    const metro = place && !anywhere && metros.find(([, , lat, lon, miles]) => km([place.lon, place.lat], [lon, lat]) <= miles * 1.609);
    const more = $("evr-near-more");
    more.hidden = !metro;
    if (metro) { more.href = `/events/${metro[0]}/`; more.textContent = `All car events in ${metro[1]}`; }
    near.hidden = false;
  };

  $("evr-near-kinds").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    kind = button.dataset.kind;
    draw();
  });
  $("evr-locate").addEventListener("click", () => {
    $("evr-locate").disabled = true;
    navigator.geolocation.getCurrentPosition(
      (at) => {
        $("evr-locate").disabled = false;
        place = { lat: at.coords.latitude, lon: at.coords.longitude, label: "you" };
        store.set(PLACE_KEY, place);
        draw();
      },
      () => { $("evr-locate").disabled = false; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
  });
  draw();
}
