// carve.run/profile/: a profile, as the app shows it (the user, 2026-11-04: a
// basic web version, reached from the name at the top right). Yours, or with
// ?u=<username> someone you've been on a drive with: profile_view (0047)
// decides who can see whom, and needs a sign-in. Never indexed (the page's
// robots meta and robots.txt).

import { SUPABASE_KEY, SUPABASE_URL, SESSION_KEY, accessToken } from "/assets/carve-session.js?v=a3869ea508";
import { usesMiles } from "/plan/route-wire.js";

const $ = (id) => document.getElementById(id);
// The browser's language and country, as the rest of the site reads it.
const metric = !usesMiles(navigator.language || "en-US");

function escapeHTML(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function status(text) {
  $("pf-status").textContent = text;
  $("pf-status").hidden = !text;
}

const distance = (meters) => {
  const value = metric ? meters / 1000 : meters / 1609.344;
  return `${value >= 100 ? Math.round(value).toLocaleString() : value >= 10 ? Math.round(value) : value.toFixed(1)} ${metric ? "km" : "mi"}`;
};
const height = (meters) => `${Math.round(metric ? meters : meters * 3.28084).toLocaleString()} ${metric ? "m" : "ft"}`;

function when(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

async function rest(path, token, body) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: body ? "POST" : "GET",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Object.assign(new Error("request failed"), { status: response.status });
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/// Their numbers, worked out as the app's ActivityStats does: drives that got
/// at least 5% of the way, and each one's share of its route's miles and climb.
function stats(tally) {
  let drives = 0, meters = 0, climb = 0;
  for (const row of tally || []) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const covered = Math.min(1, Math.max(0, row[1] || 0));
    if (covered < 0.05) continue;
    drives += 1;
    if (Number.isFinite(row[2])) {
      meters += Math.min(row[2], 2_000_000) * covered;
      climb += Math.min(row[3] || 0, 100_000) * covered;
    } else {
      meters += Math.min(Math.max(0, row[4] || 0), 2_000_000);
    }
  }
  return { drives, meters, climb };
}

const RATING = { love: "Loved it", like: "Liked it", dislike: "Didn't like it" };

function avatarHTML(profile) {
  const url = profile.avatar_url;
  if (url && /^https:\/\//.test(url)) return `<img src="${escapeHTML(url)}" alt="">`;
  return `<span>${escapeHTML((profile.display_name || profile.username || "?").trim().charAt(0).toUpperCase())}</span>`;
}

function routeLink(token, text) {
  return token && /^[A-Za-z0-9]{10}$/.test(token) ? `<a href="/${token}">${escapeHTML(text)}</a>` : escapeHTML(text);
}

function render(profile) {
  const name = profile.display_name || profile.username;
  document.title = `${name} | Carve`;
  const { drives, meters, climb } = stats(profile.tally);
  const clubs = (profile.clubs || []).filter((c) => c && c.name);
  const garage = (profile.garage || []).filter((v) => v && v.make);
  const upcoming = profile.events_upcoming || [];
  const activity = [
    ...(profile.drives || []).map((d) => ({ at: d.ended_at, html: `<b>Drove ${routeLink(d.route_link, d.route_name || "a route")}</b>
      <span>${[when(d.ended_at), d.route_meters ? distance(d.route_meters * Math.min(1, d.covered || 0)) : "", d.vehicle].filter(Boolean).map(escapeHTML).join(" · ")}</span>` })),
    ...(profile.reviews || []).map((r) => ({ at: r.driven_at, html: `<b>Reviewed ${routeLink(r.route_link, r.route_name)}</b>
      <span>${escapeHTML([RATING[r.rating] || "", when(r.driven_at)].filter(Boolean).join(" · "))}</span>${r.note ? `<p>${escapeHTML(r.note)}</p>` : ""}` })),
    ...(profile.events_past || []).map((e) => ({ at: e.starts_at, html: `<b>Went to ${escapeHTML(e.name)}</b>
      <span>${escapeHTML([when(e.starts_at), e.place].filter(Boolean).join(" · "))}</span>` })),
  ].filter((item) => !Number.isNaN(new Date(item.at).getTime())).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);

  const section = (title, items) => items.length ? `<section class="pf-sect"><h2>${title}</h2><ul class="pf-list">${items.join("")}</ul></section>` : "";
  $("pf-body").innerHTML = `
    <div class="pf-head">
      <div class="pf-avatar">${avatarHTML(profile)}</div>
      <div><h1>${escapeHTML(name)}</h1><p>@${escapeHTML(profile.username)}</p></div>
    </div>
    <div class="pf-stats">
      <div><b>${drives.toLocaleString()}</b><span>${drives === 1 ? "Drive" : "Drives"}</span></div>
      <div><b>${distance(meters)}</b><span>Driven</span></div>
      <div><b>${height(climb)}</b><span>Climbed</span></div>
    </div>
    ${section("Clubs", clubs.map((c) => `<li><b>${escapeHTML(c.name)}</b>${c.region_name ? `<span>${escapeHTML(c.region_name)}</span>` : ""}</li>`))}
    ${section("Garage", garage.map((v) => `<li><b>${escapeHTML([v.year, v.make, v.model].filter(Boolean).join(" "))}</b>${v.trim ? `<span>${escapeHTML(v.trim)}</span>` : ""}</li>`))}
    ${section("Coming up", upcoming.map((e) => `<li><b>${escapeHTML(e.name)}</b><span>${escapeHTML([when(e.starts_at), e.place].filter(Boolean).join(" · "))}</span></li>`))}
    ${activity.length ? section("Activity", activity.map((item) => `<li>${item.html}</li>`))
      : `<section class="pf-sect"><h2>Activity</h2><p class="pf-note">${profile.is_me ? "Your drives, reviews and events show here once you've driven with Carve." : "Nothing here yet."}</p></section>`}
    ${profile.is_me ? `<section class="pf-sect pf-emails" aria-labelledby="pf-emails-h"><h2 id="pf-emails-h">Emails</h2>
      <label class="pf-switch"><span><b>Emails about Carve</b><small>Tips and news. Sign-in codes and club emails always come.</small></span>
      <input type="checkbox" role="switch" id="pf-mkt" disabled></label><p class="pf-note" id="pf-mkt-said" role="status"></p></section>` : ""}
    ${profile.is_me ? `<p class="pf-note">Change your name, picture and garage in the Carve app, under Me.</p>` : ""}`;
  $("pf-body").hidden = false;
  status("");
}

/// Your own profile: the marketing-email switch (App Dev's 0097; Chris and
/// Legal, 11/11). It shows the stored choice, off when there's none; a
/// change is saved at once (source "settings", no country on the web).
/// Sign-up on the web asks nothing.
async function emailPrefs(token) {
  const box = $("pf-mkt");
  if (!box) return;
  const said = (text) => { $("pf-mkt-said").textContent = text; };
  try {
    const prefs = await rest("/rest/v1/rpc/email_prefs_mine", token, {});
    box.checked = prefs?.marketing_opt_in === true;
    box.disabled = false;
  } catch {
    return said("Couldn't load your email setting. Try again later.");
  }
  box.addEventListener("change", async () => {
    const want = box.checked;
    box.disabled = true;
    said("");
    try {
      await rest("/rest/v1/rpc/email_prefs_set", await accessToken().catch(() => token), { p_marketing_opt_in: want, p_source: "settings", p_country: null });
      said(want ? "You'll get tips and news." : "No more tips and news.");
    } catch {
      box.checked = !want;
      said("Couldn't save that. Try again.");
    }
    box.disabled = false;
  });
}

async function main() {
  let session = null;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch {}
  const token = session?.user ? await accessToken().catch(() => null) : null;
  if (!token) {
    status("");
    $("pf-signed-out").hidden = false;
    return;
  }
  try {
    let username = new URLSearchParams(location.search).get("u");
    if (!username) {
      const rows = await rest(`/rest/v1/profiles?id=eq.${encodeURIComponent(String(session.user.id).toLowerCase())}&select=username`, token);
      username = rows?.[0]?.username;
      if (!username) return status("Finish making your account to see your profile: open the planner and pick a username.");
    }
    const profile = await rest("/rest/v1/rpc/profile_view", token, { p_username: username });
    if (!profile) return status("This profile is only visible to people who've been on a drive with them.");
    render(profile);
    if (profile.is_me) emailPrefs(token);
  } catch {
    status("Couldn't load the profile. Check the connection and try again.");
  }
}

main();
