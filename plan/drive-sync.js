// The group drive's browser draft, uploaded through App Dev's calls
// (docs/Club-Server-Contract.md on club-server, sections 2–4): the drive,
// its days, map notes, attendees, each day's routes and each day's board.
// The mapping is pure and tested; syncDrive runs it with the page's rpc and
// a saveRoute that saves a leg's plan as the organizer's own route.

import { waitlistFields } from "./waitlist.js";
import { driveChanges } from "./versions.js";

export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/// A day as drive_day_put takes it.
export function dayArg(day) {
  return {
    id: day.id, date: day.date, meet: day.meet, leave: day.leave,
    place: day.place ? { name: day.place.label || "", lat: day.place.lat, lon: day.place.lon } : null,
    // Blank: the plan's cap (null).
    spots: Number.isInteger(day.spots) && day.spots > 0 ? day.spots : null,
    // What invited people see instead of the place (11/8 late).
    meet_city: day.city || null,
  };
}

/// Each day's pre-run date as drive_prerun_days_set takes it: { day id:
/// "2026-12-05" }, null for the week before.
export const prerunDatesArg = (drive) => Object.fromEntries(drive.days.map((d) => [d.id, drive.prerun?.dates?.[d.id] || null]));

/// A map note as drive_note_put takes it.
export const noteArg = (n) => ({ id: n.id, day_id: n.day_id, lat: n.lat, lon: n.lon, label: n.label || "" });

/// The attendees as drive_attendees_add's rows, by source (typed or pasted
/// email, an imported list, the club's members). No phone numbers exist to
/// send.
export function peopleArgs(attendees) {
  const by = { email: [], import: [], club: [] };
  for (const p of attendees) {
    const source = by[p.source] ? p.source : p.status === "registered" ? "import" : "email";
    const row = { id: p.id, email: p.email };
    for (const k of ["name", "car", "style"]) if (p[k]) row[k] = p[k];
    // The organizer's only (0081): never in views, emails or the apps.
    for (const k of ["phone", "registered_at"]) if (p[k]) row[k] = p[k];
    if (typeof p.first_timer === "boolean") row.first_timer = p.first_timer;
    // Registered or invited, from any source (the user, 11/8 late): always said.
    row.status = p.status === "registered" || p.status === "going" || p.status === "maybe" || p.status === "no" ? p.status : "invited";
    if (Number.isInteger(p.group)) row.group = p.group;
    if (Array.isArray(p.with) && p.with.length) row.with = p.with;
    by[source].push(row);
  }
  return by;
}

/// A day's board as drive_groups_set's p_groups and p_placements. `ids`
/// turns a browser attendee id into the server's (the same, once the
/// server keeps them). Who placed each person: the import's group column
/// (pinned), the organizer (moves, leads, sweeps, pins), or auto-arrange.
export function groupsArgs(board, attendees, ids = (x) => x) {
  const byId = new Map(attendees.map((p) => [p.id, p]));
  const p_groups = (board.groups || []).map((g) => ({
    number: g.number,
    label: g.label || null,
    target: g.target,
    offset: g.offset,
    lead_id: g.lead && byId.has(g.lead) ? ids(g.lead) : null,
    sweep_id: g.sweep && byId.has(g.sweep) ? ids(g.sweep) : null,
  }));
  const numbers = new Set(p_groups.map((g) => g.number));
  const leads = new Set((board.groups || []).flatMap((g) => [g.lead, g.sweep]).filter(Boolean));
  const p_placements = Object.entries(board.placements || {})
    .filter(([id, n]) => byId.has(id) && numbers.has(n))
    .map(([id, n]) => {
      const p = byId.get(id);
      // The import's group column, here or as the server had it.
      const imported = (Number.isInteger(p.group) && p.group === n) || board.by?.[id] === "import";
      const organizer = leads.has(id) || p.pinned || board.by?.[id] === "organizer";
      return {
        attendee_id: ids(id),
        group: n,
        ...(imported || p.pinned ? { pinned: true } : {}),
        by: imported ? "import" : organizer ? "organizer" : "auto",
      };
    });
  return { p_groups, p_placements };
}

/// Upload the draft. `rpc(name, args)` is the page's; `saveRoute(plan, label)`
/// saves a leg's plan as the organizer's route and gives { route_id,
/// share_token, plan } (the plan with its new id and token). Remembers
/// what the server has (drive.synced) so removals go too. `push` (drive-
/// merge.js's parts, e.g. "day:<id>") sends only those; null sends it all.
/// For people the server has, `updates` (id → changed fields) goes through
/// drive_attendee_update, and only `readd` (pairs changed) are added again.
/// → the drive as drive_get gives it.
export async function syncDrive(drive, { rpc, saveRoute, orgId, club = false, timeZone = browserZone(), push = null, updates = null, readd = null }) {
  const synced = (drive.synced ||= { created: false, days: [], notes: [], attendees: [] });
  const sends = (part) => !push || push.has(part);
  if (!synced.created) {
    await rpc("drive_create", { p_org_id: orgId, p_name: drive.name || "Group drive", p_time_zone: timeZone, p_id: drive.id });
    synced.created = true;
  }
  // The description, and what changed since the pre-run for leads' and
  // sweeps' route email (App Dev's); drive_create takes the name only.
  // Only the keys that changed: drive_update leaves out the rest. The
  // registered answer too (QA S3, 11/9).
  const changes = driveChanges(drive);
  const patch = {
    ...(sends("drive:name") ? { name: drive.name || "Group drive" } : {}),
    ...(sends("drive:description") ? { description: drive.description || null } : {}),
    ...(sends("drive:registered") && typeof drive.registered === "boolean" ? { registered: drive.registered } : {}),
    ...(changes.length ? { prerun_changes: changes } : {}),
  };
  if (Object.keys(patch).length) await rpc("drive_update", { p_drive_id: drive.id, p_patch: patch });
  // Days: removed ones first, then each in order (a new day goes last).
  const daysGone = synced.days.filter((id) => !drive.days.some((d) => d.id === id) && sends(`day:${id}`));
  for (const id of daysGone) await rpc("drive_day_delete", { p_day_id: id });
  for (const d of drive.days) if (sends(`day:${d.id}`)) await rpc("drive_day_put", { p_drive_id: drive.id, p_day: dayArg(d) });
  synced.days = [...new Set([...drive.days.map((d) => d.id), ...synced.days.filter((id) => !daysGone.includes(id))])];
  // The pre-run (Club): on unless the When step says No, as it shows it.
  // After the days (drive_prerun_set refuses a drive with none), and
  // whenever the server differs: a new Club drive starts with it off.
  // Then each day's date (0071), unset being the week before. The crew
  // stays the drive page's.
  const prerunOn = club && drive.prerun?.on !== false;
  // A day without a date can't place it yet: next save.
  const dated = drive.days.length > 0 && drive.days.every((d) => d.date);
  if (dated && (drive.prerun?.dirty || prerunOn !== !!synced.prerun)) {
    if (prerunOn) {
      await rpc("drive_prerun_set", { p_drive_id: drive.id, p_date: drive.prerun?.dates?.[drive.days[0]?.id] || null, p_off: false });
      await rpc("drive_prerun_days_set", { p_drive_id: drive.id, p_dates: prerunDatesArg(drive) });
    } else if (synced.prerun || drive.prerun?.dirty) {
      await rpc("drive_prerun_set", { p_drive_id: drive.id, p_date: null, p_off: true });
    }
    synced.prerun = prerunOn;
    if (drive.prerun) drive.prerun.dirty = false;
  }
  // Each day's routes: its legs, saved as the organizer's own routes.
  for (const d of drive.days) {
    if (!sends(`routes:${d.id}`)) continue;
    const routes = [];
    for (const leg of d.legs || []) {
      if (!leg.plan?.path) continue;
      const saved = await saveRoute(leg.plan, leg.label);
      leg.plan = saved.plan;
      routes.push({ route_id: saved.route_id, share_token: saved.share_token, label: leg.label || null });
    }
    await rpc("drive_day_routes_set", { p_day_id: d.id, p_routes: routes });
  }
  // Map notes.
  const notesGone = synced.notes.filter((id) => !drive.notes.some((n) => n.id === id) && sends(`note:${id}`));
  for (const id of notesGone) await rpc("drive_note_delete", { p_note_id: id });
  for (const n of drive.notes) if (sends(`note:${n.id}`)) await rpc("drive_note_put", { p_drive_id: drive.id, p_note: noteArg(n) });
  synced.notes = [...new Set([...drive.notes.map((n) => n.id), ...synced.notes.filter((id) => !notesGone.includes(id))])];
  // Attendees: removed ones, then everyone by source (the server merges).
  const gone = synced.attendees.filter((id) => !drive.attendees.some((p) => p.id === id) && sends(`att:${id}`));
  if (gone.length) await rpc("drive_attendees_remove", { p_attendee_ids: gone });
  const kept = new Map();
  const onServer = new Set(push ? synced.attendees : []);
  const adding = drive.attendees.filter((p) => sends(`att:${p.id}`) && (!onServer.has(p.id) || readd?.has(p.id)));
  for (const [source, people] of Object.entries(peopleArgs(adding))) {
    if (!people.length) continue;
    const answer = await rpc("drive_attendees_add", { p_drive_id: drive.id, p_people: people, p_source: source });
    for (const [given, server] of Object.entries(answer?.ids || {})) kept.set(given, server);
  }
  for (const [id, patch] of updates || []) if (drive.attendees.some((p) => p.id === id)) await rpc("drive_attendee_update", { p_attendee_id: id, p_patch: patch });
  synced.attendees = [...new Set([...drive.attendees.map((p) => p.id), ...synced.attendees.filter((id) => !gone.includes(id))])];
  const ids = (id) => kept.get(id) || id;
  // Each day's board.
  for (const d of drive.days) {
    const board = drive.boards?.[d.id];
    if (!board?.groups?.length || !sends(`board:${d.id}`)) continue;
    const people = drive.attendees.filter((p) => !Array.isArray(p.days) || p.days.includes(d.id));
    const { p_groups, p_placements } = groupsArgs(board, people, ids);
    await rpc("drive_groups_set", { p_day_id: d.id, p_groups, p_placements });
  }
  const got = await rpc("drive_get", { p_drive_id: drive.id });
  if (got && "prerun" in got) synced.prerun = !!got.prerun;
  return got;
}

/// The other way: a drive on the server as the browser's draft, to carry
/// on in another browser or as a co-organizer. `got` is drive_get's,
/// `versions` drive_route_versions's (0071), `routes` drive_routes's ([{day_id, position, route_id, share_token,
/// label, yours, payload}]), `planOf(payload)` the planner's own reading
/// of a route. A route that isn't yours keeps where it came from
/// (driveRoute): saving edits it in place when the server allows, else
/// makes it yours (contract §2). `newId` makes the legs' ids.
export function driveFromServer(got, routes, { planOf, userId, versions = [], newId = () => crypto.randomUUID() }) {
  const emailOf = new Map((got.attendees || []).map((a) => [a.id, a.email]));
  const settings = got.settings || {};
  const days = (got.days || []).map((d) => {
    const legs = (routes || [])
      .filter((r) => r.day_id === d.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => {
        const plan = planOf(r.payload || {});
        // Another organizer's: saved through drive_route_update to keep its
        // link (0071), else as your own copy (a stranger's).
        const mine = r.yours ? { id: String(r.route_id).toUpperCase(), token: r.share_token, createdAt: r.payload?.createdAt ?? null, ownerId: userId }
          : { id: null, token: null, ownerId: null, createdAt: r.payload?.createdAt ?? null, driveRoute: { id: String(r.route_id).toLowerCase(), token: r.share_token } };
        // Changed since the pre-run: version 1, for the map and what changed.
        const v = (versions || []).find((x) => x.day_id === r.day_id && x.route_id === r.route_id && x.changed && x.v1?.payload);
        return { id: newId(), label: r.label || "", plan: { ...plan, ...mine }, ...(v ? { v1: planOf(v.v1.payload) } : {}) };
      });
    return {
      id: d.id, date: d.date, meet: d.meet, leave: d.leave,
      place: d.place ? { label: d.place.name || "", lat: d.place.lat, lon: d.place.lon } : null,
      spots: Number.isInteger(d.spots) ? d.spots : null,
      ...(d.meet_city ? { city: d.meet_city, cityTyped: true } : {}),
      legs: legs.length ? legs : [{ id: newId(), label: "", plan: null }],
    };
  });
  const pinned = new Set();
  const boards = {};
  for (const d of got.days || []) {
    if (!d.groups?.length) continue;
    const placements = {};
    const by = {};
    for (const p of d.placements || []) {
      if (p.group == null) continue;
      placements[p.attendee_id] = p.group;
      // Who placed them goes back unchanged: the organizer, or the import.
      if (p.by === "organizer" || p.by === "import") by[p.attendee_id] = p.by;
      if (p.pinned) pinned.add(p.attendee_id);
    }
    boards[d.id] = {
      groups: d.groups.map((g) => ({ number: g.number, label: g.label || null, target: g.target, offset: g.offset ?? 0, lead: g.lead_id || null, sweep: g.sweep_id || null })),
      placements, by,
      settings: { target: settings.group_target ?? 10, gapMinutes: settings.group_gap_minutes ?? 10, firstTimers: settings.first_timers_group ?? null },
      arrangedAt: null,
    };
  }
  const attendees = (got.attendees || []).map((a) => {
    const p = { id: a.id, email: a.email, status: a.status, source: a.source || "email" };
    for (const k of ["name", "car", "style", "phone", "registered_at"]) if (a[k]) p[k] = a[k];
    if (typeof a.first_timer === "boolean") p.first_timer = a.first_timer;
    if (a.experienced) p.experienced = true;
    const on = (a.days || []).filter((x) => x.coming).map((x) => x.day_id);
    if (a.days?.length && on.length < days.length) p.days = on;
    const with_ = (got.pairs || []).filter((pair) => pair.includes(a.id)).map((pair) => emailOf.get(pair[0] === a.id ? pair[1] : pair[0])).filter(Boolean);
    if (with_.length) p.with = with_;
    if (pinned.has(a.id)) p.pinned = true;
    // Waitlisted days and places (spots and waitlists, 11/8 late).
    Object.assign(p, waitlistFields(a.days || []));
    return p;
  });
  return {
    id: got.id, name: got.name || "", orgId: got.org_id, description: got.description || "",
    ...(typeof got.registered === "boolean" ? { registered: got.registered } : {}),
    days, attendees, boards,
    // The server's pre-run: on (its first day's date) or off.
    prerun: { on: !!got.prerun, dates: got.prerun?.date && days[0] ? { [days[0].id]: got.prerun.date } : {} },
    notes: (got.notes || []).filter((n) => n.kind !== "prerun").map((n) => ({ id: n.id, day_id: n.day_id, lat: n.lat, lon: n.lon, label: n.label || "" })),
    synced: { created: true, prerun: !!got.prerun, days: days.map((d) => d.id), notes: (got.notes || []).filter((n) => n.kind !== "prerun").map((n) => n.id), attendees: attendees.map((p) => p.id) },
    active: { day: 0, leg: 0 }, step: "page", updatedAt: Date.now(),
  };
}
