// A shared route's plan (carve.run/<token>): when the route's maker has set
// a leave time, a card at the top of the share page, as the app has it:
// "Sam invites you to this drive", the time, the route's note, who's
// in, and Going? Yes · No · Maybe. Only Yes answers are ever shown, to
// anyone; names only to someone signed in, a count to everyone else.
// Answering needs a Carve account: signed out, a button signs in over the
// page and comes back with the answer (?a=), which is sent then. With no
// plan on, only the note shows, if there is one. plan_view and
// plan_answer: migration 0046.
import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=517867446e";

const TOKEN_SHAPE = /^([A-Za-z0-9]{10}|[0-9a-fA-F]{32})$/;
const ANSWERS = [["yes", "Yes"], ["no", "No"], ["maybe", "Maybe"]];
const FACES = 4;

// Where the share page finds it: the whole path, /r/<token>, or ?t=.
const params = new URLSearchParams(location.search);
const segments = location.pathname.split("/").filter(Boolean);
const token = (segments[0] === "r" ? segments[1] : segments[0]) || params.get("t") || "";
const asked = ANSWERS.some(([key]) => key === params.get("a")) ? params.get("a") : null;

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

/// The first `shown` names, then "and N others": "Sam, Priya and 3 others are in".
function namesLine(list, shown) {
  if (list.length === 1) return list[0] === "You" ? "You're in" : `${list[0]} is in`;
  const rest = list.length - shown;
  if (!rest) return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]} are in`;
  return `${list.slice(0, shown).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"} are in`;
}

/// Who said Yes, "You" first; null signed out (only the count is known then).
function yesNames(view) {
  if (!Array.isArray(view.people)) return null;
  const yes = view.people.filter((p) => p.answer === "yes");
  return [...yes.filter((p) => p.me).map(() => "You"), ...yes.filter((p) => !p.me).map(firstName)];
}

function faceHTML(p) {
  const url = String(p.avatar_url || "");
  if (/^https:\/\//.test(url)) return `<img class="sp-face" src="${escapeHTML(url)}" alt="" loading="lazy">`;
  return `<span class="sp-face" aria-hidden="true">${escapeHTML(firstName(p).slice(0, 1).toUpperCase())}</span>`;
}

const FAILURES = {
  plan_over: "This drive has happened.",
  removed: "The driver took you off this drive.",
  plan_full: "This drive is full.",
};
function failureText(failure) {
  const key = Object.keys(FAILURES).find((k) => String(failure?.message || "").includes(k));
  return key ? FAILURES[key] : "Couldn't send that. Check the connection and try again.";
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

/// As many first names as fit on the line, then "and N others are in".
function fitNames(node, list) {
  const line = node.querySelector(".sp-names");
  if (!line || !list?.length) return;
  for (let shown = list.length; shown >= 1; shown--) {
    line.textContent = namesLine(list, shown);
    if (line.scrollWidth <= line.clientWidth) return;
  }
}

let shownMessage = "";
let shownList = null;

function render(view, message = "") {
  shownMessage = message;
  const signedIn = Array.isArray(view.people);
  const mine = view.mine?.answer || null;
  const removed = !!view.mine?.removed;
  const list = yesNames(view);
  const lines = [];
  lines.push(view.is_host
    ? '<p class="sp-lead mine">Your drive</p>'
    : `<p class="sp-lead">${escapeHTML(firstName(view.host))} invites you to this drive</p>`);
  lines.push(`<h2 class="sp-when">${escapeHTML(whenText(view.starts_at))}</h2>`);
  lines.push(noteHTML());

  if (list?.length) {
    const faces = view.people.filter((p) => p.answer === "yes").sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0)).slice(0, FACES);
    lines.push(`<div class="sp-who"><span class="sp-faces">${faces.map(faceHTML).join("")}</span><span class="sp-names"></span></div>`);
  } else if (!signedIn && Number(view.yes) > 0) {
    const n = Number(view.yes);
    lines.push(`<div class="sp-who"><span class="sp-count">${n} ${n === 1 ? "person is" : "people are"} in</span></div>`);
  }

  if (removed) {
    lines.push(`<p class="sp-state">${FAILURES.removed}</p>`);
  } else if (view.is_host) {
    lines.push('<p class="sp-small">Change the time in the app.</p>');
  } else {
    const pills = ANSWERS.map(([key, label]) => {
      const on = mine === key;
      return `<button type="button" class="sp-pick${on ? " on" : ""}" data-answer="${key}" aria-pressed="${on}">${on ? '<span aria-hidden="true">✓</span>' : ""}${label}</button>`;
    }).join("");
    lines.push(`<div class="sp-going" role="group" aria-labelledby="sp-going-label"><span id="sp-going-label">Going?</span>${pills}</div>`);
    if (!signedIn) lines.push('<p class="sp-small">Answering needs a free Carve account.</p>');
  }
  if (message) lines.push(`<p class="sp-error" role="alert">${escapeHTML(message)}</p>`);

  const node = card();
  if (!node) return;
  node.className = "sp";
  node.innerHTML = lines.filter(Boolean).join("\n");
  shownList = list;
  fitNames(node, list);
  for (const button of node.querySelectorAll("[data-answer]")) {
    button.addEventListener("click", () => answer(view, button.dataset.answer));
  }
}

let resizing = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizing);
  resizing = requestAnimationFrame(() => {
    const node = document.getElementById("sp");
    if (node && shownList) fitNames(node, shownList);
  });
});

let current = null;

async function answer(view, choice) {
  if (!Array.isArray(view.people)) {
    // Signed out: sign in over the page, then come back here with the answer.
    const back = `/${token}?a=${choice}`;
    if (!window.carveSignIn?.({ returnTo: back })) location.href = "/plan/#sign-in";
    return;
  }
  for (const b of document.querySelectorAll("#sp [data-answer]")) b.disabled = true;
  try {
    const next = await call("plan_answer", { p_share_token: token, p_answer: choice });
    current = next || view;
    render(current);
    window.carveTrack?.("Plan answer", { answer: choice });
  } catch (failure) {
    // Over a day past its time, the plan's gone: just the note then.
    if (String(failure?.message || "").includes("plan_over")) {
      current = null;
      renderNote();
      return;
    }
    render(view, failureText(failure));
  }
}

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
  // The note comes with the route, which may land after the plan: put it in then.
  routeNote().then((text) => {
    note = text;
    if (!note) return;
    if (current) render(current, shownMessage);
    else renderNote();
  });
  // Before 0046 is live, or on any failure, plan_view just means no plan.
  current = await call("plan_view", { p_share_token: token }).catch(() => null);
  // Back from signing in with an answer to send.
  if (asked) {
    params.delete("a");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
  }
  if (!current) return renderNote();
  // Back from a sign-in that didn't finish (plan.js signInFailed).
  let failed = false;
  try {
    failed = sessionStorage.getItem("carve.signin.failed") === "1";
    sessionStorage.removeItem("carve.signin.failed");
  } catch {}
  render(current, failed ? "Sign-in didn't finish. Try again, or sign in another way." : "");
  if (asked && Array.isArray(current.people)
      && !current.is_host && !current.mine?.removed && current.mine?.answer !== asked) {
    await answer(current, asked);
  }
}

start();
