// A shared route's note, and a plan already set (carve.run/<token>): Free
// no longer schedules drives or asks Going (the user, 11/8; ~/Carve/
// backlog/Free-Plans-Removal.md). A plan made before that still shows its
// time, read only, until its day; nobody answers here any more, and no
// names or faces show. Otherwise only the route's note, if it has one.
// plan_view: migration 0046.
import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=a3869ea508";

const TOKEN_SHAPE = /^([A-Za-z0-9]{10}|[0-9a-fA-F]{32})$/;

// Where the share page finds it: the whole path, /r/<token>, or ?t=.
const params = new URLSearchParams(location.search);
const segments = location.pathname.split("/").filter(Boolean);
const token = (segments[0] === "r" ? segments[1] : segments[0]) || params.get("t") || "";

const escapeHTML = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const firstName = (p) => String(p?.display_name || p?.username || "Someone").trim().split(/\s+/)[0];

async function call(fn, body) {
  const bearer = (await accessToken()) || SUPABASE_KEY;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const failure = new Error(String(data?.message || response.status));
    failure.status = response.status;
    throw failure;
  }
  return data;
}

// ── words ──

/// "Sat, Nov 7 at 9 AM", in the visitor's own time zone.
function whenText(iso) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(at).replace(":00", "");
  return `${day} at ${time}`;
}

// ── the card ──

let note = "";

function card() {
  let node = document.getElementById("sp");
  if (!node) {
    node = document.createElement("section");
    node.id = "sp";
    node.setAttribute("aria-label", "The plan");
    const scroll = document.querySelector(".rv .scroll");
    if (!scroll) return null;
    scroll.insertBefore(node, scroll.firstChild);
  }
  return node;
}

function noteHTML() {
  return note ? `<p class="sp-note">“${escapeHTML(note)}”</p>` : "";
}

/// No plan on: the note on its own, or nothing.
function renderNote() {
  if (!note) return document.getElementById("sp")?.remove();
  const node = card();
  if (!node) return;
  node.className = "sp bare";
  node.innerHTML = noteHTML();
}

/// A plan already set: whose drive, when, and the note. Read only.
function render(view) {
  const lines = [
    view.is_host ? '<p class="sp-lead mine">Your drive</p>' : `<p class="sp-lead">${escapeHTML(firstName(view.host))}'s drive</p>`,
    `<h2 class="sp-when">${escapeHTML(whenText(view.starts_at))}</h2>`,
    noteHTML(),
  ];
  const node = card();
  if (!node) return;
  node.className = "sp";
  node.innerHTML = lines.filter(Boolean).join("\n");
}

let current = null;

/// The route's note, from the row the share page or route-view.js fetched.
function routeNote() {
  const take = (row) => {
    const text = row?.payload?.note;
    return typeof text === "string" ? text.trim().slice(0, 280) : "";
  };
  if (window.carveRouteRow) return Promise.resolve(take(window.carveRouteRow));
  return new Promise((resolve) => {
    window.addEventListener("carve:row", (event) => resolve(take(event.detail)), { once: true });
    // The share page's own fetch (its ready()) comes first, when it made one.
    window.addEventListener("carve:route", () => { if (window.carveRouteRow) resolve(take(window.carveRouteRow)); }, { once: true });
    // No row (the route couldn't be loaded): no note.
    setTimeout(() => resolve(take(window.carveRouteRow)), 15000);
  });
}

async function start() {
  if (!TOKEN_SHAPE.test(token)) return;
  // An answer link from before (?a=): nothing to answer now.
  if (params.has("a")) {
    params.delete("a");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
  }
  // The note comes with the route, which may land after the plan: put it in then.
  routeNote().then((text) => {
    note = text;
    if (!note) return;
    if (current) render(current);
    else renderNote();
  });
  // No plan (or before its day has passed, or any failure): just the note.
  current = await call("plan_view", { p_share_token: token }).catch(() => null);
  if (!current?.starts_at || new Date(current.starts_at).getTime() < Date.now() - 86_400_000) {
    current = null;
    return renderNote();
  }
  render(current);
}

start();
