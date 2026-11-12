// The browser's draft against the server's drive (QA S2, 11/9): co-
// organizers, invited people answering and other devices all change the
// drive, so the draft keeps `base`, each part as the server last had it.
// Before a save the page reads the drive again and, part by part:
//   unchanged here, changed there  → take the server's;
//   changed here, unchanged there  → send this browser's;
//   changed on both                → ask: Keep theirs or Use mine.
// An attendee's part is the server's on a clash: an answer is the person's
// own. Parts are compared as strings that survive the round trip.

import { dayArg, groupsArgs, noteArg, syncDrive } from "./drive-sync.js?v=2";

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const r6 = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : null);

/// A route's identity and line: its id (or "new") and a hash of its path.
export function routeKey(plan) {
  const id = String(plan?.driveRoute?.id || plan?.id || "new").toLowerCase();
  let h = 5381;
  for (const [lon, lat] of plan?.path?.geometry || []) {
    for (const ch of `${r6(lon)},${r6(lat)};`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  }
  return `${id}:${h.toString(36)}`;
}

/// The drive as parts: { "drive:name": "…", "day:<id>": "…", "routes:<day id>",
/// "board:<day id>", "note:<id>", "att:<id>" }.
export function partsOf(drive) {
  const parts = {
    "drive:name": drive.name || "",
    "drive:description": drive.description || "",
    "drive:registered": typeof drive.registered === "boolean" ? String(drive.registered) : "",
  };
  for (const d of drive.days || []) {
    const a = dayArg(d);
    parts[`day:${d.id}`] = JSON.stringify({ ...a, meet: hhmm(a.meet), leave: hhmm(a.leave), place: a.place && { name: a.place.name, lat: r6(a.place.lat), lon: r6(a.place.lon) } });
    parts[`routes:${d.id}`] = JSON.stringify((d.legs || []).filter((l) => l.plan?.path).map((l) => [l.label || "", routeKey(l.plan)]));
    const board = drive.boards?.[d.id];
    if (board?.groups?.length) {
      const people = (drive.attendees || []).filter((p) => !Array.isArray(p.days) || p.days.includes(d.id));
      const { p_groups, p_placements } = groupsArgs(board, people);
      parts[`board:${d.id}`] = JSON.stringify([p_groups, [...p_placements].sort((x, y) => String(x.attendee_id).localeCompare(String(y.attendee_id)))]);
    }
  }
  for (const n of drive.notes || []) {
    const a = noteArg(n);
    parts[`note:${n.id}`] = JSON.stringify({ ...a, lat: r6(a.lat), lon: r6(a.lon) });
  }
  for (const p of drive.attendees || []) {
    parts[`att:${p.id}`] = JSON.stringify([p.email, p.name || "", p.car || "", p.style || "", typeof p.first_timer === "boolean" ? p.first_timer : null, p.status || "invited", [...(p.with || [])].sort()]);
  }
  return parts;
}

// The attendee fields only the server sets: which days, the waitlist.
const SERVER_ONLY = ["days", "waitlisted", "waitlistAt", "experienced"];

/// Take the server's part `key` from `fresh` (driveFromServer's) into `drive`.
function take(drive, fresh, key) {
  const [kind, id] = key.split(/:(.*)/s);
  if (kind === "drive") {
    if (id === "registered") {
      if (typeof fresh.registered === "boolean") drive.registered = fresh.registered;
      else delete drive.registered;
    } else drive[id] = fresh[id];
    return;
  }
  const list = { day: "days", note: "notes", att: "attendees" }[kind];
  if (list) {
    const theirs = fresh[list].find((x) => x.id === id);
    const i = drive[list].findIndex((x) => x.id === id);
    if (!theirs) {
      if (i >= 0) drive[list].splice(i, 1);
      if (kind === "day") delete drive.boards?.[id];
    } else if (i < 0) {
      // New there: in the server's place among the others.
      const at = fresh[list].indexOf(theirs);
      drive[list].splice(Math.min(at, drive[list].length), 0, structuredClone(theirs));
    } else if (kind === "day") {
      // The day's own fields; its legs are its routes' part.
      const mine = drive.days[i];
      for (const k of ["date", "meet", "leave", "place", "spots"]) mine[k] = structuredClone(theirs[k] ?? null);
      if (theirs.city) Object.assign(mine, { city: theirs.city, cityTyped: true });
      else { delete mine.city; delete mine.cityTyped; }
    } else drive[list][i] = structuredClone(theirs);
    return;
  }
  const day = drive.days.find((d) => d.id === id);
  const theirs = fresh.days.find((d) => d.id === id);
  if (kind === "routes" && day && theirs) day.legs = structuredClone(theirs.legs);
  if (kind === "board") {
    drive.boards ||= {};
    if (fresh.boards?.[id]) drive.boards[id] = structuredClone(fresh.boards[id]);
    else delete drive.boards[id];
  }
}

const ORDER = { drive: 0, day: 1, routes: 2, board: 3, note: 4, att: 5 };

/// Merge the server's drive into the draft (both sides as driveFromServer
/// and the page keep them). → { took, push, updates, readd, conflicts }: the
/// parts taken, the parts to send, for people already on the server what
/// changed here (drive_attendee_update: re-adding keeps their status, 0077),
/// those whose pairs changed (re-added for them), and the clashes, also kept
/// in drive.conflicts until the organizer chooses.
export function mergeServer(drive, fresh) {
  const local = partsOf(drive);
  const server = partsOf(fresh);
  // No base (a draft from before 11/9): where both have a part, the
  // server's is the truth; a part only this browser has still goes up.
  const base = drive.base || Object.fromEntries(Object.keys(server).filter((k) => k in local).map((k) => [k, local[k]]));
  const keys = [...new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(base)])]
    .sort((a, b) => ORDER[a.split(":")[0]] - ORDER[b.split(":")[0]]);
  const took = [];
  const push = new Set();
  const conflicts = {};
  const next = {};
  for (const k of keys) {
    const l = local[k], s = server[k], o = base[k];
    if (l === s) next[k] = s;
    else if (l === o || (k.startsWith("att:") && s !== o)) { took.push(k); next[k] = s; }
    else if (s === o) { push.add(k); next[k] = o; }
    else { conflicts[k] = s ?? null; next[k] = o; }
  }
  for (const k of took) {
    // A day new on the server comes with its legs.
    if (k.startsWith("routes:") && took.includes(`day:${k.slice(7)}`) && !local[`day:${k.slice(7)}`]) continue;
    take(drive, fresh, k);
  }
  // Which days and the waitlist: always the server's.
  const theirs = new Map(fresh.attendees.map((p) => [p.id, p]));
  for (const p of drive.attendees) {
    const t = theirs.get(p.id);
    if (!t) continue;
    for (const f of SERVER_ONLY) delete p[f];
    for (const f of SERVER_ONLY) if (f in t) p[f] = structuredClone(t[f]);
  }
  // Someone the server has: what changed here, field by field. Their
  // answer only when the organizer changed it here.
  const updates = new Map();
  const readd = new Set();
  const FIELDS = ["email", "name", "car", "style", "first_timer", "status", "with"];
  for (const k of push) {
    if (!k.startsWith("att:")) continue;
    const id = k.slice(4);
    if (!theirs.has(id) || !local[k] || !base[k]) continue;
    const [now, was] = [JSON.parse(local[k]), JSON.parse(base[k])];
    const patch = {};
    FIELDS.forEach((f, i) => {
      if (JSON.stringify(now[i]) === JSON.stringify(was[i])) return;
      if (f === "with") readd.add(id);
      else if (f !== "email") patch[f] = f === "first_timer" ? now[i] : now[i] || null;
    });
    if (Object.keys(patch).length) updates.set(id, patch);
  }
  // The pre-run as the server has it, unless changed here.
  if (!drive.prerun?.dirty) drive.prerun = structuredClone(fresh.prerun);
  drive.synced = { ...fresh.synced };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  drive.base = next;
  drive.conflicts = conflicts;
  if (drive.active && drive.active.day >= drive.days.length) drive.active = { day: 0, leg: 0 };
  return { took, push, updates, readd, conflicts: Object.keys(conflicts) };
}

/// The organizer's choice on the clashes: "theirs" takes the server's at
/// the next merge, "mine" sends this browser's.
export function resolveConflicts(drive, choice) {
  const local = partsOf(drive);
  drive.base ||= {};
  for (const [k, s] of Object.entries(drive.conflicts || {})) {
    const v = choice === "mine" ? s : local[k];
    if (v == null) delete drive.base[k];
    else drive.base[k] = v;
  }
  drive.conflicts = {};
}

/// What the clashes are, in words: "the description", "Sat, Dec 12", …
export function conflictWords(drive) {
  const keys = Object.keys(drive.conflicts || {});
  const dayName = (id) => {
    const d = drive.days.find((x) => x.id === id);
    if (!d?.date) return "a day";
    const [y, m, dd] = d.date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  };
  const words = [];
  for (const k of keys) {
    const [kind, id] = k.split(/:(.*)/s);
    const w = kind === "drive" ? (id === "registered" ? "whether people are registered" : `the ${id}`)
      : kind === "day" ? `the time and place on ${dayName(id)}`
      : kind === "routes" ? `the route on ${dayName(id)}`
      : kind === "board" ? `the groups on ${dayName(id)}`
      : kind === "note" ? "a map note" : null;
    if (w && !words.includes(w)) words.push(w);
  }
  return words;
}

/// Read the server's drive, merge, then send what changed here (all of it
/// the first time). `pull()` → { next, got } (drives-list's draftFromServer).
/// → { got, took, conflicts }.
export async function syncWithServer(drive, { pull, ...opts }) {
  let push = null;
  let updates = null;
  let readd = null;
  let took = [];
  let conflicts = [];
  // A first upload that stopped part way goes up whole again: the server's
  // half-made drive isn't the truth.
  if (!drive.synced?.created) drive.uploading = true;
  if (drive.synced?.created && !drive.uploading && pull) {
    const fresh = await pull();
    if (fresh?.got?.id) ({ push, updates, readd, took, conflicts } = mergeServer(drive, fresh.next));
  }
  const before = partsOf(drive);
  const got = await syncDrive(drive, { ...opts, push, updates, readd });
  delete drive.uploading;
  // What was sent is now the server's: its routes as saved (new ids).
  const after = partsOf(drive);
  const base = { ...(drive.base || {}) };
  for (const k of push || new Set([...Object.keys(before), ...Object.keys(after)])) {
    const v = k.startsWith("routes:") ? after[k] : before[k];
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  drive.base = base;
  return { got, took, conflicts };
}
