// carve.run/club/: your club on Carve (club sprint item 5; App Dev's
// contract §1 and §1a). Register a club from the directory, a group or
// just yourself; then its details, its plan (Stripe Checkout and the
// billing portal through org-billing), and two lists (Chris, 11/9):
// organizers, who have the club's account (equal rights, no roles, Apex
// all year; "N of 5" on Club, of 2 on Group, the limit the server's), and
// members, the club's address book for inviting to drives (no access, no
// Apex, no account needed, no cap shown). Signed in only; every change is
// a tap.

import { SUPABASE_KEY, SUPABASE_URL, SESSION_KEY, accessToken } from "/assets/carve-session.js?v=a3869ea508";
// The plans' names, limits and prices come from one place, plans.json
// (scripts/pricing/build_plans.py writes plans.js from it).
import { CONTACT, PLANS } from "/assets/plans.js?v=a1e99a533b";

const $ = (id) => document.getElementById(id);

const BY_TIER = Object.fromEntries(PLANS.map((p) => [p.tier, p]));
const BY_PLAN = Object.fromEntries(PLANS.map((p) => [p.plan, p]));
export { PLANS };
const KIND_WORDS = { club: "Club", group: "Group", solo: "Just me" };

/// The plan in a line: "Group: up to 20 drivers a drive and 2 organizers."
/// Group and Club have group drives, with Apex for everyone going and all
/// year for organizers; Individual is Apex for one driver, no group drives
/// (four plans, the user 11/8).
export function planLine(tier) {
  const p = BY_TIER[tier];
  if (!p || tier === "none") return "No plan yet.";
  if (p.for !== "organizers") return `${p.name}: Apex for your own driving. Group drives need Group or Club.`;
  // Club shows no driver cap (11/8 late: the server's 1,000 is never shown).
  return p.drivers ? `${p.name}: up to ${p.drivers} drivers a drive and ${p.organizers} organizers.` : `${p.name}: no driver cap, and ${p.organizers} organizers.`;
}

/// "About $15 a driver if your group splits it" (price ÷ drivers; copy only).
export const splitLine = (p) => (p.splitHint && p.drivers ? `About $${Math.round(p.year / p.drivers)} a driver if your group splits it` : "");

/// "8 of 10 members", or "8 members" with no cap.
export const seatsLine = (cap) => (cap?.limit == null ? `${cap?.used ?? 0} member${cap?.used === 1 ? "" : "s"}` : `${cap.used} of ${cap.limit} members`);

/// Emails from a pasted list: one per line or separated by commas, with
/// or without a name ("Ray Kim <ray@x.com>"); lowercased, once each.
export function emailsIn(text) {
  const found = String(text || "").match(/[^\s<>,;"']+@[^\s<>,;"']+\.[^\s<>,;"']+/g) || [];
  return [...new Set(found.map((e) => e.toLowerCase()))];
}

/// Adding past the plan's organizer limit (App Dev's 0082 organizer_cap,
/// carrying { limit, used } in the error's details): said plainly.
export function capWords(data) {
  let extra = {};
  try { extra = typeof data?.details === "string" ? JSON.parse(data.details) : data?.details || {}; } catch { extra = {}; }
  const limit = data?.limit ?? extra.limit;
  return Number.isInteger(limit) ? `Your plan has room for ${limit} organizers. Remove someone or upgrade to add more.` : WORDS.organizer_cap;
}

/// The club's owner (0082's owner flag; before it, the admin): billing is theirs.
export const isOwner = (o) => (typeof o?.owner === "boolean" ? o.owner : o?.role === "admin");

/// "3 of 5 organizers", or "3 organizers" with no limit from the server.
export const organizersLine = (cap) => (cap?.limit == null ? `${cap?.used ?? 0} organizer${cap?.used === 1 ? "" : "s"}` : `${cap.used} of ${cap.limit} organizers`);

/// A directory search term, safe inside PostgREST's or=(…ilike.*q*…).
export const searchTerm = (q) => String(q || "").replace(/[^\p{L}\p{N} &'.-]/gu, " ").trim().replace(/\s+/g, " ").slice(0, 60);

class Failure extends Error {}
const WORDS = {
  sign_in: "Please sign in again.",
  not_admin: "Only the club's admins can change this.",
  not_organizer: "Only the club's organizers can do that.",
  member_cap: "That's more members than the plan has room for.",
  organizer_cap: "Your plan is full. Remove an organizer or upgrade to add more.",
  book_full: "Your club's list is full (5,000 people). Remove some to add more.",
  not_owner: "Only the club's owner can change the plan and billing.",
  bad_input: "Something in that didn't work. Check it and try again.",
  not_found: "That club wasn't found.",
  subscribed: "You're already on a plan. Change it with Manage billing.",
  not_configured: "Plans can't be bought yet. Try again soon.",
};

async function call(url, body, method = "POST") {
  const token = await accessToken().catch(() => null);
  if (!token) throw Object.assign(new Failure(WORDS.sign_in), { code: "sign_in" });
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error || data?.message;
    // 0082: removing the club's owner is refused with bad_input, detail "the owner".
    if (code === "bad_input" && /the owner/.test(String(data?.details || data?.detail || ""))) throw Object.assign(new Failure("The club's owner can't be removed."), { code: "owner" });
    throw Object.assign(new Failure(code === "organizer_cap" ? capWords(data) : WORDS[code] || "Something went wrong. Try again."), { code });
  }
  return data;
}
const rpc = (name, body = {}) => call(`${SUPABASE_URL}/rest/v1/rpc/${name}`, body);
const billing = (body) => call(`${SUPABASE_URL}/functions/v1/org-billing`, body);
const read = (path) => call(`${SUPABASE_URL}/rest/v1/${path}`, null, "GET");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

// ── the page ──

let orgs = [];
let org = null;
let members = null;
let plan = null; // org-billing status

async function start() {
  const signedIn = !!localStorage.getItem(SESSION_KEY) && !!(await accessToken().catch(() => null));
  if (!signedIn) {
    status("");
    $("o-signin").hidden = false;
    $("o-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: "/club/" }));
    return;
  }
  // Invitations waiting for this email join first (contract §1a).
  await rpc("account_claim").catch(() => {});
  wireRegister();
  wireOrg();
  wireBook();
  await loadOrgs();
  const q = new URLSearchParams(location.search);
  if (q.get("paid")) {
    $("o-plan-said").textContent = "Thanks. Your plan starts as soon as Stripe confirms it, usually within a minute.";
    setTimeout(() => loadOrgs(), 4000);
  }
}

async function loadOrgs(prefer) {
  try {
    orgs = (await rpc("orgs_mine")) || [];
  } catch (failure) {
    return status(failure.message);
  }
  status("");
  const want = prefer || new URLSearchParams(location.search).get("org") || org?.id;
  org = orgs.find((o) => o.id === want) || orgs[0] || null;
  $("o-register").hidden = !!org;
  $("o-org").hidden = !org;
  if (!org) {
    if (!$("o-contact").value) $("o-contact").value = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}")?.user?.email || "";
    return;
  }
  members = null;
  plan = null;
  renderOrg();
  loadMembers();
  loadBook();
  if (isOwner(org) && org.tier !== "none") billing({ action: "status", org_id: org.id }).then((s) => { plan = s; renderPlan(); renderMembers(); }).catch(() => {});
}

function renderOrg() {
  $("o-kind").textContent = KIND_WORDS[org.kind] || "";
  $("o-title").textContent = org.name;
  $("o-approval").textContent = org.approved ? "" : "Waiting for approval. We approve new clubs by hand, usually the same day. Until then you can plan drives and send them to yourself.";
  $("o-approval").hidden = org.approved;
  $("o-pick-row").hidden = orgs.length < 2;
  $("o-pick").replaceChildren(...orgs.map((o) => {
    const option = el("option", "", o.name);
    option.value = o.id;
    option.selected = o.id === org.id;
    return option;
  }));
  $("o-details").hidden = false;
  $("o-org-name").value = org.name;
  $("o-reply").value = org.contact_email || "";
  // Billing is the owner's alone (App Dev's 0082 owner flag).
  $("o-plan").hidden = !isOwner(org);
  $("o-members").hidden = false;
  $("o-book").hidden = false;
  $("o-plan-link").href = `/plan/?group`;
  renderPlan();
}

function renderPlan() {
  if (!org) return;
  const on = org.tier !== "none";
  $("o-plan-line").textContent = on ? planLine(org.tier) : "No plan yet.";
  // In a trial (org-billing's trial_ends_at): the day it ends, and whether it's charged then.
  const renew = plan?.trial_ends_at
    ? (plan.cancel_at_period_end ? `Free trial, ends ${dateText(plan.trial_ends_at)}. Nothing will be charged.` : `Free trial until ${dateText(plan.trial_ends_at)}, then billed by the year.`)
    : plan?.renews_at ? (plan.cancel_at_period_end ? `Ends ${dateText(plan.renews_at)}.` : `Renews ${dateText(plan.renews_at)}.`) : "";
  const next = plan?.next ? ` Changes to ${BY_PLAN[plan.next.plan]?.name || plan.next.plan} on ${dateText(plan.next.at)}.` : "";
  $("o-renew").textContent = `${renew}${next}`.trim();
  const groupPlan = on && BY_TIER[org.tier]?.for === "organizers";
  // One trial per organizer and per club, kept by the server (trial_used).
  $("o-free").textContent = groupPlan ? ""
    : org.trial_used ? "Group drives need Group or Club."
    : "Group drives need Group or Club. Try either free for 30 days.";
  $("o-bigger-link").href = `mailto:${CONTACT}`;
  $("o-bigger-link").textContent = CONTACT;
  $("o-portal").hidden = !on;
  $("o-plans").hidden = on;
  // Group and Club for every club; Individual, Apex for one driver, for Just me.
  $("o-plans").replaceChildren(...PLANS.filter((p) => p.for === "organizers" || (p.plan === "solo" && org.kind === "solo")).map((p) => {
    const card = el("li", "o-plan-card");
    const what = planLine(p.tier).replace(/^[^:]+: /, "");
    card.append(el("b", "", p.name));
    if (p.tagline) card.append(el("span", "o-tagline", p.tagline));
    card.append(el("span", "", what.charAt(0).toUpperCase() + what.slice(1)), el("span", "o-price", p.price + (p.trial ? `, ${p.trial}` : "")));
    if (splitLine(p)) card.append(el("span", "o-tagline", splitLine(p)));
    const row = el("div", "o-plan-buttons");
    for (const interval of p.monthly ? ["year", "month"] : ["year"]) {
      const b = el("button", "go", p.monthly ? (interval === "year" ? "Yearly" : "Monthly") : p.trial && !org.trial_used ? "Start your free trial" : `Choose ${p.name}`);
      b.type = "button";
      b.addEventListener("click", () => checkout(p.plan, interval, b));
      row.append(b);
    }
    card.append(row);
    return card;
  }));
}

async function checkout(planName, interval, button) {
  button.disabled = true;
  $("o-plan-said").textContent = "Opening Stripe…";
  try {
    const { url } = await billing({ action: "checkout", org_id: org.id, plan: planName, interval });
    location.href = url;
  } catch (failure) {
    $("o-plan-said").textContent = failure.message;
    button.disabled = false;
  }
}

async function loadMembers() {
  try {
    members = await rpc("org_members", { p_org_id: org.id });
  } catch (failure) {
    $("o-members-said").textContent = failure.message;
    return;
  }
  renderMembers();
}

let removing = null;
function renderMembers() {
  if (!members) return;
  // The limit is the server's, per plan (org_json's organizer_cap, 0082);
  // none given, just the count.
  const cap = org.organizer_cap || members.member_cap || { limit: null, used: members.members.length };
  $("o-seats").textContent = organizersLine(cap);
  const fill = cap.limit == null ? 0 : Math.min(1, cap.used / Math.max(1, cap.limit));
  $("o-seat-meter").hidden = cap.limit == null;
  $("o-seat-meter").firstElementChild.style.width = `${Math.round(fill * 100)}%`;
  const full = cap.limit != null && cap.used >= cap.limit;
  const next = BY_TIER[members.next_tier];
  $("o-full").hidden = !full;
  // At the cap: the bigger plan, or (on the biggest) a custom quote.
  $("o-full").textContent = next ? `Your plan is full. ${next.name} has room for ${BY_TIER[next.tier]?.organizers ?? "more"} organizers.` : `Your plan is full. Need more organizers? Write to ${CONTACT}.`;
  $("o-invite-box").hidden = false;
  renderInviteRows();
  $("o-member-list").replaceChildren(...members.members.map((m) => {
    const li = el("li", "o-member");
    const who = el("div", "o-who");
    who.append(el("b", "", m.email), el("span", "", m.joined ? `Joined ${dateText(m.joined_at)}` : `Invited ${dateText(m.invited_at)}, joins when they sign in to Carve`));
    if (m.owner) who.append(el("span", "chip", "Owner"));
    li.append(who);
    // The owner can't be removed (0082); everyone else, by any organizer.
    if (!m.owner) {
      const remove = el("button", "o-remove", removing === m.email ? "Remove for good" : "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `${removing === m.email ? "Confirm: remove" : "Remove"} ${m.email}`);
      remove.addEventListener("click", () => {
        if (removing !== m.email) { removing = m.email; return renderMembers(); }
        removing = null;
        change(() => rpc("org_member_remove", { p_org_id: org.id, p_email: m.email }), `${m.email} removed. Their access and their Apex from the club end now.`);
      });
      li.append(remove);
    }
    return li;
  }));
  // Former members: their seat lapsed; adding one back is a fresh invite.
  const former = members.former || [];
  $("o-former-h").hidden = !former.length;
  $("o-former").replaceChildren(...former.map((f) => {
    const li = el("li", "o-member");
    const who = el("div", "o-who");
    who.append(el("b", "", f.email), el("span", "", `Seat ended ${dateText(f.lapsed_at)}`));
    li.append(who);
    const back = el("button", "o-remove", "Add back");
    back.type = "button";
    back.addEventListener("click", () => change(() => rpc("org_member_invite", { p_org_id: org.id, p_emails: [f.email] }), `${f.email} added back.`));
    li.append(back);
    return li;
  }));
}

// ── the members: the club's address book (App Dev's org_book calls) ──
let book = null;
let bookRows = ["", "", ""];
let bookRemoving = null;
/// People from rows and pasted lines: "Ray Kim <ray@x.com>" keeps the
/// name, an address twice keeps the one with a name; pieces with an @ that
/// aren't addresses come back as bad. → { people, bad }
export function peopleIn(text) {
  const by = new Map();
  const bad = [];
  for (const piece of String(text || "").split(/[\n,;]+/)) {
    const email = emailsIn(piece)[0];
    if (!email) { if (piece.includes("@")) bad.push(piece.trim()); continue; }
    const name = piece.replace(/<[^>]*>/g, "").replace(/[^\s<>,;"']+@[^\s<>,;"']+/g, "").replace(/["']/g, "").trim();
    if (!by.has(email) || (name && !by.get(email).name)) by.set(email, { email, ...(name ? { name } : {}) });
  }
  return { people: [...by.values()], bad };
}
async function loadBook() {
  try {
    book = await rpc("org_book", { p_org_id: org.id }) || [];
  } catch (failure) {
    book = null;
    $("o-book-said").textContent = failure.message;
  }
  renderBook();
}
function renderBook() {
  $("o-book-rows").replaceChildren(...bookRows.map((v, i) => {
    const row = el("div", "o-invite-row");
    const input = el("input", "cp-in");
    input.type = "text";
    input.value = v;
    input.placeholder = i === 0 ? "Ray Kim <ray@example.com>" : "";
    input.setAttribute("aria-label", `Member ${i + 1}`);
    input.addEventListener("input", () => { bookRows[i] = input.value; });
    row.append(input);
    return row;
  }));
  if (!book) return;
  $("o-book-count").textContent = `${book.length} ${book.length === 1 ? "member" : "members"}`;
  $("o-book-list").replaceChildren(...book.map((m) => {
    const li = el("li", "o-member");
    const who = el("div", "o-who");
    who.append(el("b", "", m.name || m.email), el("span", "", m.name ? m.email : ""));
    if (m.experienced) who.append(el("span", "chip", "Experienced"));
    const remove = el("button", "o-remove", bookRemoving === m.email ? "Remove for good" : "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `${bookRemoving === m.email ? "Confirm: remove" : "Remove"} ${m.email}`);
    remove.addEventListener("click", () => {
      if (bookRemoving !== m.email) { bookRemoving = m.email; return renderBook(); }
      bookRemoving = null;
      bookChange(() => rpc("org_book_remove", { p_org_id: org.id, p_emails: [m.email] }), `${m.name || m.email} removed from the list.`);
    });
    li.append(who, remove);
    return li;
  }));
}
async function bookChange(work, done) {
  $("o-book-said").textContent = "";
  try {
    const next = await work();
    if (Array.isArray(next?.book)) book = next.book;
    else await loadBook();
    $("o-book-said").textContent = typeof done === "function" ? done(next) : done;
  } catch (failure) {
    $("o-book-said").textContent = failure.message;
  }
  renderBook();
}
function wireBook() {
  $("o-book-add-row").addEventListener("click", () => { bookRows.push(""); renderBook(); $("o-book-rows").lastElementChild?.querySelector("input")?.focus(); });
  $("o-book-paste-open").addEventListener("click", () => { $("o-book-paste-box").hidden = false; $("o-book-paste").focus(); });
  $("o-book-add").addEventListener("click", () => {
    const { people, bad } = peopleIn([...bookRows, $("o-book-paste").value].join("\n"));
    if (!people.length) return ($("o-book-said").textContent = bad.length ? `Couldn't read ${bad.join(", ")} as an email address.` : "Add an email address first.");
    bookChange(async () => {
      const next = await rpc("org_book_add", { p_org_id: org.id, p_people: people });
      bookRows = ["", "", ""];
      $("o-book-paste").value = "";
      $("o-book-paste-box").hidden = true;
      return next;
    }, (next) => {
      const added = next?.added ?? people.length;
      const merged = next?.merged ?? 0;
      const invalid = [...bad, ...(next?.invalid || [])];
      return [`Added ${added} ${added === 1 ? "member" : "members"}.`, merged ? `${merged} ${merged === 1 ? "was" : "were"} on the list already.` : "",
        invalid.length ? `Couldn't read ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? ` and ${invalid.length - 3} more` : ""}.` : ""].filter(Boolean).join(" ");
    });
  });
}

// The invite rows (the mock's club page): one email per row, 3 to start,
// "Add row" for more; the people list is just below.
let inviteRows = ["", "", ""];
function renderInviteRows() {
  $("o-invite-rows").replaceChildren(...inviteRows.map((v, i) => {
    const row = el("div", "o-invite-row");
    const input = el("input", "cp-in");
    input.type = "email";
    input.value = v;
    input.placeholder = i === 0 ? "maya@example.com" : "";
    input.setAttribute("aria-label", `Email ${i + 1}`);
    input.addEventListener("input", () => { inviteRows[i] = input.value; });
    row.append(input);
    return row;
  }));
}

async function change(work, done) {
  $("o-members-said").textContent = "";
  try {
    const next = await work();
    if (next?.members) members = next;
    else await loadMembers();
    renderMembers();
    $("o-members-said").textContent = done;
  } catch (failure) {
    $("o-members-said").textContent = failure.message;
    await loadMembers();
  }
}

function wireOrg() {
  $("o-pick").addEventListener("change", (e) => {
    history.replaceState(null, "", `/club/?org=${e.target.value}`);
    loadOrgs(e.target.value);
  });
  $("o-save").addEventListener("click", async () => {
    const name = $("o-org-name").value.trim();
    const reply = $("o-reply").value.trim();
    if (!name) return ($("o-details-said").textContent = "Add the name.");
    if (!emailsIn(reply).length) return ($("o-details-said").textContent = "Add the email replies should go to.");
    try {
      org = { ...org, ...(await rpc("org_update", { p_org_id: org.id, p_patch: { name, contact_email: reply } })) };
      $("o-details-said").textContent = "Saved.";
      renderOrg();
    } catch (failure) {
      $("o-details-said").textContent = failure.message;
    }
  });
  $("o-portal").addEventListener("click", async () => {
    $("o-portal").disabled = true;
    try {
      const { url } = await billing({ action: "portal", org_id: org.id });
      location.href = url;
    } catch (failure) {
      $("o-plan-said").textContent = failure.message;
      $("o-portal").disabled = false;
    }
  });
  $("o-invite-add").addEventListener("click", () => { inviteRows.push(""); renderInviteRows(); $("o-invite-rows").lastElementChild?.querySelector("input")?.focus(); });
  $("o-invite-go").addEventListener("click", async () => {
    // One email per row; a row with several (pasted) counts them all.
    const emails = [...new Set(inviteRows.flatMap((r) => emailsIn(r)))];
    if (!emails.length) return ($("o-members-said").textContent = "Add an email address in a row.");
    let joined = 0;
    await change(async () => {
      const next = await rpc("org_member_invite", { p_org_id: org.id, p_emails: emails });
      inviteRows = ["", "", ""];
      renderInviteRows();
      // People with a Carve account already join at once (contract 1a).
      joined = emails.filter((e) => next?.members?.some((m) => m.email === e && m.joined)).length;
      return next;
    }, "");
    if ($("o-members-said").textContent) return;
    const who = emails.length === 1 ? emails[0] : `${emails.length} people`;
    $("o-members-said").textContent = joined === emails.length
      ? `${who} ${emails.length === 1 ? "has" : "have"} joined.`
      : joined
        ? `${who} invited: ${joined} joined now, the rest when they sign in to Carve with their email.`
        : `${who} invited. They join when they sign in to Carve with that email.`;
  });
}

// ── registering ──

let regKind = "club";
let club = null;
let region = null;

function wireRegister() {
  for (const input of document.querySelectorAll('input[name="o-kind"]')) {
    input.addEventListener("change", () => {
      regKind = input.value;
      $("o-club-pick").hidden = regKind !== "club";
      $("o-name-row").hidden = regKind === "solo";
      $("o-name-label").firstChild.textContent = regKind === "club" ? "Name on Carve" : "Group name";
    });
  }
  let timer = 0;
  $("o-club-q").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(searchClubs, 250);
  });
  $("o-region-q").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(searchRegions, 250);
  });
  $("o-club-change").addEventListener("click", () => {
    club = null;
    region = null;
    $("o-club-chosen").hidden = true;
    $("o-club-search").hidden = false;
    $("o-club-q").focus();
  });
  $("o-register-go").addEventListener("click", register);
}

async function searchClubs() {
  const q = searchTerm($("o-club-q").value);
  if (q.length < 2) return $("o-club-hits").replaceChildren();
  try {
    const found = await read(`clubs?select=id,name,short_name,place&active=eq.true&or=(name.ilike.*${encodeURIComponent(q)}*,short_name.ilike.*${encodeURIComponent(q)}*)&order=popularity.desc.nullslast&limit=8`);
    $("o-club-hits").replaceChildren(...(found || []).map((c) => hit(`${c.name}${c.short_name && c.short_name !== c.name ? ` (${c.short_name})` : ""}`, c.place, () => pickClub(c))));
    if (!found?.length) $("o-club-hits").append(el("li", "cp-note", "Not in the directory? Register as a group instead."));
  } catch {
    $("o-club-hits").replaceChildren(el("li", "cp-note", "Couldn't search the directory. Try again."));
  }
}

function hit(title, sub, pick) {
  const li = el("li");
  const b = el("button", "o-hit");
  b.type = "button";
  b.append(el("b", "", title));
  if (sub) b.append(el("span", "", sub));
  b.addEventListener("click", pick);
  li.append(b);
  return li;
}

function pickClub(c) {
  club = c;
  region = null;
  $("o-reg-said").textContent = "";
  $("o-club-hits").replaceChildren();
  $("o-club-search").hidden = true;
  $("o-club-chosen").hidden = false;
  $("o-club-name").textContent = c.name;
  $("o-region-q").value = "";
  $("o-region-hits").replaceChildren();
  if (!$("o-name").value) $("o-name").value = c.name;
}

async function searchRegions() {
  if (!club) return;
  const q = searchTerm($("o-region-q").value);
  region = null;
  if (q.length < 2) return $("o-region-hits").replaceChildren();
  try {
    const found = await read(`club_regions?select=id,name,place&club_id=eq.${encodeURIComponent(club.id)}&active=eq.true&or=(name.ilike.*${encodeURIComponent(q)}*,place.ilike.*${encodeURIComponent(q)}*)&order=name&limit=8`);
    $("o-region-hits").replaceChildren(...(found || []).map((r) => hit(r.name, r.place, () => {
      region = r;
      $("o-region-q").value = r.name;
      $("o-region-hits").replaceChildren();
      $("o-name").value = `${club.short_name || club.name} ${r.name}`.slice(0, 80);
    })));
  } catch {
    $("o-region-hits").replaceChildren();
  }
}

async function register() {
  const say = (t) => { $("o-reg-said").textContent = t; };
  const contact = emailsIn($("o-contact").value)[0];
  const name = regKind === "solo" ? "" : $("o-name").value.trim();
  if (regKind === "club" && !club) return say("Find your club in the directory, or register as a group.");
  if (regKind !== "solo" && !name) return say("Add a name.");
  if (!contact) return say("Add the email replies should go to.");
  $("o-register-go").disabled = true;
  try {
    const made = await rpc("org_create", {
      p_kind: regKind,
      p_name: regKind === "solo" ? contact.split("@")[0] : name,
      p_contact_email: contact,
      p_club_id: regKind === "club" ? club.id : null,
      p_region_id: regKind === "club" && region ? region.id : null,
    });
    history.replaceState(null, "", `/club/?org=${made.id}`);
    await loadOrgs(made.id);
  } catch (failure) {
    say(failure.message);
  } finally {
    $("o-register-go").disabled = false;
  }
}

if (typeof document !== "undefined" && document.getElementById("o-org")) start();
