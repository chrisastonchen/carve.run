// Drafts' words (board N6; Chris 11/11): a signed-in planner's routes not
// yet saved, 50 at most, each deleted 90 days after its last change. Pure,
// for node: scripts/plan-tests/drafts-words.test.mjs.

export const DRAFT_LIMIT = 50;
/// From this many days before, a draft says when it goes.
export const WARN_DAYS = 14;
const DAY = 86_400_000;

export const WORDS = {
  title: "Drafts",
  sub: "Routes you haven't saved yet. A draft is deleted 90 days after you last change it.",
  empty: "No drafts. A route you plan here is kept as a draft until you save it.",
  signedOut: "Sign in to keep the routes you plan as drafts.",
  open: "Open",
  delete: "Delete",
  sure: "Delete for good",
  fullTitle: "Your drafts are full",
  fullSub: `You have ${DRAFT_LIMIT} drafts. Delete one to keep this route as a draft.`,
  notNow: "Not now",
  failed: "Couldn't load your drafts. Try again.",
};

/// "3 of 50".
export const countText = (n) => `${n} of ${DRAFT_LIMIT}`;

/// "Untitled route" for a draft with no name yet.
export const nameText = (d) => (d?.name || "").trim() || "Untitled route";

const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
/// "Changed today", "Changed yesterday", "Changed Oct 30" (and the year when it isn't this one).
export function changedText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.round((dayStart(now) - dayStart(t)) / DAY);
  if (days <= 0) return "Changed today";
  if (days === 1) return "Changed yesterday";
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return `Changed ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) })}`;
}

/// "Skyline Blvd, Alpine Rd · Changed today".
export const factsText = (d, now = Date.now()) => [(d.roads || []).slice(0, 3).join(", "), changedText(d.updated_at, now)].filter(Boolean).join(" · ");

/// "Deleted in 8 days" within 14 days of going, else "".
export function deletesText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const days = Math.max(1, Math.ceil((t - now) / DAY));
  if (t - now > WARN_DAYS * DAY) return "";
  return days === 1 ? "Deleted tomorrow" : `Deleted in ${days} days`;
}

/// What the planner keeps as a draft: a route of its own that has a place
/// on it and was never saved (a saved route's changes are saved with it).
export const draftable = (plan, saved) => !!plan && !saved && !plan.id && !!(plan.start || plan.end || plan.waypoints?.length);

/// The list's name and roads for a plan: its name, else start to end; the
/// roads it takes a mile or more (the planner's `roads`). A plan from a
/// road's guide (`fromRoad`) lists that road by the guide's name first, in
/// place of the map's name for it: any road the route takes for half the
/// guide's stretch or more (QA, 11/11: Tail of the Dragon, not Calderwood
/// Highway).
export function draftShape(plan) {
  const town = (p) => (p?.label || p?.name || "").split(",")[0].trim();
  const ends = [town(plan?.start), town(plan?.end)].filter(Boolean).join(" to ");
  const guide = plan?.fromRoad?.name ? plan.fromRoad : null;
  const same = (r) => guide && Number.isFinite(guide.meters) && r.meters >= guide.meters / 2;
  const named = (plan?.roads || []).filter((r) => r?.name && !same(r)).map((r) => r.name);
  const roads = [...new Set([guide?.name, ...named].filter(Boolean))].slice(0, 20);
  return { name: (plan?.name || "").trim() || ends, roads };
}
