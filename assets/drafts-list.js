// Drafts (0089, board N6): the account's list, for the Drafts page and the
// planner's "drafts are full" prompt. Each row: name, roads and when it last
// changed, "Deleted in N days" near the end, Open and Delete (twice).
import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=a3869ea508";
import { WORDS, deletesText, factsText, nameText } from "/assets/drafts-words.js?v=45d294d9b7";

async function rpc(name, body = {}) {
  const token = await accessToken();
  if (!token) throw Object.assign(new Error("sign_in"), { code: "sign_in" });
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(data?.message || "failed"), { code: data?.message });
  return data;
}

export const draftsMine = () => rpc("drafts_mine");
export const draftDelete = (id) => rpc("draft_delete", { p_id: id });

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

/// The rows, in `list` (a <ul>); `onDeleted(id)` after one goes. `open`:
/// false in the planner's prompt (it's for deleting).
export function drawDrafts(list, drafts, { onDeleted, open = true, now = Date.now() } = {}) {
  list.replaceChildren(...drafts.map((d) => {
    const li = el("li", "draft-row");
    li.dataset.id = d.id;
    const what = el("div", "what");
    const name = open ? el("a", "name", nameText(d)) : el("span", "name", nameText(d));
    if (open) name.href = `/plan/?draft=${encodeURIComponent(d.id)}`;
    what.append(name, el("span", "facts", factsText(d, now)));
    const goes = deletesText(d.deletes_at, now);
    if (goes) what.append(el("span", "goes", goes));
    const acts = el("div", "acts");
    if (open) {
      const a = el("a", "open", WORDS.open);
      a.href = name.getAttribute("href");
      acts.append(a);
    }
    const del = el("button", "del", WORDS.delete);
    del.type = "button";
    del.addEventListener("click", async () => {
      // Asked twice: nothing goes without saying so.
      if (!del.dataset.sure) {
        del.dataset.sure = "1";
        del.textContent = WORDS.sure;
        return;
      }
      del.disabled = true;
      try {
        await draftDelete(d.id);
        li.remove();
        onDeleted?.(d.id);
      } catch {
        del.disabled = false;
        del.textContent = WORDS.delete;
        delete del.dataset.sure;
      }
    });
    acts.append(del);
    li.append(what, acts);
    return li;
  }));
}

/// The rows' look, for a page or a dialog that doesn't have it.
export const DRAFT_CSS = `
.draft-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.draft-row { display: flex; align-items: center; gap: 14px; padding: 14px 16px 14px 20px; border-radius: 16px; background: #161B18; border: 1px solid #2A332E; }
.draft-row .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.draft-row .name { font-weight: 700; font-size: 17px; color: inherit; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.draft-row a.name:hover { text-decoration: underline; }
.draft-row .facts { color: #9AA39D; font-size: 14.5px; }
.draft-row .goes { padding: 2px 10px; border-radius: 999px; background: #3A2A14; color: #F0B266; font-size: 13px; font-weight: 700; }
.draft-row .acts { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }
.draft-row .open { display: inline-flex; align-items: center; height: 38px; padding: 0 16px; border-radius: 999px; background: #1D5B3A; color: #fff; font-weight: 700; font-size: 15px; text-decoration: none; }
.draft-row .del { height: 38px; padding: 0 14px; border: 0; border-radius: 999px; background: none; color: #EC796F; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.draft-row .del[data-sure] { background: #371715; }
@media not all and (prefers-color-scheme: dark) {
  .draft-row { background: #fff; border-color: #E4E3DE; }
  .draft-row .facts { color: #5D636C; }
  .draft-row .goes { background: #FFF1DD; color: #8A4B00; }
  .draft-row .del { color: #B3261E; }
  .draft-row .del[data-sure] { background: #FDECEA; }
}
@media (max-width: 699px) { .draft-row { padding: 12px; } .draft-row .acts .open { display: none; } }`;
