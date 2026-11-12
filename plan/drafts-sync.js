// Drafts in the planner (0089, board N6; Chris 11/11). Signed in, the route
// being planned is kept on Carve as a draft as it changes (a moment after
// the last change), until Save and get the link makes it a route and the
// draft goes. A new draft past 50 is refused: the planner then asks which
// to delete (drafts-list.js), and nothing goes without asking. Signed out,
// the one draft in this browser stays as it was. The group and drive-day
// planners have no drafts here (club drives in Draft live on Club home).
import { DRAFT_LIMIT, WORDS, draftShape, draftable } from "/assets/drafts-words.js?v=45d294d9b7";
import { DRAFT_CSS, drawDrafts, draftsMine } from "/assets/drafts-list.js?v=d3d9c70b9c";

const WAIT_MS = 1500;

/// `h` from plan.js: { rest, plan(), saved(), signedIn(), id(), setId(id), toast, el }.
/// → { changed(), saved(), startOver(), open(id) }
export function initDraftsSync(h) {
  let timer = 0;
  let pushing = null;
  let again = false;
  let full = false;

  async function push() {
    if (pushing) {
      again = true;
      return;
    }
    const plan = h.plan();
    if (!h.signedIn() || !draftable(plan, h.saved()) || h.untouched?.()) return;
    const { name, roads } = draftShape(plan);
    pushing = h.rest("/rest/v1/rpc/draft_save", { method: "POST", body: { p_id: h.id() || null, p_name: name, p_roads: roads, p_plan: plan } })
      .then((answer) => {
        if (!h.id() && answer?.id) h.setId(answer.id);
        full = false;
      })
      .catch((failure) => {
        const code = failure?.data?.message;
        if (code === "draft_cap") return askToDelete();
        // Deleted elsewhere (the Drafts page, another tab): a new one next time.
        if (code === "not_found") {
          h.setId(null);
          again = true;
        }
      })
      .finally(() => {
        pushing = null;
        if (again) {
          again = false;
          push();
        }
      });
  }

  /// Every change: kept a moment after the last one.
  function changed() {
    if (!h.signedIn() || full) return;
    clearTimeout(timer);
    timer = setTimeout(push, WAIT_MS);
  }

  /// Saved as a route: the draft goes (it's in Saved now).
  function saved() {
    clearTimeout(timer);
    const id = h.id();
    h.setId(null);
    if (id) h.rest("/rest/v1/rpc/draft_delete", { method: "POST", body: { p_id: id } }).catch(() => {});
  }

  /// A new route: the last one stays in Drafts; the next change makes another.
  function startOver() {
    clearTimeout(timer);
    full = false;
    h.setId(null);
  }

  /// A draft from the Drafts page (/plan/?draft=…): its plan, or null.
  async function open(id) {
    const d = await h.rest("/rest/v1/rpc/draft_get", { method: "POST", body: { p_id: id } }).catch(() => null);
    return d?.plan ? d : null;
  }

  /// 50 drafts already: which to delete, so this one can be kept? "Not now"
  /// keeps it in this browser only, as signed-out planning does.
  async function askToDelete() {
    full = true;
    let drafts = [];
    try {
      drafts = await draftsMine();
    } catch {
      return;
    }
    let dialog = document.getElementById("drafts-full");
    if (!dialog) {
      const style = h.el("style");
      style.textContent = DRAFT_CSS + `
#drafts-full { width: min(560px, calc(100vw - 32px)); max-height: min(720px, calc(100dvh - 32px)); padding: 26px 22px 20px; border: 0; border-radius: 22px; background: #0E1210; color: #EEF1EE; box-shadow: 0 30px 80px rgba(0,0,0,.4); font-family: Figtree, system-ui, sans-serif; }
#drafts-full::backdrop { background: rgba(10,28,19,.5); }
#drafts-full h2 { margin: 0 0 6px; font-size: 24px; }
#drafts-full p { margin: 0 0 16px; color: #C3CAC5; }
#drafts-full .draft-list { max-height: 440px; overflow: auto; }
#drafts-full .not-now { margin-top: 16px; height: 44px; padding: 0 20px; border: 0; border-radius: 999px; background: #1D2420; color: inherit; font: inherit; font-weight: 700; cursor: pointer; }
@media not all and (prefers-color-scheme: dark) { #drafts-full { background: #F7F6F2; color: #15181C; } #drafts-full p { color: #4A5058; } #drafts-full .not-now { background: #EDECE8; } }`;
      document.head.append(style);
      dialog = h.el("dialog");
      dialog.id = "drafts-full";
      dialog.setAttribute("aria-labelledby", "drafts-full-h");
      const title = h.el("h2", "", WORDS.fullTitle);
      title.id = "drafts-full-h";
      const list = h.el("ul", "draft-list");
      list.id = "drafts-full-list";
      const notNow = h.el("button", "not-now", WORDS.notNow);
      notNow.type = "button";
      notNow.addEventListener("click", () => dialog.close());
      // Focus starts on Not now, not on the list.
      notNow.autofocus = true;
      dialog.append(title, h.el("p", "", WORDS.fullSub), list, notNow);
      document.body.append(dialog);
    }
    drawDrafts(document.getElementById("drafts-full-list"), drafts.slice(0, DRAFT_LIMIT), {
      open: false,
      // One gone: this route is kept now, and the prompt goes.
      onDeleted: () => {
        full = false;
        dialog.close();
        push();
      },
    });
    if (!dialog.open) dialog.showModal();
  }

  return { changed, saved, startOver, open };
}
