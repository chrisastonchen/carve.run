// Share and the pre-drive (club v2's O7 and O6; Chris, 11/9 night) on the
// public route page, carve.run/<token>?club=<drive>&day=<n>[&prerun].
// share_page.js leaves out the app's pitch and words the QR for drivers;
// this adds, for the drive's organizers, the drive's bar on top (the club
// small, back to the drive by name, the day switch, a day not planned yet
// greyed), and on the pre-drive the line for the crew. The drive's name
// once, in the bar; the title is this day's route, start → end (Chris,
// 11/10: no crumbs, no "Share", no "Drive · Day N"). One link per day: the
// day's own route link, the same for the crew and for drivers later.
// Signed out or not an organizer, the page stays as share_page.js drew it.

import { el, myOrgs, rpc, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { crewLine, dayText, shareTitle } from "/assets/club-words.js?v=768f355b17";

const q = new URLSearchParams(location.search);
const driveId = q.get("club");
const n = Math.max(1, parseInt(q.get("day"), 10) || 1);
const prerun = q.has("prerun");

/// A day's page: its route's own link, with the club's view kept.
export const dayPage = (token, k, pr = false) => `/${encodeURIComponent(token)}?club=${encodeURIComponent(driveId)}&day=${k}${pr ? "&prerun" : ""}`;

async function start() {
  if (!driveId || !(await signedIn())) return;
  let drive, routes, orgs;
  try {
    [drive, routes, orgs] = await Promise.all([rpc("drive_get", { p_drive_id: driveId }), rpc("drive_routes", { p_drive_id: driveId }), myOrgs()]);
  } catch {
    return;
  }
  const card = document.querySelector(".rv .scroll");
  if (!drive || !card) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/club-share.css?v=2e17a4429c";
  document.head.append(link);
  const days = drive.days || [];
  const tokenOf = (d) => (routes || []).filter((r) => r.day_id === d.id).sort((a, b) => a.position - b.position)[0]?.share_token || null;

  // The bar: the club, small; back to the drive by its name; on the
  // pre-drive, its date; the days.
  const org = (orgs || []).find((o) => o.id === drive.org_id);
  const bar = el("div", "cs-bar");
  if (org?.name) bar.append(el("span", "cs-club", org.name));
  const back = el("a", "cs-back", `‹ ${drive.name || "Your drive"}`);
  back.href = `/club/drive/?id=${encodeURIComponent(drive.id)}`;
  bar.append(back);
  if (prerun && drive.prerun) bar.append(el("span", "cs-what", `Pre-drive · ${dayText(drive.prerun.date)}`));
  if (days.length > 1) {
    const switcher = el("div", "cs-days");
    switcher.setAttribute("role", "group");
    switcher.setAttribute("aria-label", "Days");
    days.forEach((d, i) => {
      const token = tokenOf(d);
      const label = `Day ${i + 1} · ${token ? dayText(d.date) : "not planned"}`;
      if (i + 1 === n) {
        const here = el("span", "cs-day on", label);
        here.setAttribute("aria-current", "page");
        switcher.append(here);
      } else if (token) {
        const a = el("a", "cs-day", label);
        a.href = dayPage(token, i + 1, prerun);
        switcher.append(a);
      } else {
        const off = el("span", "cs-day off", label);
        off.setAttribute("aria-disabled", "true");
        switcher.append(off);
      }
    });
    bar.append(switcher);
  }
  card.prepend(bar);

  // No crumbs: the bar says where this is. The title: this day's route.
  card.querySelector(".rv-head .crumbs")?.remove();
  const h1 = card.querySelector(".rv-head h1");
  const here = days[n - 1];
  const route = here && (routes || []).filter((r) => r.day_id === here.id).sort((a, b) => a.position - b.position)[0];
  const title = shareTitle({ dayCount: days.length, n, payload: route?.payload, driveName: drive.name });
  if (h1 && title) h1.textContent = title;

  // The pre-run (O6): the crew gets these same links.
  if (prerun && drive.prerun) {
    const line = el("p", "cs-crew", crewLine(drive.prerun.date));
    bar.after(line);
  }

  // The owner's Edit: this day in the drive's planner.
  const edit = document.getElementById("rv-edit");
  if (edit) edit.setAttribute("href", `/plan/?drive=${encodeURIComponent(drive.id)}&day=${n}`);
  document.documentElement.classList.add("club-share");
}

start();
