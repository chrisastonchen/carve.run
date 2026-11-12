// The Notifications pane (Club-Sprint-Requirements.md §10; the user, 11/8:
// a pane, not a page). The bell opens it over the current page: under the
// bell on a computer, the whole screen on a phone. A dialog: focus stays
// in it, Escape or the close button or a click outside closes it, and
// focus goes back to what opened it.
//
// Inside: 0067's feed (notifications_mine), newest first, 30 at a time
// with Show earlier. Each opening reads afresh and marks what it shows as
// read (notifications_read up to the newest), and the bell goes to none.
// An invitation to a one-day drive still ahead is answered in place
// (answer_set with the item's own answer token).

import { SUPABASE_KEY, SUPABASE_URL, SESSION_KEY, accessToken } from "/assets/carve-session.js?v=a3869ea508";
import { itemWords, whenText } from "/assets/notification-words.js?v=da8884ae22";
import { PLANS } from "/assets/plans.js?v=a1e99a533b";

const PAGE = 30;
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

let pane = null;
let opener = null;
let oldest = null;
let onClosed = null;
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

class Failure extends Error {}

async function rpc(name, body = {}) {
  const token = await accessToken().catch(() => null);
  if (!token) throw new Failure("sign_in");
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Failure("Couldn't reach Carve. Check your connection and try again.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Failure(data?.message === "sign_in" || response.status === 401 ? "sign_in" : "Something went wrong. Try again.");
  return data;
}

function build() {
  if (!document.querySelector('link[data-nf-pane]')) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/assets/notify-pane.css?v=3761039697";
    css.dataset.nfPane = "";
    document.head.append(css);
  }
  pane = el("section", "nf-pane");
  pane.id = "nf-pane";
  pane.hidden = true;
  pane.tabIndex = -1;
  pane.setAttribute("role", "dialog");
  pane.setAttribute("aria-modal", "true");
  pane.setAttribute("aria-labelledby", "nf-pane-title");
  pane.innerHTML = `
    <div class="nf-head"><h2 id="nf-pane-title">Notifications</h2>
      <button type="button" class="nf-close" id="nf-close" aria-label="Close notifications">${CLOSE}</button></div>
    <div class="nf-body">
      <p class="nf-said" id="nf-said" role="status"></p>
      <div class="nf-out" id="nf-out" hidden><p>Sign in to see your invitations, your drives' updates and your clubs' news.</p>
        <a class="nf-signin" href="/plan/#sign-in">Sign in</a></div>
      <ul class="nf-list" id="nf-list" aria-labelledby="nf-pane-title" hidden></ul>
      <button type="button" class="nf-more" id="nf-more" hidden>Show earlier</button>
    </div>`;
  document.body.append(pane);
  $("nf-close").addEventListener("click", () => closePane());
  $("nf-more").addEventListener("click", more);
  pane.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePane();
    } else if (event.key === "Tab") {
      // Focus stays in the pane.
      const all = [...pane.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!all.length) return;
      const first = all[0], last = all.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === pane)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  // A click outside (not on what opened it) closes it.
  document.addEventListener("pointerdown", (event) => {
    if (!pane.hidden && !pane.contains(event.target) && !(opener && opener.contains(event.target))) closePane({ refocus: false });
  });
}

const ANSWERS = [["yes", "Going"], ["maybe", "Maybe"], ["no", "No"]];
const SAID = { yes: "You said Going.", maybe: "You said Maybe.", no: "You said No." };

function row(item) {
  const words = itemWords(item, { plans: PLANS });
  if (!words) return null;
  const li = el("li", `nf-item${item.unread ? " unread" : ""}`);
  li.dataset.id = item.id;
  const title = el("a", "nf-title");
  // Screen readers hear "New" before an unread one; the dot is for eyes.
  if (item.unread) title.append(el("span", "nf-sr", "New: "));
  title.append(words.title);
  // carve.run's own pages by path, so a preview stays on the preview.
  title.href = (item.url || "#").replace(/^https:\/\/carve\.run(?=\/)/, "");
  li.append(title);
  if (words.detail) li.append(el("span", "nf-detail", words.detail));
  li.append(el("span", "nf-when", whenText(item.at)));
  if (words.answer && item.data?.answer_token) {
    const choices = el("div", "nf-choices");
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", `Going to ${item.drive?.name || "the drive"}?`);
    const said = el("span", "nf-said-item");
    said.setAttribute("role", "status");
    for (const [answer, label] of ANSWERS) {
      const b = el("button", "", label);
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", async () => {
        for (const x of choices.querySelectorAll("button")) x.disabled = true;
        said.textContent = "Saving…";
        try {
          await rpc("answer_set", { p_token: item.data.answer_token, p_answer: answer });
          for (const x of choices.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b));
          said.textContent = `${SAID[answer]} Change it any time on the drive's page.`;
        } catch (failure) {
          said.textContent = failure.message === "sign_in" ? "Please sign in again." : "Couldn't save your answer. Try again.";
        }
        for (const x of choices.querySelectorAll("button")) x.disabled = false;
        b.focus();
      });
      choices.append(b);
    }
    li.append(choices, said);
  }
  return li;
}

function show(items, append) {
  const list = $("nf-list");
  if (!append) list.replaceChildren();
  list.append(...items.map(row).filter(Boolean));
  list.hidden = !list.children.length;
  oldest = items.at(-1)?.at || oldest;
  $("nf-more").hidden = items.length < PAGE;
  $("nf-said").textContent = list.children.length ? "" : "Nothing yet. Drive passes and news from your clubs show up here.";
  $("nf-said").hidden = !!list.children.length;
}

async function load() {
  let signedIn = false;
  try { signedIn = !!JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.refresh_token; } catch {}
  const out = () => {
    $("nf-said").hidden = true;
    $("nf-list").hidden = true;
    $("nf-more").hidden = true;
    $("nf-out").hidden = false;
  };
  if (!signedIn) return out();
  $("nf-out").hidden = true;
  $("nf-said").hidden = false;
  $("nf-said").textContent = "Loading…";
  try {
    const feed = await rpc("notifications_mine", { p_before: null, p_limit: PAGE });
    const items = feed?.items || [];
    show(items, false);
    // Read up to the newest shown; the bell (notify-bell.js) hears it and goes to none.
    if (items.some((i) => i.unread)) {
      rpc("notifications_read", { p_through: items[0].at })
        .then(() => document.dispatchEvent(new CustomEvent("carve:notifications-read")))
        .catch(() => {});
    }
  } catch (failure) {
    if (failure.message === "sign_in") return out();
    $("nf-said").textContent = failure.message;
  }
}

async function more() {
  const button = $("nf-more");
  button.disabled = true;
  try {
    const feed = await rpc("notifications_mine", { p_before: oldest, p_limit: PAGE });
    const before = $("nf-list").children.length;
    show(feed?.items || [], true);
    // Focus goes to the first of the new ones, so the list reads on.
    $("nf-list").children[before]?.querySelector(".nf-title")?.focus();
  } catch (failure) {
    $("nf-said").hidden = false;
    $("nf-said").textContent = failure.message === "sign_in" ? "Please sign in again." : failure.message;
  }
  button.disabled = false;
}

const phone = () => matchMedia("(max-width: 699px)").matches;

/// Under the bell on a computer: its right edge lined up with the bell's.
function place() {
  if (phone() || !opener) {
    pane.style.right = "";
    return;
  }
  const r = opener.getBoundingClientRect();
  pane.style.right = `${Math.max(16, Math.round(window.innerWidth - r.right - 8))}px`;
}

export const isOpen = () => !!pane && !pane.hidden;

/// Opens the pane from `from` (the bell, or the phone menu's line).
/// `closed` runs when it closes (the fallback page goes back).
export function openPane(from = null, closed = null) {
  if (!pane) build();
  opener = from;
  onClosed = closed;
  place();
  pane.hidden = false;
  pane.querySelector(".nf-body").scrollTop = 0;
  document.getElementById("notif")?.setAttribute("aria-expanded", "true");
  if (phone()) document.documentElement.classList.add("nf-locked");
  pane.focus();
  load();
}

export function closePane({ refocus = true } = {}) {
  if (!pane || pane.hidden) return;
  pane.hidden = true;
  document.documentElement.classList.remove("nf-locked");
  document.getElementById("notif")?.setAttribute("aria-expanded", "false");
  // Back to the bell (the phone's menu line is gone with its menu).
  const back = opener && opener.isConnected && opener.offsetParent !== null ? opener : document.getElementById("notif");
  if (refocus) back?.focus();
  const after = onClosed;
  onClosed = null;
  after?.();
}

addEventListener("resize", () => { if (isOpen()) place(); });
