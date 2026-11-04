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
    return host && host !== location.host ? host : "";
  }, "");

  var visit = safe(function () { return JSON.parse(sessionStorage.getItem(STORE_KEY) || "null"); }, null) || {};
  if (fromLink.source || fromLink.campaign || fromLink.ct) {
    visit = { source: fromLink.source, campaign: fromLink.campaign, ct: fromLink.ct, ref: externalRef || visit.ref || "" };
  } else if (!visit.ref && externalRef) {
    visit.ref = externalRef;
  }
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
    send("Store Tap", { store: "app_store", ct: ct });
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
  document.addEventListener("click", function (event) {
    var a = event.target && event.target.closest ? event.target.closest("a") : null;
    if (isAppStore(a)) { a.href = storeUrl(a.href); send("Store Tap", { store: "app_store", ct: ct }); }
    else if (isAndroidBeta(a)) send("Store Tap", { store: "play_beta", ct: ct });
    // The Android page's steps: the group, the test's opt-in, the Play listing.
    else if (a && a.getAttribute("data-beta-step")) send("Beta Step", { step: a.getAttribute("data-beta-step"), ct: ct });
  }, true);

  // For the site's own scripts: a goal counted with this visit's campaign
  // (the planner's Route Saved, QR Shown, Link Copied), and a link that
  // carries the campaign on to the phone that scans it (a QR code's
  // ?ct=…-qr), so App Store Connect can tell which campaign a computer
  // visit that ended in an install on a phone came from.
  window.carveTrack = function (name, props) {
    var all = { ct: ct };
    for (var key in props || {}) all[key] = props[key];
    send(name, all);
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

  // Signed in (the planner's sign-in, kept in this browser), the bar and the
  // phone's menu get My Drives after Plan a Route (the user, 2026-11-01).
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
      });
      sheet.append(out);
    }
    document.querySelectorAll(".bar nav.links, nav.sheet").forEach(function (nav) {
      if (nav.querySelector('a[href="/my-drives/"]')) return;
      var a = document.createElement("a");
      a.href = "/my-drives/";
      a.textContent = "My Drives";
      if (/^\/my-drives\//.test(location.pathname)) a.setAttribute("aria-current", "page");
      var after = nav.querySelector('a[href="/plan/"]') || nav.querySelector('a[href="/drives/"]');
      if (after) after.after(a);
      else nav.prepend(a);
    });
  }

  // MARK: - Sign in on a phone

  // A phone signs in where it is: the menu's Sign in opens the planner's
  // choices over the page, not /plan/ (the user, 2026-11-02). Apple and
  // Google come back through /plan/, the one return address Supabase
  // allows, and the planner takes a phone on to My Drives; a code by email
  // signs in right here and goes on to My Drives too. The session is the
  // planner's (carve.plan.session), so every page sees it.
  var SUPABASE_URL = "https://uvaabajzkzupecemzsug.supabase.co";
  var SUPABASE_KEY = "sb_publishable_06nXswMcxyIj4PwTOb_0pg_3_IB5r0U";
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
    ".cs-signin .x{position:absolute;right:14px;top:14px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:#F1EEE5;color:#3D434B;cursor:pointer}" +
    ".cs-signin .x svg{width:18px;height:18px}" +
    ".cs-signin .err{margin-top:12px;padding:12px 14px;border-radius:12px;background:#FBE9E7;color:#B0352B;font-size:15px;font-weight:600}" +
    "@media (prefers-color-scheme: dark){" +
    ".cs-signin{background:#161B18;color:#EEF1EE}.cs-signin p{color:#C3CAC5}.cs-signin label,.cs-signin .small{color:#9AA39D}" +
    ".cs-signin .apple{background:#fff;color:#000}.cs-signin .google{background:#1D2420;color:#EEF1EE;box-shadow:inset 0 0 0 1.5px #2A332E}" +
    ".cs-signin .email,.cs-signin .x{background:#242C27;color:#EEF1EE}.cs-signin input{background:#1D2420;border-color:#2A332E}" +
    ".cs-signin .link{color:#6FD39A}.cs-signin .err{background:#371715;color:#EC796F}}";
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
    '<form data-step="username" hidden><h2>Pick a username</h2><p>It\'s shown on the routes you share. Letters, numbers and _, 3 to 20 characters.</p>' +
    '<label for="cs-username">Username</label><input id="cs-username" autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" maxlength="20" required>' +
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
      q(".err").hidden = true;
      var field = { email: "#cs-email", code: "#cs-code", username: "#cs-username" }[step];
      if (field) setTimeout(function () { q(field).focus(); }, 30);
    };
    var signedIn = function () { location.href = signInThen || "/my-drives/"; };
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
          if (signInThen) sessionStorage.setItem(RETURN_KEY, signInThen);
          else sessionStorage.removeItem(RETURN_KEY);
        });
        location.href = SUPABASE_URL + "/auth/v1/authorize?provider=" + button.getAttribute("data-provider") +
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
        return fetch(SUPABASE_URL + "/rest/v1/profiles?id=eq." + String(session.user.id).toLowerCase() + "&select=id", {
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
        }).then(function (response) { return response.ok ? response.json() : []; });
      }).then(function (rows) {
        if (rows && rows.length) return signedIn();
        dialog.step("username");
      }, function (failure) { error(failure.message); });
    });
    q('[data-step="username"]').addEventListener("submit", function (event) {
      event.preventDefault();
      fetch(SUPABASE_URL + "/rest/v1/profiles", {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "content-type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ id: String(session.user.id).toLowerCase(), username: q("#cs-username").value.trim() })
      }).then(function (response) {
        if (response.ok) return signedIn();
        error(response.status === 409 ? "That username is taken. Try another." : "Couldn't save that. Try again.");
      }, function () { error("Couldn't save that. Check the connection and try again."); });
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

  function ready() { tagLinks(); tagBanner(); myDrivesLink(); phoneSignIn(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  send("pageview", { ct: ct });
})();
