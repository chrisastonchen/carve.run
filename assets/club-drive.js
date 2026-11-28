// carve.run/club/drive/, club v2 (the wires' O3 and O4; Chris, 11/9 night).
//   ?org=<club>           New drive: name, the date with meet and leave
//                         times, + Add a day, the pre-run (Club).
//                         Create: one day opens the planner on it; more
//                         open this drive's page. The drive is the club's
//                         it was planned from (Product, 11/9).
//   ?id=<drive>           The drive page: a card per day (Add a route ▾,
//                         then Route ▾: edit, replace or remove it; Share
//                         once it has a route), the pre-run card, More ▾
//                         Edit details and Delete drive.
//   ?id=<drive>&edit      Edit details: the same form, filled in.
//   ?id=<drive>&groups    The groups board (run groups, run-groups.js).
//   ?copy=<drive>         Duplicate (Club home's ⋯): the new-drive form
//                         filled from that drive, dates empty; Create
//                         copies each day's route as a new route and link.
// Pages never act on a GET: every change is a tap.

import { routeCopy, routeRow, newShareToken } from "/plan/route-wire.js?v=7";
import { $, el, insert, myOrgs, rpc, select, sessionUserId, signedIn, update } from "/assets/club-api.js?v=ab5108fda2";
import { applyLook, coverOf, logoInto } from "/assets/club-look.js?v=5a0ad6b0e5";
import { renderAlbum } from "/assets/drive-album.js?v=693f7c321a";
import { ALBUM_UI } from "/plan/club-flags.js?v=5";
import { uploadPhoto } from "/assets/photo-upload.js?v=c7b700d355";
import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";
import { coverInto } from "/assets/cover.js?v=644e607c2f";
import { confirmDelete, confirmRemove } from "/assets/drive-delete.js?v=637335aabd";
import { timeSelects } from "/assets/club-time.js?v=02f4200f94";
import { openImport, renderBoard } from "/assets/run-groups.js?v=213543fd27";
import { MOST_GROUPS, REFUSAL, boardLine, groupsDown, groupsText, groupsUp } from "/assets/run-groups-words.js?v=97350e9980";
import { DEFAULT_MEET, TIME_MISSING, addDays, apexWindow, datesText, dayWhenProblem, inDays, zoneNow, leaveAfter, libraryParts, libraryRows, meetLeave, prerunDefault, dayText, blankPattern, formProblemAt, routeFacts, shapeSvg, statusChip, timeText, updatedAgo, clubTitle, lookSrc } from "/assets/club-words.js?v=b2e82d803a";

const q = new URLSearchParams(location.search);
const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/// The drive's own time zone (a new one: this browser's), for "today".
const driveZone = () => drive?.time_zone || zone();
// Miles in the US and the UK, as the planner's usesMiles.
const miles = () => /^en(-(US|GB))?$/i.test(navigator.language || "en-US");

/// The planner on one day of a drive (O5). Share (O7) and the pre-run (O6)
/// are the day's own route page, carve.run/<token>, in the club's view
/// (share_page.js and club-share.js).
export const plannerUrl = (driveId, n) => `/plan/?drive=${encodeURIComponent(driveId)}&day=${n}`;
/// The pre-drive report (O6b) on day n.
export const reportUrl = (driveId, n) => `/club/drive/report/?id=${encodeURIComponent(driveId)}&day=${n}`;
export const shareUrl = (token, driveId, n, prerun = false) => `/${encodeURIComponent(token)}?club=${encodeURIComponent(driveId)}&day=${n}${prerun ? "&prerun" : ""}`;

let org = null;
let drive = null; // drive_get
let routes = []; // drive_routes
let source = null; // Duplicate: the drive copied ({ drive, routes })
let board = null; // run_group_board (run groups, 0130), or null when it can't be read
let groupCount = 0; // the form's "How many driving groups?"
/// The groups board's link.
export const groupsUrl = (driveId) => `/club/drive/?id=${encodeURIComponent(driveId)}&groups`;

async function start() {
  if (!(await signedIn())) {
    status("");
    $("o-signin").hidden = false;
    $("o-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: location.pathname + location.search }));
    return;
  }
  let orgs;
  try {
    orgs = await myOrgs();
    if (q.get("id")) {
      [drive, routes, board] = await Promise.all([rpc("drive_get", { p_drive_id: q.get("id") }), rpc("drive_routes", { p_drive_id: q.get("id") }).catch(() => []),
        rpc("run_group_board", { p_drive_id: q.get("id") }).catch(() => null)]);
      routes ||= [];
    } else if (q.get("copy")) {
      const [d, r] = await Promise.all([rpc("drive_get", { p_drive_id: q.get("copy") }), rpc("drive_routes", { p_drive_id: q.get("copy") }).catch(() => [])]);
      source = { drive: d, routes: r || [] };
    }
  } catch (failure) {
    return status(failure.message);
  }
  org = orgs.find((o) => o.id === (drive?.org_id || source?.drive?.org_id || q.get("org"))) || null;
  if (!org) return status(drive ? "This drive's club isn't one you organize." : "Pick the club from its page first.");
  status("");
  const back = `/club/?org=${encodeURIComponent(org.id)}`;
  $("f-back").textContent = `‹ ${org.name}`;
  $("f-back").setAttribute("href", back);
  $("d-back").setAttribute("href", back);
  // The club's color on its drive pages, the header too (Chris, 11/26).
  applyLook(org);
  if (source) return openForm(null, source.drive);
  if (!drive) return openForm(null);
  if (q.has("edit")) return openForm(drive);
  if (q.has("groups")) return renderGroups();
  renderDrive();
}

// ── New drive / Edit details (O3) ──

/// A club with an active plan (Club or its trial): every feature (one plan, Chris 11/10 afternoon).
const onPlan = () => BY_TIER[org?.tier]?.for === "organizers";
let days = []; // [{ id, date, meet, leave, leaveSet, routed }]; leaveSet: Leave chosen, not following Meet
let gone = []; // day ids taken off while editing
let prerun = { on: false, date: "" };
let confirming = null; // a routed day's id, asked once before it comes off
let made = null; // a new drive as drive_create answered it (tried again: the same drive, its days)

// ── 5 and 6, and folding what's answered (mock v13) ──

let photoUrl = null; // Add a photo's, checked and published (screen-photo)
function renderPhoto() {
  $("f-photo-pick").hidden = !photoUrl;
  $("f-photo-drop").hidden = !!photoUrl;
  if (photoUrl) $("f-photo-img").src = lookSrc(photoUrl);
}
async function takePhoto(file) {
  if (!file) return;
  $("f-photo-said").textContent = "Checking the photo…";
  try {
    photoUrl = (await uploadPhoto(file, sessionUserId())).url;
    $("f-photo-said").textContent = "";
    renderPhoto();
  } catch (failure) {
    $("f-photo-said").textContent = failure.message || "Couldn't add the photo. Try again.";
  }
}

/// The answered questions above 5 fold to one line once 5 or 6 has the
/// focus (Chris via Product, 11/26); a folded line opens them again.
const FOLDS = [
  ["f-q-name", "Name", () => $("f-name").value.trim()],
  ["f-q-when", "When", () => { const d = days.filter((x) => x.date); return d.length ? [datesText(d), ...meetLeave(d[0])].join(" · ") : ""; }],
  ["f-prerun", "Pre-drive", () => (prerun.on ? (prerun.date ? dayText(prerun.date) : "") : "No")],
  ["f-groups", "Driving groups", () => groupsText(groupCount) || "No groups"],
];
function fold() {
  for (const [id, label, value] of FOLDS) {
    const sec = $(id);
    const v = value();
    if (sec.hidden || !v) continue;
    let line = sec.previousElementSibling?.classList.contains("cd-fold") ? sec.previousElementSibling : null;
    if (!line) {
      line = el("button", "cd-fold");
      line.type = "button";
      line.addEventListener("click", () => { unfold(); sec.querySelector("input, button, select, textarea")?.focus(); });
      sec.before(line);
    }
    line.replaceChildren(el("span", "cd-fold-n", sec.querySelector(".cd-n")?.textContent || ""), el("span", "cd-fold-k", label), el("b", "", v));
    line.setAttribute("aria-label", `${label}: ${v}. Change`);
    line.hidden = false;
    sec.classList.add("folded");
  }
}
function unfold() {
  for (const [id] of FOLDS) {
    $(id).classList.remove("folded");
    const line = $(id).previousElementSibling;
    if (line?.classList.contains("cd-fold")) line.hidden = true;
  }
}

/// `d`: the drive being edited. `copy`: the drive being duplicated (a new
/// drive filled from it: "(copy)", its days' times, no dates; each day
/// remembers the day it came from, for its route).
function openForm(d, copy = null) {
  $("f-page").hidden = false;
  document.title = d ? "Edit details | Carve" : copy ? "Duplicate drive | Carve" : "Plan a drive | Carve";
  $("f-title").textContent = d ? "Edit details" : copy ? "Duplicate drive" : "Plan a drive";
  // A new drive asks its questions with no title over them (mock v11); Edit and Duplicate say which.
  $("f-title").classList.toggle("visually-hidden", !d && !copy);
  $("f-go").textContent = d ? "Save" : "Create drive";
  $("f-go").classList.toggle("cd-arrow", !d);
  $("f-cancel").setAttribute("href", d ? `/club/drive/?id=${encodeURIComponent(d.id)}` : `/club/?org=${encodeURIComponent(org.id)}`);
  $("f-name").value = d?.name || (copy ? `${copy.name || "Untitled drive"} (copy)` : "");
  const routed = new Set(routes.map((r) => r.day_id));
  const hm = (t) => (t || "").slice(0, 5);
  days = d ? d.days.map((x) => ({ id: x.id, date: x.date || "", meet: hm(x.meet), leave: hm(x.leave), leaveSet: true, routed: routed.has(x.id) }))
    : copy?.days?.length ? copy.days.map((x) => ({ id: crypto.randomUUID(), date: "", meet: hm(x.meet) || DEFAULT_MEET, leave: hm(x.leave) || leaveAfter(hm(x.meet) || DEFAULT_MEET), leaveSet: true, from: x.id }))
    : [{ id: crypto.randomUUID(), date: "", meet: DEFAULT_MEET, leave: leaveAfter(DEFAULT_MEET), leaveSet: false }];
  // The pre-drive answer comes with a copy; its date is picked again.
  const pr = d?.prerun || copy?.prerun;
  prerun = { on: !!pr, date: d?.prerun?.date || "" };
  $("f-copy-note").hidden = !copy;
  if (copy) $("f-copy-note").textContent = `From ${copy.name || "your drive"}: the times${copy.prerun ? " and the pre-drive" : ""} and each day's route, with new links. Pick the dates.`;
  // The pre-drive on every club with a plan, with no plan label (O3, v41).
  $("f-prerun").hidden = !onPlan() && !pr;
  // How many driving groups (run groups §1.1): the next question's number.
  groupCount = d ? board?.group_count ?? 0 : 0;
  $("f-gr-num").textContent = $("f-prerun").hidden ? "3" : "4";
  $("f-groups").hidden = !!d && !board;
  // 5 and 6 (Chris via Product, 11/26): numbered after the groups question.
  const last = $("f-groups").hidden ? Number($("f-gr-num").textContent) - 1 : Number($("f-gr-num").textContent);
  $("f-ab-num").textContent = String(last + 1);
  $("f-ph-num").textContent = String(last + 2);
  $("f-about-in").value = d?.description || "";
  $("f-about-count").textContent = `${$("f-about-in").value.length} / 1000`;
  photoUrl = d?.photo_url || null;
  renderPhoto();
  unfold();
  renderGroupCount();
  renderDays();
  renderPrerun();
  $("f-name").focus();
}

function renderDays() {
  const several = days.length > 1;
  $("f-days").replaceChildren(...days.map((d, i) => {
    const row = el("div", "cv-day-row cd-day-row");
    const date = input("date", d.date, several ? `Day ${i + 1} date` : "Date", (v) => {
      const before = days[i].date;
      days[i].date = v;
      // A note from the last Create goes once the date changes (the rows
      // aren't rebuilt now, so nothing else clears it).
      sayOn(date, "");
      // Only a whole date moves the later days: Chrome says "changed" as
      // each part is typed, 0002 for the first digit of 2026 (QA, 11/13).
      // The rows stay as they are, so the typing keeps its place.
      if (!wholeDate(v)) return;
      // Later days follow a moved day, a day apart at least (group.js's
      // followDates); days with no date yet (a duplicate's) take the next ones.
      const rows = $("f-days").children;
      for (let j = i + 1; j < days.length; j++) {
        if (days[j].date && !(before && days[j].date <= days[j - 1].date) && wholeDate(days[j].date)) continue;
        days[j].date = addDays(days[j - 1].date, 1);
        const next = rows[j]?.querySelector("input[type=date]");
        if (next) { next.value = days[j].date; next.markBlank?.(); }
      }
    });
    // No date before today in the picker (Chris, 11/10); a saved past day still shows its date.
    date.min = zoneNow(Date.now(), driveZone()).date;
    // Meet and Leave as three selects each (Chris, 11/14: no time popup in
    // Safari); each change is a whole time or none.
    const meet = time(d.meet, `${several ? `Day ${i + 1} meet` : "Meet"} time`, (v) => {
      days[i].meet = v;
      // Leave follows Meet by half an hour until it's set by hand; a Leave
      // set by hand moves on when Meet passes it.
      if (v && (!days[i].leaveSet || (days[i].leave && days[i].leave < v))) {
        days[i].leave = leave.value = leaveAfter(v);
        missing(leave, "leave");
        sayOn(leave, "");
      }
      missing(meet, "meet");
    });
    const leave = time(d.leave, `${several ? `Day ${i + 1} leave` : "Leave"} time`, (v) => {
      days[i].leave = v;
      days[i].leaveSet = true;
      if (!missing(leave, "leave")) sayOn(leave, leaveEarly(days[i]) ? LEAVE_EARLY : "");
    });
    // One row a day (mock v11): DAY N, then Date, Meet and Leave as pickers.
    row.append(el("span", "cd-dn", `Day ${i + 1}`), field("Date", date, "cv-date"), field("Meet", meet), field("Leave", leave));
    if (several) {
      const remove = el("button", confirming === d.id ? "cv-x ask" : "cv-x", confirming === d.id ? "Remove, with its route" : "✕");
      remove.type = "button";
      remove.setAttribute("aria-label", confirming === d.id ? `Confirm: remove Day ${i + 1} and its route` : `Remove Day ${i + 1}`);
      remove.addEventListener("click", () => {
        if (d.routed && confirming !== d.id) { confirming = d.id; return renderDays(); }
        confirming = null;
        if (drive?.days?.some((x) => x.id === d.id)) gone.push(d.id);
        days.splice(i, 1);
        renderDays();
      });
      row.append(remove);
    }
    return row;
  }));
  $("f-add-day").hidden = false;
}

/// A date typed or picked whole: four year digits, this year or later.
const wholeDate = (v) => {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(v || "");
  return !!m && Number(m[1]) >= new Date().getFullYear() && Number(m[1]) <= new Date().getFullYear() + 10;
};
const LEAVE_EARLY = "Leave is before meet.";
const leaveEarly = (d) => !!(d.meet && d.leave && d.leave < d.meet);

function time(value, label, set) {
  const box = timeSelects(value, label);
  box.addEventListener("change", () => set(box.value));
  return box;
}

function input(type, value, label, set) {
  const i = el("input");
  i.type = type;
  i.value = value || "";
  i.setAttribute("aria-label", label);
  i.addEventListener(type === "date" ? "change" : "input", () => set(i.value));
  return i;
}
/// A picker (mock v11): its label over the browser's own date or time
/// field, seen and used as it is: clicked, typed into, stepped with the
/// arrows, in every browser (Chris, 11/13: an invisible field over our own
/// text couldn't be clicked where there's no time popup, Safari and Firefox).
function field(name, control, more = "") {
  const l = el("label", `cd-pick cv-time${more ? ` ${more}` : ""}`);
  l.append(el("small", "cv-time-name", name), control);
  if (control.tagName === "INPUT") pickOnTap(l, control);
  return l;
}
/// A click anywhere on the picker opens the browser's calendar or clock
/// where it has one (showPicker); where it hasn't, the field has the focus.
function pickOnTap(box, control) {
  blankWhileEmpty(box, control);
  box.addEventListener("click", (e) => {
    if (e.target !== control) control.focus();
    if (!matchMedia("(pointer: fine)").matches || typeof control.showPicker !== "function") return;
    try { control.showPicker(); } catch {}
  });
}

/// An empty date reads "mm / dd / yy" (the locale's order), not the faded
/// real date Safari puts there (Chris, 11/14), until it's focused or set.
function blankWhileEmpty(box, control) {
  box.dataset.blank = blankPattern();
  const mark = () => box.classList.toggle("blank", !control.value);
  control.addEventListener("input", mark);
  control.addEventListener("change", mark);
  control.markBlank = mark;
  mark();
}

/// The note said on a field, for the top line.
const fieldNote = (control) => document.getElementById(control.getAttribute("aria-describedby") || "")?.textContent || "";

/// What's wrong with a field, said under it; "" clears it.
function sayOn(control, text) {
  const box = control.closest(".cv-time");
  let note = box ? box.querySelector(".cv-miss") : control.nextElementSibling?.classList.contains("cv-miss") ? control.nextElementSibling : null;
  if (text && !note) {
    note = el("small", box ? "cv-miss" : "cv-miss cv-miss-line");
    note.id = `miss-${crypto.randomUUID().slice(0, 8)}`;
    note.setAttribute("role", "alert");
    if (box) box.append(note); else control.after(note);
    control.setAttribute("aria-describedby", note.id);
  }
  if (note && !text) {
    // Fixed: the note goes, so nothing empty is left to read.
    note.remove();
    control.removeAttribute("aria-describedby");
  } else if (note) note.textContent = text;
  control.toggleAttribute("aria-invalid", !!text);
}

/// An emptied time says so on its field ("Add a meet time"). → missing?
function missing(control, which) {
  const empty = !control.value;
  sayOn(control, empty ? TIME_MISSING[which] : "");
  return empty;
}

function renderGroupCount() {
  $("f-gr-val").textContent = groupsText(groupCount);
  $("f-gr-down").disabled = groupCount === 0;
  $("f-gr-up").disabled = groupCount >= MOST_GROUPS;
}

function renderPrerun() {
  $("f-pr-yes").setAttribute("aria-pressed", String(prerun.on));
  $("f-pr-no").setAttribute("aria-pressed", String(!prerun.on));
  // The date inside Yes (mock v11).
  $("f-pr-pick").hidden = !prerun.on;
  $("f-pr-date").value = prerun.date || "";
  $("f-pr-date").markBlank?.();
}

async function submit(e) {
  e.preventDefault();
  unfold();
  const say = (t) => { $("f-said").textContent = t; };
  // What's wrong, in red at the top and on its field (Chris, 11/14).
  const wrong = (t) => { $("f-err").textContent = t; $("f-err").hidden = !t; };
  // Said again from scratch each time (QA, 11/13: a stale pre-drive line).
  say("");
  wrong("");
  sayOn($("f-name"), "");
  sayOn($("f-pr-date"), "");
  const name = $("f-name").value.trim();
  const problem = formProblemAt({ name, days, prerun, prerunWas: drive?.prerun?.date || null });
  if (problem) {
    const rows = $("f-days").querySelectorAll(".cv-day-row");
    const control = problem.at === "name" ? $("f-name") : problem.at === "prerun" ? $("f-pr-date")
      : problem.at.field === "date" ? rows[problem.at.day]?.querySelector("input[type=date]") : rows[problem.at.day]?.querySelectorAll(".cd-tsel")[1];
    wrong(problem.text);
    if (control) { sayOn(control, problem.text); control.focus(); }
    return;
  }
  // Both times on every day (the server refuses a day without them), said
  // on the field.
  const times = [...$("f-days").querySelectorAll(".cv-day-row")].flatMap((row) => {
    const [meet, leave] = row.querySelectorAll(".cd-tsel");
    return [missing(meet, "meet") && meet, missing(leave, "leave") && leave].filter(Boolean);
  });
  if (times.length) { wrong(fieldNote(times[0])); return times[0].focus(); }
  // Leave before Meet (QA, 11/13): said on the Leave.
  const early = [...$("f-days").querySelectorAll(".cv-day-row")].map((row, i) => {
    if (!leaveEarly(days[i])) return null;
    const control = row.querySelectorAll(".cd-tsel")[1];
    sayOn(control, LEAVE_EARLY);
    return control;
  }).filter(Boolean);
  if (early.length) { wrong(LEAVE_EARLY); return early[0].focus(); }
  // No day in the past, and today's meet 30 minutes out, in the drive's zone
  // (Chris, 11/10; the server's 0061 says the same). A saved day left as it
  // was may stay where it is.
  const saved = drive || made;
  const late = [...$("f-days").querySelectorAll(".cv-day-row")].map((row, i) => {
    const p = dayWhenProblem(days[i], { was: saved?.days?.find((x) => x.id === days[i].id) || null, zone: driveZone() });
    if (!p) return null;
    const control = p.field === "date" ? row.querySelector("input[type=date]") : row.querySelector(".cd-tsel");
    sayOn(control, p.text);
    return control;
  }).filter(Boolean);
  if (late.length) { wrong(fieldNote(late[0])); return late[0].focus(); }
  $("f-go").disabled = true;
  say(drive ? "Saving…" : "Making the drive…");
  const id = drive?.id || made?.id || crypto.randomUUID();
  // What's on the server already: the drive being edited, or the one made
  // on an earlier try.
  const base = drive || made;
  try {
    if (!base) {
      // The drive and its days in one call (0086): a day refused refuses
      // the drive, so none is left empty (DevOps, 11/10).
      made = await rpc("drive_create", { p_org_id: org.id, p_name: name, p_time_zone: zone(), p_id: id,
        p_days: days.map((d) => ({ date: d.date, meet: d.meet, leave: d.leave, place: null })) });
      // The server's day ids, in order, so a retry changes them in place.
      (made.days || []).forEach((x, i) => { if (days[i]) days[i].id = x.id; });
    } else if (name !== base.name) await rpc("drive_update", { p_drive_id: id, p_patch: { name } });
    for (const dayId of gone) await rpc("drive_day_delete", { p_day_id: dayId });
    for (const d of days) {
      const was = (drive || made)?.days?.find((x) => x.id === d.id);
      // Day N+1 starts where Day N ends: the planner's (O5); the place stays the server's.
      if (!was || was.date !== d.date || (was.meet || "").slice(0, 5) !== d.meet || (was.leave || "").slice(0, 5) !== d.leave) {
        await rpc("drive_day_put", { p_drive_id: id, p_day: { id: d.id, date: d.date, meet: d.meet || null, leave: d.leave || null, place: was?.place ?? null } });
      }
    }
    if (source) await copyRoutes(id);
    const had = (drive || made)?.prerun || null;
    if (prerun.on && (!had || had.date !== prerun.date)) await rpc("drive_prerun_set", { p_drive_id: id, p_date: prerun.date });
    else if (!prerun.on && had) await rpc("drive_prerun_set", { p_drive_id: id, p_off: true });
    // 5 and 6 (0141): only when they changed; a server without 0141 says
    // no, and the drive is made all the same.
    const about = $("f-about-in").value.trim();
    const was = drive || made;
    const patch = {};
    if (about !== String(was?.description || "").trim()) patch.description = about;
    if ((photoUrl || null) !== (was?.photo_url || null)) patch.photo_url = photoUrl || null;
    if (Object.keys(patch).length) {
      try {
        const got = await rpc("drive_update", { p_drive_id: id, p_patch: patch });
        if (made) Object.assign(made, { description: got?.description ?? about, photo_url: got?.photo_url ?? photoUrl });
      } catch (failure) {
        if (failure.code !== "bad_input") throw failure;
      }
    }
    // The groups (0130): only when the answer changed.
    if (!$("f-groups").hidden && groupCount !== (drive ? board?.group_count ?? 0 : made?.group_count ?? 0)) {
      const b = await rpc("run_group_count_set", { p_drive_id: id, p_count: groupCount });
      if (made) made.group_count = b?.group_count ?? groupCount;
    }
  } catch (failure) {
    $("f-go").disabled = false;
    say("");
    return wrong(REFUSAL[failure.code] || failure.message);
  }
  // A duplicate: a day's route that didn't copy is said, and Create tries again.
  const missed = days.map((d, i) => (d.copy === false ? i + 1 : 0)).filter(Boolean);
  if (missed.length) {
    $("f-go").disabled = false;
    $("f-go").textContent = "Try again";
    say("");
    return wrong(`The drive is made, but ${missed.map((n) => `Day ${n}`).join(" and ")}'s route didn't copy. Try again, or plan it from the drive page.`);
  }
  // One day: straight to its route. Several, or a duplicate: the drive page (the wires).
  location.href = !drive && !source && days.length === 1 ? plannerUrl(id, 1) : `/club/drive/?id=${encodeURIComponent(id)}`;
}

/// A duplicate's routes: each day's from its source day, as a new route
/// owned by this organizer with its own link (the source's links never
/// change), set on the new day. A day done already is left; one that
/// fails is marked (d.copy === false) for Try again.
async function copyRoutes(driveId) {
  const owner = sessionUserId();
  for (const d of days) {
    if (!d.from || d.copy === true) continue;
    const from = source.routes.filter((r) => r.day_id === d.from).sort((a, b) => a.position - b.position)[0];
    if (!from) { d.copy = true; continue; }
    try {
      const rid = crypto.randomUUID();
      const token = newShareToken((n) => crypto.getRandomValues(new Uint8Array(n)));
      const copy = routeCopy(from.payload, { id: rid, token, ownerId: owner });
      if (!copy || !owner) throw new Error("no route");
      await insert("routes", [copy.row]);
      await insert("shares", [{ token, route_id: rid }]);
      await rpc("drive_day_routes_set", { p_day_id: d.id, p_routes: [{ route_id: rid, share_token: token, label: from.label || "" }] });
      d.copy = true;
    } catch {
      d.copy = false;
    }
  }
}

// ── The drive page (O4; club flow mock v11, Chris 11/13) ──

/// A day's link, its Copy button beside it (Copied for two seconds).
function linkRow(route, label = "") {
  const link = `carve.run/${route.share_token}`;
  const row = el("div", "dv-link");
  if (label) row.append(el("span", "dv-link-day", label));
  const text = el("span", "dv-link-t", link);
  text.tabIndex = 0;
  text.addEventListener("click", () => { const r = document.createRange(); r.selectNodeContents(text); getSelection().removeAllRanges(); getSelection().addRange(r); });
  const copy = el("button", "go dv-copy", "Copy link");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy didn't work";
    }
    setTimeout(() => { copy.textContent = "Copy link"; }, 2000);
  });
  row.append(text, copy);
  return row;
}

/// The QR code for a link, as SVG (the vendored generator, Kazuhiko Arase, MIT).
function qrBox(route) {
  const link = `carve.run/${route.share_token}`;
  const qr = el("span", "cd-qr dv-qr");
  qr.setAttribute("role", "img");
  qr.setAttribute("aria-label", `QR code for ${link}`);
  try {
    const code = window.qrcode(0, "M");
    code.addData(`https://${link}`);
    code.make();
    qr.innerHTML = code.createSvgTag({ cellSize: 1, margin: 0, scalable: true });
  } catch {
    qr.hidden = true;
  }
  return qr;
}

/// The Share card (mock v13), pinned on the right: what it's for, the QR
/// code (the first day still to come), each day's link with Copy (Day N
/// on a drive of more than one). On a phone, Share (the phone's sheet)
/// first and the code behind Show QR code. After the drive: the link
/// alone, for the album (Chris, 11/26: nobody scans in any more).
function shareCard(ds, apex, past) {
  const box = $("d-share");
  const routed = ds.map((d, i) => ({ d, n: i + 1 })).filter(({ d }) => d.routed);
  const several = ds.length > 1;
  if (!routed.length) {
    box.replaceChildren(el("h2", "dv-share-h", "Share the drive"), el("p", "", `Add a route to get ${several ? "each day's" : "the drive's"} link and QR code.`));
    box.id = "d-share";
    return;
  }
  const parts = [];
  const links = routed.map(({ d, n }) => linkRow(d.route, several ? `Day ${n}` : ""));
  if (past) {
    if (ALBUM_UI) parts.push(el("h2", "dv-k", "Album link"), el("p", "", `Send drivers the drive's link${several ? "s" : ""} to see the album and add theirs.`), ...links);
    else parts.push(el("h2", "dv-k", several ? "Drive links" : "Drive link"), el("p", "", `Drivers open ${several ? "them" : "it"} to see the route again.`), ...links);
    box.replaceChildren(...parts);
    box.classList.add("past");
    return;
  }
  box.classList.remove("past");
  parts.push(el("h2", "dv-share-h", "Share the drive"));
  parts.push(el("p", "", `Drivers open the link on their phone or scan the code. They get Carve Apex free on this route${apex ? ` from ${apex}` : ""}.`));
  const today = isoToday(driveZone());
  const first = routed.find(({ d }) => d.date && d.date >= today) || routed[0];
  const qr = qrBox(first.d.route);
  const qrWrap = el("div", "dv-qr-wrap");
  qrWrap.append(qr);
  if (several) qrWrap.append(el("p", "dv-qr-day", `Day ${first.n}'s code`));
  // A phone's own share sheet (Messages, WhatsApp, Mail), first (mock v13).
  if (navigator.share) {
    const share = el("button", "go dv-share-btn", "Share");
    share.type = "button";
    share.addEventListener("click", () => navigator.share({ title: drive.name || "Drive", url: `https://carve.run/${first.d.route.share_token}` }).catch(() => {}));
    parts.push(share);
  }
  parts.push(qrWrap, ...links);
  const showQr = el("button", "linkish dv-qr-show cd-qr-show", "Show QR code");
  showQr.type = "button";
  showQr.addEventListener("click", () => {
    const on = box.classList.toggle("qr-on");
    showQr.textContent = on ? "Hide QR code" : "Show QR code";
  });
  parts.push(showQr);
  box.replaceChildren(...parts);
}
const isoToday = (tz) => new Date().toLocaleDateString("en-CA", { timeZone: tz });

/// When each of this organizer's routes was last saved: { route_id: iso }.
async function savedTimes(list) {
  const mine = list.filter((r) => r.yours && r.route_id).map((r) => r.route_id);
  if (!mine.length) return {};
  try {
    const rows = await select("routes", `select=id,updated_at&id=in.(${mine.map(encodeURIComponent).join(",")})`);
    return Object.fromEntries((rows || []).map((r) => [r.id, r.updated_at]));
  } catch {
    return {};
  }
}

/// A button with a small menu under it: `items` are [label, href or tap,
/// class?], a null between them a rule.
/// One open at a time; a tap elsewhere, Escape or a scroll closes it. Placed
/// on the screen, not in the card (its rounded corners clip what's outside:
/// a phone's short card cut the menu off): under the button, or over it
/// with no room below, inside the screen's 16 px edges.
function routeMenu(label, cls, items) {
  const box = el("div", "cd-rmenu");
  const button = el("button", `${cls} cd-rmenu-btn`, label);
  button.type = "button";
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  const list = el("div", "cv-menu cd-rmenu-list");
  list.setAttribute("role", "menu");
  list.hidden = true;
  for (const entry of items) {
    if (!entry) { list.append(el("hr", "cd-rmenu-rule")); continue; }
    const [text, go, cls = ""] = entry;
    const item = el(typeof go === "string" ? "a" : "button", cls, text);
    item.setAttribute("role", "menuitem");
    if (typeof go === "string") item.href = go;
    else {
      item.type = "button";
      item.addEventListener("click", () => { closeRouteMenus(); go(); });
    }
    list.append(item);
  }
  button.addEventListener("click", () => {
    const open = list.hidden;
    closeRouteMenus();
    list.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const at = button.getBoundingClientRect();
    const w = list.offsetWidth, h = list.offsetHeight;
    list.style.left = `${Math.max(16, Math.min(at.left, innerWidth - w - 16))}px`;
    list.style.top = `${at.bottom + 6 + h <= innerHeight - 8 ? at.bottom + 6 : Math.max(8, at.top - 6 - h)}px`;
    list.querySelector("[role=menuitem]")?.focus({ preventScroll: true });
  });
  box.append(button, list);
  return box;
}

function closeRouteMenus() {
  for (const m of document.querySelectorAll(".cd-rmenu-list")) m.hidden = true;
  for (const b of document.querySelectorAll(".cd-rmenu-btn")) b.setAttribute("aria-expanded", "false");
}

/// The drive's hero picture, in the order of the app's plan (Chris via
/// Product, 11/26): the first route's own photo, then the drive's photo,
/// then the route's Wikimedia one, then the club's cover.
function heroPhoto(ds) {
  const photo = ds.find((d) => d.routed)?.route?.payload?.photo?.url || "";
  const own = photo && /\/route-photos\//.test(photo) && !/\/route-photos\/commons\//.test(photo) ? photo : "";
  return lookSrc(own || drive.photo_url || photo) || coverOf(org);
}

async function renderDrive() {
  $("d-page").hidden = false;
  document.title = `${drive.name || "Drive"} | Carve`;
  const byDay = new Map();
  for (const r of routes) if (!byDay.has(r.day_id) || r.position < byDay.get(r.day_id).position) byDay.set(r.day_id, r);
  const ds = drive.days.map((d) => ({ ...d, routed: byDay.has(d.id), route: byDay.get(d.id) }));
  const several = ds.length > 1;
  const chip = statusChip({ days: ds });
  const past = chip.tone === "done";
  $("d-page").classList.toggle("past", past);
  // The hero: the photo, the date line, the name large, the status pill.
  $("d-hero").style.setProperty("--hero", `url("${heroPhoto(ds).replace(/"/g, "%22")}")`);
  $("d-name").textContent = drive.name || "Untitled drive";
  $("d-line").textContent = [datesText(ds), past ? "" : inDays(ds)].filter(Boolean).join(" · ");
  $("d-stage").textContent = chip.text;
  $("d-stage").className = `dv-pill ${chip.tone}`;
  $("d-back").setAttribute("href", `/club/?org=${encodeURIComponent(drive.org_id)}`);
  $("d-club").textContent = clubTitle(org).name;
  logoInto($("d-logo"), org);
  $("d-edit").setAttribute("href", `/club/drive/?id=${encodeURIComponent(drive.id)}&edit`);
  const apex = apexWindow(ds);
  renderAbout();
  // Each day's route card.
  $("d-routes-h").textContent = several ? "The routes" : "The route";
  $("d-days").replaceChildren(...ds.map((d, i) => routeCard(d, i + 1, several)));
  $("d-latest").hidden = !ds.some((d) => d.routed);
  // Back from saving a day in the planner (#d-day-N): that day's card.
  const at = /^#d-day-\d+$/.test(location.hash) && document.querySelector(location.hash);
  if (at) for (const ms of [0, 300, 900]) setTimeout(() => at.scrollIntoView({ block: "start" }), ms);
  shareCard(ds, apex, past);
  // Drivers: the accounts that opened the drive's links (drive_signins).
  const opened = Number(drive.opened) || 0;
  $("d-opened").textContent = String(opened);
  $("d-opened-w").textContent = opened === 1 ? "driver has opened the link" : "drivers have opened the link";
  const pr = drive.prerun;
  $("d-pr").hidden = !pr;
  if (pr) {
    $("d-pr-h").textContent = dayText(pr.date);
    $("d-pr-line").textContent = pr.report_ready ? "Your crew's pre-drive is in."
      : `Your crew drives the route first, before ${dayText(pr.date)}.`;
    $("d-pr-go").setAttribute("href", reportUrl(drive.id, (pr.days_with_report || [])[0] || 1));
  }
  renderGroupsStep();
  // The album: off for phase 1 (ALBUM_UI), its section hidden.
  $("d-album").hidden = !ALBUM_UI;
  if (ALBUM_UI && !albumUp) albumUp = renderAlbum({ box: $("d-album-body"), add: $("d-album-add"), file: $("d-album-file"), where: { driveId: drive.id } });
}
let albumUp = null;

/// About this drive (Plan a drive's 5): the text, Edit for organizers; with
/// none, a dashed box and Add a description.
function renderAbout() {
  const text = String(drive.description || "").trim();
  const box = $("d-about-text");
  $("d-about-form").hidden = true;
  box.hidden = false;
  $("d-about-edit").hidden = !text;
  if (text) {
    box.className = "dv-about";
    box.replaceChildren(...text.split(/\n\s*\n/).map((para) => el("p", "", para.trim())));
  } else {
    box.className = "dv-about dv-empty";
    const add = el("button", "textlink", "Add a description");
    add.type = "button";
    add.addEventListener("click", editAbout);
    box.replaceChildren(el("span", "", "No description yet. Tell drivers the plan for the day, the pace, and where you'll end up. "), add);
  }
}
function editAbout() {
  $("d-about-text").hidden = true;
  $("d-about-edit").hidden = true;
  $("d-about-form").hidden = false;
  $("d-about-in").value = drive.description || "";
  $("d-about-count").textContent = `${$("d-about-in").value.length} / 1000`;
  $("d-about-in").focus();
}

/// A day's route card (mock v13): the map with its ··· menu (Edit route,
/// Replace route, Open in map, Print directions, Remove from this day);
/// Meet, Leave and the meeting place; the figures; the route's notes in a
/// box that saves when you leave it. A day with no route: Add a route ▾.
function routeCard(d, n, several) {
  const seq = el("section", "cd-seq dv-day");
  const label = el("h3", "dv-day-h", several ? `Day ${n}${d.date ? ` · ${dayText(d.date)}` : ""}` : "");
  label.id = `d-day-${n}`;
  label.hidden = !several;
  seq.setAttribute("aria-labelledby", label.id);
  const card = el("article", `cd-day dv-rc${d.routed ? "" : " unplanned"}`);
  const map = el("div", "cd-shape dv-map");
  const svg = d.routed ? shapeSvg(d.route.payload) : "";
  if (svg) map.innerHTML = svg; // numbers and our colours only (shapeSvg)
  else {
    map.classList.add("none");
    map.append(el("span", "", "No route yet"));
  }
  if (svg) coverInto(map, d.route.payload);
  const three = [
    ["Choose from your routes", () => openPick(d, n, several)],
    ["Plan a new route", d.routed ? `${plannerUrl(drive.id, n)}&new` : plannerUrl(drive.id, n)],
    ["Import a route", `${plannerUrl(drive.id, n)}&import`],
  ];
  const ways = d.routed
    ? routeMenu("···", "dv-ovf", [["Edit route", plannerUrl(drive.id, n)], null,
        ["Replace with one of your routes", three[0][1]], ["Replace with a new route", three[1][1]], ["Replace with an import", three[2][1]], null,
        ["Open in map", shareUrl(d.route.share_token, drive.id, n)], ["Print directions", `${shareUrl(d.route.share_token, drive.id, n)}&print`], null,
        ["Remove from this day", () => removeRoute(d, n, several), "danger"]])
    : routeMenu("Add a route", "go", three);
  ways.querySelector(".cd-rmenu-btn").setAttribute("aria-label", d.routed ? `Route menu${several ? ` for Day ${n}` : ""}` : "Add a route");
  const body = el("div", "cd-day-body dv-rc-body");
  if (d.routed) {
    map.append(ways);
    const rowA = el("div", "dv-dets");
    const clock = (hhmm) => { const x = /^(\d{1,2}):(\d{2})/.exec(hhmm || ""); return x ? `${Number(x[1]) % 12 || 12}:${x[2]} ${Number(x[1]) < 12 ? "AM" : "PM"}` : "–"; };
    const place = d.place?.name ? el("b", "", d.place.name) : (() => { const a = el("a", "textlink", "Add a place"); a.href = `/club/drive/?id=${encodeURIComponent(drive.id)}&edit`; return a; })();
    rowA.append(det("Meet", el("b", "num", clock(d.meet))), det("Leave", el("b", "num", clock(d.leave))), det("Meet place", place));
    const facts = routeFacts(d.route.payload, miles());
    const rowB = el("div", "dv-dets");
    const [dist, time, stops] = [facts[0]?.b || "–", facts[1]?.b || "–", facts[2]?.b || "0"];
    rowB.append(det("Distance", el("b", "num", dist)), det("Drive time", el("b", "num", time)), det("Stops", el("b", "num", stops)));
    body.append(rowA, rowB, notesBox(d));
  } else {
    body.append(el("p", "cd-hint", `Add a route to get ${several ? `Day ${n}'s` : "its"} link and QR code.`));
    const acts = el("div", "cd-acts");
    acts.append(ways);
    body.append(acts);
  }
  card.append(map, body);
  seq.append(label, card);
  return seq;
}
function det(k, value) {
  const box = el("div", "dv-det");
  box.append(el("span", "dv-k", k), value);
  return box;
}

/// The route's notes (Route.note, 280; anyone with the link sees them;
/// Chris, 11/26): read on the card, with Edit, or Add route notes when
/// there are none; both open the notes window, as the planner's Save
/// window asks them. Yours is written to your route; another organizer's
/// through drive_route_update (0071), as the planner does.
function notesBox(d) {
  const wrap = el("div", "dv-notes");
  const draw = () => {
    const note = String(d.route.payload?.note || "").trim();
    if (!note) {
      const add = el("button", "dv-note-add", "Add route notes");
      add.type = "button";
      add.addEventListener("click", () => notesWindow(d, draw));
      wrap.replaceChildren(add);
      return;
    }
    const head = el("div", "dv-note-head");
    const edit = el("button", "textlink dv-note-edit", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", "Edit route notes");
    edit.addEventListener("click", () => notesWindow(d, draw));
    head.append(el("span", "dv-k", "Route notes"), edit);
    wrap.replaceChildren(head, el("p", "dv-note-text", note));
  };
  draw();
  return wrap;
}

/// The notes window: the planner's Save window's question (name · miles,
/// the box with its count, who sees it), Save writing the note; an empty
/// box takes it away.
function notesWindow(d, then) {
  const dlg = el("dialog", "cd-dlg dv-note-dlg");
  dlg.setAttribute("aria-labelledby", "dv-note-h");
  const h = el("h2", "", "Route notes");
  h.id = "dv-note-h";
  const dist = routeFacts(d.route.payload, miles())[0]?.b;
  const what = el("p", "dv-note-what", [d.route.payload?.name, dist].filter(Boolean).join(" · "));
  const label = el("label", "dv-note-label", "Notes about this route ");
  label.htmlFor = "dv-note-in";
  label.append(el("span", "dim", "(optional)"));
  const area = el("textarea", "dv-notes-in");
  area.id = "dv-note-in";
  area.maxLength = 280;
  area.rows = 4;
  area.placeholder = "Road surface, fuel, places to regroup, anything drivers should know about the road…";
  area.value = String(d.route.payload?.note || "");
  const count = el("span", "dv-count", `${area.value.length} / 280`);
  count.setAttribute("aria-live", "polite");
  area.addEventListener("input", () => { count.textContent = `${area.value.length} / 280`; said.textContent = ""; });
  const box = el("div", "dv-note-box");
  box.append(area, count);
  const hint = el("p", "dv-note-hint", "Anyone with the route's link sees these.");
  const said = el("p", "cd-del-said");
  said.setAttribute("role", "status");
  const save = el("button", "go", "Save");
  save.type = "button";
  const cancel = el("button", "textlink", "Cancel");
  cancel.type = "button";
  const row = el("div", "cd-del-row");
  row.append(save, cancel);
  dlg.append(h, what, label, box, hint, row, said);
  // Inside the page's main, so the club pages' buttons and colours apply.
  (document.querySelector("main") || document.body).append(dlg);
  const done = () => { dlg.close(); dlg.remove(); };
  cancel.addEventListener("click", done);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); if (!save.disabled) done(); });
  save.addEventListener("click", async () => {
    const next = area.value.trim().slice(0, 280);
    if (next === String(d.route.payload?.note || "").trim()) return done();
    save.disabled = cancel.disabled = true;
    said.textContent = "Saving…";
    try {
      const payload = JSON.parse(JSON.stringify(d.route.payload || {}));
      if (next) payload.note = next;
      else delete payload.note;
      if (d.route.yours) await update("routes", `id=eq.${encodeURIComponent(String(d.route.route_id).toLowerCase())}`, { payload });
      else await rpc("drive_route_update", { p_route_id: String(d.route.route_id).toLowerCase(), p_row: routeRow({ id: String(d.route.route_id) }, sessionUserId(), payload) });
      d.route.payload = payload;
      done();
      then();
    } catch (failure) {
      save.disabled = cancel.disabled = false;
      said.textContent = failure?.message || "Couldn't save. Try again.";
    }
  });
  dlg.showModal();
  if (!matchMedia("(pointer: coarse)").matches) area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
}

function stepChip(id, text, cls = "") {
  $(id).textContent = text;
  $(id).className = `dv-chip${cls ? ` ${cls}` : ""}`;
}

/// 3 Groups (§1.2): Add people / Import a list, or what the list has and
/// the board. Hidden when the board can't be read (an older server).
function renderGroupsStep() {
  $("ck-groups").hidden = !board;
  if (!board) return;
  const box = $("d-groups");
  const people = board.people || 0;
  if (!people) {
    stepChip("ck-groups-s", "Not started");
    const card = el("div", "ck-g");
    card.append(el("p", "", "Sort your drivers into groups, each with a Lead and a Sweep. Drivers don't see their group in Carve yet. Tell them at the meet. Used on every day of this drive."));
    const acts = el("div", "cd-acts");
    const add = el("button", "go ghost", "Add people");
    add.type = "button";
    add.id = "g-add-people";
    add.addEventListener("click", () => openImport({ driveId: drive.id, paste: true, onDone: done }));
    const imp = el("button", "go", "Import a list");
    imp.type = "button";
    imp.id = "g-import";
    imp.addEventListener("click", () => openImport({ driveId: drive.id, onDone: done }));
    acts.append(add, imp);
    card.append(acts);
    return box.replaceChildren(card);
  }
  stepChip("ck-groups-s", "Done", "ok");
  const card = el("div", "ck-g");
  const words = el("div", "");
  words.append(el("b", "", board.group_count ? groupsText(board.group_count) : "No groups yet"), el("p", "", boardLine(board)));
  const acts = el("div", "cd-acts");
  const open = el("a", "go", "Open groups");
  open.href = groupsUrl(drive.id);
  open.id = "g-open";
  const upd = el("button", "go ghost", "Update from a list");
  upd.type = "button";
  upd.addEventListener("click", () => openImport({ driveId: drive.id, update: true, onDone: done }));
  acts.append(open, upd);
  card.append(words, acts);
  box.replaceChildren(card);
}
const done = (b) => { location.href = groupsUrl(drive.id); return b; };

// ── The groups board (run groups §1.4) ──

function renderGroups() {
  if (!board) return status("The groups couldn't be read. Try again.");
  $("g-page").hidden = false;
  document.title = `Run groups · ${drive.name || "Drive"} | Carve`;
  $("g-back").textContent = `‹ ${drive.name || "Drive"}`;
  $("g-back").setAttribute("href", `/club/drive/?id=${encodeURIComponent(drive.id)}`);
  // Carve's board (set), and what's drawn while changes save (show).
  const show = (b) => {
    $("g-line").textContent = boardLine(b);
    $("g-add").disabled = b.group_count >= MOST_GROUPS;
  };
  const set = (b) => {
    board = b;
    renderBoard($("rg-board"), b, { driveId: drive.id, set, show, print: { drive, club: org?.name || "" } });
  };
  set(board);
  $("g-update").addEventListener("click", () => openImport({ driveId: drive.id, update: board.people > 0, onDone: set }));
  $("g-add").addEventListener("click", async () => {
    $("rg-said").textContent = "";
    try { set(await rpc("run_group_count_set", { p_drive_id: drive.id, p_count: groupsUp(board.group_count) })); }
    catch (failure) { $("rg-said").textContent = REFUSAL[failure.code] || failure.message; }
  });
}

// ── Choose from your routes (Chris, 11/25) ──
// A pick goes on the day as it is (Chris, 11/25 evening: moved, not
// copied): the same route, so the maker's edits reach drivers and co-
// organizers edit it as any club route (drive_route_update). It's copied
// instead, as Duplicate copies, when it's on another drive already or
// follows someone else's link (a heart).

let library = null; // this organizer's saved routes, once asked
let onDrives = null; // the ids of theirs already on a live drive's day, once asked
let picking = null; // { day, n, several }
let ready = null; // a route made ready and not yet on its day: { from, rid, token }, used again on Try again

/// Their routes already on a day of a live drive, in the clubs they organize.
async function routesOnDrives() {
  const ids = new Set();
  const clubs = await myOrgs();
  const drives = (await Promise.all(clubs.map((o) => rpc("org_drives", { p_org_id: o.id }).catch(() => [])))).flat().filter(Boolean);
  const live = drives.filter((d) => d.status !== "cancelled" && (d.days || []).some((x) => x.routed));
  for (const list of await Promise.all(live.map((d) => rpc("drive_routes", { p_drive_id: d.id }).catch(() => [])))) {
    for (const r of list || []) ids.add(String(r.route_id).toLowerCase());
  }
  return ids;
}

/// Why a pick is copied, or "" when it goes on the day as it is.
const copiedBecause = (row) => onDrives?.has(String(row.id).toLowerCase()) ? "on another drive, so it's copied"
  : row.origin_route_id ? "saved from a link, so it's copied" : "";

async function openPick(day, n, several) {
  picking = { day, n, several };
  const replacing = !!day.routed;
  $("d-pick-h").textContent = replacing ? `Replace ${several ? `Day ${n}'s` : "the"} route` : "Choose from your routes";
  $("d-pick-line").textContent = replacing
    ? "The day's links open the route you pick, and drivers are told it changed. The route there now stays in your routes, but its link opens this day's route from now on."
    : "Your route goes on this day as it is. Changes you make to it reach drivers.";
  $("d-pick-said").textContent = "";
  $("d-pick-q").value = "";
  $("d-pick").showModal();
  if (!library || !onDrives) {
    $("d-pick-list").replaceChildren(el("li", "cd-pick-none", "Getting your routes…"));
    try {
      [library, onDrives] = await Promise.all([
        select("routes", `select=id,name,distance_meters,updated_at,origin_route_id&owner_id=eq.${encodeURIComponent(sessionUserId())}&deleted_at=is.null&order=updated_at.desc&limit=500`),
        routesOnDrives(),
      ]);
    } catch (failure) {
      library = onDrives = null;
      $("d-pick-list").replaceChildren();
      $("d-pick-said").textContent = failure.message || "Couldn't get your routes. Try again.";
      return;
    }
  }
  $("d-pick-q").hidden = libraryRows(library, "", day.route?.route_id).length < 7;
  drawPick();
}

function drawPick() {
  const { day, n } = picking;
  const rows = libraryRows(library, $("d-pick-q").value, day.route?.route_id);
  if (!rows.length) {
    const none = el("li", "cd-pick-none");
    if ($("d-pick-q").value.trim()) none.textContent = "No routes by that name.";
    else {
      none.append("You haven't saved a route yet. ");
      const plan = el("a", "textlink", "Plan a new route");
      plan.href = plannerUrl(drive.id, n);
      none.append(plan);
    }
    $("d-pick-list").replaceChildren(none);
    return;
  }
  $("d-pick-list").replaceChildren(...rows.map((r) => {
    const li = el("li");
    const b = el("button", "cd-pick-row");
    b.type = "button";
    // The distance a figure (Oxanium), the rest words.
    const { far, ago } = libraryParts(r, miles());
    const line = el("span");
    if (far) line.append(el("i", "", far));
    if (ago) line.append(far ? ` · ${ago}` : ago);
    b.append(el("b", "", r.name || "Untitled drive"), line);
    const why = copiedBecause(r);
    if (why) b.append(el("small", "", why[0].toUpperCase() + why.slice(1) + "."));
    b.addEventListener("click", () => pickRoute(r));
    li.append(b);
    return li;
  }));
}

/// The picked route on the day: itself, with its own link (a route has one
/// live link: shares_guard revokes the others), made if it has none; or,
/// when copiedBecause says, a copy as Duplicate makes one. A Replace later
/// retires the day's link, the maker's own too, and it follows the day (0091).
/// Route ▾ Remove from this day: asked once, then the day has no route; the
/// route stays in their routes.
async function removeRoute(day, n, several) {
  const off = await confirmRemove(n, several, async () => {
    await rpc("drive_day_routes_set", { p_day_id: day.id, p_routes: [] });
    [drive, routes] = await Promise.all([rpc("drive_get", { p_drive_id: drive.id }), rpc("drive_routes", { p_drive_id: drive.id }).then((x) => x || [])]);
  });
  if (!off) return;
  library = onDrives = null; // it's off a drive now
  await renderDrive();
  document.getElementById(`d-day-${n}`)?.scrollIntoView({ block: "start" });
}

async function pickRoute(row) {
  const { day, n } = picking;
  const buttons = [...$("d-pick-list").querySelectorAll("button")];
  for (const b of buttons) b.disabled = true;
  $("d-pick-said").textContent = "Adding it…";
  try {
    if (ready?.from !== row.id) {
      let token = newShareToken((k) => crypto.getRandomValues(new Uint8Array(k)));
      let rid = String(row.id).toLowerCase();
      if (!copiedBecause(row)) {
        const live = await select("shares", `select=token&route_id=eq.${encodeURIComponent(rid)}&revoked_at=is.null&limit=1`);
        if (live?.[0]?.token) token = live[0].token;
        else await insert("shares", [{ token, route_id: rid }]);
      } else {
        const owner = sessionUserId();
        const got = await select("routes", `select=payload&id=eq.${encodeURIComponent(row.id)}`);
        rid = crypto.randomUUID();
        const copy = owner && routeCopy(got?.[0]?.payload, { id: rid, token, ownerId: owner });
        if (!copy) throw new Error("That route has no road to drive yet. Open it in the planner first.");
        // A copy is the club's: its maker's leave time and the link it follows stay theirs.
        delete copy.row.payload.leaveAt;
        delete copy.row.payload.followsShareToken;
        delete copy.row.payload.originRouteId;
        await insert("routes", [copy.row]);
        await insert("shares", [{ token, route_id: rid }]);
      }
      ready = { from: row.id, rid, token };
    }
    await rpc("drive_day_routes_set", { p_day_id: day.id, p_routes: [{ route_id: ready.rid, share_token: ready.token, label: day.route?.label || "" }] });
    ready = null;
    [drive, routes] = await Promise.all([rpc("drive_get", { p_drive_id: drive.id }), rpc("drive_routes", { p_drive_id: drive.id }).then((x) => x || [])]);
    library = onDrives = null; // asked again next time: a copy is one of theirs now, a route on a drive
    $("d-pick").close();
    await renderDrive();
    document.getElementById(`d-day-${n}`)?.scrollIntoView({ block: "start" });
  } catch (failure) {
    for (const b of buttons) b.disabled = false;
    $("d-pick-said").textContent = failure.message || "Couldn't add the route. Try again.";
  }
}

function wire() {
  $("f-page").addEventListener("submit", submit);
  $("d-pick-q").addEventListener("input", () => picking && library && drawPick());
  // What to fix goes once they start fixing it.
  // The top line goes once something changes; a field's note once it's fixed.
  const changed = () => { if (!$("f-go").disabled) { $("f-said").textContent = ""; $("f-err").hidden = true; } };
  $("f-page").addEventListener("input", (e) => { changed(); if (e.target === $("f-name") && $("f-name").value.trim()) sayOn($("f-name"), ""); });
  $("f-page").addEventListener("change", changed);
  $("f-add-day").addEventListener("click", () => {
    const last = days[days.length - 1];
    // The day before's times, or the defaults.
    const meet = last?.meet || DEFAULT_MEET;
    days.push({ id: crypto.randomUUID(), date: last?.date ? addDays(last.date, 1) : "", meet, leave: last?.leave || leaveAfter(meet), leaveSet: !!last?.leaveSet });
    renderDays();
    $("f-days").lastElementChild?.querySelector("input")?.focus();
  });
  $("f-pr-yes").addEventListener("click", () => {
    prerun.on = true;
    $("f-said").textContent = "";
    $("f-err").hidden = true;
    // A week before the first day, never before today, to start with.
    if (!prerun.date && days[0]?.date) prerun.date = prerunDefault(days[0].date);
    renderPrerun();
  });
  $("f-pr-no").addEventListener("click", () => { prerun.on = false; renderPrerun(); $("f-said").textContent = ""; $("f-err").hidden = true; sayOn($("f-pr-date"), ""); });
  $("f-pr-date").addEventListener("change", (e) => { prerun.date = e.target.value; if (prerun.date) sayOn($("f-pr-date"), ""); });
  $("f-gr-up").addEventListener("click", () => { groupCount = groupsUp(groupCount); renderGroupCount(); });
  // 5 and 6: the count; the photo by a click or a drop; folding above them.
  $("f-about-in").addEventListener("input", () => { $("f-about-count").textContent = `${$("f-about-in").value.length} / 1000`; });
  $("f-photo-drop").addEventListener("click", () => $("f-photo-file").click());
  $("f-photo-file").addEventListener("change", () => { const f = $("f-photo-file").files[0]; $("f-photo-file").value = ""; takePhoto(f); });
  $("f-photo-drop").addEventListener("dragover", (e) => { e.preventDefault(); $("f-photo-drop").classList.add("over"); });
  $("f-photo-drop").addEventListener("dragleave", () => $("f-photo-drop").classList.remove("over"));
  $("f-photo-drop").addEventListener("drop", (e) => { e.preventDefault(); $("f-photo-drop").classList.remove("over"); takePhoto(e.dataTransfer?.files?.[0]); });
  $("f-photo-off").addEventListener("click", () => { photoUrl = null; renderPhoto(); });
  $("f-page").addEventListener("focusin", (e) => { if (e.target.closest("#f-about, #f-photo")) fold(); });
  $("f-gr-down").addEventListener("click", () => { groupCount = groupsDown(groupCount); renderGroupCount(); });
  pickOnTap($("f-pr-pick"), $("f-pr-date"));
  const menu = (open) => { $("d-menu").hidden = !open; $("d-more").setAttribute("aria-expanded", String(open)); };
  $("d-more").addEventListener("click", () => menu($("d-menu").hidden));
  document.addEventListener("click", (e) => { if (!e.target.closest(".cv-more")) menu(false); if (!e.target.closest(".cd-rmenu")) closeRouteMenus(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { menu(false); closeRouteMenus(); } });
  addEventListener("scroll", () => closeRouteMenus(), { passive: true });
  // Asked twice (drive-delete.js), then back to the club.
  $("d-delete").addEventListener("click", async () => {
    menu(false);
    if (await confirmDelete(drive)) location.href = `/club/?org=${encodeURIComponent(org.id)}`;
  });
  // ✎ Photo (in More on a phone): the drive's own photo, checked as route
  // photos are, then the hero again.
  $("d-photo").addEventListener("click", () => $("d-photo-file").click());
  $("d-photo-item").addEventListener("click", () => { menu(false); $("d-photo-file").click(); });
  $("d-photo-file").addEventListener("change", async () => {
    const f = $("d-photo-file").files[0];
    $("d-photo-file").value = "";
    if (!f) return;
    $("d-said").textContent = "Adding the photo…";
    try {
      const up = await uploadPhoto(f, sessionUserId());
      drive = { ...drive, ...(await rpc("drive_update", { p_drive_id: drive.id, p_patch: { photo_url: up.url } })) };
      $("d-said").textContent = "";
      renderDrive();
    } catch (failure) {
      $("d-said").textContent = failure.message || "Couldn't add the photo. Try again.";
    }
  });
  // About this drive: written here (or at Plan a drive), up to 1000.
  $("d-about-edit").addEventListener("click", editAbout);
  $("d-about-in").addEventListener("input", () => { $("d-about-count").textContent = `${$("d-about-in").value.length} / 1000`; });
  $("d-about-cancel").addEventListener("click", renderAbout);
  $("d-about-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("d-about-save").disabled = true;
    try {
      drive = { ...drive, ...(await rpc("drive_update", { p_drive_id: drive.id, p_patch: { description: $("d-about-in").value } })) };
      renderAbout();
    } catch (failure) {
      $("d-said").textContent = failure.message || "Couldn't save. Try again.";
    } finally {
      $("d-about-save").disabled = false;
    }
  });
}

if (typeof document !== "undefined" && $("d-page")) { wire(); start(); }
