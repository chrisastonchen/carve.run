// A club drive's day in the planner (club v2's O5; Chris, 11/9 night):
// /plan/?drive=<id>&day=<n>. The planner as it is, with a dark drive bar
// on top (back to the drive, a day switch on drives of more than one day)
// and Done where "Save and get the link" is: Done saves the day's route
// (in place, so its link stays: saveGroupRoute and 0071) and goes back to
// the drive page.
//
// What it opens on: the day's own route; else, with nothing saved for it
// yet, Day N-1's end as its start (Product's prefill, 11/9), or the day's
// meeting place. Unsaved changes are kept in the browser per day.

/// Where a day starts before it has a route: the day before's end (its
/// start again on a loop), else the day's meeting place. → spot or null
export function dayStart(prevPlan, day, n) {
  if (prevPlan) {
    const loops = prevPlan.trip === "roundTrip" || prevPlan.trip === "outAndBack";
    const end = loops ? prevPlan.start : prevPlan.end || prevPlan.waypoints?.[prevPlan.waypoints.length - 1];
    // Its name as the route has it; none, the planner names it (nameSpot),
    // since it becomes the drive link's "meet at" (startName).
    if (end && Number.isFinite(end.lat) && Number.isFinite(end.lon)) return { lat: end.lat, lon: end.lon, label: end.label || "" };
  }
  const p = day?.place;
  if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return { lat: p.lat, lon: p.lon, label: p.name || "Meeting place" };
  return null;
}

/// The club's area for a day with no start: where another day of the drive
/// starts, its first with a route. → { lat, lon } or null
export function nearOf(plans) {
  for (const p of plans) {
    const s = p?.start;
    if (s && Number.isFinite(s.lat) && Number.isFinite(s.lon)) return { lat: s.lat, lon: s.lon };
  }
  return null;
}

/// The day's leave time as the planner's leaveAt (ms, the browser's zone),
/// for the forecast and closures; null when it's gone by or not set.
export function leaveAtOf(day, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day?.date || "");
  if (!m) return null;
  const [h, min] = /^\d{1,2}:\d{2}/.test(day.leave || "") ? day.leave.split(":").map(Number) : [9, 0];
  const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, min).getTime();
  return at > now ? at : null;
}

/// The bar's day label: "Day 1 · Sat, Dec 12".
/// The bar's line after the drive's name: "· Sat, Dec 12 · meet 8:00 AM, leave 8:30 AM".
export function dayWhen(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day?.date || "");
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  const t = (hhmm) => { const x = /^(\d{1,2}):(\d{2})/.exec(hhmm || ""); return x ? `${Number(x[1]) % 12 || 12}:${x[2]} ${Number(x[1]) < 12 ? "AM" : "PM"}` : ""; };
  const times = [t(day?.meet) && `meet ${t(day.meet)}`, t(day?.leave) && `leave ${t(day.leave)}`].filter(Boolean).join(", ");
  return [date, times].filter(Boolean).map((x) => `· ${x}`).join(" ");
}

export function dayChip(day, i) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day?.date || "");
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";
  return date ? `Day ${i + 1} · ${date}` : `Day ${i + 1}`;
}

/// `hooks` from plan.js: { $, el, rpc, userId, planFromPayload, loadPlan,
/// hasDraft, done(href) }. → { load, setRoute, back, day }
export function initDriveDay({ ids, $, el, rpc, userId, planFromPayload, loadPlan, hasDraft, done }) {
  let drive = null;
  let routes = [];
  const n = ids.day;
  const back = () => `/club/drive/?id=${encodeURIComponent(ids.id)}`;
  const url = (k) => `/plan/?drive=${encodeURIComponent(ids.id)}&day=${k}`;
  const routeOf = (dayId) => routes.filter((r) => r.day_id === dayId).sort((a, b) => a.position - b.position)[0] || null;

  /// The saved route as the planner edits it: yours keeps its id and link;
  /// another organizer's goes through drive_route_update (driveRoute).
  function planOf(r) {
    // Its elevation too: the day's link draws the climb from it.
    const plan = { ...planFromPayload(r.payload || {}), elevationProfile: r.payload?.elevationProfile || null };
    return r.yours
      ? { ...plan, id: String(r.route_id).toUpperCase(), token: r.share_token, createdAt: r.payload?.createdAt ?? null, ownerId: userId() }
      : { ...plan, id: null, token: null, ownerId: null, createdAt: r.payload?.createdAt ?? null, driveRoute: { id: String(r.route_id).toLowerCase(), token: r.share_token } };
  }

  async function load() {
    [drive, routes] = await Promise.all([rpc("drive_get", { p_drive_id: ids.id }), rpc("drive_routes", { p_drive_id: ids.id }).then((x) => x || [])]);
    const days = drive.days || [];
    const day = days[n - 1];
    if (!day) throw Object.assign(new Error(`This drive has ${days.length === 1 ? "one day" : `${days.length} days`}.`), { code: "no_day" });
    renderBar();
    const leaveAt = leaveAtOf(day);
    // Changes not yet Done stay (the browser's draft for this day).
    if (hasDraft()) return { kept: true };
    const mine = routeOf(day.id);
    if (mine) {
      loadPlan({ ...planOf(mine), leaveAt });
      return { route: true };
    }
    const prev = n > 1 ? routeOf(days[n - 2].id) : null;
    const start = dayStart(prev ? planFromPayload(prev.payload || {}) : null, day, n);
    loadPlan({ name: routeName(), start, leaveAt });
    return { start: !!start, near: start ? null : nearOf(days.map((d) => routeOf(d.id)).filter(Boolean).map((r) => planFromPayload(r.payload || {}))) };
  }

  function renderBar() {
    $("drive-bar").hidden = false;
    document.body.classList.add("drive-day");
    document.title = `${drive.name || "Drive"} | Carve`;
    $("db-back").setAttribute("href", back());
    $("db-name").textContent = drive.name || "Your drive";
    const days = drive.days || [];
    $("db-when").textContent = dayWhen(days[n - 1]);
    $("route-eyebrow").textContent = `Day ${n} schedule`;
    $("db-days").hidden = days.length < 2;
    $("db-days").replaceChildren(...days.map((d, i) => {
      // "Day 1" (mock v11), its date said to a screen reader and on hover.
      const b = el("button", "db-day", `Day ${i + 1}`);
      b.setAttribute("aria-label", dayChip(d, i));
      b.title = dayChip(d, i);
      b.type = "button";
      b.setAttribute("aria-pressed", String(i + 1 === n));
      if (i + 1 !== n) b.addEventListener("click", () => done(url(i + 1)));
      return b;
    }));
    $("db-back").addEventListener("click", (e) => { e.preventDefault(); done(back()); });
  }

  /// The day's route name, from the drive (Chris, 11/10: no Name field
  /// here, the drive is named already): the drive's name, "· Day N" with
  /// several days. Set when the route is new; a renamed drive leaves
  /// saved routes' names alone (still open with Chris).
  function routeName() {
    const days = drive?.days || [];
    return days.length > 1 ? `${drive.name || "Drive"} · Day ${n}` : drive?.name || "Drive";
  }

  /// The day's route, set on the drive (its one route a day).
  async function setRoute({ route_id, share_token }) {
    const day = drive.days[n - 1];
    await rpc("drive_day_routes_set", { p_day_id: day.id, p_routes: [{ route_id, share_token, label: "" }] });
  }

  return { load, setRoute, back, routeName, day: () => drive?.days?.[n - 1] || null };
}
