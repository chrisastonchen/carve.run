// A club drive's Meet and Leave as three native selects, "8 : 30 AM"
// (Chris, 11/14: the browser's time field has no popup in Safari): the
// hour 1–12, the minute 00, 15, 30 or 45, and AM or PM. A saved minute off
// those steps (8:34) is kept as an extra choice on that row only. Saved
// as HH:MM, as before; "– – –" until a time is picked.

export const MINUTES = [0, 15, 30, 45];

/// "08:34" → { hour: 8, minute: 34, half: "AM" }; null for no time.
export function timeParts(value) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || "");
  if (!m) return null;
  const h = Number(m[1]), minute = Number(m[2]);
  if (h > 23 || minute > 59) return null;
  return { hour: h % 12 || 12, minute, half: h < 12 ? "AM" : "PM" };
}

/// The other way: (8, 30, "PM") → "20:30"; "" while any part is missing.
export function timeValue(hour, minute, half) {
  if (!hour || minute === "" || minute == null || !half) return "";
  const h = (Number(hour) % 12) + (half === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(Number(minute)).padStart(2, "0")}`;
}

/// The minute choices for a saved time: the steps, and its own minute too.
export function minuteChoices(saved) {
  const m = timeParts(saved)?.minute;
  return m == null || MINUTES.includes(m) ? MINUTES : [...MINUTES, m].sort((a, b) => a - b);
}

const option = (value, text, selected) => {
  const o = document.createElement("option");
  o.value = String(value);
  o.textContent = text;
  if (selected) o.selected = true;
  return o;
};
/// "–" first, kept out of the list once a part is picked.
const blank = () => {
  const o = option("", "–", true);
  o.disabled = true;
  return o;
};

/// The three selects in a span that reads and sets like a field: .value is
/// HH:MM or "", focus() goes to the hour, and "change" bubbles from each.
/// label: "Meet time" or "Day 2 leave time", for each select's name.
export function timeSelects(value, label) {
  const box = document.createElement("span");
  box.className = "cd-tsel";
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", label);
  const hour = document.createElement("select");
  const minute = document.createElement("select");
  const half = document.createElement("select");
  hour.setAttribute("aria-label", `${label}: hour`);
  minute.setAttribute("aria-label", `${label}: minute`);
  half.setAttribute("aria-label", `${label}: AM or PM`);
  const fill = (v) => {
    const p = timeParts(v);
    hour.replaceChildren(blank(), ...Array.from({ length: 12 }, (_, i) => option(i + 1, String(i + 1), p?.hour === i + 1)));
    minute.replaceChildren(blank(), ...minuteChoices(v).map((m) => option(m, String(m).padStart(2, "0"), p?.minute === m)));
    half.replaceChildren(blank(), option("AM", "AM", p?.half === "AM"), option("PM", "PM", p?.half === "PM"));
    box.classList.toggle("blank", !p);
  };
  fill(value);
  // An hour picked first fills the rest (":00", AM) so the time is whole.
  hour.addEventListener("change", () => {
    if (minute.value === "") minute.value = "0";
    if (half.value === "") half.value = "AM";
  });
  box.addEventListener("change", () => box.classList.toggle("blank", !box.value));
  const sep = document.createElement("span");
  sep.className = "cd-tsep";
  sep.setAttribute("aria-hidden", "true");
  sep.textContent = ":";
  box.append(hour, sep, minute, half);
  Object.defineProperty(box, "value", {
    get: () => timeValue(hour.value, minute.value, half.value),
    set: (v) => fill(v),
  });
  box.focus = (o) => hour.focus(o);
  return box;
}
