// carve.run/club/settings/, club v2 (the wires' O2c): the club's name,
// its organizers, and the plan and billing moved here from Club home.
// Update card, Invoices and Cancel plan open Stripe's billing portal
// (org-billing). One plan (Chris, 11/10 afternoon): no Change plan, so
// Cancel plan is the only change. Billing is the owner's alone.

import { $, billing, myOrgs, rpc, signedIn } from "/assets/club-api.js?v=dd477d6d29";
import { organizersBox } from "/assets/club-organizers.js?v=3eb3ba3078";
import { billingLine, trialStatus } from "/assets/club-words.js?v=5a33e1fdc7";
import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";

const status = (text) => { $("cp-status").textContent = text || ""; $("cp-status").hidden = !text; };
const isOwner = (o) => (typeof o?.owner === "boolean" ? o.owner : o?.role === "admin");

let org = null;
let plan = null; // org-billing's status

async function start() {
  if (!(await signedIn())) {
    status("");
    $("o-signin").hidden = false;
    $("o-signin-go").addEventListener("click", () => window.carveSignIn?.({ returnTo: location.pathname + location.search }));
    return;
  }
  let orgs;
  try {
    orgs = await myOrgs();
  } catch (failure) {
    return status(failure.message);
  }
  const want = new URLSearchParams(location.search).get("org");
  org = orgs.find((o) => o.id === want) || orgs[0] || null;
  if (!org) return status("You don't organize a club yet.");
  status("");
  $("s-page").hidden = false;
  $("s-back").textContent = `‹ ${org.name}`;
  $("s-back").setAttribute("href", `/club/?org=${encodeURIComponent(org.id)}`);
  $("s-name").value = org.name;
  organizersBox("s-orgz", () => org, { removable: true }).load();
  wire();
  renderPlan();
  if (isOwner(org) && BY_TIER[org.tier]?.for === "organizers") {
    billing({ action: "status", org_id: org.id }).then((s) => { plan = s; renderPlan(); }).catch(() => {});
  }
}

function renderPlan() {
  const p = BY_TIER[org.tier];
  const on = p?.for === "organizers";
  const owner = isOwner(org);
  $("s-plan-name").textContent = on ? `${p.name} · ${p.price}` : "No plan yet";
  // Billing's word, else the trial orgs_mine knows (a trial without Stripe).
  $("s-plan-line").textContent = on ? billingLine(plan?.trial_ends_at || plan?.renews_at ? plan : trialStatus(org)) : "Try Club free for 30 days.";
  $("s-start").hidden = on || !owner;
  $("s-start").setAttribute("href", `/club/?org=${encodeURIComponent(org.id)}`);
  $("s-billing").hidden = !on || !owner;
  $("s-cancel").hidden = !on || !owner || !!plan?.cancel_at_period_end;
  $("s-not-owner").hidden = owner;
  $("s-not-owner").textContent = "Only the club's owner can change the plan and billing.";
}

async function portal(button) {
  button.disabled = true;
  $("s-plan-said").textContent = "Opening Stripe…";
  try {
    const { url } = await billing({ action: "portal", org_id: org.id });
    location.href = url;
  } catch (failure) {
    $("s-plan-said").textContent = failure.message;
    button.disabled = false;
  }
}

function wire() {
  $("s-save").addEventListener("click", async () => {
    const name = $("s-name").value.trim();
    if (!name) return ($("s-club-said").textContent = "Add the name.");
    try {
      org = { ...org, ...(await rpc("org_update", { p_org_id: org.id, p_patch: { name } })) };
      $("s-back").textContent = `‹ ${org.name}`;
      $("s-club-said").textContent = "Saved.";
    } catch (failure) {
      $("s-club-said").textContent = failure.message;
    }
  });
  for (const id of ["s-card", "s-invoices", "s-cancel"]) $(id).addEventListener("click", () => portal($(id)));
}

if (typeof document !== "undefined" && $("s-page")) start();
