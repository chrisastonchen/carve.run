// Carve's plans, written by scripts/pricing/build_plans.py from the
// plans' JSON beside this file: change them there, not here.
export const PLANS = [
  {"plan": "free", "tier": "none", "name": "Free", "for": "drivers", "drivers": 0, "organizers": 1, "year": 0.0, "price": "Free"},
  {"plan": "solo", "tier": "solo", "name": "Individual", "for": "drivers", "drivers": 0, "organizers": 1, "year": 49.99, "price": "$49.99 a year or $5.99 a month", "trial": "14 days free", "monthly": true, "tagline": "Apex for one driver"},
  {"plan": "club", "tier": "club", "name": "Club", "for": "organizers", "drivers": null, "organizers": 5, "year": 499.0, "price": "$499 a year", "trial": "30 days free", "tagline": "For car clubs and chapters"},
];
export const CONTACT = "chris@carve.run";
// Each tier's plan; a retired tier reads as the plan that replaced it
// (group as club).
export const BY_TIER = Object.fromEntries(PLANS.map((p) => [p.tier, p]));
BY_TIER["group"] = PLANS.find((p) => p.plan === "club");
