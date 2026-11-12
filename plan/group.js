// Plan a group drive (Club-Sprint-Requirements.md §1, the user 2026-11-08):
// the planner with a step bar, When · Route · Stops · Attendees · Groups ·
// Send. Route and Stops are the planner's own rows and map; When, and the
// steps after Stops, are this module's. Any step can be skipped and come
// back to; the draft saves as the organizer goes.
//
// Until the server's tables land (App Dev's contract, 11/9), the drive is
// kept in this browser: `carve.group.draft`. The route itself is the
// planner's plan, kept under its own draft key in group mode.

import { initBoard, initGroupsStep } from "./groups-board.js?v=3";
import { initAttendeesStep, routeLinkRefusal } from "./attendees-step.js";
import { initSend, invitesSent, keepServer, routeSent, sentForReal } from "./send.js?v=2";
import { initPage } from "./drive-page.js?v=4";
import { draftFromServer, initDrives } from "./drives-list.js?v=2";
import { conflictWords, mergeServer, resolveConflicts } from "./drive-merge.js";
import { creditNeeded, spotWords } from "./meet-words.js";
import { ask } from "./ask.js";
import { initPrerunStep } from "./prerun-step.js?v=2";
import { changesSince, prerunDateOf, withVersions } from "./versions.js";
import { usesMiles } from "./route-wire.js?v=7";
import { fromWaitlists, moved, openSpots, openText, placeText, waitingText, waitlistFields, waitlistFor } from "./waitlist.js";
import { FIELDS, STATUS_WORDS, counts, guessColumns, looksLikeHeader, merge, meterLine, parseInvites, parseTable, peopleFromTable } from "./attendees.js?v=1";

const DRAFT_KEY = "carve.group.draft";
// The planner's own draft of the leg on screen (plan.js, group mode).
const PLAN_KEY = "carve.group.plan";
/// The steps (the user, 11/8 late: invited people don't see the route, so
/// invitations can go before it exists): When, Attendees and Invitations,
/// then Route, Stops, Groups and Send the route. Any step can be opened.
/// Invitations and Send the route share the Send step's section (send.js).
export const STEPS = [
  { key: "when", label: "When" },
  { key: "route", label: "Route" },
  { key: "stops", label: "Stops" },
  { key: "prerun", label: "Pre-run" },
  { key: "attendees", label: "Attendees" },
  { key: "invites", label: "Invitations", section: "send" },
  { key: "groups", label: "Groups" },
  { key: "send", label: "Send the route" },
];
const sectionOf = (key) => STEPS.find((s) => s.key === key)?.section || key;

/// The five steps in the rail (the approved mock, 11/9), each over the
/// steps it holds for now: Stops goes into Route's "Roads and stops", and
/// Invitations into Attendees (32512's). Group plan: no Groups.
export const RAIL = [
  { key: "when", label: "When and how many", holds: ["when"] },
  { key: "route", label: "Route", holds: ["route", "stops"] },
  // Club drives with a pre-run only (Chris, 11/9).
  { key: "prerun", label: "Pre-run", holds: ["prerun"] },
  { key: "attendees", label: "Attendees", holds: ["attendees", "invites"] },
  { key: "groups", label: "Groups", holds: ["groups"] },
  { key: "send", label: "Send the route", holds: ["send"] },
];
/// The rail's entry a step is under.
export const railOf = (step) => RAIL.find((r) => r.holds.includes(step))?.key ?? null;

/// The meter under step 5: "2 of 5 done · not live until you send the route".
export function meterText(done, of, live) {
  return `${done} of ${of} done · ${live ? "the route is out" : "not live until you send the route"}`;
}

/// A day of the drive (§3, multi-day): its date, when people meet and when
/// they leave, where they meet (its first route's start), and its routes,
/// one or more legs (a morning leg, an afternoon leg), each the planner's
/// plan.
export function blankDay(today = new Date()) {
  const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7);
  return { id: crypto.randomUUID(), date: isoDay(next), meet: "07:30", leave: "08:00", place: null, legs: [blankLeg()] };
}
export const blankLeg = () => ({ id: crypto.randomUUID(), label: "", plan: null });

export function blankDrive() {
  // asked: what When has asked (ask.js), so the default date isn't an answer.
  return { id: crypto.randomUUID(), name: "", days: [blankDay()], notes: [], attendees: [], boards: {}, active: { day: 0, leg: 0 }, step: "when", asked: {}, updatedAt: Date.now() };
}

/// Where a route ends: its destination, else its last stop or waypoint.
export function endOf(plan) {
  if (!plan) return null;
  return plan.end || (plan.waypoints?.length ? plan.waypoints[plan.waypoints.length - 1] : null);
}

/// The day after `date` ("YYYY-MM-DD").
export function nextDate(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return isoDay(new Date(y, m - 1, d + 1));
}

/// A new day after `prev`: the next date, the same times, starting where
/// the previous day ended, with its groups, leads and sweeps copied
/// forward (§3: "Add a day copies the groups and leads forward").
export function dayAfter(prev, boards = {}) {
  const lastPlan = prev.legs?.[prev.legs.length - 1]?.plan;
  const end = endOf(lastPlan);
  const day = {
    ...blankDay(),
    date: nextDate(prev.date),
    meet: prev.meet,
    leave: prev.leave,
    place: end ? { label: end.label || end.name || "Where the day before ended", lat: end.lat, lon: end.lon } : prev.place ? { ...prev.place } : null,
  };
  const copied = boards[prev.id] ? JSON.parse(JSON.stringify(boards[prev.id])) : null;
  if (copied) copied.arrangedAt = copied.arrangedAt || null;
  return { day, board: copied };
}

export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/// "07:30" on "2026-12-12", in the browser's zone, as ms.
export function at(date, time) {
  const [y, mo, d] = String(date || "").split("-").map(Number);
  const [h, mi] = String(time || "").split(":").map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/// What's wrong with a day's times, if anything (the leave time is after
/// meeting, and the day isn't gone by).
export function dayProblem(day, now = Date.now()) {
  const meet = at(day.date, day.meet);
  const leave = at(day.date, day.leave);
  if (meet === null || leave === null) return "Pick a day and both times.";
  if (leave < meet) return "Leave after everyone has met.";
  if (leave < now) return "That time has gone by.";
  return null;
}

export function load(store) {
  const kept = store.get(DRAFT_KEY);
  if (!kept || !Array.isArray(kept.days) || !kept.days.length) return blankDrive();
  const drive = { ...blankDrive(), ...kept, attendees: Array.isArray(kept.attendees) ? kept.attendees : [] };
  // Only a new drive is unasked: a stored draft without `asked` (from the
  // server, or before the questions) counts what it holds as answered.
  if (!kept.asked) delete drive.asked;
  // Stops is part of Route now (the mock, 11/9).
  if (drive.step === "stops") drive.step = "route";
  // Drafts from before days had legs and boards.
  for (const d of drive.days) if (!Array.isArray(d.legs) || !d.legs.length) d.legs = [blankLeg()];
  drive.boards = drive.boards && typeof drive.boards === "object" ? drive.boards : {};
  if (kept.board && !drive.boards[drive.days[0].id]) drive.boards[drive.days[0].id] = kept.board;
  delete drive.board;
  for (const n of drive.notes) n.day_id ||= drive.days[0].id;
  const a = drive.active || {};
  const dayIndex = Number.isInteger(a.day) && a.day >= 0 && a.day < drive.days.length ? a.day : 0;
  const legIndex = Number.isInteger(a.leg) && a.leg >= 0 && a.leg < drive.days[dayIndex].legs.length ? a.leg : 0;
  drive.active = { day: dayIndex, leg: legIndex };
  return drive;
}

const timeText = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayText = (ms) => new Date(ms).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
/// "Sat, Dec 12" for a day's date, or "".
const shortDay = (date) => { const ms = at(date, "12:00"); return ms === null ? "" : new Date(ms).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); };

/// The group mode, wired into the planner. `api` is the planner's: its
/// page helpers, its plan, and the moves it already makes.
export function initGroup(api) {
  const { $, el, store } = api;
  let drive = load(store);
  let saveTimer = 0;
  let autosaveTimer = 0;
  let railTimer = 0;
  let sender = null; // the Send step (below); it does the uploading
  let whenAsk = null; // When's questions (below)
  let finder = null; // the meeting place finder (the When step, below)
  let table = null; // an import being matched (the Attendees step, below)
  let planOrgs = null; // the organizer's clubs: Spots, the steps, lead and sweep (below)
  const planOrg = () => planOrgs?.find((o) => o.id === drive.orgId) || planOrgs?.[0] || null;
  const save = () => {
    drive.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.set(DRAFT_KEY, drive), 250);
    // An upload's own save isn't an edit: no new upload for it.
    if (sender?.autosaving) return;
    // The rail's checks and lines follow every change, not only a step's.
    clearTimeout(railTimer);
    railTimer = setTimeout(renderRail, 150);
    $("g-saved").textContent = "Draft saved in this browser";
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosave, AUTOSAVE_MS);
  };
  // Your drafts: 8 s after the last change, up to your account.
  const AUTOSAVE_MS = 8000;
  async function autosave() {
    const outcome = await sender?.autosave();
    if (outcome === "saved") $("g-saved").textContent = "Draft saved to your account";
    else if (outcome === "local") $("g-saved").textContent = "Draft saved in this browser. Register your club to keep drafts in your account.";
    else if (outcome === "failed") $("g-saved").textContent = "Draft saved in this browser. Couldn't save it to your account; trying again when you next change it.";
    if (outcome === "saved") for (const b of bar.querySelectorAll(".g-step")) b.classList.toggle("done", stepDone(b.dataset.step));
    if (outcome === "saved") $("g-page-link").hidden = drive.step === "page" || drive.step === "drives" || !sentForReal(drive);
  }
  const day = () => drive.days[drive.active.day] || drive.days[0];
  const leg = () => day().legs[drive.active.leg] || day().legs[0];
  const spot = (p) => (p ? { id: crypto.randomUUID(), lat: p.lat, lon: p.lon, label: p.label || p.name || "" } : null);

  // ── the step bar ──
  // Numbered groups are Club's (the user, 11/8 late): a Group org's drive is
  // one group with one leave time, an optional lead and sweep set on
  // Attendees, and no Groups step.
  const onGroupPlan = () => planOrg()?.tier === "group";
  // Groups: not on Group. The pre-run: Club drives whose When says there's one.
  const showsStep = (key) => !(key === "groups" && onGroupPlan()) && !(key === "prerun" && !(planOrg()?.tier === "club" && drive.prerun?.on !== false));
  const stepsNow = () => STEPS.filter((s) => showsStep(s.key));
  const bar = $("g-steps");
  function renderBar() {
    bar.replaceChildren(...stepsNow().map((s, i) => {
      const li = el("li");
      const b = el("button", "g-step");
      b.type = "button";
      b.dataset.step = s.key;
      b.append(el("span", "g-n", String(i + 1)), el("span", "", s.label));
      b.addEventListener("click", () => go(s.key));
      li.append(b);
      return li;
    }));
  }
  renderBar();
  function paintBar() {
    for (const b of bar.querySelectorAll(".g-step")) {
      b.setAttribute("aria-current", b.dataset.step === drive.step ? "step" : "false");
      b.classList.toggle("done", stepDone(b.dataset.step));
    }
    renderRail();
  }

  // ── the rail (the approved mock, 11/9) ──
  // The five steps, the days under Route, the meter under step 5. The old
  // bar above stays in the page, hidden, while each step moves across.
  const railNow = () => RAIL.filter((r) => showsStep(r.key));
  const railDone = (r) => (plugged[r.key]?.done ? plugged[r.key].done() : stepDone(r.holds[0]));
  const railSummary = (r) => plugged[r.key]?.summary?.() || railWords[r.key]?.() || "";
  const railWords = {
    when: () => (drive.days[0]?.date ? [drive.days.map((d) => shortDay(d.date)).join(" and "), Number.isInteger(drive.days[0].spots) ? `${drive.days[0].spots} spots` : ""].filter(Boolean).join(" · ") : ""),
    route: () => (stepDone("route") ? "" : "You can build it later"),
  };
  function renderRail() {
    const rail = $("g-rail");
    if (!rail) return;
    rail.hidden = false;
    $("g-rail-eyebrow").textContent = sentForReal(drive) ? "Group drive" : "New group drive";
    $("g-rail-title").textContent = drive.name || "Untitled drive";
    const here = railOf(drive.step);
    const steps = railNow();
    $("g-rail-steps").replaceChildren(...steps.map((r, i) => {
      const li = el("li");
      const b = el("button", "g-rail-step");
      b.type = "button";
      b.dataset.rail = r.key;
      const done = railDone(r);
      b.classList.toggle("done", done);
      if (r.key === here) b.setAttribute("aria-current", "step");
      const n = el("span", "g-rail-n", done ? "" : String(i + 1));
      if (done) n.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
      const words = el("span", "g-rail-words");
      words.append(el("span", "g-rail-label", r.label));
      const sum = railSummary(r);
      if (sum) words.append(el("small", "", sum));
      b.append(n, words);
      if (done) b.setAttribute("aria-label", `${r.label}, done${sum ? `: ${sum}` : ""}`);
      b.addEventListener("click", () => go(r.key));
      li.append(b);
      // Route: each day under it, once there's more than one.
      if (r.key === "route" && drive.days.length > 1) {
        const days = el("ul", "g-rail-days");
        drive.days.forEach((d, di) => {
          const db = el("button", "g-rail-day", `Day ${di + 1}${d.date ? ` · ${shortDay(d.date)}` : ""}`);
          db.type = "button";
          if (here === "route" && drive.active.day === di) db.setAttribute("aria-current", "true");
          db.addEventListener("click", () => { pickDay(di); go("route"); });
          const dli = el("li");
          dli.append(db);
          days.append(dli);
        });
        li.append(days);
      }
      return li;
    }));
    const done = steps.filter(railDone).length;
    $("g-meter-fill").style.width = `${Math.round((done / steps.length) * 100)}%`;
    $("g-meter-said").textContent = meterText(done, steps.length, routeSent(drive));
    $("g-rail-page").hidden = !sentForReal(drive);
  }
  const pickDay = (i) => { if (i !== drive.active.day) switchTo(i, 0); };
  $("g-rail-page")?.addEventListener("click", () => go("page"));
  $("g-rail-drives")?.addEventListener("click", () => go("drives"));

  // ── Steps plugged in (32512's Attendees and Groups, 11/9) ──
  // Each: init({ $, el, api, drive, save, section, go, org }) → { render(),
  // done(), summary?() }, rendering into its section. Register below.
  const plugged = {};
  const PLUGINS = {
    attendees: initAttendeesStep, // 32512: Attendees (attendees-step.js)
    groups: initGroupsStep, // 32512: Groups (groups-board.js)
  };
  function plugIn() {
    for (const [key, init] of Object.entries(PLUGINS)) {
      plugged[key] = init({
        $, el, api, drive: () => drive, save, section: $(`g-${key}`), go, org: planOrg,
        // Attendees' invite-by-email: the Invitations send (send.js), its words in the step's own line.
        sendInvitations: (audience) => sender.send(audience === "me" ? "me" : "everyone", { invites: true, said: "at-send-said" }),
      });
    }
  }

  /// Open a step. Leaving a plugged-in step for another rail step asks it
  /// first: leave(next) false means it shows its own word and calls
  /// go(next, { force: true }) itself (Groups' "N people aren't in a group").
  function go(step, { force = false } = {}) {
    // Stops is Route's "Roads and stops" now (the mock, 11/9).
    if (step === "stops") step = "route";
    if (!stepsNow().some((s) => s.key === step) && step !== "page" && step !== "drives") step = step === "groups" ? "send" : "when";
    const from = railOf(drive.step);
    if (!force && from && railOf(step) && railOf(step) !== from && plugged[from]?.leave && plugged[from].leave(step) === false) return;
    drive.step = step;
    save();
    show();
    // Focus the step's heading, so a keyboard or a reader lands there; on
    // When, its open question.
    if (step === "when" && whenAsk?.current) whenAsk.focus();
    else $(`g-${sectionOf(step)}-h`)?.focus({ preventScroll: true });
  }

  function show() {
    const step = drive.step;
    $("panel").dataset.step = step;
    // The page's layout: the rail, and the map only on Route (the mock, 11/9).
    const was = document.body.dataset.gstep;
    document.body.dataset.gstep = railOf(step) || step;
    if ((was === "route") !== (document.body.dataset.gstep === "route")) api.resizeMap?.();
    paintBar();
    for (const key of new Set(STEPS.map((s) => sectionOf(s.key)))) $(`g-${key}`).hidden = key !== sectionOf(step);
    // The drive page: once the drive is on the server, off the step bar.
    $("g-page").hidden = step !== "page";
    // Only once it has gone to someone besides you: a draft saved to your
    // account has no drive page yet (the user's UX pass, 11/9).
    $("g-page-link").hidden = step === "page" || step === "drives" || !sentForReal(drive);
    $("g-drives").hidden = step !== "drives";
    $("g-drives-link").hidden = step === "drives";
    const steps = stepsNow();
    const i = steps.findIndex((s) => s.key === step);
    $("g-back").hidden = i <= 0;
    $("g-next").hidden = step === "page" || step === "drives" || (step === "send" && !drive.server);
    $("g-next").textContent = i < steps.length - 1 ? `Next: ${steps[i + 1].label}` : "Drive page";
    $("g-later").hidden = true;
    if (step !== "route") { document.body.dataset.roads = ""; api.renderAlong?.(); }
    renderDays();
    if (step === "route") renderLegs();
    renderVersions();
    if (step === "when") {
      // The club's plan afresh each visit (a trial may have started since).
      planOrgs = null;
      renderWhen();
    }
    if (step !== "route") finder?.close();
    if (step === "route") renderRoute();
    if (step === "stops") renderNotes();
    if (plugged[railOf(step)]) plugged[railOf(step)].render();
    else if (step === "attendees") { renderRegistered(); renderPeople(); refreshWaitlists(); }
    if (step === "groups" && !plugged.groups) board.render();
    if (step === "send" || step === "invites") sender.render();
    if (step === "page") page.render();
    else page.clear();
    if (step === "drives") drives.render();
    api.render();
  }

  function stepDone(step) {
    const p = api.plan();
    // Date and times, and where to meet: the city is enough for invitations.
    // Every When question answered (the meeting place is Route's now).
    if (step === "when") return !!whenAsk && !whenAsk.current;
    if (step === "route") return drive.days.every((d) => d.legs.some((l) => (l === leg() ? p : l.plan)?.path));
    if (step === "stops") return p.waypoints.some((w) => w.type === "stop") || drive.notes.length > 0;
    if (step === "attendees") return drive.attendees.length > 0;
    if (step === "groups") return Object.values(drive.boards || {}).some((b) => Object.keys(b.placements || {}).length > 0);
    if (step === "invites") return invitesSent(drive);
    if (step === "send") return routeSent(drive);
    return false;
  }

  $("g-back").addEventListener("click", () => {
    if (drive.step === "route" && drive.active.day > 0) { switchTo(drive.active.day - 1, 0); show(); return; }
    const steps = stepsNow().filter((s) => s.key !== "stops");
    go(steps[Math.max(0, steps.findIndex((s) => s.key === (drive.step === "stops" ? "route" : drive.step)) - 1)].key);
  });
  $("g-next").addEventListener("click", () => {
    // Route: the next day, then on past Stops (it's part of Route now).
    if (drive.step === "route" && drive.active.day < drive.days.length - 1) { switchTo(drive.active.day + 1, 0); show(); return; }
    const steps = stepsNow().filter((s) => s.key !== "stops");
    const i = steps.findIndex((s) => s.key === (drive.step === "stops" ? "route" : drive.step));
    if (i < steps.length - 1) go(steps[i + 1].key);
    else if (drive.server) go("page");
  });
  $("g-page-link").addEventListener("click", () => go("page"));
  $("g-drives-link").addEventListener("click", () => go("drives"));

  // ── the drive's name ──
  $("g-name").value = drive.name;
  $("g-name").addEventListener("input", () => {
    drive.name = $("g-name").value.slice(0, 120);
    save();
  });

  // ── When: the day, meet and leave times, the meeting place ──
  const today = new Date();
  $("g-date").min = isoDay(today);
  $("g-date").max = isoDay(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));

  // The organizer's club, for Spots' limit: orgs_mine, on each visit to When.
  async function loadPlanOrgs() {
    if (planOrgs || !api.account?.()) return;
    try {
      const got = await api.rpc("orgs_mine", {});
      planOrgs = Array.isArray(got) ? got : [];
      // The plan decides the steps (no Groups on Group) and the Attendees step's lead and sweep.
      renderBar();
      paintBar();
      if (drive.step === "groups" && onGroupPlan()) go("send");
      if (drive.step === "when") renderWhen();
      if (drive.step === "attendees") { if (plugged.attendees) plugged.attendees.render(); else renderPeople(); }
    } catch {
      planOrgs = [];
    }
  }

  /// Spots: blank is the plan's cap (Group's 20; Club shows none). On
  /// Group, more than its cap isn't allowed (the user, 11/8 late).
  function renderSpots(d) {
    const org = planOrg();
    const cap = org?.tier === "group" ? org.drive_cap ?? null : null;
    const input = $("g-day-spots");
    if (document.activeElement !== input) input.value = Number.isInteger(d.spots) ? String(d.spots) : "";
    // No "No cap" (the user's UX pass, 11/9): Club says how many each day.
    input.placeholder = cap ? String(cap) : "How many";
    if (cap) input.max = String(cap); else input.removeAttribute("max");
    if (!$("g-day-spots-said").dataset.held) {
      $("g-day-spots-said").textContent = cap ? `Up to ${cap} on Group. Past that, people join a waitlist.` : "How many cars can come. Past that, people join a waitlist.";
    }
  }

  // ── the pre-run (Club only): Yes by default; a date per day, the week before ──
  const onClubPlan = () => planOrg()?.tier === "club";
  const prerunOn = () => onClubPlan() && drive.prerun?.on !== false;
  const prerunDate = (d) => prerunDateOf(drive, d);
  function renderPrerunSetting(d) {
    const club = onClubPlan();
    $("g-pr").hidden = !club;
    if (!club) return;
    const on = prerunOn();
    $("g-pr-yes").setAttribute("aria-checked", String(on));
    $("g-pr-no").setAttribute("aria-checked", String(!on));
    $("g-pr-date-row").hidden = !on;
    $("g-pr-date").max = d.date || "";
    if (document.activeElement !== $("g-pr-date")) $("g-pr-date").value = prerunDate(d) || "";
  }
  const setPrerun = (patch) => {
    drive.prerun = { on: true, dates: {}, ...(drive.prerun || {}), ...patch, dirty: true };
    save();
    renderWhen();
  };
  $("g-pr-yes").addEventListener("click", () => setPrerun({ on: true }));
  $("g-pr-no").addEventListener("click", () => setPrerun({ on: false }));
  $("g-pr-date").addEventListener("change", () => {
    const d = day();
    setPrerun({ dates: { ...(drive.prerun?.dates || {}), [d.id]: $("g-pr-date").value || undefined } });
  });

  /// The Route step's version 2 panel: what changed, and version 1 on the map.
  function renderVersions() {
    const l = leg();
    const has = !!(l?.v1 && l.plan);
    $("g-ver").hidden = !has || drive.step !== "route";
    if (!has) { api.showGhost?.(null); return; }
    $("g-ver-list").replaceChildren(...changesSince(l.v1, l.plan, { miles: usesMiles(navigator.language) }).map((line) => el("li", "", line)));
    api.showGhost?.($("g-ver-show").checked && drive.step === "route" ? l.v1.path?.geometry : null);
  }
  $("g-ver-show").addEventListener("change", renderVersions);

  function renderWhen() {
    const d = day();
    renderSpots(d);
    renderPrerunSetting(d);
    loadPlanOrgs();
    const i = drive.active.day;
    // A later day can't come before the one before it.
    $("g-date").min = i > 0 ? nextDate(drive.days[i - 1].date) : isoDay(today);
    $("g-day-remove").hidden = drive.days.length < 2;
    $("g-day-remove").textContent = removing === d.id ? `Remove Day ${i + 1} for good` : `Remove Day ${i + 1}`;
    $("g-when-h").textContent = drive.days.length > 1 ? `When: Day ${i + 1}` : "When";
    $("g-date").value = d.date;
    $("g-meet").value = d.meet;
    $("g-leave").value = d.leave;
    if (document.activeElement !== $("g-place")) $("g-place").value = d.place?.label || "";
    if (document.activeElement !== $("g-city")) $("g-city").value = d.city || "";
    if (document.activeElement !== $("g-desc")) $("g-desc").value = drive.description || "";
    if (finder) finder.button.textContent = d.place ? `Find car parks near ${d.place.label}` : "Find car parks near the map's centre";
    const problem = d.date && d.meet && d.leave ? dayProblem(d) : null;
    $("g-when-problem").hidden = !problem;
    $("g-when-problem").textContent = problem || "";
    const meet = at(d.date, d.meet);
    const leave = at(d.date, d.leave);
    $("g-when-sum").textContent = !problem && meet !== null && leave !== null
      ? `${dayText(meet)}: meet at ${timeText(meet)}${d.place ? ` at ${d.place.label}` : ""}, leave at ${timeText(leave)}.`
      : "";
    $("g-when-h").textContent = "When and how many";
    if (!whenAsk) return;
    // ask.js keeps what's typed in the open question across this.
    whenAsk.render();
    $("g-when-next").hidden = !!whenAsk.current;
  }

  // ── When and how many, one question at a time (the approved mock, 11/9) ──
  // The answers are the drive's own fields. drive.asked marks what a new
  // drive has been asked (blankDrive's {}), so its default date isn't an
  // answer; a drive from the server or an older draft has none, and what
  // it holds counts as answered.
  const asked = (key) => (drive.asked ? !!drive.asked[key] : true);
  const mark = (key) => { (drive.asked ||= {})[key] = true; };
  const dayOk = (d) => !!(d.date && d.meet && d.leave) && !dayProblem(d);
  const groupCap = () => (planOrg()?.tier === "group" ? planOrg().drive_cap ?? null : null);
  function timesText() {
    if (drive.days.length > 1) return drive.days.map((d) => shortDay(d.date)).join(" and ");
    const d = drive.days[0];
    const m = at(d.date, d.meet), l = at(d.date, d.leave);
    return m === null || l === null ? "" : `${shortDay(d.date)} · meet ${timeText(m)}, leave ${timeText(l)}`;
  }
  function whenAnswers() {
    const a = { club: planOrg()?.tier === "club" };
    if (drive.name) a.name = drive.name;
    if (drive.days.length > 1 || asked("days")) a.days = drive.days.length > 1 ? "several" : "one";
    if (asked("times") && drive.days.every(dayOk)) a.times = true;
    if (drive.days.every((d) => Number.isInteger(d.spots) && d.spots > 0)) a.cars = drive.days[0].spots;
    if (a.club && asked("prerun")) a.prerun = drive.prerun?.on === false ? false : prerunDate(drive.days[0]);
    return a;
  }
  /// "08:15" → "08:45": a leave time half an hour after meeting.
  const halfHourOn = (t) => { const [h, m] = t.split(":").map(Number); const x = (h * 60 + m + 30) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  function renderTimesQ(box, { submit }) {
    const rows = el("div", "ask-days");
    drive.days.forEach((d, i) => {
      const row = el("div", "ask-day");
      const field = (label, type, key) => {
        const l = el("label", "ask-mini");
        const input = el("input", "ask-input");
        input.type = type;
        input.value = d[key] || "";
        if (type === "time") input.step = "300";
        if (type === "date") input.min = i > 0 ? nextDate(drive.days[i - 1].date) : isoDay(today);
        input.addEventListener("change", () => {
          d[key] = input.value;
          // Meeting later than leaving: the leave time follows, half an hour on.
          if (key === "meet" && d.leave && at(d.date, d.meet) > at(d.date, d.leave)) d.leave = halfHourOn(d.meet);
          save();
          syncLeave();
          if (key === "meet") row.querySelector('[data-k="leave"]').value = d.leave;
        });
        input.dataset.k = key;
        l.append(el("span", "", label), input);
        return l;
      };
      row.append(field(drive.days.length > 1 ? `Day ${i + 1}` : "Date", "date", "date"), field("Meet at", "time", "meet"), field("Leave at", "time", "leave"));
      rows.append(row);
    });
    box.append(rows);
    if (drive.days.length > 1) {
      const add = el("button", "ask-add", "+ Add a day");
      add.type = "button";
      add.addEventListener("click", () => { addDayQuietly(); whenAsk.edit("times"); });
      box.append(add);
    }
    const row = el("div", "ask-row");
    const ok = el("button", "ask-ok", "OK");
    ok.type = "button";
    const problem = el("p", "ask-problem");
    problem.hidden = true;
    problem.setAttribute("role", "alert");
    ok.addEventListener("click", () => {
      const bad = drive.days.findIndex((d) => !dayOk(d));
      if (bad >= 0) {
        const why = dayProblem(drive.days[bad]) || "Pick a day and both times.";
        problem.textContent = drive.days.length > 1 ? `Day ${bad + 1}: ${why}` : why;
        problem.hidden = false;
        return;
      }
      mark("times");
      submit(true);
    });
    row.append(ok);
    box.append(row, problem);
  }
  function renderPrerunQ(box, { value, submit }) {
    const list = el("div", "ask-choices ask-across");
    const pick = (label, key, on) => {
      const b = el("button", `ask-choice${on ? " on" : ""}`);
      b.type = "button";
      b.append(el("kbd", "", key), el("span", "ask-opt", label));
      return b;
    };
    const yes = pick("Yes", "A", !!value || box.dataset.yes === "1");
    const no = pick("No", "B", value === false);
    list.append(yes, no);
    box.append(list);
    const when = el("div", "ask-prerun-date");
    when.hidden = !(value || box.dataset.yes === "1");
    const l = el("label", "ask-mini");
    const input = el("input", "ask-input");
    input.type = "date";
    input.value = value || prerunDate(drive.days[0]) || "";
    input.max = drive.days[0].date || "";
    l.append(el("span", "", "Pre-run date"), input);
    const row = el("div", "ask-row");
    const ok = el("button", "ask-ok", "OK");
    ok.type = "button";
    ok.addEventListener("click", () => { if (input.value) submit(input.value); else input.focus(); });
    row.append(ok, el("span", "ask-hint", "A week before the drive. Change it if you like."));
    when.append(l, row);
    box.append(when);
    yes.addEventListener("click", () => { when.hidden = false; yes.classList.add("on"); no.classList.remove("on"); input.focus(); });
    no.addEventListener("click", () => submit(false));
  }
  const WHEN_QUESTIONS = [
    { key: "name", label: "Name", title: "What's the drive called?", kind: "text", placeholder: "Coastal Run to Carmel" },
    { key: "days", label: "Days", title: "Is it one day, or several?", kind: "choice", options: [{ value: "one", label: "One day" }, { value: "several", label: "Several days" }] },
    { key: "times", label: "When", title: "When will you meet, and when will you leave?", kind: "custom", render: renderTimesQ, text: timesText },
    {
      key: "cars", label: "Cars", title: "How many cars can come?", help: "When it's full, new yeses go on a waitlist.", kind: "number", placeholder: "60",
      text: (v) => `${v} ${v === 1 ? "car" : "cars"}`,
      initial: () => groupCap() ?? "",
      check: (v) => (groupCap() && v > groupCap() ? `Group has ${groupCap()} spots a drive. Need more spots? Club has no driver cap.` : null),
    },
    {
      key: "prerun", label: "Pre-run", title: "Will there be a pre-run?", kind: "custom", when: (a) => a.club, render: renderPrerunQ,
      help: "On a pre-run, leads and sweeps drive the route a week early and drop notes. Then you fix the route and send the final version.",
      text: (v) => (v ? `Pre-run ${shortDay(v)}` : "No pre-run"),
    },
  ];
  /// Day 2 (and on) without opening it: the When question shows them all.
  function addDayQuietly() {
    if (drive.days.length >= 7) return;
    const prev = drive.days[drive.days.length - 1];
    const { day: d, board: copied } = dayAfter(prev, drive.boards);
    // The same number of cars as the day before (one answer for the drive).
    if (Number.isInteger(prev.spots)) d.spots = prev.spots;
    drive.days.push(d);
    if (copied) drive.boards[d.id] = copied;
  }
  /// Back to one day: the later days go, unless one has a route already.
  function oneDayOnly() {
    const later = drive.days.slice(1);
    if (later.some((d) => d.legs.some((l) => l.plan?.path))) return false;
    for (const d of later) {
      delete drive.boards[d.id];
      drive.notes = drive.notes.filter((n) => n.day_id !== d.id);
      for (const p of drive.attendees) if (Array.isArray(p.days)) p.days = p.days.filter((x) => x !== d.id);
    }
    drive.days.length = 1;
    drive.active = { day: 0, leg: Math.min(drive.active.leg, drive.days[0].legs.length - 1) };
    return true;
  }
  function onWhenAnswer(key, v) {
    if (key === "name") { drive.name = String(v).slice(0, 120); $("g-name").value = drive.name; }
    if (key === "days") {
      mark("days");
      if (v === "several" && drive.days.length < 2) addDayQuietly();
      if (v === "one" && drive.days.length > 1 && !oneDayOnly()) api.toast?.("A later day has a route. Remove it on Route first.");
    }
    if (key === "cars") for (const d of drive.days) d.spots = v;
    if (key === "prerun") {
      mark("prerun");
      drive.prerun = v ? { on: true, dates: { ...(drive.prerun?.dates || {}), [drive.days[0].id]: v }, dirty: true } : { ...(drive.prerun || { dates: {} }), on: false, dirty: true };
    }
    save();
    syncLeave();
    renderDays();
    paintBar();
    $("g-when-next").hidden = !!whenAsk.current;
  }
  whenAsk = ask($("g-when-ask"), { el, questions: WHEN_QUESTIONS, answers: whenAnswers, onAnswer: onWhenAnswer, onDone: () => { $("g-when-next").hidden = false; } });
  $("g-when-ask").dataset.focus = "off";
  $("g-when-go").addEventListener("click", () => go("route"));

  /// The leave time is the route's (the forecast, the closures' month).
  function syncLeave() {
    const d = day();
    const leave = at(d.date, d.leave);
    api.setLeave(!dayProblem(d) ? leave : null);
  }

  $("g-day-spots").addEventListener("change", () => {
    const d = day();
    const raw = $("g-day-spots").value.trim();
    const n = raw === "" ? null : Math.floor(Number(raw));
    const org = planOrg();
    const cap = org?.tier === "group" ? org.drive_cap ?? null : null;
    const said = $("g-day-spots-said");
    delete said.dataset.held;
    if (n !== null && (!Number.isFinite(n) || n < 1)) {
      $("g-day-spots").value = Number.isInteger(d.spots) ? String(d.spots) : "";
      return;
    }
    if (n !== null && cap && n > cap) {
      d.spots = cap;
      said.dataset.held = "1";
      said.textContent = `Group has ${cap} spots a drive. Need more spots? Club has no driver cap.`;
    } else d.spots = n;
    save();
    renderWhen();
  });

  for (const [id, field] of [["g-date", "date"], ["g-meet", "meet"], ["g-leave", "leave"]]) {
    $(id).addEventListener("change", () => {
      day()[field] = $(id).value;
      // Meeting later than leaving: the leave time follows, half an hour on.
      const d = day();
      if (field === "meet" && at(d.date, d.leave) !== null && at(d.date, d.meet) > at(d.date, d.leave)) {
        const m = at(d.date, d.meet) + 30 * 60_000;
        d.leave = new Date(m).toTimeString().slice(0, 5);
      }
      save();
      renderWhen();
      syncLeave();
    });
  }

  // The meeting place finder (item 9): car parks near the meeting place
  // typed (or the map's centre), ranked for this day's meet time; numbered
  // as their pins. Choosing one sets the meeting place as a search does.
  // OpenStreetMap's sizes come a moment later: asked once more then.
  finder = (() => {
    // Held, not looked up: the block moves into Route's start question and
    // is out of the page between renders (getElementById finds nothing then).
    const box = $("g-meetfind"), spotsEl = $("g-spots"), creditEl = $("g-meet-credit"), saidEl = $("g-meet-said"), findEl = $("g-meet-find");
    let pins = null;
    let again = 0;
    let asked = 0;
    const close = () => {
      clearTimeout(again);
      pins?.clear();
      pins = null;
      spotsEl.replaceChildren();
      spotsEl.hidden = true;
      creditEl.hidden = true;
      saidEl.textContent = "";
    };
    const choose = (spot) => {
      close();
      setStart({ name: spot.name, lat: spot.lat, lon: spot.lon, town: spot.town });
      routeAsk?.render({ focus: true });
    };
    const showSpots = (spots, meet, near) => {
      pins?.clear();
      const list = spotsEl;
      list.replaceChildren(...spots.map((spot, i) => {
        const w = spotWords(spot, meet);
        const li = el("li");
        const b = el("button", "g-spot");
        b.type = "button";
        b.append(el("span", "num", String(i + 1)));
        const text = el("span", "g-spot-text");
        text.append(el("b", "", w.title));
        if (w.address) text.append(el("span", "dim", w.address));
        if (w.facts.length) text.append(el("span", "g-spot-facts", w.facts.join(" · ")));
        b.append(text);
        b.addEventListener("click", () => choose(spot));
        b.addEventListener("mouseenter", () => pins?.setActive(i));
        b.addEventListener("focus", () => pins?.setActive(i));
        li.append(b);
        return li;
      }));
      list.hidden = !spots.length;
      creditEl.hidden = !creditNeeded(spots);
      saidEl.textContent = spots.length ? `${spots.length === 1 ? "1 place" : `${spots.length} places`} near ${near}. Choose one to meet there.` : `No car parks found near ${near}. Search for a place instead.`;
      pins = api.spotPins(spots, (spot) => choose(spot), (i) => {
        for (const [n, x] of [...list.querySelectorAll(".g-spot")].entries()) x.classList.toggle("on", n === i);
      });
    };
    const find = async (quiet = false) => {
      const d = day();
      const at = d.place ? { lat: d.place.lat, lon: d.place.lon } : api.mapCentre();
      if (!at) return;
      const near = d.place?.label || "the map's centre";
      const ask = ++asked;
      if (!quiet) {
        saidEl.textContent = "Looking for car parks…";
        findEl.disabled = true;
      }
      try {
        const answer = await api.findMeet(at, d.date && d.meet ? { date: d.date, meet: d.meet } : null);
        if (ask !== asked || drive.step !== "route") return;
        showSpots(answer.spots || [], d.meet || null, near);
        clearTimeout(again);
        if (answer.sizes === "pending" && !quiet) again = setTimeout(() => { if (!spotsEl.hidden) find(true); }, 45_000);
      } catch (failure) {
        if (!quiet) saidEl.textContent = failure.message || "Couldn't look for car parks. Try again.";
      } finally {
        findEl.disabled = false;
      }
    };
    findEl.addEventListener("click", () => find());
    return { close, find, box, button: findEl };
  })();

  // The meet city: the meeting place's town until the organizer types one.
  const cityFrom = (d, town) => {
    if (town && !d.cityTyped) d.city = town;
  };
  $("g-city").addEventListener("input", () => {
    const d = day();
    d.city = $("g-city").value.trim();
    d.cityTyped = !!d.city;
    save();
  });
  $("g-city").addEventListener("change", () => renderWhen());
  $("g-desc").addEventListener("input", () => {
    drive.description = $("g-desc").value.trim();
    save();
  });

  // The meeting place is the route's start.
  api.attachSearch($("g-place-row"), $("g-place"), (place) => {
    api.choosePlace("start", place);
    cityFrom(day(), place.town);
    day().place = { label: place.name, lat: place.lat, lon: place.lon };
    save();
    renderWhen();
  }, () => renderWhen());
  // A start set on the map (Start here) is the meeting place too: on a day's
  // first leg (a later leg starts where the one before it ended). And the
  // leg keeps its route as the planner changes it.
  api.onPlan(() => {
    const p = api.plan();
    const d = day();
    if (switching) return;
    // After the pre-run, the first change keeps the route the crew drove as version 1.
    const after = api.snapshot();
    const l = leg();
    const kept = prerunOn() ? withVersions(l, l.plan, after, { prerunDate: prerunDate(d), today: isoDay(new Date()) }) : l;
    if (kept.v1 && !l.v1) l.v1 = kept.v1;
    l.plan = after;
    renderVersions();
    save();
    if (drive.active.leg !== 0) {
      for (const b of bar.querySelectorAll(".g-step")) b.classList.toggle("done", stepDone(b.dataset.step));
      return;
    }
    // Its name comes a moment after a click on the map: take it then too.
    const moved = !d.place || d.place.lat !== p.start?.lat || d.place.lon !== p.start?.lon;
    if (p.start?.town) cityFrom(d, p.start.town);
    if (p.start && (moved || (p.start.label && p.start.label !== d.place.label))) {
      d.place = { label: p.start.label || (moved ? "" : d.place?.label) || "Meeting place", lat: p.start.lat, lon: p.start.lon };
      save();
      if (drive.step === "when") renderWhen();
    }
    for (const b of bar.querySelectorAll(".g-step")) b.classList.toggle("done", stepDone(b.dataset.step));
    if (drive.step === "route" && routeAsk) {
      routeHead();
      // A start or end picked on the map shows in the open question, unless
      // someone is typing in it (its search list would close).
      if (!$("g-route-ask").contains(document.activeElement)) renderRoute();
    }
  });

  // ── Days and legs (§3): the planner shows one leg's route at a time ──
  let switching = false;
  let removing = null;

  /// A leg's starting plan: the day's meeting place on its first leg, the
  /// previous leg's end on the others.
  function seed(d, legIndex) {
    const from = legIndex === 0 ? d.place : endOf(d.legs[legIndex - 1]?.plan);
    return { start: spot(from), trip: "oneWay", style: "balanced", avoids: [], waypoints: [], leaveAt: at(d.date, d.leave) };
  }

  function switchTo(dayIndex, legIndex = 0) {
    leg().plan = api.snapshot();
    drive.active = { day: dayIndex, leg: legIndex };
    removing = null;
    save();
    switching = true;
    api.loadPlan(leg().plan || seed(day(), legIndex));
    switching = false;
    leg().plan = api.snapshot();
    syncLeave();
    drawNotes();
    show();
  }

  function renderDays() {
    const tabs = $("g-days");
    tabs.hidden = drive.step === "attendees" || drive.step === "send" || drive.step === "page";
    tabs.replaceChildren(...drive.days.map((d, i) => {
      const b = el("button", "g-day");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === drive.active.day));
      const date = at(d.date, "12:00");
      b.textContent = `Day ${i + 1}${date ? ` · ${new Date(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : ""}`;
      b.addEventListener("click", () => { if (i !== drive.active.day) switchTo(i, 0); });
      return b;
    }), (() => {
      const add = el("button", "g-day add", "+ Add a day");
      add.type = "button";
      add.addEventListener("click", addDay);
      return add;
    })());
  }

  function addDay() {
    if (drive.days.length >= 14) return;
    leg().plan = api.snapshot();
    const { day: d, board: copied } = dayAfter(drive.days[drive.days.length - 1], drive.boards);
    drive.days.push(d);
    if (copied) drive.boards[d.id] = copied;
    switchTo(drive.days.length - 1, 0);
    go("when");
  }

  $("g-day-remove").addEventListener("click", () => {
    const d = day();
    if (removing !== d.id) { removing = d.id; renderWhen(); return; }
    const i = drive.active.day;
    drive.days.splice(i, 1);
    delete drive.boards[d.id];
    drive.notes = drive.notes.filter((n) => n.day_id !== d.id);
    for (const p of drive.attendees) if (Array.isArray(p.days)) p.days = p.days.filter((x) => x !== d.id);
    drive.active = { day: Math.max(0, i - 1), leg: 0 };
    removing = null;
    switching = true;
    api.loadPlan(leg().plan || seed(day(), 0));
    switching = false;
    save();
    syncLeave();
    drawNotes();
    show();
  });

  function renderLegs() {
    const d = day();
    const box = $("g-legs");
    const tabs = d.legs.map((l, i) => {
      const b = el("button", "g-day");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i === drive.active.leg));
      b.textContent = l.label || `Route ${i + 1}`;
      b.addEventListener("click", () => { if (i !== drive.active.leg) switchTo(drive.active.day, i); });
      return b;
    });
    const add = el("button", "g-day add", "+ Add a leg");
    add.type = "button";
    add.addEventListener("click", () => {
      if (d.legs.length >= 6) return;
      leg().plan = api.snapshot();
      d.legs.push(blankLeg());
      switchTo(drive.active.day, d.legs.length - 1);
    });
    const row = el("div", "g-days");
    row.setAttribute("role", "tablist");
    row.setAttribute("aria-label", "This day's routes");
    row.append(...tabs, add);
    const label = el("input", "field g-leg-name");
    label.maxLength = 40;
    label.value = leg().label;
    label.placeholder = d.legs.length > 1 ? "Name this leg (Morning, After lunch…)" : "Name this route (optional)";
    label.setAttribute("aria-label", "This route's name");
    label.addEventListener("input", () => { leg().label = label.value.slice(0, 40); save(); });
    label.addEventListener("change", renderLegs);
    const parts = [row, label];
    if (d.legs.length > 1) {
      const remove = el("button", "textlink", `Remove ${leg().label || `Route ${drive.active.leg + 1}`}`);
      remove.type = "button";
      remove.addEventListener("click", () => {
        d.legs.splice(drive.active.leg, 1);
        drive.active.leg = Math.max(0, drive.active.leg - 1);
        switching = true;
        api.loadPlan(leg().plan || seed(d, drive.active.leg));
        switching = false;
        save();
        show();
      });
      parts.push(remove);
    }
    box.replaceChildren(...parts);
  }

  // ── Route, a day at a time (the approved mock, 11/9) ──
  // "Build the route now?" first (Do this later asks only the town, for
  // the invitations), then for each day: where you meet (car parks
  // suggested; Day 2 offers where Day 1 ended), where it ends (one way or
  // round trip), how to get there; then the roads and stops. Marks per
  // day in drive.asked ("start:<day id>"); a drive from the server counts
  // what it holds.
  let routeAsk = null;
  const markDay = (key) => mark(`${key}:${day().id}`);
  const askedDay = (key) => asked(`${key}:${day().id}`);
  const placeName = (p) => p?.label || p?.name || "";
  /// The meeting place: the route's start, the day's place, its town.
  function setStart(place) {
    api.choosePlace("start", { name: place.name, lat: place.lat, lon: place.lon });
    const d = day();
    d.place = { label: place.name, lat: place.lat, lon: place.lon };
    cityFrom(d, place.town);
    save();
  }
  /// Where the day before ended, for "Where Day 1 ended".
  const prevEnd = () => (drive.active.day > 0 ? endOf(drive.days[drive.active.day - 1].legs.at(-1)?.plan) : null);
  function routeAnswers() {
    const d = day();
    const p = api.plan();
    const a = { dayNum: drive.active.day };
    // The drive's: answered, or a drive from the server that has places (now) or towns (later).
    const build = drive.asked ? (drive.asked.build ?? null) : drive.days.some((x) => x.place) ? "now" : drive.days.some((x) => x.city) ? "later" : null;
    if (build) a.build = build;
    if (d.city && (build === "later" || drive.asked?.[`town:${d.id}`])) a.town = d.city;
    if (d.place && askedDay("start")) a.start = placeName(d.place);
    const round = p.trip === "roundTrip";
    if (askedDay("end") && (round || p.end)) a.end = round ? "round" : placeName(p.end) || "the end you chose";
    if (askedDay("how") || (!drive.asked && p.path)) a.how = d.how || "pick";
    return a;
  }
  function renderStartQ(box, { submit }) {
    const d = day();
    const before = prevEnd();
    // Day 2 on: where the day before ended, first.
    if (before && !d.place && !d.fromElse) {
      const offer = el("div", "g-offer");
      offer.append(el("p", "", `Where Day ${drive.active.day} ended: `), el("b", "", placeName(before) || "the end of the route"));
      offer.append(el("p", "dim small", "Most multi-day drives start the next day where they stopped for the night."));
      const row = el("div", "ask-row");
      const use = el("button", "ask-ok", "Use this");
      use.type = "button";
      use.addEventListener("click", () => { setStart({ name: placeName(before), lat: before.lat, lon: before.lon }); markDay("start"); submit(placeName(before)); });
      const other = el("button", "ask-alt", "Meet somewhere else");
      other.type = "button";
      other.addEventListener("click", () => { d.fromElse = true; save(); routeAsk.render({ focus: true }); });
      row.append(use, other);
      offer.append(row);
      box.append(offer);
      return;
    }
    const field = el("div", "g-field g-place ask-search");
    const input = el("input", "ask-input");
    input.type = "text";
    input.autocomplete = "off";
    input.placeholder = "Los Gatos";
    input.value = placeName(d.place);
    input.setAttribute("aria-label", "Where you'll meet");
    field.append(input);
    box.append(field);
    api.attachSearch(field, input, (place) => {
      setStart(place);
      // Car parks near it, for a group.
      finder.find();
      routeAsk.render({ focus: true });
    });
    if (d.place) box.append(el("p", "g-meet-now", `Meeting at ${placeName(d.place)}.`));
    finder.button.textContent = d.place ? `Find car parks near ${placeName(d.place)}` : "Find car parks near the map's centre";
    box.append(finder.box);
    box.append(el("p", "dim small", "Route details will only be visible to confirmed attendees."));
    const row = el("div", "ask-row");
    const go = el("button", "ask-ok", "Continue");
    go.type = "button";
    go.disabled = !d.place;
    go.addEventListener("click", () => { if (!day().place) return input.focus(); markDay("start"); submit(placeName(day().place)); });
    row.append(go);
    box.append(row);
  }
  function renderEndQ(box, { submit }) {
    const p = api.plan();
    const round = p.trip === "roundTrip";
    const seg = el("div", "seg ask-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", "One way or round trip");
    for (const [trip, label] of [["oneWay", "One way"], ["roundTrip", "Round trip"]]) {
      const b = el("button", "", label);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String((p.trip || "oneWay") === trip || (trip === "oneWay" && p.trip === "outAndBack")));
      b.addEventListener("click", () => { api.setTrip(trip); routeAsk.render({ focus: true }); });
      seg.append(b);
    }
    box.append(seg);
    if (round) {
      const field = el("input", "ask-input");
      field.value = placeName(day().place) || placeName(p.start);
      field.disabled = true;
      field.setAttribute("aria-label", "Where the drive ends");
      box.append(field, el("p", "dim small", "Round trips end where you meet. Change the start to change this."));
    } else {
      const field = el("div", "g-field g-place ask-search");
      const input = el("input", "ask-input");
      input.type = "text";
      input.autocomplete = "off";
      input.placeholder = "Carmel-by-the-Sea";
      input.value = placeName(p.end);
      input.setAttribute("aria-label", "Where the drive ends");
      field.append(input);
      box.append(field);
      api.attachSearch(field, input, (place) => { api.choosePlace("end", place); routeAsk.render({ focus: true }); });
    }
    const row = el("div", "ask-row");
    const go = el("button", "ask-ok", "Continue");
    go.type = "button";
    go.addEventListener("click", () => {
      const now = api.plan();
      if (now.trip !== "roundTrip" && !now.end) return box.querySelector("input:not([disabled])")?.focus();
      markDay("end");
      submit(now.trip === "roundTrip" ? "round" : placeName(now.end));
    });
    row.append(go);
    box.append(row);
  }
  const ROUTE_QUESTIONS = [
    {
      key: "build", label: "Build the route now?", title: "Build the route now?", kind: "choice",
      help: "You can invite people and set up groups first. The route is only needed before you send it.",
      when: (a) => a.dayNum === 0,
      options: [
        { value: "now", label: "Yes, build it now", sub: "Where you meet and end, the roads, then stops." },
        { value: "later", label: "Do this later", sub: "Just tell us the town you're meeting in, for the invitations." },
      ],
      text: (v) => (v === "now" ? "Yes" : "Do this later"),
    },
    {
      key: "town", label: "Town", title: "Which town are you meeting in?", kind: "text", placeholder: "Los Gatos, CA",
      help: "Invitations show the town. You'll pick the exact spot when you build the route.",
      when: (a) => a.build === "later", initial: () => day().city || "",
    },
    {
      key: "start", label: "Meet", kind: "custom", when: (a) => a.build === "now", render: renderStartQ,
      get title() { return drive.active.day > 0 ? `Where will you meet on Day ${drive.active.day + 1}?` : "Where will you meet?"; },
      get help() { return prevEnd() && !day().place && !day().fromElse ? "" : "Type a town or a place. We'll suggest car parks big enough for the group."; },
      text: (v) => `Meet at ${v}`,
    },
    { key: "end", label: "End", title: "Where does the drive end?", kind: "custom", when: (a) => a.build === "now", render: renderEndQ, text: (v) => (v === "round" ? "Round trip" : `Ends at ${v}`) },
    {
      key: "how", label: "Roads", title: "How do you want to get there?", kind: "choice", when: (a) => a.build === "now",
      get help() { const p = api.plan(); const to = p.trip === "roundTrip" ? "and back" : `to ${placeName(p.end) || "the end"}`; return `From ${placeName(day().place) || "where you meet"} ${to}.`; },
      options: [
        { value: "pick", label: "Pick the roads you want", sub: "Stitch my own waypoints and stops. Full control." },
        { value: "suggest", label: "Suggest a route for me", sub: "Carve picks good driving roads between your start and end." },
        { value: "import", label: "Import an existing route", sub: "A GPX file, or a Google Maps or Ride with GPS link." },
      ],
    },
  ];
  function onRouteAnswer(key, v) {
    const d = day();
    if (key === "build") { (drive.asked ||= {}).build = v; }
    if (key === "town") { d.city = String(v).slice(0, 60); d.cityTyped = true; mark(`town:${d.id}`); }
    if (key === "how") {
      d.how = v;
      markDay("how");
      if (v === "suggest") api.setStyle("scenic");
      if (v === "import") api.startImport();
    }
    save();
    renderRoute();
  }
  routeAsk = ask($("g-route-ask"), { el, questions: ROUTE_QUESTIONS, answers: routeAnswers, onAnswer: onRouteAnswer });
  $("g-route-ask").dataset.focus = "off";

  /// The day's roads and stops: the planner's rows once the way in is chosen.
  const onRoads = () => { const a = routeAnswers(); return a.build === "now" && !!a.how; };
  /// "Day 1 of 2 · Sat, Dec 12 · Los Gatos to Carmel", and the buttons.
  function routeHead() {
    const d = day();
    const i = drive.active.day;
    const p = api.plan();
    const from = placeName(d.place);
    const to = p.trip === "roundTrip" ? "and back" : placeName(p.end) ? `to ${placeName(p.end)}` : "";
    const where = from && to ? ` · ${from} ${to}` : "";
    $("g-route-day").textContent = drive.days.length > 1 ? `Day ${i + 1} of ${drive.days.length} · ${shortDay(d.date)}${where}` : `${shortDay(d.date)}${where}`;
    renderRouteNav();
  }
  function renderRoute() {
    if (drive.step !== "route" || !routeAsk) return;
    routeHead();
    routeAsk.render();
    const roads = onRoads();
    document.body.dataset.roads = roads ? "1" : "";
    api.renderAlong?.();
    $("g-roads").hidden = !roads;
    // The map notes with the roads, or as soon as the day has one (added
    // from the map's menu before the way in is chosen).
    const notes = roads || dayNotes().length > 0;
    $("g-stops").hidden = !notes;
    if (notes) renderNotes();
  }
  /// Route's buttons: Next: Day 2 on a day before the last, then Continue;
  /// "Finish the route later" while it isn't done.
  function renderRouteNav() {
    const i = drive.active.day;
    const more = i < drive.days.length - 1;
    $("g-next").textContent = more ? `Next: Day ${i + 2}` : "Continue";
    $("g-later").hidden = routeAnswers().build !== "now" || stepDone("route");
    $("g-back").hidden = false;
  }
  $("g-later").addEventListener("click", () => go("attendees"));

  // ── Stops: map notes, labelled pins (each day's own) ──
  const noteMarkers = new Map();
  const dayNotes = () => drive.notes.filter((n) => n.day_id === day().id);
  function drawNotes() {
    const map = api.map();
    if (!map || !api.mapReady()) return;
    const shown = dayNotes();
    for (const [id, marker] of noteMarkers) {
      if (!shown.some((n) => n.id === id)) { marker.remove(); noteMarkers.delete(id); }
    }
    for (const note of shown) {
      let marker = noteMarkers.get(note.id);
      if (!marker) {
        const node = el("div", "map-note");
        node.setAttribute("role", "img");
        marker = new window.maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat([note.lon, note.lat]).addTo(map);
        noteMarkers.set(note.id, marker);
      }
      const node = marker.getElement();
      node.textContent = note.label || "Map note";
      node.setAttribute("aria-label", `Map note: ${note.label || "no label yet"}`);
    }
  }

  function renderNotes() {
    const list = $("g-notes");
    list.replaceChildren(...dayNotes().map((note) => {
      const li = el("li");
      const input = el("input", "field");
      input.value = note.label;
      input.maxLength = 80;
      input.placeholder = "What's here? (Narrow bridge, park on the left…)";
      input.setAttribute("aria-label", "Map note");
      input.dataset.note = note.id;
      input.addEventListener("input", () => {
        note.label = input.value.slice(0, 80);
        save();
        drawNotes();
      });
      const remove = el("button", "clear", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove the map note${note.label ? ` ${note.label}` : ""}`);
      remove.addEventListener("click", () => {
        drive.notes = drive.notes.filter((n) => n.id !== note.id);
        save();
        renderNotes();
        drawNotes();
      });
      li.append(el("span", "map-note-dot"), input, remove);
      return li;
    }));
    $("g-notes-empty").hidden = dayNotes().length > 0;
  }

  function addNote(at) {
    const note = { id: crypto.randomUUID(), day_id: day().id, lat: at.lat, lon: at.lon, label: "" };
    drive.notes.push(note);
    save();
    if (drive.step !== "route") go("route");
    else renderRoute();
    renderNotes();
    drawNotes();
    $("g-notes").querySelector(`[data-note="${note.id}"]`)?.focus();
  }

  // ── Attendees: invited by email, imported lists, the list ──
  const said = (id, text) => { $(id).textContent = text; };
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  function addPeople(people) {
    const result = merge(drive.attendees, people);
    drive.attendees = result.list;
    save();
    renderPeople();
    for (const b of bar.querySelectorAll(".g-step")) b.classList.toggle("done", stepDone(b.dataset.step));
    return result;
  }

  function tab(which) {
    const invite = which === "invite";
    $("g-tab-invite").setAttribute("aria-selected", String(invite));
    $("g-tab-import").setAttribute("aria-selected", String(!invite));
    $("g-invite").hidden = !invite;
    $("g-import-box").hidden = invite;
    if (typeof drive.registered !== "boolean") renderRegistered();
  }
  $("g-tab-invite").addEventListener("click", () => tab("invite"));
  $("g-tab-import").addEventListener("click", () => tab("import"));

  // One question per drive (the user, 11/8 late): "Do you already have
  // people registered for this drive?" Yes: everyone added is Registered
  // (counts as going, isn't asked Going?, can still say Can't make it); No:
  // everyone added is Invited. Changeable; it applies to people added after
  // the change, and nobody already on the list changes. Taken on the
  // organizer's word.
  // On a registered drive, "Add registered people" or "Invite more people"
  // (the user, 11/8 late); a drive that isn't is invitations only.
  const addAs = () => (drive.registered === true && drive.addMode !== "invited" ? "registered" : "invited");
  const HINTS = {
    invited: "They get the invitation when you send, and take a spot when they answer Going.",
    registered: "They count as going and aren't asked Going?. They take spots in the list's order; past your spots, the rest join the waitlist.",
  };
  function renderRegistered() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    const asked = typeof drive.registered === "boolean";
    $("g-reg-ask").hidden = asked;
    $("g-reg-line").hidden = !asked;
    $("g-add-tabs").hidden = !asked;
    $("g-invite").hidden = !asked || $("g-tab-invite").getAttribute("aria-selected") !== "true";
    $("g-import-box").hidden = !asked || $("g-tab-import").getAttribute("aria-selected") !== "true";
    $("g-reg-said").textContent = drive.registered ? "This drive has people registered." : "Everyone you add is invited.";
    $("g-reg-change").textContent = drive.registered ? "Make it invitations only" : "I have people registered";
    $("g-add-mode").hidden = !asked || !drive.registered;
    $("g-mode-reg").setAttribute("aria-checked", String(addAs() === "registered"));
    $("g-mode-inv").setAttribute("aria-checked", String(addAs() === "invited"));
    for (const p of document.querySelectorAll(".g-add-hint")) p.textContent = HINTS[addAs()];
    if (table) renderPreview();
  }
  const answerRegistered = (yes) => {
    drive.registered = yes;
    save();
    renderRegistered();
  };
  for (const [id, mode] of [["g-mode-reg", "registered"], ["g-mode-inv", "invited"]]) {
    $(id).addEventListener("click", () => {
      drive.addMode = mode;
      save();
      renderRegistered();
    });
  }
  $("g-reg-yes").addEventListener("click", () => answerRegistered(true));
  $("g-reg-no").addEventListener("click", () => answerRegistered(false));
  $("g-reg-change").addEventListener("click", () => {
    answerRegistered(!drive.registered);
    said("g-invite-said", "From now on. Nobody already on the list changes.");
  });

  $("g-invite-add").addEventListener("click", () => {
    const { people, bad } = parseInvites($("g-invite-text").value);
    if (!people.length) return said("g-invite-said", bad.length ? `Couldn't read ${bad.length === 1 ? "that" : "those"} as email addresses.` : "Type or paste an email address first.");
    const status = addAs();
    const { added, merged } = addPeople(people.map((p) => ({ ...p, status, source: "email" })));
    $("g-invite-text").value = bad.join("\n");
    said("g-invite-said", [added ? `Added ${plural(added, "person", "people")}${status === "registered" ? " as Registered" : ""}.` : "", merged ? `${merged} already on the list.` : "", bad.length ? `Couldn't read ${bad.length}: left in the box.` : ""].filter(Boolean).join(" "));
  });

  // An import: the rows, which column is what, and a preview (`table`, above).
  function readImport(text) {
    said("g-import-said", "");
    const rows = parseTable(text);
    if (!rows.length) { table = null; $("g-preview").hidden = true; return; }
    const header = looksLikeHeader(rows[0]);
    table = { rows, header, columns: header ? guessColumns(rows[0]) : rows[0].map((v) => (v.includes("@") ? "email" : null)) };
    renderPreview();
  }
  function renderPreview() {
    const { rows, header, columns } = table;
    const head = el("tr");
    columns.forEach((key, i) => {
      const th = el("th");
      const select = el("select");
      select.setAttribute("aria-label", `Column ${i + 1}${header ? `, ${rows[0][i]}` : ""}`);
      select.append(new Option("Don't use", ""), ...FIELDS.map((f) => new Option(f.label, f.key)));
      select.value = key || "";
      select.addEventListener("change", () => {
        table.columns = table.columns.map((k, j) => (j === i ? select.value || null : k === select.value ? null : k));
        renderPreview();
      });
      th.append(select);
      head.append(th);
    });
    const body = (header ? rows.slice(1) : rows).slice(0, 5).map((r) => {
      const tr = el("tr");
      columns.forEach((key, i) => { const td = el("td", key ? "" : "off", r[i] ?? ""); tr.append(td); });
      return tr;
    });
    const titles = header ? [(() => { const tr = el("tr"); rows[0].forEach((h) => tr.append(el("td", "dim", h))); return tr; })()] : [];
    $("g-preview-table").replaceChildren(head, ...titles, ...body);
    const { people, skipped } = peopleFromTable(rows, columns, { header });
    table.people = people;
    $("g-preview").hidden = false;
    said("g-preview-said", `${plural(people.length, "person", "people")} to add${skipped.length ? `; ${skipped.length} row${skipped.length === 1 ? "" : "s"} left out (${skipped.slice(0, 3).map((s) => `row ${s.row}: ${s.why}`).join("; ")}${skipped.length > 3 ? "…" : ""})` : ""}.`);
    $("g-import-add").disabled = !people.length;
    $("g-import-add").textContent = addAs() === "registered" ? `Add ${plural(people.length, "person", "people")} as Registered` : `Add and invite ${plural(people.length, "person", "people")}`;
  }
  $("g-file").addEventListener("change", async () => {
    const file = $("g-file").files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) return said("g-preview-said", "That file is too big for a registration list.");
    $("g-import-text").value = "";
    readImport(await file.text());
  });
  let pasteTimer = 0;
  $("g-import-text").addEventListener("input", () => { clearTimeout(pasteTimer); pasteTimer = setTimeout(() => readImport($("g-import-text").value), 250); });
  $("g-import-add").addEventListener("click", () => {
    if (!table?.people?.length) return;
    const status = addAs();
    const { added, merged } = addPeople(table.people.map((p) => ({ ...p, status, source: "import" })));
    said("g-import-said", `Added ${plural(added, "person", "people")}${status === "registered" ? " as Registered" : " to invite"}${merged ? `; ${merged} already on the list kept their strongest status` : ""}.`);
    table = null;
    $("g-preview").hidden = true;
    $("g-file").value = "";
    $("g-import-text").value = "";
  });

  // ── the day's waitlist (spots and waitlists, the user 11/8 late) ──
  // Promotion is the organizer's (Product's default): Promote, Promote next,
  // Remove and the order all go to the server, then the drive is read back.
  // Someone promoted on a sent drive gets their email straight away.
  let waitBusy = false;
  let waitlistsAt = 0;
  const nameOf = (id) => { const p = drive.attendees.find((x) => x.id === id); return p ? p.name || p.email : "They"; };

  /// The places and open spots (drive_waitlists, 0068). A server without
  /// it leaves the page as drive_get had it.
  async function loadWaitlists() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    try {
      const { days, places } = fromWaitlists(await api.rpc("drive_waitlists", { p_drive_id: drive.id }) || []);
      for (const p of drive.attendees) if (places[p.id]) p.waitlistAt = { ...(p.waitlistAt || {}), ...places[p.id] };
      drive.waitlists = days;
      waitlistsAt = Date.now();
      save();
      return true;
    } catch {
      return false;
    }
  }
  /// On Attendees: once a little while, when someone's waiting.
  function refreshWaitlists() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    if (!drive.synced?.created || !api.account() || Date.now() - waitlistsAt < 20_000) return;
    if (!drive.attendees.some((p) => p.waitlisted?.length)) return;
    waitlistsAt = Date.now();
    loadWaitlists().then((ok) => { if (ok && drive.step === "attendees") renderPeople(); });
  }

  /// The email for someone just promoted, on a sent drive: what it says.
  async function tellPromoted(id) {
    const who = nameOf(id);
    if (drive.server?.status !== "sent") return `${who} is in.`;
    try {
      const answer = await api.callFunction("drive-send", { drive_id: drive.id, audience: "waitlist", attendee_ids: [id] });
      if (answer?.sent) return `${who} is in. We emailed them.`;
      if (answer?.skipped_unsubscribed) return `${who} is in. They've stopped this club's emails, so nothing was sent.`;
      return `${who} is in. Send updates to tell them.`;
    } catch {
      return `${who} is in, but the email didn't go. Send updates to tell them.`;
    }
  }

  async function waitDo(call, args, done, { promotes = false } = {}) {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    if (waitBusy) return;
    if (!drive.synced?.created) return said("g-wait-said", "Send it to yourself first, so the drive is on Carve.");
    waitBusy = true;
    said("g-wait-said", "Saving…");
    try {
      const result = await api.rpc(call, args);
      const promoted = promotes ? args.p_attendee_id || result?.promoted || null : null;
      const got = await api.rpc("drive_get", { p_drive_id: drive.id });
      if (got) {
        const byId = new Map((got.attendees || []).map((a) => [a.id, a]));
        for (const p of drive.attendees) {
          const a = byId.get(p.id);
          if (!a) continue;
          delete p.waitlisted;
          delete p.waitlistAt;
          Object.assign(p, waitlistFields(a.days || []));
          if (a.status) p.status = a.status;
        }
        drive.server = keepServer(got);
        save();
      }
      await loadWaitlists();
      said("g-wait-said", promoted ? await tellPromoted(promoted) : done);
    } catch (failure) {
      const code = failure?.data?.message || failure?.message;
      said("g-wait-said", code === "full" ? "No spot is open. Promote someone by name to go past the limit."
        : code === "not_found" && call === "drive_waitlist_promote_next" ? "Nobody is waiting."
        : "Couldn't change the waitlist. Try again.");
    } finally {
      waitBusy = false;
      renderPeople();
    }
  }
  function renderWaitlist() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    const d = day();
    const list = waitlistFor(drive.attendees, d.id);
    $("g-wait").hidden = !list.length;
    if (!list.length) return;
    $("g-wait-count").textContent = waitingText(list.length);
    const server = drive.server?.days?.find((x) => x.id === d.id);
    const counted = drive.waitlists?.[d.id];
    const org = planOrg();
    const limit = counted ? counted.limit : server?.limit ?? (Number.isInteger(d.spots) ? d.spots : org?.tier === "group" ? org.drive_cap ?? null : null);
    const going = counted?.coming ?? server?.counts?.coming ?? drive.attendees.filter((p) => (p.status === "going" || p.status === "registered") && !p.waitlisted?.includes(d.id)).length;
    const open = counted && Number.isInteger(counted.open) ? counted.open : openSpots(limit, going);
    $("g-wait-open").hidden = !open;
    $("g-wait-open-text").textContent = openText(open);
    let dragFrom = -1;
    $("g-wait-list").replaceChildren(...list.map((p, i) => {
      const li = el("li", "g-wait-item");
      li.draggable = true;
      li.dataset.id = p.id;
      li.addEventListener("dragstart", (event) => { dragFrom = i; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", p.id); });
      li.addEventListener("dragover", (event) => event.preventDefault());
      li.addEventListener("drop", (event) => {
        event.preventDefault();
        if (dragFrom < 0 || dragFrom === i) return;
        waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: moved(list, dragFrom, i) }, "Order saved.");
      });
      const who = el("span", "who", placeText(p, i));
      const up = el("button", "g-wait-move", "↑");
      up.type = "button";
      up.disabled = i === 0;
      up.setAttribute("aria-label", `Move ${p.name || p.email} up`);
      up.addEventListener("click", () => waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: moved(list, i, i - 1) }, `${p.name || p.email} moved up.`));
      const down = el("button", "g-wait-move", "↓");
      down.type = "button";
      down.disabled = i === list.length - 1;
      down.setAttribute("aria-label", `Move ${p.name || p.email} down`);
      down.addEventListener("click", () => waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: moved(list, i, i + 1) }, `${p.name || p.email} moved down.`));
      const promote = el("button", "pill green small", "Promote");
      promote.type = "button";
      promote.setAttribute("aria-label", `Promote ${p.name || p.email}`);
      promote.addEventListener("click", () => waitDo("drive_waitlist_promote", { p_attendee_id: p.id, p_day_id: d.id }, "", { promotes: true }));
      const remove = el("button", "textlink small", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${p.name || p.email} from the waitlist`);
      remove.addEventListener("click", () => waitDo("drive_waitlist_remove", { p_attendee_id: p.id, p_day_id: d.id }, `${p.name || p.email} is off the waitlist.`));
      li.append(who, up, down, promote, remove);
      return li;
    }));
  }
  $("g-wait-next").addEventListener("click", () => waitDo("drive_waitlist_promote_next", { p_day_id: day().id }, "", { promotes: true }));

  // ── Group: one group, an optional lead and sweep ──
  /// Every day's board, one group: lead and sweep placed in it (so their
  /// emails say so), everyone else not placed; it leaves at the day's time.
  function setSingleGroup(lead, sweep) {
    for (const d of drive.days) {
      const placements = {};
      if (lead) placements[lead] = 1;
      if (sweep) placements[sweep] = 1;
      drive.boards[d.id] = {
        settings: { count: 1, target: 20, gap: 0, first: null },
        groups: lead || sweep ? [{ number: 1, label: null, target: 20, offset: 0, lead: lead || null, sweep: sweep || null }] : [],
        placements, by: {},
      };
    }
    save();
  }
  function renderLeadSweep() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    const on = onGroupPlan();
    $("g-ls").hidden = !on;
    if (!on) return;
    const current = drive.boards?.[day().id]?.groups?.[0] || {};
    const coming = drive.attendees.filter((p) => p.status === "going" || p.status === "registered");
    for (const [id, key] of [["g-lead", "lead"], ["g-sweep", "sweep"]]) {
      const select = $(id);
      select.replaceChildren(new Option("Nobody", ""), ...coming.map((p) => new Option(p.name || p.email, p.id)));
      select.value = coming.some((p) => p.id === current[key]) ? current[key] : "";
    }
  }
  for (const id of ["g-lead", "g-sweep"]) {
    $(id).addEventListener("change", () => {
      const lead = $("g-lead").value || null;
      let sweep = $("g-sweep").value || null;
      if (sweep && sweep === lead) sweep = null; // one person can't be both
      setSingleGroup(lead, sweep);
      renderLeadSweep();
    });
  }

  $("g-filter").addEventListener("change", renderPeople);
  function renderPeople() {
    if (plugged.attendees) return; // 32512's Attendees step draws these now
    const c = counts(drive.attendees);
    // The day's meter: everyone on the list, its spots, who's going that day.
    const d = day();
    const org = planOrg();
    const spots = Number.isInteger(d.spots) ? d.spots : org?.tier === "group" ? org.drive_cap ?? null : null;
    const goingThatDay = drive.attendees.filter((p) => (p.status === "going" || p.status === "registered") && !p.waitlisted?.includes?.(d.id)
      && (!Array.isArray(p.days) || p.days.includes(d.id))).length;
    const waiting = drive.attendees.filter((p) => p.waitlisted?.includes?.(d.id)).length;
    const meter = meterLine({ invited: c.total, spots, going: goingThatDay, waiting });
    // Going is the meter's (waitlisted Yes answers aren't going yet).
    const detail = [c.registered ? `${c.registered} registered` : "", c.maybe ? `${c.maybe} maybe` : "", c.no ? `${c.no} can't make it` : ""].filter(Boolean).join(" · ");
    $("g-counts").textContent = c.total ? `${drive.days.length > 1 ? `Day ${drive.active.day + 1}: ` : ""}${meter}${detail ? `. ${detail}.` : ""}` : "";
    renderWaitlist();
    renderLeadSweep();
    const filter = $("g-filter").value;
    const shown = drive.attendees.filter((p) => !filter || p.status === filter)
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    $("g-people").replaceChildren(...shown.map((p) => {
      const li = el("li");
      const who = el("span", "who");
      who.append(el("b", "", p.name || p.email), el("span", "", [p.name ? p.email : "", p.car || ""].filter(Boolean).join(" · ")));
      li.append(who);
      if (p.first_timer) li.append(el("span", "chip first", "First time"));
      if (p.style) li.append(el("span", "chip", p.style.charAt(0).toUpperCase() + p.style.slice(1)));
      li.append(el("span", `chip ${p.status}`, STATUS_WORDS[p.status] || p.status));
      const remove = el("button", "clear", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${p.name || p.email}`);
      remove.addEventListener("click", () => {
        drive.attendees = drive.attendees.filter((x) => x !== p);
        save();
        renderPeople();
      });
      li.append(remove);
      return li;
    }));
    $("g-people-empty").hidden = drive.attendees.length > 0;
    $("g-people-empty").textContent = filter && !shown.length && drive.attendees.length ? "Nobody with that status." : "Nobody yet. Invite people or import a list.";
    if (filter && !shown.length && drive.attendees.length) $("g-people-empty").hidden = false;
  }

  // ── Groups: the board ──
  const board = initBoard({ $, el, drive, day, save });

  // ── Send ──
  sender = initSend({
    $, el, api,
    // "Put them in groups" (the ungrouped warning).
    go: (step) => go(step),
    // New link refused: the Attendees step's words for the route link's codes.
    linkRefusal: routeLinkRefusal,
    // A send can finish the step, and once the drive is on the server its
    // page opens: the bar and the links show it.
    save: () => {
      save();
      for (const b of bar.querySelectorAll(".g-step")) b.classList.toggle("done", stepDone(b.dataset.step));
      $("g-page-link").hidden = drive.step === "page" || drive.step === "drives" || !sentForReal(drive);
      $("g-next").hidden = drive.step === "page" || drive.step === "drives" || (drive.step === "send" && !drive.server);
    },
    drive: () => drive,
    // Defined below, with the page's other server reads.
    pull: () => fetchServer(),
    merged,
    flush: () => { leg().plan = api.snapshot(); },
    // The planner's route keeps the id and link it was saved with.
    adopt: () => { const p = leg().plan; if (p?.id) api.adopt({ id: p.id, token: p.token, createdAt: p.createdAt, ownerId: p.ownerId }); },
  });

  // ── The server's changes (QA S2, 11/9) ──
  // Co-organizers, people answering and other devices change the drive too:
  // it's read again on opening, on coming back to the tab and before each
  // save (send.js), and merged part by part (drive-merge.js). Where both
  // changed the same part, the organizer chooses.
  let pulling = null;
  let pulledAt = 0;
  const fetchServer = () => draftFromServer(api, drive.id);
  function merged({ took = [] } = {}) {
    // The leg on the map, when its route or day came from the server.
    if (took.some((k) => k.startsWith("routes:") || k.startsWith("day:"))) {
      drive.active.leg = Math.min(drive.active.leg, day().legs.length - 1);
      switching = true;
      api.loadPlan(leg().plan || seed(day(), drive.active.leg));
      switching = false;
      leg().plan = api.snapshot();
      syncLeave();
      drawNotes();
    }
    clearTimeout(saveTimer);
    store.set(DRAFT_KEY, drive);
    renderConflicts();
    if (took.length) show();
  }
  async function pull() {
    if (!drive.synced?.created || drive.uploading || !api.account?.() || sender?.busy) return null;
    if (pulling) return pulling;
    leg().plan = api.snapshot();
    pulling = (async () => {
      try {
        const fresh = await fetchServer();
        // Not there (deleted, or not answered): leave the draft as it is.
        if (sender?.busy || !fresh?.got?.id) return null;
        const result = mergeServer(drive, fresh.next);
        drive.server = keepServer(fresh.got) || drive.server;
        merged(result);
        return result;
      } catch {
        return null;
      } finally {
        pulling = null;
        pulledAt = Date.now();
      }
    })();
    return pulling;
  }
  const listWords = (w) => (w.length > 1 ? `${w.slice(0, -1).join(", ")} and ${w.at(-1)}` : w[0] || "");
  function renderConflicts() {
    const words = conflictWords(drive);
    $("g-conflict").hidden = !words.length;
    if (words.length) $("g-conflict-said").textContent = `Someone else changed ${listWords(words)} too. Keep theirs, or use yours?`;
  }
  $("g-conflict-theirs").addEventListener("click", () => { resolveConflicts(drive, "theirs"); renderConflicts(); pull(); });
  $("g-conflict-mine").addEventListener("click", () => { resolveConflicts(drive, "mine"); renderConflicts(); save(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - pulledAt > 10_000) pull();
  });

  // ── The drive page ──
  const page = initPage({ $, el, api, save, sender, go, drive: () => drive, onGroupPlan });

  // ── Your drives ──
  // Another drive (or a new one) becomes this browser's draft, and the page
  // starts again on it: the planner's copy of the old leg goes too.
  const drives = initDrives({
    $, el, api, go, store, pull,
    drive: () => drive,
    replace: (next, got) => {
      clearTimeout(saveTimer);
      const fresh = next || blankDrive();
      if (got) fresh.server = keepServer(got);
      store.set(DRAFT_KEY, fresh);
      store.remove(PLAN_KEY);
      location.reload();
    },
  });

  // The active leg's route into the planner (or the planner's own, adopted).
  switching = true;
  if (leg().plan) api.loadPlan(leg().plan);
  switching = false;
  leg().plan = api.snapshot();
  api.onMapReady(drawNotes);
  syncLeave();
  plugIn();
  // The Pre-run step (mine), plugged like the others; it needs the sender and the page.
  plugged.prerun = initPrerunStep({
    $, el, api, drive: () => drive, save, section: $("g-prerun"), go, org: planOrg, sender, page, prerunDate,
    editWhen: (key) => { go("when"); whenAsk?.edit(key); },
  });
  document.body.classList.add("gshell");
  show();
  loadPlanOrgs();
  renderConflicts();
  pull();
  $("g-saved").textContent = drive.updatedAt && store.get(DRAFT_KEY) ? "Draft saved in this browser" : "";
  return {
    /// The map's menu gains "Add a map note" in group mode.
    menuChoices: () => [{ key: "note", label: "Add a map note", icon: '<span class="badge note">✎</span>' }],
    pick: (key, at) => { if (key === "note") addNote(at); },
    get step() { return drive.step; },
    go,
    /// Signed in from the Send step: its organizations.
    signedIn: () => { pull(); return sender.refresh(); },
  };
}
