// The site's green bar, on every page that has it (the home page, the
// route pages; the planner wires its own): the phone's menu, Get the App by
// the visitor's phone, and the account — Sign in, or the planner's
// username with Sign out.

// A local preview may point at a test backend (a Supabase branch):
// localStorage "carve.dev.backend" = {"url": "https://<ref>.supabase.co",
// "key": "<publishable key>"}. Only on localhost, never on carve.run.
const DEV_BACKEND = (() => {
  try {
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? JSON.parse(localStorage.getItem("carve.dev.backend") || "null") : null;
  } catch {
    return null;
  }
})();
const SUPABASE_URL = DEV_BACKEND?.url || "https://uvaabajzkzupecemzsug.supabase.co";
const SUPABASE_KEY = DEV_BACKEND?.key || "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
export const SESSION_KEY = "carve.plan.session";

const $ = (id) => document.getElementById(id);

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}


export const session = readStore(SESSION_KEY);
export const signedIn = !!session?.user?.id;

function wireBar() {
  const button = $("menu-btn");
  const sheet = $("sheet");
  if (button && sheet) {
    button.addEventListener("click", () => {
      const open = sheet.hidden;
      sheet.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      if (open) sheet.querySelector("a")?.focus();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || sheet.hidden) return;
      sheet.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.focus();
    });
  }
  if (/android/i.test(navigator.userAgent || "")) {
    document.querySelectorAll("[data-get-app]").forEach((a) => (a.href = "/android/"));
    document.querySelectorAll("[data-get-icon]").forEach((u) => u.setAttribute("href", "#i-android"));
  }
  const signIn = $("sign-in");
  const who = $("who");
  if (!signedIn) {
    if (signIn) signIn.hidden = false;
    // The home page's Join for free: the site's sign-in, under that name.
    const join = $("join");
    if (join) {
      join.hidden = false;
      join.addEventListener("click", (event) => {
        if (window.carveSignIn && window.carveSignIn({ join: true })) event.preventDefault();
      });
    }
    return;
  }
  // A bar with no account in it (the /go/ ad pages' wordmark-only bar): this
  // module runs on import, so a throw here stopped home.js for anyone signed
  // in and left those pages blank below the hero (11/6).
  if (!who || !$("who-name")) return;
  who.hidden = false;
  $("who-name").textContent = session.user.email ? session.user.email.split("@")[0] : "Account";
  $("who-btn")?.addEventListener("click", () => {
    const menu = $("who-menu");
    menu.hidden = !menu.hidden;
    $("who-btn").setAttribute("aria-expanded", String(!menu.hidden));
  });
  $("sign-out")?.addEventListener("click", async () => {
    // Asked first (the user, 2026-11-04): carve-site.js's dialog.
    $("who-menu").hidden = true;
    if (window.carveConfirmSignOut && !(await window.carveConfirmSignOut())) return;
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    location.reload();
  });
  loadProfile();
  // The bell, loaded only for someone signed in.
  import("/assets/notify-bell.js?v=afa06aa693").then((m) => m.mountBell()).catch(() => {});
}

/// The planner's account, as the planner shows it: username and picture.
async function loadProfile() {
  if (!(session.expires_at > Date.now() / 1000)) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.user.id.toLowerCase()}&select=username,avatar_url`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) return;
    const profile = (await response.json())[0];
    if (!profile) return;
    if (profile.username) $("who-name").textContent = profile.username;
    const url = profile.avatar_url;
    if (url && /^https:\/\//.test(url)) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      $("avatar").replaceChildren(img);
    }
  } catch {
    // The name from the email stays.
  }
}

wireBar();
