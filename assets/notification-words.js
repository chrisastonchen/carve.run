// Our words for each item in the Notifications feed (0067's
// notifications_mine: {id, kind, at, unread, url, drive, org, data}). The
// server sends data, never wording; the apps will write their own. Pure,
// so node can test it: scripts/plan-tests/notification-words.test.mjs.

/// "2026-12-12" → "Sat, Dec 12": the drive's own day, as club-pages.js
/// shows it.
export const dayText = (date) => {
  const [y, m, d] = String(date).split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
/// "08:45" → "8:45 AM".
export const timeText = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  return new Date(Date.UTC(2026, 0, 1, h, m)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
};

/// When it happened: "Just now", "12 min ago", "3 h ago", then the day.
export function whenText(at, now = Date.now()) {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/// "Xb, Xa and Lee"; more than three: "Xb, Xa, Lee and 2 more".
export function namesText(names = [], count = names.length) {
  const shown = names.filter(Boolean).slice(0, 3);
  const more = Math.max(0, count - shown.length);
  if (!shown.length) return "";
  if (more) return `${shown.join(", ")} and ${more} more`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/// One day's group in a line: "Group 1, leaving at 8:45 AM. You're the lead."
export function groupLine(day, many = false) {
  if (!day) return "";
  const on = many && day.date ? ` on ${dayText(day.date)}` : "";
  // Never a place on the waitlist (Chris, 11/9: attendees don't see their position).
  if (day.waitlisted) return `You're on the waitlist${on}.`;
  if (day.group == null) return "";
  const role = day.role === "lead" ? " You're the lead." : day.role === "sweep" ? " You're the sweep." : "";
  return `Group ${day.group}, leaving at ${timeText(day.leave)}${on}.${role}`;
}

const groupsText = (days = []) => days.map((d) => groupLine(d, days.length > 1)).filter(Boolean).join(" ");

/// The Individual price for the offer, from plans.js: "$49.99 a year".
const soloPrice = (plans = []) => {
  const solo = plans.find((p) => p.plan === "solo");
  return solo ? `$${solo.year} a year` : "";
};

/// An item's words: { title, detail, answer } where `answer` is true when
/// Going? can be answered here (one day, not yet answered, still ahead).
export function itemWords(item, { plans = [] } = {}) {
  const d = item.drive || {};
  const data = item.data || {};
  const drive = d.name || "your drive";
  const club = d.club || item.org?.name || "";
  const days = d.first_day && d.last_day && d.first_day !== d.last_day ? `${dayText(d.first_day)} to ${dayText(d.last_day)}` : dayText(d.first_day);
  switch (item.kind) {
    case "invite": {
      const answered = { going: "You said Going.", registered: "You're registered.", maybe: "You said Maybe.", no: "You said No." }[data.status];
      return {
        title: club ? `${club} invited you to ${drive}` : `You're invited to ${drive}`,
        detail: [days, data.needs_answer ? "Going?" : answered].filter(Boolean).join(". "),
        answer: !!data.needs_answer && d.first_day === d.last_day,
      };
    }
    case "details":
      return { title: `Your details for ${drive}`, detail: groupsText(data.days) || [days, "Your meet time and place are on the drive's page."].filter(Boolean).join(". ") };
    case "update": {
      const changes = data.changes || [];
      const shown = changes.slice(0, 2).join(". ");
      return {
        title: `${drive} changed`,
        detail: changes.length > 2 ? `${shown}. And ${changes.length - 2} more.` : shown ? `${shown}.` : "The organizer sent an update.",
      };
    }
    case "reminder":
      return { title: `${drive} is tomorrow`, detail: groupsText((data.days || []).filter((x) => !data.day || x.date === data.day)) || "See you there." };
    case "cancelled":
      return { title: `${drive} is off`, detail: club ? `${club} cancelled it.` : "The organizer cancelled it." };
    case "drive_pass":
      return { title: `Apex for ${drive}`, detail: `Offline maps, road conditions and 3D previews on the drive's routes, through ${dayText(data.until)}.` };
    case "solo_offer": {
      const price = soloPrice(plans);
      return { title: "Keep Apex for your own drives", detail: `Your Apex for ${drive} has ended. Individual is Carve Apex for one driver${price ? `, ${price} in the Carve app` : ""}.` };
    }
    case "review": {
      const routes = (data.routes || []).map((r) => r.label).filter(Boolean);
      return { title: `How was ${drive}?`, detail: `Rate ${routes.length === 1 ? routes[0] : "its routes"} in the Carve app.` };
    }
    case "going":
      return {
        title: `${data.count === 1 ? "1 new Going" : `${data.count} new Going`} on ${drive}`,
        detail: namesText(data.names, data.count),
      };
    case "waitlist":
      return { title: `${data.count} more on the waitlist for ${drive}`, detail: "They're waiting for a place." };
    case "org_approved":
      return { title: `${item.org?.name || "Your club"} is approved`, detail: "Plan a drive and send it from the planner." };
    case "route_unsent": {
      // 0070's alert, the morning before: the email's words.
      const weekday = new Date(`${data.day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      const n = data.coming ?? 0;
      return {
        title: `You haven't sent the route for ${weekday}'s drive`,
        detail: `${drive}: ${n === 1 ? "1 person is" : `${n} people are`} going and haven't been sent the route. Send it from the planner.`,
      };
    }
    case "trial_ending":
      return {
        title: `Your free trial ends ${new Date(data.ends_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
        detail: `${item.org?.name ? `${item.org.name}'s` : "Your"} plan is then billed by the year. Cancel on your club's page before then and nothing is charged.`,
      };
    default:
      return null;
  }
}
