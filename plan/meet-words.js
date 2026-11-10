// Our words for a meeting place the planner's `meet` found (club sprint
// item 9, v1): what it is and what's near, at the meet time. Pure, for
// node: scripts/plan-tests/meet-words.test.mjs.

const walk = (n) => `${n} min walk`;

/// "7:30 AM" for "07:30".
export function clockText(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

/// A place near the lot: "Peet's Coffee, 1 min walk, open at 7:30 AM".
function near(n, fallback, meet) {
  if (!n) return null;
  const hours = !meet || n.open === null ? "" : n.open ? `, open at ${meet}` : `, closed at ${meet}`;
  return `${n.name || fallback}, ${walk(n.walkMinutes)}${hours}`;
}

/// A spot's lines: { title, address, facts: [..] }. `meet` is the meet
/// time ("07:30") or null. Size only where OpenStreetMap says; restrooms
/// only from it; nothing claimed otherwise.
export function spotWords(spot, meet = null) {
  const at = meet ? clockText(meet) : "";
  const facts = [];
  if (spot.spaces) facts.push(`${spot.spaces} spaces`);
  else if (spot.likelyLarge) facts.push("Likely large");
  const coffee = near(spot.coffee, "Coffee", at);
  const food = near(spot.food, "Food", at);
  if (coffee) facts.push(coffee);
  else if (food) facts.push(food);
  if (spot.restroom) facts.push(`Restrooms, ${walk(spot.restroom.walkMinutes)}`);
  if (spot.fuel) facts.push(`${spot.fuel.name || "Gas station"}, ${walk(spot.fuel.walkMinutes)}`);
  if (spot.fee) facts.push("Paid parking");
  if (spot.customers) facts.push("Customer parking");
  if (spot.paved === false) facts.push("Unpaved");
  if (spot.parkRide) facts.push("Park and ride");
  return { title: spot.name, address: spot.address || "", facts };
}

/// Under the list: who the sizes and restrooms are from, when any show.
export const OSM_CREDIT = "Sizes and restrooms from OpenStreetMap contributors";
export const creditNeeded = (spots = []) => spots.some((s) => s.osm);
