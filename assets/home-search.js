// The home page's place fields search like the planner's rows (plan.js
// attachSearch): three letters and a pause, up to six places, one Search Box
// session per pick. Guests need the planner's pass, kept in the same place
// the planner keeps it, so a browser checks once for both pages.

import { session } from "/assets/site-bar.js";

const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
const TURNSTILE_SITE_KEY = "0x4AAAAAAFqn1SkCkqJfDpRa";
const FUNCTIONS = `${SUPABASE_URL}/functions/v1`;
const PASS_KEY = "carve.plan.pass";
const SEARCH_DELAY_MS = 300;
const SEARCH_MIN_CHARS = 3;

function readPass() {
  try {
    const kept = JSON.parse(localStorage.getItem(PASS_KEY) || "null");
    return kept && typeof kept.pass === "string" && kept.expires - 60 > Date.now() / 1000 ? kept.pass : null;
  } catch {
    return null;
  }
}

function signedInToken() {
  const token = session?.access_token;
  const expires = session?.expires_at;
  return token && (!expires || expires - 60 > Date.now() / 1000) ? token : null;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(true);
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => resolve(!!window.turnstile);
    script.onerror = () => resolve(false);
    document.head.append(script);
    setTimeout(() => resolve(!!window.turnstile), 10000);
  });
}

let widget = null;
function turnstileToken() {
  return loadTurnstile().then((ready) => ready && new Promise((resolve) => {
    const box = document.getElementById("bot-check");
    const done = (token) => { if (box) box.hidden = true; resolve(token); };
    try {
      if (widget !== null) window.turnstile.remove(widget);
      widget = window.turnstile.render("#bot-check-widget", {
        sitekey: TURNSTILE_SITE_KEY,
        appearance: "interaction-only",
        theme: "light",
        callback: done,
        "error-callback": () => done(null),
        "expired-callback": () => done(null),
        "before-interactive-callback": () => { if (box) box.hidden = false; },
      });
    } catch {
      done(null);
    }
  }));
}

let passOnItsWay = null;
function fetchPass() {
  passOnItsWay ??= (async () => {
    try {
      const token = await turnstileToken();
      if (!token) return null;
      const data = await post({ action: "pass", token }, SUPABASE_KEY);
      if (!data?.pass) return null;
      try { localStorage.setItem(PASS_KEY, JSON.stringify({ pass: data.pass, expires: data.expires })); } catch {}
      return data.pass;
    } finally {
      passOnItsWay = null;
    }
  })();
  return passOnItsWay;
}

async function post(body, bearer) {
  const response = await fetch(`${FUNCTIONS}/planner`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "search failed"), { data });
  return data;
}

async function planner(action, body) {
  const token = signedInToken();
  if (token) return post({ action, ...body }, token);
  const pass = readPass() || (await fetchPass());
  if (!pass) throw new Error("no pass");
  try {
    return await post({ action, ...body, pass }, SUPABASE_KEY);
  } catch (failure) {
    if (!failure.data?.needsPass) throw failure;
    try { localStorage.removeItem(PASS_KEY); } catch {}
    const fresh = await fetchPass();
    if (!fresh) throw failure;
    return post({ action, ...body, pass: fresh }, SUPABASE_KEY);
  }
}

/// A picked place is kept on the input (data-label/lat/lon), so the form can
/// hand the place itself to the planner; typing again forgets it.
export function attachPlaceSearch(input, near = () => null) {
  const field = input.closest(".field");
  let timer = 0, results = [], active = 0, list = null, query = "";
  let sessionId = crypto.randomUUID();

  const close = () => { list?.remove(); list = null; input.setAttribute("aria-expanded", "false"); };
  const choose = async (place) => {
    close();
    input.value = place.name;
    try {
      const data = Number.isFinite(place.lat) ? { place } : await planner("place", { id: place.id, session: sessionId });
      sessionId = crypto.randomUUID();
      Object.assign(input.dataset, { label: place.name, lat: String(data.place.lat), lon: String(data.place.lon) });
    } catch {
      // The planner searches the typed words again on arrival.
    }
  };
  const mark = () => list?.querySelectorAll("li[role=option]").forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  const show = () => {
    close();
    list = document.createElement("ul");
    list.className = "suggest";
    list.setAttribute("role", "listbox");
    if (!results.length) {
      const none = document.createElement("li");
      none.className = "none";
      none.textContent = "No places found";
      list.append(none);
    }
    results.forEach((place, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      const name = document.createElement("span");
      name.className = "n";
      const at = place.name.toLowerCase().indexOf(query.toLowerCase());
      if (at >= 0) {
        const b = document.createElement("b");
        b.textContent = place.name.slice(at, at + query.length);
        name.append(place.name.slice(0, at), b, place.name.slice(at + query.length));
      } else {
        name.textContent = place.name;
      }
      const where = document.createElement("span");
      where.className = "a";
      where.textContent = place.address || "";
      li.append(name, where);
      li.addEventListener("mousedown", (event) => { event.preventDefault(); choose(place); });
      li.addEventListener("mousemove", () => { active = i; mark(); });
      list.append(li);
    });
    field.append(list);
    input.setAttribute("aria-expanded", "true");
    mark();
  };

  input.setAttribute("autocomplete", "off");
  input.setAttribute("aria-autocomplete", "list");
  // A spinner at the field's end from the first letter that searches until
  // the places come (the user, 2026-10-30).
  const busy = (on) => field.classList.toggle("busy", on);
  input.addEventListener("input", () => {
    delete input.dataset.lat; delete input.dataset.lon; delete input.dataset.label;
    clearTimeout(timer);
    const typed = input.value.trim();
    if (typed.length < SEARCH_MIN_CHARS) { busy(false); return close(); }
    busy(true);
    timer = setTimeout(async () => {
      try {
        const at = near();
        const data = await planner("search", { query: typed, session: sessionId, ...(at ? { near: at } : {}) });
        if (input.value.trim() !== typed) return;
        busy(false);
        results = (data.places || []).slice(0, 6);
        active = 0;
        query = typed;
        show();
      } catch {
        if (input.value.trim() === typed) busy(false);
        close();
      }
    }, SEARCH_DELAY_MS);
  });
  input.addEventListener("keydown", (event) => {
    if (!list || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      mark();
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      close();
    }
  });
  input.addEventListener("blur", () => setTimeout(close, 120));
}

/// What the form hands the planner for a field: the picked place, or the words.
export function placeOf(input) {
  const text = input.value.trim();
  const { lat, lon, label } = input.dataset;
  return lat && text === label ? { name: text, lat: Number(lat), lon: Number(lon) } : text;
}
