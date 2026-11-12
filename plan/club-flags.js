// Club v2's switches (Chris, 11/9 night), in plan/ so the planner, the
// club pages and the planner's fixture pages all reach them. CLUB_V2 on: the v2 pages (Club
// home, settings, the drive page) and the planner without the cut steps.
// Off: the v1 club page and planner steps, still on the branch. Nothing cut
// is deleted; it is only not shown.
//
// CUT: what v2 leaves out (Club-v2-Requirements-2026-11-09.md, "Still
// cut"): attendee management, groups, Send and the route email, the drive
// link's check-in list.
export const CLUB_V2 = true;
/// The drive pass card on a club drive's day link (P1, route-pass.js). Off
/// (Chris, 11/10: "Remove it for now. We will need a more elegant
/// solution."): a day's link opens as a plain route page. The code stays.
export const DRIVE_PASS_UI = false;
/// Apex on club routes, the link page's "Free from your club" card (board
/// A1; Product, 11/11). Off: a day's link is the route page as it is today,
/// no Apex words. On only when both store apps with route Apex are live, on
/// Chris's yes that day.
export const ROUTE_APEX_UI = true;
export const CUT = Object.freeze({
  attendees: CLUB_V2,
  invites: CLUB_V2,
  groups: CLUB_V2,
  send: CLUB_V2,
  checkinList: CLUB_V2,
  memberBook: CLUB_V2,
});
