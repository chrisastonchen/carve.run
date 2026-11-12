// Apex on club routes, the link page's "Free from your club" card (board
// A1; Product's copy, 11/11), from route_apex's answer (App Dev's 0090 and
// 0093). Pure, for node: scripts/plan-tests/apex-words.test.mjs.
// The dates are route_apex's own, in the drive's time zone, never worked out
// here from the 14/21/1 settings: the end can come early (a moved drive, the cap).

export const APEX_FEATURES = ["Offline navigation", "3D preview", "Road conditions", "Popular times, where available"];

/// "Mon, Dec 14": an instant's day in the drive's zone.
export const dayIn = (ms, zone) => new Date(ms).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone || "UTC" });

/// The card for a route_apex answer: on, or not yet (from … through …);
/// null when there's none (ended, no plan, not a club day's link).
/// `usual`: Individual's yearly price, "$49.99".
export function apexCard(answer, zone, usual) {
  if (!answer?.club) return null;
  const from = Date.parse(answer.apex_from);
  const until = Date.parse(answer.apex_until);
  if (!Number.isFinite(until)) return null;
  // apex_until is the end, exclusive: the last day is the one before it.
  const end = dayIn(until - 1, zone);
  const covers = `${answer.club} covers it.${usual ? ` Apex is usually ${usual} a year.` : ""}`;
  const card = { pill: "Free from your club", features: APEX_FEATURES };
  if (answer.state === "on") return { ...card, heading: "Carve Apex is on for this route", line: covers, expires: `These features expire ${end}.` };
  if (answer.state === "not_yet" && Number.isFinite(from)) {
    return { ...card, heading: "Carve Apex will be on for this route", line: `From ${dayIn(from, zone)} through ${end}. ${covers}`, expires: null };
  }
  return null;
}
