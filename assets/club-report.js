// carve.run/club/drive/report/?id=<drive>[&day=<n>]: the pre-drive report
// (O6b; 0101, Chris 11/12: the crew is anyone signed in who drives a day
// link inside the pre-drive window). A day at a time: the crew's reviews
// by road (no names), planned against actual times for each leg and stop
// with the day's total, and Update stop timers. Organizers only: the
// server refuses anyone else (not_organizer). Pages never act on a GET:
// the timers change only on a tap and a yes.

import { $, el, rpc, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { dayText } from "/assets/club-words.js?v=5a33e1fdc7";
import { dayReviews, dayTabs, dayTimes, earlierTimes, timerChanges, timersSaid, minutesText } from "/assets/club-report-words.js?v=805c8325f0";

const q = new URLSearchParams(location.search);
const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };

let drive = null; // drive_get
let reviews = []; // drive_prerun_reviews .reviews
let timings = null; // drive_prerun_timings
// A load that failed (QA, 11/13: a 400 read as "No times yet" and hid a
// server bug): said, with Try again, never shown as an empty report.
let reviewsFailed = false;
let timingsFailed = false;
let tabs = [];
let day = 1;

async function start() {
  if (!(await signedIn())) {
    status("");
    $("o-signin").hidden = false;
    $("o-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: location.pathname + location.search }));
    return;
  }
  const id = q.get("id");
  if (!id) return status("That report wasn't found.");
  try {
    drive = await rpc("drive_get", { p_drive_id: id });
  } catch (failure) {
    return status(failure.message);
  }
  if (!drive?.prerun) return status("This drive has no pre-drive.");
  const [r, t] = await Promise.all([loadReviews(), loadTimings()]);
  // Anyone but an organizer: the server's refusal, said once for the page.
  if ([r, t].some((f) => f?.code === "not_organizer")) return status("Only the club's organizers can see the pre-drive report.");
  const days = drive.days || [];
  tabs = dayTabs(days, drive.prerun.days_with_report || []);
  const asked = Number(q.get("day"));
  day = tabs.some((t) => t.n === asked) ? asked : (drive.prerun.days_with_report || [])[0] || 1;
  status("");
  $("r-page").hidden = false;
  $("r-drive").textContent = drive.name || "";
  $("r-line").textContent = `Pre-drive · ${dayText(drive.prerun.date)}`;
  $("r-back").setAttribute("href", `/club/drive/?id=${encodeURIComponent(drive.id)}`);
  $("r-back").textContent = `‹ ${drive.name || "The drive"}`;
  drawTabs();
  draw();
  wire();
}

/// Each load: null when it came back, else the failure.
async function loadReviews() {
  try {
    const answer = await rpc("drive_prerun_reviews", { p_drive_id: drive.id });
    reviews = Array.isArray(answer?.reviews) ? answer.reviews : [];
    reviewsFailed = false;
    return null;
  } catch (failure) {
    reviewsFailed = true;
    return failure;
  }
}
async function loadTimings() {
  try {
    timings = await rpc("drive_prerun_timings", { p_drive_id: drive.id });
    timingsFailed = false;
    return null;
  } catch (failure) {
    timingsFailed = true;
    return failure;
  }
}

function drawTabs() {
  $("r-days").hidden = tabs.length < 2;
  $("r-days").replaceChildren(...tabs.map((t) => {
    const b = el("button", "cv-chip", t.label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(t.n === day));
    b.addEventListener("click", () => {
      day = t.n;
      $("r-timers-said").textContent = "";
      // The day in the address, so a reload keeps it (no history entry).
      history.replaceState(null, "", `?id=${encodeURIComponent(drive.id)}&day=${day}`);
      drawTabs();
      draw();
    });
    return b;
  }));
}

/// A table cell, labelled for a phone's stacked rows (club-v2.css).
function cell(className, text, label) {
  const td = el("td", className, text);
  td.dataset.label = label;
  return td;
}

function rowOf(r) {
  const tr = el("tr", r.kind);
  const th = el("th", "", r.what);
  th.scope = "row";
  tr.append(th, cell("", r.planned, "Planned"), cell("", r.actual, "Pre-drive"), cell(r.diff ? `r-diff ${r.diff.tone}` : "r-diff", r.diff?.text || "", "Difference"));
  return tr;
}
function totalOf(total) {
  const tr = el("tr");
  const th = el("th", "", "Day total");
  th.scope = "row";
  tr.append(th, cell("", total.planned, "Planned"), cell("", total.actual, "Pre-drive"), cell(total.diff ? `r-diff ${total.diff.tone}` : "r-diff", total.diff?.text || (total.partial ? "Some legs untimed" : ""), "Difference"));
  return tr;
}

function draw() {
  const dayId = tabs.find((t) => t.n === day)?.id;
  // Reviews.
  const list = reviewsFailed ? [] : dayReviews(reviews, day);
  $("r-reviews-err").hidden = !reviewsFailed;
  $("r-reviews-none").hidden = reviewsFailed || list.length > 0;
  $("r-reviews").replaceChildren(...list.map((r) => {
    const li = el("li", `r-review ${r.tone}`);
    li.append(el("p", "r-by", r.by));
    if (r.earlier) li.append(el("span", "r-earlier", r.earlier));
    li.append(el("b", "r-rating", r.rating));
    for (const road of r.roads) {
      const p = el("p", "r-road");
      p.append(el("span", `r-verdict ${road.good ? "good" : "bad"}`, road.good ? "Good" : "Not good"), el("b", "", road.name));
      if (road.reasons.length) p.append(el("span", "r-why", road.reasons.join(" · ")));
      li.append(p);
    }
    if (r.reasons.length) li.append(el("p", "r-why", r.reasons.join(" · ")));
    if (r.note) li.append(el("p", "r-note", `"${r.note}"`));
    return li;
  }));
  // Times: today's route, then any swapped out of the day (0103), read-only.
  const t = timingsFailed ? { rows: [], total: null, timed: false } : dayTimes(timings, dayId);
  const earlier = timingsFailed ? [] : earlierTimes(timings, dayId);
  $("r-times-err").hidden = !timingsFailed;
  $("r-times-none").hidden = timingsFailed || t.timed;
  $("r-times-none").textContent = earlier.length ? "No times on the current route yet." : "No times yet. They come in as your crew drives the route with Carve.";
  $("r-table-box").hidden = !t.timed;
  $("r-times-note").hidden = !t.timed && !earlier.length;
  $("r-rows").replaceChildren(...(t.timed ? t.rows : []).map(rowOf));
  $("r-total").replaceChildren(...(t.total ? [totalOf(t.total)] : []));
  $("r-earlier").replaceChildren(...earlier.map((e) => {
    const box = el("div", "r-earlier-box");
    const table = el("table", "r-table");
    const body = el("tbody");
    body.append(...e.rows.map(rowOf));
    const foot = el("tfoot");
    if (e.total) foot.append(totalOf(e.total));
    table.append(body, foot);
    const scroll = el("div", "r-table-box");
    scroll.append(table);
    box.append(el("p", "r-earlier", e.tag), scroll);
    return box;
  }));
  // Update stop timers: only with a timed stop whose timer would change.
  const changes = timingsFailed ? [] : timerChanges(timings, dayId);
  $("r-timers").hidden = !changes.length && !$("r-timers-said").textContent;
  $("r-timers-go").hidden = !changes.length;
  $("r-timers-box").hidden = true;
  $("r-timers-ask").textContent = `Set ${changes.length === 1 ? "this stop's timer" : `these ${changes.length} stops' timers`} to the pre-drive's stay, to the nearest 5 minutes? Drivers' routes update too.`;
  $("r-changes").replaceChildren(...changes.map((c) => el("li", "", `${c.what}: ${c.from ? minutesText(c.from) : "no timer"} → ${c.to ? minutesText(c.to) : "no timer"}`)));
}

let busy = false;
function wire() {
  for (const [button, load] of [["r-reviews-retry", loadReviews], ["r-times-retry", loadTimings]]) {
    $(button).addEventListener("click", async () => {
      $(button).disabled = true;
      await load();
      $(button).disabled = false;
      draw();
    });
  }
  $("r-timers-go").addEventListener("click", () => {
    $("r-timers-said").textContent = "";
    $("r-timers-box").hidden = false;
    $("r-timers-go").hidden = true;
  });
  $("r-timers-no").addEventListener("click", () => {
    $("r-timers-box").hidden = true;
    $("r-timers-go").hidden = false;
  });
  $("r-timers-yes").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    $("r-timers-yes").disabled = true;
    const dayId = tabs.find((t) => t.n === day)?.id;
    try {
      const answer = await rpc("drive_stop_timers_update", { p_day_id: dayId });
      $("r-timers-said").textContent = timersSaid(answer?.updated || []);
      await loadTimings();
      draw();
    } catch {
      // Nothing changed: the ask stays open, to try again.
      $("r-timers-said").textContent = "Couldn't update the timers. Try again.";
    } finally {
      busy = false;
      $("r-timers-yes").disabled = false;
    }
  });
}

start();
