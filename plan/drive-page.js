// The organizer's drive page (Club-Sprint-Requirements.md, "The organizer's
// drive page", and §4 Pre-runs): once a drive is on the server, each day's
// headcount and cap meter, the pre-run (its date and who, planned against
// actual times), and what's been sent. No notes: Mark and Note are removed
// (Chris, 11/10 night).
// Attendees, Groups and Send stay their own steps; the page links to them.
// Read on open (drive_get); every change is a tap (App Dev's contract §7).

import { STATUS_WORDS } from "./attendees.js?v=1";
import { historyRows } from "./send.js?v=2";

const COUNT_ORDER = ["registered", "going", "maybe", "invited", "no"];

/// A day's headcount in a line: "12 registered · 8 going · 1 waitlisted".
export function countsLine(counts = {}) {
  const parts = COUNT_ORDER.filter((k) => counts[k]).map((k) => `${counts[k]} ${STATUS_WORDS[k].toLowerCase()}`);
  if (counts.waitlisted) parts.push(`${counts.waitlisted} waitlisted`);
  return parts.join(" · ") || "Nobody yet";
}

/// The cap meter: { text, fill (0–1), over }. A null cap is no limit.
export function capMeter(cap, coming = 0) {
  if (!cap || cap.limit == null) return { text: `${coming} coming. No limit on this drive.`, fill: 0, over: false };
  const used = cap.used ?? coming;
  const over = used > cap.limit;
  return {
    text: over ? `${used} coming, ${used - cap.limit} over your plan's ${cap.limit}.` : `${used} of ${cap.limit} places`,
    fill: Math.min(1, used / Math.max(1, cap.limit)),
    over,
  };
}

/// Minutes as "48 min" or "1 h 05 min".
export function minutesText(m) {
  if (!Number.isFinite(m)) return "–";
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")} min`;
}

/// The pre-run's legs, per day: what to show and whether the plan uses
/// the pre-run's times. → { days: [{ dayId, rows: [{ leg, planned, actual, diff }] }], timed, applied }
export function timingRows(legs = []) {
  const days = [];
  for (const l of legs) {
    let d = days.find((x) => x.dayId === l.day_id);
    if (!d) days.push((d = { dayId: l.day_id, rows: [] }));
    const diff = Number.isFinite(l.actual_minutes) && Number.isFinite(l.planned_minutes) ? Math.round(l.actual_minutes - l.planned_minutes) : null;
    d.rows.push({
      leg: `${l.from} to ${l.to}${l.route ? ` (${l.route})` : ""}`,
      planned: minutesText(l.planned_minutes),
      actual: minutesText(l.actual_minutes),
      diff: diff == null ? "" : diff === 0 ? "on time" : diff > 0 ? `${diff} min slower` : `${-diff} min faster`,
    });
  }
  return { days, timed: legs.some((l) => Number.isFinite(l.actual_minutes)), applied: legs.some((l) => Number.isFinite(l.applied_minutes)) };
}

const dayTitle = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};

/// The page, wired. `api` is the planner's (rpc, map, …);
/// `sender` the Send step's (send, gates); `go(step)` opens a step.
export function initPage({ $, el, api, drive, save, sender, go, onGroupPlan = () => false }) {
  let live = null; // drive_get, this visit
  let legs = null;
  let busy = false;

  const say = (text) => { $("dp-said").textContent = text; };
  const nameOf = (id) => { const p = live?.attendees?.find((a) => a.id === id); return p ? p.name || p.email : null; };

  async function load() {
    const d = drive();
    if (!d.server || !api.account()) return false;
    try {
      live = await api.rpc("drive_get", { p_drive_id: d.id });
      legs = live?.prerun ? await api.rpc("drive_prerun_timings", { p_drive_id: d.id }).catch(() => null) : null;
      return true;
    } catch (failure) {
      say(failure?.message || "Couldn't load the drive. Try again.");
      return false;
    }
  }

  async function render({ reload = true } = {}) {
    if (reload) await load();
    const d = drive();
    $("dp-empty").hidden = !!live;
    $("dp-body").hidden = !live;
    if (!live) {
      $("dp-empty").textContent = !api.account() ? "Sign in to see this drive's page." : "Send it to yourself first: the drive page fills in once it's saved.";
      return;
    }
    $("dp-status").textContent = { draft: "Not sent yet", sent: "Sent", cancelled: "Cancelled" }[live.status] || "";
    $("dp-link").textContent = (live.url || "").replace(/^https:\/\//, "");
    $("dp-link").href = live.url || "#";

    // Each day: when, who, the cap.
    $("dp-days").replaceChildren(...(live.days || []).map((day, i) => {
      const li = el("li", "dp-day");
      const head = el("div", "dp-day-head");
      head.append(el("b", "", `${live.days.length > 1 ? `Day ${i + 1}: ` : ""}${dayTitle(day.date)}`), el("span", "dim small", day.place?.name || ""));
      const meter = capMeter(day.cap, day.counts?.coming || 0);
      const bar = el("div", `dp-meter${meter.over ? " over" : ""}`);
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", meter.text);
      const fill = el("span");
      fill.style.width = `${Math.round(meter.fill * 100)}%`;
      bar.append(fill);
      li.append(head, el("p", "dp-counts", countsLine(day.counts)), bar, el("p", `small ${meter.over ? "g-problem" : "dim"}`, meter.text));
      if (meter.over) {
        const plans = el("a", "textlink small", "See plans");
        plans.href = "/pricing/";
        li.append(plans);
      }
      return li;
    }));
    $("dp-people").textContent = `Attendees (${live.attendees?.length ?? d.attendees.length})`;

    renderPrerun();

    const rows = historyRows(live.sends);
    $("dp-history-h").hidden = !rows.length;
    $("dp-history").replaceChildren(...rows.map((r) => {
      const li = el("li");
      li.append(el("b", "", r.what), el("span", "", r.when));
      return li;
    }));
    $("dp-history-none").hidden = !!rows.length;
  }

  function renderPrerun() {
    // Pre-runs and numbered groups are Club's (the user, 11/8 late).
    const group = onGroupPlan();
    $("dp-pr-h").hidden = group;
    $("dp-groups").hidden = group;
    const pr = group ? null : live.prerun;
    $("dp-pr-off").hidden = group || !!pr;
    $("dp-pr-on").hidden = !pr;
    if (!pr) return;
    $("dp-pr-date").value = pr.date;
    $("dp-pr-date").max = live.days.at(-1)?.date || "";
    const names = (pr.attendee_ids || []).map(nameOf).filter(Boolean);
    $("dp-pr-who").textContent = names.length ? names.join(", ") : "Nobody yet. Choose leads and sweeps on Groups, or pick people here.";
    if (!$("dp-pr-pick").hidden) renderPick();
    sender.gates().then((g) => {
      $("dp-pr-send").disabled = !g?.leads.ok;
      $("dp-pr-send-why").textContent = g && !g.leads.ok ? (g.leads.why === "no_leads" ? "Choose leads and sweeps on Groups first." : "") : "";
    });

    // Planned against the pre-run.
    const t = timingRows(legs || []);
    $("dp-times-h").hidden = !t.days.length;
    $("dp-times").replaceChildren(...t.days.flatMap((day) => {
      const i = live.days.findIndex((x) => x.id === day.dayId);
      const table = el("table", "g-table dp-table");
      const cap = el("caption", "", live.days.length > 1 ? `Day ${i + 1}` : "Each leg");
      const head = el("tr");
      for (const h of ["Leg", "Planned", "Pre-run", ""]) head.append(el("th", "", h));
      table.append(cap, head);
      for (const r of day.rows) {
        const tr = el("tr");
        for (const v of [r.leg, r.planned, r.actual, r.diff]) tr.append(el("td", "", v));
        table.append(tr);
      }
      return [table];
    }));
    $("dp-times-none").hidden = !(t.days.length && !t.timed);
    $("dp-apply").hidden = !t.timed;
    $("dp-apply").textContent = t.applied ? "Go back to the planned times" : "Use the pre-run's times";
    $("dp-apply").dataset.apply = String(!t.applied);
  }

  // Who's on the pre-run: leads and sweeps first, then everyone coming.
  function renderPick() {
    const chosen = new Set(live.prerun?.attendee_ids || []);
    const roles = new Map();
    for (const d of live.days || []) for (const g of d.groups || []) {
      if (g.lead_id) roles.set(g.lead_id, "Lead");
      if (g.sweep_id && !roles.has(g.sweep_id)) roles.set(g.sweep_id, "Sweep");
    }
    const people = (live.attendees || [])
      .filter((p) => p.status === "going" || p.status === "registered" || chosen.has(p.id))
      .sort((a, b) => Number(roles.has(b.id)) - Number(roles.has(a.id)) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
    $("dp-pr-list").replaceChildren(...people.map((p) => {
      const li = el("li");
      const label = el("label");
      const box = el("input");
      box.type = "checkbox";
      box.value = p.id;
      box.checked = chosen.has(p.id);
      label.append(box, el("span", "", p.name || p.email));
      if (roles.has(p.id)) label.append(el("span", "chip", roles.get(p.id)));
      li.append(label);
      return li;
    }));
  }
  const openPick = (open) => {
    $("dp-pr-pick").hidden = !open;
    $("dp-pr-change").setAttribute("aria-expanded", String(open));
    if (open) renderPick();
  };
  $("dp-pr-change").addEventListener("click", () => openPick($("dp-pr-pick").hidden));
  $("dp-pr-cancel").addEventListener("click", () => openPick(false));
  $("dp-pr-save").addEventListener("click", () => {
    const ids = [...$("dp-pr-list").querySelectorAll("input:checked")].map((b) => b.value);
    openPick(false);
    act(() => api.rpc("drive_prerun_set", { p_drive_id: drive().id, p_date: live.prerun.date, p_attendee_ids: ids }), ids.length ? "Saved who's on the pre-run." : "Nobody's on the pre-run now.");
  });

  // A tap that changes something: one at a time, then read again.
  async function act(call, done = "") {
    if (busy) return;
    busy = true;
    say("");
    try {
      await call();
      await render();
      if (done) say(done);
    } catch (failure) {
      say(failure?.message || "Couldn't save that. Try again.");
    } finally {
      busy = false;
    }
  }

  $("dp-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(live?.url || "");
      say("Link copied.");
    } catch {
      say("Couldn't copy. Select the link and copy it.");
    }
  });
  $("dp-people").addEventListener("click", () => go("attendees"));
  $("dp-groups").addEventListener("click", () => go("groups"));
  $("dp-send").addEventListener("click", () => go("send"));
  $("dp-pr-plan").addEventListener("click", () => act(() => api.rpc("drive_prerun_set", { p_drive_id: drive().id })));
  $("dp-pr-date").addEventListener("change", (e) => {
    if (!e.target.value) return;
    act(() => api.rpc("drive_prerun_set", { p_drive_id: drive().id, p_date: e.target.value, p_attendee_ids: live.prerun.attendee_ids }), "Pre-run date saved.");
  });
  $("dp-pr-remove").addEventListener("click", () => act(() => api.rpc("drive_prerun_set", { p_drive_id: drive().id, p_off: true })));
  $("dp-pr-send").addEventListener("click", async () => {
    await sender.send("leads", { preRun: true, said: "dp-said" });
    await render();
  });
  $("dp-apply").addEventListener("click", () => {
    const apply = $("dp-apply").dataset.apply === "true";
    act(() => api.rpc("drive_prerun_apply", { p_drive_id: drive().id, p_apply: apply }), apply ? "The plan now uses the pre-run's times." : "Back to the planned times.");
  });

  return {
    render,
    clear: () => {},
    /// The pre-run review in the Pre-run step (its elements live there now).
    review: async () => { if (await load() && live) renderPrerun(); },
  };
}
