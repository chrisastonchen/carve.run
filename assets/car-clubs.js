// carve.run/car-clubs/: /club/'s For Clubs intro as a page for search
// (scripts/club/car_clubs.py). The numbers and the clips as on /club/
// (club-intro.js). Try Club signs in first, then Start a club; signed in, it
// goes straight there. Log in signs in, then the club's home; signed in, it
// opens /club/.

import { showIntro } from "/assets/club-intro.js?v=f52075dfb7";
import { signedIn } from "/assets/club-api.js?v=3d6e3c082a";

const START = "/club/?start=1";

const go = (returnTo) => async (e) => {
  e?.preventDefault();
  if (!(await signedIn()) && window.carveSignIn) window.carveSignIn({ returnTo });
  else location.assign(returnTo === START ? START : "/club/");
};

showIntro({ start: go(START), login: go("/club/?login=1") });
