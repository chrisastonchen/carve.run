// Your drives: every drive of the organizations you plan for (org_drives,
// App Dev's contract §2), upcoming and past, plus an unsent draft kept in
// this browser. Opening one rebuilds the draft from the server
// (drive_get + drive_routes → driveFromServer), so a drive carries on in
// any browser and with any co-organizer.
//
// Your drafts (the user, 11/7 and 11/8): the same list's drafts on
// carve.run/plan's entry, with the day and when each was last edited, and
// Delete. A draft is a drive not yet sent beyond Myself: on the server
// once you're signed in with a club (group.js saves it as you go), or in
// this browser before that.

import { driveFromServer } from "./drive-sync.js?v=2";
import { partsOf } from "./drive-merge.js";

const GROUP_DRAFT = "carve.group.draft";
const GROUP_PLAN = "carve.group.plan";

/// Upcoming (no days yet, or a day today or later) and past.
export function splitDrives(drives, today) {
  const last = (d) => (d.days || []).map((x) => x.date).sort().at(-1) || null;
  const upcoming = drives.filter((d) => !last(d) || last(d) >= today);
  const past = drives.filter((d) => last(d) && last(d) < today);
  return { upcoming, past };
}

/// "Sat, Dec 12" or "Sat, Dec 12 – Sun, Dec 13".
export function datesText(days = []) {
  const dates = days.map((x) => x.date).sort();
  if (!dates.length) return "No date yet";
  const one = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  };
  return dates.length > 1 ? `${one(dates[0])} – ${one(dates.at(-1))}` : one(dates[0]);
}

/// "Edited 3:12 PM" today, else "Edited Nov 8".
export function editedText(when, now = new Date()) {
  const t = new Date(when);
  if (!Number.isFinite(t.getTime())) return "";
  const today = t.toDateString() === now.toDateString();
  return `Edited ${today ? t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : t.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

const STATUS = { draft: "Not sent yet", sent: "Sent", cancelled: "Cancelled" };

/// A draft in this browser that the server doesn't have: worth keeping.
export const unsentDraft = (d) => !!d && !d.server && !!(d.name || d.attendees?.length || d.days?.some((x) => x.legs?.some((l) => l.plan?.path)));

/// Every drive of the orgs you plan for, each with its org's name.
export async function loadDrives(rpc) {
  // Every org you're in is yours to plan for (0082: all organizers, no
  // roles); before 0082 a plain member wasn't.
  const orgs = ((await rpc("orgs_mine", {})) || []).filter((o) => o.role !== "member");
  const all = [];
  for (const o of orgs) for (const x of (await rpc("org_drives", { p_org_id: o.id })) || []) all.push({ ...x, org: o.name });
  return { orgs, all };
}

/// A drive from the server as this browser's draft.
export async function draftFromServer(api, id) {
  // Version 1 of each route the pre-run froze (0071, Club; Group says
  // club_only, and the drive loads without).
  const [got, routes, versions] = await Promise.all([
    api.rpc("drive_get", { p_drive_id: id }), api.rpc("drive_routes", { p_drive_id: id }),
    api.rpc("drive_route_versions", { p_drive_id: id }).catch(() => null),
  ]);
  const next = driveFromServer(got, routes, { planOf: api.planFromPayload, userId: api.account().id, versions: versions?.versions });
  // As the server has it: what later saves compare with (drive-merge.js).
  next.base = partsOf(next);
  return { next, got };
}

/// One drive in a list: open it, and for a draft, delete it (two taps).
function driveRow(el, x, { onOpen, onDelete, note = "", edited = false }) {
  const li = el("li", "dl-item");
  const b = el("button", "dl-row");
  b.type = "button";
  const words = el("span", "dl-words");
  const facts = [datesText(x.days), x.counts?.coming ? `${x.counts.coming} coming` : "", edited ? editedText(x.updated_at) : "", note];
  words.append(el("b", "", x.name || "Untitled drive"), el("span", "dim small", facts.filter(Boolean).join(" · ")));
  b.append(words);
  if (x.status) b.append(el("span", "chip", STATUS[x.status] || x.status));
  b.addEventListener("click", onOpen);
  li.append(b);
  if (onDelete) {
    const del = el("button", "dl-delete", "Delete");
    del.type = "button";
    del.setAttribute("aria-label", `Delete ${x.name || "this draft"}`);
    del.addEventListener("click", async () => {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.textContent = "Delete for good";
        del.setAttribute("aria-label", `Confirm: delete ${x.name || "this draft"} for good`);
        return;
      }
      del.disabled = true;
      await onDelete();
    });
    li.append(del);
  }
  return li;
}

/// A server draft gone: if it's this browser's draft too, that goes as well.
function forgetLocal(store, id) {
  const local = store.get(GROUP_DRAFT);
  if (!id || local?.id === id) {
    store.remove(GROUP_DRAFT);
    store.remove(GROUP_PLAN);
  }
}

/// The list in group mode, wired. `replace(next)` makes `next` this
/// browser's draft (and reloads); `go(step)` opens a step of the current one.
export function initDrives({ $, el, api, drive, replace, go, store, pull }) {
  let armed = null; // what the next tap replaces the unsent draft with

  async function render() {
    const d = drive();
    $("dl-said").textContent = "";
    $("dl-new").textContent = "Plan a new drive";
    armed = null;
    $("dl-local").replaceChildren();
    if (unsentDraft(d)) $("dl-local").append(driveRow(el, { name: d.name || "Untitled drive", days: d.days, status: null }, { onOpen: () => go("when"), note: "In this browser, not sent yet" }));
    if (!api.account()) {
      $("dl-lists").replaceChildren(el("p", "dim small", "Sign in to see your drives."));
      return;
    }
    $("dl-lists").replaceChildren(el("p", "dim small", "Loading…"));
    try {
      const { orgs, all } = await loadDrives(api.rpc);
      const { upcoming, past } = splitDrives(all, new Date().toISOString().slice(0, 10));
      const blocks = [];
      for (const [title, list] of [["Upcoming", upcoming], ["Past", past]]) {
        if (!list.length) continue;
        const ul = el("ul", "dl-list");
        ul.append(...list.map((x) => driveRow(el, x, {
          onOpen: () => open(x),
          note: orgs.length > 1 ? x.org : "",
          edited: x.status === "draft",
          onDelete: x.status === "draft" ? () => remove(x) : null,
        })));
        blocks.push(el("h3", "eyebrow", title), ul);
      }
      $("dl-lists").replaceChildren(...(blocks.length ? blocks : [el("p", "dim small", "No drives yet.")]));
    } catch (failure) {
      $("dl-lists").replaceChildren(el("p", "dim small", failure?.message || "Couldn't load your drives. Try again."));
    }
  }

  // An unsent draft is never lost without a second tap.
  function guard(label) {
    if (!unsentDraft(drive()) || armed === label) return true;
    armed = label;
    $("dl-said").textContent = `This replaces "${drive().name || "Untitled drive"}", which hasn't been sent. Tap again to go ahead.`;
    return false;
  }

  async function open(x) {
    // This browser's own: the server's changes come in first.
    if (x.id === drive().id) {
      await pull?.();
      return go(x.status === "draft" ? "when" : "page");
    }
    if (!guard(x.id)) return;
    $("dl-said").textContent = "Opening…";
    try {
      const { next, got } = await draftFromServer(api, x.id);
      if (got.status === "draft") next.step = "when";
      replace(next, got);
    } catch (failure) {
      $("dl-said").textContent = failure?.message || "Couldn't open that drive. Try again.";
    }
  }

  async function remove(x) {
    try {
      await api.rpc("drive_delete", { p_drive_id: x.id });
      if (x.id === drive().id) replace(null);
      else render();
    } catch (failure) {
      $("dl-said").textContent = failure?.message || "Couldn't delete that draft. Try again.";
      render();
    }
  }

  $("dl-new").addEventListener("click", () => {
    if (!guard("new")) {
      $("dl-new").textContent = "Replace it with a new drive";
      return;
    }
    replace(null);
  });

  return { render };
}

/// Your drafts on carve.run/plan's entry (not group mode): this browser's
/// unsent draft and the server's drafts, newest edit first. Opening one
/// goes on to the group flow with it.
export function initDraftsEntry({ $, el, api, store }) {
  let armedOpen = null;

  async function render() {
    const local = store.get(GROUP_DRAFT);
    const rows = [];
    if (unsentDraft(local)) rows.push({ local: true, id: local.id, name: local.name || "Untitled drive", days: local.days, updated_at: local.updatedAt });
    if (api.account()) {
      try {
        const { all } = await loadDrives(api.rpc);
        for (const x of all) if (x.status === "draft" && x.id !== local?.id) rows.push(x);
        // A server draft that's this browser's: its newer edits are here.
        if (local?.server && local.server.status !== "sent" && all.some((x) => x.id === local.id && x.status === "draft")) {
          rows.push({ ...all.find((x) => x.id === local.id), updated_at: local.updatedAt, here: true });
        }
      } catch {
        // The list without the server's: still this browser's draft.
      }
    }
    rows.sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    $("pd-drafts").hidden = !rows.length;
    // All drafts here: no "Not sent yet" on each.
    $("pd-list").replaceChildren(...rows.map((x) => driveRow(el, { ...x, status: null }, {
      onOpen: () => open(x),
      edited: true,
      note: x.local ? "In this browser" : "",
      onDelete: () => remove(x),
    })));
  }

  async function open(x) {
    const local = store.get(GROUP_DRAFT);
    if (x.local || x.here) return location.assign("/plan/?group");
    // Opening another replaces an unsent draft in this browser: a second tap.
    if (unsentDraft(local) && armedOpen !== x.id) {
      armedOpen = x.id;
      $("pd-said").textContent = `This replaces "${local.name || "Untitled drive"}" in this browser, which isn't saved to your account. Tap again to go ahead.`;
      return;
    }
    $("pd-said").textContent = "Opening…";
    try {
      const { next, got } = await draftFromServer(api, x.id);
      next.step = "when";
      next.server = { status: got.status, url: got.url, token: got.token, sends: got.sends || [], days: [] };
      store.set(GROUP_DRAFT, next);
      store.remove(GROUP_PLAN);
      location.assign("/plan/?group");
    } catch (failure) {
      $("pd-said").textContent = failure?.message || "Couldn't open that draft. Try again.";
    }
  }

  async function remove(x) {
    try {
      if (!x.local) await api.rpc("drive_delete", { p_drive_id: x.id });
      forgetLocal(store, x.local ? null : x.id);
      $("pd-said").textContent = "Draft deleted.";
    } catch (failure) {
      $("pd-said").textContent = failure?.message || "Couldn't delete that draft. Try again.";
    }
    render();
  }

  return { render };
}
