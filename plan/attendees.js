// Attendees for a group drive (Club-Sprint-Requirements.md §1 Attendees):
// people typed or pasted as email addresses, and registration lists (CSV or
// pasted text, from MotorsportReg or anything else) matched by column. Pure:
// what the Attendees step and its tests use. The server merges again on
// drive_attendees_add. Phone and RSVP time are in the approved mock's
// template (Chris, 11/9), over 11/8's no-phones: kept for the organizer only.

export const STATUSES = ["registered", "going", "maybe", "invited", "no"];
export const STATUS_WORDS = { registered: "Registered", going: "Going", maybe: "Maybe", invited: "Invited", no: "Can't make it" };
/// Which status wins when the same email comes twice: an answer or a
/// registration beats a bare invitation.
const RANK = { registered: 5, going: 4, maybe: 3, no: 2, invited: 1 };
export const STYLES = ["spirited", "touring", "relaxed"];

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
export const isEmail = (s) => EMAIL.test(String(s || "").trim());
export const emailKey = (s) => String(s || "").trim().toLowerCase();

/// Typed or pasted addresses: one per line or comma-separated, as copied
/// from an email ("Maya Chen <maya@x.com>"), a sheet ("Maya Chen, maya@x.com"
/// or a tab between) or a plain list. → { people: [{ email, name }], bad: [text] }
export function parseInvites(text) {
  const people = [];
  const bad = [];
  const seen = new Set();
  const add = (email, name) => {
    const key = emailKey(email);
    if (seen.has(key)) return;
    seen.add(key);
    people.push({ email: email.trim(), ...(name ? { name: name.trim().replace(/^["']|["']$/g, "") } : {}) });
  };
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // "Name <email>" pieces, however many on the line.
    const angled = [...line.matchAll(/([^,;<>]*?)<\s*([^<>\s]+)\s*>/g)];
    if (angled.length) {
      for (const m of angled) (isEmail(m[2]) ? add(m[2], m[1].replace(/[,;]/g, "").trim()) : bad.push(m[0].trim()));
      // Bare addresses between them ("maya@x.com, Ray <ray@x.com>").
      let rest = line;
      for (const m of angled) rest = rest.replace(m[0], ",");
      for (const p of rest.split(/[,;\t]+/).map((x) => x.trim()).filter(Boolean)) (isEmail(p) ? add(p) : bad.push(p));
      continue;
    }
    const parts = line.split(/[,;\t]+/).map((p) => p.trim()).filter(Boolean);
    const emails = parts.filter(isEmail);
    if (emails.length === 1 && parts.length === 2) {
      // "Maya Chen, maya@x.com" or "maya@x.com, Maya Chen"
      add(emails[0], parts.find((p) => p !== emails[0]));
    } else if (emails.length) {
      for (const p of parts) (isEmail(p) ? add(p) : bad.push(p));
    } else {
      // "Maya Chen maya@x.com", or nothing usable.
      const words = line.split(/\s+/);
      const found = words.filter(isEmail);
      if (found.length === 1) add(found[0], words.filter((w) => w !== found[0]).join(" "));
      else bad.push(line);
    }
  }
  return { people, bad };
}

/// A CSV (RFC 4180: quotes, doubled quotes, commas and newlines in quotes),
/// or pasted text with tabs. → rows of cells.
export function parseTable(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const delim = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? "\t"
    : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows.map((r) => r.map((v) => v.trim()));
}

/// The fields a registration list's columns can be, and the headers that
/// name them (MotorsportReg's among them).
export const FIELDS = [
  { key: "name", label: "Name", names: ["name", "full name", "driver", "driver name", "attendee", "participant"] },
  { key: "first", label: "First name", names: ["first", "first name", "firstname", "given name"] },
  { key: "last", label: "Last name", names: ["last", "last name", "lastname", "surname", "family name"] },
  { key: "email", label: "Email", names: ["email", "e-mail", "email address", "mail"] },
  { key: "phone", label: "Phone", names: ["phone", "phone number", "mobile", "cell", "cell phone", "telephone", "tel"] },
  { key: "registered_at", label: "RSVP time", names: ["rsvp time", "rsvp", "rsvp date", "registered at", "registered on", "registration date", "registration time", "signed up", "sign up date", "submitted", "submitted at", "timestamp", "date registered"] },
  { key: "car", label: "Car", names: ["car", "vehicle", "make model", "make/model", "car make/model", "year make model", "make", "model"] },
  { key: "style", label: "Driving style", names: ["style", "driving style", "pace", "pace group", "how do you like to drive"] },
  { key: "first_timer", label: "First time", names: ["first time", "first timer", "first-time", "first drive", "new", "new member", "first event"] },
  { key: "run_group", label: "Run group", names: ["run group", "rungroup", "class", "session"] },
  { key: "group", label: "Group", names: ["group", "group number", "group #", "assigned group", "drive group"] },
  { key: "with", label: "Drive with", names: ["with", "drive with", "driving with", "together with", "pair with", "buddy"] },
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9#/ ]+/g, " ").replace(/\s+/g, " ").trim();

/// Which field each column is (null: not used), from the header row.
export function guessColumns(header) {
  const used = new Set();
  return header.map((h) => {
    const n = norm(h);
    // An exact name, else the field whose name is the longest part of it
    // ("First drive with the club" is first-time, not first name).
    const within = (f) => Math.max(0, ...f.names.filter((name) => name.length > 3 && n.includes(name)).map((name) => name.length));
    const field = FIELDS.find((f) => !used.has(f.key) && f.names.includes(n))
      || FIELDS.filter((f) => !used.has(f.key) && within(f)).sort((a, b) => within(b) - within(a))[0];
    if (field) used.add(field.key);
    return field ? field.key : null;
  });
}

/// Whether a row is a header (no email in it, and some column names).
export function looksLikeHeader(row) {
  return !row.some(isEmail) && guessColumns(row).some(Boolean);
}

export function styleOf(value) {
  const v = norm(value);
  if (!v) return null;
  if (/spirit|fast|quick|sport|brisk|aggress|expert|advanced|^a$|^1$/.test(v)) return "spirited";
  if (/relax|leisure|easy|slow|gentle|scenic|novice|beginner|^c$|^3$/.test(v)) return "relaxed";
  if (/tour|moderate|medium|intermediate|normal|average|^b$|^2$/.test(v)) return "touring";
  return null;
}

export function yesNo(value) {
  const v = norm(value);
  if (!v) return null;
  if (/^(y|yes|true|1|x|first|new)\b/.test(v)) return true;
  if (/^(n|no|false|0|returning)\b/.test(v)) return false;
  return null;
}

/// What's wrong with an address, in words: "is missing the end of the
/// address" (null: nothing).
export function emailProblem(text) {
  const t = String(text || "").trim();
  if (isEmail(t)) return null;
  if (!t) return "has no email address";
  if (!t.includes("@")) return "has no @ in the address";
  if (/\s/.test(t)) return "has a space in the address";
  const [, domain = ""] = t.split("@");
  if (!domain) return "is missing the part after the @";
  if (!/\.[^.]{2,}$/.test(domain)) return "is missing the end of the address";
  return "doesn't look like an email address";
}

/// A phone number as typed, tidied: digits, a leading +, and the usual
/// separators; null when it has fewer than 7 digits.
export function phoneOf(value) {
  const v = String(value || "").trim();
  if ((v.match(/\d/g) || []).length < 7) return null;
  return v.replace(/[^\d+()\-. ]/g, "").replace(/\s+/g, " ").trim();
}

/// An RSVP time from another service ("11/02/2026 7:15 PM", ISO, or a
/// spreadsheet's day number) as an ISO string; null when unreadable.
export function registeredAtOf(value) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  // A spreadsheet's serial day (days since 1899-12-30), from an XLSX.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const ms = Math.round((Number(v) - 25569) * 86400000);
    return new Date(ms).toISOString();
  }
  const us = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i);
  if (us) {
    let [, m, d, y, h = "0", min = "0", sec = "0", ap] = us;
    y = y.length === 2 ? `20${y}` : y;
    let hour = Number(h) % (ap ? 12 : 24) + (ap && /p/i.test(ap) ? 12 : 0);
    const t = new Date(Number(y), Number(m) - 1, Number(d), hour, Number(min), Number(sec));
    return Number.isFinite(t.getTime()) ? t.toISOString() : null;
  }
  const t = new Date(v);
  return Number.isFinite(t.getTime()) && /\d{4}/.test(v) ? t.toISOString() : null;
}

/// One row as a person (by `columns`), with what's wrong if anything.
/// → { person, why } — why null when it can be added.
function rowPerson(r, columns) {
  const col = (key) => columns.indexOf(key);
  const get = (key) => (col(key) >= 0 ? r[col(key)] || "" : "");
  let email = get("email");
  if (!isEmail(email)) email = r.find(isEmail) || email || r.find((c) => c.includes("@")) || "";
  const name = get("name") || [get("first"), get("last")].filter(Boolean).join(" ");
  const groupNumber = Number.parseInt(get("group"), 10);
  const person = {
    email: email.trim(),
    status: "registered",
    ...(name ? { name } : {}),
    ...(get("car") ? { car: get("car") } : {}),
    ...(styleOf(get("style")) ? { style: styleOf(get("style")) } : {}),
    ...(yesNo(get("first_timer")) !== null ? { first_timer: yesNo(get("first_timer")) } : {}),
    ...(phoneOf(get("phone")) ? { phone: phoneOf(get("phone")) } : {}),
    ...(registeredAtOf(get("registered_at")) ? { registered_at: registeredAtOf(get("registered_at")) } : {}),
    ...(Number.isInteger(groupNumber) && groupNumber > 0 ? { group: groupNumber } : {}),
    ...(get("run_group") ? { run_group: get("run_group") } : {}),
    ...(get("with") ? { with_text: get("with") } : {}),
  };
  return { person, why: emailProblem(email) };
}

/// "Drive with": emails, or names of people in the same list (in place).
function linkWith(people) {
  const byName = new Map(people.filter((p) => p.name).map((p) => [norm(p.name), p]));
  for (const p of people) {
    if (!p.with_text) continue;
    const wants = p.with_text.split(/[,;/&]|\band\b/).map((s) => s.trim()).filter(Boolean);
    const emails = wants.map((w) => (isEmail(w) ? w : byName.get(norm(w))?.email)).filter((e) => e && emailKey(e) !== emailKey(p.email));
    if (emails.length) p.with = [...new Set(emails.map(emailKey))];
    delete p.with_text;
  }
  return people;
}

/// A registration list's rows as people, Registered, with what the columns
/// give. `columns` is guessColumns' (or the organizer's change of it).
/// "Drive with" names or emails are matched to people in the same list.
/// → { people, skipped: [{ row: n, why }] }
export function peopleFromTable(rows, columns, { header = true } = {}) {
  const body = header ? rows.slice(1) : rows;
  const people = [];
  const skipped = [];
  const seen = new Set();
  body.forEach((r, i) => {
    const { person, why } = rowPerson(r, columns);
    if (why) return skipped.push({ row: i + (header ? 2 : 1), why: "no email address" });
    const key = emailKey(person.email);
    if (seen.has(key)) return skipped.push({ row: i + (header ? 2 : 1), why: "the same email as an earlier row" });
    seen.add(key);
    people.push(person);
  });
  return { people: linkWith(people), skipped };
}

/// A pasted list, before anything is added (the approved mock, 11/9):
/// "Paste anything: rows from a spreadsheet, or emails from an email".
/// Line by line, with a header row's columns when there is one. Each row:
/// { key, person, why (what needs a look, null if fine), note (no name) }.
/// → { rows, found, needLook, columns }
export function previewPaste(text) {
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const first = lines.length ? parseTable(lines[0])[0] || [] : [];
  const header = first.length > 1 && looksLikeHeader(first);
  const columns = header ? guessColumns(first) : null;
  const rows = [];
  const seen = new Set();
  const push = (person, why, raw) => {
    const key = emailKey(person.email);
    if (!why && seen.has(key)) return;
    if (!why) seen.add(key);
    rows.push({ key: `${rows.length}`, person, why, raw, note: !why && !person.name ? "No name. We'll ask for it in their email." : null });
  };
  for (const line of header ? lines.slice(1) : lines) {
    const cells = parseTable(line)[0] || [];
    if (columns && cells.length > 1 && !/<[^>]*@[^>]*>/.test(line)) {
      const { person, why } = rowPerson(cells, columns);
      push(person, why, line);
      continue;
    }
    // "Name <email>", "Name, email", a bare address, or several on a line.
    const { people } = parseInvites(line);
    for (const p of people) push({ ...p, status: "registered" }, null, line);
    if (!people.length) {
      const token = line.split(/[\s,;<>]+/).find((w) => w.includes("@")) || "";
      const name = line.replace(token, "").replace(/[<>,;]+/g, " ").replace(/\s+/g, " ").trim();
      push({ email: token, status: "registered", ...(name ? { name } : {}) }, emailProblem(token), line);
    }
  }
  linkWith(rows.filter((r) => !r.why).map((r) => r.person));
  return { rows, found: rows.length, needLook: rows.filter((r) => r.why).length, columns };
}

/// A file's rows (CSV or .xlsx), as previewPaste's preview: the header's
/// columns (the first row when it names them), each row checked.
export function previewTable(rows) {
  const header = rows.length > 0 && looksLikeHeader(rows[0]);
  const columns = header ? guessColumns(rows[0]) : (rows[0] || []).map((v) => (isEmail(v) ? "email" : null));
  const out = [];
  const seen = new Set();
  for (const r of header ? rows.slice(1) : rows) {
    const { person, why } = rowPerson(r, columns);
    const key = emailKey(person.email);
    if (!why && seen.has(key)) continue;
    if (!why) seen.add(key);
    out.push({ key: `${out.length}`, person, why, raw: r.join(", "), note: !why && !person.name ? "No name. We'll ask for it in their email." : null });
  }
  linkWith(out.filter((r) => !r.why).map((r) => r.person));
  return { rows: out, found: out.length, needLook: out.filter((r) => r.why).length, columns, header: header ? rows[0] : null };
}

/// The organizer's fix to a row's address: the row again, checked.
export function fixRow(row, email) {
  const person = { ...row.person, email: String(email || "").trim() };
  const why = emailProblem(person.email);
  return { ...row, person, why, note: !why && !person.name ? "No name. We'll ask for it in their email." : null };
}

/// The template to download: email required, then the optional columns, in
/// the approved mock's order, with one example row.
export const TEMPLATE_CSV = [
  "Email,Name,Phone,Car,Driving style,RSVP time,First drive with the club,Drive with",
  "dana@example.com,Dana Whitfield,(408) 555-0134,Porsche 911 Carrera T,Touring,11/02/2026 7:15 PM,No,Lee Nakamura",
].join("\r\n") + "\r\n";

/// People added to the drive's list: duplicates (by email, any case) merge
/// into one, the strongest status wins, and what's known fills what isn't.
/// An import (Registered) raises Invited and Maybe, never touches someone's
/// own Going or No (Chris, 11/9).
export function merge(list, added) {
  const out = list.map((p) => ({ ...p }));
  const index = new Map(out.map((p, i) => [emailKey(p.email), i]));
  let added_count = 0;
  let merged = 0;
  for (const person of added) {
    const key = emailKey(person.email);
    const status = person.status || "invited";
    if (!index.has(key)) {
      index.set(key, out.length);
      out.push({ id: person.id || crypto.randomUUID(), ...person, status });
      added_count++;
      continue;
    }
    const kept = out[index.get(key)];
    const own = kept.status === "no" || (kept.status === "going" && status === "registered");
    const strongest = !own && RANK[status] > RANK[kept.status] ? status : kept.status;
    for (const [k, v] of Object.entries(person)) if (kept[k] === undefined || kept[k] === "") kept[k] = v;
    kept.status = strongest;
    merged++;
  }
  return { list: out, added: added_count, merged };
}

/// Headcount by status, and how many count towards the cap (Going and
/// Registered).
export function counts(list) {
  const by = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const p of list) by[p.status] = (by[p.status] || 0) + 1;
  return { ...by, coming: by.going + by.registered, total: list.length };
}

/// The meter (the user, 11/8 late): "40 invited · 30 spots · 18 going".
/// Invited is everyone on the list (inviting more than there are spots is
/// fine); spots the day's limit (Spots, else the plan's; none on Club with
/// none set); going those who count: Going and Registered, not waitlisted.
export function meterLine({ invited = 0, spots = null, going = 0, waiting = 0 } = {}) {
  if (!invited) return "";
  return [`${invited} invited`, Number.isInteger(spots) ? `${spots} ${spots === 1 ? "spot" : "spots"}` : "", `${going} going`, waiting ? `${waiting} waiting` : ""]
    .filter(Boolean).join(" · ");
}

/// When people should answer by (the approved mock, 11/9), from the drive's
/// first day and today ("YYYY-MM-DD" both): a week before when the drive is
/// more than 7 days away, the day before when 2–7 days away, and no question
/// at all when it's under 48 hours. → { ask, date } (date "YYYY-MM-DD").
export function answerByDefault(firstDay, today) {
  if (!firstDay || !today) return { ask: true, date: null };
  const day = (s) => Date.UTC(...s.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
  const days = Math.round((day(firstDay) - day(today)) / 86400000);
  if (days < 2) return { ask: false, date: null };
  const back = days > 7 ? 7 : 1;
  return { ask: true, date: new Date(day(firstDay) - back * 86400000).toISOString().slice(0, 10) };
}

/// "Sat, Dec 5" from "2026-12-05".
export function shortDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
