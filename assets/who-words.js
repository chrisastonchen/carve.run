// Who's looking, for the site's bar, Home and the planner's menus (the web
// clean-up, Chris 11/11; boards N1–N5). Pure, for node:
// scripts/plan-tests/who-words.test.mjs.
//
//   club        an organizer of a club on the Club plan (a lapsed plan too:
//               the Terms keep its planning and drive pages)
//   individual  Apex from the App Store or Google Play (apex_mine.store)
//   free        signed in with neither
//   out         signed out (treated like Free where it matters)

/// A club the account plans for: an organizer (not a member) of a club whose
/// plan is for organizers, or was (`had_plan`, 0090: a lapsed plan still
/// counts; until 0090, a missing had_plan reads as false). `clubTiers`:
/// plans.js's tiers with for "organizers".
export const plansFor = (org, clubTiers) => !!org && org.role !== "member" && (clubTiers.includes(org.tier) || org.had_plan === true);

const DAY = 86_400_000;
/// A club's plan in My Clubs ▾ (board N5): "Club · trial, 24 days left",
/// "Club", or "Club · plan ended".
export function clubNote(org, clubTiers = ["club", "group"], now = Date.now()) {
  if (!clubTiers.includes(org?.tier)) return org?.had_plan === true ? "Club · plan ended" : "";
  const ends = org.trial_ends_at ? Date.parse(org.trial_ends_at) : NaN;
  if (Number.isFinite(ends) && ends > now) {
    const left = Math.max(1, Math.ceil((ends - now) / DAY));
    return `Club · trial, ${left} ${left === 1 ? "day" : "days"} left`;
  }
  return "Club";
}

/// Whether a new club would be billed today (O1): the trial is once, and a
/// club sharing an organizer with one that had a plan has none (0058's
/// org_trial_used). Needs had_plan (0090); a live plan says so already.
export const billsToday = (orgs = [], clubTiers = ["club", "group"]) =>
  (orgs || []).some((o) => o.role !== "member" && (o.had_plan === true || clubTiers.includes(o.tier)));

/// → "out" | "free" | "individual" | "club"
export function stateOf({ signedIn, orgs = [], apex = null, clubTiers = ["club", "group"] }) {
  if (!signedIn) return "out";
  if ((orgs || []).some((o) => plansFor(o, clubTiers))) return "club";
  if (apex?.store === true) return "individual";
  return "free";
}

/// The clubs an organizer plans for, by name.
export const clubsOf = (orgs = [], clubTiers = ["club", "group"], now = Date.now()) =>
  (orgs || []).filter((o) => plansFor(o, clubTiers)).map((o) => ({ id: o.id, name: o.name || "", note: clubNote(o, clubTiers, now) }))
    .sort((a, b) => a.name.localeCompare(b.name));

/// A club's New drive (O3).
export const newDriveHref = (club) => `/club/drive/?org=${encodeURIComponent(club.id)}`;
export const FOR_MYSELF = { label: "Plan a drive for myself", href: "/plan/" };
/// Plan ▾'s first item for everyone (Chris, 11/12): without Club it's the
/// For Clubs page, to start one.
export const GROUP_OR_CLUB = "Plan a group or club drive";
/// When an organizer has no club by name (shouldn't happen: the plan and the
/// club are made together).
export const NO_CLUB_NAME = "My club or group";

/// Home's menu for a Club organizer (N2): a group drive for each club, then
/// one for themselves.
export function homeMenu(clubs) {
  return [
    ...clubs.map((c) => ({ label: `Plan a group drive for ${c.name || NO_CLUB_NAME}`, href: newDriveHref(c) })),
    FOR_MYSELF,
  ];
}

// ── The site's bar, by who's looking (board N3; Chris 11/11) ──
// Plan first after the logo, then My Clubs ▾ (an organizer) or For Clubs in
// the same place. Pricing only signed out (/pricing/ and the footer keep
// it); Free gets Upgrade to the same page. Phones list the same in the menu.

/// The bar's items: { key, label, href } or { key, label, menu: [{ label,
/// href, note? }] }.
export function navFor(state, clubs = []) {
  const link = (key, label, href) => ({ key, label, href });
  const plan = { key: "plan", label: "Plan", menu: planMenu(state, clubs) };
  const clubsItem = state === "club" ? { key: "clubs", label: "My Clubs", menu: myClubsMenu(clubs) } : link("clubs", "For Clubs", "/club/");
  return [
    plan,
    clubsItem,
    link("explore", "Explore", "/drives/"),
    link("events", "Events", "/events/"),
    ...(state === "out" ? [] : [link("saved", "Saved", "/my-drives/")]),
    ...(state === "out" ? [link("pricing", "Pricing", "/pricing/")] : state === "free" ? [link("upgrade", "Upgrade", "/pricing/")] : []),
    link("support", "Support", "/support/"),
  ];
}

/// Plan ▾ (board N4): a group or club drive (an organizer's clubs, each to
/// its New drive; anyone else, For Clubs), then the map planner for
/// themselves, then Drafts (N6) once signed in.
export const DRAFTS = { label: "Drafts", href: "/drafts/" };
export function planMenu(state, clubs = []) {
  return [
    ...(state === "club" && clubs.length
      ? clubs.map((c) => ({ label: clubs.length === 1 ? GROUP_OR_CLUB : `${GROUP_OR_CLUB} for ${c.name || NO_CLUB_NAME}`, href: newDriveHref(c) }))
      : [{ label: GROUP_OR_CLUB, href: "/club/" }]),
    FOR_MYSELF,
    ...(state === "out" ? [] : [DRAFTS]),
  ];
}

/// My Clubs ▾ (board N5): each club to its Club home, then + Add a club (the
/// Club page, to start another).
export function myClubsMenu(clubs = []) {
  return [
    ...clubs.map((c) => ({ label: c.name || NO_CLUB_NAME, href: `/club/?org=${encodeURIComponent(c.id)}`, ...(c.note ? { note: c.note } : {}) })),
    { label: "+ Add a club", href: "/club/?add=1" },
  ];
}

/// Which item a page is under (its aria-current).
export function currentKey(path) {
  if (/^\/(plan|drafts)\//.test(path)) return "plan";
  if (/^\/club\//.test(path)) return "clubs";
  if (/^\/(drives|roads)\//.test(path)) return "explore";
  if (/^\/(events|e)\//.test(path)) return "events";
  if (/^\/my-drives\//.test(path)) return "saved";
  if (/^\/pricing\//.test(path)) return "pricing";
  if (/^\/support\//.test(path)) return "support";
  return null;
}
