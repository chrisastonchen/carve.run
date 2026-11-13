// carve.run/club/drive/, club v2 (the wires' O3 and O4; Chris, 11/9 night).
//   ?org=<club>           New drive: name, the date with meet and leave
//                         times, + Add a day, the pre-run (Club).
//                         Create: one day opens the planner on it; more
//                         open this drive's page. The drive is the club's
//                         it was planned from (Product, 11/9).
//   ?id=<drive>           The drive page: a card per day (Plan route, then
//                         Edit route; Share once it has a route), the
//                         pre-run card, ⋯ Edit details and Delete drive.
//   ?id=<drive>&edit      Edit details: the same form, filled in.
//   ?copy=<drive>         Duplicate (Club home's ⋯): the new-drive form
//                         filled from that drive, dates empty; Create
//                         copies each day's route as a new route and link.
// Pages never act on a GET: every change is a tap.

import { routeCopy, newShareToken } from "/plan/route-wire.js?v=7";
import { $, el, insert, myOrgs, rpc, select, sessionUserId, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";
import { DEFAULT_MEET, TIME_MISSING, addDays, apexWindow, datesText, dayWhenProblem, inDays, zoneNow, leaveAfter, meetLeave, prerunDefault, dayText, formProblem, routeFacts, shapeSvg, statusChip, timeText, updatedAgo } from "/assets/club-words.js?v=768f355b17";

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
      [drive, routes] = await Promise.all([rpc("drive_get", { p_drive_id: q.get("id") }), rpc("drive_routes", { p_drive_id: q.get("id") }).catch(() => [])]);
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
  for (const id of ["f-back", "d-back"]) { $(id).textContent = `‹ ${org.name}`; $(id).setAttribute("href", back); }
  if (source) return openForm(null, source.drive);
  if (!drive) return openForm(null);
  if (q.has("edit")) return openForm(drive);
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
  renderDays();
  renderPrerun();
  $("f-name").focus();
}

function renderDays() {
  const several = days.length > 1;
  $("f-days").replaceChildren(...days.map((d, i) => {
    const row = el("div", "cv-day-row cd-day-row");
    const date = input("date", d.date, several ? `Day ${i + 1} date` : "Date", (v) => {
      // Later days follow a moved day, a day apart at least (group.js's followDates).
      const before = days[i].date;
      days[i].date = v;
      // Days with no date yet (a duplicate's) take the next ones.
      if (v) for (let j = i + 1; j < days.length; j++) if (!days[j].date || (before && days[j].date <= days[j - 1].date)) days[j].date = addDays(days[j - 1].date, 1);
      renderDays();
    });
    // No date before today in the picker (Chris, 11/10); a saved past day still shows its date.
    date.min = zoneNow(Date.now(), driveZone()).date;
    const meet = input("time", d.meet, `${several ? `Day ${i + 1} meet` : "Meet"} time`, (v) => {
      days[i].meet = v;
      // Leave follows Meet by half an hour until it's set by hand.
      if (v && !days[i].leaveSet) {
        days[i].leave = leave.value = leaveAfter(v);
        missing(leave, "leave");
      }
      missing(meet, "meet");
    });
    const leave = input("time", d.leave, `${several ? `Day ${i + 1} leave` : "Leave"} time`, (v) => {
      days[i].leave = v;
      days[i].leaveSet = true;
      missing(leave, "leave");
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

function input(type, value, label, set) {
  const i = el("input");
  i.type = type;
  i.value = value || "";
  i.setAttribute("aria-label", label);
  i.addEventListener(type === "date" ? "change" : "input", () => { set(i.value); shown(i); });
  return i;
}
/// A friendly picker (mock v11): its label and the value as read ("Sat,
/// Dec 12", "8:00 AM") over the browser's own field, which a tap opens.
function field(name, control, more = "") {
  const l = el("label", `cd-pick cv-time${more ? ` ${more}` : ""}`);
  l.append(el("small", "cv-time-name", name), el("b", ""), control);
  shown(control);
  pickOnTap(l, control);
  return l;
}
/// The value a picker shows: "Sat, Dec 12", "8:00 AM", or what to pick.
function shown(control) {
  const b = control.parentElement?.querySelector(":scope > b");
  if (!b) return;
  const v = control.value;
  b.textContent = control.type === "date" ? dayText(v) || "Pick a date" : timeText(v) || "Pick a time";
  b.classList.toggle("empty", !v);
}
/// A computer's browser opens its calendar or clock on the field's icon
/// only; the whole picker opens it here.
/// A phone's tap opens it already.
function pickOnTap(box, control) {
  box.addEventListener("click", (e) => {
    if (!matchMedia("(pointer: fine)").matches) return;
    if (e.target !== control) e.preventDefault();
    try { control.showPicker(); } catch { control.focus(); }
  });
}

/// What's wrong with a field, said under it; "" clears it.
function sayOn(control, text) {
  const box = control.closest(".cv-time") || control.parentElement;
  let note = box?.querySelector(".cv-miss");
  if (text && box && !note) {
    note = el("small", "cv-miss");
    note.id = `miss-${crypto.randomUUID().slice(0, 8)}`;
    box.append(note);
    control.setAttribute("aria-describedby", note.id);
  }
  if (note) note.textContent = text;
  control.toggleAttribute("aria-invalid", !!text);
}

/// An emptied time says so on its field ("Add a meet time"). → missing?
function missing(control, which) {
  const empty = !control.value;
  sayOn(control, empty ? TIME_MISSING[which] : "");
  return empty;
}

function renderPrerun() {
  $("f-pr-yes").setAttribute("aria-pressed", String(prerun.on));
  $("f-pr-no").setAttribute("aria-pressed", String(!prerun.on));
  // The date inside Yes (mock v11).
  $("f-pr-pick").hidden = !prerun.on;
  $("f-pr-date").value = prerun.date || "";
  shown($("f-pr-date"));
}

async function submit(e) {
  e.preventDefault();
  const say = (t) => { $("f-said").textContent = t; };
  const name = $("f-name").value.trim();
  const problem = formProblem({ name, days, prerun, prerunWas: drive?.prerun?.date || null });
  if (problem) return say(problem);
  // Both times on every day (the server refuses a day without them), said
  // on the field.
  const times = [...$("f-days").querySelectorAll(".cv-day-row")].flatMap((row) => {
    const [meet, leave] = row.querySelectorAll("input[type=time]");
    return [missing(meet, "meet") && meet, missing(leave, "leave") && leave].filter(Boolean);
  });
  if (times.length) return times[0].focus();
  // No day in the past, and today's meet 30 minutes out, in the drive's zone
  // (Chris, 11/10; the server's 0061 says the same). A saved day left as it
  // was may stay where it is.
  const saved = drive || made;
  const late = [...$("f-days").querySelectorAll(".cv-day-row")].map((row, i) => {
    const p = dayWhenProblem(days[i], { was: saved?.days?.find((x) => x.id === days[i].id) || null, zone: driveZone() });
    if (!p) return null;
    const control = p.field === "date" ? row.querySelector("input[type=date]") : row.querySelector("input[type=time]");
    sayOn(control, p.text);
    return control;
  }).filter(Boolean);
  if (late.length) return late[0].focus();
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
  } catch (failure) {
    $("f-go").disabled = false;
    return say(failure.message);
  }
  // A duplicate: a day's route that didn't copy is said, and Create tries again.
  const missed = days.map((d, i) => (d.copy === false ? i + 1 : 0)).filter(Boolean);
  if (missed.length) {
    $("f-go").disabled = false;
    $("f-go").textContent = "Try again";
    return say(`The drive is made, but ${missed.map((n) => `Day ${n}`).join(" and ")}'s route didn't copy. Try again, or plan it from the drive page.`);
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

/// The day's share panel (mock v11): its QR code, the link with Copy link,
/// when drivers get Apex free on it (0093's window), when it last changed.
function sharePanel(n, several, route, apex, saved) {
  const link = `carve.run/${route.share_token}`;
  const box = el("div", "cd-share");
  const qr = el("span", "cd-qr");
  qr.setAttribute("role", "img");
  qr.setAttribute("aria-label", `QR code for ${link}`);
  try {
    // The vendored generator (Kazuhiko Arase, MIT): our link only, as SVG.
    const code = window.qrcode(0, "M");
    code.addData(`https://${link}`);
    code.make();
    qr.innerHTML = code.createSvgTag({ cellSize: 1, margin: 0, scalable: true });
  } catch {
    qr.hidden = true;
  }
  const words = el("div", "cd-share-words");
  words.append(el("b", "", several ? `Share Day ${n}` : "Share the drive"));
  words.append(el("p", "", `Drivers open the link on their phone or scan the code.${apex ? ` They get Carve Apex free on this route from ${apex}.` : ""}`));
  // The time when the route is this organizer's (drive_routes has none; DevOps, 11/13).
  words.append(el("p", "", [updatedAgo(saved), "Drivers get the latest when they open the link."].filter(Boolean).join(" ")));
  const open = el("a", "cd-link", link);
  open.href = shareUrl(route.share_token, drive.id, n);
  words.append(open);
  const copy = el("button", "go", "Copy link");
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
  box.append(qr, words, copy);
  return box;
}

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

async function renderDrive() {
  $("d-page").hidden = false;
  document.title = `${drive.name || "Drive"} | Carve`;
  const byDay = new Map();
  for (const r of routes) if (!byDay.has(r.day_id) || r.position < byDay.get(r.day_id).position) byDay.set(r.day_id, r);
  const ds = drive.days.map((d) => ({ ...d, routed: byDay.has(d.id), route: byDay.get(d.id) }));
  const several = ds.length > 1;
  $("d-name").textContent = drive.name || "Untitled drive";
  $("d-line").textContent = [datesText(ds), inDays(ds)].filter(Boolean).join(" · ");
  const chip = statusChip({ days: ds });
  $("d-stage").textContent = chip.text;
  $("d-edit").setAttribute("href", `/club/drive/?id=${encodeURIComponent(drive.id)}&edit`);
  const apex = apexWindow(ds);
  const saved = await savedTimes(routes);
  $("d-days").replaceChildren(...ds.map((d, i) => {
    const n = i + 1;
    const seq = el("section", "cd-seq");
    const label = el("h2", "cd-seqn", several ? `Day ${n}` : "The drive");
    label.id = `d-day-${n}`;
    seq.setAttribute("aria-labelledby", label.id);
    const card = el("article", `cd-day${d.routed ? "" : " unplanned"}`);
    const shape = el("div", "cd-shape");
    const svg = d.routed ? shapeSvg(d.route.payload) : "";
    if (svg) shape.innerHTML = svg; // numbers and our colours only (shapeSvg)
    else {
      shape.classList.add("none");
      shape.append(el("span", "", "No route yet"));
    }
    if (d.routed) shape.append(el("span", "cd-chip ok", "Ready to share"));
    const body = el("div", "cd-day-body");
    body.append(el("h3", "", dayText(d.date) || "No date yet"));
    const facts = routeFacts(d.routed ? d.route.payload : null, miles());
    if (facts.length) {
      const row = el("p", "cd-facts");
      row.append(...facts.map((f) => { const span = el("span"); span.append(el("b", "", f.b), f.rest ? ` ${f.rest}` : ""); return span; }));
      body.append(row);
    }
    const when = meetLeave(d);
    if (when.length) {
      const row = el("p", "cd-facts");
      row.append(...(d.routed ? when.map((t) => el("span", "", t)) : [el("span", "", when.join(" · "))]));
      body.append(row);
    }
    if (!d.routed) body.append(el("p", "cd-hint", `Plan the route to get ${several ? `Day ${n}'s` : "its"} link and QR code.`));
    const acts = el("div", "cd-acts");
    const plan = el("a", d.routed ? "go ghost" : "go", d.routed ? "Edit route" : "Plan route");
    plan.href = plannerUrl(drive.id, n);
    acts.append(plan);
    body.append(acts);
    card.append(shape, body);
    if (d.routed) card.append(sharePanel(n, several, d.route, apex, saved[d.route.route_id]));
    seq.append(label, card);
    return seq;
  }));
  const pr = drive.prerun;
  $("d-pr").hidden = !pr;
  if (pr) {
    $("d-pr-h").textContent = dayText(pr.date);
    // Once the crew has driven or reviewed it (0101's report_ready), it says so.
    $("d-pr-line").textContent = pr.report_ready ? "Your crew's pre-drive is in."
      : `Your crew drives the route first. Send them each day's link before ${dayText(pr.date)}.`;
    $("d-pr-go").setAttribute("href", reportUrl(drive.id, (pr.days_with_report || [])[0] || 1));
  }
}

function wire() {
  $("f-page").addEventListener("submit", submit);
  // What to fix goes once they start fixing it.
  $("f-page").addEventListener("input", () => { if (!$("f-go").disabled) $("f-said").textContent = ""; });
  $("f-page").addEventListener("change", () => { if (!$("f-go").disabled) $("f-said").textContent = ""; });
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
    // A week before the first day, never before today, to start with.
    if (!prerun.date && days[0]?.date) prerun.date = prerunDefault(days[0].date);
    renderPrerun();
  });
  $("f-pr-no").addEventListener("click", () => { prerun.on = false; renderPrerun(); });
  $("f-pr-date").addEventListener("change", (e) => { prerun.date = e.target.value; shown(e.target); });
  pickOnTap($("f-pr-pick"), $("f-pr-date"));
  const menu = (open) => { $("d-menu").hidden = !open; $("d-more").setAttribute("aria-expanded", String(open)); };
  $("d-more").addEventListener("click", () => menu($("d-menu").hidden));
  document.addEventListener("click", (e) => { if (!e.target.closest(".cv-more")) menu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") menu(false); });
  $("d-delete").addEventListener("click", () => { menu(false); $("d-del-box").hidden = false; $("d-del-go").focus(); });
  $("d-del-keep").addEventListener("click", () => { $("d-del-box").hidden = true; });
  $("d-del-go").addEventListener("click", async () => {
    $("d-del-go").disabled = true;
    try {
      await rpc("drive_delete", { p_drive_id: drive.id });
      location.href = `/club/?org=${encodeURIComponent(org.id)}`;
    } catch (failure) {
      $("d-said").textContent = failure.message;
      $("d-del-go").disabled = false;
    }
  });
}

if (typeof document !== "undefined" && $("d-page")) { wire(); start(); }
