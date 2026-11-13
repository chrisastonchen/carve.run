/* The site's counting and store links (docs/Attribution.md).
 *
 *  1. Every App Store link goes out with a campaign tag (?pt=…&ct=…, a ct
 *     of at most 30 characters: App Store Connect's limit), so App Store
 *     Connect (Analytics > Sources > Campaigns) shows which link brought each
 *     install, and what those installs went on to pay. The tag, first that
 *     applies:
 *       - a bare ?ct=reddit-r-motorcycles on the link the visitor arrived by
 *         (it wins over any utm tags a platform adds);
 *       - utm_source + utm_campaign: ?utm_source=reddit&utm_campaign=r-moto
 *         goes on as "reddit-r-moto";
 *       - the site that sent them, for a link with no tags: "ref-reddit",
 *         "ref-google" (the site only; browsers don't say which page);
 *       - the page's own: "site-home", "site-drive", "site-share", "site".
 *     The campaign is kept for the visit (sessionStorage, no cookie), so a
 *     visitor who lands on the home page and goes on to a drive's page is
 *     still the same campaign.
 *  2. Page views and store-button taps ("Store Tap", with the store and the
 *     ct) go to Plausible Analytics: no cookies, no visitor id kept. Every
 *     event names its page itself, so a share link's token (a route's
 *     identity) never leaves the page: share pages count as /r/. Off for Do
 *     Not Track / Global Privacy Control and anywhere but carve.run;
 *     Plausible drops crawlers. To leave your own visits out, run
 *     localStorage.plausible_ignore = "true" in the browser's console.
 *
 * App Store Connect → Analytics → Sources → Campaigns → "Generate a campaign
 * link" shows the provider token (pt). Until it is set below, store links go
 * out untagged; Plausible counts either way.
 */
(function () {
  "use strict";

  var PROVIDER_TOKEN = "129403100";
  // carve.run's own Plausible script (the site is named inside it). Its
  // automatic pageviews and link, download and form tracking are turned off
  // below: this file sends every event itself, with the page it names.
  var PLAUSIBLE_SRC = "https://plausible.io/js/pa-icVqdnmcMI9NQpYz8Uneq.js";
  var APP_STORE_PREFIX = "https://apps.apple.com/app/";
  // Android buttons go to carve.run/android/: the three steps into the Play test.
  var ANDROID_PAGE = "/android/";
  var STORE_KEY = "carve.campaign";
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

  // The page, as the site counts it: a share link's token is a route's
  // identity, so every share page counts as /r/.
  var path = location.pathname || "/";
  if (/^\/r\//.test(path) || /^\/[0-9A-Za-z]{10}$/.test(path) || /^\/[0-9a-f]{32}$/.test(path)) path = "/r/";

  var kind = path === "/" ? "home" : path === "/r/" ? "share" : /^\/drives\//.test(path) ? "drive" : /^\/plan\//.test(path) ? "plan" : "";
  var pageTag = kind ? "site-" + kind : "site";

  function clean(text, max) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max);
  }

  // A referring site's name: www.reddit.com and out.reddit.com are
  // "reddit", google.co.uk is "google"; a few short hosts by name.
  var NAMED = { "t.co": "x", "youtu.be": "youtube", "lnkd.in": "linkedin", "fb.me": "facebook", "redd.it": "reddit" };
  function siteName(host) {
    host = String(host || "").toLowerCase().replace(/:\d+$/, "");
    if (NAMED[host]) return NAMED[host];
    var labels = host.split(".");
    if (labels.length < 2) return clean(host, 20);
    var i = labels.length - 2;
    if (labels.length > 2 && labels[labels.length - 1].length === 2 && /^(co|com|org|net|ac|gov)$/.test(labels[i])) i -= 1;
    return clean(labels[i], 20);
  }

  // The campaign: this page's link, else what the visit began with.
  var params = new URLSearchParams(location.search);
  var fromLink = {
    source: clean(params.get("utm_source"), 60),
    campaign: clean(params.get("utm_campaign"), 60),
    ct: clean(params.get("ct"), 30)
  };
  var externalRef = safe(function () {
    var host = document.referrer ? new URL(document.referrer).host : "";
    // Coming back from Apple or Google sign-in isn't where the visit came from.
    if (/(^|\.)(supabase\.co|accounts\.google\.com|appleid\.apple\.com)$/.test(host)) return "";
    return host && host !== location.host ? host : "";
  }, "");

  var visit = safe(function () { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "null"); }, null) || {};
  if (fromLink.source || fromLink.campaign || fromLink.ct) {
    visit = { source: fromLink.source, campaign: fromLink.campaign, ct: fromLink.ct, ref: externalRef || visit.ref || "", landing: path };
  } else if (!visit.ref && externalRef) {
    visit.ref = externalRef;
  }
  // The page the visit began on (the counted path, so a share page is /r/),
  // kept with the campaign for the goals below.
  if (!visit.landing) visit.landing = path;
  safe(function () { sessionStorage.setItem(STORE_KEY, JSON.stringify(visit)); });

  var ct = visit.ct
    || clean([visit.source, visit.campaign].filter(Boolean).join("-"), 30)
    || (visit.ref ? clean("ref-" + siteName(visit.ref), 30) : "")
    || pageTag;

  // MARK: - Counting

  // Crawlers are left to Plausible, which drops them on its side.
  var counting = !(navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true)
    && /(^|\.)carve\.run$/.test(location.hostname);

  // The page as Plausible is told it: the counted path, and this link's utm
  // tags (how Plausible knows the visit's source and campaign). Nothing else
  // from the address: a share page's ?t= and ?d= are the route.
  var pageUrl = safe(function () {
    var url = new URL(path, location.origin);
    UTM.forEach(function (key) { var value = params.get(key); if (value) url.searchParams.set(key, value.slice(0, 100)); });
    return url.toString();
  }, location.origin + "/");

  // Plausible's queue: calls made before its script arrives are kept, and
  // run once it has read the settings. Every event goes out with pageUrl,
  // whatever sent it, so the address bar never reaches Plausible.
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  window.plausible.init = window.plausible.init || function (options) { window.plausible.o = options || {}; };
  if (counting) {
    window.plausible.init({
      autoCapturePageviews: false,
      outboundLinks: false,
      fileDownloads: false,
      formSubmissions: false,
      transformRequest: function (event) { event.u = pageUrl; return event; }
    });
    var script = document.createElement("script");
    script.async = true;
    script.src = PLAUSIBLE_SRC;
    document.head.appendChild(script);
  }

  function send(name, props) {
    if (!counting) return;
    safe(function () { window.plausible(name, { u: pageUrl, props: props }); });
  }

  // MARK: - App Store links

  function storeUrl(href) {
    var url = new URL(href, location.href);
    if (PROVIDER_TOKEN) {
      url.searchParams.set("pt", PROVIDER_TOKEN);
      url.searchParams.set("ct", ct);
    }
    return url.toString();
  }

  function isAppStore(a) { return a && a.href && a.href.indexOf(APP_STORE_PREFIX) === 0; }
  function isAndroidBeta(a) { return a && a.hostname === location.hostname && a.pathname === ANDROID_PAGE; }

  function tagLinks() {
    document.querySelectorAll('a[href^="' + APP_STORE_PREFIX + '"]').forEach(function (a) { a.href = storeUrl(a.href); });
  }

  // The App Store URL a script goes to by itself (the "open in the app,
  // else the store" fallbacks); counts as a store tap when it is used.
  window.carveStoreUrl = function (fallback) {
    window.carveTrack("Store Tap", { store: "app_store" });
    return storeUrl(fallback || APP_STORE_PREFIX + "carve-route-planner/id6808087716");
  };

  // The iPhone smart banner carries the campaign too.
  function tagBanner() {
    if (!PROVIDER_TOKEN) return;
    var meta = document.querySelector('meta[name="apple-itunes-app"]');
    if (meta && meta.content.indexOf("affiliate-data") < 0) {
      meta.content += ", affiliate-data=pt=" + PROVIDER_TOKEN + "&ct=" + ct;
    }
  }

  // A tap on a store button. Capture phase, and the link read as it is when
  // tapped, because the share page writes its store buttons in after load.
  // Counted with the visit's campaign and landing page (carveTrack; Growth,
  // 2026-11-05), like every other goal.
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a") : null;
    if (isAppStore(a)) { a.href = storeUrl(a.href); window.carveTrack("Store Tap", { store: "app_store" }); }
    else if (isAndroidBeta(a)) window.carveTrack("Store Tap", { store: "play_beta" });
    // The Android page's steps: the group, the test's opt-in, the Play listing.
    else if (a && a.getAttribute("data-beta-step")) window.carveTrack("Beta Step", { step: a.getAttribute("data-beta-step") });
  }, true);

  // For the site's own scripts: a goal counted with this visit's campaign
  // (the planner's Route Saved, QR Shown, Link Copied), and a link that
  // carries the campaign on to the phone that scans it (a QR code's
  // ?ct=…-qr), so App Store Connect can tell which campaign a computer
  // visit that ended in an install on a phone came from.
  window.carveTrack = function (name, props) {
    var all = { ct: ct, landing: String(visit.landing || path).slice(0, 100) };
    for (var key in props || {}) all[key] = props[key];
    send(name, all);
  };
  // A brand-new account, at the sign-in that made it (the site's email code,
  // or Apple and Google back through the planner): Account Created, once per
  // account in this browser. New means the account's first sign-in came
  // within half an hour of its making — both the server's clock (GoTrue's
  // created_at, last_sign_in_at), so a wrong clock here can't count a
  // returning sign-in. Only how they signed in goes with it, never who.
  var COUNTED_KEY = "carve.signup.counted";
  window.carveCountSignUp = function (user) {
    safe(function () {
      if (!user || !user.id || !user.created_at || !user.last_sign_in_at) return;
      var gap = Date.parse(user.last_sign_in_at) - Date.parse(user.created_at);
      if (!(gap >= 0 && gap < 30 * 60 * 1000)) return;
      var id = String(user.id).toLowerCase();
      var counted = JSON.parse(localStorage.getItem(COUNTED_KEY) || "[]");
      if (!Array.isArray(counted) || counted.indexOf(id) >= 0) return;
      localStorage.setItem(COUNTED_KEY, JSON.stringify(counted.concat(id).slice(-5)));
      var provider = String((user.app_metadata && user.app_metadata.provider) || "");
      window.carveTrack("Account Created", { method: /^(email|apple|google)$/.test(provider) ? provider : "other" });
    });
  };
  window.carveCampaign = ct;
  window.carveCampaignLink = function (href) {
    return safe(function () {
      var url = new URL(href, location.href);
      url.searchParams.set("ct", clean(ct, 27) + "-qr");
      return url.toString();
    }, href);
  };

  // MARK: - My Drives

  // Signed in (the planner's sign-in, kept in this browser): My Drives and
  // Sign out in the phone's bar and menu.
  function myDrivesLink() {
    var session = safe(function () { return JSON.parse(localStorage.getItem("carve.plan.session") || "null"); }, null);
    if (!session || !session.user) return;
    // The phone's bar: Sign in, once signed in, is My Drives, and the menu
    // ends with Sign out (the user, 2026-11-01).
    var sheetSignIn = document.getElementById("sheet-sign-in");
    if (sheetSignIn) sheetSignIn.remove();
    var sheet = document.getElementById("sheet");
    if (sheet && !document.getElementById("sheet-sign-out")) {
      var out = document.createElement("a");
      out.id = "sheet-sign-out";
      out.href = "/";
      out.textContent = "Sign out";
      out.addEventListener("click", function (event) {
        event.preventDefault();
        window.carveConfirmSignOut().then(function (yes) { if (yes) signOutNow(); });
      });
      var signOutNow = function () {
        safe(function () { localStorage.removeItem("carve.plan.session"); });
        // Carve ends the sign-in too, as the planner's Sign out does; a slow
        // answer doesn't hold the page up.
        var done = function () { location.reload(); };
        setTimeout(done, 3000);
        safe(function () {
          fetch("https://uvaabajzkzupecemzsug.supabase.co/auth/v1/logout", {
            method: "POST",
            headers: { apikey: "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U", Authorization: "Bearer " + session.access_token }
          }).then(done, done);
        });
      };
      // Their profile, before Sign out (the user, 2026-11-04).
      var mine = document.createElement("a");
      mine.href = "/profile/";
      mine.textContent = "Profile";
      if (/^\/profile\//.test(location.pathname)) mine.setAttribute("aria-current", "page");
      sheet.append(mine, out);
    }
  }

  // MARK: - Sign in on a phone

  // A phone signs in where it is: the menu's Sign in opens the planner's
  // choices over the page, not /plan/ (the user, 2026-11-02). Apple and
  // Google come back through /plan/, the one return address Supabase
  // allows, and the planner takes a phone on to My Drives; a code by email
  // signs in right here and goes on to My Drives too. The session is the
  // planner's (carve.plan.session), so every page sees it.
  // A local preview may point at a test backend (carve.dev.backend, as
  // plan.js and carve-session.js read it); never on carve.run.
  var DEV_BACKEND = safe(function () {
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? JSON.parse(localStorage.getItem("carve.dev.backend") || "null") : null;
  }, null);
  var SUPABASE_URL = (DEV_BACKEND && DEV_BACKEND.url) || "https://uvaabajzkzupecemzsug.supabase.co";
  var SUPABASE_KEY = (DEV_BACKEND && DEV_BACKEND.key) || "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
  var SESSION_KEY = "carve.plan.session";
  var OAUTH_STATE_KEY = "carve.plan.oauth-state";
  var APPLE_PATH = "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";
  var GOOGLE_PATHS = '<path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8C3.9 20.6 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.8 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V7H2.1C1.4 8.5 1 10.2 1 12s.4 3.5 1.1 5l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 2.1 15 1 12 1 7.7 1 3.9 3.4 2.1 7l3.7 2.8c.9-2.6 3.3-4.4 6.2-4.4z"/>';
  var SIGN_IN_CSS =
    ".cs-signin{width:min(440px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;padding:36px 22px 22px;border:0;border-radius:24px;box-sizing:border-box;background:#fff;color:#15181C;font-family:Figtree,system-ui,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.3)}" +
    ".cs-signin::backdrop{background:rgba(10,28,19,.5)}" +
    ".cs-signin [data-step]{display:flex;flex-direction:column;gap:12px;margin:0}" +
    ".cs-signin [hidden]{display:none!important}" +
    ".cs-signin h2{margin:0;padding-right:40px;font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1.1}" +
    ".cs-signin p{margin:0;font-size:16px;line-height:1.45;color:#3D434B}" +
    ".cs-signin .b{display:flex;align-items:center;justify-content:center;gap:10px;height:52px;border:0;border-radius:999px;font:inherit;font-size:17px;font-weight:700;cursor:pointer}" +
    ".cs-signin .b svg{width:20px;height:20px;flex:none}" +
    ".cs-signin .apple{background:#000;color:#fff}" +
    ".cs-signin .google{background:#fff;color:#15181C;box-shadow:inset 0 0 0 1.5px #D9D6CC}" +
    ".cs-signin .email{background:#F1EEE5;color:#15181C}" +
    ".cs-signin .go{background:#1D5B3A;color:#fff}" +
    ".cs-signin label{font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#5D636C}" +
    ".cs-signin input{height:52px;padding:0 16px;border:1.5px solid #D9D6CC;border-radius:14px;box-sizing:border-box;background:#fff;color:inherit;font:inherit;font-size:17px}" +
    ".cs-signin input.code{font-size:26px;font-weight:800;letter-spacing:.4em;text-align:center}" +
    ".cs-signin .links{display:flex;justify-content:space-between}" +
    ".cs-signin .link{padding:6px 2px;border:0;background:none;color:#1D5B3A;font:inherit;font-size:15px;font-weight:700;cursor:pointer}" +
    ".cs-signin .small{font-size:14px;text-align:center;color:#5D636C}" +
    ".cs-signin form .small{text-align:left;margin-top:-4px}" +
    ".cs-signin .intents{border:0;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}" +
    ".cs-signin .intent{display:flex;align-items:center;gap:14px;min-height:56px;padding:10px 14px;border-radius:14px;border:1.5px solid #D9D2C0;font-size:16px;font-weight:700;letter-spacing:0;text-transform:none;color:inherit;cursor:pointer}" +
    ".cs-signin .intent input{flex:none;width:22px;height:22px;margin:0;accent-color:#1D5B3A}" +
    ".cs-signin .intent:has(input:checked){border-color:#1D5B3A;box-shadow:inset 0 0 0 1px #1D5B3A}" +
    ".cs-signin .cs-vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
    ".cs-signin .x{position:absolute;right:14px;top:14px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:#F1EEE5;color:#3D434B;cursor:pointer}" +
    ".cs-signin .x svg{width:18px;height:18px}" +
    ".cs-signin [data-intents-skip]{display:block;margin:12px auto 0;font-size:16px;color:#5D636C}.cs-signin h2:focus{outline:none}" +
    ".cs-signin .go:disabled{opacity:.45;cursor:default}" +
    ".cs-signin .err{margin-top:12px;padding:12px 14px;border-radius:12px;background:#FBE9E7;color:#B0352B;font-size:15px;font-weight:600}" +
    // On a phone, sign-in and sign-up are full-screen pages, not a pop-up (the user, 2026-11-04).
    "@media (max-width:699px){.cs-signin{width:100%;max-width:none;height:100%;max-height:none;margin:0;border-radius:0;box-shadow:none;" +
    "padding:calc(env(safe-area-inset-top) + 72px) 22px calc(env(safe-area-inset-bottom) + 28px)}" +
    ".cs-signin::backdrop{background:Canvas}.cs-signin .x{top:calc(env(safe-area-inset-top) + 14px)}.cs-signin [data-intents-skip]{position:absolute;right:18px;top:calc(env(safe-area-inset-top) + 18px);margin:0;font-size:17px}.cs-signin h2{font-size:30px}}" +
    "@media (prefers-color-scheme: dark){" +
    ".cs-signin{background:#161B18;color:#EEF1EE}.cs-signin p{color:#C3CAC5}.cs-signin label,.cs-signin .small{color:#9AA39D}" +
    ".cs-signin .apple{background:#fff;color:#000}.cs-signin .google{background:#1D2420;color:#EEF1EE;box-shadow:inset 0 0 0 1.5px #2A332E}" +
    ".cs-signin .email,.cs-signin .x{background:#242C27;color:#EEF1EE}.cs-signin input{background:#1D2420;border-color:#2A332E}" +
    ".cs-signin .link{color:#6FD39A}.cs-signin [data-intents-skip]{color:#9AA39D}.cs-signin .err{background:#371715;color:#EC796F}}";
  var SIGN_IN_HTML =
    '<button type="button" class="x" data-close aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg></button>' +
    '<div data-step="choose"><h2 id="cs-signin-title">Sign in</h2>' +
    "<p>Your routes from the app and the planner, ready on every screen.</p>" +
    '<button type="button" class="b apple" data-provider="apple"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="' + APPLE_PATH + '"/></svg>Continue with Apple</button>' +
    '<button type="button" class="b google" data-provider="google"><svg viewBox="0 0 24 24" aria-hidden="true">' + GOOGLE_PATHS + "</svg>Continue with Google</button>" +
    '<button type="button" class="b email" data-to="email">Continue with email</button>' +
    '<p class="small">New to Carve? Any of these makes your free account.</p></div>' +
    '<form data-step="email" hidden><h2>Your email</h2><p>We\'ll send a 6-digit code.</p>' +
    '<label for="cs-email">Email</label><input id="cs-email" type="email" autocomplete="email" required>' +
    '<button type="submit" class="b go">Send the code</button><button type="button" class="link" data-to="choose">Back</button></form>' +
    '<form data-step="code" hidden><h2>Check your email</h2><p>We sent a 6-digit code to <strong data-code-to></strong>.</p>' +
    '<label for="cs-code">Code</label><input class="code" id="cs-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>' +
    '<button type="submit" class="b go">Continue</button>' +
    '<div class="links"><button type="button" class="link" data-resend>Send a new code</button><button type="button" class="link" data-to="email">Use another email</button></div></form>' +
    '<form data-step="intents" hidden><h2 tabindex="-1">What brings you to Carve?</h2><p>Pick any.</p>' +
    '<fieldset class="intents"><legend class="cs-vh">What brings you to Carve?</legend>' +
    '<label class="intent"><input type="checkbox" value="invited"><span>Someone invited me to a drive</span></label>' +
    '<label class="intent"><input type="checkbox" value="organize"><span>I organize drives for a club or group</span></label>' +
    '<label class="intent"><input type="checkbox" value="roads"><span>I\'m looking for new roads to drive</span></label>' +
    '<label class="intent"><input type="checkbox" value="events"><span>I\'m looking for car events near me</span></label></fieldset>' +
    '<button type="submit" class="b go" data-intents-go disabled>Continue</button><button type="button" class="link" data-intents-skip>Skip</button></form>' +
    '<form data-step="username" hidden><h2>Your name on Carve</h2><p>It\'s shown on the routes you share and the drives you join.</p>' +
    '<label for="cs-name">Name (optional)</label><input id="cs-name" autocomplete="name" maxlength="40">' +
    '<label for="cs-username">Username</label><input id="cs-username" autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" maxlength="20" required>' +
    '<p class="small">Letters, numbers and _, 3 to 20 characters.</p>' +
    '<button type="submit" class="b go">Continue</button></form>' +
    '<p class="err" role="alert" hidden></p>';

  function storageWorks() {
    return safe(function () {
      localStorage.setItem("carve.test", "1");
      localStorage.removeItem("carve.test");
      return true;
    }, false);
  }

  function auth(path, body) {
    return fetch(SUPABASE_URL + "/auth/v1/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_KEY },
      body: JSON.stringify(body)
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (response.ok) return data;
        if (response.status === 429) throw new Error("Too many tries. Wait a minute and try again.");
        if (path === "verify") throw new Error("That code didn't work. Check it, or send a new one.");
        throw new Error(data.msg || data.error_description || "Couldn't send the code. Check the address.");
      });
    });
  }

  // Sign-up's answer, kept in this browser as { id, intents } (plan.js keepIntents is the
  // same): the signed-in home orders itself by it. It's the account's, so another account
  // made here (or this one deleted and made again) is asked afresh (the user, 2026-11-04).
  var INTENTS_KEY = "carve.intents";
  function keepIntents(id, list) { safe(function () { localStorage.setItem(INTENTS_KEY, JSON.stringify({ id: String(id).toLowerCase(), intents: list })); }); }
  function storedIntents(id) {
    var kept = safe(function () { return JSON.parse(localStorage.getItem(INTENTS_KEY) || "null"); }, null);
    return kept && kept.id === String(id).toLowerCase() && Array.isArray(kept.intents) ? kept.intents : null;
  }

  // "Ray Chen" → "raychen" (plan.js usernameFrom is the same); "" without 3 letters or numbers.
  function usernameFrom(name) {
    var plain = String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return plain.length >= 3 ? plain.slice(0, 18) : "";
  }

  var signInDialog = null;
  // Where a sign-in goes on to: My Drives, or back to the page that asked
  // (window.carveSignIn, a route plan's buttons). Apple and Google come
  // back through /plan/, which reads RETURN_KEY (plan.js signInReturn).
  var RETURN_KEY = "carve.signin.return";
  var signInThen = null;
  function openSignIn(options) {
    signInThen = (options && options.returnTo) || null;
    if (!signInDialog) {
      var style = document.createElement("style");
      style.textContent = SIGN_IN_CSS;
      document.head.append(style);
      signInDialog = document.createElement("dialog");
      signInDialog.className = "cs-signin";
      signInDialog.setAttribute("aria-labelledby", "cs-signin-title");
      signInDialog.innerHTML = SIGN_IN_HTML;
      document.body.append(signInDialog);
      wireSignIn(signInDialog);
    }
    // Join free (the home page's) and Sign in open the same choices under their own name.
    signInDialog.querySelector("#cs-signin-title").textContent = options && options.join ? "Join for free" : "Sign in";
    signInDialog.step("choose");
    if (!signInDialog.open) signInDialog.showModal();
  }

  function wireSignIn(dialog) {
    var q = function (selector) { return dialog.querySelector(selector); };
    var email = "";
    var session = null;
    var error = function (message) {
      q(".err").textContent = message;
      q(".err").hidden = false;
    };
    dialog.step = function (step) {
      dialog.querySelectorAll("[data-step]").forEach(function (node) { node.hidden = node.getAttribute("data-step") !== step; });
      // The question has Skip at the top right instead of a close (the user, 2026-11-04).
      q(".x").hidden = step === "intents";
      q(".err").hidden = true;
      var field = { email: "#cs-email", code: "#cs-code", username: "#cs-name" }[step];
      if (field) setTimeout(function () { q(field).focus(); }, 30);
      // The question opens on its heading, not on its first choice (the user, 2026-11-04).
      if (step === "intents") setTimeout(function () { q('[data-step="intents"] h2').focus(); }, 30);
    };
    // Signed in, the home page is theirs (the user, 2026-11-04; was My Drives).
    // Club invitations waiting for this email join first (account_claim,
    // App Dev's contract 1a), never holding the sign-in up past 3 s.
    var signedIn = function () {
      var go = function () { location.href = signInThen || "/"; };
      if (!session || !session.access_token) return go();
      var claim = fetch(SUPABASE_URL + "/rest/v1/rpc/account_claim", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "content-type": "application/json" },
        body: "{}"
      }).catch(function () {});
      Promise.race([claim, new Promise(function (done) { setTimeout(done, 3000); })]).then(go, go);
    };
    q("[data-close]").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
    dialog.querySelectorAll("[data-to]").forEach(function (button) {
      button.addEventListener("click", function () { dialog.step(button.getAttribute("data-to")); });
    });
    dialog.querySelectorAll("[data-provider]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (!storageWorks()) return error("This browser isn't keeping data, so a sign-in wouldn't stay. Turn off private browsing and try again.");
        // The planner takes the return only in the browser that set it off,
        // within a quarter hour (plan.js readOAuthReturn).
        safe(function () { localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(Date.now())); });
        safe(function () {
          // Nowhere in particular to go back to: the home page, not the
          // planner the sign-in comes back through (the user, 2026-11-04).
          sessionStorage.setItem(RETURN_KEY, signInThen || "/");
        });
        // Google asks which account every time, rather than signing in with
        // whichever one the browser last used (the user, 2026-11-04).
        var provider = button.getAttribute("data-provider");
        location.href = SUPABASE_URL + "/auth/v1/authorize?provider=" + provider +
          (provider === "google" ? "&prompt=select_account" : "") +
          "&redirect_to=" + encodeURIComponent(location.origin + "/plan/");
      });
    });
    var sendCode = function () { return auth("otp", { email: email, create_user: true }); };
    q('[data-step="email"]').addEventListener("submit", function (event) {
      event.preventDefault();
      if (!storageWorks()) return error("This browser isn't keeping data, so a sign-in wouldn't stay. Turn off private browsing and try again.");
      email = q("#cs-email").value.trim().toLowerCase();
      sendCode().then(function () {
        q("[data-code-to]").textContent = email;
        q("#cs-code").value = "";
        dialog.step("code");
      }, function (failure) { error(failure.message); });
    });
    q("[data-resend]").addEventListener("click", function () {
      sendCode().then(function () { error("A new code is on its way."); }, function (failure) { error(failure.message); });
    });
    q('[data-step="code"]').addEventListener("submit", function (event) {
      event.preventDefault();
      auth("verify", { type: "email", email: email, token: q("#cs-code").value.trim() }).then(function (data) {
        if (!data.access_token) throw new Error("That code didn't work. Check it, or send a new one.");
        // The planner's session, as plan.js keepSession writes it.
        session = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
          user: { id: data.user && data.user.id, email: data.user && data.user.email }
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        window.carveCountSignUp(data.user);
        return fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + String(session.user.id).toLowerCase() + "&select=id", {
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
        }).then(function (response) { return response.ok ? response.json() : []; });
      }).then(function (rows) {
        if (rows && rows.length) return signedIn();
        // A new account: the one question, then its name (the user, 2026-11-04).
        dialog.step(storedIntents(session.user.id) ? "username" : "intents");
      }, function (failure) { error(failure.message); });
    });
    // What brings you to Carve? Pick any, or skip; then the name.
    var intentsForm = q('[data-step="intents"]');
    var picks = function () { return Array.prototype.map.call(intentsForm.querySelectorAll("input:checked"), function (box) { return box.value; }); };
    intentsForm.addEventListener("change", function () { q("[data-intents-go]").disabled = !picks().length; });
    intentsForm.addEventListener("submit", function (event) { event.preventDefault(); keepIntents(session.user.id, picks()); dialog.step("username"); });
    q("[data-intents-skip]").addEventListener("click", function () { keepIntents(session.user.id, []); dialog.step("username"); });
    // The answer goes on the account too, once there's a profile (profile_intents, 0053);
    // until that table is live the browser's copy is all there is.
    var saveIntents = function () {
      var list = session && storedIntents(session.user.id);
      if (!list) return;
      // Their own table (0053), not a profiles column: profiles are readable by every account.
      fetch(SUPABASE_URL + "/rest/v1/profile_intents", {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "content-type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({ id: String(session.user.id).toLowerCase(), intents: list })
      }).catch(function () {});
    };
    // The username follows the name as it's typed ("Ray Chen" → raychen) until they change it
    // themselves (the user, 2026-11-04: one field to fill in, not three).
    var suggested = "";
    q("#cs-name").addEventListener("input", function () {
      var field = q("#cs-username");
      if (field.value && field.value !== suggested) return;
      suggested = usernameFrom(q("#cs-name").value);
      field.value = suggested;
    });
    q('[data-step="username"]').addEventListener("submit", function (event) {
      event.preventDefault();
      var username = q("#cs-username").value.trim();
      var name = q("#cs-name").value.trim().slice(0, 40);
      var headers = { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "content-type": "application/json" };
      var body = { id: String(session.user.id).toLowerCase(), username: username };
      if (name) body.display_name = name;
      // A taken username is said, with a free one like it to pick; never changed
      // for them (the user, 2026-11-04: chris became chris2 unasked).
      fetch(SUPABASE_URL + "/rest/v1/profiles", {
        method: "POST",
        headers: Object.assign({ Prefer: "return=representation" }, headers),
        body: JSON.stringify(body)
      }).then(function (response) {
        if (response.ok) {
          saveIntents();
          // The home page's greeting has the name at once (home.js greet).
          safe(function () { localStorage.setItem("carve.first-name", JSON.stringify({ id: body.id, name: name.split(/\s+/)[0] || "" })); });
          return signedIn();
        }
        if (response.status !== 409) return error("Couldn't save that. Try again.");
        // Usernames are unique whatever their case: ilike without wildcards.
        var base = username.replace(/\d+$/, "").slice(0, 18) || username.slice(0, 18);
        var options = [];
        for (var n = 2; n <= 9; n++) options.push(base + n);
        var filter = options.map(function (o) { return "username.ilike." + o; }).join(",");
        return fetch(SUPABASE_URL + "/rest/v1/profiles?select=username&or=(" + filter + ")", { headers: headers })
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
          .then(function (rows) {
            var taken = (rows || []).map(function (r) { return String(r.username).toLowerCase(); });
            var free = rows ? options.filter(function (o) { return taken.indexOf(o.toLowerCase()) < 0; })[0] : null;
            error("@" + username + " is taken. Try another" + (free ? ", like @" + free : "") + ".");
            q("#cs-username").focus();
          });
      }).catch(function () { error("Couldn't save that. Check the connection and try again."); });
    });
  }

  // The phone menu's Sign in (every page but the planner's own, which has
  // its sign-in on the page already).
  function phoneSignIn() {
    if (/^\/plan\//.test(location.pathname)) return;
    var link = document.getElementById("sheet-sign-in");
    if (!link || typeof HTMLDialogElement === "undefined") return;
    link.addEventListener("click", function (event) {
      event.preventDefault();
      var sheet = document.getElementById("sheet");
      var menu = document.getElementById("menu-btn");
      if (sheet) sheet.hidden = true;
      if (menu) menu.setAttribute("aria-expanded", "false");
      openSignIn();
    });
  }

  /// Sign in over the page and come back to it: { returnTo: "/<token>?a=yes" }.
  window.carveSignIn = function (options) {
    if (typeof HTMLDialogElement === "undefined") return false;
    openSignIn(options);
    return true;
  };

  // The phone menu's first thing, under the logo: Continue in app, full
  // width (the user, 2026-11-04). An Android phone opens the app as its
  // icon does, else its early-access page; an iPhone goes to the App Store,
  // which offers Open when Carve is installed.
  var SHEET_APP_CSS = ".sheet a.sheet-app { display: flex; align-items: center; justify-content: center; height: 52px; margin: 12px 0 10px; padding: 0 20px;"
    + " border: 0; border-radius: 999px; background: #fff; color: #1D5B3A; font-size: 17px; font-weight: 800; text-decoration: none; gap: 10px; }"
    + " .sheet a.sheet-app svg { width: 20px; height: 20px; flex: none; }";
  function sheetApp() {
    var sheet = document.getElementById("sheet");
    if (!sheet || document.getElementById("sheet-app")) return;
    var style = document.createElement("style");
    style.textContent = SHEET_APP_CSS;
    document.head.append(style);
    var a = document.createElement("a");
    a.id = "sheet-app";
    a.className = "sheet-app";
    // a phone beside the words (the user, 2026-11-04)
    a.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.5 18.2h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Continue in app</span>';
    a.href = /android/i.test(navigator.userAgent || "")
      ? "intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=run.carve.app;S.browser_fallback_url="
        + encodeURIComponent("https://carve.run" + ANDROID_PAGE) + ";end"
      : storeUrl(APP_STORE_PREFIX + "carve-route-planner/id6808087716");
    sheet.prepend(a);
  }

  // MARK: - The name's menu

  // The name at the top right opens Profile and Sign out (the user,
  // 2026-11-04); site-bar.js and the planner wire Sign out, through this
  // confirmation.
  var WHO_CSS = ".who-menu a.who-profile{display:flex;align-items:center;box-sizing:border-box;width:100%;height:44px;padding:0 14px;border-radius:10px;" +
    "font-weight:700;font-size:16px;color:inherit;text-decoration:none}.who-menu a.who-profile:hover{background:#1D2420}" +
    "@media not all and (prefers-color-scheme: dark){.who-menu a.who-profile:hover{background:#F1F1EF}}" +
    ".cs-confirm{border:0;border-radius:22px;padding:24px;width:min(360px,calc(100% - 32px));box-sizing:border-box;background:#fff;color:#15181C;" +
    "font-family:Figtree,-apple-system,system-ui,sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.25)}" +
    ".cs-confirm::backdrop{background:rgba(10,14,12,.5)}.cs-confirm h2{margin:0 0 6px;font-size:22px;font-weight:800}" +
    ".cs-confirm p{margin:0 0 20px;font-size:16px;line-height:1.45;color:#5D636C}.cs-confirm .row{display:flex;gap:10px}" +
    ".cs-confirm button{flex:1;height:48px;border:0;border-radius:999px;font:inherit;font-size:16px;font-weight:700;cursor:pointer}" +
    ".cs-confirm .no{background:#F1EEE5;color:#15181C}.cs-confirm .yes{background:#B0352B;color:#fff}" +
    "@media (prefers-color-scheme: dark){.cs-confirm{background:#161B18;color:#EEF1EE}.cs-confirm p{color:#9AA39D}.cs-confirm .no{background:#232A26;color:#EEF1EE}}";
  var whoStyled = false;
  function whoStyle() {
    if (whoStyled) return;
    whoStyled = true;
    var style = document.createElement("style");
    style.textContent = WHO_CSS;
    document.head.append(style);
  }
  function whoProfile() {
    var menu = document.getElementById("who-menu");
    if (!menu || document.getElementById("who-profile")) return;
    whoStyle();
    var a = document.createElement("a");
    a.id = "who-profile";
    a.className = "who-profile";
    a.setAttribute("role", "menuitem");
    a.href = "/profile/";
    a.textContent = "Profile";
    menu.prepend(a);
  }

  /// "Sign out?" with Cancel and Sign out; resolves true to go ahead.
  window.carveConfirmSignOut = function () {
    if (typeof HTMLDialogElement === "undefined") return Promise.resolve(window.confirm("Sign out of Carve?"));
    whoStyle();
    return new Promise(function (resolve) {
      var dialog = document.createElement("dialog");
      dialog.className = "cs-confirm";
      dialog.setAttribute("aria-labelledby", "cs-confirm-title");
      dialog.innerHTML = '<h2 id="cs-confirm-title">Sign out?</h2><p>Your routes stay on your account, ready when you sign in again.</p>' +
        '<div class="row"><button type="button" class="no">Cancel</button><button type="button" class="yes">Sign out</button></div>';
      var answer = false;
      dialog.querySelector(".no").addEventListener("click", function () { dialog.close(); });
      dialog.querySelector(".yes").addEventListener("click", function () { answer = true; dialog.close(); });
      dialog.addEventListener("close", function () { dialog.remove(); resolve(answer); });
      document.body.append(dialog);
      dialog.showModal();
      dialog.querySelector(".no").focus();
    });
  };

  // The bar and the phone's menu by who's looking, signed out too (boards
  // N3–N5; Plan ▾ for everyone, Chris 11/12): site-nav.js draws them.
  function siteNav() {
    safe(function () { import("/assets/site-nav.js?v=0a78d1d489").catch(function () {}); });
  }

  function ready() { tagLinks(); tagBanner(); myDrivesLink(); siteNav(); phoneSignIn(); sheetApp(); whoProfile(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  send("pageview", { ct: ct });
})();
