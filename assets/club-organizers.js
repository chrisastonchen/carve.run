// A club's organizers (club v2): Club home's box and Club settings' list.
// "Organizers · 2 of 5", + Add an organizer (one email; joined at once
// with a Carve account, else when they sign in), and on settings Remove
// (twice, never the owner). The limit is the server's (organizer_cap),
// else the plan's. A new address gets the invite email (org-invite-send).

import { $, el, inviteSend, rpc } from "/assets/club-api.js?v=2060100765";
import { BY_TIER } from "/assets/plans.js?v=a1e99a533b";


/// `p` is the box's id prefix: <p>-list, <p>-h, <p>-add, <p>-full,
/// <p>-form, <p>-email, <p>-go, <p>-said. `org` gives the club now (Club
/// home can switch clubs); the box wires its buttons once.
/// What the page says after the invite email (DevOps' contract, 11/11): a
/// limit is said quietly; not_invited (the address wasn't saved) is an
/// error; anything else, the address is added and joins on sign-in.
export function inviteWords(email, failure = null) {
  if (!failure) return `Invite sent to ${email}.`;
  if (failure.code === "sent_recently") return "Invite sent recently.";
  if (failure.code === "too_many") return "Daily invite limit reached.";
  if (failure.code === "not_invited") return `${email} wasn't added. Try again.`;
  return "Added. They join when they sign in to Carve with that email.";
}

export function organizersBox(p, org, { removable = false } = {}) {
  let data = null;
  let removing = null;
  const say = (t) => { $(`${p}-said`).textContent = t; };

  async function load() {
    try {
      data = await rpc("org_members", { p_org_id: org().id });
    } catch (failure) {
      return say(failure.message);
    }
    render();
  }

  function render() {
    const list = data?.members || [];
    // org_members' count first: it's fresh after every add or remove; the
    // org's (orgs_mine, loaded once) went stale (QA, 11/11).
    const cap = data?.organizer_cap || org().organizer_cap || { limit: BY_TIER[org().tier]?.organizers ?? null, used: list.length };
    $(`${p}-h`).textContent = cap.limit == null ? "Organizers" : `Organizers · ${cap.used} of ${cap.limit}`;
    $(`${p}-list`).replaceChildren(...list.map((m) => {
      const li = el("li");
      const who = el("span", "cv-who", m.email);
      li.append(who);
      if (m.owner) li.append(el("small", "", "Owner"));
      else if (!m.joined) li.append(el("small", "", "Invited"));
      if (removable && !m.owner) {
        const b = el("button", "textlink cv-remove", removing === m.email ? "Remove for good" : "Remove");
        b.type = "button";
        b.setAttribute("aria-label", `${removing === m.email ? "Confirm: remove" : "Remove"} ${m.email}`);
        b.addEventListener("click", () => {
          if (removing !== m.email) { removing = m.email; return render(); }
          removing = null;
          change(() => rpc("org_member_remove", { p_org_id: org().id, p_email: m.email }), `${m.email} removed. They can't plan the club's drives now.`);
        });
        li.append(b);
      }
      return li;
    }));
    // Past the limit (after a smaller plan): they stay, no one new (Product, 11/9).
    const full = cap.limit != null && cap.used >= cap.limit;
    $(`${p}-add`).hidden = full;
    $(`${p}-full`).hidden = !full;
    $(`${p}-full`).textContent = cap.used > cap.limit
      ? `Your plan has room for ${cap.limit} organizers. Everyone here stays, but no one new can be added.`
      : `Club has room for ${cap.limit} organizers.`;
  }

  async function change(work, done) {
    say("");
    try {
      const next = await work();
      if (next?.members) data = next; else await load();
      render();
      say(typeof done === "function" ? done() : done);
    } catch (failure) {
      say(failure.message);
    }
  }

  $(`${p}-add`).addEventListener("click", () => { $(`${p}-form`).hidden = false; $(`${p}-email`).focus(); });
  $(`${p}-form`).addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $(`${p}-email`).value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return say("Add their email address.");
    $(`${p}-go`).disabled = true;
    let added = false;
    await change(async () => {
      const next = await rpc("org_member_invite", { p_org_id: org().id, p_emails: [email], p_role: "organizer" });
      added = next?.added > 0;
      $(`${p}-email`).value = "";
      $(`${p}-form`).hidden = true;
      return next;
    }, () => (data?.members?.some((m) => m.email === email && m.joined) ? `${email} is an organizer now.` : `${email} invited. They join when they sign in to Carve with that email.`));
    // Once per new address: the email, then what happened to it.
    if (added) {
      let failure = null;
      try {
        await inviteSend({ org_id: org().id, email });
      } catch (error) {
        failure = error;
      }
      say(inviteWords(email, failure));
    }
    $(`${p}-go`).disabled = false;
  });

  return { load };
}
