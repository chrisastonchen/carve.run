// Open in Carve on a club drive's route link (Growth's spec, Chris's go
// 11/18; Club-Route-Open-In-App.md, A): carve.run/<token>, plain or
// ?club=<drive>&day=<n>, on a phone, for anyone but the club's own
// organizers. When the route is a dated day of a club's drive
// (route_drive), a sheet on arrival asks to open it in Carve, and a
// full-width Open in Carve sits under the title, above the facts and the
// Apex card. Both use the page's own openInApp (open.carve.run on iPhone,
// the intent on Android). Once the sheet's answered, it stays away from
// this route for the visit. On a computer: neither; the QR stays.
// The club's organizers keep the Share view: on a ?club= link, the app's
// pitch comes out again (share_page.js draws it for everyone and holds it
// hidden, html.club-wait, while a signed-in visitor is checked).

import { SUPABASE_KEY, SUPABASE_URL } from "/assets/carve-session.js?v=96f92e7529";
import { myOrgs, rpc, signedIn } from "/assets/club-api.js?v=3d6e3c082a";
import { dayText, timeText } from "/assets/club-words.js?v=9b5a1c9d31";

const segments = location.pathname.split("/").filter(Boolean);
const params = new URLSearchParams(location.search);
const token = [segments[0] === "r" ? segments[1] : segments.length === 1 ? segments[0] : null, params.get("t"), params.get("k")]
  .find((t) => /^[A-Za-z0-9]{10}$/.test(t || ""));
const CLUB = /^[0-9a-f-]{36}$/i.test(params.get("club") || "") ? params.get("club") : null;
const ua = navigator.userAgent || "";
const isAndroid = /android/i.test(ua);
const SEEN_KEY = `carve.open.seen.${token}`;

/// A phone, where the page shows the store's button instead of the QR
/// (route-view.css's own query).
const onPhone = () => matchMedia("(max-width: 760px), (pointer: coarse)").matches;

/// The sheet's words for a route_drive answer; null off a dated drive day.
/// Pure, for the tests.
export function openWords(drive, routeName = "") {
  if (!drive?.day_date) return null;
  const name = String(drive.drive_name || "").trim() || String(routeName || "").trim() || "this route";
  const days = drive.days || [];
  const i = days.findIndex((d) => d?.share_token === token || d?.date === drive.day_date);
  const meet = timeText(drive.meet);
  return {
    title: `Open ${name} in Carve?`,
    when: [String(drive.club_name || "").trim() || null, days.length > 1 && i >= 0 ? `Day ${i + 1}` : null, dayText(drive.day_date), meet ? `meet ${meet}` : null].filter(Boolean).join(" · "),
    why: "Turn-by-turn on the club's exact route, with your group on the map. Carve Apex is free, so it works with no signal.",
  };
}

async function routeDrive() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/route_drive`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_share_token: token }),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/// Whether the signed-in visitor organizes the club whose drive this is
/// (club-share.js's test: the drive, and its org among theirs).
async function organizes(driveId) {
  if (!driveId || !(await signedIn().catch(() => false))) return false;
  try {
    const [drive, orgs] = await Promise.all([rpc("drive_get", { p_drive_id: driveId }), myOrgs()]);
    return !!drive && (orgs || []).some((o) => o.id === drive.org_id);
  } catch {
    return false;
  }
}

const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
};

function openButton(className) {
  const a = node("a", className, "Open in Carve");
  // The store, as the page's own buttons have it, where the app can't open.
  a.href = document.querySelector(".rv .app-banner a, .rv .go a")?.getAttribute("href")
    || (isAndroid ? "https://play.google.com/store/apps/details?id=run.carve.app" : "https://apps.apple.com/app/id6808087716");
  a.addEventListener("click", (event) => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    window.carveOpenInApp?.(event);
  });
  return a;
}

function drawButton() {
  const head = document.querySelector(".rv .scroll .rv-head");
  if (!head || document.getElementById("co-go")) return;
  const box = node("div", "co-go");
  box.id = "co-go";
  box.append(openButton("co-open"), node("p", "", "Opens this route in the app, or where to get it."));
  head.after(box);
  // One way into the app in the column: this one.
  document.querySelector(".rv .scroll .go")?.remove();
  // Event line, title, then the button, in view with Safari's bars showing
  // (Growth's check 11/18): the road names / "A drive by" line goes under
  // it, the organizer's note too and the map shorter (route-view.css).
  const sub = head.querySelector(".sub");
  if (sub) { sub.classList.add("co-sub"); box.after(sub); }
  document.documentElement.classList.add("club-open");
}

function drawSheet(words) {
  let seen = false;
  try { seen = sessionStorage.getItem(SEEN_KEY) === "1"; } catch {}
  if (seen || document.getElementById("co-sheet")) return;
  const sheet = node("dialog", "co-sheet");
  sheet.id = "co-sheet";
  sheet.setAttribute("aria-labelledby", "co-title");
  const top = node("div", "co-top");
  const icon = node("img");
  icon.src = "/assets/icon-128.png?v=87d1534580";
  icon.alt = "";
  icon.width = 56;
  icon.height = 56;
  const said = node("div", "co-said");
  const title = node("h2", "co-title", words.title);
  title.id = "co-title";
  said.append(title, node("p", "co-when", words.when));
  top.append(icon, said);
  const stay = node("button", "co-stay", "Continue in browser");
  stay.type = "button";
  const close = () => {
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    sheet.close();
    sheet.remove();
  };
  stay.addEventListener("click", close);
  sheet.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  const open = openButton("co-open");
  open.addEventListener("click", () => setTimeout(close, 0));
  sheet.append(top, node("p", "co-why", words.why), open, stay,
    node("p", "co-fine", isAndroid ? "No app yet? Open in Carve goes to Google Play." : "No app yet? Open in Carve goes to the App Store, then back here."));
  document.body.append(sheet);
  if (sheet.showModal) sheet.showModal(); else sheet.setAttribute("open", "");
  open.focus();
}

async function start() {
  const root = document.documentElement;
  if (!token) return root.classList.remove("club-wait");
  const drive = await routeDrive();
  const mine = await organizes(CLUB || drive?.drive_id);
  // The organizer's Share view: no pitch on the club's own link.
  if (mine && CLUB) document.querySelectorAll(".rv .go, .rv .app-banner, #rv-app, .rv .sect.near").forEach((n) => n.remove());
  root.classList.remove("club-wait");
  if (mine || !onPhone()) return;
  const routeName = document.querySelector(".rv .rv-head h1")?.textContent || "";
  const words = openWords(drive, routeName);
  if (!words) return;
  drawButton();
  drawSheet(words);
  window.carveClubOpen = { button: true, title: words.title, when: words.when };
}

start();
