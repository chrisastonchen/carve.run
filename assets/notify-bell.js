// Notifications in the site's bar (Club-Sprint-Requirements.md §10): for
// someone signed in, a bell with the unread count beside the account, and
// a line in the phone's menu; both open the Notifications pane over the
// page (notify-pane.js; the user, 11/8: a pane, not a page). The count is
// 0067's notifications_count, read on load and again when the tab comes
// back (at most once a minute). The site bar (site-bar.js) and the
// planner's own bar (plan.js) mount it.

import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=a3869ea508";

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>';

/// The badge's text: nothing for none, "99+" past 99.
export const countText = (n) => (!n ? "" : n > 99 ? "99+" : String(n));

let last = 0;

/// Puts the bell before the account (or the menu button) in `bar`, and a
/// line in the phone's `sheet` before the account's lines (carve-site.js's
/// Profile and Sign out). Once.
export function mountBell(bar = document.querySelector(".bar"), sheet = document.getElementById("sheet")) {
  if (!bar || document.getElementById("notif")) return;
  const here = location.pathname.startsWith("/notifications");
  const bell = document.createElement("button");
  bell.type = "button";
  bell.className = "bell";
  bell.id = "notif";
  bell.setAttribute("aria-label", "Notifications");
  bell.setAttribute("aria-haspopup", "dialog");
  bell.setAttribute("aria-expanded", "false");
  bell.setAttribute("aria-controls", "nf-pane");
  bell.innerHTML = `${BELL}<span class="bell-count" id="notif-count" hidden></span>`;
  bell.addEventListener("click", () => toggle(bell));
  bar.insertBefore(bell, document.getElementById("who") || document.getElementById("menu-btn") || null);
  if (sheet) {
    // A link, for a menu read without the pane; the pane when it can.
    const line = document.createElement("a");
    line.href = "/notifications/";
    line.id = "sheet-notif";
    line.textContent = "Notifications";
    line.addEventListener("click", (event) => {
      event.preventDefault();
      sheet.hidden = true;
      document.getElementById("menu-btn")?.setAttribute("aria-expanded", "false");
      toggle(bell);
    });
    sheet.insertBefore(line, sheet.querySelector('a[href="/profile/"]') || document.getElementById("sheet-sign-out") || null);
  }
  document.addEventListener("carve:notifications-read", () => showCount(0));
  // On the fallback page the pane opens itself and reads them.
  if (here) return;
  refreshCount();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - last > 60_000) refreshCount();
  });
}

async function toggle(bell) {
  const pane = await import("/assets/notify-pane.js?v=81c0ca6e0b");
  if (pane.isOpen()) pane.closePane();
  else pane.openPane(bell);
}

/// Shows `n` unread (the notifications page sets 0 once it has marked them read).
export function showCount(n) {
  const badge = document.getElementById("notif-count");
  const bell = document.getElementById("notif");
  if (!badge || !bell) return;
  badge.textContent = countText(n);
  badge.hidden = !n;
  bell.setAttribute("aria-label", n ? `Notifications, ${n} unread` : "Notifications");
  const line = document.getElementById("sheet-notif");
  if (line) line.textContent = n ? `Notifications (${countText(n)})` : "Notifications";
}

export async function refreshCount() {
  last = Date.now();
  const token = await accessToken().catch(() => null);
  if (!token) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/notifications_count`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) return;
    showCount((await response.json())?.unread ?? 0);
  } catch {
    // No count: the bell still opens the page.
  }
}
