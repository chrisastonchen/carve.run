// The club guides' Try Club button (scripts/club/club_guides.py): signed
// in, it goes straight to Start a club; signed out, the site's sign-in
// first, then Start a club (as /car-clubs/, car-clubs.js).

import { signedIn } from "/assets/club-api.js?v=7a6f7b0d40";

const START = "/club/?start=1";

for (const a of document.querySelectorAll("a[data-club-try]")) {
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!(await signedIn()) && window.carveSignIn) window.carveSignIn({ returnTo: START });
    else location.assign(START);
  });
}
