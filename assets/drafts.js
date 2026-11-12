// carve.run/drafts/ (board N6, Chris 11/11): the account's drafts, the
// routes being planned and not yet saved, newest first. Open goes back to
// the planner with it; Delete asks twice.
import { DRAFT_CSS, drawDrafts, draftsMine } from "/assets/drafts-list.js?v=d3d9c70b9c";
import { WORDS, countText } from "/assets/drafts-words.js?v=45d294d9b7";
import { SESSION_KEY, store } from "/assets/carve-session.js?v=a3869ea508";

const $ = (id) => document.getElementById(id);
const style = document.createElement("style");
style.textContent = DRAFT_CSS;
document.head.append(style);

function status(text) {
  $("drafts-status").textContent = text;
  $("drafts-status").hidden = !text;
}
function empty(html) {
  $("drafts-empty").innerHTML = html;
  $("drafts-empty").hidden = false;
  $("drafts-list").hidden = true;
  status("");
}
function count(n) {
  $("drafts-count").textContent = countText(n);
  $("drafts-count").hidden = false;
  if (!n) empty(`<p>${WORDS.empty}</p><a class="new" href="/plan/">Plan a drive</a>`);
}

async function main() {
  if (!store.get(SESSION_KEY)?.user) return empty(`<p>${WORDS.signedOut}</p><a class="new" href="/plan/#sign-in">Sign in</a>`);
  let drafts;
  try {
    drafts = await draftsMine();
  } catch (failure) {
    if (failure.code === "sign_in") return empty(`<p>${WORDS.signedOut}</p><a class="new" href="/plan/#sign-in">Sign in</a>`);
    return status(WORDS.failed);
  }
  status("");
  $("drafts-list").hidden = false;
  let left = drafts.length;
  drawDrafts($("drafts-list"), drafts, { onDeleted: () => count(--left) });
  count(left);
}

main();
