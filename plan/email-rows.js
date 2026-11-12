// Email rows (the Attendees step's "Invite by email", and the Pre-run step's
// "Send by email", 11/9): 3 rows to start, "+ Add row", "Paste many at once"
// and "Upload a list" fill more. A bad address is flagged on its row and not
// counted; each address once (case aside).
//   emailRows({ el, start?, names?, onChange?, onSaid?, more? })
//     → { el, emails(), add(people), clear(), focus(), render() }
// - el: the step's element maker, el(tag, className?, text?).
// - names: a Name (optional) column (default true).
// - onChange(emails): after each edit, with the good rows [{ email, name? }].
// - onSaid(text): what paste or upload found ("3 added; couldn't read zz.");
//   without it the rows say it themselves, under the links.
// - more(): extra nodes after the links, each render (Attendees: "Pick from
//   your club's members").
// emails() → the good rows; add(people) → how many were new; clear() → back
// to the empty start rows.
import { emailProblem, parseInvites, parseTable, previewTable } from "./attendees.js?v=1";
import { rowsOfFile } from "./xlsx.js";

export function emailRows({ el, start = 3, names = true, onChange = () => {}, onSaid = null, more = () => [] }) {
  const blank = () => Array.from({ length: start }, () => ({ email: "", name: "" }));
  let rows = blank();
  let said = "";
  const root = el("div", "at-mail-rows");
  const button = (text, cls, onClick) => { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", onClick); return b; };
  const good = () => rows.filter((r) => r.email && !emailProblem(r.email)).map((r) => ({ email: r.email, ...(r.name ? { name: r.name } : {}) }));
  const changed = () => onChange(good());
  const say = (text) => { if (onSaid) onSaid(text); else { said = text; render(); } };

  function add(people) {
    rows = rows.filter((r) => r.email);
    const have = new Set(rows.map((r) => r.email.toLowerCase()));
    let added = 0;
    for (const p of people) {
      const key = String(p.email || "").toLowerCase();
      if (!key || have.has(key)) continue;
      rows.push({ email: p.email, name: p.name || "" });
      have.add(key);
      added++;
    }
    while (rows.length < start) rows.push({ email: "", name: "" });
    render();
    changed();
    return added;
  }

  function render() {
    const parts = [];
    const head = el("div", names ? "at-mail-head" : "at-mail-head one");
    head.append(el("span", "", "Email"), ...(names ? [el("span", "", "Name (optional)")] : []));
    parts.push(head);
    rows.forEach((r, n) => {
      const row = el("div", names ? "at-mail-row" : "at-mail-row one");
      const email = el("input", "field");
      email.type = "email";
      email.value = r.email;
      email.setAttribute("aria-label", `Email ${n + 1}`);
      email.addEventListener("input", () => { r.email = email.value.trim(); changed(); });
      row.append(email);
      if (names) {
        const name = el("input", "field");
        name.value = r.name;
        name.setAttribute("aria-label", `Name ${n + 1}`);
        name.addEventListener("input", () => { r.name = name.value.trim(); changed(); });
        row.append(name);
      }
      if (r.email && emailProblem(r.email)) row.append(el("span", "at-note", `That address ${emailProblem(r.email)}.`));
      parts.push(row);
    });
    parts.push(button("+ Add row", "textlink", () => { rows.push({ email: "", name: "" }); render(); root.querySelectorAll(".at-mail-row input[type=email]")[rows.length - 1]?.focus(); }));
    const links = el("p", "at-or");
    const file = el("input");
    file.type = "file";
    file.accept = ".csv,.tsv,.txt,.xlsx";
    file.className = "at-file at-invite-file";
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      if (!f) return;
      try {
        const got = previewTable(await rowsOfFile(f, parseTable));
        add(got.rows.filter((x) => !x.why).map((x) => x.person));
        say(`${got.found - got.needLook} added from ${f.name}${got.needLook ? `; ${got.needLook} left out` : ""}.`);
      } catch {
        say("That file couldn't be read. Save it as CSV or Excel (.xlsx), or paste the list.");
      }
    });
    const upload = el("label", "textlink", "Upload a list");
    upload.append(file);
    links.append(button("Paste many at once", "textlink", () => {
      const area = el("textarea", "field at-area");
      area.rows = 4;
      area.setAttribute("aria-label", "Paste emails");
      const ok = button("Add these", "pill grey small", () => {
        const { people, bad } = parseInvites(area.value);
        add(people);
        say(`${people.length} added${bad.length ? `; couldn't read ${bad.join(", ")}` : ""}.`);
      });
      links.after(area, ok);
      area.focus();
    }), " · ", upload);
    for (const node of more() || []) links.append(" · ", node);
    parts.push(links);
    if (!onSaid && said) parts.push(el("p", "at-said", said));
    root.replaceChildren(...parts);
  }
  render();

  return {
    el: root,
    emails: good,
    add,
    clear() { rows = blank(); said = ""; render(); changed(); },
    focus() { root.querySelector(".at-mail-row input[type=email]")?.focus(); },
    render,
  };
}
