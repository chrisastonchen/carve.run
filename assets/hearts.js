// A road's heart (the user, 2026-11-04): kept in My Drives, the way the
// app's heart keeps one (HomeContent toggleHeart → onKeepLink). The kept
// route is a copy in the account that follows the road's share link: its
// own id, origin_route_id the road's route, payload.followsShareToken its
// token, and no share token of its own, so the app shows it hearted too.
// Taking the heart off tombstones it (deleted_at), as the app's sync does.
import { appleDate, newUUID, routeRow } from "/plan/route-wire.js";
import { SESSION_KEY, SUPABASE_KEY, SUPABASE_URL, accessToken, store } from "/assets/carve-session.js?v=a3869ea508";

export const HEART_PATH = "M12 20.3s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.7c0 5.6-7.6 10.2-7.6 10.2z";

export const signedIn = () => !!store.get(SESSION_KEY)?.refresh_token;

async function rest(path, { method = "GET", body, prefer } = {}) {
  const token = await accessToken();
  if (!token) throw Object.assign(new Error("Sign in to save roads."), { status: 401 });
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw Object.assign(new Error("Couldn't save that. Try again."), { status: response.status });
  return response.status === 204 || prefer?.includes("minimal") ? null : response.json();
}

let kept = null;

/// The roads this account has hearted: share token → the kept route's id.
export function hearted() {
  if (!signedIn()) return Promise.resolve(new Map());
  kept ||= rest("/rest/v1/routes?select=id,follows:payload->>followsShareToken&deleted_at=is.null&origin_route_id=not.is.null")
    .then((rows) => new Map(rows.filter((r) => r.follows).map((r) => [r.follows, r.id])))
    .catch(() => new Map());
  return kept;
}

/// Heart a road by its share token: its route, copied into the account.
export async function heart(token) {
  const rows = await rest("/rest/v1/rpc/redeem_share_token", { method: "POST", body: { share_token: token } });
  const row = rows?.[0];
  if (!row?.payload) throw Object.assign(new Error("That road couldn't be found."), { plain: true });
  const session = store.get(SESSION_KEY);
  const now = appleDate();
  const id = newUUID(() => crypto.randomUUID());
  const { shareToken, ...rest_ } = row.payload;
  const payload = { ...rest_, id, originRouteId: String(row.id).toUpperCase(), followsShareToken: token, createdAt: now, updatedAt: now };
  const record = { ...routeRow({ id }, session.user.id, payload), origin_route_id: String(row.id).toLowerCase() };
  await rest("/rest/v1/routes", { method: "POST", body: [record], prefer: "return=minimal" });
  (await hearted()).set(token, id.toLowerCase());
}

/// Take a road's heart off: its kept route, tombstoned.
export async function unheart(token) {
  const map = await hearted();
  const id = map.get(token);
  if (!id) return;
  await rest(`/rest/v1/routes?id=eq.${encodeURIComponent(String(id).toLowerCase())}`, {
    method: "PATCH", body: { deleted_at: new Date().toISOString() }, prefer: "return=minimal",
  });
  map.delete(token);
}

/// The heart's button for a road, filled when kept (aria-pressed): wire it with wireHearts.
export function heartButton(token, name, on = false) {
  const label = `${on ? "Saved" : "Save"} ${name}`;
  return `<button type="button" class="heart" data-heart="${token}" aria-pressed="${on}" aria-label="${label.replace(/"/g, "&quot;")}">`
    + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART_PATH}"/></svg></button>`;
}

/// Hearts in a list: fills the kept ones, and a click keeps or lets go (signed
/// out, the site's sign-in, titled Join for free).
export function wireHearts(root, { onSaved } = {}) {
  heartStyle();
  hearted().then((map) => {
    for (const button of root.querySelectorAll("[data-heart]")) setOn(button, map.has(button.dataset.heart));
  });
  if (root.dataset.heartsWired) return;
  root.dataset.heartsWired = "1";
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-heart]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    if (!signedIn()) {
      if (!(window.carveSignIn && window.carveSignIn({ join: true, returnTo: location.pathname + location.search }))) location.href = "/plan/#sign-in";
      return;
    }
    const token = button.dataset.heart;
    const on = button.getAttribute("aria-pressed") !== "true";
    setOn(button, on);
    button.disabled = true;
    try {
      if (on) await heart(token);
      else await unheart(token);
      onSaved?.(on);
    } catch (failure) {
      setOn(button, !on);
      onSaved?.(null, failure.status || failure.plain ? failure.message : "Couldn't save that. Try again.");
    } finally {
      button.disabled = false;
    }
  });
}

// The heart's look, once per page, wherever hearts are drawn.
function heartStyle() {
  if (document.getElementById("heart-style")) return;
  const style = document.createElement("style");
  style.id = "heart-style";
  style.textContent = ".heart{width:36px;height:36px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.94);color:#15181C;"
    + "display:grid;place-items:center;box-shadow:0 1px 4px rgba(0,0,0,.18);cursor:pointer;flex:none}"
    + ".heart svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.1;stroke-linejoin:round}"
    + ".heart[aria-pressed=true] svg{fill:#E0245E;stroke:#E0245E}.heart:disabled{opacity:.7}"
    + ".heart:focus-visible{outline:3px solid #1D5B3A;outline-offset:2px}";
  document.head.append(style);
}

function setOn(button, on) {
  button.setAttribute("aria-pressed", String(on));
  const name = (button.getAttribute("aria-label") || "").replace(/^(Save|Saved) /, "");
  button.setAttribute("aria-label", `${on ? "Saved" : "Save"} ${name}`);
}
