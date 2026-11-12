// The Groups step's board (Club-Sprint-Requirements.md §2): one column per
// group, plus Unassigned and Waiting (Invited and Maybe). Auto-arrange is
// arrange.js; the organizer then moves people by selecting them and
// pressing a group's number, with Move to Group, or by dragging. Leads,
// sweeps and pinned people stay put when it runs again. Exports a CSV and a
// printable check-in sheet. One day's groups (multi-day is item 3).

import { arrange, groupLeave, groupsNeeded, makeGroups } from "./arrange.js?v=1";
import { makeDraggable } from "./drag.js";

const STYLE_WORD = { spirited: "Spirited", touring: "Touring", relaxed: "Relaxed" };
const coming = (p) => p.status === "going" || p.status === "registered";
const waiting = (p) => p.status === "invited" || p.status === "maybe";
const nameOf = (p) => p.name || p.email;
const timeText = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isFinite(h) ? new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) : "";
};

/// The day's board as kept in the draft: { groups, placements: { id: n },
/// settings: { target, gapMinutes, firstTimers }, arrangedAt }.
export function blankBoard() {
  return { groups: [], placements: {}, settings: { target: 10, gapMinutes: 10, firstTimers: null }, arrangedAt: null };
}

export function initBoard({ $, el, drive, day, save }) {
  // Groups are per day (App Dev's contract §4): this day's board, and the
  // people coming that day (no days ticked means every day).
  const board = () => ((drive.boards ||= {})[day().id] ||= blankBoard());
  const onDay = (p) => !Array.isArray(p.days) || p.days.includes(day().id);
  const selected = new Set();

  const people = () => drive.attendees.filter((p) => p.status !== "no" && onDay(p));
  const placed = (id) => board().placements[id] ?? null;
  const groupOf = (n) => board().groups.find((g) => g.number === n);

  function ensureGroups() {
    const b = board();
    if (b.groups.length) return;
    const count = groupsNeeded(people().filter(coming).length, b.settings.target);
    b.groups = makeGroups(Math.max(2, count), b.settings);
  }

  function setCount(count) {
    const b = board();
    count = Math.max(1, Math.min(30, count));
    const now = b.groups.length;
    if (count > now) {
      const extra = makeGroups(count, b.settings).slice(now);
      b.groups.push(...extra);
    } else {
      const gone = new Set(b.groups.slice(count).map((g) => g.number));
      b.groups = b.groups.slice(0, count);
      for (const [id, n] of Object.entries(b.placements)) if (gone.has(n)) delete b.placements[id];
    }
    b.groups.forEach((g, i) => (g.offset = i * b.settings.gapMinutes));
    if (b.settings.firstTimers && b.settings.firstTimers > count) b.settings.firstTimers = null;
    save();
    render();
  }

  function autoArrange() {
    const b = board();
    ensureGroups();
    const list = people().filter(coming).map((p) => ({ ...p, pinned: p.pinned ? placed(p.id) : undefined }));
    const result = arrange(list, b.groups, { firstTimers: b.settings.firstTimers || b.groups.length });
    b.placements = Object.fromEntries(result.placements);
    // Who placed whom (drive_groups_set's "by"): only the organizer's own
    // moves are kept as theirs; pins, leads and sweeps are theirs anyway.
    b.by = Object.fromEntries(Object.entries(b.by || {}).filter(([id]) => list.some((p) => p.id === id && p.pinned)));
    b.arrangedAt = Date.now();
    b.seen = list.map((p) => p.id);
    save();
    render();
    say(`Arranged ${list.length} ${list.length === 1 ? "car" : "cars"} into ${b.groups.length} groups.${result.over.length ? ` Over the size: Group ${result.over.join(", ")}.` : ""}`);
  }

  function move(ids, n) {
    const b = board();
    b.by ||= {};
    for (const id of ids) {
      if (n === null) delete b.placements[id];
      else b.placements[id] = n;
      b.by[id] = "organizer";
      // A lead or sweep moved away is no longer that group's.
      for (const g of b.groups) {
        if (g.number !== n && g.lead === id) g.lead = null;
        if (g.number !== n && g.sweep === id) g.sweep = null;
      }
    }
    save();
    render();
    say(`Moved ${ids.length === 1 ? nameOf(drive.attendees.find((p) => p.id === ids[0])) : `${ids.length} people`} to ${n === null ? "Unassigned" : `Group ${n}`}.`);
  }

  const say = (text) => { $("gb-said").textContent = text; };

  // ── the settings row ──
  function settings() {
    const b = board();
    $("gb-count").value = String(b.groups.length || "");
    $("gb-target").value = String(b.settings.target);
    $("gb-gap").value = String(b.settings.gapMinutes);
    const ft = $("gb-first");
    ft.replaceChildren(...b.groups.map((g) => new Option(`Group ${g.number}`, String(g.number))));
    ft.value = String(b.settings.firstTimers || b.groups.length);
  }

  // ── a person's card ──
  function card(p) {
    const n = placed(p.id);
    const g = n ? groupOf(n) : null;
    const li = el("li", "gb-card");
    li.dataset.id = p.id;
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(selected.has(p.id)));
    const top = el("div", "gb-top");
    top.append(el("b", "", nameOf(p)));
    if (g?.lead === p.id) top.append(el("span", "chip going", "Lead"));
    if (g?.sweep === p.id) top.append(el("span", "chip going", "Sweep"));
    li.append(top);
    const meta = el("div", "gb-meta");
    if (p.car) meta.append(el("span", "", p.car));
    li.append(meta);
    const chips = el("div", "gb-chips");
    if (p.style) chips.append(el("span", `chip style-${p.style}`, STYLE_WORD[p.style]));
    if (p.first_timer) chips.append(el("span", "chip first", "First time"));
    if (p.experienced) chips.append(el("span", "chip exp", "Experienced"));
    if (p.status === "maybe") chips.append(el("span", "chip maybe", "Maybe"));
    if (p.status === "invited") chips.append(el("span", "chip", "Invited"));
    const ft = board().settings.firstTimers || board().groups.length;
    if (p.first_timer && n && n !== ft) chips.append(el("span", "chip warn", `First-timer, not in Group ${ft}`));
    li.append(chips);
    if (coming(p)) {
      const tools = el("div", "gb-tools");
      const pin = el("button", "gb-tool", p.pinned ? "Pinned" : "Pin");
      pin.type = "button";
      pin.setAttribute("aria-pressed", String(!!p.pinned));
      pin.setAttribute("aria-label", `${p.pinned ? "Unpin" : "Pin"} ${nameOf(p)}: auto-arrange leaves pinned people where they are`);
      pin.addEventListener("click", (e) => { e.stopPropagation(); p.pinned = !p.pinned; save(); render(); });
      const exp = el("button", "gb-tool", p.experienced ? "Experienced ✓" : "Experienced");
      exp.type = "button";
      exp.setAttribute("aria-pressed", String(!!p.experienced));
      exp.addEventListener("click", (e) => { e.stopPropagation(); p.experienced = !p.experienced; save(); render(); });
      tools.append(pin, exp);
      li.append(tools);
    }
    li.addEventListener("click", (e) => toggle(p.id, e.shiftKey || e.metaKey || e.ctrlKey));
    li.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(p.id, true); }
    });
    return li;
  }

  function toggle(id, add) {
    if (!add) {
      const only = selected.size === 1 && selected.has(id);
      selected.clear();
      if (!only) selected.add(id);
    } else if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    syncSelection();
  }

  function syncSelection() {
    for (const li of document.querySelectorAll("#gb-cols .gb-card")) li.setAttribute("aria-selected", String(selected.has(li.dataset.id)));
    $("gb-move-row").hidden = !selected.size;
    $("gb-sel").textContent = selected.size ? `${selected.size} selected. Press a group's number, or:` : "";
  }

  // ── a column ──
  function column({ n, title, sub, list, droppable = true, group = null }) {
    const col = el("section", "gb-col");
    col.setAttribute("aria-label", title);
    // A drop zone (drag.js): its group, or "none" for Unassigned.
    if (droppable) col.dataset.group = n === null ? "none" : String(n);
    const head = el("div", "gb-head");
    head.append(el("h3", "", title));
    if (sub) head.append(el("span", "gb-sub", sub));
    col.append(head);
    if (group) {
      const label = el("select", "gb-label");
      label.setAttribute("aria-label", `Group ${group.number}'s style`);
      label.append(...Object.entries(STYLE_WORD).map(([k, v]) => new Option(v, k)));
      label.value = group.label;
      label.addEventListener("change", () => { group.label = label.value; save(); });
      const leave = el("input", "gb-leave");
      leave.type = "time";
      leave.step = 300;
      leave.value = groupLeave(day().leave, group.offset) || "";
      leave.setAttribute("aria-label", `Group ${group.number} leaves at`);
      leave.addEventListener("change", () => {
        const [h, m] = leave.value.split(":").map(Number);
        const [dh, dm] = String(day().leave).split(":").map(Number);
        if ([h, m, dh, dm].every(Number.isFinite)) group.offset = h * 60 + m - (dh * 60 + dm);
        save();
      });
      const row = el("div", "gb-grow");
      row.append(label, leave);
      col.append(row);
      const roles = el("div", "gb-roles");
      for (const role of ["lead", "sweep"]) {
        const pick = el("select", "gb-role");
        pick.setAttribute("aria-label", `Group ${group.number}'s ${role}`);
        pick.append(new Option(role === "lead" ? "Lead: pick someone" : "Sweep: pick someone", ""),
          ...people().filter(coming).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((p) => new Option(`${role === "lead" ? "Lead" : "Sweep"}: ${nameOf(p)}`, p.id)));
        pick.value = group[role] || "";
        pick.addEventListener("change", () => {
          const id = pick.value || null;
          for (const g of board().groups) { if (g[role] === id) g[role] = null; }
          group[role] = id;
          if (id) {
            board().placements[id] = group.number;
            (board().by ||= {})[id] = "organizer";
          }
          save();
          render();
        });
        roles.append(pick);
      }
      col.append(roles);
    }
    const ul = el("ul", "gb-list");
    ul.setAttribute("role", "listbox");
    ul.setAttribute("aria-multiselectable", "true");
    ul.setAttribute("aria-label", title);
    ul.append(...list.map(card));
    col.append(ul);
    return col;
  }

  function render() {
    const b = board();
    ensureGroups();
    settings();
    const all = people();
    const inGroup = (n) => all.filter((p) => coming(p) && placed(p.id) === n);
    const cols = b.groups.map((g) => {
      const list = inGroup(g.number).sort((a, x) => (a.id === g.lead ? -1 : x.id === g.lead ? 1 : a.id === g.sweep ? 1 : x.id === g.sweep ? -1 : nameOf(a).localeCompare(nameOf(x))));
      const over = list.length > g.target;
      return column({ n: g.number, group: g, title: `Group ${g.number}`, sub: `${list.length} of ${g.target}${over ? ", over" : ""}`, list });
    });
    const unassigned = all.filter((p) => coming(p) && !placed(p.id));
    cols.push(column({ n: null, title: "Unassigned", sub: `${unassigned.length}`, list: unassigned }));
    cols.push(column({ n: null, title: "Waiting", sub: "Invited and Maybe", list: all.filter(waiting), droppable: false }));
    $("gb-cols").replaceChildren(...cols);
    // Answers since the last arrange: "3 more going, unassigned".
    const late = b.arrangedAt ? unassigned.filter((p) => !(b.seen || []).includes(p.id)).length : 0;
    $("gb-late").hidden = !late;
    $("gb-late").textContent = late ? `${late} more going, unassigned. Move them into a group, or auto-arrange again.` : "";
    $("gb-move").replaceChildren(new Option("Move to…", ""), ...b.groups.map((g) => new Option(`Group ${g.number}`, String(g.number))), new Option("Unassigned", "none"));
    for (const id of [...selected]) if (!all.some((p) => p.id === id)) selected.delete(id);
    syncSelection();
  }

  // ── keys, the move menu, settings, exports ──
  $("gb-cols").addEventListener("keydown", (e) => {
    if (!selected.size || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key) && groupOf(Number(e.key))) {
      e.preventDefault();
      const ids = [...selected];
      selected.clear();
      move(ids, Number(e.key));
    } else if (e.key === "Escape" && !dnd.dragging) {
      selected.clear();
      syncSelection();
    }
  });
  // Dragging, by mouse or touch (drag.js): the selection moves together
  // when the card is part of it. Dropped where they all are already: nothing.
  const dnd = makeDraggable($("gb-cols"), {
    item: ".gb-card",
    zone: ".gb-col[data-group]",
    getIds: (id) => (selected.has(id) ? [...selected] : [id]),
    scrollers: [$("gb-cols")],
    onDrop: (ids, zoneEl) => {
      const n = zoneEl.dataset.group === "none" ? null : Number(zoneEl.dataset.group);
      if (ids.every((id) => placed(id) === n)) return;
      selected.clear();
      move(ids, n);
    },
  });
  $("gb-move").addEventListener("change", () => {
    const v = $("gb-move").value;
    if (!v) return;
    const ids = [...selected];
    selected.clear();
    move(ids, v === "none" ? null : Number(v));
  });
  $("gb-arrange").addEventListener("click", autoArrange);
  $("gb-count").addEventListener("change", () => setCount(Number($("gb-count").value) || 1));
  $("gb-target").addEventListener("change", () => {
    const b = board();
    b.settings.target = Math.max(1, Math.min(100, Number($("gb-target").value) || 10));
    for (const g of b.groups) g.target = b.settings.target;
    save();
    render();
  });
  $("gb-gap").addEventListener("change", () => {
    const b = board();
    b.settings.gapMinutes = Math.max(0, Math.min(60, Number($("gb-gap").value) || 0));
    b.groups.forEach((g, i) => (g.offset = i * b.settings.gapMinutes));
    save();
    render();
  });
  $("gb-first").addEventListener("change", () => { board().settings.firstTimers = Number($("gb-first").value); save(); render(); });
  $("gb-csv").addEventListener("click", () => download(csv(), `${(drive.name || "groups").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "groups"}-groups.csv`, "text/csv"));
  $("gb-print").addEventListener("click", printSheet);

  function rows() {
    const b = board();
    return b.groups.flatMap((g) => people().filter((p) => coming(p) && placed(p.id) === g.number)
      .sort((a, x) => nameOf(a).localeCompare(nameOf(x)))
      .map((p) => ({ g, p, role: g.lead === p.id ? "Lead" : g.sweep === p.id ? "Sweep" : "" })));
  }

  function csv() {
    const q = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
    const out = [["Group", "Leaves", "Role", "Name", "Email", "Car", "Style", "First time"].join(",")];
    for (const { g, p, role } of rows()) out.push([g.number, timeText(groupLeave(day().leave, g.offset)), role, p.name || "", p.email, p.car || "", STYLE_WORD[p.style] || "", p.first_timer ? "Yes" : ""].map(q).join(","));
    return out.join("\r\n") + "\r\n";
  }

  function download(text, name, type) {
    const a = el("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /// The check-in sheet: each group, its leave time, lead and sweep, and its
  /// people and cars, with a box to tick.
  function printSheet() {
    const b = board();
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const byId = new Map(drive.attendees.map((p) => [p.id, p]));
    const sections = b.groups.map((g) => {
      const list = rows().filter((r) => r.g === g);
      return `<section class="ck"><h2>Group ${g.number} · ${esc(STYLE_WORD[g.label] || "")} · leaves ${esc(timeText(groupLeave(day().leave, g.offset)))}</h2>`
        + `<p>Lead: ${esc(nameOf(byId.get(g.lead) || { email: "—" }))} · Sweep: ${esc(nameOf(byId.get(g.sweep) || { email: "—" }))} · ${list.length} cars</p>`
        + `<table><thead><tr><th></th><th>Name</th><th>Car</th><th></th></tr></thead><tbody>${list.map(({ p, role }) => `<tr><td class="box">☐</td><td>${esc(nameOf(p))}${p.first_timer ? " (first time)" : ""}</td><td>${esc(p.car || "")}</td><td>${esc(role)}</td></tr>`).join("")}</tbody></table></section>`;
    }).join("");
    $("printout").innerHTML = `<section class="pp"><h1>${esc(drive.name || "Group drive")}: check-in</h1>${sections}</section>`;
    window.addEventListener("afterprint", () => ($("printout").innerHTML = ""), { once: true });
    window.print();
  }

  return { render, autoArrange };
}

// ── The Groups step (the approved mock, 11/9; Mock-Decisions §4) ──
// The board in driving order: each group's Lead and Sweep stacked at
// the top with their tags, then its drivers; "Not in a group" first. Drag
// people between groups or onto a role (drag.js); remove a group with its
// × and a confirmation; Continue with people not in a group warns, with
// Sort them for me (arrange.js's style and first-timer rules, for them
// only). The step shell mounts it: initGroupsStep({ el, drive, save,
// section, go }) → { render, done, summary, leave }.

// Relays are out (Chris, 11/9): Lead and Sweep only.
export const ROLES = ["lead", "sweep"];
const ROLE_WORD = { lead: "Lead", sweep: "Sweep" };

/// A group's people in driving order: { lead, sweep, drivers }.
export function drivingOrder(group, members) {
  const byId = new Map(members.map((p) => [p.id, p]));
  const roles = Object.fromEntries(ROLES.map((r) => [r, byId.get(group[r]) || null]));
  const drivers = members.filter((p) => !ROLES.some((r) => group[r] === p.id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  return { ...roles, drivers };
}

/// People into group n (null: not in a group), as the organizer's moves; a
/// role holder moved away is no longer that group's.
export function moveTo(board, ids, n) {
  board.by ||= {};
  for (const id of ids) {
    if (n === null) delete board.placements[id];
    else board.placements[id] = n;
    board.by[id] = "organizer";
    for (const g of board.groups) for (const r of ROLES) if (g.number !== n && g[r] === id) g[r] = null;
  }
}

/// Someone takes a role in group n: out of any other role, into the group;
/// whoever had it stays on as a driver.
export function setRole(board, n, role, id) {
  for (const g of board.groups) for (const r of ROLES) if (g[r] === id) g[r] = null;
  const group = board.groups.find((g) => g.number === n);
  if (!group) return;
  group[role] = id;
  board.placements[id] = n;
  (board.by ||= {})[id] = "organizer";
}

/// Remove group n: its people back to "Not in a group", the groups after it
/// renumbered down and their leave times spaced again.
export function removeGroup(board, n) {
  const gap = board.settings?.gapMinutes ?? 10;
  board.groups = board.groups.filter((g) => g.number !== n);
  for (const [id, m] of Object.entries(board.placements)) {
    if (m === n) delete board.placements[id];
    else if (m > n) board.placements[id] = m - 1;
  }
  board.groups.forEach((g, i) => { g.number = i + 1; g.offset = i * gap; });
  const ft = board.settings?.firstTimers;
  if (ft === n) board.settings.firstTimers = null;
  else if (ft > n) board.settings.firstTimers = ft - 1;
}

/// One more group at the end, spaced like the rest.
export function addGroup(board) {
  const settings = { target: board.settings?.target ?? 10, gapMinutes: board.settings?.gapMinutes ?? 10 };
  const [g] = makeGroups(board.groups.length + 1, settings).slice(board.groups.length);
  board.groups.push(g);
  board.groups.forEach((x, i) => { x.offset = i * settings.gapMinutes; });
}

/// Sort the people not in a group by arrange.js's rules (style, first-timers,
/// pairs), leaving everyone placed where they are. → [{ id, n }] moved.
export function sortUngrouped(board, people) {
  const list = people.filter(coming).map((p) => ({ ...p, pinned: board.placements[p.id] ?? undefined }));
  const result = arrange(list, board.groups, { firstTimers: board.settings?.firstTimers || board.groups.length });
  const moved = [];
  board.by ||= {};
  for (const p of list) {
    if (p.pinned !== undefined) continue;
    const n = result.placements.get(p.id);
    if (!n) continue;
    board.placements[p.id] = n;
    board.by[p.id] = "auto";
    moved.push({ id: p.id, n });
  }
  return moved;
}

/// "Sorted 4 people: Ana to Group 2, Kim (first drive) to Group 4".
export function sortedWords(moved, people) {
  if (!moved.length) return "Nobody needed sorting.";
  const byId = new Map(people.map((p) => [p.id, p]));
  // First names, as the mock says them; the whole name when two share one.
  const first = (p) => String(nameOf(p)).split(/[\s@]/)[0];
  const firsts = moved.map(({ id }) => first(byId.get(id)));
  const said = (p) => (firsts.filter((f) => f === first(p)).length > 1 ? nameOf(p) : first(p));
  const parts = moved.map(({ id, n }) => `${said(byId.get(id))}${byId.get(id).first_timer ? " (first drive)" : ""} to Group ${n}`);
  return `Sorted ${moved.length === 1 ? "1 person" : `${moved.length} people`}: ${parts.join(", ")}`;
}

/// The day's groups as CSV rows: group, leaves, role, name, email, car,
/// style, first time; in driving order.
export function groupsCsv(board, people, dayLeave) {
  const q = (v) => (/[",\n]/.test(String(v ?? "")) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ""));
  const out = [["Group", "Leaves", "Role", "Name", "Email", "Car", "Style", "First time"].join(",")];
  for (const g of board.groups) {
    const o = drivingOrder(g, people.filter((p) => coming(p) && board.placements[p.id] === g.number));
    const rows = [...ROLES.map((r) => [o[r], ROLE_WORD[r]]).filter(([p]) => p), ...o.drivers.map((p) => [p, ""])];
    for (const [p, role] of rows) out.push([g.number, timeText(groupLeave(dayLeave, g.offset)), role, p.name || "", p.email, p.car || "", STYLE_WORD[p.style] || "", p.first_timer ? "Yes" : ""].map(q).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

/// The printable check-in sheet's HTML: each group, its leave time, its
/// lead and sweep, and its cars with a box to tick.
export function checkInHtml(name, board, people, dayLeave) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sections = board.groups.map((g) => {
    const o = drivingOrder(g, people.filter((p) => coming(p) && board.placements[p.id] === g.number));
    const rows = [...ROLES.map((r) => [o[r], ROLE_WORD[r]]).filter(([p]) => p), ...o.drivers.map((p) => [p, ""])];
    const roles = ROLES.map((r) => `${ROLE_WORD[r]}: ${esc(o[r] ? nameOf(o[r]) : "—")}`).join(" · ");
    return `<section class="ck"><h2>Group ${g.number} · ${esc(STYLE_WORD[g.label] || "")} · leaves ${esc(timeText(groupLeave(dayLeave, g.offset)))}</h2>`
      + `<p>${roles} · ${rows.length} cars</p>`
      + `<table><thead><tr><th></th><th>Name</th><th>Car</th><th></th></tr></thead><tbody>${rows.map(([p, role]) => `<tr><td class="box">☐</td><td>${esc(nameOf(p))}${p.first_timer ? " (first time)" : ""}</td><td>${esc(p.car || "")}</td><td>${esc(role)}</td></tr>`).join("")}</tbody></table></section>`;
  }).join("");
  return `<section class="pp"><h1>${esc(name || "Group drive")}: check-in</h1>${sections}</section>`;
}

const GRIP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';

export function initGroupsStep({ el, drive, save, section, go = () => {} }) {
  let dayIndex = null; // a day tab picked here; else the planner's active day
  let confirming = null; // a group number whose × was pressed
  let warning = null; // the step to go to after the ungrouped warning
  let said = "";
  const selected = new Set();
  const dayAt = () => Math.min(dayIndex ?? drive().active?.day ?? 0, drive().days.length - 1);
  const day = () => drive().days[dayAt()] || drive().days[0];
  const board = () => ((drive().boards ||= {})[day().id] ||= blankBoard());
  const onDay = (p) => !Array.isArray(p.days) || p.days.includes(day().id);
  const people = () => drive().attendees.filter((p) => p.status !== "no" && onDay(p));
  const placed = (id) => board().placements[id] ?? null;
  const ungrouped = () => people().filter((p) => coming(p) && !placed(p.id));
  const button = (text, cls, onClick) => { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", onClick); return b; };

  const root = el("div", "gs");
  section.replaceChildren(root);
  const cols = el("div", "gb-cols gs-cols");

  function ensureGroups() {
    const b = board();
    if (b.groups.length) return;
    const count = groupsNeeded(people().filter(coming).length, b.settings.target);
    b.groups = makeGroups(Math.max(2, count), b.settings);
  }
  const changed = (words = "") => { said = words; save(); render(); };

  function card(p, role = null) {
    const li = el("li", "gb-card gs-card");
    li.dataset.id = p.id;
    li.tabIndex = 0;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(selected.has(p.id)));
    const grip = el("span", "gb-grip");
    grip.innerHTML = GRIP;
    const words = el("span", "gs-words");
    if (role) words.append(el("span", `gs-rt ${role}`, ROLE_WORD[role]));
    words.append(el("b", "", nameOf(p)), el("small", "", [p.car, STYLE_WORD[p.style]].filter(Boolean).join(" · ")));
    li.append(grip, words);
    if (p.first_timer) li.append(el("span", "gs-f1", "1st"));
    li.setAttribute("aria-label", `${role ? `${ROLE_WORD[role]}: ` : ""}${nameOf(p)}${p.first_timer ? ", first drive" : ""}`);
    li.addEventListener("click", (e) => toggle(p.id, e.shiftKey || e.metaKey || e.ctrlKey));
    li.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(p.id, true); } });
    return li;
  }
  function toggle(id, add) {
    if (!add) { const only = selected.size === 1 && selected.has(id); selected.clear(); if (!only) selected.add(id); }
    else if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    for (const li of cols.querySelectorAll(".gb-card")) li.setAttribute("aria-selected", String(selected.has(li.dataset.id)));
  }

  function groupCol(g) {
    const b = board();
    const members = people().filter((p) => coming(p) && placed(p.id) === g.number);
    const order = drivingOrder(g, members);
    const col = el("section", "gb-col gs-col");
    col.setAttribute("aria-label", `Group ${g.number}`);
    const head = el("div", "gs-head");
    head.append(el("b", "", `Group ${g.number}`), el("span", "gs-count", `${members.length} ${members.length === 1 ? "car" : "cars"}`));
    const x = button("×", "gs-rm", () => { confirming = g.number; render(); });
    x.setAttribute("aria-label", `Remove Group ${g.number}`);
    head.append(x);
    col.append(head);
    if (confirming === g.number) {
      const cf = el("div", "gs-cf");
      cf.setAttribute("role", "alertdialog");
      cf.setAttribute("aria-label", `Remove Group ${g.number}?`);
      cf.append(el("b", "", `Remove Group ${g.number}?`), el("span", "", `Its ${members.length} ${members.length === 1 ? "car goes" : "cars go"} back to "Not in a group".`));
      const row = el("div", "gs-cfb");
      row.append(button("Remove", "pill small gs-cfy", () => {
        removeGroup(b, g.number);
        confirming = null;
        changed(`Group ${g.number} removed. Its people are in "Not in a group".`);
      }), button("Cancel", "pill grey small", () => { confirming = null; render(); }));
      cf.append(row);
      col.append(cf);
    }
    const meta = el("div", "gs-meta");
    const style = el("select", "gs-sty");
    style.setAttribute("aria-label", `Group ${g.number}'s style`);
    style.append(...Object.entries(STYLE_WORD).map(([k, v]) => new Option(v, k)));
    style.value = g.label || "touring";
    style.addEventListener("change", () => { g.label = style.value; save(); });
    const leave = el("input", "gs-leave");
    leave.type = "time";
    leave.step = 300;
    leave.value = groupLeave(day().leave, g.offset) || "";
    leave.setAttribute("aria-label", `Group ${g.number} leaves at`);
    leave.addEventListener("change", () => {
      const [h, m] = leave.value.split(":").map(Number);
      const [dh, dm] = String(day().leave).split(":").map(Number);
      if ([h, m, dh, dm].every(Number.isFinite)) g.offset = h * 60 + m - (dh * 60 + dm);
      save();
    });
    meta.append(style, leave);
    col.append(meta);
    for (const role of ROLES) {
      const slot = el("div", "gs-slot");
      slot.dataset.group = String(g.number);
      slot.dataset.role = role;
      if (order[role]) {
        const ul = el("ul", "gs-list");
        ul.append(card(order[role], role));
        slot.append(ul);
      } else slot.append(el("span", "gs-empty", `Drop a ${role} here`));
      col.append(slot);
    }
    col.append(el("div", "gs-gap", "Drivers"));
    const drivers = el("ul", "gs-list gs-drivers");
    drivers.dataset.group = String(g.number);
    drivers.setAttribute("aria-label", `Group ${g.number}'s drivers`);
    drivers.append(...order.drivers.map((p) => card(p)));
    col.append(drivers);
    return col;
  }

  function render() {
    const d = drive();
    ensureGroups();
    const b = board();
    const parts = [];
    const top = el("div", "gs-top");
    const words = el("div", "gs-title");
    words.append(el("h2", "", "Groups"), el("p", "gs-lede", `Drag people between groups, or onto Lead or Sweep at the top of a group. Group 1 leaves first. First-timers go in Group ${b.settings.firstTimers || b.groups.length}.`));
    top.append(words, button("+ Add a group", "pill grey", () => { addGroup(b); changed(`Group ${b.groups.length} added.`); }),
      button("Sort for me", "pill green", () => changed(sortedWords(sortUngrouped(b, people()), people()))));
    parts.push(top);
    if (d.days.length > 1) {
      const tabs = el("div", "gs-days");
      tabs.setAttribute("role", "tablist");
      d.days.forEach((x, i) => {
        const t = button(`Day ${i + 1}`, `pill small ${i === dayAt() ? "green" : "grey"}`, () => { dayIndex = i; selected.clear(); render(); });
        t.setAttribute("role", "tab");
        t.setAttribute("aria-selected", String(i === dayAt()));
        tabs.append(t);
      });
      parts.push(tabs);
    }
    if (said) parts.push(el("p", "gs-said", said));
    // Not in a group, then the groups, then the invited and maybes (not yet coming).
    const un = el("section", "gb-col gs-col gs-un");
    un.setAttribute("aria-label", "Not in a group");
    const uh = el("div", "gs-head");
    uh.append(el("b", "", "Not in a group"), el("span", "gs-count", String(ungrouped().length)));
    const ul = el("ul", "gs-list gs-drivers");
    ul.dataset.group = "none";
    ul.append(...ungrouped().sort((a, x) => nameOf(a).localeCompare(nameOf(x))).map((p) => card(p)));
    un.append(uh, ul);
    const later = people().filter(waiting);
    const wait = el("section", "gb-col gs-col gs-wait");
    wait.setAttribute("aria-label", "Not answered yet");
    const wh = el("div", "gs-head");
    wh.append(el("b", "", "Not answered yet"), el("span", "gs-count", String(later.length)));
    const wl = el("ul", "gs-list");
    wl.append(...later.map((p) => card(p)));
    wait.append(wh, wl);
    cols.replaceChildren(un, ...b.groups.map(groupCol), ...(later.length ? [wait] : []));
    parts.push(cols);
    // Settings and the sheets, out of the way.
    const more = el("details", "gs-more");
    more.append(el("summary", "", "Group settings, CSV and check-in sheet"));
    const row = el("div", "gs-settings");
    const num = (label, value, min, max, set) => {
      const l = el("label", "");
      const i = el("input", "field gb-num");
      i.type = "number"; i.min = String(min); i.max = String(max); i.value = String(value);
      i.addEventListener("change", () => { set(Math.max(min, Math.min(max, Number(i.value) || min))); save(); render(); });
      l.append(label, " ", i);
      return l;
    };
    row.append(num("Cars per group", b.settings.target, 1, 100, (v) => { b.settings.target = v; for (const g of b.groups) g.target = v; }),
      num("Minutes apart", b.settings.gapMinutes, 0, 60, (v) => { b.settings.gapMinutes = v; b.groups.forEach((g, i) => (g.offset = i * v)); }));
    const ftl = el("label", "");
    const ft = el("select", "field");
    ft.append(...b.groups.map((g) => new Option(`Group ${g.number}`, String(g.number))));
    ft.value = String(b.settings.firstTimers || b.groups.length);
    ft.addEventListener("change", () => { b.settings.firstTimers = Number(ft.value); save(); render(); });
    ftl.append("First-timers go in ", ft);
    row.append(ftl, button("Re-arrange everyone", "pill grey small", () => {
      const list = people().filter(coming).map((p) => ({ ...p, pinned: p.pinned || b.by?.[p.id] === "organizer" ? placed(p.id) ?? undefined : undefined }));
      const result = arrange(list, b.groups, { firstTimers: b.settings.firstTimers || b.groups.length });
      b.placements = Object.fromEntries(result.placements);
      b.arrangedAt = Date.now();
      changed(`Arranged ${list.length} ${list.length === 1 ? "car" : "cars"} into ${b.groups.length} groups.`);
    }));
    const sheets = el("div", "gs-settings");
    sheets.append(button("Download CSV", "pill grey small", () => {
      const a = el("a");
      a.href = URL.createObjectURL(new Blob([groupsCsv(b, people(), day().leave)], { type: "text/csv" }));
      a.download = `${(d.name || "groups").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "groups"}-groups.csv`;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }), button("Print the check-in sheet", "pill grey small", () => {
      let out = document.getElementById("printout");
      if (!out) { out = el("div"); out.id = "printout"; document.body.append(out); }
      out.innerHTML = checkInHtml(d.name, b, people(), day().leave);
      window.addEventListener("afterprint", () => (out.innerHTML = ""), { once: true });
      window.print();
    }));
    more.append(row, sheets);
    parts.push(more);
    if (warning) parts.push(warnBox());
    root.replaceChildren(...parts);
  }

  function warnBox() {
    const n = ungrouped().length;
    const ov = el("div", "gs-ov");
    const dlg = el("div", "gs-dlg");
    dlg.setAttribute("role", "alertdialog");
    dlg.setAttribute("aria-label", "People not in a group");
    dlg.append(el("b", "", `${n} ${n === 1 ? "person isn't" : "people aren't"} in a group yet`),
      el("span", "", `They'd get the route without a group, lead or sweep. Want Carve to sort them? It follows your rules: driving style, and first-timers in Group ${board().settings.firstTimers || board().groups.length}.`));
    const row = el("div", "gs-dlgb");
    row.append(button("Sort them for me", "pill green", () => { warning = null; changed(sortedWords(sortUngrouped(board(), people()), people())); }),
      button("Continue anyway", "pill grey", () => { const next = warning; warning = null; render(); go(next, { force: true }); }),
      button("Go back", "textlink", () => { warning = null; render(); }));
    dlg.append(row);
    ov.append(dlg);
    return ov;
  }

  // Dragging (drag.js): onto a role slot, or into a group's drivers.
  makeDraggable(cols, {
    item: ".gb-card",
    zone: ".gs-slot[data-group], .gs-drivers[data-group]",
    handle: ".gb-grip",
    getIds: (id) => (selected.has(id) ? [...selected] : [id]),
    scrollers: [cols],
    onDrop: (ids, zoneEl) => {
      const b = board();
      const n = zoneEl.dataset.group === "none" ? null : Number(zoneEl.dataset.group);
      const role = zoneEl.dataset.role || null;
      selected.clear();
      if (role && n !== null) {
        setRole(b, n, role, ids[0]);
        if (ids.length > 1) moveTo(b, ids.slice(1), n);
        return changed();
      }
      if (ids.every((id) => placed(id) === n && !b.groups.some((g) => ROLES.some((r) => g[r] === id)))) return;
      // Dropped among the drivers: off any role, into the group.
      for (const g of b.groups) for (const r of ROLES) if (ids.includes(g[r])) g[r] = null;
      moveTo(b, ids, n);
      changed();
    },
  });
  // Keys: a selection and a group's number moves them; Escape clears.
  cols.addEventListener("keydown", (e) => {
    if (!selected.size || e.metaKey || e.ctrlKey || e.altKey) return;
    const b = board();
    if (/^[1-9]$/.test(e.key) && b.groups.some((g) => g.number === Number(e.key))) {
      e.preventDefault();
      const ids = [...selected];
      selected.clear();
      moveTo(b, ids, Number(e.key));
      changed(`Moved ${ids.length === 1 ? nameOf(drive().attendees.find((p) => p.id === ids[0])) : `${ids.length} people`} to Group ${e.key}.`);
    } else if (e.key === "Escape") { selected.clear(); render(); }
  });

  render();
  return {
    render,
    done: () => board().groups.length > 0 && people().some(coming) && !ungrouped().length,
    summary: () => `${board().groups.length} groups · ${people().filter(coming).length} people`,
    /// Continue with people not in a group: the warning first.
    leave: (next) => {
      if (!ungrouped().length) return true;
      warning = next;
      render();
      return false;
    },
  };
}
