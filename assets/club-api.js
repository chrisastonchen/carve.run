// The club pages' calls (club v2, 11/9 night): App Dev's RPCs and
// org-billing as the signed-in organizer, with failures said plainly.
// club-org.js (v1, behind CLUB_V2) keeps its own copy.

import { SUPABASE_KEY, SUPABASE_URL, SESSION_KEY, accessToken } from "/assets/carve-session.js?v=a3869ea508";

export class Failure extends Error {}

export const WORDS = {
  sign_in: "Please sign in again.",
  not_admin: "Only the club's admins can change this.",
  not_organizer: "Only the club's organizers can do that.",
  organizer_cap: "Club has no room for more organizers.",
  not_owner: "Only the club's owner can change the plan and billing.",
  bad_input: "Something in that didn't work. Check it and try again.",
  not_found: "That wasn't found. It may have been deleted.",
  subscribed: "Your club already has a plan.",
  not_configured: "Plans can't be bought yet. Try again soon.",
  needs_plan: "This needs a plan. Start one in Club settings.",
  date_taken: "That day has a drive already.",
};

async function call(url, body, method = "POST") {
  const token = await accessToken().catch(() => null);
  if (!token) throw Object.assign(new Failure(WORDS.sign_in), { code: "sign_in" });
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check the connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error || data?.message;
    if (code === "bad_input" && /the owner/.test(String(data?.details || data?.detail || ""))) throw Object.assign(new Failure("The club's owner can't be removed."), { code: "owner" });
    // The baseline's past pre-run date (drive_prerun_set, detail prerun_past).
    if (code === "bad_input" && /prerun_past/.test(String(data?.details || data?.detail || data?.hint || ""))) throw Object.assign(new Failure("Pick a pre-drive date from today on."), { code: "prerun_past" });
    // No drive in the past (0061, drive_day_put and drive_create): said as the form says it.
    const past = code === "bad_input" && /\b(day_past|meet_soon)\b/.exec(String(data?.details || data?.detail || data?.hint || ""));
    if (past) throw Object.assign(new Failure(past[1] === "day_past" ? "Pick a date from today on." : "Meet at least 30 minutes from now."), { code: past[1] });
    // One plan (Chris, 11/10): the server's limit (organizer_cap's details { limit, used }), no upgrade.
    if (code === "organizer_cap") {
      let limit = null;
      try { limit = JSON.parse(data?.details || "{}").limit ?? null; } catch {}
      if (limit != null) throw Object.assign(new Failure(`Club has room for ${limit} organizers.`), { code, details: data?.details });
    }
    throw Object.assign(new Failure(WORDS[code] || "Something went wrong. Try again."), { code, details: data?.details });
  }
  return data;
}

export const rpc = (name, body = {}) => call(`${SUPABASE_URL}/rest/v1/rpc/${name}`, body);
export const billing = (body) => call(`${SUPABASE_URL}/functions/v1/org-billing`, body);
/// The organizer invite email (App Dev's org-invite-send, 0094): {org_id, email}.
export const inviteSend = (body) => call(`${SUPABASE_URL}/functions/v1/org-invite-send`, body);
/// Rows into a table as the organizer (a duplicated drive's routes and shares).
export const insert = (table, rows) => call(`${SUPABASE_URL}/rest/v1/${table}`, rows);
/// Rows the organizer may read (RLS), e.g. their own routes' last saves.
export const select = (table, query) => call(`${SUPABASE_URL}/rest/v1/${table}?${query}`, null, "GET");

/// A call anyone may make, signed out too (0100's invite preview), with the
/// site's key. → the answer, or null when it couldn't be asked.
export async function publicRpc(name, body = {}) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/// Signed in with a live token (the site's own session).
export async function signedIn() {
  return !!localStorage.getItem(SESSION_KEY) && !!(await accessToken().catch(() => null));
}

/// The signed-in account's email, from the stored session.
export function sessionEmail() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}")?.user?.email || ""; } catch { return ""; }
}

/// The signed-in account's id, from the stored session.
export function sessionUserId() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}")?.user?.id || ""; } catch { return ""; }
}

export const $ = (id) => document.getElementById(id);

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/// The club pages' orgs: yours, organizers and admins only (members plan nothing).
export async function myOrgs() {
  return ((await rpc("orgs_mine")) || []).filter((o) => o.role !== "member");
}
