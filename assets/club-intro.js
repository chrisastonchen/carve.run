// For Clubs (Sales and Marketing's layout, Chris's yes 11/12): /club/'s page
// for someone with no club yet, signed out or signed in. The price, the
// trial and the maths come from plans.js, so a price change follows the
// runbook in one place. The clips play only while on screen, muted and
// inline; the posters alone for reduced motion or Save-Data.

import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";
import { priceText, renewalTerms, trialDays } from "/assets/club-words.js?v=768f355b17";

const $ = (id) => document.getElementById(id);

/// The page's numbers: "$499 a year.", "First 30 days free.", the button,
/// "Then $499 a year. Cancel any time.", and 100 drivers each on
/// Individual against Club (Chris, 11/11). Pure, for the tests.
export const DRIVERS = 100;
export function introNumbers(plans = BY_TIER) {
  const club = plans.club || {};
  const solo = plans.solo || {};
  const days = trialDays(club);
  const price = Number.isFinite(club.year) ? priceText(club.year) : "";
  const cents = Number.isFinite(solo.year) ? Math.round(solo.year * 100) * DRIVERS : null;
  return {
    price: price ? `${price} a year.` : "",
    trial: days ? `First ${days} days free.` : "",
    go: days ? `Try Club free for ${days} days` : price ? `Start Club for ${price}` : "",
    then: price ? `${days ? "Then " : ""}${price} a year. Cancel any time.` : "",
    terms: renewalTerms(club, days > 0),
    many: cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`,
    club: price,
  };
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
let watching = null;

/// Each clip plays while it's on screen, and stops when it isn't.
function clips() {
  if (watching || still() || !("IntersectionObserver" in window)) return;
  watching = new IntersectionObserver((seen) => {
    for (const { target, isIntersecting } of seen) {
      if (isIntersecting) target.play?.().catch(() => {});
      else target.pause?.();
    }
  }, { threshold: 0.25 });
  for (const video of document.querySelectorAll(".fc-clip")) watching.observe(video);
}

/// Smart planning's pins grow in turn once the map is 40% in view, once a
/// page view (club-intro.css .fc-anim). Reduced motion: shown at once.
function pins() {
  const map = $("fc-map");
  if (!map || map.classList.contains("fc-anim") || still() || !("IntersectionObserver" in window)) return;
  map.classList.add("fc-anim");
  const seen = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) return;
    map.classList.add("on");
    seen.disconnect();
  }, { threshold: 0.4 });
  seen.observe(map);
}

/// Shows the page. `start`: the trial buttons (sign-in first, or O1);
/// `login`: Log in, or null when signed in (hidden).
export function showIntro({ start, login = null }) {
  const n = introNumbers();
  for (const [id, text] of [["f1-price", n.price], ["f1-trial", n.trial], ["fc-then", n.then], ["f1-many", n.many], ["f1-club", n.club], ["o-signin-go", n.go], ["o-signin-go2", n.go]]) if (text && $(id)) $(id).textContent = text;
  if (!n.trial && $("f1-trial")) $("f1-trial").hidden = true;
  $("o-signin").hidden = false;
  for (const id of ["o-signin-go", "o-signin-go2"]) $(id).onclick = start;
  $("o-login").hidden = !login;
  $("o-login").onclick = login;
  clips();
  pins();
}

export function hideIntro() {
  $("o-signin").hidden = true;
  for (const video of document.querySelectorAll(".fc-clip")) video.pause?.();
}
