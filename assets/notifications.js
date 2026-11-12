// carve.run/notifications/: a fallback for old links (Notifications is a
// pane over any page now; the user, 11/8). It opens the pane, and closing
// it goes back where they came from, or home. Without JavaScript the page
// says so (index.html's noscript).

import { openPane } from "/assets/notify-pane.js?v=81c0ca6e0b";

const back = () => {
  let fromHere = false;
  try { fromHere = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch {}
  if (fromHere && history.length > 1) history.back();
  else location.replace("/");
};

openPane(null, back);
