// The drive pass on a club drive's route link (club v2's P1; Chris, 11/9):
// carve.run/<token> opened in a browser, by a driver. When the route is a
// dated day of a club's drive (App Dev's route_drive), a card at the top
// says whose drive it is, the day and where it meets, and offers the pass:
// Create an account or Sign in (the site's own sign-in, back to this page),
// then Get the drive pass (route_pass_claim, a tap, never on load), or
// Skip, which still shows the route. No date, no pass and no card (Chris:
// a pass only comes from a dated drive day, through its last day).
// Until App Dev's calls are live, route_drive is missing and nothing shows.
// Off for now (DRIVE_PASS_UI, Chris 11/10): the page is a plain route page.

import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=a3869ea508";
import { dayText } from "/assets/club-words.js?v=e4108d1a92";
import { DRIVE_PASS_UI } from "/plan/club-flags.js?v=4";

const segments = location.pathname.split("/").filter(Boolean);
const token = (segments[0] === "r" ? segments[1] : segments[0]) || "";
const SKIP_KEY = `carve.pass.skip.${token}`;

/// route_pass_claim's refusals (App Dev's 0086), said plainly; the route
/// stays on the page either way.
export const PASS_WORDS = {
  full: "This drive is full, so there's no pass for it. You can still see the route.",
  sign_in: "Please sign in again.",
  no_date: "This route isn't on a dated drive day, so there's no pass for it. You can still see the route.",
  over: "This drive is over, so its pass has ended. You can still see the route.",
  needs_plan: "The club's plan has ended, so there's no pass for this drive. You can still see the route.",
};

/// The card's words for a route_drive answer; null when there's no pass to
/// offer (no date, or the drive is over). Pure, for the tests.
export function passWords(info, today) {
  if (!info?.day_date) return null;
  const days = info.days || [];
  const last = days.map((d) => d.date).filter(Boolean).sort().pop() || info.day_date;
  if (today && last < today) return null;
  const i = days.findIndex((d) => d.share_token === token);
  const which = days.length > 1 && i >= 0 ? ` · Day ${i + 1}` : "";
  return {
    club: info.club_name || "",
    title: `${info.drive_name || "A club drive"}${which}`,
    when: [dayText(info.day_date), info.start_name ? `meet at ${info.start_name}` : ""].filter(Boolean).join(" · "),
    // Through the drive's last day (the server's pass_until ends with it).
    pass: `Offline maps and CarPlay on this drive's routes, free from ${info.club_name || "the club"}, through ${dayText(last)}.`,
    until: dayText(last),
  };
}

async function call(name, body, bearer) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${bearer || SUPABASE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(String(data?.message || data?.error || response.status)), { code: data?.message || data?.error });
  return data;
}

const node = (tag, className, text) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function start() {
  // Off until Product's new flow (club-flags.js DRIVE_PASS_UI): a plain route page.
  if (!DRIVE_PASS_UI) return;
  if (!/^[A-Za-z0-9]{10}$/.test(token)) return;
  const card = document.querySelector(".rv .scroll");
  if (!card) return;
  const bearer = await accessToken().catch(() => null);
  let info;
  try {
    info = await call("route_drive", { p_share_token: token }, bearer);
  } catch {
    return; // not live yet, or not a club drive's route
  }
  const words = passWords(info, iso(new Date()));
  if (!words) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/assets/route-pass.css?v=ff5e3590a7";
  document.head.append(link);

  const box = node("section", "rp");
  box.setAttribute("aria-labelledby", "rp-title");
  box.append(node("p", "rp-club", words.club), Object.assign(node("h2", "rp-title", words.title), { id: "rp-title" }), node("p", "rp-when", words.when));
  const body = node("div", "rp-body");
  const said = node("p", "rp-said");
  said.setAttribute("role", "status");
  said.setAttribute("aria-live", "polite");
  box.append(body, said);
  card.prepend(box);

  const here = location.pathname + location.search;
  const has = (until) => {
    body.replaceChildren(node("p", "rp-pass", `You have the drive pass through ${until}. Open the route in the Carve app to drive it, even with no signal.`));
  };
  const skipped = () => {
    try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; }
  };
  const fold = () => {
    box.classList.add("folded");
    body.replaceChildren();
    const again = node("button", "rp-link", "Get the drive pass");
    again.type = "button";
    again.addEventListener("click", () => {
      try { sessionStorage.removeItem(SKIP_KEY); } catch {}
      box.classList.remove("folded");
      offer();
    });
    body.append(node("span", "rp-small", "Seeing the route only."), " ", again);
  };
  const skip = node("button", "rp-link", "Skip, just show the route");
  skip.type = "button";
  skip.addEventListener("click", () => {
    try { sessionStorage.setItem(SKIP_KEY, "1"); } catch {}
    fold();
  });

  function offer() {
    body.replaceChildren(node("p", "rp-pass", `Get the drive pass. ${words.pass}`));
    const row = node("div", "rp-row");
    if (!bearer) {
      const join = node("button", "rp-go", "Create an account");
      join.type = "button";
      join.addEventListener("click", () => window.carveSignIn?.({ returnTo: here, join: true }));
      const signIn = node("button", "rp-go ghost", "Sign in");
      signIn.type = "button";
      signIn.addEventListener("click", () => window.carveSignIn?.({ returnTo: here }));
      row.append(join, signIn);
    } else {
      const get = node("button", "rp-go", "Get the drive pass");
      get.type = "button";
      get.addEventListener("click", async () => {
        get.disabled = true;
        said.textContent = "";
        try {
          const out = await call("route_pass_claim", { p_share_token: token }, await accessToken().catch(() => bearer));
          if (out?.error) throw Object.assign(new Error(out.error), { code: out.error });
          has(words.until);
        } catch (failure) {
          get.disabled = false;
          said.textContent = PASS_WORDS[failure.code] || "Couldn't get the pass. Try again.";
        }
      });
      row.append(get);
    }
    body.append(row, skip);
  }

  // Signed in with the pass already (route_drive's `pass`, 0086; seen on
  // the branch 11/10: a reopened link offered it again).
  if (info.pass === true) return has(words.until);
  if (skipped()) return fold();
  offer();
}

start();
