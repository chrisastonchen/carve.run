// The Attendees step (the approved mock, 11/9; Club-Planner-Mock-Decisions
// §3): "Do you already have people registered?" first, one question at a
// time (ask.js). Yes: drop a spreadsheet, paste a list (a preview before
// anything is added, bad emails flagged, undo), or add people one by one;
// then the list, with Invite more people. No: the invite questions (item 3,
// next). The step bar mounts it: initAttendeesStep({ $, el, api, drive,
// save, section, go, org }) → { render, done, summary }.
//
// The registered answer is drive.registered (synced as drive_update's
// `registered`); people are drive.attendees (status "registered" from a
// list), merged by email as attendees.js's merge does.

import { ask } from "./ask.js";
import { STATUS_WORDS, TEMPLATE_CSV, answerByDefault, counts, emailProblem, fixRow, merge, parseTable, previewPaste, previewTable, shortDate } from "./attendees.js?v=1";
import { rowsOfFile } from "./xlsx.js";
import { emailRows } from "./email-rows.js";
import { linkCard } from "./link-card.js";
import { makeDraggable } from "./drag.js";
import { keepServer } from "./send.js?v=2";
import { fromWaitlists, moved, openSpots, openText, placeText, waitingText, waitlistFields, waitlistFor } from "./waitlist.js";

const STYLE_WORD = { spirited: "Spirited", touring: "Touring", relaxed: "Relaxed" };

/// "32 registered · 60 spots · 28 left" (the mock's line). Spots: every
/// day's when they're the same, else none shown. Someone on a waitlist
/// isn't going yet: they're "waiting", and take no spot.
export function attendeeLine(drive) {
  const people = drive.attendees.filter((p) => p.status !== "no");
  const waits = (p) => Array.isArray(p.waitlisted) && p.waitlisted.length > 0;
  const c = counts(people.filter((p) => !waits(p)));
  const waiting = people.filter(waits).length;
  const spots = [...new Set((drive.days || []).map((d) => (Number.isInteger(d.spots) ? d.spots : null)))];
  const one = spots.length === 1 ? spots[0] : null;
  const parts = [];
  if (c.registered) parts.push(`${c.registered} registered`);
  if (c.going) parts.push(`${c.going} going`);
  if (c.invited || c.maybe) parts.push(`${c.invited + c.maybe} invited`);
  if (waiting) parts.push(`${waiting} waiting`);
  if (one) parts.push(`${one} spots`, `${Math.max(0, one - c.coming)} left`);
  return parts.join(" · ");
}

/// The Group plan's one group (no Groups step): Lead and Sweep set here,
/// placed in group 1 on every day so their emails say so; everyone else
/// not placed. One person, one role.
export function singleGroup(drive, { lead = null, sweep = null } = {}) {
  if (sweep && sweep === lead) sweep = null;
  drive.boards ||= {};
  for (const d of drive.days) {
    const placements = {};
    for (const id of [lead, sweep]) if (id) placements[id] = 1;
    drive.boards[d.id] = {
      settings: { count: 1, target: 20, gap: 0, first: null },
      groups: lead || sweep ? [{ number: 1, label: null, target: 20, offset: 0, lead, sweep }] : [],
      placements, by: {},
    };
  }
  return { lead, sweep };
}

/// The invitation as people will see it, until App Dev's drive_send_preview
/// (0080) renders the real one: { subject, lines } for "Invitation", and
/// for "After they say yes" (pending or you're in by the approval mode).
export function invitePreview(drive, org, kind = "invite") {
  const club = org?.name || "Your club";
  const d = drive.days?.[0] || {};
  const time = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
  const facts = [d.date ? `Date ${shortDate(d.date)}` : "", d.meet ? `Meet ${time(d.meet)}${d.city ? ` ${d.city}` : ""}` : "", d.leave ? `Leave ${time(d.leave)}` : ""].filter(Boolean);
  const spots = Number.isInteger(d.spots) ? Math.max(0, d.spots - counts(drive.attendees || []).coming) : null;
  if (kind === "invite") {
    return {
      subject: `${club} via Carve · You're invited: ${drive.name || "Group drive"}`,
      lines: [`${club} invites you`, drive.name || "Group drive", ...facts, drive.description || "",
        `Are you going?${drive.invite?.answerBy ? ` Answer by ${shortDate(drive.invite.answerBy)}` : ""}`, "Yes · Maybe · Can't make it",
        `${spots !== null ? `${spots} spots left. ` : ""}You'll get the route once you're confirmed.`].filter(Boolean),
    };
  }
  const manual = drive.invite?.approval === "manual";
  return {
    subject: `${club} via Carve · ${manual ? "We've got your sign-up" : "You're in"}: ${drive.name || "Group drive"}`,
    lines: [manual ? "Thanks. The organizer will confirm your spot." : "You're in.", drive.name || "Group drive", ...facts,
      `Status ${manual ? "Waiting for the organizer" : "Confirmed"}`, "Plans changed? You can say you can't make it from this email."],
  };
}

/// Sign-ups from the link, as the approving screen shows them: App Dev's
/// signups_list rows (exact shapes ~11/15) read through this one place.
/// → [{ id, name, email, car, style, first_timer, at, state }] by sign-up
/// time, state waiting | approved | waitlist | declined.
export function signupRows(rows = []) {
  return (rows || []).map((r) => ({
    id: r.id ?? r.attendee_id, name: r.name || "", email: r.email || "", car: r.car || "", style: r.style || null,
    first_timer: !!r.first_timer, at: r.signed_up_at || r.created_at || r.at || null,
    state: ["approved", "waitlist", "declined"].includes(r.approval) ? r.approval : r.approval === "waitlisted" ? "waitlist" : "waiting",
  })).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

/// The three ways to add registered people (Chris's addendum, 11/9).
const HOW = [
  { value: "import", label: "Import your list", short: "Import", sub: "A spreadsheet or a pasted list, from wherever you collect registrations." },
  { value: "self", label: "Add people yourself", short: "Add yourself", sub: "Type their emails and names. They count as registered, and no invitation is sent." },
  { value: "link", label: "Just share the route link", short: "Share the link", sub: "Nothing to upload. Drivers who open the link and sign in are checked in and show on your list." },
];

/// The list's tabs (Chris's board, 11/9): who's in which, by their answer.
/// Going counts Registered and checked-in drivers; the Waitlist those
/// waiting on any day; Not answered appears only while someone invited
/// hasn't. → { going, waitlist, maybe, no, invited }
export function listTabs(attendees) {
  const waits = (p) => Array.isArray(p.waitlisted) && p.waitlisted.length > 0;
  return {
    going: attendees.filter((p) => (p.status === "going" || p.status === "registered") && !waits(p)),
    waitlist: attendees.filter(waits),
    maybe: attendees.filter((p) => p.status === "maybe" && !waits(p)),
    no: attendees.filter((p) => p.status === "no"),
    invited: attendees.filter((p) => p.status === "invited" && !waits(p)),
  };
}
const TAB_WORDS = { going: "Going", waitlist: "Waitlist", maybe: "Maybe", no: "Can't make it", invited: "Not answered" };
/// drive_route_link_open's refusals (App Dev's 0085), as the step says them.
const ROUTE_LINK_WORDS = {
  closed: "This drive is over or cancelled, so it has no route link.",
  not_approved: "Waiting for approval. The route link comes once your club is approved.",
  needs_plan: "Group drives need Group or Club.",
  "no days": "Add a day first.",
  bad_input: "Add a day first.",
};
/// date_taken (Group only, 0069): its details are the clashing dates,
/// "2026-12-12,2026-12-13" → "Your club already has a drive out on Sat,
/// Dec 12 and Sun, Dec 13. Group plans run one drive a day."
export function routeLinkRefusal(failure) {
  const code = failure?.data?.message || failure?.message;
  if (code !== "date_taken") return ROUTE_LINK_WORDS[code] || "Couldn't make the route link. Try again.";
  const days = String(failure?.data?.details || "").split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).map((s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  });
  const when = days.length ? ` on ${days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days.at(-1)}` : days[0]}` : " that day";
  return `Your club already has a drive out${when}. Group plans run one drive a day.`;
}

/// An import's people already on the drive with a No (by email): named in
/// the preview, left as they are.
export function noMatches(rows, attendees) {
  const no = new Map(attendees.filter((p) => p.status === "no").map((p) => [String(p.email).toLowerCase(), p]));
  return rows.filter((r) => !r.why && no.has(String(r.person.email).toLowerCase())).map((r) => no.get(String(r.person.email).toLowerCase()));
}

export function initAttendeesStep({ el, api = null, drive, save, section, go = () => {}, org = () => null, sendInvitations = null, today = () => new Date().toISOString().slice(0, 10) }) {
  // What's on screen past the question: "start" (add your people), "paste",
  // "file" (a dropped list's preview), "one" (one by one) or "list".
  let view = null;
  let listTab = "going"; // the list's tab (Going / Waitlist / Maybe / Can't make it)
  let preview = null; // { rows, found, needLook, source }
  let pasted = ""; // the paste box's text, kept across a Fix or Leave out
  let undo = null; // { before, said }
  let said = "";
  const root = el("div", "at");
  const questions = el("div", "ask");
  const body = el("div", "at-body");
  root.append(questions, body);
  section.replaceChildren(root);

  const q = ask(questions, {
    el,
    questions: [{
      key: "registered", label: "Registered", kind: "choice",
      title: "Do you already have people registered?",
      help: "If you collect registrations with another service, import that list or add people in the next step. If you're using Carve to collect registrations, choose No.",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    }, {
      // Three ways to add them (Chris's addendum, 11/9 evening).
      key: "how", label: "Adding them", kind: "choice", when: (a) => a.registered === "yes",
      title: "How do you want to add them?",
      options: HOW.map((h) => ({ value: h.value, label: h.label, sub: h.sub })),
    }],
    answers: () => {
      const d = drive();
      if (typeof d.registered !== "boolean") return {};
      const a = { registered: d.registered ? "yes" : "no" };
      // A draft from before the addendum with people on it: they were imported.
      const how = d.addHow || (d.registered && d.attendees.length ? "import" : null);
      if (how) a.how = how;
      return a;
    },
    onAnswer: (key, value) => {
      if (key === "registered") drive().registered = value === "yes";
      if (key === "how") drive().addHow = value;
      view = null;
      save();
      renderBody();
    },
  });

  const button = (text, cls, onClick) => {
    const b = el("button", cls, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const registered = () => drive().attendees.filter((p) => p.status !== "no");
  const everyone = () => drive().attendees;

  // ── adding ──
  function add(people, words) {
    const before = drive().attendees.map((p) => ({ ...p }));
    const { list, added, merged } = merge(drive().attendees, people.map((p) => ({ ...p, status: p.status || "registered" })));
    drive().attendees = list;
    undo = { before };
    said = [`Added ${added} ${added === 1 ? "person" : "people"}.`, merged ? `${merged} ${merged === 1 ? "was" : "were"} on the list already.` : "", words || ""].filter(Boolean).join(" ");
    preview = null;
    pasted = "";
    view = "list";
    save();
    renderBody();
  }
  function undoAdd() {
    if (!undo) return;
    drive().attendees = undo.before;
    undo = null;
    said = "Undone.";
    view = null;
    save();
    renderBody();
  }

  // ── the start: drop, paste, one by one, the template ──
  function start() {
    const box = el("div", "at-start");
    box.append(el("h3", "at-h", "Add your registered people"));
    const drop = el("label", "at-drop");
    drop.append(el("b", "", "Drop your list here"),
      el("span", "at-dim", "A spreadsheet (CSV or Excel). Using Google Sheets? Choose File, then Download, then CSV."));
    const input = el("input");
    input.type = "file";
    input.accept = ".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    input.className = "at-file";
    const choose = el("span", "pill grey at-choose", "Choose a file");
    drop.append(choose, input);
    input.addEventListener("change", () => input.files?.[0] && readFile(input.files[0]));
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const file = e.dataTransfer?.files?.[0];
      if (file) readFile(file);
    });
    const or = el("p", "at-or");
    or.append("or ", button("paste a list", "textlink", () => { view = "paste"; renderBody(); }), " · ", button("add people one by one", "textlink", () => { view = "one"; renderBody(); }));
    const tpl = el("p", "at-dim small");
    const a = el("a", "", "Download our template");
    a.href = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
    a.download = "carve-attendees-template.csv";
    tpl.append("Starting from scratch? ", a, ", fill it in and upload it. Email is required. Optional: name, phone, car, driving style, RSVP time, first drive with the club (yes or no), and who they want to drive with.");
    box.append(drop, or, tpl);
    if (said) box.append(el("p", "at-said", said));
    return box;
  }

  async function readFile(file) {
    try {
      const rows = await rowsOfFile(file, parseTable);
      preview = { ...previewTable(rows), source: file.name };
      view = "file";
      said = "";
    } catch (failure) {
      said = failure?.message === "unsupported"
        ? "That kind of file can't be read yet. Save it as CSV or Excel (.xlsx), or paste the list."
        : "That file couldn't be read. Save it as CSV or Excel (.xlsx), or paste the list.";
    }
    renderBody();
  }

  // ── a preview (paste or file): nothing added until "Add N people" ──
  function previewBox() {
    const box = el("div", "at-preview");
    const ok = preview.rows.filter((r) => !r.why);
    const head = el("p", "at-count");
    head.append(el("b", "", `${preview.found} ${preview.found === 1 ? "person" : "people"} found`));
    if (preview.needLook) head.append(" ", el("span", "chip warn", `${preview.needLook} ${preview.needLook === 1 ? "needs" : "need"} a look`));
    box.append(head);
    // People on the list who said No on Carve: the import leaves them be (Chris, 11/9).
    const noes = noMatches(preview.rows, drive().attendees);
    if (noes.length) {
      box.append(el("p", "at-said at-noes", `${noes.length} ${noes.length === 1 ? "person" : "people"} on this list said No on Carve: ${noes.map((p) => p.name || p.email).join(", ")}. Adding the list leaves them as No; check with them first.`));
    }
    const list = el("ul", "at-rows");
    for (const r of preview.rows) {
      const li = el("li", `at-row${r.why ? " bad" : ""}`);
      li.dataset.key = r.key;
      const who = el("div", "at-who");
      who.append(el("b", "", r.person.name || r.person.email || r.raw));
      const facts = [r.person.name ? r.person.email : "", r.person.car, STYLE_WORD[r.person.style]].filter(Boolean).join(" · ");
      if (facts) who.append(el("span", "at-dim", facts));
      li.append(who);
      if (r.note) li.append(el("span", "at-note", r.note));
      if (r.why) {
        const fix = el("div", "at-fix");
        fix.append(el("span", "", `${r.person.email || "This row"} ${r.why}.`));
        const edit = el("input", "field at-fix-input");
        edit.type = "email";
        edit.value = r.person.email;
        edit.setAttribute("aria-label", `Email for ${r.person.name || "this row"}`);
        edit.hidden = true;
        const fixBtn = button("Fix", "textlink", () => {
          if (edit.hidden) { edit.hidden = false; edit.focus(); return; }
          apply();
        });
        const apply = () => {
          const next = fixRow(r, edit.value);
          preview.rows = preview.rows.map((x) => (x.key === r.key ? next : x));
          preview.needLook = preview.rows.filter((x) => x.why).length;
          renderBody();
        };
        edit.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
        const leave = button("Leave out", "textlink", () => {
          preview.rows = preview.rows.filter((x) => x.key !== r.key);
          preview.found = preview.rows.length;
          preview.needLook = preview.rows.filter((x) => x.why).length;
          renderBody();
        });
        fix.append(edit, fixBtn, " · ", leave);
        li.append(fix);
      }
      list.append(li);
    }
    box.append(list);
    const row = el("div", "at-actions");
    const go = button(ok.length ? `Add ${ok.length} ${ok.length === 1 ? "person" : "people"}` : "Nobody to add yet", "pill green", () => {
      if (!ok.length) return;
      const left = preview.needLook;
      add(ok.map((r) => r.person), left ? `${left} left out: fix ${left === 1 ? "it" : "them"} and add again.` : "");
    });
    go.disabled = !ok.length;
    row.append(go, button("Cancel", "pill grey", () => { preview = null; pasted = ""; view = null; renderBody(); }), el("span", "at-dim small", "You can undo this."));
    box.append(row);
    return box;
  }

  function pasteBox() {
    const box = el("div", "at-paste");
    box.append(el("h3", "at-h", "Paste your list"));
    const area = el("textarea", "field at-area");
    area.rows = 7;
    area.placeholder = "Name, Email, Car\nDana Whitfield, dana.w@example.com, 911 Carrera T\nPriya Raman <priya@example.com>\ntbecker@example.com";
    area.setAttribute("aria-label", "Paste your list");
    area.value = pasted;
    box.append(el("p", "at-dim", "Paste anything: rows from a spreadsheet, or emails from an email. One person per line. Header rows are fine."), area);
    const out = el("div", "at-live");
    if (preview?.source === "paste") out.append(previewBox());
    box.append(out);
    let timer = 0;
    area.addEventListener("input", () => {
      pasted = area.value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        preview = area.value.trim() ? { ...previewPaste(area.value), source: "paste" } : null;
        out.replaceChildren(...(preview ? [previewBox()] : []));
      }, 200);
    });
    if (!preview) box.append(button("Cancel", "pill grey", () => { view = null; renderBody(); }));
    return box;
  }

  function oneBox() {
    const box = el("form", "at-one");
    box.noValidate = true;
    box.append(el("h3", "at-h", "Add someone"));
    const field = (label, type, name) => {
      const l = el("label", "at-f");
      const i = el("input", "field");
      i.type = type;
      i.name = name;
      l.append(el("span", "", label), i);
      return l;
    };
    box.append(field("Email", "email", "email"), field("Name (optional)", "text", "name"), field("Car (optional)", "text", "car"));
    const msg = el("p", "at-said");
    const row = el("div", "at-actions");
    const addBtn = el("button", "pill green", "Add");
    addBtn.type = "submit";
    row.append(addBtn, button("Done", "pill grey", () => { view = registered().length ? "list" : null; renderBody(); }));
    box.append(row, msg);
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(box);
      const email = String(data.get("email") || "").trim();
      const why = emailProblem(email);
      if (why) { msg.textContent = `That address ${why}.`; box.elements.email.focus(); return; }
      const before = drive().attendees.map((p) => ({ ...p }));
      const person = { email, status: "registered", ...(data.get("name") ? { name: String(data.get("name")).trim() } : {}), ...(data.get("car") ? { car: String(data.get("car")).trim() } : {}) };
      drive().attendees = merge(drive().attendees, [person]).list;
      undo = { before };
      save();
      box.reset();
      msg.textContent = `Added ${person.name || email}.`;
      box.elements.email.focus();
    });
    return box;
  }

  // ── the list ──
  function listBox() {
    const box = el("div", "at-list");
    const top = el("div", "at-top");
    top.append(el("h3", "at-h", "Your attendees"),
      button("Add more", "pill grey", () => { said = ""; view = drive().addHow === "self" ? "self" : "start"; renderBody(); }),
      button("Invite more people", "pill grey", () => { view = "invite"; renderBody(); }));
    box.append(top, el("p", "at-meter", attendeeLine(drive())));
    if (said) {
      const s = el("p", "at-said", said);
      if (undo) s.append(" ", button("Undo", "textlink", undoAdd));
      box.append(s);
    }
    // The board's tabs (Going / Waitlist / Maybe / Can't make it), each with its count.
    const tabs = listTabs(everyone());
    if (!TAB_WORDS[listTab] || (listTab === "invited" && !tabs.invited.length)) listTab = "going";
    const tabRow = el("div", "at-seg at-tabs");
    tabRow.setAttribute("role", "tablist");
    tabRow.setAttribute("aria-label", "Who's coming");
    for (const key of ["going", "waitlist", "maybe", "no", ...(tabs.invited.length ? ["invited"] : [])]) {
      const t = button(`${TAB_WORDS[key]} · ${tabs[key].length}`, `at-seg-b${listTab === key ? " on" : ""}`, () => { listTab = key; renderBody(); });
      t.setAttribute("role", "tab");
      t.dataset.tab = key;
      t.setAttribute("aria-selected", String(listTab === key));
      tabRow.append(t);
    }
    // A spot open on a day with someone waiting: Promote next, on every tab.
    const opens = drive().days.map((d) => ({ d, ...openFor(d) })).filter((x) => x.open > 0 && waitlistFor(drive().attendees, x.d.id).length);
    const openRows = opens.map(({ d, open }) => {
      const row = el("p", "at-actions at-open");
      row.append(el("span", "", `${openText(open)}${drive().days.length > 1 ? ` on Day ${drive().days.indexOf(d) + 1}` : ""}.`),
        button("Promote next", "pill green small", () => waitDo("drive_waitlist_promote_next", { p_day_id: d.id }, "", { promotes: true })));
      return row;
    });
    const table = el("table", "at-table");
    const head = el("tr");
    for (const h of ["Name", "Email", "Car", "Likes to drive", "Status"]) head.append(el("th", "", h));
    const thead = el("thead");
    thead.append(head);
    head.append(el("th", "", ""));
    const tbody = el("tbody");
    // By RSVP time as times (the server's "-08:00" and an import's "Z" mix), then by name.
    const at = (p) => { const t = Date.parse(p.registered_at || ""); return Number.isFinite(t) ? t : Infinity; };
    const people = [...(tabs[listTab] || [])].sort((a, b) => (at(a) - at(b)) || (a.name || a.email).localeCompare(b.name || b.email));
    for (const p of people) {
      const tr = el("tr");
      tr.dataset.id = p.id;
      const name = el("td");
      name.append(el("b", "", p.name || "—"));
      if (p.first_timer) name.append(" ", el("span", "chip first", "1st drive"));
      const status = el("td", "", STATUS_WORDS[p.status] || p.status);
      if (p.waitlisted?.length) status.append(" ", el("span", "chip warn", "Waitlist"));
      const remove = button("×", "clear", () => removePerson(p));
      remove.setAttribute("aria-label", `Remove ${p.name || p.email}`);
      const cell = el("td");
      cell.append(remove);
      tr.append(name, el("td", "", p.email), el("td", "", p.car || ""), el("td", "", STYLE_WORD[p.style] || ""), status, cell);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    if (org()?.tier === "group") box.append(rolesBox());
    box.append(...openRows, tabRow);
    if (listTab === "waitlist") {
      for (const d of drive().days) {
        const w = waitBox(d);
        if (w) box.append(w);
      }
      if (!tabs.waitlist.length) box.append(el("p", "at-dim", "Nobody's waiting."));
    }
    // The waitlist's last word stays when its panel goes (the last one promoted).
    if (waitSaid) {
      const ws = el("p", "at-said at-wait-said", waitSaid);
      ws.setAttribute("aria-live", "polite");
      box.append(ws);
    }
    if (listTab !== "waitlist") {
      box.append(table);
      if (!people.length) box.append(el("p", "at-dim", "Nobody here."));
    }
    return box;
  }

  // ── removing someone: on the server at once when the drive is there, so
  // a spot they held goes to the next on the waitlist (auto approval; App
  // Dev's drive_attendees_remove → promoted), who's emailed as after
  // Promote next. A drive not on Carve yet: from the draft, sent later.
  async function removePerson(p, done = null) {
    const d = drive();
    const who = p.name || p.email;
    undo = null;
    if (!api || !d.synced?.created || !(d.synced.attendees || []).includes(p.id)) {
      d.attendees = d.attendees.filter((x) => x !== p);
      said = `Removed ${who}.`;
      save();
      return done ? done() : renderBody();
    }
    said = "Removing…";
    renderBody();
    try {
      const out = await api.rpc("drive_attendees_remove", { p_attendee_ids: [p.id] });
      d.attendees = d.attendees.filter((x) => x.id !== p.id);
      d.synced.attendees = (d.synced.attendees || []).filter((id) => id !== p.id);
      if (d.base) delete d.base[`att:${p.id}`];
      // The drive as the server has it now: who moved up.
      const got = out?.attendees ? out : null;
      if (got) {
        const byId = new Map(got.attendees.map((a) => [a.id, a]));
        for (const x of d.attendees) {
          const a = byId.get(x.id);
          if (!a) continue;
          delete x.waitlisted;
          delete x.waitlistAt;
          Object.assign(x, waitlistFields(a.days || []));
          if (a.status) x.status = a.status;
        }
        d.server = keepServer(got) || d.server;
      }
      const promoted = out?.promoted || [];
      const lines = [`Removed ${who}.`];
      for (const id of promoted) {
        const name = nameOf(id);
        let sent = false;
        try { sent = !!(await api.callFunction("drive-send", { drive_id: d.id, audience: "waitlist", attendee_ids: [id] }))?.sent; } catch { sent = false; }
        lines.push(`${name} moved up from the waitlist.${sent ? " We emailed them." : " Send updates to tell them."}`);
      }
      said = lines.join(" ");
      save();
    } catch {
      said = `Couldn't remove ${who}. Try again.`;
    }
    return done ? done() : renderBody();
  }

  // ── Add people yourself (Registered, no invitation) ──
  let selfRows = null;
  function selfBox() {
    selfRows ||= [{ email: "", name: "" }, { email: "", name: "" }, { email: "", name: "" }];
    const box = el("div", "at-self");
    box.append(el("h3", "at-h", "Add your registered people"), el("p", "at-dim", "They count as registered, and no invitation is sent. They get the route when you send it."));
    const head = el("div", "at-mail-head");
    head.append(el("span", "", "Email"), el("span", "", "Name"));
    box.append(head);
    const ok = () => selfRows.filter((r) => r.email && !emailProblem(r.email));
    const addBtn = el("button", "pill green", "");
    addBtn.type = "button";
    const sync = () => { const n = ok().length; addBtn.textContent = n ? `Add ${n} ${n === 1 ? "person" : "people"}` : "Add people"; addBtn.disabled = !n; };
    selfRows.forEach((r, n) => {
      const row = el("div", "at-mail-row");
      const email = el("input", "field");
      email.type = "email";
      email.value = r.email;
      email.setAttribute("aria-label", `Email ${n + 1}`);
      email.addEventListener("input", () => { r.email = email.value.trim(); sync(); });
      const name = el("input", "field");
      name.value = r.name;
      name.setAttribute("aria-label", `Name ${n + 1}`);
      name.addEventListener("input", () => { r.name = name.value.trim(); });
      row.append(email, name);
      if (r.email && emailProblem(r.email)) row.append(el("span", "at-note", `That address ${emailProblem(r.email)}.`));
      box.append(row);
    });
    const row = el("div", "at-actions");
    addBtn.addEventListener("click", () => {
      const people = ok().map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}), status: "registered", source: "email" }));
      if (!people.length) return;
      selfRows = null;
      add(people);
    });
    sync();
    row.append(button("+ Add row", "textlink", () => { selfRows.push({ email: "", name: "" }); renderBody(); }), addBtn);
    if (registered().length) row.append(button("Done", "pill grey", () => { selfRows = null; view = "list"; renderBody(); }));
    box.append(row);
    if (said) box.append(el("p", "at-said", said));
    return box;
  }

  // ── Just share the route link: checked-in drivers (App Dev's route_link) ──
  let removingCheckin = null;
  let confirmingOpen = false;
  /// drive_route_link_open (0085): a draft goes out, as a send does.
  async function openRouteLink(d, rotate) {
    const out = await api.rpc("drive_route_link_open", { p_drive_id: d.id, p_rotate: rotate });
    d.server = { ...(d.server || {}), route_link: out, ...(d.server?.status === "draft" || !d.server?.status ? { status: "sent" } : {}) };
    save();
    return out;
  }
  function routeLinkBox() {
    const d = drive();
    const box = el("div", "at-routelink");
    const link = d.server?.route_link?.url ?? null;
    const card = linkCard({
      el, url: link, label: "Your route link", driveName: d.name,
      onRotate: api && d.synced?.created ? async () => (await openRouteLink(d, true))?.url : null,
      refusal: routeLinkRefusal,
    });
    box.append(card);
    if (!link && api && d.synced?.created) {
      const make = async () => {
        confirmingOpen = false;
        try {
          await openRouteLink(d, false);
          said = "";
        } catch (failure) {
          said = routeLinkRefusal(failure);
        }
        renderBody();
      };
      const draft = (d.server?.status ?? "draft") === "draft";
      if (draft && confirmingOpen) {
        const cf = el("div", "at-confirm");
        cf.setAttribute("role", "alertdialog");
        cf.append(el("span", "", "Making the route link puts the drive out, as sending does. Anyone with the link sees the route."),
          button("Make it", "pill green small", make),
          button("Cancel", "pill grey small", () => { confirmingOpen = false; renderBody(); }));
        box.append(cf);
      } else {
        box.append(button("Make the route link", "pill green", draft ? () => { confirmingOpen = true; renderBody(); } : make));
      }
    }
    box.append(el("p", "at-dim", "Share it in your club chat or newsletter. Drivers who open it and sign in to Carve are checked in, get offline maps, and show here. Anyone can skip that and still see the route."));
    // Checked in: everyone who came in by the link.
    const checked = d.attendees.filter((p) => p.checked_in_at || p.source === "link").sort((a, b) => String(a.checked_in_at || "").localeCompare(String(b.checked_in_at || "")));
    const h = el("h4", "at-h4", `Checked in · ${checked.length}`);
    box.append(h);
    const over = d.server?.checkins?.over_cap || 0;
    if (over) box.append(el("p", "at-said", `${over} checked-in ${over === 1 ? "driver is" : "drivers are"} past your plan's spots. They see the route, without offline maps.${d.server?.offer_club ? " Club has room for everyone." : ""}`));
    if (!checked.length) box.append(el("p", "at-dim", "Nobody yet."));
    const ul = el("ul", "at-checked");
    for (const p of checked) {
      const li = el("li", "at-checked-row");
      li.dataset.id = p.id;
      const who = el("div", "at-who");
      who.append(el("b", "", p.name || p.email), el("span", "at-dim", [p.name ? p.email : "", p.car, p.checked_in_at ? `Checked in ${new Date(p.checked_in_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""].filter(Boolean).join(" · ")));
      li.append(who);
      if (p.waitlisted?.length) li.append(el("span", "chip warn", "Waitlist"));
      if (removingCheckin === p.id) {
        const cf = el("div", "at-confirm");
        cf.setAttribute("role", "alertdialog");
        cf.append(el("span", "", `Remove ${p.name || p.email}? Their spot goes to the next person on the waitlist.`),
          button("Remove", "pill small", () => { removingCheckin = null; removePerson(p); }),
          button("Cancel", "pill grey small", () => { removingCheckin = null; renderBody(); }));
        li.append(cf);
      } else {
        const rm = button("Remove", "textlink", () => { removingCheckin = p.id; renderBody(); });
        rm.setAttribute("aria-label", `Remove ${p.name || p.email}`);
        li.append(rm);
      }
      ul.append(li);
    }
    box.append(ul);
    const removed = d.server?.removed_checkins || [];
    if (removed.length) box.append(el("p", "at-dim small", `Removed, and can't check back in: ${removed.map((r) => r.name || r.email).join(", ")}. Add them again to undo it.`));
    // Importing is the path with more (Chris).
    const note = el("div", "at-more");
    note.append(el("p", "", "Importing your list gets you more: groups, leads and sweeps in everyone's email before the drive; reminders and updates; spots and the waitlist; and you know who's coming before the day."),
      button("Import instead", "pill grey", () => { drive().addHow = "import"; view = null; save(); render(); }));
    box.append(note);
    if (said) box.append(el("p", "at-said", said));
    return box;
  }

  // The switch at the top: change how, any time.
  function howSwitch() {
    const seg = el("div", "at-seg at-how");
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "How you add registered people");
    const now = drive().addHow || "import";
    for (const h of HOW) {
      const b = button(h.short, `at-seg-b${now === h.value ? " on" : ""}`, () => { drive().addHow = h.value; view = null; said = ""; save(); render(); });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(now === h.value));
      seg.append(b);
    }
    return seg;
  }

  // ── the Group plan's Lead and Sweep (no Groups step) ──
  function rolesBox() {
    const box = el("div", "at-roles");
    box.append(el("h4", "at-h4", "Lead and sweep"), el("p", "at-dim small", "Optional. They get the route with their role in it."));
    const current = drive().boards?.[drive().days[0]?.id]?.groups?.[0] || {};
    const coming = drive().attendees.filter((p) => p.status === "going" || p.status === "registered");
    const row = el("div", "at-actions");
    const picks = {};
    for (const [key, label] of [["lead", "Lead"], ["sweep", "Sweep"]]) {
      const l = el("label", "at-f");
      const sel = el("select", "field");
      sel.name = key;
      sel.append(new Option("Nobody", ""), ...coming.map((p) => new Option(p.name || p.email, p.id)));
      sel.value = coming.some((p) => p.id === current[key]) ? current[key] : "";
      sel.addEventListener("change", () => {
        singleGroup(drive(), { lead: picks.lead.value || null, sweep: picks.sweep.value || null });
        save();
        renderBody();
      });
      picks[key] = sel;
      l.append(el("span", "", label), sel);
      row.append(l);
    }
    box.append(row);
    return box;
  }

  // ── each day's waitlist (spots and waitlists, the user 11/8 late) ──
  // Promote, Promote next, Remove and the order go to the server, then the
  // drive is read back; someone promoted on a sent drive is emailed at once.
  let waitBusy = false;
  let waitSaid = "";
  let waitlistsAt = 0;
  const nameOf = (id) => { const p = drive().attendees.find((x) => x.id === id); return p ? p.name || p.email : "They"; };
  async function loadWaitlists() {
    try {
      const { days, places } = fromWaitlists(await api.rpc("drive_waitlists", { p_drive_id: drive().id }) || []);
      for (const p of drive().attendees) if (places[p.id]) p.waitlistAt = { ...(p.waitlistAt || {}), ...places[p.id] };
      drive().waitlists = days;
      waitlistsAt = Date.now();
      save();
      return true;
    } catch {
      return false;
    }
  }
  function refreshWaitlists() {
    if (!api || !drive().synced?.created || !api.account?.() || Date.now() - waitlistsAt < 20_000) return;
    if (!drive().attendees.some((p) => p.waitlisted?.length)) return;
    waitlistsAt = Date.now();
    loadWaitlists().then((ok) => { if (ok) renderBody(); });
  }
  async function tellPromoted(id) {
    const who = nameOf(id);
    if (drive().server?.status !== "sent") return `${who} is in.`;
    try {
      const answer = await api.callFunction("drive-send", { drive_id: drive().id, audience: "waitlist", attendee_ids: [id] });
      if (answer?.sent) return `${who} is in. We emailed them.`;
      if (answer?.skipped_unsubscribed) return `${who} is in. They've stopped this club's emails, so nothing was sent.`;
      return `${who} is in. Send updates to tell them.`;
    } catch {
      return `${who} is in, but the email didn't go. Send updates to tell them.`;
    }
  }
  async function waitDo(call, args, done, { promotes = false } = {}) {
    if (waitBusy || !api) return;
    if (!drive().synced?.created) { waitSaid = "Send it to yourself first, so the drive is on Carve."; return renderBody(); }
    waitBusy = true;
    waitSaid = "Saving…";
    renderBody();
    try {
      const result = await api.rpc(call, args);
      const promoted = promotes ? args.p_attendee_id || result?.promoted || null : null;
      const got = await api.rpc("drive_get", { p_drive_id: drive().id });
      if (got) {
        const byId = new Map((got.attendees || []).map((a) => [a.id, a]));
        for (const p of drive().attendees) {
          const a = byId.get(p.id);
          if (!a) continue;
          delete p.waitlisted;
          delete p.waitlistAt;
          Object.assign(p, waitlistFields(a.days || []));
          if (a.status) p.status = a.status;
        }
        drive().server = keepServer(got);
        save();
      }
      await loadWaitlists();
      waitSaid = promoted ? await tellPromoted(promoted) : done;
    } catch (failure) {
      const code = failure?.data?.message || failure?.message;
      waitSaid = code === "full" ? "No spot is open. Promote someone by name to go past the limit."
        : code === "not_found" && call === "drive_waitlist_promote_next" ? "Nobody is waiting."
        : "Couldn't change the waitlist. Try again.";
    } finally {
      waitBusy = false;
      renderBody();
    }
  }
  /// A day's limit and open spots, as the server counts them when it has.
  function openFor(d) {
    const server = drive().server?.days?.find((x) => x.id === d.id);
    const counted = drive().waitlists?.[d.id];
    const tier = org();
    const limit = counted ? counted.limit : server?.limit ?? (Number.isInteger(d.spots) ? d.spots : tier?.tier === "group" ? tier.drive_cap ?? null : null);
    const going = counted?.coming ?? server?.counts?.coming ?? drive().attendees.filter((p) => (p.status === "going" || p.status === "registered") && !p.waitlisted?.includes(d.id)).length;
    return { limit, open: counted && Number.isInteger(counted.open) ? counted.open : openSpots(limit, going) };
  }
  function waitBox(d) {
    const list = waitlistFor(drive().attendees, d.id);
    if (!list.length) return null;
    const box = el("div", "at-wait");
    box.dataset.day = d.id;
    const many = drive().days.length > 1;
    box.append(el("h4", "at-h4", `${many ? `Day ${drive().days.indexOf(d) + 1} · ` : ""}Waitlist · ${waitingText(list.length)}`));
    const ul = el("ol", "at-wait-list");
    list.forEach((p, i) => {
      const li = el("li", "at-wait-item");
      li.dataset.id = p.id;
      const up = button("↑", "g-wait-move", () => waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: moved(list, i, i - 1) }, `${p.name || p.email} moved up.`));
      up.disabled = i === 0;
      up.setAttribute("aria-label", `Move ${p.name || p.email} up`);
      const down = button("↓", "g-wait-move", () => waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: moved(list, i, i + 1) }, `${p.name || p.email} moved down.`));
      down.disabled = i === list.length - 1;
      down.setAttribute("aria-label", `Move ${p.name || p.email} down`);
      const promote = button("Promote", "pill green small", () => waitDo("drive_waitlist_promote", { p_attendee_id: p.id, p_day_id: d.id }, "", { promotes: true }));
      promote.setAttribute("aria-label", `Promote ${p.name || p.email}`);
      const remove = button("Remove", "textlink small", () => waitDo("drive_waitlist_remove", { p_attendee_id: p.id, p_day_id: d.id }, `${p.name || p.email} is off the waitlist.`));
      remove.setAttribute("aria-label", `Remove ${p.name || p.email} from the waitlist`);
      const grip = el("span", "gb-grip");
      grip.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.8"/><circle cx="15" cy="6" r="1.8"/><circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/><circle cx="9" cy="18" r="1.8"/><circle cx="15" cy="18" r="1.8"/></svg>';
      li.append(grip, el("span", "who", placeText(p, i)), up, down, promote, remove);
      ul.append(li);
    });
    box.append(ul);
    // Drag to reorder (drag.js): the whole new order to drive_waitlist_order.
    drags.push(makeDraggable(box, {
      item: ".at-wait-item", zone: ".at-wait-list", handle: ".gb-grip",
      onDrop: ([id], _zone, index) => {
        const moving = list.find((p) => p.id === id);
        const rest = list.filter((p) => p.id !== id);
        rest.splice(index, 0, moving);
        if (rest.every((p, i) => p.id === list[i].id)) return;
        waitDo("drive_waitlist_order", { p_day_id: d.id, p_attendee_ids: rest.map((p) => p.id) }, `${moving.name || moving.email} moved to #${index + 1}.`);
      },
    }));
    return box;
  }
  let drags = []; // the waitlists' drag wiring, undone on each redraw

  // ── Inviting (No, or Invite more): four questions, then email or a link ──
  const invite = () => (drive().invite ||= {});
  const inviteAnswers = () => {
    const a = {};
    const i = drive().invite || {};
    if ("description" in i) a.description = drive().description || null;
    if ("answerBy" in i) a.answer_by = i.answerBy;
    if (i.approval) a.approval = i.approval;
    if (i.by) a.by = i.by;
    return a;
  };
  const inviteHolder = el("div", "ask");
  const spotsWord = () => {
    const s = drive().days?.[0]?.spots;
    return Number.isInteger(s) ? `up to ${s}` : "until it's full";
  };
  const iq = ask(inviteHolder, {
    el,
    questions: [
      { key: "description", label: "What people know", kind: "text", optional: true, alts: [{ value: null, label: "No description" }], title: "What should people know about the drive?",
        help: "Goes in the invitation. The route itself stays private until people are confirmed.", placeholder: "Santa Cruz Mountains to Carmel, about 180 miles, lunch stop.",
        initial: () => drive().description || "", text: (v) => v || "No description" },
      { key: "answer_by", label: "Answer by", kind: "custom", title: "When should people answer by?",
        when: () => answerByDefault(drive().days?.[0]?.date, today()).ask,
        help: "One week before the drive, so you have time to set up groups. We remind anyone who hasn't answered 2 days before. After that, new yeses go on the waitlist.",
        text: (v) => (v ? shortDate(v) : "No deadline"),
        render: (box, { value, submit }) => {
          const input = el("input", "ask-input");
          input.type = "date";
          input.value = value || answerByDefault(drive().days?.[0]?.date, today()).date || "";
          input.setAttribute("aria-label", "Answer by");
          const row = el("div", "ask-row");
          row.append(button("OK", "ask-ok", () => input.value && submit(input.value)), button("No deadline", "ask-skip", () => submit(null)));
          input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value) { e.preventDefault(); submit(input.value); } });
          box.append(input, row);
        } },
      { key: "approval", label: "Sign-ups", kind: "choice", title: "How do you want to approve sign-ups?",
        options: [{ value: "auto", label: "Automatically", sub: `First come, first served, ${spotsWord()}. Then the waitlist.` },
          { value: "manual", label: "I'll approve each one", sub: "Nobody gets the route until you approve them." }],
        text: (v) => (v === "manual" ? "I'll approve each one" : "Automatically") },
      { key: "by", label: "Invite by", kind: "choice", title: "How do you want to invite people?",
        options: [{ value: "email", label: "Invite by email", sub: "Type or paste their emails. Carve sends the invitations." },
          { value: "link", label: "Share a sign-up link", sub: "Post it in your newsletter, club chat or social pages. There's a QR code too." }] },
    ],
    answers: inviteAnswers,
    onAnswer: (key, value) => {
      const i = invite();
      if (key === "description") { i.description = true; drive().description = value || ""; }
      if (key === "answer_by") i.answerBy = value;
      if (key === "approval") i.approval = value;
      if (key === "by") i.by = value;
      save();
      renderBody();
    },
  });
  const inviteDone = () => {
    const i = drive().invite || {};
    return "description" in i && ("answerBy" in i || !answerByDefault(drive().days?.[0]?.date, today()).ask) && !!i.approval && !!i.by;
  };

  // The email rows (email-rows.js): 3 to start, "+ Add row", pasted or uploaded lists fill more.
  let previewTab = "invite";
  let inviteSaid = "";
  function inviteBox() {
    const box = el("div", "at-invite");
    inviteHolder.dataset.focus = "on";
    box.append(inviteHolder);
    iq.render();
    if (!inviteDone()) return box;
    const i = invite();
    const seg = el("div", "at-seg");
    seg.setAttribute("role", "tablist");
    for (const [value, label] of [["email", "Invite by email"], ["link", "Share a sign-up link"]]) {
      const b = button(label, `at-seg-b${i.by === value ? " on" : ""}`, () => { i.by = value; save(); renderBody(); });
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(i.by === value));
      seg.append(b);
    }
    box.append(seg);
    box.append(i.by === "link" ? linkBox() : mailBox());
    return box;
  }

  function mailBox() {
    const wrap = el("div", "at-mail");
    const left = el("div", "at-mail-rows");
    mailRows().render();
    left.append(mailRows().el);
    if (picking) left.append(pickBox());
    const sentSaid = el("p", "at-said", inviteSaid || "");
    sentSaid.id = "at-send-said";
    sentSaid.setAttribute("aria-live", "polite");
    left.append(sentSaid);
    // The preview, with its two tabs (rendered here until App Dev's 0080).
    const right = el("div", "at-pv");
    const ph = el("div", "at-pv-head");
    ph.append(el("b", "", "Email preview"), el("span", "chip", "Not sent"));
    const tabs = el("div", "at-seg small");
    for (const [value, label] of [["invite", "Invitation"], ["yes", "After they say yes"]]) {
      const b = button(label, `at-seg-b${previewTab === value ? " on" : ""}`, () => { previewTab = value; renderBody(); });
      b.setAttribute("aria-pressed", String(previewTab === value));
      tabs.append(b);
    }
    const pv = invitePreview(drive(), org(), previewTab);
    const frame = el("div", "at-pv-frame");
    frame.append(el("p", "at-pv-subject", pv.subject), ...pv.lines.map((l) => el("p", "", l)));
    right.append(ph, tabs, frame);
    wrap.append(left, right);
    const foot = el("div", "at-actions");
    const sendBtn = el("button", "pill green", "");
    sendBtn.type = "button";
    sendBtn.className = "pill green at-send";
    const test = button("Send a test to me", "pill grey", () => send("me"));
    sendBtn.addEventListener("click", () => send("everyone"));
    foot.append(test, sendBtn);
    const box = el("div", "at-mailbox");
    box.append(wrap, foot);
    syncSend = () => {
      const n = goodRows().length;
      sendBtn.textContent = n ? `Send ${n} ${n === 1 ? "invitation" : "invitations"}` : "Send invitations";
      sendBtn.disabled = !n && !drive().attendees.some((p) => p.status === "invited");
    };
    syncSend();
    return box;
  }
  // The rows themselves (email-rows.js, shared with the Pre-run step): kept
  // across renders; what paste or upload found is said in #at-send-said.
  let mail = null;
  let syncSend = () => {};
  const mailRows = () => (mail ||= emailRows({
    el,
    onChange: () => syncSend(),
    onSaid: (text) => { inviteSaid = text; renderBody(); },
    more: () => (api && drive().orgId ? [button("Pick from your club's members", "textlink", () => { picking = picking ? null : { book: null, chosen: new Set(), q: "" }; renderBody(); if (picking) loadBook(); })] : []),
  }));
  // "Pick from your club's members": the club's address book (org_book, 0082).
  let picking = null; // { book, chosen: Set of emails, q }
  const fromClub = new Set(); // rows picked from the book: added with source "club"
  async function loadBook() {
    try {
      picking.book = await api.rpc("org_book", { p_org_id: drive().orgId }) || [];
    } catch {
      picking.book = [];
      picking.failed = true;
    }
    renderBody();
  }
  function pickBox() {
    const box = el("div", "at-pick");
    if (!picking.book) { box.append(el("p", "at-dim", "Loading your club's members…")); return box; }
    if (picking.failed) { box.append(el("p", "at-said", "Your club's members couldn't be loaded. Try again.")); return box; }
    if (!picking.book.length) { box.append(el("p", "at-dim", "Your club's list is empty. Add members on the club page.")); return box; }
    const on = new Set(mailRows().emails().map((r) => r.email.toLowerCase()).concat(drive().attendees.map((p) => p.email.toLowerCase())));
    const find = el("input", "field");
    find.type = "search";
    find.placeholder = "Search by name or email";
    find.value = picking.q;
    find.setAttribute("aria-label", "Search your club's members");
    const list = el("ul", "at-pick-list");
    const draw = () => {
      const q = picking.q.trim().toLowerCase();
      list.replaceChildren(...picking.book.filter((m) => !q || `${m.name || ""} ${m.email}`.toLowerCase().includes(q)).map((m) => {
        const li = el("li", "");
        const l = el("label", "at-pick-row");
        const cb = el("input");
        cb.type = "checkbox";
        const already = on.has(m.email.toLowerCase());
        cb.checked = already || picking.chosen.has(m.email);
        cb.disabled = already;
        cb.addEventListener("change", () => { if (cb.checked) picking.chosen.add(m.email); else picking.chosen.delete(m.email); addBtn.textContent = picking.chosen.size ? `Add ${picking.chosen.size}` : "Add"; });
        l.append(cb, el("span", "", m.name ? `${m.name} · ${m.email}` : m.email));
        if (already) l.append(el("span", "at-note", "on the list"));
        li.append(l);
        return li;
      }));
    };
    find.addEventListener("input", () => { picking.q = find.value; draw(); });
    const addBtn = button("Add", "pill grey small", () => {
      const picked = picking.book.filter((m) => picking.chosen.has(m.email));
      for (const m of picked) fromClub.add(m.email.toLowerCase());
      fillRows(picked.map((m) => ({ email: m.email, name: m.name || "" })));
      inviteSaid = picked.length ? `${picked.length} from your club's members.` : "";
      picking = null;
      renderBody();
    });
    draw();
    box.append(find, list, addBtn);
    return box;
  }
  const goodRows = () => mailRows().emails();
  const fillRows = (people) => mailRows().add(people);
  async function send(audience) {
    // The typed rows join the list as invited, then the shell's send goes.
    const people = goodRows().map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}), status: "invited", source: fromClub.has(r.email.toLowerCase()) ? "club" : "email" }));
    if (people.length) {
      drive().attendees = merge(drive().attendees, people).list;
      save();
    }
    if (!sendInvitations) {
      inviteSaid = people.length ? `Added ${people.length} to invite. Send them from the Send step.` : "Add someone first.";
      if (audience !== "me") mailRows().clear();
      return renderBody();
    }
    inviteSaid = "Sending…";
    renderBody();
    try {
      // The shell's send says how it went in #at-send-said (send.js's own words).
      const words = await sendInvitations(audience);
      inviteSaid = typeof words === "string" ? words : document.getElementById("at-send-said")?.textContent || "Sent.";
      if (audience !== "me") mailRows().clear();
    } catch (failure) {
      inviteSaid = failure?.message || "Couldn't send. Try again.";
    }
    renderBody();
  }

  // The link's server side (App Dev's): drive_signup_open makes or reopens
  // it (p_rotate: a new one, the old link and QR code stop working),
  // drive_signup_close shuts it. drive_get carries signup { token, open, count }.
  let rotateArmed = false;
  async function linkDo(call, args, words) {
    try {
      const out = await api.rpc(call, { p_drive_id: drive().id, ...args });
      drive().signup = { ...(drive().signup || {}), ...(out?.token ? { token: out.token } : {}), open: call !== "drive_signup_close" };
      inviteSaid = words;
      save();
    } catch (failure) {
      // A cancelled drive, or one past its last day, can't take sign-ups (App Dev's closed).
      inviteSaid = (failure?.data?.message || failure?.message) === "closed"
        ? "This drive is over or cancelled, so sign-ups can't open."
        : "Couldn't change the sign-up link. Try again.";
    }
    rotateArmed = false;
    renderBody();
  }
  function linkBox() {
    const box = el("div", "at-link");
    box.append(el("h4", "at-h4", "Your sign-up link"));
    const token = drive().signup?.token || null;
    if (!token) {
      if (api && drive().synced?.created) box.append(button("Make the sign-up link", "pill green", () => linkDo("drive_signup_open", { p_rotate: false }, "")));
      else box.append(el("p", "at-dim", "Your sign-up link appears here once the drive is saved to Carve."));
      if (inviteSaid) box.append(el("p", "at-said", inviteSaid));
      return box;
    }
    if (drive().signup?.open === false) {
      box.append(el("p", "at-said", "Sign-ups are closed. The link says so to anyone who opens it."),
        button("Open sign-ups again", "pill grey", () => linkDo("drive_signup_open", { p_rotate: false }, "Sign-ups are open again.")));
      if (inviteSaid) box.append(el("p", "at-said", inviteSaid));
      return box;
    }
    const url = `carve.run/s/${token}`;
    box.append(el("p", "at-link-url", url));
    const row = el("div", "at-actions");
    row.append(button("Copy link", "pill grey", async () => {
      try { await navigator.clipboard.writeText(`https://${url}`); inviteSaid = "Link copied."; } catch { inviteSaid = "Couldn't copy. Select the link and copy it."; }
      renderBody();
    }), button("Download QR code", "pill grey", () => {
      if (!window.qrcode) return;
      const qr = window.qrcode(0, "M");
      qr.addData(`https://${url}`);
      qr.make();
      const a = el("a");
      a.href = qr.createDataURL(8, 16);
      a.download = `${(drive().name || "drive").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "drive"}-sign-up-qr.gif`;
      document.body.append(a);
      a.click();
      a.remove();
    }));
    box.append(row, el("p", "at-dim", `Post it in your newsletter, club chat or social pages. People sign up with their email.${invite().approval === "manual" ? " You approve each one." : ""}`));
    const manage = el("p", "at-or");
    manage.append(button("Close sign-ups", "textlink", () => linkDo("drive_signup_close", {}, "Sign-ups closed.")), " · ",
      button(rotateArmed ? "Make a new link: the old link and QR code stop working" : "New link", "textlink", () => {
        if (!rotateArmed) { rotateArmed = true; return renderBody(); }
        linkDo("drive_signup_open", { p_rotate: true }, "New link made. The old one and its QR code no longer work.");
      }));
    box.append(manage);
    const n = drive().signup?.count || 0;
    if (n) box.append(button(`${n} ${n === 1 ? "sign-up" : "sign-ups"} so far`, "pill grey", () => { view = "approve"; approveTab = "waiting"; loadSignups(); }));
    if (inviteSaid) box.append(el("p", "at-said", inviteSaid));
    return box;
  }

  // ── Approving sign-ups (Waiting / Approved / Waitlist / Declined) ──
  // App Dev's signups_list and signups_decide (item 3, after 11/15); until
  // they land the screen says so.
  let signups = null; // null: not loaded; [] once loaded
  let approveTab = "waiting";
  let approveSel = new Set();
  let approveSaid = "";
  async function loadSignups() {
    approveSaid = "";
    try {
      signups = signupRows(await api.rpc("signups_list", { p_drive_id: drive().id }));
    } catch {
      signups = null;
      approveSaid = "Sign-ups can't be loaded yet. Try again in a moment.";
    }
    renderBody();
  }
  async function decide(ids, decision) {
    if (!ids.length) return;
    approveSaid = "Saving…";
    renderBody();
    try {
      await api.rpc("signups_decide", { p_drive_id: drive().id, p_ids: ids, p_decision: decision });
      approveSel = new Set();
      const word = decision === "approve" ? "Approved" : "Declined";
      await loadSignups();
      approveSaid = `${word} ${ids.length === 1 ? "1 person" : `${ids.length} people`}.`;
    } catch {
      approveSaid = "Couldn't save that. Try again.";
    }
    renderBody();
  }
  function approveBox() {
    const box = el("div", "at-approve");
    const top = el("div", "at-top");
    const words = el("div", "");
    words.append(el("h3", "at-h", "Sign-ups to approve"), el("p", "at-dim", "From your sign-up link. Nobody gets the route until you approve them."));
    top.append(words);
    const spots = drive().days?.[0]?.spots;
    const approved = (signups || []).filter((r) => r.state === "approved").length;
    if (Number.isInteger(spots)) top.append(el("p", "at-meter", `${approved} of ${spots} spots filled · ${Math.max(0, spots - approved)} left`));
    box.append(top);
    if (signups === null) {
      box.append(el("p", "at-said", approveSaid || "Loading…"), button("Back", "pill grey", () => { view = null; renderBody(); }));
      return box;
    }
    const tabs = el("div", "at-seg");
    tabs.setAttribute("role", "tablist");
    for (const [key, label] of [["waiting", "Waiting"], ["approved", "Approved"], ["waitlist", "Waitlist"], ["declined", "Declined"]]) {
      const n = signups.filter((r) => r.state === key).length;
      const t = button(`${label} · ${n}`, `at-seg-b${approveTab === key ? " on" : ""}`, () => { approveTab = key; approveSel = new Set(); renderBody(); });
      t.setAttribute("role", "tab");
      t.setAttribute("aria-selected", String(approveTab === key));
      tabs.append(t);
    }
    box.append(tabs);
    const list = signups.filter((r) => r.state === approveTab);
    if (approveTab === "waiting" && approveSel.size) {
      const bulk = el("div", "at-bulk");
      bulk.append(el("b", "", `${approveSel.size} selected`), button("Approve", "pill green small", () => decide([...approveSel], "approve")),
        button("Decline", "pill grey small", () => decide([...approveSel], "decline")), button("Clear", "textlink", () => { approveSel = new Set(); renderBody(); }));
      box.append(bulk);
    }
    const table = el("table", "at-table");
    const head = el("tr");
    if (approveTab === "waiting") {
      const all = el("input");
      all.type = "checkbox";
      all.checked = list.length > 0 && list.every((r) => approveSel.has(r.id));
      all.setAttribute("aria-label", "Select all");
      all.addEventListener("change", () => { approveSel = all.checked ? new Set(list.map((r) => r.id)) : new Set(); renderBody(); });
      const th = el("th");
      th.append(all);
      head.append(th);
    }
    for (const h of ["Signed up", "Name", "Email", "Car", "Drives", "First time", ""]) head.append(el("th", "", h));
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const r of list) {
      const tr = el("tr");
      tr.dataset.id = r.id;
      if (approveTab === "waiting") {
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = approveSel.has(r.id);
        cb.setAttribute("aria-label", `Select ${r.name || r.email}`);
        cb.addEventListener("change", () => { if (cb.checked) approveSel.add(r.id); else approveSel.delete(r.id); renderBody(); });
        const td = el("td");
        td.append(cb);
        tr.append(td);
      }
      const when = r.at ? new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
      const first = el("td");
      if (r.first_timer) first.append(el("span", "chip first", "1st drive"));
      const act = el("td");
      if (approveTab === "waiting" || approveTab === "waitlist") act.append(button("Approve", "pill green small", () => decide([r.id], "approve")));
      if (approveTab !== "declined") act.append(" ", button("Decline", "pill grey small", () => decide([r.id], "decline")));
      tr.append(el("td", "", when), el("td", "", r.name), el("td", "", r.email), el("td", "", r.car), el("td", "", STYLE_WORD[r.style] || ""), first, act);
      tbody.append(tr);
    }
    table.append(thead, tbody);
    box.append(table);
    if (!list.length) box.append(el("p", "at-dim", "Nobody here."));
    box.append(el("p", "at-dim small", `Sorted by sign-up time, oldest first.${Number.isInteger(spots) ? ` Approving past ${spots} puts people on the waitlist.` : ""} Declined people get a short "this drive is full" note.`));
    if (approveSaid) box.append(el("p", "at-said", approveSaid));
    box.append(button("Back", "pill grey", () => { view = null; renderBody(); }));
    return box;
  }

  function renderBody() {
    for (const x of drags) x.destroy();
    drags = [];
    const d = drive();
    if (typeof d.registered !== "boolean") return body.replaceChildren();
    const how = d.addHow || (d.registered && d.attendees.length ? "import" : null);
    // Registered, but how not answered yet: the question is open above.
    if (d.registered && !how && !view) return body.replaceChildren();
    const has = registered().length > 0;
    const v = view || (!d.registered ? (has ? "list" : "invite") : how === "link" ? "link" : has ? "list" : how === "self" ? "self" : "start");
    const parts = { start, paste: pasteBox, file: () => (preview ? previewBox() : start()), one: oneBox, list: listBox, invite: inviteBox, approve: approveBox, self: selfBox, link: routeLinkBox }[v]();
    body.replaceChildren(...(d.registered && how && v !== "invite" && v !== "approve" ? [howSwitch(), parts] : [parts]));
    if (v === "start" || v === "list") said = v === "list" ? said : "";
  }

  function render() {
    q.render();
    renderBody();
    refreshWaitlists();
  }
  render();

  return {
    render,
    done: () => typeof drive().registered === "boolean" && registered().length > 0,
    summary: () => attendeeLine(drive()) || "",
    /// For the step bar: go on to Groups.
    next: () => go("groups"),
    /// Open the list on a tab (the overview's waitlist tile, "See everyone"):
    /// "going" | "waitlist" | "maybe" | "no".
    open: (tab = "going") => { listTab = tab; view = "list"; render(); },
  };
}
