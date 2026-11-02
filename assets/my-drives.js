// carve.run/my-drives/: the account's routes, newest first, from the app and
// the planner (the user, 2026-11-01: /plan/ opens on a new route, and the
// routes you made live here). On a computer each one opens in the planner
// to change; on a phone, its page, which opens it in the app.

const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
const SESSION_KEY = "carve.plan.session";
const MOST = 500;

const $ = (id) => document.getElementById(id);
const narrow = window.matchMedia("(max-width: 699px)").matches;

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

/// The planner's sign-in, fresh: the same rules as plan.js accessToken
/// (another tab's refresh wins; only Carve saying no signs out).
async function accessToken() {
  const session = store.get(SESSION_KEY);
  if (!session?.refresh_token) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
  } catch {
    return session.access_token;
  }
  if (!response.ok) {
    const now = store.get(SESSION_KEY);
    return now?.refresh_token && now.refresh_token !== session.refresh_token ? now.access_token : null;
  }
  const data = await response.json();
  store.set(SESSION_KEY, {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
  return data.access_token;
}

function status(text) {
  $("mine-status").textContent = text;
  $("mine-status").hidden = !text;
}

function empty(html) {
  const box = $("mine-empty");
  box.innerHTML = html;
  box.hidden = false;
  status("");
}

const APP_STORE = "https://apps.apple.com/app/carve-route-planner/id6808087716";
const isAndroid = /android/i.test(navigator.userAgent || "");

function signedOutView() {
  $("mine-sub").textContent = "Your routes, from the app and the planner.";
  if (narrow) {
    empty(`<p>Your drives are in the Carve app, under My Drives. Sign in to the planner on a computer to see them here too.</p>
      <a class="new" style="display:inline-flex" href="${isAndroid ? "/android/" : APP_STORE}">Get the App</a>`);
  } else {
    empty(`<p>Sign in to see the routes you've made in the app and the planner.</p>
      <a class="new" href="/plan/#sign-in">Sign in</a>`);
  }
}

const miles = (meters) => {
  const value = meters / 1609.344;
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} mi`;
};

function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/// The route's picture, as the app shows it: its photo, else its map (the
/// share link's, drawn by the Worker), else a plain tile.
const PHOTO_HOSTS = ["carve.run", "uvaabajzkzupecemzsug.supabase.co"];
function picture(route, share) {
  const box = document.createElement("div");
  box.className = "thumb";
  const photo = route.photo?.url;
  let src = null;
  try {
    const url = new URL(photo);
    if (url.protocol === "https:" && PHOTO_HOSTS.includes(url.hostname)) src = url.href;
  } catch {}
  if (!src && share) src = `/map/${share.token}.png`;
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = src;
    img.addEventListener("error", () => img.remove(), { once: true });
    box.append(img);
  }
  return box;
}

function row(route) {
  const share = (route.shares || []).find((s) => s.token && !s.revoked_at);
  const page = share ? `/${share.token}` : null;
  const edit = `/plan/?route=${encodeURIComponent(route.id)}`;
  const li = document.createElement("li");
  li.className = "drive-row";
  li.append(picture(route, share));
  const what = document.createElement("div");
  what.className = "what";
  const name = document.createElement(narrow && !page ? "span" : "a");
  name.className = "name";
  name.textContent = route.name || "Untitled drive";
  if (name.tagName === "A") name.href = narrow ? page : edit;
  const facts = document.createElement("span");
  facts.className = "facts";
  const stops = route.stop_count || 0;
  facts.textContent = [
    route.distance_meters > 0 ? miles(route.distance_meters) : null,
    route.duration_seconds > 0 ? duration(route.duration_seconds) : null,
    stops ? `${stops} stop${stops === 1 ? "" : "s"}` : null,
    `Updated ${when(route.updated_at)}`,
  ].filter(Boolean).join(" · ");
  what.append(name, facts);
  const acts = document.createElement("div");
  acts.className = "acts";
  const link = (label, href, cls) => {
    const a = document.createElement("a");
    a.textContent = label;
    a.href = href;
    if (cls) a.className = cls;
    acts.append(a);
  };
  link("Edit", edit, "edit");
  if (page) link(narrow ? "Open" : "View page", page);
  li.append(what, acts);
  return li;
}

async function load() {
  const token = await accessToken();
  if (!token) return signedOutView();
  const query = `select=id,name,distance_meters,duration_seconds,stop_count,updated_at,photo:payload->photo,shares(token,revoked_at)&deleted_at=is.null&order=updated_at.desc&limit=${MOST}`;
  let routes;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/routes?${query}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) return signedOutView();
    if (!response.ok) throw new Error();
    routes = await response.json();
  } catch {
    status("Couldn't load your drives. Check the connection and reload.");
    return;
  }
  if (!routes.length) {
    return empty(narrow
      ? "<p>No drives yet. Plan one in the Carve app, or on a computer at carve.run/plan.</p>"
      : `<p>No drives yet. Plan one here, or in the Carve app, and it shows up on this page.</p><a class="new" href="/plan/">Plan a route</a>`);
  }
  $("mine-sub").textContent = `${routes.length === MOST ? `Your ${MOST} newest routes` : `${routes.length} route${routes.length === 1 ? "" : "s"}`}, from the app and the planner.`;
  const list = $("drive-list");
  list.replaceChildren(...routes.map(row));
  list.hidden = false;
  status("");
}

load();
