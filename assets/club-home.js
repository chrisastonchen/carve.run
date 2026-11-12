// carve.run/club/, club v2 (the wires' O1, O2 and O2b; Chris, 11/9 night).
// Signed in with no club, or a club with no plan: Start a club (Club's
// card, one name, Start free trial: org-billing's Checkout with the
// 30-day trial; one plan since Chris's 11/10 afternoon). With a plan: Club home, its drives (Upcoming and Past,
// each Draft, Ready or Completed), its organizers and a link to Club
// settings. No price here, and no member or driver lists.

import { $, billing, el, myOrgs, rpc, sessionEmail, signedIn } from "/assets/club-api.js?v=2060100765";
import { STAGE_WORDS, datesText, planCards, planEyebrow, priceText, renewalTerms, trialDays, splitHome, stageOf, trialStatus } from "/assets/club-words.js?v=e4108d1a92";
import { organizersBox } from "/assets/club-organizers.js?v=a0226bf956";
import { billsToday } from "/assets/who-words.js?v=f3fe2a71de";
import { hideIntro, showIntro } from "/assets/club-intro.js?v=55f6349230";
import { forgetWho } from "/assets/who.js?v=4b12d2f422";
import { BY_TIER, PLANS } from "/assets/plans.js?v=a1e99a533b";

const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };
const isOwner = (o) => (typeof o?.owner === "boolean" ? o.owner : o?.role === "admin");
const onPlan = (o) => BY_TIER[o?.tier]?.for === "organizers";
const CLUB_TIERS = [...PLANS.filter((p) => p.for === "organizers").map((p) => p.tier), "group"];

let orgs = [];
let org = null;
const box = organizersBox("v-orgz", () => org);

// ── An organizer's invite link (carve.run/club/?invite=<token>; App Dev's
// 0096, Chris 11/11): read once, off the address at once, kept in this
// tab's sessionStorage through any sign-in (Apple, Google, the email
// code), claimed after it. Never logged; analytics sends the path only. ──
const INVITE_KEY = "carve.club.invite";
export const INVITE_WORDS = {
  not_found: "This invite link doesn't work. Ask your club's organizer to send a new one.",
  invite_used: "This invite has expired or was already used. Ask your club's organizer to send it again.",
  invite_expired: "This invite has expired or was already used. Ask your club's organizer to send it again.",
  too_many: "Too many tries. Try again in an hour.",
};

function takeInvite() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("invite");
  if (raw !== null) {
    params.delete("invite");
    const rest = params.toString();
    try { history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash); } catch {}
    if (/^[0-9a-f]{64}$/.test(raw)) try { sessionStorage.setItem(INVITE_KEY, raw); } catch {}
  }
  try { return sessionStorage.getItem(INVITE_KEY); } catch { return null; }
}
const forgetInvite = () => { try { sessionStorage.removeItem(INVITE_KEY); } catch {} };

/// → { org } joined (or already), { signIn } a real sign-in first (kept),
/// or { said } why not (gone).
async function claimInvite(token) {
  let answer;
  try {
    answer = await rpc("org_invite_claim_token", { p_token: token });
  } catch (failure) {
    if (failure.code === "sign_in") return { signIn: true };
    forgetInvite();
    return { said: failure.message };
  }
  forgetInvite();
  if (answer?.org_id) return { org: answer.org_id };
  return { said: INVITE_WORDS[answer?.error] || INVITE_WORDS.not_found };
}

/// Signed out: For Clubs (F1). Start your free trial signs in, then O1;
/// Log in signs in, then their Club home (or O1 with a line, no club).
function showSignIn() {
  status("");
  showIntro({
    // Back from sign-in straight to Start a club, not For Clubs again (QA, 11/11).
    start: () => window.carveSignIn?.({ returnTo: "/club/?start=1" }),
    login: () => window.carveSignIn?.({ returnTo: "/club/?login=1" }),
  });
}

/// For Clubs once per visit for an account with no club (an Individual
/// account, say): its trial button opens O1 here.
let introSeen = false;

/// ?start=1 (Start your free trial, back from sign-in): Start a club, not
/// For Clubs again; read once and taken off the address.
function takeStart() {
  const params = new URLSearchParams(location.search);
  if (!params.has("start")) return false;
  params.delete("start");
  const rest = params.toString();
  try { history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash); } catch {}
  return true;
}

async function start() {
  document.querySelector("main.cp")?.classList.add("cv");
  const invite = takeInvite();
  if (takeStart()) introSeen = true;
  if (!(await signedIn())) return showSignIn();
  await rpc("account_claim").catch(() => {});
  let joined = null;
  let said = "";
  if (invite) {
    const claimed = await claimInvite(invite);
    // A guest session can't join: a real sign-in, the invite kept.
    if (claimed.signIn) return showSignIn();
    if (claimed.org) {
      joined = claimed.org;
      forgetWho(); // a new club for the bar's menus
      try { history.replaceState(null, "", `/club/?org=${encodeURIComponent(joined)}`); } catch {}
    }
    said = claimed.said || "";
  }
  wire();
  await load(joined || undefined);
  if (said) status(said);
  if (new URLSearchParams(location.search).get("paid")) {
    $("v-start-said").textContent = "Thanks. Your plan starts as soon as Stripe confirms it, usually within a minute.";
    setTimeout(load, 4000);
  }
}

async function load(prefer) {
  try {
    orgs = await myOrgs();
  } catch (failure) {
    return status(failure.message);
  }
  status("");
  const want = prefer || new URLSearchParams(location.search).get("org") || org?.id;
  // + Add a club (My Clubs ▾, board N5): Start a club, for a new one.
  const adding = !prefer && new URLSearchParams(location.search).has("add") && !want;
  org = adding ? null : orgs.find((o) => o.id === want) || orgs.find(onPlan) || orgs[0] || null;
  // A club on a plan has its home; otherwise, start one (or start its plan).
  const home = !!org && onPlan(org);
  const login = new URLSearchParams(location.search).has("login");
  // No club at all, and not here to add one or after Log in: For Clubs first.
  if (!org && !adding && !login && !introSeen) {
    introSeen = true;
    $("v-start").hidden = true;
    $("v-home").hidden = true;
    return showIntro({ start: () => { hideIntro(); $("v-start").hidden = false; renderStart(); $("v-start").scrollIntoView?.({ block: "start" }); } });
  }
  // Logged in from For Clubs with no club: O1, saying so (F1).
  $("v-login-note").hidden = !(login && !org);
  $("v-start").hidden = home;
  $("v-home").hidden = !home;
  if (!home) return renderStart();
  renderHome();
}

// ── Start a club (O1) ──

function renderStart() {
  $("v-plans").replaceChildren(...planCards(PLANS).map((c) => {
    const card = el("div", "v-plan");
    const body = el("span", "v-plan-body");
    body.append(el("b", "v-plan-name", c.name), el("span", "v-plan-price", c.price));
    const list = el("ul", "v-plan-lines");
    for (const line of c.lines) list.append(el("li", "", line));
    body.append(list);
    card.append(body);
    return card;
  }));
  // A club made already, with no plan yet (Checkout left): its name stays.
  if (org && !$("v-name").value) $("v-name").value = org.name;
  // No second trial: a club sharing an organizer with one that had a plan
  // is billed today (board N5; 0058's org_trial_used, 0090's had_plan). A
  // guess for the first paint: a club made already asks org-billing, whose
  // answer is Checkout's own (Legal, 11/11).
  // The had-a-plan reason only for a new club, where orgs_mine's plans are
  // this account's own clubs; a club made already may have had its trial
  // used by another organizer, so it gets the plain line (Product, 11/11).
  const others = billsToday(orgs.filter((o) => o.id !== org?.id), CLUB_TIERS);
  hadPlan = !org && others;
  const guess = !(others || !!org?.trial_used);
  showTerms({ trial: guess, terms: renewalTerms(BY_TIER.club, guess) });
  if (org) preview().then((answer) => answer && showTerms(answer)).catch(() => {});
  // Individual bought in a store (apex_mine's store, 0064; never a club's
  // grant): Club covers it, and it's cancelled in the store (board O1, v45).
  rpc("apex_mine").then((a) => { $("v-individual").hidden = a?.store !== true; }).catch(() => {});
}

/// What the page says beside the button: a trial or billed today, and the
/// renewal terms. `shown` is what the organizer last saw.
let shown = null;
/// A new club, and this account's other club had a plan: the note says so.
/// Any other reason for no trial (another organizer, the region's club)
/// gets the plain line.
let hadPlan = false;
function showTerms({ trial, terms, amount }) {
  shown = !!trial;
  // The price from plans.js, so a price change follows the runbook in one place; org-billing's when it says.
  const price = Number.isFinite(amount) ? priceText(amount / 100) : Number.isFinite(BY_TIER.club?.year) ? priceText(BY_TIER.club.year) : "";
  $("v-trial-note").textContent = trial ? `${trialDays(BY_TIER.club)}-day free trial. Card needed, cancel any time.`
    : `No free trial${hadPlan ? ", because you've had a Club plan before" : " for this club"}. You'll be billed ${price} today, and you can cancel any time.`;
  $("v-start-go").textContent = trial ? "Start free trial" : `Start Club for ${price}`;
  $("v-terms").textContent = terms || renewalTerms(BY_TIER.club, trial);
}

/// org-billing's word on this club's Checkout: {trial, terms, amount, …}.
const preview = () => billing({ action: "preview", org_id: org.id, plan: "club", interval: "year" });

/// Words when Checkout would differ from what the page said (Product, 11/11).
export const TERMS_CHANGED = {
  today: "No free trial for this club. Check the price below and press again.",
  trial: (days) => `This club gets a ${days}-day free trial. Check the terms below and press again.`,
};

async function startTrial() {
  const say = (t) => { $("v-start-said").textContent = t; };
  const name = $("v-name").value.trim();
  if (!name) return say("Add your club's name.");
  $("v-start-go").disabled = true;
  say("Opening Stripe…");
  try {
    // One club per name typed; Checkout cancelled and tried again keeps it.
    if (!org) {
      org = await rpc("org_create", { p_kind: "group", p_name: name, p_contact_email: sessionEmail() || null, p_club_id: null, p_region_id: null });
      history.replaceState(null, "", `/club/?org=${org.id}`);
    } else if (org.name !== name) {
      org = { ...org, ...(await rpc("org_update", { p_org_id: org.id, p_patch: { name } })) };
    }
    // Checkout only on the terms the organizer saw: when org-billing says
    // otherwise, the page says what it will be, and waits for another press.
    const answer = await preview().catch(() => null);
    if (answer && !!answer.trial !== shown) {
      showTerms(answer);
      say(answer.trial ? TERMS_CHANGED.trial(trialDays(BY_TIER.club)) : TERMS_CHANGED.today);
      $("v-start-go").disabled = false;
      return;
    }
    const { url } = await billing({ action: "checkout", org_id: org.id, plan: "club", interval: "year" });
    forgetWho(); // a new club for the bar's menus, once it's paid
    location.href = url;
  } catch (failure) {
    say(failure.message);
    $("v-start-go").disabled = false;
  }
}

// ── Club home (O2, O2b) ──

function renderHome() {
  const plan = BY_TIER[org.tier];
  $("v-title").textContent = org.name;
  // The trial from orgs_mine at once; billing's word when it has one.
  $("v-eyebrow").textContent = planEyebrow(plan?.name, trialStatus(org));
  $("v-pick-row").hidden = orgs.length < 2;
  $("v-pick").replaceChildren(...orgs.map((o) => {
    const option = el("option", "", o.name);
    option.value = o.id;
    option.selected = o.id === org.id;
    return option;
  }));
  // A drive belongs to the club it was planned from (Product, 11/9).
  const planHref = `/club/drive/?org=${encodeURIComponent(org.id)}`;
  $("v-new").setAttribute("href", planHref);
  $("v-empty-new").setAttribute("href", planHref);
  $("v-settings").href = `/club/settings/?org=${encodeURIComponent(org.id)}`;
  // The trial's days left: org-billing's, the owner's to read.
  if (isOwner(org)) billing({ action: "status", org_id: org.id }).then((s) => { if (s?.trial_ends_at || s?.renews_at) $("v-eyebrow").textContent = planEyebrow(plan?.name, s); }).catch(() => {});
  loadDrives();
  box.load();
}

async function loadDrives() {
  $("v-drives-said").textContent = "";
  let drives;
  try {
    drives = await rpc("org_drives", { p_org_id: org.id });
    if (!Array.isArray(drives)) drives = [];
  } catch (failure) {
    $("v-drives-said").textContent = failure.message;
    return;
  }
  // Which days have a route: the server's `routed` (asked of App Dev, A),
  // else each drive's routes.
  const known = drives.every((d) => (d.days || []).every((x) => typeof x.routed === "boolean"));
  if (!known) {
    await Promise.all(drives.map(async (d) => {
      const routes = await rpc("drive_routes", { p_drive_id: d.id }).catch(() => []);
      const days = new Set((routes || []).map((r) => r.day_id));
      d.days = (d.days || []).map((x) => ({ ...x, routed: days.has(x.id) }));
    }));
  }
  const { upcoming, past } = splitHome(drives);
  const none = !upcoming.length && !past.length;
  $("v-empty").hidden = !none;
  // One Plan a drive: the empty state's, not the header's too (QA, 11/11).
  $("v-new").hidden = none;
  $("v-up").hidden = none;
  $("v-past").hidden = !past.length;
  $("v-up-list").replaceChildren(...upcoming.map(row));
  $("v-up-none").hidden = !!upcoming.length;
  $("v-past-list").replaceChildren(...past.map(row));
}

function row(d) {
  const li = el("li");
  const a = el("a", "v-drive");
  a.href = `/club/drive/?id=${encodeURIComponent(d.id)}`;
  const words = el("span", "v-drive-words");
  words.append(el("b", "", d.name || "Untitled drive"), el("span", "", datesText(d.days)));
  const stage = stageOf(d);
  a.append(el("span", "v-thumb"), words, el("span", `v-pill ${stage}`, STAGE_WORDS[stage]));
  li.className = "v-drive-row";
  li.append(a, more(d));
  return li;
}

/// A drive's ⋯ (Chris, 11/10): Duplicate, the new-drive form filled from it.
function more(d) {
  const box = el("div", "cv-more");
  const btn = el("button", "cv-more-btn", "⋯");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-label", `More for ${d.name || "this drive"}`);
  const menu = el("div", "cv-menu");
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const copy = el("a", "", "Duplicate");
  copy.setAttribute("role", "menuitem");
  copy.href = `/club/drive/?copy=${encodeURIComponent(d.id)}`;
  menu.append(copy);
  btn.addEventListener("click", () => {
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) copy.focus();
  });
  box.append(btn, menu);
  return box;
}

function closeMenus() {
  for (const m of document.querySelectorAll(".v-drive-row .cv-menu")) m.hidden = true;
  for (const b of document.querySelectorAll(".v-drive-row .cv-more-btn")) b.setAttribute("aria-expanded", "false");
}

function wire() {
  $("v-start-go").addEventListener("click", startTrial);
  document.addEventListener("click", (e) => { if (!e.target.closest(".v-drive-row .cv-more")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  $("v-pick").addEventListener("change", (e) => {
    history.replaceState(null, "", `/club/?org=${e.target.value}`);
    load(e.target.value);
  });
}

start();
