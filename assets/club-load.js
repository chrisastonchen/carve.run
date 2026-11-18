// carve.run/club/: club v2's pages, or v1's behind the flag (club-flags.js).
import { CLUB_V2 } from "/plan/club-flags.js?v=4";

if (CLUB_V2) import("/assets/club-home.js?v=950b119627");
else import("/assets/club-org.js?v=41fe8f7301");
