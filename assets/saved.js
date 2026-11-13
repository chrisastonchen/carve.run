// carve.run/saved/ (Chris, 11/13; club flow v11's bar): the routes this
// account made or saved (its own, the ones it made for its clubs, Carve's
// guides and other links it saved) and the events it set reminders for.
// /my-drives/ stays as it was, off the bar (DevOps, 11/13).

import { $, el, myOrgs, rpc, select, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { savedGroups, routeLine } from "/assets/saved-words.js?v=c0fb5de8b0";

const MOST = 500;
/// The clubs' drives looked through for their routes, at most.
const MOST_DRIVES = 30;
const narrow = window.matchMedia("(max-width: 699px)").matches;
// Miles in the US and the UK, as the planner's usesMiles.
const miles = () => /^en(-(US|GB))?$/i.test(navigator.language || "en-US");
const status = (text) => { $("s-status").textContent = text || ""; $("s-status").hidden = !text; };

/// The ids of the routes on this account's clubs' drives.
async function clubRoutes() {
  const ids = new Set();
  try {
    const orgs = await myOrgs();
    const drives = (await Promise.all(orgs.map((o) => rpc("org_drives", { p_org_id: o.id }).catch(() => [])))).flat().slice(0, MOST_DRIVES);
    const routes = await Promise.all(drives.map((d) => rpc("drive_routes", { p_drive_id: d.id }).catch(() => [])));
    for (const r of routes.flat()) if (r?.route_id) ids.add(r.route_id);
  } catch {}
  return ids;
}

function row(route, catalog) {
  const li = el("li", "v-drive-row");
  const opened = [route.opened, route.follows].filter(Boolean);
  const slug = opened.map((t) => catalog[t]).find(Boolean);
  const token = opened[0];
  const a = el("a", "v-drive");
  // A computer opens it in the planner; a phone, its page (Carve opens it if installed).
  a.href = narrow && token ? `https://open.carve.run/${encodeURIComponent(token)}?then=page&ct=saved` : slug && narrow ? `/drives/${encodeURIComponent(slug)}/` : `/plan/?route=${encodeURIComponent(route.id)}`;
  const words = el("span", "v-drive-words");
  words.append(el("b", "", route.name || "Untitled route"), el("span", "", routeLine(route, miles())));
  a.append(words);
  li.append(a);
  if (slug) {
    const guide = el("a", "textlink", "Guide");
    guide.href = `/drives/${encodeURIComponent(slug)}/`;
    li.append(guide);
  }
  return li;
}

function eventRow(save, tokens) {
  const li = el("li", "v-drive-row");
  const token = tokens.get(String(save.event_id));
  const a = el(token ? "a" : "span", "v-drive");
  if (token) a.href = `/e/${encodeURIComponent(token)}`;
  const date = new Date(save.starts_at);
  const words = el("span", "v-drive-words");
  const when = `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  words.append(el("b", "", save.name || "A car event"), el("span", "", [when, save.place].filter(Boolean).join(" · ")));
  a.append(words);
  li.append(a);
  return li;
}

async function savedEvents() {
  const now = new Date().toISOString();
  let events = { EVENTS_URL: null };
  try { events = await import("/assets/events.js?v=bb6f2616de"); } catch {}
  const [saved, data] = await Promise.all([
    select("event_saves", `select=event_id,name,kind,place,starts_at&hidden=is.false&starts_at=gt.${encodeURIComponent(now)}&order=starts_at.asc`).catch(() => []),
    events.EVENTS_URL ? fetch(events.EVENTS_URL).then((r) => (r.ok ? r.json() : { events: [] })).catch(() => ({ events: [] })) : { events: [] },
  ]);
  return { saved: Array.isArray(saved) ? saved : [], tokens: new Map((data.events || []).map((ev) => [String(ev.id), ev.token])) };
}

async function start() {
  if (!(await signedIn())) {
    status("");
    $("s-signin").hidden = false;
    $("s-new").hidden = true;
    $("s-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: "/saved/" }));
    return;
  }
  let routes;
  const query = `select=id,name,distance_meters,duration_seconds,stop_count,updated_at,opened:payload->>shareToken,follows:payload->>followsShareToken&deleted_at=is.null&order=updated_at.desc&limit=${MOST}`;
  const [found, club, catalog, events] = await Promise.all([
    select("routes", query).catch((failure) => failure),
    clubRoutes(),
    fetch("/drives/tokens.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    savedEvents(),
  ]);
  if (found instanceof Error) return status(found.code === "sign_in" ? "Please sign in again." : "Couldn't load what you saved. Check the connection and reload.");
  routes = Array.isArray(found) ? found : [];
  status("");
  const groups = savedGroups(routes, club, catalog);
  $("s-routes").replaceChildren(...groups.map((g) => {
    const section = el("section", "cv-list");
    const h = el("h2", "cd-lbl", g.title);
    const list = el("ul", "cd-rows");
    list.append(...g.routes.map((r) => row(r, catalog)));
    section.append(h, list);
    return section;
  }));
  $("s-events").hidden = !events.saved.length;
  $("s-event-list").replaceChildren(...events.saved.map((s) => eventRow(s, events.tokens)));
  const none = !routes.length && !events.saved.length;
  $("s-empty").hidden = !none;
  // One Plan a route: the empty state's, not the band's too.
  $("s-new").hidden = none;
}

start();
