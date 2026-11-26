// Delete drive, asked twice (Chris, 11/25 night: he couldn't find it, and
// it can't be undone): the drive page's More ▾ and Club home's ⋯ on a drive.
// drive_delete removes the drive with its days, the routes set on them,
// drivers' sign-ins, its notes and recorded times; the routes themselves
// and their links stay, so a driver's link still opens the route, but not
// the drive: no meet times, no change alerts, and no free Carve Apex (that
// comes from the drive's dates).
import { el, rpc } from "/assets/club-api.js?v=3d6e3c082a";

/// The second step's words, by the drive's name.
export function deleteWords(name) {
  const what = name ? name : "this drive";
  return {
    first: { h: "Delete this drive?", p: "It comes off your club's drives, and you can't get it back.", go: "Delete drive" },
    second: {
      h: `Delete ${what} for everyone?`,
      p: "Its days, sign-ins and notes go for every organizer and driver. Drivers' links still open the routes, but not the drive: no meet times, no change alerts, no free Carve Apex.",
      go: "Yes, delete it",
    },
  };
}

/// The words for taking a day's route off it (Chris, 11/25 night: Route ▾
/// Remove from this day). The route stays theirs; the day's link (the old
/// one follows the day, 0091) opens it with no route until another's set.
export function removeWords(n, several) {
  return {
    h: several ? `Take this route off Day ${n}?` : "Take this route off the drive?",
    p: `It stays in your routes. Drivers' link opens the ${several ? "day" : "drive"} with no route until you add one.`,
    go: "Remove",
  };
}

/// Asks, then asks again, then deletes. Resolves true once it's gone,
/// false if they kept it.
export function confirmDelete(drive) {
  const words = deleteWords(drive.name);
  return ask([words.first, words.second], () => rpc("drive_delete", { p_drive_id: drive.id }), { busy: "Deleting…", failed: "Couldn't delete it. Try again." });
}

/// Asks once, then takes the route off the day: `remove` does it.
/// Resolves true once it's off, false if they kept it.
export function confirmRemove(n, several, remove) {
  return ask([removeWords(n, several)], remove, { busy: "Removing…", failed: "Couldn't take it off. Try again.", cls: "cd-remove-dlg" });
}

/// A dialog asking each of `steps` ({ h, p, go }) in turn, Keep it at any;
/// past the last, `act()`. Resolves true once it's done, false if kept.
function ask(steps, act, { busy, failed, cls = "" }) {
  const dlg = el("dialog", `cd-dlg cd-del-dlg ${cls}`.trim());
  dlg.setAttribute("aria-labelledby", "cd-del-h");
  // The dialog itself takes the focus, not a button: Keep it showed a focus
  // ring as it opened (Chris, 11/25 night). Tab still reaches both buttons.
  dlg.tabIndex = -1;
  const h = el("h2", "", steps[0].h);
  h.id = "cd-del-h";
  const p = el("p", "", steps[0].p);
  const said = el("p", "cd-del-said");
  said.setAttribute("role", "status");
  const go = el("button", "go danger", steps[0].go);
  go.type = "button";
  const keep = el("button", "textlink", "Keep it");
  keep.type = "button";
  const row = el("div", "cd-del-row");
  row.append(go, keep);
  dlg.append(h, p, row, said);
  // Inside the page's main, so the club pages' buttons and colours apply.
  (document.querySelector("main") || document.body).append(dlg);
  let step = 0;
  return new Promise((resolve) => {
    const done = (gone) => { dlg.close(); dlg.remove(); resolve(gone); };
    keep.addEventListener("click", () => done(false));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    go.addEventListener("click", async () => {
      if (step < steps.length - 1) {
        step++;
        dlg.classList.add("second");
        h.textContent = steps[step].h;
        p.textContent = steps[step].p;
        go.textContent = steps[step].go;
        dlg.focus();
        return;
      }
      go.disabled = true;
      said.textContent = busy;
      try {
        await act();
        done(true);
      } catch (failure) {
        go.disabled = false;
        said.textContent = failure.message || failed;
      }
    });
    dlg.showModal();
    dlg.focus();
  });
}
