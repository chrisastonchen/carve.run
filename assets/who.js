// Who's looking (who-words.js): the account's clubs (orgs_mine) and its
// store Apex (apex_mine), asked once and kept for the browser session, so a
// page load doesn't ask again. → { state, clubs }
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL, accessToken, store } from "/assets/carve-session.js?v=a3869ea508";
import { clubsOf, stateOf } from "/assets/who-words.js?v=65edaf422f";
import { PLANS } from "/assets/plans.js?v=a1e99a533b";

const KEPT = "carve.who";
const KEEP_MS = 10 * 60_000;
/// A checkout opened in this tab (club-home.js): until an answer has a
/// club on its plan, none is kept, as Stripe's word may land after the
/// page asks (a new organizer, 11/18: the bar said For Clubs and home
/// offered Club for ten minutes after paying, until he signed out).
const PAYING = "carve.who.paying";
const PAYING_MS = 30 * 60_000;
const paying = () => {
  try { return Date.now() - Number(sessionStorage.getItem(PAYING) || 0) < PAYING_MS; } catch { return false; }
};
const CLUB_TIERS = [...PLANS.filter((p) => p.for === "organizers").map((p) => p.tier), "group"];

const userId = () => store.get(SESSION_KEY)?.user?.id || null;

/// What this session already knows, at once (null: not yet asked).
export function whoNow() {
  const id = userId();
  if (!id) return { state: "out", clubs: [] };
  try {
    const kept = JSON.parse(sessionStorage.getItem(KEPT) || "null");
    if (kept?.id === id && Date.now() - kept.at < KEEP_MS) return { state: kept.state, clubs: kept.clubs };
  } catch {}
  return null;
}

async function rpc(name, token) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`${name} ${response.status}`);
  return response.json();
}

let asking = null;
/// The account's state, asked when this session doesn't know it yet. A
/// failed ask reads as Free (signed in), so nothing is offered that isn't theirs.
export function who() {
  const known = whoNow();
  if (known) return Promise.resolve(known);
  asking ??= (async () => {
    const id = userId();
    const token = await accessToken().catch(() => null);
    if (!token) return { state: "out", clubs: [] };
    const [orgs, apex] = await Promise.all([rpc("orgs_mine", token).catch(() => null), rpc("apex_mine", token).catch(() => null)]);
    const answer = { state: stateOf({ signedIn: true, orgs: orgs || [], apex, clubTiers: CLUB_TIERS }), clubs: clubsOf(orgs || [], CLUB_TIERS) };
    // Only a whole answer is kept: one that failed is asked again next page;
    // while paying, one without the club on its plan too.
    if (answer.state === "club") try { sessionStorage.removeItem(PAYING); } catch {}
    if (orgs && apex && !paying()) try { sessionStorage.setItem(KEPT, JSON.stringify({ id, at: Date.now(), ...answer })); } catch {}
    return answer;
  })().finally(() => { asking = null; });
  return asking;
}

/// Forget it (a club was started, a plan bought, signed out); `paying`: a
/// checkout is opening, so keep nothing until the club is on its plan. The
/// bar asks again (site-nav.js, on carve:who).
export function forgetWho({ paying: pay = false } = {}) {
  try {
    sessionStorage.removeItem(KEPT);
    if (pay) sessionStorage.setItem(PAYING, String(Date.now()));
  } catch {}
  window.dispatchEvent(new Event("carve:who"));
}
