// The pages a group drive's emails link to (Club-Sprint-Requirements.md §1;
// App Dev's contract §6): carve.run/a/<token> to answer Going?, carve.run/
// d/<token> for the drive's days, routes and your group, carve.run/u/<token>
// to stop a club's emails. No sign-in needed. The Worker serves these pages
// at those addresses; on a local preview the token can come as ?k=.
//
// Email scanners open every link in a message (Gmail, Outlook Safe Links),
// so nothing changes on a page load: the answer page preselects the emailed
// answer and a tap records it; the unsubscribe page acts on its button.

import { SUPABASE_KEY, SUPABASE_URL, SESSION_KEY, accessToken } from "/assets/carve-session.js?v=a3869ea508";
import { CLUB_V2 } from "/plan/club-flags.js?v=4";
import { linkEnded } from "/assets/link-ended.js?v=930ada191b";

const $ = (id) => document.getElementById(id);
const APP_STORE = "https://apps.apple.com/app/carve-route-planner/id6808087716?ct=drive-page";

/// The token in /a/<token>, /d/<token> or /u/<token> (never ?t=, which the
/// Worker reads as a route's share token).
export function tokenOf(location) {
  const parts = location.pathname.split("/").filter(Boolean);
  const fromPath = parts.length >= 2 && /^(test|[A-Za-z0-9_-]{6,64})$/.test(parts[1]) ? parts[1] : null;
  return fromPath || new URLSearchParams(location.search).get("k");
}

/// "2026-12-12" → "Saturday, December 12"; "07:30" → "7:30 AM". The drive's
/// own zone's day and clock, shown as they are.
export const dayText = (date, style = "long") => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, style === "long"
    ? { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }
    : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
export const timeText = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
};

class Failure extends Error {}

async function rpc(name, body, { signedIn = false } = {}) {
  const token = signedIn && localStorage.getItem(SESSION_KEY) ? await accessToken().catch(() => null) : null;
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token || SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const words = {
      not_found: "This link isn't working any more. Ask the organizer for a new one.",
      bad_input: "That drive is over or was cancelled, so answers are closed.",
      claimed: "This invitation is already on another Carve account.",
      sign_in: "Please sign in again.",
      closed: "This drive is over or was cancelled, so its link has ended.",
      bad_code: "That code isn't right, or it's expired. Check the email and try again.",
    };
    const failure = new Failure(words[data?.message] || "Something went wrong. Try again.");
    failure.code = data?.message;
    throw failure;
  }
  return data;
}

const CODE_WORDS = {
  sign_in: "Please sign in again.",
  closed: "This drive is over or was cancelled, so its link has ended.",
  not_found: "This link isn't working any more. Ask the organizer for a new one.",
  rate_limited: "Too many codes asked for. Wait a few minutes and try again.",
  bad_code: "That code isn't right, or it's expired. Check the email and try again.",
};

/// POST /functions/v1/drive-code (App Dev's 0085), signed in: a 6-digit code
/// by email. Refusals are {error: code} with 401, 400, 403, 404, 429, 502, 503.
async function sendCode(body) {
  const token = localStorage.getItem(SESSION_KEY) ? await accessToken().catch(() => null) : null;
  if (!token) { const f = new Failure(CODE_WORDS.sign_in); f.code = "sign_in"; throw f; }
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/drive-code`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.sent) {
    const code = data?.error || (response.status === 401 ? "sign_in" : response.status === 429 ? "rate_limited" : null);
    const failure = new Failure(CODE_WORDS[code] || "Couldn't send the code. Try again.");
    failure.code = code;
    throw failure;
  }
  return data;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function status(text) {
  $("cp-status").textContent = text || "";
  $("cp-status").hidden = !text;
}

/// Spots left on a day, for an invitation: "6 spots left", or full.
export const spotsLeftText = (n) => (!Number.isInteger(n) ? "" : n <= 0 ? "Full: a yes joins the waitlist." : n === 1 ? "1 spot left" : `${n} spots left`);

/// A day, as the pages list it: when, where, and its routes. An invitation
/// (the user, 11/8 late: invited people don't see the route) has the meet
/// time and city and spots left, never the place, routes or calendar.
function dayItem(day, { routes = true, calendarFor = null, invitation = false } = {}) {
  const li = el("li", "cp-day");
  li.append(el("b", "", dayText(day.date)));
  if (invitation) {
    const city = day.meet_city || day.city;
    li.append(el("span", "", `Meet at ${timeText(day.meet)}${city ? ` in ${city}` : ""}`));
    const left = spotsLeftText(day.spots_left);
    if (left) li.append(el("span", "cp-left", left));
    return li;
  }
  // No place yet: the time, and the city when there is one (QA, 11/9).
  const city = day.meet_city || day.city;
  li.append(el("span", "", day.place?.name ? `Meet at ${timeText(day.meet)}: ${day.place.name}` : `Meet at ${timeText(day.meet)}${city ? ` in ${city}` : ""}`));
  li.append(el("span", "", `Leave at ${timeText(day.leave)}`));
  if (routes && day.routes?.length) {
    const list = el("ul", "cp-routes");
    day.routes.forEach((r, i) => {
      const item = el("li");
      item.append(el("span", "cp-route-name", r.label || (day.routes.length > 1 ? `Route ${i + 1}` : "The route")));
      const open = el("a", "", "Open in Carve");
      open.href = r.url;
      const print = el("a", "", "Printable directions");
      print.href = r.print_url;
      item.append(open, el("span", "dim", " · "), print);
      list.append(item);
    });
    li.append(list);
  }
  if (calendarFor) {
    const cal = el("a", "cp-cal", "Add to calendar");
    cal.href = `${SUPABASE_URL}/functions/v1/drive-calendar?d=${encodeURIComponent(calendarFor)}&day=${encodeURIComponent(day.id)}`;
    li.append(cal);
  }
  return li;
}

function getCarve(box) {
  const a = el("a", "go dark", "Get Carve for iPhone");
  a.href = APP_STORE;
  box.replaceChildren(a, el("p", "cp-note", "On Android? Use the printable directions, or open the route's link in a browser."));
}

/// A Send to Myself's links carry the token "test" (App Dev, 11/8): they
/// look like an attendee's but must never act for anyone.
const TEST_WORDS = "This is a test email, so nothing was changed. The people you send the drive to get their own links.";

// ── carve.run/a/<token>: Going? ──────────────────────────────────────

const ANSWER_WORDS = { yes: "Yes", maybe: "Maybe", no: "No" };
const STYLE_WORDS = [
  ["spirited", "Spirited", "Brisk and confident on twisty roads."],
  ["touring", "Touring", "A steady, flowing pace."],
  ["relaxed", "Relaxed", "Easy going, taking in the view."],
];

async function answerPage() {
  const token = tokenOf(location);
  if (!token) return status("This link is missing its code. Open it from the email again.");
  if (token === "test") return status(TEST_WORDS);
  const wanted = new URLSearchParams(location.search).get("r");
  let view;
  try {
    view = await rpc("answer_view", { p_token: token });
  } catch (failure) {
    return status(failure.message);
  }
  if (!view) return status("This link isn't working any more. Ask the organizer for a new one.");
  if (view.cancelled) return status(`${view.club_name} cancelled ${view.drive_name}.`);
  status("");
  document.title = `${view.drive_name} | Carve`;
  $("a-club").textContent = view.club_name;
  $("a-name").textContent = view.drive_name;
  renderAnswerDays(view);
  $("a-desc").textContent = view.description || "";
  $("a-desc").hidden = !view.description;
  $("cp-answer").hidden = false;
  // Which answer shows chosen: what they said, else what the email's button said.
  const said = view.status === "going" ? "yes" : view.status === "maybe" ? "maybe" : view.status === "no" ? "no" : null;
  const pick = said || (ANSWER_WORDS[wanted] ? wanted : null);
  renderChoice(pick, !!said, view);
  for (const b of document.querySelectorAll("#a-choices button")) {
    b.addEventListener("click", () => answer(b.dataset.r, token, view).then((next) => { if (next) view = next; }));
  }
  $("a-save").addEventListener("click", () => saveMore(token, view).then((next) => { if (next) view = next; }));
  bindOffer(token, view);
}

/// "Add to my account" (DevOps, 11/8): signed in, on an invitation not yet
/// this account's (answer_view's `mine`, 0066: bound to it, or its verified
/// email), bind the row with attendee_bind (0067), so Saved, the drive pass
/// and Notifications find it without a matching email.
function bindOffer(token, view) {
  let signedIn = false;
  try { signedIn = !!JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.refresh_token; } catch {}
  if (!signedIn || view.mine === true) return;
  $("a-bind").hidden = false;
  $("a-bind-go").addEventListener("click", async () => {
    $("a-bind-go").disabled = true;
    try {
      const bound = await rpc("attendee_bind", { p_token: token }, { signedIn: true });
      $("a-bind-go").hidden = true;
      // 0072: not bound when the account is already on this drive (another
      // invitation of theirs, under another email).
      $("a-bind-said").textContent = bound?.reason === "already_on_drive"
        ? "Your account is already on this drive, under another invitation. That one is in Saved."
        : bound?.already ? "It's already in your account." : "Added. It's in Saved, and its news shows in your notifications.";
    } catch (failure) {
      $("a-bind-said").textContent = failure.message;
      $("a-bind-go").disabled = false;
    }
  });
}

function renderChoice(pick, recorded, view) {
  for (const b of document.querySelectorAll("#a-choices button")) b.setAttribute("aria-pressed", String(b.dataset.r === pick));
  const registered = view.status === "registered";
  $("a-hint").textContent = recorded
    ? `You said ${ANSWER_WORDS[pick]}. You can change it until the drive.`
    : registered
      ? `${view.club_name} already has you down as going. Tap an answer if that's changed.`
      : pick
        ? `Tap ${ANSWER_WORDS[pick]} to send it.`
        : "Tap an answer to send it.";
}

/// The answer page is an invitation: city and time, never the place; and
/// each day's spots left, again after each answer (QA, 11/9: a Yes takes one).
function renderAnswerDays(view) {
  if (view?.days) $("a-days").replaceChildren(...view.days.map((d) => dayItem(d, { invitation: true })));
}

async function answer(r, token, view) {
  const buttons = [...document.querySelectorAll("#a-choices button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    const next = await rpc("answer_set", { p_token: token, p_answer: r });
    renderChoice(r, true, next);
    renderAnswerDays(next);
    showMore(r === "yes" ? next : null);
    showDone(next, r);
    return next;
  } catch (failure) {
    $("a-hint").textContent = failure.message;
    return null;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

/// After a Yes, the questions the organizer doesn't know yet (`asks`).
function showMore(view) {
  // A Group drive is one group (11/8 late): no driving style or first-time question.
  const asks = (view?.asks || []).filter((a) => !(view?.tier === "group" && (a === "style" || a === "first_timer")));
  $("a-more").hidden = !asks.length;
  if (!asks.length) return;
  $("a-style").hidden = !asks.includes("style");
  $("a-first").hidden = !asks.includes("first_timer");
  $("a-pick-days").hidden = !asks.includes("days") || view.days.length < 2;
  $("a-style-list").replaceChildren(...STYLE_WORDS.map(([key, label, words]) => {
    const row = el("label", "cp-option");
    const input = el("input");
    input.type = "radio";
    input.name = "style";
    input.value = key;
    input.checked = view.style === key;
    const text = el("span");
    text.append(el("b", "", label), el("small", "", words));
    row.append(input, text);
    return row;
  }));
  $("a-first-legend").textContent = `First drive with ${view.club_name}?`;
  for (const input of document.querySelectorAll('input[name="first"]')) input.checked = view.first_timer === (input.value === "yes");
  $("a-days-list").replaceChildren(...view.days.map((d) => {
    const row = el("label", "cp-option");
    const input = el("input");
    input.type = "checkbox";
    input.value = d.id;
    input.checked = (view.days_coming || view.days.map((x) => x.id)).includes(d.id);
    row.append(input, el("b", "", dayText(d.date)));
    return row;
  }));
}

async function saveMore(token, view) {
  const style = document.querySelector('input[name="style"]:checked')?.value || null;
  const first = document.querySelector('input[name="first"]:checked')?.value;
  const days = [...document.querySelectorAll("#a-days-list input:checked")].map((i) => i.value);
  if (!$("a-pick-days").hidden && !days.length) {
    $("a-more-said").textContent = "Pick at least one day, or answer No above.";
    return null;
  }
  $("a-save").disabled = true;
  try {
    const next = await rpc("answer_set", {
      p_token: token, p_answer: "yes",
      p_style: $("a-style").hidden ? null : style,
      p_first_timer: $("a-first").hidden || first === undefined ? null : first === "yes",
      p_days: $("a-pick-days").hidden ? null : days,
    });
    $("a-more").hidden = true;
    renderAnswerDays(next);
    showDone(next, "yes", true);
    return next;
  } catch (failure) {
    $("a-more-said").textContent = failure.message;
    return null;
  } finally {
    $("a-save").disabled = false;
  }
}

function showDone(view, r, thanked = false) {
  const box = $("a-done");
  box.hidden = false;
  const lines = [];
  if (r === "yes") {
    lines.push(thanked ? "Thanks. You're going." : "You're going.");
    const waiting = (view.waitlisted_days || []).map((id) => view.days.find((d) => d.id === id)).filter(Boolean);
    if (waiting.length) lines.push(`${waiting.length === view.days.length ? "The drive is full, so you're" : "You're"} on the waitlist for ${waiting.map((d) => dayText(d.date)).join(" and ")}. ${view.club_name} will let you know if a place opens.`);
    lines.push("Your group, lead and sweep come by email before the drive.");
  } else if (r === "maybe") {
    lines.push(`Maybe it is. ${view.club_name} will check in before the drive.`);
  } else {
    lines.push(`Got it: you can't make it. ${view.club_name} won't count you in.`);
  }
  $("a-done-text").replaceChildren(...lines.map((l) => el("p", "", l)));
  if (view.drive_token) {
    const a = $("a-open");
    a.hidden = false;
    a.href = `/d/${encodeURIComponent(view.drive_token)}?a=${encodeURIComponent(tokenOf(location))}`;
  }
  if (r === "yes") getCarve($("a-get")); else $("a-get").replaceChildren();
}

// ── carve.run/d/<token>: the drive ───────────────────────────────────

async function drivePage() {
  const token = tokenOf(location);
  if (!token) return status("This link is missing its code. Open it from the email again.");
  // Your answer token: from the email's link, or kept from an earlier visit.
  const key = `carve.drive.a.${token}`;
  const given = new URLSearchParams(location.search).get("a");
  let answerToken = given;
  try {
    if (given) localStorage.setItem(key, given);
    else answerToken = localStorage.getItem(key);
  } catch {}
  let page;
  try {
    page = await rpc("drive_page", { p_token: token, p_answer_token: answerToken || null }, { signedIn: true });
  } catch (failure) {
    return status(failure.message);
  }
  if (!page) return status("This link isn't working any more. Ask the organizer for a new one.");
  if (page.cancelled) return status(`${page.club_name} cancelled ${page.name}.`);
  status("");
  document.title = `${page.name} | Carve`;
  $("d-club").textContent = page.club_name;
  $("d-name").textContent = page.name;
  const you = page.you;
  // Invited, Maybe, Can't make it or waitlisted every day: the invitation
  // view only (11/8 late). The server withholds the place and routes from
  // them too; this is the page's side.
  const confirmed = you && (you.status === "going" || you.status === "registered") && (you.days || []).some((x) => x.coming && !x.waitlisted);
  if (you && !confirmed) return invitationView(page, you, answerToken);
  $("d-desc").textContent = page.description || "";
  $("d-desc").hidden = !page.description;
  $("d-days").replaceChildren(...page.days.map((d) => {
    const li = dayItem(d, { calendarFor: token });
    const mine = you?.days?.find((x) => x.day_id === d.id);
    // In a group, your own leave time is the group's: the day's is when the first goes.
    if (mine?.coming && !mine.waitlisted && mine.group) li.children[2].textContent = `Groups leave from ${timeText(d.leave)}`;
    if (mine && mine.coming) li.insertBefore(yourGroup(mine), li.children[1]);
    else if (mine && !mine.coming) li.insertBefore(el("p", "cp-mine dim", "You're not coming this day."), li.children[1]);
    return li;
  }));
  $("d-you").hidden = !you;
  if (you) $("d-you").textContent = `Hi ${you.name?.split(" ")[0] || "there"}: here's your drive.`;
  $("cp-drive").hidden = false;
  getCarve($("d-get"));
}

/// The drive page for someone invited and not going: the club, the drive,
/// the description, each day's city and time and spots left, and Going?.
function invitationView(page, you, answerToken) {
  $("d-days").replaceChildren(...page.days.map((d) => dayItem(d, { invitation: true })));
  $("d-desc").textContent = page.description || "";
  $("d-desc").hidden = !page.description;
  const waiting = (you.days || []).some((x) => x.waitlisted);
  $("d-you").hidden = false;
  $("d-you").textContent = waiting
    ? `Hi ${you.name?.split(" ")[0] || "there"}: you're on the waitlist. You'll get the meeting place and the route if a spot opens.`
    : `Hi ${you.name?.split(" ")[0] || "there"}: say Yes and you'll get the meeting place, the route and your group.`;
  $("d-answer").hidden = !answerToken;
  if (answerToken) $("d-answer").href = `/a/${encodeURIComponent(answerToken)}`;
  $("d-answer").textContent = you.status === "invited" ? "Going?" : "Change your answer";
  $("cp-drive").hidden = false;
  getCarve($("d-get"));
}

function yourGroup(mine) {
  const box = el("div", "cp-mine");
  if (mine.waitlisted) {
    box.append(el("b", "", "You're on the waitlist for this day."));
    return box;
  }
  if (!mine.group) {
    box.append(el("b", "", "Your group comes before the drive."));
    return box;
  }
  const label = mine.label ? ` (${mine.label.charAt(0).toUpperCase()}${mine.label.slice(1)})` : "";
  box.append(el("span", "cp-eyebrow", "Your group"), el("b", "", `Group ${mine.group}${label}, leaving at ${timeText(mine.leave)}`));
  const people = [mine.lead ? `Lead: ${mine.lead}` : "", mine.sweep ? `Sweep: ${mine.sweep}` : ""].filter(Boolean).join(" · ");
  if (people) box.append(el("span", "", people));
  if (mine.role) box.append(el("span", "", mine.role === "lead" ? "You're leading your group." : "You're the sweep: you drive last and keep the group together."));
  return box;
}

// ── carve.run/u/<token>: stop a club's emails ────────────────────────

async function unsubscribePage() {
  const token = tokenOf(location);
  if (!token) return status("This link is missing its code. Open it from the email again.");
  if (token === "test") return status(TEST_WORDS);
  let view;
  try {
    view = await rpc("unsubscribe_view", { p_token: token });
  } catch (failure) {
    return status(failure.message);
  }
  if (!view) return status("This link isn't working any more.");
  status("");
  $("cp-unsub").hidden = false;
  const done = (v) => {
    $("u-ask").hidden = true;
    $("u-done").hidden = false;
    $("u-done-text").textContent = `Done. ${v.club_name} won't email ${v.email} through Carve again.`;
  };
  if (view.unsubscribed) return done(view);
  $("u-text").textContent = `Stop emails from ${view.club_name} to ${view.email}? They come through Carve, for drives ${view.club_name} plans.`;
  $("u-go").textContent = `Stop emails from ${view.club_name}`;
  $("u-go").addEventListener("click", async () => {
    $("u-go").disabled = true;
    try {
      done(await rpc("unsubscribe", { p_token: token }));
    } catch (failure) {
      $("u-said").textContent = failure.message;
      $("u-go").disabled = false;
    }
  });
}

// ── carve.run/d/r/<token>: a drive's route link (Chris's option C) ────
// The route for anyone who opens it (link_view, no names). Check in to be
// on the organizer's list and get offline maps: only on a tap (pages never
// act on a GET), signed in, with a 6-digit email code when the account has
// no email (Apple). Skip still shows the route.

/// The token in /d/r/<token> (or ?k= on a local preview; never ?t=).
export function routeLinkTokenOf(location) {
  const parts = location.pathname.split("/").filter(Boolean);
  const fromPath = parts[0] === "d" && parts[1] === "r" && /^[A-Za-z0-9_-]{6,64}$/.test(parts[2] || "") ? parts[2] : null;
  const k = new URLSearchParams(location.search).get("k");
  return fromPath || (k && /^[A-Za-z0-9_-]{6,64}$/.test(k) ? k : null);
}

/// drive_checkin's answer as the page says it (App Dev's and DevOps's words, 11/9).
export function checkinWords(out) {
  if (out?.removed) return "The organizer has removed you from this drive's list. The route is below.";
  if (out?.waitlisted) return "You're checked in. The drive is full, so offline maps aren't included.";
  return "You're checked in. Open it in the Carve app for offline maps.";
}

async function routeLinkPage() {
  const token = routeLinkTokenOf(location);
  if (!token) return status("This link is missing its code. Ask the organizer for the link again.");
  let view;
  try {
    view = await rpc("link_view", { p_token: token });
  } catch (failure) {
    return status(failure.message);
  }
  if (!view) return status("This link isn't working any more. Ask the organizer for a new one.");
  if (view.expired) return status(`${view.drive?.name || "This drive"} is over, so its link has ended.`);
  status("");
  document.title = `${view.drive?.name || "Group drive"} | Carve`;
  $("r-club").textContent = view.club?.name || "";
  $("r-name").textContent = view.drive?.name || "Group drive";
  $("r-desc").textContent = view.drive?.description || "";
  $("r-desc").hidden = !view.drive?.description;
  $("r-days").replaceChildren(...(view.days || []).map((d) => dayItem(d)));
  $("cp-routelink").hidden = false;
  const iPhone = /iPhone|iPod/.test(navigator.userAgent);
  let signedIn = false;
  try { signedIn = !!JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.refresh_token; } catch {}
  $("r-check-out").hidden = signedIn;
  $("r-check-in").hidden = !signedIn;
  const skip = () => { $("r-check").hidden = true; };
  $("r-skip").addEventListener("click", skip);
  $("r-skip2").addEventListener("click", skip);
  const back = () => window.carveSignIn?.({ returnTo: location.pathname + location.search });
  $("r-create").addEventListener("click", back);
  $("r-signin").addEventListener("click", back);
  const said = (t) => { $("r-said").textContent = t || ""; };
  const done = (out) => {
    $("r-check").hidden = true;
    const box = $("r-done");
    box.hidden = false;
    box.replaceChildren(el("b", "", checkinWords(out)));
    if (!out?.removed && !out?.waitlisted) {
      // The app opens this same link; on iPhone without it, the App Store.
      const open = el("a", "go", "Open in the Carve app");
      open.href = location.href.replace(/\?.*$/, "");
      box.append(open);
      if (iPhone) {
        const store = el("a", "go dark", "Get Carve for iPhone");
        store.href = APP_STORE;
        box.append(store);
      }
    }
  };
  const failed = (failure) => {
    if (failure.code === "needs_email") {
      $("r-check-in").hidden = true;
      $("r-email").hidden = false;
      $("r-email-in").focus();
      return said("");
    }
    if (failure.code === "sign_in") { $("r-check-in").hidden = true; $("r-check-out").hidden = false; }
    said(failure.message);
  };
  $("r-go").addEventListener("click", async () => {
    $("r-go").disabled = true;
    said("Checking you in…");
    try {
      done(await rpc("drive_checkin", { p_route_link_token: token, p_name: null }, { signedIn: true }));
    } catch (failure) {
      failed(failure);
    } finally {
      $("r-go").disabled = false;
    }
  });
  let email = "";
  $("r-email").addEventListener("submit", async (e) => {
    e.preventDefault();
    email = $("r-email-in").value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return said("Add your email address.");
    try {
      await sendCode({ kind: "checkin", token, email });
      $("r-email").hidden = true;
      $("r-code").hidden = false;
      $("r-code-in").focus();
      said(`We sent a 6-digit code to ${email}.`);
    } catch (failure) {
      failed(failure);
    }
  });
  $("r-code").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const out = await rpc("drive_checkin_email_verify", { p_route_link_token: token, p_email: email, p_code: $("r-code-in").value.trim() }, { signedIn: true });
      // A wrong, expired or spent code is a reply, not a refusal (0085), so
      // the try counts: 5 tries a code, 10 minutes.
      if (out?.error) return said(CODE_WORDS[out.error] || "Something went wrong. Try again.");
      done(out);
    } catch (failure) {
      failed(failure);
    }
  });
  getCarve($("r-get"));
}

if (typeof document !== "undefined") {
  // Club v2 cut these pages: the link has ended (link-ended.js).
  if (CLUB_V2) linkEnded();
  else if ($("cp-routelink")) routeLinkPage();
  else if ($("cp-answer")) answerPage();
  else if ($("cp-drive")) drivePage();
  else if ($("cp-unsub")) unsubscribePage();
}
