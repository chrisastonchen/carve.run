// Run groups' words and rules for carve.run's club drive page (spec
// ~/Carve/backlog/Run-Groups-Spec-2026-11-21.md, server 0130 and 0131): the
// "How many driving groups?" stepper, Import a list's columns, the board's
// statuses and how a name was linked. No DOM here (run-groups.js has it).

/// The most groups a drive can have; 0 is No groups (spec §1.1).
export const MOST_GROUPS = 15;

/// The stepper: + from No groups goes to 2, then up to 15.
export const groupsUp = (n) => (n >= MOST_GROUPS ? MOST_GROUPS : n < 2 ? 2 : n + 1);
/// − from 2 goes back to No groups.
export const groupsDown = (n) => (n <= 2 ? 0 : n - 1);
export const groupsText = (n) => (n ? `${n} groups` : "No groups");

/// Every name shows one of these (spec §1.4).
export const STATUS = {
  linked: "✓ Linked",
  confirmed: "✓ Confirmed in Carve",
  no_account: "No account",
  invited: "Invited",
};

/// How Carve linked a name (the person panel, spec §1.5). Never "Guest":
/// in the app a guest is a signed-out driver (Chris, 11/21).
export function linkWords(entry) {
  if (!entry?.link) return entry?.status === "invited" ? "Invited by email. Carve links them when they sign up with it." : "No Carve account yet";
  const how = {
    email: "Matched by email",
    name: "Matched by name when they opened the route",
    saved: "Linked from your club's earlier drive when they opened this one",
    claim: "Picked this name in the Carve app",
  }[entry.link] || "Linked";
  return entry.status === "confirmed" && entry.group ? `${how}. Started the drive in Group ${entry.group}.` : how;
}

export const ROLE_WORD = { lead: "Lead", sweep: "Sweep" };

/// The board's header: drivers and passengers counted apart (Chris, 11/21).
export function boardLine(board) {
  const drivers = board?.drivers ?? 0;
  const passengers = board?.passengers ?? 0;
  const parts = [`${drivers} ${drivers === 1 ? "driver" : "drivers"}`];
  if (passengers) parts.push(`${passengers} ${passengers === 1 ? "passenger" : "passengers"}`);
  // Linked only when someone is (QA 11/22).
  if (board?.linked) parts.push(`${board.linked} linked to a Carve account`);
  return parts.join(" · ");
}

/// The columns Import a list can match (spec §1.3): Name and Group needed;
/// Email, Waiver and Driver / Passenger (Cheryl's "Participant category")
/// optional.
export const COLUMNS = [
  { key: "name", label: "Name", needed: true },
  { key: "group", label: "Group", needed: true },
  { key: "email", label: "Email (optional)", none: "No email column" },
  { key: "waiver", label: "Waiver (optional)", none: "No waiver column" },
  { key: "category", label: "Driver / Passenger (optional)", none: "No such column" },
];

/// A header's best column for each field, by its words. → { name: 0, … }
/// with -1 for none. A header used once only.
export function guessColumns(header) {
  const h = (header || []).map((x) => String(x || "").trim().toLowerCase());
  const used = new Set();
  const pick = (test) => {
    const i = h.findIndex((x, j) => !used.has(j) && test(x));
    if (i >= 0) used.add(i);
    return i;
  };
  const out = {};
  out.email = pick((x) => /e-?mail/.test(x));
  out.group = pick((x) => /^(run\s*)?group\b|\bgroup$|^run group/.test(x) && !/category/.test(x));
  out.waiver = pick((x) => /waiver|release|signed/.test(x));
  out.category = pick((x) => /category|passenger|guest|driver\s*\/|type|role/.test(x) && !/name/.test(x));
  out.name = pick((x) => /name|driver|participant|attendee|person/.test(x)) ;
  if (out.name < 0) out.name = h.findIndex((_, j) => !used.has(j));
  return out;
}

/// Does the first row look like a header (a "Name" or "Group" cell)?
export const looksLikeHeader = (row) => (row || []).some((c) => /^(name|group|e-?mail|waiver|participant category|first name|last name)$/i.test(String(c || "").trim()));

/// Rows of cells and the matched columns → what run_group_import takes.
export function importRows(rows, columns, header = true) {
  const cell = (r, k) => (columns[k] >= 0 ? String(r[columns[k]] ?? "").trim() : "");
  return (header ? rows.slice(1) : rows).map((r) => {
    const row = { name: cell(r, "name"), group: cell(r, "group") };
    for (const k of ["email", "waiver", "category"]) if (columns[k] >= 0) row[k] = cell(r, k);
    return row;
  });
}

/// The preview's summary line (spec §1.3): people, groups, Leads, Sweeps,
/// empty rows skipped, waivers not signed.
export function summaryParts(p) {
  const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;
  const out = [n(p.people, "person", "people"), n(p.groups, "group", "groups"), n(p.leads, "Lead", "Leads"), n(p.sweeps, "Sweep", "Sweeps")];
  if (p.passengers) out.push(n(p.passengers, "passenger", "passengers"));
  if (p.skipped) out.push(`${n(p.skipped, "empty row", "empty rows")} skipped`);
  if (p.waivers_not_signed) out.push(`${n(p.waivers_not_signed, "waiver", "waivers")} not signed`);
  if (p.repeat_rows) out.push(`${n(p.repeat_rows, "repeat", "repeats")} not added`);
  return out;
}

/// Someone the sheet has more than once (0136): "Jane Smith is on the list
/// twice; added once."
export function repeatLine({ name, times }) {
  return `${name} is on the list ${times === 2 ? "twice" : `${times} times`}; added once.`;
}

/// The names an update would remove (0131: never silently).
export const removingLine = (n) => `${n} ${n === 1 ? "person isn't" : "people aren't"} on the new list and will be removed.`;

/// Each refusal said plainly.
export const REFUSAL = {
  group_not_empty: "A group you're taking away still has people. Move them first.",
  group_count: "Pick No groups, or 2 to 15 groups.",
  no_such_group: "That group isn't on this drive.",
  role_needs_group: "Put them in a group first.",
  email: "That email doesn't look right.",
  name: "Add a name.",
  not_lead_or_sweep: "Make them a Lead or Sweep first.",
  linked: "They're linked to a Carve account already.",
  too_many: "That's a lot of invites today. Try again tomorrow.",
  test_address: "Carve doesn't email .test addresses.",
  same_name: "That name is on the list already. Pick them, or add another.",
};

/// Two letters for an avatar: "Sophie Lenart" → "SL".
export const initials = (name) => String(name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

/// A name's words, for finding it (0138's run_group_name_words): no
/// capitals or accents, split at spaces and punctuation. "Lenart, Sophie"
/// and "Sophie-Lenart" are "sophie lenart". "" when blank.
export function nameWords(s) {
  let v = String(s || "").replace(/\s+/g, " ").trim();
  const m = /^([^,]+),([^,]+)$/.exec(v);
  if (m) v = `${m[2].trim()} ${m[1].trim()}`;
  return v.toLowerCase().replace(/ß/g, "s").replace(/ł/g, "l").replace(/ø/g, "o").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/// A name as Carve compares names (0138's run_group_name_key): capitals,
/// accents, punctuation and spaces aside, so "MaryAnn Smith" is "Mary Ann
/// Smith" and "Jane-Smith" is "Jane Smith". "" when blank.
export const nameKey = (s) => nameWords(s).replace(/ /g, "");

/// A name's last word as a key (a surname): "Pat O'Brien" → "obrien".
export const lastWordKey = (s) => nameKey(String(s || "").trim().split(/\s+/).pop());

const order = (a, b) => ((a.group ?? 1e9) - (b.group ?? 1e9)) || ((a.position ?? 0) - (b.position ?? 0)) || String(a.id).localeCompare(String(b.id));

/// The board as it will be once Carve saves `patch` on entry `id`
/// (run_group_entry_update's rules): a move takes the role off, a role
/// takes it from whoever had it in that group; the counts again. A new
/// board; `board` is left as it was.
export function applyPatch(board, id, patch) {
  const entries = board.entries.map((e) => ({ ...e }));
  const e = entries.find((x) => x.id === id);
  if (!e) return board;
  // Another group (or none): the role stays behind (0137), unless the
  // patch gives one (the picker's {group, role}).
  if ("group" in patch) { if ((patch.group ?? null) !== e.group) e.role = null; e.group = patch.group ?? null; }
  if ("role" in patch) {
    if (patch.role) for (const x of entries) if (x !== e && x.group === e.group && x.role === patch.role) x.role = null;
    e.role = patch.role ?? null;
  }
  if ("passenger" in patch) e.passenger = !!patch.passenger;
  if ("email" in patch) e.email = patch.email;
  entries.sort(order);
  return { ...board, entries, people: entries.length, drivers: entries.filter((x) => !x.passenger).length,
    passengers: entries.filter((x) => x.passenger).length, linked: entries.filter((x) => x.account).length };
}

/// Where someone is on the board: "Group 3", "Group 3 · Lead", "No group".
export const whereText = (e) => (e.group ? `Group ${e.group}${e.role ? ` · ${ROLE_WORD[e.role]}` : ""}` : "No group");

/// The roster search: each word typed starts a word of the name ("zo m"
/// finds Zoë Müller), or what's typed, as a key, starts the name's key or
/// its last word's ("jr ewing", "maryann", "obrien": QA 11/23). Names whose
/// first word starts with the first word typed first, then the rest, each
/// A–Z. → { hits (up to `most`), total }.
export function findPeople(entries, typed, most = 8) {
  const q = nameWords(typed);
  if (!q) return { hits: [], total: 0 };
  const words = q.split(" ");
  const qk = nameKey(typed);
  const fits = (name) => {
    const ws = nameWords(name).split(" ");
    return words.every((w) => ws.some((x) => x.startsWith(w))) || nameKey(name).startsWith(qk) || lastWordKey(name).startsWith(qk);
  };
  const all = entries.filter((e) => fits(e.name))
    .sort((a, b) => (nameWords(b.name).startsWith(words[0]) - nameWords(a.name).startsWith(words[0])) || a.name.localeCompare(b.name));
  return { hits: all.slice(0, most), total: all.length };
}

/// "4 drivers · 1 passenger" (a group, or the drive).
export function peopleLine(list) {
  const p = list.filter((e) => e.passenger).length, d = list.length - p;
  return [`${d} ${d === 1 ? "driver" : "drivers"}`, ...(p ? [`${p} ${p === 1 ? "passenger" : "passengers"}`] : [])].join(" · ");
}

/// The printed sheet's groups (Chris 11/23): Group 1 to N, then No group if
/// anyone's in it; each its Lead and Sweep, then the rest A–Z.
export function printGroups(board) {
  const out = [];
  const ns = [...Array(board.group_count || 0).keys()].map((i) => i + 1);
  if (board.entries.some((e) => e.group == null || e.group > (board.group_count || 0))) ns.push(0);
  for (const n of ns) {
    const people = board.entries.filter((e) => (n ? e.group === n : e.group == null || e.group > (board.group_count || 0)));
    const lead = n ? people.find((e) => e.role === "lead") || null : null;
    const sweep = n ? people.find((e) => e.role === "sweep") || null : null;
    const rest = people.filter((e) => e !== lead && e !== sweep).sort((a, b) => a.name.localeCompare(b.name));
    out.push({ n, title: n ? `Group ${n}` : "No group", lead, sweep, rest, line: peopleLine(people) });
  }
  return out;
}

/// A change Carve didn't save, said as the change (QA 11/23): "Jane Smith
/// wasn't moved to Group 3." `why`: a refusal's own words, if it has them.
export function notSavedLine(name, patch, why = "") {
  let what = "That change didn't save.";
  if ("role" in patch && patch.role) what = `${name} wasn't made ${ROLE_WORD[patch.role]}.`;
  else if ("group" in patch) what = `${name} wasn't moved to ${patch.group ? `Group ${patch.group}` : "No group"}.`;
  else if ("role" in patch) what = `${name}'s role wasn't taken off.`;
  else if ("passenger" in patch) what = `${name} wasn't marked as ${patch.passenger ? "a passenger" : "a driver"}.`;
  return `${what} ${why || "Try again."}`;
}
