// The link page's "Free from your club" card (board A1), on a club drive's
// day link with ROUTE_APEX_UI on (club-flags.js): route_apex says whether
// Apex is on for this route, or will be, and until when. Its words are
// apex-words.js's. Nothing to claim: the app reads the same route_apex.
// route_apex is POST only (the first call in the lead window starts it).

import { SUPABASE_KEY, SUPABASE_URL } from "/assets/carve-session.js?v=a3869ea508";
import { apexCard } from "/assets/apex-words.js?v=dc3ff3eb05";
import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";
import { priceText } from "/assets/club-words.js?v=768f355b17";

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/// The card above the way into the app, for `token` (a day's link), dated in the drive's `zone`.
export async function drawApexCard(token, zone) {
  let answer = null;
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/route_apex`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ p_share_token: token }),
    });
    if (response.ok) answer = await response.json();
  } catch {
    return;
  }
  const year = BY_TIER.solo?.year;
  const card = apexCard(answer, zone, Number.isFinite(year) ? priceText(year) : "");
  const before = document.querySelector(".rv .scroll .scan");
  if (!card || !before || document.getElementById("apex-card")) return;
  const box = el("section", "apex-card");
  box.id = "apex-card";
  box.setAttribute("aria-labelledby", "apex-card-h");
  const heading = el("h2", "", card.heading);
  heading.id = "apex-card-h";
  const list = el("ul", "apex-feats");
  for (const f of card.features) list.append(el("li", "", f));
  box.append(el("span", "apex-pill", card.pill), heading, el("p", "apex-line", card.line), list);
  if (card.expires) box.append(el("p", "apex-ends", card.expires));
  before.before(box);
}
