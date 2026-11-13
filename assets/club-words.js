// Club v2's words and rules (Club-v2-Requirements-2026-11-09.md), with no
// DOM and no network so scripts/plan-tests can run them under node.

const DAY = 86400000;

/// "2026-12-12" as a local date (never shifted by the time zone).
export function parseDay(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/// A local date as "2026-12-12".
export function isoDay(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/// "2026-12-12" → "2026-12-13" (or -1 for the day before).
export function addDays(iso, n) {
  const d = parseDay(iso);
  return d ? isoDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)) : "";
}

/// "Sat, Dec 12".
export function dayText(iso) {
  const d = parseDay(iso);
  return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
}

/// "Sat, Dec 12 – Sun, Dec 13", one date for one day, "No date yet" for none.
export function datesText(days = []) {
  const dates = days.map((d) => d.date).filter(Boolean).sort();
  if (!dates.length) return "No date yet";
  const first = dayText(dates[0]);
  const last = dayText(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/// "08:00" → "8:00 AM"; "" for none.
export function timeText(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ""));
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/// The auto-renewal terms beside Start a club's button (Legal, 11/11), as
/// org-billing's renewalText words them on Checkout, from plans.js (the
/// price, and the trial's days from its "30 days free"): the first paint,
/// until org-billing's preview gives its own.
export function renewalTerms(plan, trial) {
  const year = plan?.year;
  if (!Number.isFinite(year)) return "";
  const days = trialDays(plan);
  const when = trial && days > 0 ? ` after a ${days}-day free trial` : ", billed today";
  return `${priceText(year)}/year${when}. Renews every year until you cancel. Cancel any time in Club settings.`;
}

/// A plan's trial in days, from plans.js's "30 days free"; 0 for none.
export const trialDays = (plan) => Number(/(\d+) days/.exec(plan?.trial || "")?.[1]) || 0;

/// "$499", "$49.99".
export const priceText = (dollars) => `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}`;

/// The line above a club day link's route name (Chris, 11/11): "Golden Gate
/// Run · Day 2 · Sat, Nov 22 · meet at 8:00 AM", from route_drive. "Day N"
/// only on a drive of more than one day, found by the day's date (a link can
/// follow its day to another route, 0091). Null without a name or a date.
export function dayHeadline(drive) {
  const name = String(drive?.drive_name || "").trim();
  const when = dayText(drive?.day_date);
  if (!name || !when) return null;
  const days = drive.days || [];
  const i = days.findIndex((d) => d?.date === drive.day_date);
  const meet = timeText(drive.meet);
  return [name, days.length > 1 && i >= 0 ? `Day ${i + 1}` : null, when, meet ? `meet at ${meet}` : null].filter(Boolean).join(" · ");
}

/// A drive's status on Club home (Chris, 11/9): Completed after its last
/// day, else Ready once every day has a route, else Draft. A day is
/// routed when the server says so (`routed`) or has a route.
export function stageOf(drive, today = isoDay(new Date())) {
  const days = drive?.days || [];
  const dates = days.map((d) => d.date).filter(Boolean).sort();
  if (dates.length && dates[dates.length - 1] < today) return "completed";
  return days.length && days.every(dayRouted) ? "ready" : "draft";
}
export const dayRouted = (d) => !!(d?.routed ?? d?.routes?.length);
export const STAGE_WORDS = { draft: "Draft", ready: "Ready", completed: "Completed" };

/// Club home's two lists: Upcoming (soonest first, undated drafts on top)
/// and Past (latest first). Cancelled drives show in neither.
export function splitHome(drives = [], today = isoDay(new Date())) {
  const live = drives.filter((d) => d.status !== "cancelled");
  const first = (d) => (d.days || []).map((x) => x.date).filter(Boolean).sort()[0] || "";
  const last = (d) => (d.days || []).map((x) => x.date).filter(Boolean).sort().pop() || "";
  const upcoming = live.filter((d) => stageOf(d, today) !== "completed").sort((a, b) => first(a).localeCompare(first(b)));
  const past = live.filter((d) => stageOf(d, today) === "completed").sort((a, b) => last(b).localeCompare(last(a)));
  return { upcoming, past };
}

/// "1 of 2 days planned".
export function plannedLine(days = []) {
  const done = days.filter(dayRouted).length;
  return days.length === 1 ? (done ? "Route planned" : "No route yet") : `${done} of ${days.length} days planned`;
}

/// Day labels: "Day 1 · Sat, Dec 12" once there are two days or more,
/// just the date for one (the wires: "Day N" only after + Add a day).
export function dayLabel(days, i) {
  const date = dayText(days[i]?.date) || "No date yet";
  return days.length > 1 ? `Day ${i + 1} · ${date}` : date;
}

/// Club home's eyebrow: "Club plan · trial, 24 days left", "Club plan",
/// "No plan yet". `status` is org-billing's (the owner's only).
export function planEyebrow(planName, status, now = Date.now()) {
  if (!planName) return "No plan yet";
  const ends = status?.trial_ends_at ? Date.parse(status.trial_ends_at) : NaN;
  if (Number.isFinite(ends) && ends > now) {
    const left = Math.max(1, Math.ceil((ends - now) / DAY));
    return `${planName} plan · trial, ${left} ${left === 1 ? "day" : "days"} left`;
  }
  return `${planName} plan`;
}

/// The plan card on Start a club (O1, board v41): Club alone, from
/// plans.js (one plan, Chris 11/10 afternoon). No drive pass line while
/// passes are paused.
export function planCards(plans) {
  return plans.filter((p) => p.for === "organizers").map((p) => ({
    plan: p.plan,
    name: p.name,
    price: p.price,
    lines: ["Multi-day drives", "Pre-drives with your crew", "Smart planning for every organizer", `${p.organizers} organizers`],
  }));
}

/// "Free trial ends Dec 3. First charge Dec 3." and the like (O2c).
export function billingLine(status) {
  const when = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (status?.trial_ends_at) return status.cancel_at_period_end ? `Free trial ends ${when(status.trial_ends_at)}. Nothing will be charged.` : `Free trial ends ${when(status.trial_ends_at)}. First charge ${when(status.trial_ends_at)}.`;
  if (status?.renews_at) return status.cancel_at_period_end ? `Ends ${when(status.renews_at)}.` : `Renews ${when(status.renews_at)}.`;
  return "";
}

/// The pre-run view's crew line (O6). No Note button: Mark and Note are
/// removed (Chris, 11/10 night); the crew leave the usual review.
export function crewLine(prerunDate) {
  return prerunDate ? "Send your crew these links, the same ones drivers get later." : "";
}

/// The title on a drive day's Share, pre-drive and route pages (Chris,
/// 11/10): with several days, this day's route from its start to its end
/// ("Clayton → Bridgeport"), else "Day N"; one day, the drive's name.
export function shareTitle({ dayCount, n, payload, driveName }) {
  if (dayCount <= 1) return driveName || payload?.name || "";
  const from = String(payload?.startName || "").trim(), to = String(payload?.endName || "").trim();
  return from && to ? `${from} → ${to}` : `Day ${n}`;
}

/// The club's trial from orgs_mine, for when billing has no subscription to
/// say (a trial set without Stripe, as on the test branch): what
/// planEyebrow and billingLine take.
export const trialStatus = (org) => (org?.trial_ends_at ? { trial_ends_at: org.trial_ends_at } : null);

/// The new-drive form's days, checked: each needs a date, each later day
/// after the one before, the pre-run (if on) before the first day.
/// → null, or what to fix.
export function formProblem({ name, days, prerun, prerunWas = null, today = isoDay(new Date()) }) {
  if (!String(name || "").trim()) return "Add the drive's name.";
  for (let i = 0; i < days.length; i++) {
    const label = days.length > 1 ? `Day ${i + 1}` : "The drive";
    if (!days[i].date) return `${label} needs a date.`;
    if (i && days[i].date <= days[i - 1].date) return `Day ${i + 1} has to be after Day ${i}.`;
    if (days[i].meet && days[i].leave && days[i].leave < days[i].meet) return `${label} leaves before it meets. Check the times.`;
  }
  if (prerun?.on) {
    if (!prerun.date) return "Pick the pre-drive's date, or choose No.";
    // Never a new date already gone (a saved one that has passed may stay).
    if (prerun.date < today && prerun.date !== prerunWas) return "Pick a pre-drive date from today on.";
    if (prerun.date >= days[0].date) return "The pre-drive has to be before the drive.";
  }
  return null;
}

/// A day card's thumbnail (board O4): the route's line fitted into a
/// `w`×`h` box with `pad` around it, north up, longitude scaled by the
/// latitude so shapes keep their proportions; at most `most` points.
/// → { d, start: [x, y], end: [x, y] } or null without a line.
export function thumbPath(payload, w = 150, h = 90, { pad = 10, most = 120 } = {}) {
  const geo = (payload?.pathGeometry || []).filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude));
  if (geo.length < 2) return null;
  const step = Math.max(1, Math.ceil(geo.length / most));
  const pts = geo.filter((_, i) => i % step === 0 || i === geo.length - 1);
  const k = Math.cos((pts.reduce((a, p) => a + p.latitude, 0) / pts.length) * Math.PI / 180);
  const xs = pts.map((p) => p.longitude * k), ys = pts.map((p) => p.latitude);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const ox = (w - (x1 - x0) * scale) / 2, oy = (h - (y1 - y0) * scale) / 2;
  const at = (i) => [Math.round((ox + (xs[i] - x0) * scale) * 10) / 10, Math.round((oy + (y1 - ys[i]) * scale) * 10) / 10];
  const xy = pts.map((_, i) => at(i));
  return { d: xy.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" "), start: xy[0], end: xy[xy.length - 1] };
}

/// A route's shape as SVG markup (club flow mock v11): the real line, the
/// start, the stops and the end on plain ground, no tiles. Numbers and our
/// own colours only, so it's safe as markup. "" without a line.
/// pins: false for a list's small thumbnail (the line alone, muted when past).
export function shapeSvg(payload, { w = 540, h = 300, pad = 34, pins = true, muted = false } = {}) {
  const geo = (payload?.pathGeometry || []).filter((p) => Number.isFinite(p?.latitude) && Number.isFinite(p?.longitude));
  if (geo.length < 2) return "";
  const step = Math.max(1, Math.ceil(geo.length / 240));
  const pts = geo.filter((_, i) => i % step === 0 || i === geo.length - 1);
  const k = Math.cos((pts.reduce((a, p) => a + p.latitude, 0) / pts.length) * Math.PI / 180);
  const xs = pts.map((p) => p.longitude * k), ys = pts.map((p) => p.latitude);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const ox = (w - (x1 - x0) * scale) / 2, oy = (h - (y1 - y0) * scale) / 2;
  const r1 = (n) => Math.round(n * 10) / 10;
  const at = (lat, lon) => [r1(ox + (lon * k - x0) * scale), r1(oy + (y1 - lat) * scale)];
  const xy = pts.map((p) => at(p.latitude, p.longitude));
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  if (!pins) return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${muted ? "#7D857F" : "#6FD39A"}" stroke-width="${r1(w / 45)}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const stops = (payload.allWaypoints || payload.waypoints || [])
    .filter((p) => p?.type === "stop" && Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude))
    .map((p) => at(p.location.latitude, p.location.longitude));
  const dot = ([x, y], r, fill) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#0E1210" stroke-width="3"/>`;
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<path d="${d}" fill="none" stroke="#0E1210" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${d}" fill="none" stroke="#6FD39A" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
    + dot(xy[0], 9, "#2DA160") + stops.map((s) => dot(s, 8, "#E07B39")).join("") + dot(xy[xy.length - 1], 9, "#EEF1EE")
    + "</svg>";
}

/// A day's route on its card: "Coastal Run · 182 mi · 3 stops" (the
/// route's name from its saved payload).
export function routeLine(payload, miles = true) {
  if (!payload) return "";
  const m = Number(payload.pathDistanceMeters) || 0;
  const distance = m ? (miles ? `${Math.round(m / 1609.344)} mi` : `${Math.round(m / 1000)} km`) : "";
  const stops = (payload.allWaypoints || payload.waypoints || []).filter((w) => w.type === "stop").length;
  return [payload.name || "Untitled route", distance, stops ? `${stops} ${stops === 1 ? "stop" : "stops"}` : ""].filter(Boolean).join(" · ");
}

/// The drive page's header line: "Sat, Dec 12 – Sun, Dec 13 · meet 8:00 AM".
export function driveLine(days = [], drivers = "") {
  const meet = timeText(days[0]?.meet);
  return [datesText(days), meet ? `meet ${meet}` : "", drivers].filter(Boolean).join(" · ");
}

/// The pre-run's first date: a week before Day 1, never before today.
export function prerunDefault(day1, today = isoDay(new Date())) {
  if (!day1) return "";
  const week = addDays(day1, -7);
  return week < today ? today : week;
}

/// A new day's times, real values and never placeholders (Chris, 11/10:
/// a grey "12:30 PM" read as set, and the branch refuses a day without
/// both times): meet 8:00 AM, leave half an hour later.
export const DEFAULT_MEET = "08:00";
export const LEAVE_AFTER_MINUTES = 30;

/// Leave, half an hour after `meet` ("HH:MM"); past midnight it stops at 23:59.
export function leaveAfter(meet) {
  const m = /^(\d{1,2}):(\d{2})/.exec(meet || "");
  if (!m) return "";
  const t = Math.min(Number(m[1]) * 60 + Number(m[2]) + LEAVE_AFTER_MINUTES, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/// What an emptied time says on its field: both are needed.
export const TIME_MISSING = { meet: "Add a meet time", leave: "Add a leave time" };

/// No drive in the past (Chris, 11/10; 0061's day_past and meet_soon): what
/// the date or the meet time says on its field.
export const DAY_WHEN = { past: "Pick a date from today on.", soon: "Meet at least 30 minutes from now." };
export const MEET_AHEAD_MINUTES = 30;

/// Today and the minute of the day now, in `zone` (the drive's): { date, minutes }.
export function zoneNow(now = Date.now(), zone = undefined) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(zone ? { timeZone: zone } : {}) })
    .formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/// A day's date and meet time against now, as the server checks them: a
/// saved day left as it was is never refused (a completed drive keeps its
/// date); otherwise no date before today, and today's meet 30 minutes out.
/// `was`: the saved day, if any. → { field: "date" | "meet", text } or null.
export function dayWhenProblem(day, { was = null, now = Date.now(), zone = undefined } = {}) {
  const hm = (t) => (t || "").slice(0, 5);
  if (was && was.date === day.date && hm(was.meet) === hm(day.meet) && hm(was.leave) === hm(day.leave)) return null;
  if (!day.date) return null;
  const at = zoneNow(now, zone);
  if (day.date < at.date) return { field: "date", text: DAY_WHEN.past };
  const m = /^(\d{1,2}):(\d{2})/.exec(day.meet || "");
  if (day.date === at.date && m && Number(m[1]) * 60 + Number(m[2]) < at.minutes + MEET_AHEAD_MINUTES) return { field: "meet", text: DAY_WHEN.soon };
  return null;
}

/// The pre-run card's line: before its date, what to do; on or after it,
/// when it was (a past date said "before" it, 11/10). No report in Step 1.
export function prerunLine(iso, today = isoDay(new Date())) {
  const day = dayText(iso).replace(/^\w+, /, "");
  if (iso > today) return `Send your crew the route links before ${day}.`;
  return iso === today ? "The pre-drive is today." : `The pre-drive was ${day}.`;
}

/// The drive's drivers for its header (Chris, 11/10; 0087's `drivers`,
/// signed in through the links, organizers not counted): "4 drivers",
/// never "of" a cap (one plan, no cap: board O4, v41). A number only; ""
/// while the field isn't there.
export function driversText(drive) {
  const n = drive?.drivers;
  if (!Number.isInteger(n) || n < 0) return "";
  return n === 1 ? "1 driver" : `${n} drivers`;
}

// ── Club home's next-drive card and lists (club flow mock v11, Chris 11/13) ──

/// A drive's status chip, saying what to do: "1 of 2 days planned" (or
/// "No route yet" for one day), "Ready to share", "Done". tone: warn, ok, done.
export function statusChip(drive, today = isoDay(new Date())) {
  const stage = stageOf(drive, today);
  if (stage === "completed") return { text: "Done", tone: "done" };
  if (stage === "ready") return { text: "Ready to share", tone: "ok" };
  return { text: plannedLine(drive?.days || []), tone: "warn" };
}

/// Whole days from today to the drive's first date; null with no date.
export function daysToGo(days = [], today = isoDay(new Date())) {
  const first = days.map((d) => d.date).filter(Boolean).sort()[0];
  const a = parseDay(first), b = parseDay(today);
  return a && b ? Math.max(0, Math.round((a - b) / DAY)) : null;
}

/// The next drive's card: chip, the "when" line, the stat strip, the
/// progress bar and its two buttons. `routes`: drive_routes (each day's
/// first route, with its payload). miles: true for mi, false for km.
export function nextCard(drive, routes = [], { today = isoDay(new Date()), miles = true } = {}) {
  const days = drive?.days || [];
  const byDay = new Map();
  for (const r of routes) if (!byDay.has(r.day_id) || r.position < byDay.get(r.day_id).position) byDay.set(r.day_id, r);
  const ds = days.map((d) => ({ ...d, routed: d.routed ?? byDay.has(d.id), route: byDay.get(d.id) || null }));
  const several = ds.length > 1;
  const dayName = (i) => (several ? `Day ${i + 1}` : "");
  const meet = timeText(ds[0]?.meet);
  const when = [datesText(ds), meet ? `meet ${meet}` : ""].filter(Boolean).join(" · ");
  const count = [];
  const go = daysToGo(ds, today);
  if (go !== null) count.push(go === 0 ? { n: "Today", label: "drive day" } : { n: String(go), label: go === 1 ? "day to go" : "days to go" });
  const firstRouted = ds.findIndex((d) => d.route?.payload);
  if (firstRouted >= 0) {
    const p = ds[firstRouted].route.payload;
    const m = Number(p.pathDistanceMeters) || 0;
    if (m) count.push({ n: String(Math.round(miles ? m / 1609.344 : m / 1000)), label: `${miles ? "miles" : "km"}${several ? ` · Day ${firstRouted + 1}` : ""}` });
    const stops = (p.allWaypoints || p.waypoints || []).filter((w) => w.type === "stop").length;
    count.push({ n: String(stops), label: stops === 1 ? "stop" : "stops" });
  }
  const done = ds.filter((d) => d.routed).length;
  const open = ds.findIndex((d) => !d.routed);
  const progress = { pct: ds.length ? Math.round((done / ds.length) * 100) : 0,
    text: open >= 0 ? (several ? `Day ${open + 1} needs a route` : "Needs a route") : several ? "Every day has a route" : "Route planned" };
  const shareAt = ds.findIndex((d) => d.routed && d.route?.share_token);
  const acts = [];
  if (open >= 0) acts.push({ kind: "plan", day: open + 1, text: several ? `Plan Day ${open + 1}` : "Plan route", primary: true });
  if (shareAt >= 0) acts.push({ kind: "share", day: shareAt + 1, token: ds[shareAt].route.share_token, text: several ? `Share Day ${shareAt + 1}` : "Share", primary: open < 0 });
  return { chip: statusChip({ days: ds }, today), when, count, progress, acts, shapeDay: firstRouted, dayName };
}

/// A list row's line: "Mon, Jan 11 · 52 mi" (the first routed day's
/// distance when its route is at hand).
export function rowLine(days = [], routes = [], miles = true) {
  const r = [...routes].sort((a, b) => a.position - b.position).find((x) => x.payload?.pathDistanceMeters);
  const m = Number(r?.payload?.pathDistanceMeters) || 0;
  return [datesText(days), m ? (miles ? `${Math.round(m / 1609.344)} mi` : `${Math.round(m / 1000)} km`) : ""].filter(Boolean).join(" · ");
}

/// Two letters for an organizer's circle, from their email: dana.moore@ → DM, sam@ → SA.
export function initials(email = "") {
  const local = String(email).split("@")[0].replace(/[0-9]+/g, " ");
  const parts = local.split(/[._\-+ ]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || "?").slice(0, 2);
  return two.toUpperCase();
}

/// The trial's quiet meter: { label, used (0–100), text } or, on a paid
/// plan, no meter. status: org-billing's or orgs_mine's trial_ends_at.
export function trialMeter(plan, status, now = Date.now()) {
  const ends = status?.trial_ends_at ? Date.parse(status.trial_ends_at) : NaN;
  const total = trialDays(plan) || 30;
  const price = Number.isFinite(plan?.year) ? `${priceText(plan.year)} a year` : "";
  if (Number.isFinite(ends) && ends > now) {
    const left = Math.max(1, Math.ceil((ends - now) / DAY));
    return { label: `${plan?.name || "Club"} plan · free trial`, used: Math.round(Math.min(1, Math.max(0, (total - left) / total)) * 100),
      text: `${left} ${left === 1 ? "day" : "days"} left.${price ? ` Then ${price}.` : ""}` };
  }
  const renews = status?.renews_at ? Date.parse(status.renews_at) : NaN;
  return { label: `${plan?.name || "Club"} plan`, used: null,
    text: Number.isFinite(renews) ? `Renews ${new Date(renews).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}.` : "" };
}

// ── The drive page (club flow mock v11, screen 5) ──

/// "in 24 days", "tomorrow", "today"; "" once it's begun or with no date.
export function inDays(days = [], today = isoDay(new Date())) {
  const n = daysToGo(days, today);
  const first = days.map((d) => d.date).filter(Boolean).sort()[0];
  if (n === null || first < today) return "";
  return n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

/// "1 h 05 min" or "52 min" from seconds.
export function durationText(seconds) {
  const m = Math.round((Number(seconds) || 0) / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/// A routed day's facts: [{ b, rest }]: "84 mi", "2 h 50 min driving", "3 stops".
export function routeFacts(payload, miles = true) {
  if (!payload) return [];
  const out = [];
  const m = Number(payload.pathDistanceMeters) || 0;
  if (m) out.push({ b: miles ? `${Math.round(m / 1609.344)} mi` : `${Math.round(m / 1000)} km`, rest: "" });
  if (Number(payload.pathDurationSeconds) > 0) out.push({ b: durationText(payload.pathDurationSeconds), rest: "driving" });
  const stops = (payload.allWaypoints || payload.waypoints || []).filter((w) => w.type === "stop").length;
  out.push({ b: String(stops), rest: stops === 1 ? "stop" : "stops" });
  return out;
}

/// A day's meet and leave: ["Meet 8:00 AM at Vasona Lake Park", "Leave 8:30 AM"].
export function meetLeave(day) {
  const meet = timeText(day?.meet), leave = timeText(day?.leave);
  const place = day?.place?.label || day?.place_name || "";
  return [meet ? `Meet ${meet}${place ? ` at ${place}` : ""}` : "", leave ? `Leave ${leave}` : ""].filter(Boolean);
}

/// When drivers get Apex free on the drive's routes (0093): 14 days before
/// the first day to the day after the last. "Nov 28 to Dec 14"; "" with no dates.
export function apexWindow(days = []) {
  const dates = days.map((d) => d.date).filter(Boolean).sort();
  if (!dates.length) return "";
  const short = (iso) => dayText(iso).replace(/^\w+, /, "");
  return `${short(addDays(dates[0], -14))} to ${short(addDays(dates[dates.length - 1], 1))}`;
}

/// "Route updated 2 min ago." from the route's last save; "" without one.
export function updatedAgo(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return "Route updated just now.";
  if (min < 60) return `Route updated ${min} min ago.`;
  const h = Math.round(min / 60);
  if (h < 24) return `Route updated ${h} h ago.`;
  return `Route updated ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`;
}

// ── Welcome after checkout, and Club home until they're done (mock v11, screen 2) ──

/// The three first steps, each ticking itself off: Plan (the club has a
/// drive), Organizers (anyone invited), Get the app (they opened Get on
/// this account; DevOps, 11/13: no server data for it).
/// → [{ key, title, line, done, action }]
export function firstSteps({ drives = 0, organizers = 1, cap = 5, gotApp = false } = {}) {
  const more = Math.max(0, (Number(cap) || 5) - (Number(organizers) || 1));
  return [
    { key: "plan", title: "Plan your first drive", line: "Set the days and meet times, then a route for each day.", done: drives > 0, action: "Plan a drive" },
    { key: "invite", title: "Add organizers", line: `Invite up to ${more} more. Each gets Carve Apex while your plan is active.`, done: organizers > 1, action: "Invite" },
    { key: "app", title: "Get the app", line: "Drive the route turn by turn and see your group on the map.", done: !!gotApp, action: "Get" },
  ];
}

/// "Your free trial runs until Sat, Dec 12. Three steps to your first drive."
export function welcomeLine(status, now = Date.now()) {
  const ends = status?.trial_ends_at ? Date.parse(status.trial_ends_at) : NaN;
  const until = Number.isFinite(ends) && ends > now ? `Your free trial runs until ${new Date(ends).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}. ` : "";
  return `${until}Three steps to your first drive.`;
}
