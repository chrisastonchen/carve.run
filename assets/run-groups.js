// Run groups on carve.run's club drive page (spec
// ~/Carve/backlog/Run-Groups-Spec-2026-11-21.md §1.3–1.6; server 0130/0131):
// Import a list (and Update from a list), the groups board, the person
// panel with Unlink, and the Lead / Sweep picker with its optional invite.
// Carve links names to accounts by itself: nothing here picks an account.
// Every change is a click, never a page load.

import { $, el, rpc } from "/assets/club-api.js?v=ab5108fda2";
import { SUPABASE_URL, SUPABASE_KEY, accessToken } from "/assets/carve-session.js?v=9c9566882f";
import { rowsOfFile } from "/plan/xlsx.js";
import { parseTable } from "/plan/attendees.js";
import {
  COLUMNS, MOST_GROUPS, REFUSAL, ROLE_WORD, STATUS, applyPatch, boardLine, findPeople, guessColumns, importRows, initials, linkWords,
  lastWordKey, looksLikeHeader, nameKey, notSavedLine, peopleLine, printGroups, removingLine, repeatLine, summaryParts, whereText,
} from "/assets/run-groups-words.js?v=97350e9980";
import { dayText, meetLeave } from "/assets/club-words.js?v=b2e82d803a";

const said = (failure) => REFUSAL[failure?.code] || failure?.message || "Something went wrong. Try again.";

/// A modal over the page (a <dialog>): its box, and close().
function modal(title, cls = "") {
  const d = el("dialog", `rg-modal ${cls}`.trim());
  const head = el("div", "rg-mhead");
  const h = el("h2", "", title);
  h.id = `rg-h-${crypto.randomUUID().slice(0, 8)}`;
  d.setAttribute("aria-labelledby", h.id);
  const x = el("button", "rg-x", "✕");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  head.append(h, x);
  const body = el("div", "rg-mbody");
  d.append(head, body);
  document.body.append(d);
  const close = () => { d.close(); d.remove(); };
  x.addEventListener("click", close);
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  // A click on the backdrop closes it, but not the second click of the
  // double-click that opened it (QA 11/23): only a press that starts more
  // than 400 ms after it opened.
  const opened = performance.now();
  let pressed = 0;
  d.addEventListener("pointerdown", () => { pressed = performance.now(); });
  d.addEventListener("click", (e) => { if (e.target === d && pressed - opened > 400) close(); });
  d.showModal();
  return { d, body, h, close };
}

function button(text, cls, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// ── Import a list (§1.3) ──

/// Upload or paste a list, match its columns, see it as Carve will import
/// it (run_group_import's dry run), then import. `update`: Update from a
/// list, with the names an update would remove listed and kept unless the
/// organizer ticks them off (0131).
export function openImport({ driveId, update = false, paste = false, onDone }) {
  const m = modal(update ? "Update from a list" : "Import a list", "rg-import");
  const st = { rows: null, file: "", header: true, columns: null, preview: null, remove: false };
  const pick = el("div", "rg-pick");
  const fileIn = el("input");
  fileIn.type = "file";
  fileIn.accept = ".xlsx,.csv,.tsv,.txt,text/csv,text/plain";
  fileIn.id = "rg-file";
  fileIn.className = "rg-file";
  const fileLabel = el("label", "go", "Choose a file");
  fileLabel.htmlFor = "rg-file";
  const pasteBox = el("textarea", "rg-paste");
  pasteBox.id = "rg-paste";
  pasteBox.rows = 5;
  pasteBox.placeholder = "Or paste the list here, with its header row (Name, Group, …)";
  pasteBox.setAttribute("aria-label", "Paste the list");
  const fileName = el("p", "rg-filename");
  fileName.hidden = true;
  pick.append(el("p", "rg-note", "Upload the MotorsportReg export (.xlsx or .csv), or paste it."), fileIn, fileLabel, fileName, pasteBox);
  const match = el("div", "rg-match");
  match.hidden = true;
  const table = el("div", "rg-preview");
  const foot = el("div", "rg-foot");
  const note = el("p", "rg-said");
  note.setAttribute("role", "status");
  const go = button(update ? "Update" : "Import", "go", () => commit());
  go.id = "rg-import-go";
  go.disabled = true;
  foot.append(note, go);
  m.body.append(pick, match, table, foot);
  if (paste) setTimeout(() => pasteBox.focus(), 0);

  const loaded = (rows, name) => {
    st.rows = rows.filter((r) => r.some((c) => String(c || "").trim())).length ? rows : [];
    st.file = name;
    if (!st.rows.length) { note.textContent = "That list is empty."; return; }
    st.header = looksLikeHeader(st.rows[0]);
    st.columns = guessColumns(st.header ? st.rows[0] : st.rows[0].map((_, i) => `Column ${i + 1}`));
    fileName.hidden = !name;
    fileName.textContent = name ? `${name} · ${st.rows.length - (st.header ? 1 : 0)} rows` : "";
    renderMatch();
    preview();
  };
  fileIn.addEventListener("change", async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    note.textContent = "";
    try {
      loaded(await rowsOfFile(f, parseTable), f.name);
      pasteBox.value = "";
    } catch (e) {
      note.textContent = e?.message === "unsupported" ? "Save it as .xlsx or .csv, then choose it again." : "That file couldn't be read. Save it as .xlsx or .csv and try again.";
    }
  });
  let typing = null;
  pasteBox.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { if (pasteBox.value.trim()) loaded(parseTable(pasteBox.value), ""); }, 400);
  });

  function renderMatch() {
    match.hidden = false;
    const head = st.header ? st.rows[0] : st.rows[0].map((_, i) => `Column ${i + 1}`);
    match.replaceChildren(el("h3", "", "Match your columns"));
    const row = el("div", "rg-cols");
    for (const c of COLUMNS) {
      const lab = el("label", "rg-col");
      lab.append(el("small", "", c.label));
      const s = el("select");
      s.dataset.col = c.key;
      if (!c.needed) s.append(new Option(c.none, "-1"));
      head.forEach((h, i) => s.append(new Option(String(h || `Column ${i + 1}`), String(i))));
      if (c.needed && st.columns[c.key] < 0) s.prepend(new Option("Pick a column", "-1"));
      s.value = String(st.columns[c.key]);
      s.addEventListener("change", () => { st.columns[c.key] = Number(s.value); preview(); });
      lab.append(s);
      row.append(lab);
    }
    match.append(row, el("p", "rg-note", "\"Lead\" and \"Sweep\" in the Group column set each group's roles. \"Guest\" or \"Passenger\" in Driver / Passenger marks a passenger."));
  }

  async function preview() {
    go.disabled = true;
    if (st.columns.name < 0 || st.columns.group < 0) { table.replaceChildren(); note.textContent = "Pick the Name and Group columns."; return; }
    note.textContent = "Reading the list…";
    try {
      st.preview = await rpc("run_group_import", { p_drive_id: driveId, p_rows: importRows(st.rows, st.columns, st.header), p_dry: true });
    } catch (failure) {
      note.textContent = said(failure);
      return;
    }
    renderPreview();
  }

  function renderPreview() {
    const p = st.preview;
    const t = el("table", "rg-table");
    const hr = el("tr");
    for (const h of ["In the sheet", "Imported as", "Group", "Role", "Waiver", "Driver / Passenger"]) hr.append(el("th", "", h));
    t.append(hr);
    for (const r of p.rows) {
      const tr = el("tr");
      tr.append(el("td", "", r.sheet_name));
      const as = el("td", "", r.name);
      if (r.problem === "group_over_15") { tr.classList.add("rg-out"); as.append(el("span", "rg-flag", " · group over 15, not imported")); }
      // The same person as a row above (0136): added once, from that row.
      else if (r.repeat_of != null) { tr.classList.add("rg-out"); as.append(el("span", "rg-flag", ` · same as row ${r.repeat_of}, not added again`)); }
      else if (r.same_name) as.append(el("span", "rg-flag", " · same name, different emails"));
      else if (r.first_name_only) as.append(el("span", "rg-flag", " · first name only"));
      tr.append(as);
      tr.append(el("td", "rg-num", r.problem ? r.group_cell : r.group ?? ""));
      const role = el("td");
      if (r.role) role.append(el("span", `rg-role ${r.role}`, ROLE_WORD[r.role]));
      tr.append(role);
      tr.append(el("td", r.waiver === false ? "rg-warn" : r.waiver ? "rg-ok" : "", r.waiver === true ? "✓ Signed" : r.waiver === false ? "Not signed" : ""));
      tr.append(el("td", "", r.passenger ? "Passenger" : "Driver"));
      t.append(tr);
    }
    const parts = el("p", "rg-sum");
    parts.append(...summaryParts(p).flatMap((s, i) => (i ? [" · ", s] : [s])));
    if (p.over_15) parts.append(` · ${p.over_15} with a group over ${MOST_GROUPS}, not imported`);
    const nodes = [parts];
    // Who the sheet has more than once (0136), counted apart from the people.
    if (p.repeats?.length) {
      const box = el("div", "rg-repeats");
      for (const x of p.repeats) box.append(el("p", "rg-note", repeatLine(x)));
      nodes.push(box);
    }
    nodes.push(t);
    // Update from a list: who isn't on it, kept unless ticked off (0131).
    if (p.removing?.length) {
      const box = el("div", "rg-removing");
      box.append(el("p", "o-strong", removingLine(p.removing.length)));
      box.append(el("p", "rg-note", p.removing.map((x) => x.name).join(", ")));
      const tick = el("label", "rg-tick");
      const c = el("input");
      c.type = "checkbox";
      c.id = "rg-remove";
      c.checked = st.remove;
      c.addEventListener("change", () => { st.remove = c.checked; goWords(); });
      tick.append(c, ` Remove ${p.removing.length === 1 ? "them" : `these ${p.removing.length}`}`);
      box.append(tick, el("p", "rg-note", "Leave it unticked to keep them on the board. People you added by hand, Leads and Sweeps are never removed here."));
      nodes.push(box);
    }
    table.replaceChildren(...nodes);
    note.textContent = "";
    goWords();
    go.disabled = !p.people;
  }
  const goWords = () => {
    const p = st.preview;
    if (!p) return;
    const people = `${p.people} ${p.people === 1 ? "person" : "people"}`;
    go.textContent = update ? `Update ${people}${st.remove && p.removing?.length ? `, remove ${p.removing.length}` : ""}` : `Import ${people}`;
  };

  async function commit() {
    go.disabled = true;
    note.textContent = update ? "Updating…" : "Importing…";
    try {
      const remove = st.remove ? (st.preview.removing || []).map((x) => x.id) : [];
      const done = await rpc("run_group_import", { p_drive_id: driveId, p_rows: importRows(st.rows, st.columns, st.header), p_dry: false, p_remove: remove });
      m.close();
      onDone?.(done.board);
    } catch (failure) {
      go.disabled = false;
      note.textContent = said(failure);
    }
  }
  return m;
}

// ── The board (§1.4) ──

// Each board on the page: the last board Carve answered (`confirmed`), the
// changes it hasn't answered yet (`pending`, in order) and what's drawn.
// A change shows at once (Chris 11/23: a move took seconds); its save goes
// to Carve one at a time, in the order made; a refusal puts it back.
const boards = new WeakMap();
const shownBoard = (s) => s.pending.reduce((b, p) => applyPatch(b, p.id, p.patch), s.confirmed);
let panel = null; // the one person panel: { id, refresh(board), close() }

/// One column per group, Lead and Sweep slots, names to drag; names with no
/// group in their own column. `board`: run_group_board's, as Carve answered.
/// `set(board)`: the page's, for a new one from Carve (it draws it again
/// here). `show(board)`: the page's header, for what's drawn. `print`:
/// { drive, club } for the printed sheet.
export function renderBoard(box, board, { driveId, set, show, print }) {
  let s = boards.get(box);
  if (!s) {
    s = { box, driveId, pending: [], chain: Promise.resolve(), drawn: "", dragging: false, pressing: false, later: false };
    boards.set(box, s);
    // A press held on the board (a name being clicked): its cards stay until
    // it's let go, so the click lands (QA 11/23).
    box.addEventListener("pointerdown", () => { s.pressing = true; });
    const letGo = () => { if (!s.pressing) return; s.pressing = false; if (s.later && !s.dragging) { s.later = false; draw(s); } };
    window.addEventListener("pointerup", letGo, true);
    window.addEventListener("pointercancel", letGo, true);
    findBox(s);
    if (print) printSetup(s);
  }
  Object.assign(s, { confirmed: board, set, show, print: print || s.print });
  draw(s);
}

/// What's drawn now (Carve's board and the changes on their way).
export const boardShown = (box) => { const s = boards.get(box); return s ? shownBoard(s) : null; };

function draw(s) {
  const b = shownBoard(s);
  const key = JSON.stringify(b);
  s.show?.(b);
  panel?.refresh(b);
  // Not mid-drag or mid-press: the cards stay put until it's let go.
  if (s.dragging || s.pressing) { s.later = true; return; }
  if (key === s.drawn) return;
  s.drawn = key;
  drawBoard(s, b);
}

/// A change to one name, shown now, saved in the background. One not sent
/// yet that this one replaces (the same name, the same fields: a quick run
/// of group clicks) isn't sent: the last click is what's saved. A refusal
/// takes it back and says which change it was; later changes stay.
function save(s, id, patch) {
  const change = { id, patch, sent: false };
  const same = (c) => !c.sent && c.id === id && Object.keys(c.patch).sort().join() === Object.keys(patch).sort().join();
  s.pending = s.pending.filter((c) => !same(c));
  s.pending.push(change);
  $("rg-said").textContent = "";
  draw(s);
  s.chain = s.chain.then(async () => {
    if (!s.pending.includes(change)) return;
    change.sent = true;
    const name = shownBoard(s).entries.find((e) => e.id === id)?.name || "Someone";
    try {
      const b = await rpc("run_group_entry_update", { p_entry_id: id, p_patch: patch });
      s.pending.splice(s.pending.indexOf(change), 1);
      // A refusal this one has put right isn't news any more.
      if (s.refused && same({ ...s.refused, sent: false })) { s.refused = null; $("rg-said").textContent = ""; }
      s.set(b);
    } catch (failure) {
      s.pending.splice(s.pending.indexOf(change), 1);
      draw(s);
      s.refused = change;
      sayRefused($("rg-said"), failure, notSavedLine(name, patch, REFUSAL[failure?.code]));
    }
  });
  return s.chain;
}

/// A save that didn't land, said where `p` is. The sign-in ended (QA
/// 11/23): said so, with Sign in; the board stays as it is.
function sayRefused(p, failure, line) {
  if (failure?.code !== "sign_in") { p.textContent = line; return; }
  p.replaceChildren("Your sign-in has ended, so that change didn't save. ",
    button("Sign in", "textlink rg-signin", () => window.carveSignIn?.({ returnTo: location.pathname + location.search })));
}

function drawBoard(s, board) {
  const byGroup = new Map();
  for (const e of board.entries) {
    const k = e.group ?? 0;
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(e);
  }
  const cols = el("div", "rg-cols-board");
  const groups = [...Array(board.group_count).keys()].map((i) => i + 1);
  if (byGroup.has(0)) groups.push(0);
  for (const n of groups) {
    const people = byGroup.get(n) || [];
    const col = el("section", "rg-group");
    col.dataset.group = String(n);
    const h = el("div", "rg-gh");
    h.append(el("span", "rg-gn", n ? String(n) : "No group"), el("span", "rg-gc", `${people.length} ${people.length === 1 ? "person" : "people"}`));
    col.append(h);
    if (n) for (const role of ["lead", "sweep"]) {
      const who = people.find((e) => e.role === role);
      const slot = el("div", "rg-slot");
      slot.append(el("span", "rg-sr", ROLE_WORD[role]));
      if (who) {
        slot.dataset.id = who.id;
        slot.append(button(who.name, "rg-name", () => openPerson({ entry: who, box: s.box })));
        if (who.passenger) slot.append(el("span", "rg-tag", "Passenger"));
        slot.append(status(who));
      } else slot.append(button(`Add a ${ROLE_WORD[role]}`, "textlink rg-add", () => openPicker({ group: n, role, box: s.box })));
      col.append(slot);
    }
    const list = el("ul", "rg-people");
    for (const e of people.filter((x) => !(n && x.role))) {
      const li = el("li", "rg-p");
      li.draggable = true;
      li.dataset.id = e.id;
      li.append(el("span", "rg-grip", "⋮⋮"), button(e.name, "rg-name", () => openPerson({ entry: e, box: s.box })));
      if (e.passenger) li.append(el("span", "rg-tag", "Passenger"));
      li.append(status(e));
      li.addEventListener("dragstart", (ev) => { ev.dataTransfer.setData("text/plain", e.id); ev.dataTransfer.effectAllowed = "move"; li.classList.add("dragging"); s.dragging = true; });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        s.dragging = false;
        if (s.later) { s.later = false; draw(s); }
      });
      list.append(li);
    }
    col.append(list);
    // Drop a name here: it moves to this group at once (its role, if any, goes).
    col.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", (ev) => {
      ev.preventDefault();
      col.classList.remove("over");
      s.dragging = false;
      s.pressing = false;
      s.later = false;
      const id = ev.dataTransfer.getData("text/plain");
      const e = shownBoard(s).entries.find((x) => x.id === id);
      if (!e || (e.group ?? 0) === n) return draw(s);
      save(s, id, n ? { group: n, role: null } : { group: null });
    });
    cols.append(col);
  }
  s.box.replaceChildren(cols);
}

function status(e) {
  const cls = { linked: "rg-st ok", confirmed: "rg-st ok", invited: "rg-st", no_account: "rg-st no" }[e.status] || "rg-st";
  return el("span", cls, STATUS[e.status] || "");
}

/// The page's header line and buttons, for the board's numbers.
export function boardHeader(board) {
  return boardLine(board);
}

// ── Find someone (Chris 11/23) ──

/// The search over the whole list, above the board: suggestions as you
/// type (up to 8), each with where they are; a pick scrolls to their card,
/// marks it and opens their panel. On the board already read: no call.
function findBox(s) {
  const wrap = el("div", "rg-find");
  const q = el("input", "rg-find-q");
  q.type = "search";
  q.id = "rg-find-q";
  q.placeholder = "Find someone";
  q.autocomplete = "off";
  q.setAttribute("aria-label", "Find someone on the list");
  q.setAttribute("role", "combobox");
  q.setAttribute("aria-expanded", "false");
  q.setAttribute("aria-controls", "rg-find-list");
  const list = el("div", "rg-find-list");
  list.id = "rg-find-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.append(q, list);
  s.box.before(wrap);
  let at = -1;
  let hits = [];
  const close = () => { list.hidden = true; q.setAttribute("aria-expanded", "false"); at = -1; };
  const mark = () => [...list.querySelectorAll(".rg-find-o")].forEach((o, i) => {
    o.setAttribute("aria-selected", String(i === at));
    if (i === at) q.setAttribute("aria-activedescendant", o.id);
  });
  const drawList = () => {
    const found = findPeople(shownBoard(s).entries, q.value);
    hits = found.hits;
    at = hits.length ? 0 : -1;
    if (!q.value.trim()) return close();
    list.replaceChildren(...hits.map((e, i) => {
      const o = el("div", "rg-find-o");
      o.id = `rg-find-${i}`;
      o.setAttribute("role", "option");
      o.append(el("b", "", e.name), el("span", "", whereText(e)));
      if (e.passenger) o.append(el("span", "rg-tag", "Passenger"));
      o.addEventListener("mousedown", (ev) => ev.preventDefault());
      o.addEventListener("click", () => pick(e));
      return o;
    }));
    if (!hits.length) list.append(el("p", "rg-note", "No one on the list by that name."));
    if (found.total > hits.length) list.append(el("p", "rg-note rg-more", `Showing ${hits.length} of ${found.total}. Type more of the name.`));
    list.hidden = false;
    q.setAttribute("aria-expanded", "true");
    mark();
  };
  const pick = (e) => {
    close();
    q.value = "";
    const card = s.box.querySelector(`[data-id="${CSS.escape(e.id)}"]`);
    if (card) {
      card.scrollIntoView({ block: "center", behavior: "instant" });
      card.classList.remove("rg-hit");
      void card.offsetWidth;
      card.classList.add("rg-hit");
      setTimeout(() => card.classList.remove("rg-hit"), 1600);
    }
    openPerson({ entry: e, box: s.box });
  };
  q.addEventListener("input", drawList);
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (list.hidden) drawList();
      if (!hits.length) return;
      ev.preventDefault();
      at = (at + (ev.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length;
      mark();
    } else if (ev.key === "Enter") {
      if (at >= 0 && hits[at]) { ev.preventDefault(); pick(hits[at]); }
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      q.value = "";
      close();
    }
  });
  document.addEventListener("click", (ev) => { if (!wrap.contains(ev.target)) close(); });
}

// ── Print (Chris 11/23) ──

/// The groups on paper: a sheet built from what's drawn, shown only to the
/// printer (run-groups.css's @media print). No emails, links or waivers.
function printSetup(s) {
  const go = document.getElementById("g-print");
  if (!go) return;
  go.hidden = false;
  go.addEventListener("click", () => { printSheet(s); window.print(); });
  window.addEventListener("beforeprint", () => printSheet(s));
}

function printSheet(s) {
  const b = shownBoard(s);
  const { drive = {}, club = "" } = s.print || {};
  let sheet = document.getElementById("rg-print");
  if (!sheet) {
    sheet = el("div", "rg-print");
    sheet.id = "rg-print";
    document.body.append(sheet);
  }
  // Each page's header: the drive's name and the club's, in the page's
  // margin (Chrome's @page margin boxes; others print it on the first page).
  let page = document.getElementById("rg-print-page");
  if (!page) {
    page = el("style");
    page.id = "rg-print-page";
    document.head.append(page);
  }
  const css = (x) => `"${String(x || "").replace(/[\\"]/g, "\\$&").replace(/\s+/g, " ")}"`;
  page.textContent = `@media print { @page { @top-left { content: ${css(drive.name || "Run groups")}; } @top-right { content: ${css(club)}; } } }`;
  const top = el("div", "rg-ptop");
  top.append(el("h1", "", drive.name || "Run groups"));
  if (club) top.append(el("p", "", club));
  for (const d of (drive.days || []).filter((x) => x.date || x.meet)) {
    top.append(el("p", "", [dayText(d.date), meetLeave(d)[0]].filter(Boolean).join(" · ")));
  }
  top.append(el("p", "rg-ptot", `${peopleLine(b.entries)} · ${b.group_count} ${b.group_count === 1 ? "group" : "groups"}`));
  // The groups in two columns, filling each page; a group never split.
  const flow = el("div", "rg-pgs");
  for (const g of printGroups(b)) {
    const c = el("section", "rg-pg");
    c.append(el("h2", "", g.title), el("p", "rg-pc", g.line));
    const ul = el("ul");
    for (const [who, role] of [[g.lead, "Lead"], [g.sweep, "Sweep"]]) {
      if (!who) continue;
      const li = el("li", "rg-prole");
      li.append(el("b", "", `${role}: `), who.name);
      if (who.passenger) li.append(el("span", "rg-ptag", " Passenger"));
      ul.append(li);
    }
    for (const e of g.rest) {
      const li = el("li");
      li.append(e.name);
      if (e.passenger) li.append(el("span", "rg-ptag", " Passenger"));
      ul.append(li);
    }
    c.append(ul);
    flow.append(c);
  }
  sheet.replaceChildren(top, flow);
}

// ── The person panel (§1.5) ──

/// One panel at a time, kept on its person while the board changes. Group,
/// role and Driver / Passenger show at once and save in the background.
export function openPerson({ entry, box }) {
  if (panel && panel.id === entry.id) return panel;
  panel?.close();
  const s = boards.get(box);
  const m = modal(entry.name, "rg-person");
  const note = el("p", "rg-said");
  note.setAttribute("role", "status");
  const from = el("p", "rg-from");
  m.h.after(from);
  const content = el("div", "rg-pbody");
  m.body.append(content, note);
  const me = { id: entry.id, m };
  // Unlink, email and Remove wait for Carve (they can't be guessed).
  const call = async (fn, closeAfter = false) => {
    note.textContent = "";
    try {
      const b = await fn();
      s.set(b);
      if (closeAfter) me.close();
    } catch (failure) { sayRefused(note, failure, said(failure)); }
  };
  const quick = (patch) => {
    note.textContent = "";
    // What the board says about it, said here too (Sign in with it).
    save(s, entry.id, patch).then(() => { if (panel === me) note.replaceChildren(...[...$("rg-said").childNodes].map((n) => n.cloneNode(true))); note.querySelector(".rg-signin")?.addEventListener("click", () => window.carveSignIn?.({ returnTo: location.pathname + location.search })); });
  };
  let removing = false;
  let cur = entry; // the person as drawn now; every handler reads it
  // Built once (again only if the number of groups changes); a reply then
  // changes what's selected on the same buttons, never new ones, so a press
  // held while a reply lands still clicks (QA 11/23: 4 of 10 were lost).
  let built = null;
  const chip = (row, label, cls, onClick) => { const c = button(label, cls, onClick); row.append(c); return c; };
  const build = (b) => {
    const acc = el("div", "rg-acc");
    const mail = el("div", "rg-row");
    const email = el("input");
    email.type = "email";
    email.id = "rg-p-email";
    email.value = cur.email || "";
    email.placeholder = "Add an email";
    email.setAttribute("aria-label", "Email");
    const saved = el("span", "rg-saved", "Saved");
    saved.hidden = true;
    mail.append(email, button("Save", "go ghost", async () => {
      await call(() => rpc("run_group_entry_update", { p_entry_id: cur.id, p_patch: { email: email.value.trim() || null } }));
      // Saved, said in place for a moment (QA 11/23).
      if (!note.textContent) { saved.hidden = false; clearTimeout(me.savedTimer); me.savedTimer = setTimeout(() => { saved.hidden = true; }, 2500); }
    }), saved);
    const gs = el("div", "rg-chips");
    const groups = [];
    for (let n = 1; n <= b.group_count; n++) groups.push([n, chip(gs, String(n), "rg-chip rg-num", () => { if (cur.group !== n) quick({ group: n }); })]);
    groups.push([null, chip(gs, "No group", "rg-chip", () => { if (cur.group != null) quick({ group: null }); })]);
    const rs = el("div", "rg-chips");
    const roles = [[null, "None"], ["lead", "Lead"], ["sweep", "Sweep"]].map(([r, word]) => [r, chip(rs, word, "rg-chip", () => { if ((cur.role || null) !== r) quick({ role: r }); })]);
    const ps = el("div", "rg-chips");
    const kinds = [[false, "Driver"], [true, "Passenger"]].map(([v, word]) => [v, chip(ps, word, "rg-chip", () => { if (!!cur.passenger !== v) quick({ passenger: v }); })]);
    const remove = button("Remove from the list", "rg-remove-btn", () => { removing = true; update(); });
    const ask = el("div", "cv-confirm");
    const askLine = el("p", "o-strong");
    const row = el("div", "o-row");
    row.append(button("Remove", "go danger", () => call(() => rpc("run_group_entry_remove", { p_entry_id: cur.id }), true)),
      button("Keep", "textlink", () => { removing = false; update(); }));
    ask.append(askLine, row);
    content.replaceChildren(el("small", "rg-lbl", "Carve account"), acc, el("small", "rg-lbl", "Email (optional)"), mail,
      el("small", "rg-lbl", "Group"), gs, el("small", "rg-lbl", "Role"), rs, el("small", "rg-lbl", "Driver / Passenger"), ps, remove, ask);
    built = { count: b.group_count, acc, groups, roles, kinds, remove, ask, askLine, account: undefined };
  };
  const update = () => {
    const e = cur;
    // The account part only when it changes (Unlink is a button too).
    const accountNow = JSON.stringify([e.account, e.link, e.status, e.group]);
    if (built.account !== accountNow) {
      built.account = accountNow;
      if (e.account) {
        const w = el("div", "rg-acc-w");
        w.append(el("b", "", e.account.display_name || e.name), el("span", "", linkWords(e)));
        built.acc.replaceChildren(el("span", "cd-av", initials(e.account.display_name || e.name)), w,
          button("Unlink", "go ghost", () => call(() => rpc("run_group_entry_unlink", { p_entry_id: cur.id }))));
      } else built.acc.replaceChildren(el("span", "rg-acc-none", linkWords(e)));
    }
    for (const [n, c] of built.groups) c.setAttribute("aria-pressed", String((e.group ?? null) === n));
    for (const [r, c] of built.roles) { c.setAttribute("aria-pressed", String((e.role || null) === r)); c.disabled = !!r && e.group == null; }
    for (const [v, c] of built.kinds) c.setAttribute("aria-pressed", String(!!e.passenger === v));
    built.remove.hidden = removing;
    built.ask.hidden = !removing;
    built.askLine.textContent = `Remove ${e.name} from this drive's list?`;
  };
  me.refresh = (b) => {
    const e = b.entries.find((x) => x.id === entry.id);
    if (!e) return me.close();
    cur = e;
    m.h.textContent = e.name;
    const bits = [];
    if (e.sheet_name && e.sheet_name !== e.name) bits.push(`From the list: "${e.sheet_name}"`);
    if (e.passenger) bits.push("Passenger");
    from.textContent = bits.join(" · ");
    from.hidden = !bits.length;
    if (!built || built.count !== b.group_count) build(b);
    update();
  };
  me.close = () => { if (panel === me) panel = null; m.close(); };
  m.d.addEventListener("close", () => { if (panel === me) panel = null; });
  panel = me;
  me.refresh(shownBoard(s));
  // The modal's own X, Escape and backdrop close it; the panel goes with it.
  return me;
}

// ── The Lead / Sweep picker (§1.6) ──

export function openPicker({ group, role, box }) {
  const s = boards.get(box);
  const m = modal(`${ROLE_WORD[role]} for Group ${group}`, "rg-picker");
  m.body.append(el("p", "rg-note", "Choose someone on your list, or add a new name."));
  const q = el("input");
  q.type = "search";
  q.placeholder = "Type a name";
  q.setAttribute("aria-label", "Name");
  q.id = "rg-pick-q";
  const list = el("div", "rg-cands");
  const after = el("div", "rg-after");
  const note = el("p", "rg-said");
  note.setAttribute("role", "status");
  m.body.append(q, list, after, note);
  setTimeout(() => q.focus(), 0);
  const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const done = () => {
    const who = shownBoard(s).entries.find((e) => e.group === group && e.role === role);
    list.replaceChildren();
    q.hidden = true;
    if (who) chosen(who);
  };
  // Someone on the list: shown as theirs at once, saved in the background.
  const take = (e) => {
    note.textContent = "";
    save(s, e.id, { group, role });
    done();
  };
  // A new name waits for Carve (its id). Carve says no to a name already
  // on the list unless it's meant (0136): then the list is read again.
  const add = async (name, another) => {
    note.textContent = "";
    try {
      s.set(await rpc("run_group_entry_add", { p_drive_id: s.driveId, p_entry: { name, group, role, ...(another ? { another: true } : {}) } }));
      done();
    } catch (failure) {
      note.textContent = said(failure);
      if (failure?.code === "same_name") {
        try { s.set(await rpc("run_group_board", { p_drive_id: s.driveId })); } catch {}
        draw();
      }
    }
  };

  function draw() {
    const board = shownBoard(s);
    const typed = q.value.trim();
    const key = nameKey(typed);
    const t = fold(typed);
    // The same name (as Carve compares names) first, then the rest that fit.
    const same = key ? board.entries.filter((e) => nameKey(e.name) === key) : [];
    // A surname alone ("obrien", "o brien"): who has it, offered first; the
    // add stays (QA 11/23).
    const surname = key ? board.entries.filter((e) => !same.includes(e) && lastWordKey(e.name) === key) : [];
    const all = [...same, ...surname, ...board.entries.filter((e) => !same.includes(e) && !surname.includes(e) && (!t || fold(e.name).includes(t)))];
    const hits = all.slice(0, 8);
    list.replaceChildren(...hits.map((e) => {
      const b = button("", "rg-cand", () => take(e));
      const w = el("span", "rg-cand-w");
      w.append(el("b", "", e.name), el("span", "", [e.group ? `Group ${e.group}` : "No group", e.account ? "Linked to a Carve account" : "No Carve account"].join(" · ")));
      b.append(w);
      return b;
    }));
    // More than fit: say so, and how to find the rest.
    if (all.length > hits.length) list.append(el("p", "rg-note rg-more", `Showing ${hits.length} of ${all.length}. Type a name to find the rest.`));
    if (!typed) return;
    if (same.length) {
      list.append(el("p", "rg-note rg-same", `${same[0].name} is on the list already. Pick them above, or add someone else with the same name.`));
      list.append(button(`Add another ${same[0].name}`, "rg-cand rg-new", () => add(typed, true)));
    } else list.append(button(`+ Add "${typed}"`, "rg-cand rg-new", () => add(typed, false)));
  }
  q.addEventListener("input", draw);
  draw();

  // Picked, and no account: the optional invite by email.
  function chosen(who) {
    after.replaceChildren(el("p", "rg-picked", `${who.name} is Group ${group}'s ${ROLE_WORD[role]}.`));
    if (who.account) return;
    after.append(el("small", "rg-lbl", "Invite them to Carve (optional)"));
    const row = el("div", "rg-row");
    const email = el("input");
    email.type = "email";
    email.id = "rg-invite-email";
    email.value = who.email || "";
    email.placeholder = "Their email";
    email.setAttribute("aria-label", "Their email");
    const send = button("Send invite", "go", async () => {
      send.disabled = true;
      note.textContent = "";
      try {
        await s.chain;
        const answer = await inviteSend({ entry_id: who.id, email: email.value.trim() });
        if (answer.board) s.set(answer.board);
        note.textContent = answer.sent ? `Invite sent to ${email.value.trim()}.` : "Saved as Invited. Email sending is off here, so no email went out.";
      } catch (failure) {
        send.disabled = false;
        note.textContent = said(failure);
      }
    });
    send.id = "rg-invite-go";
    row.append(email, send);
    after.append(row, el("p", "rg-note", `They get this drive's link and a note that they're Group ${group}'s ${ROLE_WORD[role]}. When they sign up with this email, Carve links them.`));
  }
  return m;
}

/// run-group-invite (0130), as the organizer: {sent, dry_run?, board}.
async function inviteSend(body) {
  const token = await accessToken().catch(() => null);
  if (!token) throw Object.assign(new Error("Please sign in again."), { code: "sign_in" });
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/run-group-invite`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(REFUSAL[data?.error] || "The invite didn't go. Try again."), { code: data?.error });
  return data || {};
}

export { MOST_GROUPS };
