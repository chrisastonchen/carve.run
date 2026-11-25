// carve.run/club/: club v2's pages, or v1's behind the flag (club-flags.js).
import { CLUB_V2 } from "/plan/club-flags.js?v=4";

if (new URLSearchParams(location.search).has("paid")) document.getElementById("cp-status").textContent = "Finishing your payment…";

if (CLUB_V2) import("/assets/club-home.js?v=60a2f76650");
else import("/assets/club-org.js?v=3f583e2a6c");
