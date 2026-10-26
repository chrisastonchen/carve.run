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
 *     Not Track / Global Privacy Control, crawlers, and anywhere but
 *     carve.run. To leave your own visits out, run
 *     localStorage.plausible_ignore = "true" in the browser's console.
 *
 * App Store Connect → Analytics → Sources → Campaigns → "Generate a campaign
 * link" shows the provider token (pt). Until it is set below, store links go
 * out untagged; Plausible counts either way.
 */
(function () {
  "use strict";

  var PROVIDER_TOKEN = "";
  var PLAUSIBLE_DOMAIN = "carve.run";
  // The manual build: pageviews are sent by this file, with the page it names.
  var PLAUSIBLE_SRC = "https://plausible.io/js/script.manual.js";
  var APP_STORE_PREFIX = "https://apps.apple.com/app/";
  var ANDROID_BETA_HOST = "groups.google.com";
  var STORE_KEY = "carve.campaign";
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

  function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }

  var ua = navigator.userAgent || "";

  // The page, as the site counts it: a share link's token is a route's
  // identity, so every share page counts as /r/.
  var path = location.pathname || "/";
  if (/^\/r\//.test(path) || /^\/[0-9A-Za-z]{10}$/.test(path) || /^\/[0-9a-f]{32}$/.test(path)) path = "/r/";

  var kind = path === "/" ? "home" : path === "/r/" ? "share" : /^\/drives\//.test(path) ? "drive" : "";
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

  var counting = !(navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true)
    && !/bot|crawl|spider|slurp|headless|preview|lighthouse|facebookexternalhit/i.test(ua)
    && /(^|\.)carve\.run$/.test(location.hostname);

  // Plausible's queue: calls made before its script arrives are kept.
  window.plausible = window.plausible || function () { (window.plausible.q = window.plausible.q || []).push(arguments); };
  if (counting) {
    var script = document.createElement("script");
    script.defer = true;
    script.src = PLAUSIBLE_SRC;
    script.setAttribute("data-domain", PLAUSIBLE_DOMAIN);
    document.head.appendChild(script);
  }

  // The page as Plausible is told it: the counted path, and this link's utm
  // tags (how Plausible knows the visit's source and campaign). Nothing else
  // from the address: a share page's ?t= and ?d= are the route.
  var pageUrl = safe(function () {
    var url = new URL(path, location.origin);
    UTM.forEach(function (key) { var value = params.get(key); if (value) url.searchParams.set(key, value.slice(0, 100)); });
    return url.toString();
  }, location.origin + "/");

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
  function isAndroidBeta(a) { return a && a.hostname === ANDROID_BETA_HOST && /\/g\/carve-beta/.test(a.pathname); }

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
  }, true);

  function ready() { tagLinks(); tagBanner(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();

  send("pageview", { ct: ct });
})();
