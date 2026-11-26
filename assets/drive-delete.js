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

/// Asks, then asks again, then deletes. Resolves true once it's gone,
/// false if they kept it.
export function confirmDelete(drive) {
  const words = deleteWords(drive.name);
  const dlg = el("dialog", "cd-dlg cd-del-dlg");
  dlg.setAttribute("aria-labelledby", "cd-del-h");
  const h = el("h2", "", words.first.h);
  h.id = "cd-del-h";
  const p = el("p", "", words.first.p);
  const said = el("p", "cd-del-said");
  said.setAttribute("role", "status");
  const go = el("button", "go danger", words.first.go);
  go.type = "button";
  const keep = el("button", "textlink", "Keep it");
  keep.type = "button";
  const row = el("div", "cd-del-row");
  row.append(go, keep);
  dlg.append(h, p, row, said);
  // Inside the page's main, so the club pages' buttons and colours apply.
  (document.querySelector("main") || document.body).append(dlg);
  let step = 1;
  return new Promise((resolve) => {
    const done = (gone) => { dlg.close(); dlg.remove(); resolve(gone); };
    keep.addEventListener("click", () => done(false));
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    go.addEventListener("click", async () => {
      if (step === 1) {
        step = 2;
        dlg.classList.add("second");
        h.textContent = words.second.h;
        p.textContent = words.second.p;
        go.textContent = words.second.go;
        keep.focus();
        return;
      }
      go.disabled = true;
      said.textContent = "Deleting…";
      try {
        await rpc("drive_delete", { p_drive_id: drive.id });
        done(true);
      } catch (failure) {
        go.disabled = false;
        said.textContent = failure.message || "Couldn't delete it. Try again.";
      }
    });
    dlg.showModal();
    keep.focus();
  });
}
