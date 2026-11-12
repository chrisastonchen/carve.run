// One question at a time (the approved mock, 11/9): the planner's steps
// ask their questions in turn, and each answered one folds into a short
// line, "✓ Days  Several days  Change". Used by When (group.js) and by
// Attendees (attendees-step.js, 32512's).
//
//   const q = ask(container, { el, questions, answers, onAnswer, onDone });
//
// questions: [{ key, label, title, help?, kind, options?, placeholder?,
//   when?(answers), text?(value, answers), render?(box, ctx), initial?, alts?,
//   check?(value, answers) }]  check: a sentence to show instead of going
//   on (a number past the plan's cap), or null.
//   kind: "choice" (options [{value, label, sub?}], keys A, B, C), "text",
//   "number", "date", "time" or "custom" (render draws it and calls
//   ctx.submit(value)). when() false: the question isn't asked or counted.
//   alts: [{ value, label }] named ways past a text, number, date or time
//   question, beside OK ("No deadline"). There's no generic Skip (the
//   decisions file, 11/9): every way on is named.
// answers: { key: value } or a function giving it, the caller's (kept in
// the drive); onAnswer(key,
// value) stores it. onDone() once every asked question has an answer.
// → { render(), edit(key), focus(), get current }.

/// The questions asked, given the answers so far.
export const asked = (questions, answers) => questions.filter((q) => !q.when || q.when(answers));

const has = (answers, key) => Object.prototype.hasOwnProperty.call(answers, key);

/// Which question is open: the one being changed, else the first asked
/// one without an answer; null when all are answered.
export function nextQuestion(questions, answers, editing = null) {
  const shown = asked(questions, answers);
  if (editing && shown.some((q) => q.key === editing)) return editing;
  return shown.find((q) => !has(answers, q.key))?.key ?? null;
}

/// The folded line's words for an answer.
export function answerText(q, value, answers = {}) {
  if (q.text) return q.text(value, answers);
  const alt = q.alts?.find((a) => a.value === value);
  if (alt) return alt.label;
  if (value === null || value === undefined || value === "") return "None";
  if (q.kind === "choice") return q.options?.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}

const KEYS = "ABCDEFGHIJ";

export function ask(container, { el, questions, answers: given, onAnswer, onDone = () => {} }) {
  // The answers object, or a function giving it (the drive is swapped on a pull).
  const answers = typeof given === "function" ? given : () => given;
  let editing = null;
  let finished = false;

  function submit(key, value) {
    editing = null;
    onAnswer(key, value);
    render();
  }

  function folded(q) {
    const b = el("button", "ask-done");
    b.type = "button";
    b.innerHTML = '<svg class="ask-ck" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
    b.append(el("span", "ask-label", q.label || q.title), el("b", "", answerText(q, answers()[q.key], answers())), el("span", "ask-change", "Change"));
    b.setAttribute("aria-label", `${q.label || q.title}: ${answerText(q, answers()[q.key], answers())}. Change`);
    b.addEventListener("click", () => { editing = q.key; render({ focus: true }); });
    return b;
  }

  function open(q, n, of) {
    const box = el("div", "ask-q");
    box.dataset.key = q.key;
    box.append(el("span", "ask-n", `${n} of ${of}`));
    const h = el("h3", "ask-title", q.title);
    h.tabIndex = -1;
    box.append(h);
    if (q.help) box.append(el("p", "ask-help", q.help));
    const now = answers()[q.key];
    if (q.kind === "choice") {
      const list = el("div", "ask-choices");
      list.setAttribute("role", "group");
      list.setAttribute("aria-label", q.title);
      (q.options || []).forEach((o, i) => {
        const b = el("button", `ask-choice${now === o.value ? " on" : ""}`);
        b.type = "button";
        b.dataset.value = String(o.value);
        b.setAttribute("aria-pressed", String(now === o.value));
        b.append(el("kbd", "", KEYS[i]));
        const words = el("span", "ask-words");
        words.append(el("span", "ask-opt", o.label));
        if (o.sub) words.append(el("span", "ask-sub", o.sub));
        b.append(words);
        b.addEventListener("click", () => submit(q.key, o.value));
        list.append(b);
      });
      box.addEventListener("keydown", (e) => {
        if (e.target.closest("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
        const i = KEYS.indexOf(e.key.toUpperCase());
        if (i >= 0 && q.options?.[i]) { e.preventDefault(); submit(q.key, q.options[i].value); }
      });
      box.append(list);
    } else if (q.kind === "custom") {
      const body = el("div", "ask-custom");
      box.append(body);
      q.render?.(body, { value: now, answers: answers(), submit: (v) => submit(q.key, v) });
    } else {
      const input = el("input", "ask-input");
      input.type = q.kind === "number" ? "number" : q.kind === "date" ? "date" : q.kind === "time" ? "time" : "text";
      if (q.kind === "number") { input.min = "1"; input.step = "1"; input.inputMode = "numeric"; }
      input.placeholder = q.placeholder || "";
      input.value = now ?? q.initial?.(answers()) ?? "";
      input.setAttribute("aria-label", q.title);
      const row = el("div", "ask-row");
      const ok = el("button", "ask-ok", "OK");
      ok.type = "button";
      const go = () => {
        const raw = input.value.trim();
        if (!raw) return input.focus();
        const value = q.kind === "number" ? (raw ? Math.floor(Number(raw)) : null) : raw || null;
        if (q.kind === "number" && value !== null && !(value > 0)) return input.focus();
        const wrong = q.check?.(value, answers());
        if (wrong) { problem.textContent = wrong; problem.hidden = false; return input.focus(); }
        submit(q.key, value);
      };
      ok.addEventListener("click", go);
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      row.append(ok);
      // Named ways past it, beside OK.
      for (const a of q.alts || []) {
        const b = el("button", `ask-alt${now === a.value ? " on" : ""}`, a.label);
        b.type = "button";
        b.addEventListener("click", () => submit(q.key, a.value));
        row.append(b);
      }
      row.append(el("span", "ask-hint", "or press Enter"));
      const problem = el("p", "ask-problem");
      problem.hidden = true;
      problem.setAttribute("role", "alert");
      box.append(input, row, problem);
    }
    return box;
  }

  /// focus: into the open question even when focus was elsewhere (a
  /// Change, the step opening); otherwise only when it was already here.
  function render({ focus = false } = {}) {
    const a = answers();
    const shown = asked(questions, a);
    const current = nextQuestion(questions, a, editing);
    const parts = [];
    shown.forEach((q, i) => {
      if (q.key === current) parts.push(open(q, i + 1, shown.length));
      else if (has(a, q.key)) parts.push(folded(q));
    });
    const had = container.contains(document.activeElement);
    // The same question still open: what's been typed in it stays, and
    // the caret with it (a re-render from a save, or the club's plan
    // arriving, mustn't wipe it).
    const before = container.querySelector(".ask-q");
    // Not a custom question: it draws its own controls each time.
    const plain = questions.find((q) => q.key === current)?.kind !== "custom";
    const kept = plain && before?.dataset.key === current ? before.querySelector(".ask-input") : null;
    const typed = kept ? { value: kept.value, focused: document.activeElement === kept, start: kept.selectionStart, end: kept.selectionEnd } : null;
    container.replaceChildren(...parts);
    if (typed) {
      const input = container.querySelector(".ask-q .ask-input");
      if (input) {
        input.value = typed.value;
        if (typed.focused) {
          input.focus({ preventScroll: true });
          try { input.setSelectionRange(typed.start, typed.end); } catch { /* not a text input */ }
          return;
        }
      }
    }
    if (current) {
      const box = container.querySelector(".ask-q");
      // Into the open question, unless the person is elsewhere on the page.
      if (focus || had || container.dataset.focus !== "off") (box.querySelector("input, .ask-choice.on, .ask-choice") || box.querySelector(".ask-title"))?.focus({ preventScroll: true });
      finished = false;
    } else if (!finished) {
      finished = true;
      onDone();
    }
  }

  return {
    render,
    edit(key) { editing = key; render({ focus: true }); },
    /// Into the open question (the step just opened).
    focus() { render({ focus: true }); },
    get current() { return nextQuestion(questions, answers(), editing); },
  };
}
