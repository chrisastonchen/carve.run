// The planner's sign-in (carve.plan.session), for the pages that call Carve
// as the visitor: My Drives, a route's plan.

export const SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
export const SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
export const SESSION_KEY = "carve.plan.session";

export const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

/// The planner's sign-in, fresh: the same rules as plan.js accessToken
/// (another tab's refresh wins; only Carve saying no signs out).
export async function accessToken() {
  const session = store.get(SESSION_KEY);
  if (!session?.refresh_token) return null;
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
  } catch {
    return session.access_token;
  }
  if (!response.ok) {
    const now = store.get(SESSION_KEY);
    if (now?.refresh_token && now.refresh_token !== session.refresh_token) return now.access_token;
    // Carve said no (signed out elsewhere, e.g. the app's Sign Out ends every
    // session): forget it, so the site bar offers Sign in, not Sign out.
    if (response.status >= 400 && response.status < 500) {
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }
    return null;
  }
  const data = await response.json();
  store.set(SESSION_KEY, {
    ...session,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  });
  return data.access_token;
}
