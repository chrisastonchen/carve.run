// carve.run/club/, club v2 (the wires' O1, O2 and O2b; Chris, 11/9 night).
// Signed in with no club, or a club with no plan: Start a club (Club's
// card, one name, Start free trial: org-billing's Checkout with the
// 30-day trial; one plan since Chris's 11/10 afternoon). With a plan: Club home, its drives (Upcoming and Past,
// each Draft, Ready or Completed), its organizers and a link to Club
// settings. No price here, and no member or driver lists.

import { $, billing, el, myOrgs, publicRpc, rpc, sessionEmail, sessionUserId, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { firstSteps, initials, nextCard, welcomeLine, planCards, priceText, renewalTerms, rowLine, shapeSvg, splitHome, statusChip, trialDays, trialMeter, trialStatus } from "/assets/club-words.js?v=5a33e1fdc7";
import { organizersBox } from "/assets/club-organizers.js?v=3eb3ba3078";
import { billsToday } from "/assets/who-words.js?v=f70bdee137";
import { hideIntro, showIntro } from "/assets/club-intro.js?v=f351588e23";
import { forgetWho } from "/assets/who.js?v=b3c98f8ff6";
import { BY_TIER, PLANS } from "/assets/plans.js?v=a1e99a533b";

const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };
const isOwner = (o) => (typeof o?.owner === "boolean" ? o.owner : o?.role === "admin");
const onPlan = (o) => BY_TIER[o?.tier]?.for === "organizers";
const CLUB_TIERS = [...PLANS.filter((p) => p.for === "organizers").map((p) => p.tier), "group"];

let orgs = [];
let org = null;
const box = organizersBox("v-orgz", () => org, { avatars: initials, onData: (members, cap) => { organizers = members.length; orgCap = cap?.limit ?? orgCap; meta(); homeSteps(); } });
let orgCap = 5; // the plan's organizers, once org_members says
let organizers = null; // the club's organizers, once org_members answers
let driveCount = null; // the club's live drives, once org_drives answers
// Miles in the US and the UK, as the planner's usesMiles.
const miles = () => /^en(-(US|GB))?$/i.test(navigator.language || "en-US");
/// The organizer's pages are dark (club flow mock v11); For Clubs keeps its own look.
const dash = (on, glow = false) => {
  const main = document.querySelector("main.cp");
  main?.classList.toggle("cv-dash", on);
  main?.classList.toggle("cd-glow", on && glow);
};

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
  dash(false);
  showIntro({
    // Back from sign-in straight to Start a club, not For Clubs again (QA, 11/11).
    start: () => window.carveSignIn?.({ returnTo: "/club/?start=1" }),
    login: () => window.carveSignIn?.({ returnTo: "/club/?login=1" }),
  });
}

/// Signed out with an invite (Chris 11/12): "You're invited to <Club> on
/// Carve", one line, Create free account and Log in (the site's sign-in,
/// back to /club/, where the claim runs). No price, no trial. A token that
/// won't claim says why, and is dropped, with Log in alone (an organizer who
/// joined already, tapping the email again; QA 11/12); one the preview
/// can't check (too many tries, no connection) keeps the page without the
/// name.
async function showInvite(token) {
  status("");
  $("o-signin").hidden = true;
  const answer = await publicRpc("org_invite_preview", { p_token: token });
  const dead = answer?.error && answer.error !== "too_many";
  if (dead) forgetInvite();
  $("o-invite-h").textContent = answer?.name ? `You're invited to ${answer.name} on Carve` : "You're invited to a club on Carve";
  $("o-invite-h").hidden = dead;
  $("o-invite-line").hidden = dead;
  $("o-invite-join").hidden = dead;
  $("o-invite-said").textContent = dead ? INVITE_WORDS[answer.error] || INVITE_WORDS.not_found : "";
  $("o-invite-said").hidden = !dead;
  $("o-invite-join").onclick = () => window.carveSignIn?.({ join: true, returnTo: "/club/" });
  $("o-invite-login").onclick = () => window.carveSignIn?.({ returnTo: "/club/" });
  $("o-invite").hidden = false;
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
  if (!(await signedIn())) return invite ? showInvite(invite) : showSignIn();
  await rpc("account_claim").catch(() => {});
  let joined = null;
  let said = "";
  if (invite) {
    const claimed = await claimInvite(invite);
    // A guest session can't join: a real sign-in, the invite kept.
    if (claimed.signIn) return showInvite(invite);
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
  // Back from Checkout before Stripe's word: Start a club says so, and looks again.
  if (new URLSearchParams(location.search).get("paid") && !$("v-start").hidden) {
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
    dash(false);
    return showIntro({ start: () => { hideIntro(); dash(true, true); $("v-start").hidden = false; renderStart(); $("v-start").scrollIntoView?.({ block: "start" }); } });
  }
  // Logged in from For Clubs with no club: O1, saying so (F1).
  $("v-login-note").hidden = !(login && !org);
  $("v-welcome").hidden = true;
  // Back from Checkout, the plan on: Welcome (mock v11), once.
  if (home && new URLSearchParams(location.search).has("paid")) return showWelcome();
  $("v-start").hidden = home;
  $("v-home").hidden = !home;
  dash(true, !home);
  if (!home) return renderStart();
  renderHome();
}

// ── First steps: Welcome after checkout, then Club home until done (mock v11) ──

/// Get the app has no server data (DevOps, 11/13): opening Get ticks it, per account.
const APP_KEY = () => `carve.club.app.${sessionUserId() || "me"}`;
const gotApp = () => { try { return localStorage.getItem(APP_KEY()) === "1"; } catch { return false; } };
const planHref = () => `/club/drive/?org=${encodeURIComponent(org.id)}`;

/// The steps into `list`: a number (a tick once done), the words, the action.
function drawSteps(list, data) {
  list.replaceChildren(...firstSteps({ ...data, gotApp: gotApp() }).map((step, i) => {
    const li = el("li", `cd-step step-${step.key}${step.done ? " done" : ""}`);
    const num = el("span", "cd-num", step.done ? "✓" : String(i + 1));
    num.setAttribute("aria-hidden", "true");
    const words = el("span", "cd-step-words");
    words.append(el("b", "", step.title), el("span", "", step.line));
    if (step.done) words.append(el("span", "visually-hidden", "Done."));
    let act;
    if (step.key === "plan") {
      act = el("a", "go", step.action);
      act.href = planHref();
    } else {
      act = el("button", "go ghost", step.action);
      act.type = "button";
      act.addEventListener("click", step.key === "app" ? openGet : inviteNow);
    }
    li.append(num, words, act);
    return li;
  }));
}

/// The steps on Club home, until all three are done.
function homeSteps() {
  if (!org || $("v-home").hidden || driveCount === null || organizers === null) return;
  const data = { drives: driveCount, organizers, cap: orgCap };
  const all = firstSteps({ ...data, gotApp: gotApp() }).every((s) => s.done);
  $("v-steps-box").hidden = all;
  if (!all) drawSteps($("v-steps"), data);
}

/// Get: the app's code and stores; opening it ticks the step.
function openGet() {
  try { localStorage.setItem(APP_KEY(), "1"); } catch {}
  const box = $("v-get-qr");
  if (!box.firstChild && window.qrcode) {
    const code = window.qrcode(0, "M");
    code.addData("https://carve.run/get/?ct=club-welcome");
    code.make();
    box.innerHTML = code.createSvgTag({ cellSize: 1, margin: 0, scalable: true });
  }
  $("v-get").showModal?.();
  if (!$("v-welcome").hidden) welcomeSteps(); else homeSteps();
}

/// Invite: Club home's organizers, the email box open.
function inviteNow() {
  if (!$("v-welcome").hidden) {
    $("v-welcome").hidden = true;
    $("v-home").hidden = false;
    dash(true);
    renderHome();
  }
  $("v-orgz-add").click();
  $("v-orgz-email").scrollIntoView?.({ block: "center" });
}

let welcome = { drives: 0, organizers: 1, cap: 5 };
function welcomeSteps() { drawSteps($("v-welcome-steps"), welcome); }

/// Welcome to Carve Club (mock v11): the club is ready, the trial's end,
/// three steps. The address loses ?paid, so a reload is Club home.
async function showWelcome() {
  status("");
  dash(true, true);
  $("v-start").hidden = true;
  $("v-home").hidden = true;
  $("v-welcome").hidden = false;
  try { history.replaceState(null, "", `/club/?org=${encodeURIComponent(org.id)}`); } catch {}
  $("v-welcome-h").textContent = `${org.name} is ready.`;
  $("v-welcome-line").textContent = welcomeLine(trialStatus(org));
  if (isOwner(org)) billing({ action: "status", org_id: org.id }).then((s) => { if (s?.trial_ends_at) $("v-welcome-line").textContent = welcomeLine(s); }).catch(() => {});
  welcomeSteps();
  const [drives, members] = await Promise.all([rpc("org_drives", { p_org_id: org.id }).catch(() => []), rpc("org_members", { p_org_id: org.id }).catch(() => null)]);
  welcome = { drives: Array.isArray(drives) ? drives.filter((d) => d.status !== "cancelled").length : 0, organizers: members?.members?.length || 1, cap: members?.organizer_cap?.limit ?? 5 };
  welcomeSteps();
}

// ── Start a club (O1) ──

function renderStart() {
  // The plan on top (O1 redesign, Chris 11/12): its name and price, and
  // what it has in one plain row, from plans.js.
  const club = planCards(PLANS)[0];
  if (club) {
    $("v-price").textContent = `Carve ${club.name} · ${club.price}`;
    $("v-perks").textContent = ["Offline navigation", ...club.lines].join(" · ");
  }
  $("v-trial-chip").textContent = `First ${trialDays(BY_TIER.club)} days free`;
  // A club made already, with no plan yet (Checkout left): its name stays.
  if (org && !$("v-name").value) $("v-name").value = org.name;
  nameTyped();
  $("v-start-changed").hidden = true;
  setTimeout(() => $("v-name").focus({ preventScroll: true }), 0);
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
  // A trial: the chip. None: the note, in the chip's place.
  $("v-trial-chip").hidden = !trial;
  $("v-trial-note").hidden = !!trial;
  $("v-trial-note").textContent = trial ? ""
    : `No free trial${hadPlan ? ", because you've had a Club plan before" : " for this club"}. You'll be billed ${price} today, and you can cancel any time.`;
  $("v-start-go").textContent = trial ? "Start free trial" : `Start Club for ${price}`;
  $("v-terms").textContent = terms || renewalTerms(BY_TIER.club, trial);
}

/// The button waits for a name (O1 redesign); Enter starts it as a press does.
const nameTyped = () => { $("v-start-go").disabled = !$("v-name").value.trim(); };

/// org-billing's word on this club's Checkout: {trial, terms, amount, …}.
const preview = () => billing({ action: "preview", org_id: org.id, plan: "club", interval: "year" });

/// Words when Checkout would differ from what the page said (Product, 11/11).
export const TERMS_CHANGED = {
  today: "No free trial for this club. Check the price below and press again.",
  trial: (days) => `This club gets a ${days}-day free trial. Check the terms below and press again.`,
};

async function startTrial() {
  const say = (t) => { $("v-start-said").textContent = t; };
  // Checkout would differ from what the page said: above the question.
  const changed = (t) => { $("v-start-changed").textContent = t; $("v-start-changed").hidden = !t; };
  changed("");
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
      say("");
      changed(answer.trial ? TERMS_CHANGED.trial(trialDays(BY_TIER.club)) : TERMS_CHANGED.today);
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
  organizers = null;
  driveCount = null;
  meta();
  // The trial's quiet meter from orgs_mine at once; billing's word when it has one.
  trialPanel(plan, trialStatus(org));
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
  if (isOwner(org)) billing({ action: "status", org_id: org.id }).then((s) => { if (s?.trial_ends_at || s?.renews_at) trialPanel(plan, s); }).catch(() => {});
  loadDrives();
  box.load();
}

/// The band's line: "3 drives · 2 organizers", each once it's known.
function meta() {
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const parts = [driveCount ? n(driveCount, "drive", "drives") : "", organizers !== null ? n(organizers, "organizer", "organizers") : ""].filter(Boolean);
  $("v-meta").replaceChildren(...parts.flatMap((t, i) => (i ? [el("span", "", "·"), el("span", "", t)] : [el("span", "", t)])));
}

function trialPanel(plan, s) {
  const m = trialMeter(plan, s);
  $("v-eyebrow").textContent = m.label;
  $("v-meter").hidden = m.used === null;
  if (m.used !== null) $("v-meter-bar").style.width = `${m.used}%`;
  $("v-trial-line").textContent = m.text;
  $("v-trial-line").hidden = !m.text;
}

/// Route shapes for at most this many list rows (DevOps, 11/13): one
/// drive_routes call each; the rest show no shape.
const ROW_SHAPES = 5;

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
  // else each drive's routes, kept for the shapes too.
  const fetched = new Map();
  if (!drives.every((d) => (d.days || []).every((x) => typeof x.routed === "boolean"))) {
    await Promise.all(drives.map(async (d) => {
      const list = await rpc("drive_routes", { p_drive_id: d.id }).catch(() => []);
      fetched.set(d.id, list || []);
      const days = new Set((list || []).map((r) => r.day_id));
      d.days = (d.days || []).map((x) => ({ ...x, routed: days.has(x.id) }));
    }));
  }
  const routesFor = (d) => (fetched.has(d.id) ? Promise.resolve(fetched.get(d.id)) : rpc("drive_routes", { p_drive_id: d.id }).catch(() => []));
  const { upcoming, past } = splitHome(drives);
  driveCount = upcoming.length + past.length;
  meta();
  homeSteps();
  const none = !driveCount;
  $("v-empty").hidden = !none;
  // One Plan a drive: the empty state's, not the band's too (QA, 11/11).
  $("v-new").hidden = none;
  $("v-up").hidden = none;
  $("v-past").hidden = !past.length;
  const [next, ...later] = upcoming;
  $("v-next").hidden = !next;
  $("v-next-h").hidden = !next;
  $("v-later-h").hidden = !later.length;
  $("v-up-none").hidden = !!next;
  // The next drive's days with their times, and every row's routes (the
  // first few), at once.
  const rows = [...later, ...past];
  const [full, nextRoutes, ...rowRoutes] = await Promise.all([
    next ? rpc("drive_get", { p_drive_id: next.id }).catch(() => null) : null,
    next ? routesFor(next) : [],
    ...rows.slice(0, ROW_SHAPES).map(routesFor),
  ]);
  const routesOf = new Map(rows.slice(0, ROW_SHAPES).map((d, i) => [d.id, rowRoutes[i] || []]));
  if (next) nextUp({ ...next, ...(full || {}), days: mergeDays(next.days, full?.days) }, nextRoutes || []);
  $("v-up-list").replaceChildren(...later.map((d) => row(d, routesOf.get(d.id))));
  $("v-past-list").replaceChildren(...past.map((d) => row(d, routesOf.get(d.id))));
}

/// org_drives' days (with routed) and drive_get's (with the times).
const mergeDays = (brief = [], full = []) => brief.map((d) => ({ ...(full || []).find((x) => x.id === d.id), ...d }));

/// The next drive's card (mock v11): its route's shape, the status chip, the
/// name, when, the stat strip, how far planned, Plan Day N and Share Day N.
function nextUp(d, routes) {
  const c = nextCard(d, routes, { miles: miles() });
  const card = $("v-next");
  const shape = el("a", "cd-shape");
  shape.href = `/club/drive/?id=${encodeURIComponent(d.id)}`;
  shape.setAttribute("aria-label", `Open ${d.name || "the drive"}`);
  const svg = c.shapeDay >= 0 ? shapeSvg(routes.filter((r) => r.day_id === d.days[c.shapeDay].id).sort((a, b) => a.position - b.position)[0]?.payload) : "";
  if (svg) shape.innerHTML = svg; // numbers and our colours only (shapeSvg)
  else shape.classList.add("none");
  const body = el("div", "cd-next-body");
  const name = el("h3", "");
  const link = el("a", "", d.name || "Untitled drive");
  link.href = `/club/drive/?id=${encodeURIComponent(d.id)}`;
  name.append(link);
  const count = el("div", "cd-count");
  count.append(...c.count.map((x) => { const box = el("div"); box.append(el("b", "", x.n), el("span", "", x.label)); return box; }));
  const bar = el("div", "cd-prog");
  const track = el("div", "cd-bar");
  const fill = el("i");
  fill.style.width = `${c.progress.pct}%`;
  track.append(fill);
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-valuenow", String(c.progress.pct));
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-label", "Days planned");
  bar.append(track, el("small", "", c.progress.text));
  const acts = el("div", "cd-acts");
  for (const a of c.acts) {
    const b = el("a", a.primary ? "go" : "go ghost", a.text);
    b.href = a.kind === "plan" ? `/plan/?drive=${encodeURIComponent(d.id)}&day=${a.day}` : `/${encodeURIComponent(a.token)}?club=${encodeURIComponent(d.id)}&day=${a.day}`;
    acts.append(b);
  }
  body.append(el("span", `cd-chip ${c.chip.tone}`, c.chip.text), name, el("p", "cd-when", c.when));
  if (c.count.length) body.append(count);
  body.append(bar, acts);
  card.replaceChildren(shape, body, more(d));
}

function row(d, routes) {
  const li = el("li");
  const a = el("a", "v-drive");
  a.href = `/club/drive/?id=${encodeURIComponent(d.id)}`;
  const thumb = el("span", "v-thumb");
  thumb.setAttribute("aria-hidden", "true");
  const first = (routes || []).slice().sort((x, y) => x.position - y.position)[0];
  const chip = statusChip(d);
  const svg = first ? shapeSvg(first.payload, { pins: false, muted: chip.tone === "done" }) : "";
  if (svg) thumb.innerHTML = svg; // numbers and our colours only (shapeSvg)
  const words = el("span", "v-drive-words");
  words.append(el("b", "", d.name || "Untitled drive"), el("span", "", rowLine(d.days, routes || [], miles())));
  a.append(thumb, words, el("span", `cd-chip ${chip.tone}`, chip.text));
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
  for (const m of document.querySelectorAll("#v-home .cv-menu")) m.hidden = true;
  for (const b of document.querySelectorAll("#v-home .cv-more-btn")) b.setAttribute("aria-expanded", "false");
}

function wire() {
  $("v-start-form").addEventListener("submit", (e) => { e.preventDefault(); if (!$("v-start-go").disabled) startTrial(); });
  $("v-name").addEventListener("input", nameTyped);
  document.addEventListener("click", (e) => { if (!e.target.closest("#v-home .cv-more")) closeMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });
  $("v-pick").addEventListener("change", (e) => {
    history.replaceState(null, "", `/club/?org=${e.target.value}`);
    load(e.target.value);
  });
}

start();
