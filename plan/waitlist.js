// The waitlist on the Attendees step (the user, 11/8 late: spots and
// waitlists on every paid plan): per day, in order, with its count;
// reorder by drag (or the arrow buttons), Promote, Promote next, Remove,
// and "1 spot open" when someone drops. The order and the actions are the
// server's (0068: drive_waitlists, drive_waitlist_order, _promote,
// _promote_next, _remove); this module is the pure part.
// scripts/plan-tests/waitlist.test.mjs.

/// The day's waitlist, in order: [{ id, name, email, position }].
export function waitlistFor(attendees, dayId) {
  return attendees
    .filter((p) => Array.isArray(p.waitlisted) && p.waitlisted.includes(dayId))
    .map((p) => ({ id: p.id, name: p.name || "", email: p.email, position: p.waitlistAt?.[dayId] ?? null }))
    .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.email.localeCompare(b.email));
}

/// The ids in their new order after moving one from `from` to `to`.
export function moved(list, from, to) {
  const ids = list.map((p) => p.id);
  if (from === to || from < 0 || from >= ids.length) return ids;
  const [id] = ids.splice(from, 1);
  ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id);
  return ids;
}

/// Spots open on a day: its limit less who's going; none without a limit.
export const openSpots = (limit, going) => (Number.isInteger(limit) ? Math.max(0, limit - going) : 0);

export const waitingText = (n) => (n === 1 ? "1 waiting" : `${n} waiting`);
export const openText = (n) => (n === 1 ? "1 spot open" : `${n} spots open`);

/// A person's place line: "#1 · Maya Chen".
export const placeText = (p, i) => `#${p.position ?? i + 1} · ${p.name || p.email}`;

/// From drive_get: each attendee's waitlisted days and places, as the
/// draft keeps them (drive-sync.js fromServer).
export function waitlistFields(serverDays = []) {
  const waitlisted = serverDays.filter((x) => x.waitlisted).map((x) => x.day_id);
  if (!waitlisted.length) return {};
  const waitlistAt = Object.fromEntries(serverDays.filter((x) => x.waitlisted && Number.isInteger(x.waitlist_position)).map((x) => [x.day_id, x.waitlist_position]));
  return { waitlisted, ...(Object.keys(waitlistAt).length ? { waitlistAt } : {}) };
}

/// From drive_waitlists (0068): each day's { limit, coming, open } by day,
/// and each person's places by day.
export function fromWaitlists(rows = []) {
  const days = {}, places = {};
  for (const r of rows) {
    days[r.day_id] = { limit: r.limit ?? null, coming: r.coming ?? 0, open: r.open ?? null };
    for (const x of r.waiting || []) (places[x.attendee_id] ||= {})[r.day_id] = x.position;
  }
  return { days, places };
}
