// The public sign-up page's questions (carve.run/s/<token>; the approved
// mock 11/9, "Sign-up page on a phone"): one at a time, phone first.
// Email, name, phone (optional), what you'll drive (car or motorcycle,
// make and model typed: the garage picker waits on Chris, DevOps 11/9),
// driving style, and first time with the club. Pure, so the tests read it
// without a page: the page (signup.js) draws the questions and sends the
// answers to App Dev's signup function.

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export const STYLES = [
  { value: "touring", label: "Touring", sub: "Steady, scenic" },
  { value: "relaxed", label: "Relaxed", sub: "Easy pace" },
  { value: "spirited", label: "Spirited", sub: "Quicker on the twisties" },
];

/// The questions, in order; `club` names the club in the last one.
export function questions(club = "the club") {
  return [
    { key: "email", title: "What's your email?", help: "We'll send your spot, the route and any changes here." },
    { key: "name", title: "What's your name?" },
    { key: "phone", title: "Phone number?", help: "Only for changes on the day. Not shared with other drivers.", optional: true },
    { key: "vehicle", title: "What will you drive?" },
    { key: "style", title: "How do you like to drive?" },
    { key: "first", title: `First time driving with ${club}?` },
  ];
}

/// What's wrong with an answer, in words (null: fine).
export function problem(key, answers) {
  const a = answers || {};
  if (key === "email") return EMAIL.test(String(a.email || "").trim()) ? null : "Add your email address.";
  if (key === "name") return String(a.first || "").trim() ? null : "Add your first name.";
  if (key === "phone") {
    const digits = (String(a.phone || "").match(/\d/g) || []).length;
    return !a.phone || digits >= 7 ? null : "That phone number looks short.";
  }
  if (key === "vehicle") return String(a.make || "").trim() && String(a.model || "").trim() ? null : "Add the make and model.";
  if (key === "style") return STYLES.some((s) => s.value === a.style) ? null : "Choose one.";
  if (key === "first") return typeof a.first_timer === "boolean" ? null : "Choose one.";
  return null;
}

/// The answers as App Dev's signup function takes them (`signup`).
export function payload(answers) {
  const a = answers || {};
  const t = (v) => String(v || "").trim();
  return {
    email: t(a.email).toLowerCase(),
    name: [t(a.first), t(a.last)].filter(Boolean).join(" "),
    ...(t(a.phone) ? { phone: t(a.phone) } : {}),
    vehicle: { kind: a.kind === "motorcycle" ? "motorcycle" : "car", make: t(a.make), model: t(a.model), ...(t(a.trim) ? { trim: t(a.trim) } : {}) },
    car: [t(a.make), t(a.model), t(a.trim)].filter(Boolean).join(" "),
    style: a.style,
    first_timer: a.first_timer === true,
  };
}

/// The drive's line under its name: "Sat, Dec 12 · meet 8:00 AM in Los
/// Gatos · 23 spots left · sign up by Sun, Nov 29".
export function driveLine(view) {
  const day = view?.days?.[0] || {};
  const date = (iso) => {
    if (!iso) return "";
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  };
  const time = (hhmm) => (hhmm ? new Date(`2000-01-01T${String(hhmm).slice(0, 5)}`).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "");
  return [
    date(day.date),
    day.meet ? `meet ${time(day.meet)}${day.meet_city ? ` in ${day.meet_city}` : ""}` : "",
    Number.isInteger(view?.spots_left) ? (view.spots_left > 0 ? `${view.spots_left} ${view.spots_left === 1 ? "spot" : "spots"} left` : "full: you'd join the waitlist") : "",
    view?.answer_by ? `sign up by ${date(view.answer_by)}` : "",
  ].filter(Boolean).join(" · ");
}
