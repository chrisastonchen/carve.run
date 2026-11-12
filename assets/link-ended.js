// v1's emailed links under club v2 (DevOps, 11/10): carve.run/d/, /a/, /s/
// and /u/ were the attendee pages (invitations, Going?, sign-up,
// unsubscribe), which v2 cut along with the calls behind them (App Dev's
// baseline). With CLUB_V2 on, each says plainly that the link has ended.

/// The page's main content, replaced by the ended note.
export function linkEnded(main = document.querySelector("main")) {
  if (!main) return;
  document.title = "This link has ended | Carve";
  const box = document.createElement("section");
  box.className = "ended";
  box.setAttribute("aria-labelledby", "ended-h");
  const h = document.createElement("h1");
  h.id = "ended-h";
  h.textContent = "This link has ended";
  const p = document.createElement("p");
  p.textContent = "Club drives on Carve now have one link for each day's route. Ask the organizer for the drive's link.";
  const home = document.createElement("a");
  home.className = "ended-home";
  home.href = "/";
  home.textContent = "Go to Carve";
  box.append(h, p, home);
  main.replaceChildren(box);
  if (!document.getElementById("ended-css")) {
    const style = document.createElement("style");
    style.id = "ended-css";
    style.textContent = ".ended { max-width: 560px; margin: 56px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 14px; font-family: \"Figtree\", system-ui, sans-serif; }"
      + " .ended h1 { margin: 0; font-size: 30px; font-weight: 800; } .ended p { margin: 0; font-size: 17px; line-height: 1.5; }"
      + " .ended-home { align-self: flex-start; font-weight: 800; color: inherit; text-decoration: underline; text-underline-offset: 3px; }";
    document.head.append(style);
  }
}
