// Who's looking (who-words.js): the account's clubs (orgs_mine) and its
// store Apex (apex_mine), asked once and kept for the browser session, so a
// page load doesn't ask again. → { state, clubs }
// A club member's clubs are also remembered in this browser (whoHint), so a
// new tab draws the bar and Plan a drive with them at once, before Carve
// answers (Chris, 11/20: 3–5 s otherwise); Carve's answer then confirms or
// corrects them. Only a whole answer with a club sets it; one without, a
// sign-out or another account clears it.
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL, accessToken, store } from "/assets/carve-session.js?v=b314b52348";
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
const HINT = "carve.who.hint";
const HINT_MS = 30 * 86_400_000;
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

/// The clubs this browser last heard this account has, to draw before
/// Carve answers (null: none, or another account's, or a month old).
export function whoHint() {
  const id = userId();
  if (!id) return null;
  try {
    const hint = JSON.parse(localStorage.getItem(HINT) || "null");
    if (hint?.id === id && hint.state === "club" && Array.isArray(hint.clubs) && hint.clubs.length && Date.now() - hint.at < HINT_MS) {
      return { state: "club", clubs: hint.clubs };
    }
    if (hint) localStorage.removeItem(HINT);
  } catch {}
  return null;
}

/// Forget the hint (signed out, another account).
export function forgetHint() {
  try { localStorage.removeItem(HINT); } catch {}
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
    // The hint: a club member's clubs, from a whole answer; one without a
    // club ends it. Clubs unknown (orgs_mine failed): the hint stands, as
    // Carve hasn't said otherwise.
    if (orgs && answer.state === "club") try { localStorage.setItem(HINT, JSON.stringify({ id, at: Date.now(), state: "club", clubs: answer.clubs })); } catch {}
    else if (orgs) forgetHint();
    else {
      const hint = whoHint();
      if (hint) return hint;
    }
    return answer;
  })().finally(() => { asking = null; });
  return asking;
}

/// Forget it (a club was started, a plan bought, signed out); `paying`: a
/// checkout is opening, so keep nothing until the club is on its plan. The
/// bar asks again (site-nav.js, on carve:who).
export function forgetWho({ paying: pay = false } = {}) {
  forgetHint();
  try {
    sessionStorage.removeItem(KEPT);
    if (pay) sessionStorage.setItem(PAYING, String(Date.now()));
  } catch {}
  window.dispatchEvent(new Event("carve:who"));
}
