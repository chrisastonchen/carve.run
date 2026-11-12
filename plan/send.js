// The Send step: who the drive goes to, through App Dev's drive-send
// (docs/Club-Server-Contract.md on club-server, section 5). Myself always
// works; Leads and sweeps and Everyone need an approved organization on
// Group or Club, in its 30-day trial or paid (the user, 11/8: no free group
// drive). Past a day's Spots people are waitlisted, so Everyone has no cap
// gate (the user, 11/8 late). The draft uploads first (drive-sync.js), so
// what's sent is what's on screen. The gates are pure and tested; the server has the
// last word on each.

import { syncWithServer } from "./drive-merge.js";
import { lastPrerun, todayIso } from "./versions.js";
import { linkCard } from "./link-card.js";

export const AUDIENCES = ["me", "leads", "everyone"];
/// The Send step's two modes (the user, 11/8 late): "invites", the
/// invitation (no route) to the invited; "route", the route to everyone going.
export const MODES = ["invites", "route"];
const CODES = ["sign_in", "not_organizer", "not_found", "bad_input", "not_approved", "needs_plan", "cap", "not_configured"];

/// Our words for each of the server's codes.
export const CODE_WORDS = {
  sign_in: "Please sign in again.",
  not_organizer: "You're not an organizer for this club.",
  not_found: "This drive wasn't found. Try again.",
  bad_input: "Part of the drive didn't save. Check each step and try again.",
  not_approved: "Waiting for approval. You can send to yourself until then.",
  needs_plan: "Group drives need Group or Club.",
  // Only the server's own limit now (past Spots, people are waitlisted).
  cap: "This drive is past the most Carve sends for one drive. Write to chris@carve.run.",
  not_configured: "Email isn't switched on yet. Nothing was sent.",
};

/// A code's words for this org: needs_plan offers the trial until the org
/// or its organizer has had one (the server keeps one each).
export const whyWords = (why, org) =>
  why === "needs_plan" && !org?.trial_used ? `${CODE_WORDS.needs_plan} Try either free for 30 days.` : CODE_WORDS[why] || "";

/// A Club drive with a pre-run still to come, its route not yet sent to
/// everyone: the pre-run date, else null.
export function crewTime(drive, org) {
  if (org?.tier !== "club" || drive.prerun?.on === false || routeSent(drive)) return null;
  const last = lastPrerun(drive);
  return last && todayIso() <= last ? last : null;
}

/// The Send step's own reasons, by mode: what's missing before it can go.
const MISSING_WORDS = {
  nobody: (m) => (m === "invites" ? "Add people to invite on Attendees first." : "Nobody is going yet."),
  no_description: () => "Add a description on When first: it's on the invitation.",
  no_city: () => "Add the meet city for each day on When first.",
  no_spots: () => "Add how many spots each day has on When first.",
  no_route: () => "Add a route for each day on Route first.",
};

/// The short code in a failed call: PostgREST's `message`, or drive-send's
/// `error` (402 needs_plan|cap, 403, 400, 401, 503 not_configured).
export function codeOf(failure) {
  const data = failure?.data;
  return [data?.code, data?.error, data?.message, failure?.message].find((c) => CODES.includes(c)) || null;
}

/// The leads and sweeps of any day, once each.
export function leadIds(drive) {
  const ids = new Set();
  for (const d of drive.days) for (const g of drive.boards?.[d.id]?.groups || []) for (const id of [g.lead, g.sweep]) if (id) ids.add(id);
  return [...ids].filter((id) => drive.attendees.some((p) => p.id === id));
}

/// Everyone the drive goes to: all but those who said No.
export const everyoneCount = (drive) => drive.attendees.filter((p) => p.status !== "no").length;

/// Group drives are Group's and Club's, trialing or paid (Stripe's trialing
/// sets the tier like a paid plan). Free and Individual have none (the user, 11/8);
/// a drive sent before a plan ended keeps its links, but sending again needs one.
const groupPlan = (org) => org.tier === "group" || org.tier === "club";

/// The invited, not yet going: who an invitation is for.
export const invitedCount = (drive) => drive.attendees.filter((p) => p.status === "invited").length;
/// Who's going (Registered and Going, not waitlisted on every day): who the route is for.
export const goingCount = (drive) => drive.attendees.filter((p) => (p.status === "going" || p.status === "registered")
  && !(Array.isArray(p.waitlisted) && p.waitlisted.length && p.waitlisted.length >= (Array.isArray(p.days) ? p.days.length : drive.days.length))).length;

/// What an invitation needs (11/8 late): each day's date, times and meet
/// city (or place), and the description. → a reason, or null.
export function invitationMissing(drive, org = null) {
  if (!(drive.description || "").trim()) return "no_description";
  if (drive.days.some((d) => !d.date || !d.meet || !(d.city || d.place))) return "no_city";
  // Club says how many each day (no "No cap", the user's UX pass 11/9).
  if (org?.tier === "club" && drive.days.some((d) => !(Number.isInteger(d.spots) && d.spots > 0))) return "no_spots";
  return null;
}
/// What the route needs: a route for every day.
export const routeMissing = (drive) => (drive.days.every((d) => (d.legs || []).some((l) => l.plan?.path)) ? null : "no_route");

/// Each audience: can it go, and if not, why (a code from CODE_WORDS, or
/// one of no_leads, nobody, no_description, no_city, no_route). `me` always
/// goes. In "invites" mode Everyone is the invitation to the invited; in
/// "route" mode, the route to everyone going. → { me, leads, everyone }
export function gates(drive, org, mode = "route") {
  const all = { me: { ok: true, why: null } };
  const shared = !org?.approved ? "not_approved" : !groupPlan(org) ? "needs_plan" : null;
  all.leads = shared ? { ok: false, why: shared } : !leadIds(drive).length ? { ok: false, why: "no_leads" } : { ok: true, why: null };
  // No upgrade gate (the user, 11/8 late): past a day's Spots, people are
  // waitlisted instead, on Group and Club.
  const missing = mode === "invites" ? invitationMissing(drive, org) : routeMissing(drive);
  const nobody = mode === "invites" ? !invitedCount(drive) : !goingCount(drive);
  all.everyone = shared ? { ok: false, why: shared } : missing ? { ok: false, why: missing } : nobody ? { ok: false, why: "nobody" } : { ok: true, why: null };
  return all;
}

/// Invitations sent, and the route sent: the two sends' steps done.
export const invitesSent = (drive) => (drive.server?.sends || []).some((s) => !s.test && s.audience === "everyone" && (s.kind === "invite" || s.kind === "auto"));
/// The route: drive_get's route_sent_at (0070), else a route send in the
/// history (Everyone not as an invitation before 0070, or the route send).
export const routeSent = (drive) => !!drive.server?.route_sent_at
  || (drive.server?.sends || []).some((s) => !s.test && (s.audience === "route" || (s.audience === "everyone" && s.kind !== "invite")));

/// Send the route to everyone going: 0070's route send (the confirmed who
/// haven't had it, then what changed), never Everyone, which would invite
/// the invited again. New invitations stay Everyone's. → drive-send's body
export function sendBody(driveId, audience, { mode, kind, routeOut, preRun = false }) {
  if (audience === "everyone" && mode === "route" && !preRun && kind !== "invite") return { drive_id: driveId, audience: "route", kind: routeOut ? "update" : "auto" };
  const auto = audience === "me" || preRun || !routeOut;
  const sendKind = mode === "invites" && !preRun ? "invite" : auto ? "auto" : kind;
  return { drive_id: driveId, audience, kind: sendKind, ...(preRun ? { pre_run: true } : {}) };
}

/// Sent beyond Myself yet? Then a send is an update or new invitations.
export const sentForReal = (drive) => (drive.server?.sends || []).some((s) => !s.test && s.audience !== "me");

/// The answer in a line.
export function resultLine(audience, answer) {
  if (audience === "me") return answer?.failed ? "It couldn't be sent. Try again." : "Sent to you. Check your inbox.";
  const sent = answer?.sent ?? 0;
  const parts = [sent === 0 ? "Nobody needed this one." : `Sent to ${sent === 1 ? "1 person" : `${sent} people`}.`];
  if (answer?.skipped_unsubscribed) parts.push(`${answer.skipped_unsubscribed} unsubscribed and ${answer.skipped_unsubscribed === 1 ? "wasn't" : "weren't"} sent it.`);
  if (answer?.failed) parts.push(`${answer.failed} couldn't be sent.`);
  return parts.join(" ");
}

const AUDIENCE_WORDS = { me: "Myself", leads: "Leads and sweeps", everyone: "Everyone", route: "Everyone going", waitlist: "Off the waitlist" };
const KIND_WORDS = { auto: "Invitations and details", invite: "New invitations", update: "What changed", reminder: "Reminder" };
/// A route send's first is the route itself, not invitations.
const kindWords = (s) => (s.audience === "route" && s.kind === "auto" ? "The route" : KIND_WORDS[s.kind] || s.kind);

/// The history, newest first: "Sat, Nov 8, 3:12 PM", "Everyone · What changed · 31".
export function historyRows(sends = [], locale = undefined) {
  return [...sends]
    .sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))
    .map((s) => ({
      when: new Date(s.sent_at).toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
      what: [AUDIENCE_WORDS[s.audience] || s.audience, kindWords(s), s.audience === "me" || s.test ? "test" : `${s.count ?? 0}`].join(" · "),
    }));
}

/// What the page keeps of drive_get: the history, each day's counts and
/// cap, and the drive's link (not the roster: that's the draft's).
export const keepServer = (got) =>
  got && {
    status: got.status, url: got.url, token: got.token, route_sent_at: got.route_sent_at ?? null,
    sends: got.sends || [],
    days: (got.days || []).map((d) => ({ id: d.id, counts: d.counts, cap: d.cap, limit: d.limit ?? d.cap?.limit ?? null })),
    // App Dev's (11/9): the route link (its own token, not the invitation's),
    // who checked in on it, Club offered past the plan, and removed check-ins.
    route_link: got.route_link ?? null,
    checkins: got.checkins ?? null,
    offer_club: !!got.offer_club,
    removed_checkins: got.removed_checkins || [],
    // The Pre-run step's (App Dev's): date, link, crew, sent, reminder_on, notes, legs_over.
    prerun: got.prerun ?? null,
  };

/// The step, wired. `api` is the planner's (rpc, callFunction, account,
/// signIn, saveRoute); `drive()` the draft; `flush()` puts the planner's
/// leg into it and `adopt()` gives the planner back its saved id; `save()`
/// keeps it.
export function initSend({ $, el, api, drive, flush, adopt, save, pull = null, merged = () => {}, go = () => {}, linkRefusal = null }) {
  let orgs = null;
  let kind = "update";
  let armed = false;
  let sending = false;
  const org = () => orgs?.find((o) => o.id === drive().orgId) || null;
  // Which send this is: the Invitations step's, or Send the route's.
  const mode = () => (drive().step === "invites" ? "invites" : "route");

  // ── Send the route as the mock has it (11/9): the audiences as cards
  // with their counts, the ungrouped warning, the test's address and time,
  // the route link for the drivers' meeting, and the email itself. ──
  let card = null;
  let preview = { for: null, html: null, subject: "", to: "", failed: null, loading: false };
  let imagesOn = true;
  const people = (n) => (n === 1 ? "1 person" : `${n} people`);
  function renderRouteParts(d, o, m, { leads, everyone }) {
    const route = m === "route";
    for (const k of ["me", "leads", "everyone"]) {
      $(`sd-${k}-t`).hidden = !route;
      $(`sd-${k}-s`).hidden = !route;
    }
    $("g-send").classList.toggle("sd-cards", route);
    if (route) {
      $("sd-me-t").textContent = "Just me, as a test";
      $("sd-me-s").textContent = `${o.contact_email} · exactly what someone going gets`;
      $("sd-me").textContent = "Send me a test";
      $("sd-leads-t").textContent = "Leads and sweeps";
      $("sd-leads-s").textContent = `${people(leads)} · ${o.tier === "club" && d.prerun?.on !== false ? "includes the pre-run notes" : "the route and their groups"}`;
      $("sd-everyone-t").textContent = "Everyone going";
      $("sd-everyone-s").textContent = `${people(everyone)} · each sees their own group`;
      if (!armed) $("sd-everyone").textContent = `Send to ${people(everyone)}`;
    }
    // Club: people going who aren't in a group yet. Sending isn't stopped.
    const loose = route && o.tier === "club" ? ungroupedCount(d) : 0;
    $("sd-ungrouped").hidden = !loose;
    if (loose) {
      $("sd-ungrouped").replaceChildren(`${loose === 1 ? "1 person isn't" : `${loose} people aren't`} in a group yet. They'll get the route without a group. `);
      const fix = el("button", "textlink", "Put them in groups");
      fix.type = "button";
      fix.addEventListener("click", () => go("groups"));
      $("sd-ungrouped").append(fix, " or send now and use Send update later.");
    }
    // The last test: where it went and when.
    const test = [...(d.server?.sends || [])].filter((x) => x.test || x.audience === "me").sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
    $("sd-test-said").hidden = !route || !test;
    if (test) $("sd-test-said").textContent = `Test sent to ${o.contact_email} at ${new Date(test.sent_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. It can take a minute to arrive.`;
    // The route link (its own token, not the invitation's): App Dev's route_link.
    $("sd-link").hidden = !route;
    if (route) {
      const url = d.server?.route_link?.url ?? null;
      if (!card) {
        card = linkCard({
          el, url, label: "Route link", driveName: d.name || "Group drive",
          onRotate: async () => (await api.rpc("drive_route_link_open", { p_drive_id: drive().id, p_rotate: true }))?.url ?? null,
          ...(linkRefusal ? { refusal: linkRefusal } : {}),
        });
        $("sd-link").append(card);
      } else card.setUrl(url);
    }
    renderPreview(d, route);
  }
  /// Club drives: going people with no group on a day they're coming.
  function ungroupedCount(d) {
    const going = d.attendees.filter((p) => (p.status === "going" || p.status === "registered"));
    let n = 0;
    for (const p of going) {
      const days = Array.isArray(p.days) ? p.days : d.days.map((x) => x.id);
      if (days.some((id) => !Number.isInteger(d.boards?.[id]?.placements?.[p.id]) && (p.waitlisted || []).indexOf?.(id) < 0)) n++;
    }
    return n;
  }
  // The email as drive-send would send it (its preview: nothing sent, nothing recorded).
  function renderPreview(d, route) {
    $("sd-preview").hidden = !route;
    if (!route) return;
    const key = `${d.id}:${(d.server?.sends || []).length}:${routeSent(d)}`;
    if (preview.for !== key && !preview.loading && d.synced?.created && api.account()) loadPreview(d, key);
    $("sd-preview-subject").textContent = preview.subject;
    $("sd-preview-said").textContent = preview.failed || (preview.html ? "Some inboxes block images. Check both." : d.synced?.created ? "Loading the email…" : "The email shows here once the drive is saved to your account.");
    for (const [id, on] of [["sd-imgs-on", true], ["sd-imgs-off", false]]) $(id).setAttribute("aria-checked", String(imagesOn === on));
    const html = preview.html ? (imagesOn ? preview.html : preview.html.replace(/<img\b[^>]*>/gi, "")) : "";
    if ($("sd-preview-frame").srcdoc !== html) $("sd-preview-frame").srcdoc = html;
  }
  async function loadPreview(d, key) {
    preview = { ...preview, for: key, loading: true, failed: null };
    try {
      const got = await api.callFunction("drive-send", { drive_id: d.id, preview: true, kind: routeSent(d) ? "update" : "auto" });
      preview = { for: key, html: got?.html || null, subject: got?.subject || "", to: got?.to || "", failed: got?.html ? null : "The email preview isn't ready yet.", loading: false };
    } catch (failure) {
      preview = { ...preview, html: null, subject: "", loading: false, failed: "The email preview isn't available yet." };
    }
    if (drive().step === "send") renderPreview(drive(), true);
  }
  $("sd-imgs-on").addEventListener("click", () => { imagesOn = true; renderPreview(drive(), mode() === "route"); });
  $("sd-imgs-off").addEventListener("click", () => { imagesOn = false; renderPreview(drive(), mode() === "route"); });

  async function loadOrgs() {
    if (!api.account()) return (orgs = null);
    try {
      orgs = (await api.rpc("orgs_mine", {})) || [];
    } catch {
      orgs = [];
    }
    const d = drive();
    if (!orgs.some((o) => o.id === d.orgId) && orgs.length) {
      d.orgId = orgs[0].id;
      save();
    }
    return orgs;
  }

  async function render() {
    const d = drive();
    const signedIn = !!api.account();
    $("sd-sign-in").hidden = signedIn;
    if (signedIn && orgs === null) await loadOrgs();
    $("sd-register").hidden = !signedIn || !!orgs?.length;
    $("sd-from").hidden = !signedIn || !(orgs?.length > 1);
    $("sd-ready").hidden = !signedIn || !orgs?.length;
    if ($("sd-register").hidden === false && !$("sd-contact").value) $("sd-contact").value = api.account()?.email || "";
    if (!signedIn || !orgs?.length) return;
    $("sd-org").replaceChildren(...orgs.map((o) => {
      const option = el("option", "", o.name);
      option.value = o.id;
      option.selected = o.id === d.orgId;
      return option;
    }));
    const o = org();
    $("sd-org-line").textContent = `From ${o.name}. Replies go to ${o.contact_email}.`;
    const m = mode();
    const g = gates(d, o, m);
    const later = sentForReal(d);
    $("g-send-h").textContent = m === "invites" ? "Invitations" : "Send the route";
    $("sd-intro").textContent = m === "invites"
      ? "Invited people get the club, the day, the city and time, your description, and Going?. The route comes later, to everyone going."
      : "Send it to yourself first, then the leads and sweeps, then everyone going. Anyone who says Going later gets it too.";
    // What changed or New invitations: the route's updates only.
    $("sd-kinds").hidden = m === "invites" || !later;
    $("sd-leads-box").hidden = m === "invites";
    for (const k of ["update", "invite"]) $(`sd-kind-${k}`).setAttribute("aria-checked", String(kind === k));
    $("sd-kind-said").textContent = kind === "update" ? "Each person gets only their own changes, and nobody gets an email if nothing changed for them." : "Only the invited who haven't had an email yet.";
    const leads = leadIds(d).length;
    const everyone = m === "invites" ? invitedCount(d) : goingCount(d);
    // Before a Club drive's pre-run, leads and sweeps are the crew, and get version 1.
    const pre = crewTime(d, o);
    $("sd-leads").textContent = pre ? (leads ? `Send version 1 to the crew (${leads})` : "Send version 1 to the crew") : leads ? `Send to leads and sweeps (${leads})` : "Send to leads and sweeps";
    const what = m === "invites" ? "Send invitations" : "Send the route";
    $("sd-everyone").textContent = armed ? `${what} to ${everyone === 1 ? "1 person" : `${everyone} people`} now` : `${what} (${everyone})`;
    $("sd-everyone").classList.toggle("armed", armed);
    $("sd-cancel").hidden = !armed;
    $("sd-me").disabled = sending;
    $("sd-leads").disabled = sending || !g.leads.ok;
    $("sd-everyone").disabled = sending || !g.everyone.ok;
    $("sd-leads-why").textContent = g.leads.why === "no_leads" ? "Choose leads and sweeps on Groups first." : g.leads.why ? whyWords(g.leads.why, o) : "";
    $("sd-everyone-why").textContent = MISSING_WORDS[g.everyone.why]?.(m)
      ?? (g.everyone.why && (m === "invites" || g.everyone.why !== g.leads.why) ? whyWords(g.everyone.why, o) : "")
      // Sending before the pre-run is allowed (11/8 late), with a word.
      ?? "";
    if (m === "route" && pre && g.everyone.ok) $("sd-everyone-why").textContent = `The pre-run is ${new Date(`${pre}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}. Sending the route now sends version 1, before the crew has driven it.`;
    $("sd-upgrade").hidden = g.everyone.why !== "needs_plan";
    renderRouteParts(d, o, m, { leads, everyone });
    const rows = historyRows(d.server?.sends);
    $("sd-history-h").hidden = !rows.length;
    $("sd-history").replaceChildren(...rows.map((r) => {
      const li = el("li");
      li.append(el("b", "", r.what), el("span", "", r.when));
      return li;
    }));
  }

  /// Upload the draft, then send. `preRun` (with leads) adds the pre-run
  /// date; `said` is where the outcome goes (the drive page has its own).
  async function send(audience, { preRun = false, said = "sd-said", invites = false } = {}) {
    if (sending) return;
    if (!api.account()) return api.signIn();
    const d = drive();
    if (!org()) await loadOrgs();
    const o = org();
    if (!o) return;
    sending = true;
    armed = false;
    const say = (text) => { $(said).textContent = text; };
    say("Saving the drive…");
    render();
    try {
      flush();
      // The server's changes first: only what changed here goes up (QA S2).
      const { got, ...result } = await syncWithServer(d, {
        rpc: api.rpc,
        pull,
        orgId: o.id,
        club: o.tier === "club",
        // Always the organizer's own copy, named for the drive.
        saveRoute: (plan, label) => api.saveRoute({ ...plan, name: plan.name || [d.name || "Group drive", label].filter(Boolean).join(" · ") }),
      });
      adopt();
      d.server = keepServer(got);
      save();
      merged(result);
      // Both changed the same thing: the organizer chooses before it goes out.
      if (result.conflicts.length) return say("Someone else changed this drive too. Choose Keep theirs or Use mine, then send again.");
      say("Sending…");
      // Invitations: the invitation, to the invited not yet sent one (and a
      // test of it to Myself). The route: the route send to the confirmed,
      // then what changed; or new invitations.
      const answer = await api.callFunction("drive-send", sendBody(d.id, audience, { mode: invites ? "invites" : mode(), kind, routeOut: routeSent(d), preRun }));
      say(resultLine(audience, answer));
      d.server = keepServer(await api.rpc("drive_get", { p_drive_id: d.id })) || d.server;
      save();
    } catch (failure) {
      const code = codeOf(failure);
      say(code ? whyWords(code, o) : failure?.message || "Couldn't send. Try again.");
      if (code === "sign_in") api.signIn();
      if (["not_approved", "needs_plan", "cap", "not_organizer"].includes(code)) orgs = null; // its approval or plan may have changed
    } finally {
      sending = false;
      render();
    }
  }

  $("sd-sign-in-btn").addEventListener("click", () => api.signIn());
  $("sd-org").addEventListener("change", (e) => {
    drive().orgId = e.target.value;
    save();
    render();
  });
  for (const k of ["update", "invite"]) $(`sd-kind-${k}`).addEventListener("click", () => { kind = k; render(); });
  $("sd-me").addEventListener("click", () => send("me"));
  $("sd-leads").addEventListener("click", () => {
    const d = drive();
    send("leads", { preRun: !!crewTime(d, org()) });
  });
  // Everyone takes two taps: the first says how many.
  $("sd-everyone").addEventListener("click", () => {
    if (!armed) {
      armed = true;
      render();
      return;
    }
    send("everyone");
  });
  $("sd-cancel").addEventListener("click", () => { armed = false; render(); $("sd-everyone").focus(); });

  // Registering: who the drive is from (item 5's page adds the club directory).
  let regKind = "club";
  for (const b of $("sd-reg-kinds").querySelectorAll("button")) {
    b.addEventListener("click", () => {
      regKind = b.dataset.kind;
      for (const x of $("sd-reg-kinds").querySelectorAll("button")) x.setAttribute("aria-checked", String(x === b));
      $("sd-name-row").hidden = regKind === "solo";
    });
  }
  $("sd-reg-go").addEventListener("click", async () => {
    const name = $("sd-name").value.trim();
    const email = $("sd-contact").value.trim();
    if (regKind !== "solo" && !name) return ($("sd-reg-said").textContent = "Add the club or group's name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return ($("sd-reg-said").textContent = "Add the email replies should go to.");
    $("sd-reg-go").disabled = true;
    try {
      const made = await api.rpc("org_create", { p_kind: regKind, p_name: regKind === "solo" ? api.account()?.name || email.split("@")[0] : name, p_contact_email: email });
      drive().orgId = made?.id;
      save();
      orgs = null;
      $("sd-reg-said").textContent = "";
      await render();
      $("sd-said").textContent = "Registered. We approve new clubs by hand, usually the same day. Until then you can send to yourself.";
    } catch (failure) {
      $("sd-reg-said").textContent = CODE_WORDS[codeOf(failure)] || failure?.message || "Couldn't register. Try again.";
    } finally {
      $("sd-reg-go").disabled = false;
    }
  });

  // Saving as the organizer goes (Your drafts, the user 11/7): signed in
  // with a club, a drive not yet sent goes up to the server as a draft,
  // quietly. Sent drives wait for Send (their changes are an update).
  // → "saved", "local" (no club to keep it in), or null (nothing to do).
  let autosaving = false;
  const worthSaving = (d) => !!(d.name || d.attendees.length || d.days.some((x) => x.legs.some((l) => l.plan?.path)));
  async function autosave() {
    const d = drive();
    if (sending || autosaving || !api.account() || !worthSaving(d)) return null;
    if (d.server && d.server.status !== "draft") return null;
    if (orgs === null) await loadOrgs();
    // Every club you plan for (App Dev's 0082: no organizer roles; an old member row isn't one).
    const o = org() || orgs?.find((x) => x.role !== "member");
    if (!o) return "local";
    d.orgId = o.id;
    autosaving = true;
    try {
      flush();
      const { got, ...result } = await syncWithServer(d, {
        rpc: api.rpc,
        pull,
        orgId: o.id,
        club: o.tier === "club",
        saveRoute: (plan, label) => api.saveRoute({ ...plan, name: plan.name || [d.name || "Group drive", label].filter(Boolean).join(" · ") }),
      });
      adopt();
      d.server = keepServer(got);
      save();
      merged(result);
      return "saved";
    } catch {
      return "failed";
    } finally {
      autosaving = false;
    }
  }

  return {
    render,
    refresh: () => { orgs = null; return render(); },
    send,
    /// Invitations to everyone not yet sent one (32512's Attendees, 11/9):
    /// the Invitations step's send, from anywhere. → as send.
    sendInvitations: (opts = {}) => send("everyone", { ...opts, invites: true }),
    autosave,
    get autosaving() { return autosaving; },
    /// Saving or sending: the page doesn't merge the server's meanwhile.
    get busy() { return sending || autosaving; },
    /// The gates for the drive page's own buttons (null until orgs load).
    gates: async () => {
      if (orgs === null) await loadOrgs();
      return org() ? gates(drive(), org()) : null;
    },
  };
}
