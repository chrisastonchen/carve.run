// Groups by driving style (Club-Sprint-Requirements.md §2, GGR's rules; the
// order of precedence is Product's answer 1 of 11/8). Pure: the Groups step
// runs it in the browser and the server keeps the result
// (drive_groups_set).
//
// Groups are numbered; lower numbers leave first and drive more briskly.
// Auto-arrange, highest rule first:
//   1. The organizer's explicit choices: leads and sweeps, pins, and an
//      imported group column. They beat every rule. A first-timer placed
//      outside the first-timers group by one of these gets a warning.
//   2. First-timers go to the first-timers group.
//   3. "With" pairs stay together; a pair with a first-timer goes into the
//      first-timers group together; otherwise the pair takes the more
//      relaxed of their two styles.
//   4. Driving style: Spirited into the lowest numbers, then Touring, then
//      Relaxed. A group's label is a hint: Spirited drivers who don't fit
//      Group 1 spill into Group 2 even if it's labelled Touring.
// Group sizes stay within the target where they can; nobody is left out.

export const STYLE_ORDER = { spirited: 0, touring: 1, relaxed: 2 };
const unknownStyle = 1; // no style given: Touring, the middle

/// N groups, numbered from 1, labelled Spirited → Relaxed across them.
export function makeGroups(count, { target = 10, gapMinutes = 10 } = {}) {
  const labels = ["spirited", "touring", "relaxed"];
  return Array.from({ length: count }, (_, i) => ({
    number: i + 1,
    label: labels[Math.min(labels.length - 1, Math.floor((i * labels.length) / Math.max(1, count)))],
    target,
    offset: i * gapMinutes,
    lead: null,
    sweep: null,
  }));
}

/// How many groups the going people need at this size.
export const groupsNeeded = (people, target = 10) => Math.max(1, Math.ceil(people / Math.max(1, target)));

const styleRank = (p) => (p.style in STYLE_ORDER ? STYLE_ORDER[p.style] : unknownStyle);

/// Who's placed where. `people`: [{ id, email, style?, first_timer?, with?: [email],
/// group? (imported number), pinned? (number), experienced? }]. `groups`
/// from makeGroups (with lead / sweep person ids). `firstTimers`: the
/// first-timers group's number (default the last). → { placements: Map(id →
/// number), warnings: Map(id → text), over: [numbers over target] }
export function arrange(people, groups, { firstTimers = groups.length } = {}) {
  const placements = new Map();
  const warnings = new Map();
  const numbers = new Set(groups.map((g) => g.number));
  const size = (n) => [...placements.values()].filter((x) => x === n).length;
  const target = (n) => groups.find((g) => g.number === n)?.target ?? 10;
  const ftGroup = numbers.has(firstTimers) ? firstTimers : groups[groups.length - 1]?.number;
  const byEmail = new Map(people.map((p) => [String(p.email || "").toLowerCase(), p]));

  // 1 · Explicit choices: leads and sweeps, pins, imported groups.
  for (const g of groups) {
    for (const id of [g.lead, g.sweep]) if (id && people.some((p) => p.id === id)) placements.set(id, g.number);
  }
  for (const p of people) {
    if (placements.has(p.id)) continue;
    const fixed = numbers.has(p.pinned) ? p.pinned : numbers.has(p.group) ? p.group : null;
    if (fixed) placements.set(p.id, fixed);
  }
  for (const p of people) {
    if (p.first_timer && placements.has(p.id) && placements.get(p.id) !== ftGroup) {
      warnings.set(p.id, `First-timer, not in Group ${ftGroup}`);
    }
  }

  // Pairs: each unplaced person with their unplaced "with" partners, as one unit.
  const units = [];
  const inUnit = new Set();
  for (const p of people) {
    if (placements.has(p.id) || inUnit.has(p.id)) continue;
    const unit = [p];
    inUnit.add(p.id);
    // Partners either way round, transitively.
    for (let i = 0; i < unit.length; i++) {
      const q = unit[i];
      const mine = (q.with || []).map((e) => byEmail.get(String(e).toLowerCase())).filter(Boolean);
      const theirs = people.filter((o) => (o.with || []).some((e) => String(e).toLowerCase() === String(q.email || "").toLowerCase()));
      for (const o of [...mine, ...theirs]) {
        if (!inUnit.has(o.id) && !placements.has(o.id)) { unit.push(o); inUnit.add(o.id); }
      }
    }
    units.push(unit);
  }
  // A pair partly placed already (one of them pinned): the rest join them.
  for (const unit of units) {
    const anchor = unit.flatMap((q) => [...(q.with || []).map((e) => byEmail.get(String(e).toLowerCase())), ...people.filter((o) => (o.with || []).some((e) => String(e).toLowerCase() === String(q.email || "").toLowerCase()))])
      .find((o) => o && placements.has(o.id));
    if (anchor) unit.anchor = placements.get(anchor.id);
  }

  // 2 + 3 · First-timers (with their pairs) to the first-timers group.
  const rest = [];
  for (const unit of units) {
    if (unit.anchor) { for (const q of unit) placements.set(q.id, unit.anchor); continue; }
    if (ftGroup && unit.some((q) => q.first_timer)) { for (const q of unit) placements.set(q.id, ftGroup); continue; }
    rest.push(unit);
  }

  // 4 · Style: the most spirited first into the lowest numbers, pairs at the
  // more relaxed of their styles, filling each group to its target.
  rest.sort((a, b) => Math.max(...a.map(styleRank)) - Math.max(...b.map(styleRank)) || b.length - a.length);
  // In order: each unit goes to the lowest-numbered group from the last one
  // filled that still has room for all of it, so the groups fill one after
  // another from Group 1 and nobody more spirited lands behind someone
  // more relaxed.
  const order = groups.map((g) => g.number).filter((n) => n !== ftGroup || groups.length === 1);
  let at = 0;
  for (const unit of rest) {
    const fits = (n) => size(n) + unit.length <= target(n);
    let i = order.findIndex((n, k) => k >= at && fits(n));
    if (i < 0) {
      // Everything after is full: the group with the most room, past its target.
      const n = [...order].sort((a, b) => (target(b) - size(b)) - (target(a) - size(a)) || a - b)[0] ?? ftGroup;
      for (const q of unit) placements.set(q.id, n);
      continue;
    }
    at = i;
    for (const q of unit) placements.set(q.id, order[i]);
  }
  const over = groups.filter((g) => size(g.number) > g.target).map((g) => g.number);
  return { placements, warnings, over };
}

/// A group's leave time, as "HH:MM": the day's leave time plus its offset.
export function groupLeave(dayLeave, offsetMinutes) {
  const [h, m] = String(dayLeave || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const t = h * 60 + m + (offsetMinutes || 0);
  return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
