// carve.run/s/<token>: a drive's public sign-up page (the approved mock,
// 11/9). One question at a time on a phone; the answers go to App Dev's
// signup function (Turnstile checked there, and it emails a confirmation
// link: signup_confirm). It never says whether an address is already on
// the drive (App Dev, 11/9). The questions and their checks are
// signup-form.js's. Nothing is sent until the last question's Sign up.

import { SUPABASE_KEY, SUPABASE_URL } from "/assets/carve-session.js?v=a3869ea508";
import { STYLES, driveLine, payload, problem, questions } from "/assets/signup-form.js?v=9df381390a";
import { CLUB_V2 } from "/plan/club-flags.js?v=4";
import { linkEnded } from "/assets/link-ended.js?v=930ada191b";

const $ = (id) => document.getElementById(id);
const TURNSTILE_SITE_KEY = "0x4AAAAAAFqn1SkCkqJfDpRa";
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

/// The token in /s/<token>, or ?k= as the club pages take it (never ?t=,
/// the Worker's share-token key).
export function tokenOf(location) {
  const parts = location.pathname.split("/").filter(Boolean);
  const fromPath = parts.length >= 2 && parts[1] !== "confirm" && /^[A-Za-z0-9_-]{6,64}$/.test(parts[1]) ? parts[1] : null;
  const k = new URLSearchParams(location.search).get("k");
  return fromPath || (k && /^[A-Za-z0-9_-]{6,64}$/.test(k) ? k : null);
}

/// The confirmation link's code: /s/confirm/<code> (or ?c= for tests).
export function confirmOf(location) {
  const parts = location.pathname.split("/").filter(Boolean);
  const fromPath = parts[1] === "confirm" && /^[A-Za-z0-9_-]{6,64}$/.test(parts[2] || "") ? parts[2] : null;
  const c = new URLSearchParams(location.search).get("c");
  return fromPath || (c && /^[A-Za-z0-9_-]{6,64}$/.test(c) ? c : null);
}

async function rpc(name, body) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Carve. Check the connection and try again.");
  }
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const words = {
      not_found: "This sign-up link isn't working any more. Ask the organizer for a new one.",
      closed: "Sign-ups for this drive are closed.",
    };
    throw new Error(words[data?.message] || "Something went wrong. Try again.");
  }
  return data;
}

/// Turnstile's check before a sign-up goes (as the planner does): most
/// people never see it; a doubtful browser gets one checkbox. Null on a
/// local preview, or when it can't run.
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
async function turnstileToken() {
  if (LOCAL || !(await loadTurnstile())) return null;
  return new Promise((resolve) => {
    const done = (t) => { $("su-check").hidden = true; resolve(t); };
    try {
      if (widget !== null) window.turnstile.remove(widget);
      widget = window.turnstile.render("#su-check-widget", {
        sitekey: TURNSTILE_SITE_KEY, appearance: "interaction-only", theme: "light",
        callback: (t) => done(t), "error-callback": () => done(null), "expired-callback": () => done(null),
        "before-interactive-callback": () => ($("su-check").hidden = false),
      });
    } catch {
      done(null);
    }
  });
}

/// The sign-up itself: App Dev's signup function. → nothing; throws the
/// words to show.
async function submit(body) {
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/signup`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Carve. Check the connection and try again.");
  }
  if (response.ok) return;
  if (response.status === 429) throw new Error("Too many tries just now. Wait a minute and try again.");
  // The function can't check sign-ups (its Turnstile secret is missing): never let one through.
  if (response.status === 503) throw new Error("Sign-ups aren't working right now. Try again later.");
  const data = await response.json().catch(() => ({}));
  const words = {
    not_found: "This sign-up link isn't working any more. Ask the organizer for a new one.",
    closed: "Sign-ups for this drive are closed.",
    invalid: "Something in your answers needs another look.",
  };
  const failure = new Error(words[data?.error] || "Something went wrong. Try again.");
  failure.fields = data?.fields || [];
  throw failure;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const answers = { kind: "car" };
let at = 0;
let qs = [];
let token = null;

function field(label, key, { type = "text", autocomplete = "", placeholder = "" } = {}) {
  const l = el("label", "su-field");
  const input = el("input", "su-in");
  input.type = type;
  input.value = answers[key] || "";
  if (autocomplete) input.autocomplete = autocomplete;
  if (placeholder) input.placeholder = placeholder;
  input.addEventListener("input", () => { answers[key] = input.value; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
  if (label) l.append(el("span", "su-mini", label));
  l.append(input);
  return l;
}

function choice(options, key, value) {
  const list = el("div", "su-choices");
  for (const o of options) {
    const b = el("button", `su-choice${answers[key] === o.value ? " on" : ""}`);
    b.type = "button";
    b.setAttribute("aria-pressed", String(answers[key] === o.value));
    b.append(el("span", "", o.label));
    if (o.sub) b.append(el("small", "", o.sub));
    b.addEventListener("click", () => { answers[key] = o.value; draw(); });
    list.append(b);
  }
  return list;
}

function draw(said = "") {
  const q = qs[at];
  const box = $("su-q");
  $("su-prog").style.width = `${Math.round((at / qs.length) * 100)}%`;
  const parts = [el("span", "su-n", `${at + 1} of ${qs.length}${q.optional ? " · optional" : ""}`), el("h1", "su-t", q.title)];
  if (q.help) parts.push(el("p", "su-h", q.help));
  if (q.key === "email") parts.push(field("", "email", { type: "email", autocomplete: "email", placeholder: "you@example.com" }));
  if (q.key === "name") {
    const row = el("div", "su-two");
    row.append(field("First name", "first", { autocomplete: "given-name" }), field("Last name", "last", { autocomplete: "family-name" }));
    parts.push(row);
  }
  if (q.key === "phone") parts.push(field("", "phone", { type: "tel", autocomplete: "tel", placeholder: "(408) 555-0134" }));
  if (q.key === "vehicle") {
    const seg = el("div", "su-seg");
    seg.setAttribute("role", "group");
    seg.setAttribute("aria-label", "Car or motorcycle");
    for (const [v, label] of [["car", "Car"], ["motorcycle", "Motorcycle"]]) {
      const b = el("button", answers.kind === v ? "on" : "", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(answers.kind === v));
      b.addEventListener("click", () => { answers.kind = v; draw(); });
      seg.append(b);
    }
    parts.push(seg, field("Make", "make", { placeholder: answers.kind === "motorcycle" ? "Ducati" : "Porsche" }), field("Model", "model", { placeholder: answers.kind === "motorcycle" ? "Monster" : "Cayman" }), field("Trim (optional)", "trim", { placeholder: "GTS 4.0" }));
  }
  if (q.key === "style") parts.push(choice(STYLES, "style"));
  if (q.key === "first") {
    parts.push(choice([{ value: true, label: "Yes, it's my first" }, { value: false, label: "No, I've been before" }], "first_timer"));
    parts.push(el("p", "su-fine", approval === "manual"
      ? "The organizer approves each sign-up. Once you're in, you'll get the route and the meeting spot by email."
      : "First come, first served. Once you've confirmed your email, you'll get the route and the meeting spot by email."));
  }
  if (said) parts.push(el("p", "su-said", said));
  box.replaceChildren(...parts);
  $("su-back").hidden = at === 0;
  $("su-skip").hidden = !q.optional;
  $("su-ok").textContent = at === qs.length - 1 ? "Sign up" : "OK";
  box.querySelector("input")?.focus({ preventScroll: true });
}

async function next() {
  const q = qs[at];
  const why = problem(q.key, answers);
  if (why) return draw(why);
  if (at < qs.length - 1) { at++; return draw(); }
  $("su-ok").disabled = true;
  draw("Sending…");
  try {
    await submit({ token, signup: payload(answers), turnstile: await turnstileToken() });
    done();
  } catch (failure) {
    $("su-ok").disabled = false;
    // An answer the server sent back: that question again, said.
    const back = qs.findIndex((x) => failure.fields?.includes(x.key) || (x.key === "vehicle" && failure.fields?.some((f) => ["vehicle", "make", "model", "car"].includes(f))) || (x.key === "name" && failure.fields?.includes("first")));
    if (back >= 0) at = back;
    draw(failure.message);
  }
}

function done() {
  const first = String(answers.first || "").trim();
  $("su-prog").style.width = "100%";
  const box = el("div", "su-done");
  box.append(el("b", "", `Thanks${first ? `, ${first}` : ""}. Check your email.`),
    el("span", "", `Tap the link we sent to ${payload(answers).email} to confirm it.${approval === "manual" ? " Then the organizer reviews your sign-up and you'll hear back by email." : " Then you'll get the route and the meeting spot by email."}`));
  $("su-q").replaceChildren(box);
  $("su-bot").hidden = true;
}

let approval = "auto";

/// The emailed confirmation link: a button, never on the link's own load.
function confirmPage(code) {
  $("su-status").hidden = true;
  const box = el("section", "su-q");
  const go = el("button", "su-ok", "Confirm my email");
  go.type = "button";
  const said = el("p", "su-said");
  go.addEventListener("click", async () => {
    go.disabled = true;
    said.textContent = "Confirming…";
    try {
      const out = await rpc("signup_confirm", { p_confirm_token: code });
      const name = out?.drive?.name || "the drive";
      const done = el("div", "su-done");
      // Auto: decided on confirming (in, or the waitlist); manual: waiting for the organizer.
      done.append(el("b", "", "Email confirmed."), el("span", "", out?.approval === "approved"
        ? `You're in for ${name}. The route and the meeting spot come by email.`
        : out?.approval === "waitlist" || out?.waitlisted ? `${name} is full, so you're on the waitlist. We'll email you if a spot opens.`
        : `The organizer reviews your sign-up for ${name}, and you'll hear back by email.`));
      box.replaceChildren(done);
    } catch (failure) {
      go.disabled = false;
      said.textContent = failure.message;
    }
  });
  box.append(el("h1", "su-t", "Confirm your email"), el("p", "su-h", "One tap, and your sign-up goes through."), go, said);
  $("su-main").replaceChildren(box);
  $("su-main").hidden = false;
}

async function start() {
  const code = confirmOf(location);
  if (code) return confirmPage(code);
  token = tokenOf(location);
  if (!token) return ($("su-status").textContent = "This sign-up link is missing its code. Ask the organizer for the link again.");
  let view;
  try {
    view = await rpc("signup_view", { p_token: token });
  } catch (failure) {
    return ($("su-status").textContent = failure.message);
  }
  if (view?.closed) return ($("su-status").textContent = "Sign-ups for this drive are closed.");
  approval = view?.approval_mode === "manual" ? "manual" : "auto";
  $("su-status").hidden = true;
  $("su-club").textContent = view?.club?.name || "";
  $("su-name").textContent = view?.drive?.name || "Group drive";
  $("su-line").textContent = driveLine({ ...view?.drive, spots_left: view?.spots_left, answer_by: view?.answer_by });
  document.title = `Sign up: ${view?.drive?.name || "Group drive"} | Carve`;
  qs = questions(view?.club?.name || "the club");
  $("su-main").hidden = false;
  $("su-ok").addEventListener("click", next);
  $("su-skip").addEventListener("click", () => { answers.phone = ""; at++; draw(); });
  $("su-back").addEventListener("click", () => { at = Math.max(0, at - 1); draw(); });
  draw();
}

// Club v2 cut sign-up pages: the link has ended (link-ended.js).
if (typeof document !== "undefined" && document.getElementById("su-q")) (CLUB_V2 ? linkEnded() : start());
