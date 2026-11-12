// The Pre-run step (Chris, 11/9; the decisions file's Pre-run step): Club
// drives with a pre-run, between Route and Attendees. Two parts:
//   Invite: "Build the route first" until a day has a route; then the
//   pre-run's date, its link and QR (link-card.js), and Send by email
//   (32512's email-rows.js). The crew is whoever is emailed, plus whoever
//   signs in through the pre-run link; not leads and sweeps.
//   Times: the pre-run's leg times, drawn by drive-page.js in this step
//   (no notes: Mark and Note are removed, Chris 11/10 night).
// Server (App Dev's, lands 11/16–19): drive_get.prerun {date, link, crew,
// sent, reminder_on, legs_over}; drive_prerun_link_open;
// drive_crew_add; drive_crew_remove; the send is drive-send's leads with
// pre_run, which reaches the whole crew. Until then the calls refuse, and
// the step says so.
import { linkCard } from "./link-card.js";
import { emailRows } from "./email-rows.js";

const dayWords = (date) => {
  if (!date) return "";
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
};
const daysUntil = (date, now = new Date()) => {
  const [y, m, d] = String(date).split("-").map(Number);
  const then = Date.UTC(y, m - 1, d);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((then - today) / 86400000);
};

/// "in 12 days", "tomorrow", "today", "was 3 days ago".
export function countdownText(date, now = new Date()) {
  if (!date) return "";
  const n = daysUntil(date, now);
  return n > 1 ? `in ${n} days` : n === 1 ? "tomorrow" : n === 0 ? "today" : n === -1 ? "was yesterday" : `was ${-n} days ago`;
}

/// "Sent to 8 people on Mon, Nov 23. They get a reminder on Fri, Dec 4."
export function sentText(sent, reminderOn) {
  if (!sent) return "";
  const n = Number(sent.to) || 0;
  const on = sent.at ? new Date(sent.at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
  return `Sent to ${n === 1 ? "1 person" : `${n} people`}${on ? ` on ${on}` : ""}.${reminderOn ? ` They get a reminder on ${dayWords(reminderOn)}.` : ""}`;
}

/// The server's words for a refusal (App Dev, 11/9), else the failure's own.
/// The pre-run link and the crew send never put a draft drive out.
export function refusal(failure) {
  const code = failure?.data?.message || failure?.message || "";
  const details = String(failure?.data?.details || "");
  if (code === "bad_input" && /no pre-run/.test(details)) return "Set the pre-run's date on When first.";
  if (code === "bad_input" && /no days/.test(details)) return "Add a day on When first.";
  return {
    club_only: "Pre-runs are part of Club.", not_approved: "Your club is waiting for approval.",
    closed: "The pre-run is over, or the drive was cancelled.", not_organizer: "Only the club's organizers can do this.", sign_in: "Sign in first.",
  }[code] || (/function|does not exist|404|not found/i.test(code) ? "The pre-run isn't set up on the server yet." : code || "Couldn't do that. Try again.");
}

export function initPrerunStep({ $, el, api, drive, save, section, go, org, sender, page, editWhen, prerunDate }) {
  const head = el("p", "pr-head");
  const first = el("div", "pr-first");
  const invite = el("div", "pr-invite");
  const linkBox = el("div", "pr-link");
  const make = el("button", "pill grey", "Make the pre-run link");
  make.type = "button";
  const rowsBox = el("div", "pr-rows");
  const sendRow = el("div", "g-row");
  const send = el("button", "pill green", "Send the pre-run");
  send.type = "button";
  const said = el("p", "sd-said");
  said.id = "pr-said";
  said.setAttribute("role", "status");
  const sentLine = el("p", "dim small pr-sent");
  const crewH = el("h3", "eyebrow", "The crew");
  const crew = el("ul", "pr-crew");
  const notesH = el("h3", "pr-notes-h", "Times from the pre-run");
  const notesNone = el("p", "dim small", "Leg times from the crew show here after the pre-run.");
  let card = null;
  let rows = null;
  let busy = false;

  const prerun = () => drive().server?.prerun ?? null;
  const routed = () => drive().days.some((d) => d.legs.some((l) => l.plan?.path));
  const say = (text) => { said.textContent = text; };

  // The parts, once; the review's own elements come from the page.
  const review = $("pr-review");
  sendRow.append(send);
  invite.append(linkBox, el("h3", "eyebrow", "Send by email"), rowsBox, sendRow, said, sentLine, crewH, crew);
  section.append(head, first, invite, notesH, notesNone);
  if (review) section.append(review);

  async function act(fn, done = "") {
    if (busy) return;
    busy = true;
    say("");
    try {
      const got = await fn();
      if (got && typeof got === "object" && "prerun" in got) drive().server = { ...(drive().server || {}), prerun: got.prerun ?? null };
      save();
      if (done) say(done);
    } catch (failure) {
      say(refusal(failure));
    } finally {
      busy = false;
      render();
    }
  }

  make.addEventListener("click", () => act(async () => {
    const got = await api.rpc("drive_prerun_link_open", { p_drive_id: drive().id, p_rotate: false });
    drive().server = { ...(drive().server || {}), prerun: { ...(prerun() || {}), link: got } };
    return null;
  }));
  send.addEventListener("click", () => act(async () => {
    const people = rows.emails();
    if (people.length) {
      const got = await api.rpc("drive_crew_add", { p_drive_id: drive().id, p_people: people });
      if (got && "prerun" in got) drive().server = { ...(drive().server || {}), prerun: got.prerun ?? null };
      rows.clear();
    }
    // The pre-run route to the crew: drive-send's leads with pre_run (the whole crew).
    await sender.send("leads", { preRun: true, said: "pr-said" });
    return null;
  }));

  function render() {
    const d = drive();
    const pr = prerun();
    const date = pr?.date || prerunDate(d.days[0]) || null;
    head.replaceChildren();
    if (date) {
      head.append(el("b", "", `Pre-run ${dayWords(date)}`), ` · ${countdownText(date)} `);
      const change = el("button", "textlink small", "Change");
      change.type = "button";
      change.addEventListener("click", () => editWhen("prerun"));
      head.append(change);
    }
    // Part 1: the route first, then the link and the email.
    const ready = routed();
    first.hidden = ready;
    invite.hidden = !ready;
    if (!ready) {
      first.replaceChildren(el("p", "", "Build the route first. The crew drives it as it stands."));
      const b = el("button", "pill green", "Go to Route");
      b.type = "button";
      b.addEventListener("click", () => go("route"));
      first.append(b);
    } else {
      const url = pr?.link?.url ?? null;
      if (!card) {
        card = linkCard({
          el, url, label: "Pre-run link", driveName: d.name || "Group drive",
          onRotate: async () => (await api.rpc("drive_prerun_link_open", { p_drive_id: drive().id, p_rotate: true }))?.url ?? null,
          refusal,
        });
        linkBox.append(el("h3", "eyebrow", "The pre-run link"), el("p", "dim small", "Anyone who signs in through it joins the crew. It shows the route as it stands, until the pre-run day."), card);
      } else card.setUrl(url);
      if (!url && !make.isConnected) linkBox.append(make);
      if (url && make.isConnected) make.remove();
      if (!rows) {
        rows = emailRows({ el, start: 3, names: true, onChange: () => renderSend() });
        rowsBox.append(rows.el);
      }
      renderSend();
      sentLine.textContent = sentText(pr?.sent, pr?.reminder_on);
      const people = pr?.crew || [];
      crewH.hidden = !people.length;
      crew.replaceChildren(...people.map((p) => {
        const li = el("li", "pr-person");
        li.append(el("b", "", p.name || p.email), el("span", "dim small", [p.name ? p.email : "", p.via === "link" ? "Signed in with the link" : "Emailed", p.on_drive ? "On the drive" : "Pre-run only"].filter(Boolean).join(" · ")));
        const remove = el("button", "textlink small", "Remove");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${p.name || p.email} from the crew`);
        remove.addEventListener("click", () => act(() => api.rpc("drive_crew_remove", { p_drive_id: drive().id, p_attendee_ids: [p.id] })));
        li.append(remove);
        return li;
      }));
    }
    // Part 2: the review (drive-page.js draws it here).
    notesNone.hidden = (pr?.legs_over ?? 0) > 0;
    notesH.textContent = pr?.legs_over ? `Times from the pre-run · ${pr.legs_over} ${pr.legs_over === 1 ? "leg" : "legs"} ran longer than planned` : "Times from the pre-run";
    if (drive().synced?.created) page.review?.();
  }
  function renderSend() {
    const n = rows?.emails().length || 0;
    const crewN = prerun()?.crew?.length || 0;
    send.disabled = busy || (!n && !crewN);
    send.textContent = n ? `Send the pre-run to ${n === 1 ? "1 more" : `${n} more`}${crewN ? ` and the crew (${crewN})` : ""}` : crewN ? `Send the pre-run to the crew (${crewN})` : "Send the pre-run";
  }

  return {
    render,
    done: () => !!prerun()?.sent,
    summary: () => {
      const date = prerun()?.date || prerunDate(drive().days[0]);
      return date ? `${dayWords(date)}${prerun()?.sent ? " · sent" : ""}` : "";
    },
  };
}
