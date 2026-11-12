// For Clubs (board F1; Product's spec and Chris's yes, 11/11): /club/'s page
// for someone with no club yet, signed out or signed in. The price, the
// trial, the renewal terms (word for word O1's) and the maths come from
// plans.js, so a price change follows the runbook in one place. The phone
// plays the group clip, muted and inline; the poster alone for reduced
// motion or Save-Data.

import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";
import { priceText, renewalTerms, trialDays } from "/assets/club-words.js?v=e4108d1a92";

const $ = (id) => document.getElementById(id);

/// The page's numbers: "$499 a year", "First 30 days free", the terms, and
/// 100 drivers a year each on Individual against Club (Chris, 11/11). Pure,
/// for the tests.
export const DRIVERS = 100;
export function introNumbers(plans = BY_TIER) {
  const club = plans.club || {};
  const solo = plans.solo || {};
  const days = trialDays(club);
  const cents = Number.isFinite(solo.year) ? Math.round(solo.year * 100) * DRIVERS : null;
  return {
    price: Number.isFinite(club.year) ? `${priceText(club.year)} a year` : "",
    trial: days ? `First ${days} days free` : "",
    terms: renewalTerms(club, days > 0),
    many: cents == null ? "" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })} a year`,
    club: Number.isFinite(club.year) ? `${priceText(club.year)} a year` : "",
  };
}

function clip() {
  const screen = $("f1-screen");
  if (!screen || screen.querySelector("video")) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || navigator.connection?.saveData;
  if (still) return;
  const video = document.createElement("video");
  Object.assign(video, { muted: true, loop: true, autoplay: true, playsInline: true, preload: "auto", disablePictureInPicture: true, poster: "/assets/app/group.jpg?v=f50902c121" });
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.src = "/assets/app/group.mp4?v=1ef26e6527";
  // The poster stays until the clip really plays.
  video.addEventListener("playing", () => $("f1-poster")?.remove(), { once: true });
  video.addEventListener("error", () => video.remove(), { once: true });
  screen.prepend(video);
  video.play?.().catch(() => {});
}

/// Shows the page. `start`: the trial button (sign-in first, or O1);
/// `login`: Log in, or null when signed in (hidden).
export function showIntro({ start, login = null }) {
  const n = introNumbers();
  for (const [id, text] of [["f1-price", n.price], ["f1-trial", n.trial], ["f1-terms", n.terms], ["f1-many", n.many], ["f1-club", n.club]]) if (text && $(id)) $(id).textContent = text;
  $("o-signin").hidden = false;
  for (const id of ["o-signin-go", "o-signin-go2"]) $(id).onclick = start;
  $("o-login").hidden = !login;
  $("o-login").onclick = login;
  clip();
}

export function hideIntro() {
  $("o-signin").hidden = true;
  $("f1-screen")?.querySelector("video")?.pause();
}
