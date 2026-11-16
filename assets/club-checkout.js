// A club's Checkout on carve.run (Chris, 11/15): our own page in the club
// style, in a panel under the site bar with ‹ Back: the plan, the trial,
// tax once the address is in, a promo code, "Buying as a business", and our
// own Subscribe. Stripe supplies only its card, billing address and tax ID
// fields (Checkout elements: ui_mode "elements", Stripe.js dahlia's
// initCheckoutElementsSdk), styled to match. org-billing makes the session
// (ui: "elements" → client_secret, publishable_key) with the same trial, tax
// and promotion codes as Stripe's own page; 3D Secure opens over it; paid,
// Stripe sends the page back to the club page with &paid=1 and the
// session's id. No publishable key on the server, or Stripe.js or its
// fields won't load: Stripe's own page, as before.

const STRIPE_JS = "https://js.stripe.com/dahlia/stripe.js";

/// Stripe's fields in the club pages' dark look (club-v2.css's tokens).
export const APPEARANCE = {
  theme: "night",
  labels: "above",
  variables: {
    colorPrimary: "#6FD39A",
    colorBackground: "#161B18",
    colorText: "#EEF1EE",
    colorTextSecondary: "#A3ACA6",
    colorTextPlaceholder: "#79827C",
    colorDanger: "#FF8A80",
    iconColor: "#A3ACA6",
    fontFamily: "Figtree, system-ui, sans-serif",
    fontSizeBase: "16px",
    borderRadius: "12px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { backgroundColor: "#1F2622", border: "1px solid #2A332E", boxShadow: "none" },
    ".Input:focus": { borderColor: "#6FD39A", boxShadow: "0 0 0 1px #6FD39A" },
    ".Input--invalid": { borderColor: "#FF8A80" },
    ".Label": { color: "#D3D9D5", fontWeight: "600" },
    ".CheckboxInput": { backgroundColor: "#1F2622", borderColor: "#2A332E" },
    ".CheckboxInput--checked": { backgroundColor: "#6FD39A", borderColor: "#6FD39A" },
  },
};
/// Figtree in Stripe's frames (they can't see the page's own fonts).
export const FONTS = [{ cssSrc: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" }];

let loading = null;
/// Stripe.js, once per page; null when it won't load (blocked, offline).
function stripeJs() {
  loading ??= new Promise((resolve) => {
    if (window.Stripe) return resolve(window.Stripe);
    const script = document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    const done = () => { clearTimeout(timer); resolve(window.Stripe || null); };
    const timer = setTimeout(done, 15000);
    script.addEventListener("load", done);
    script.addEventListener("error", done);
    document.head.append(script);
  }).then((Stripe) => { if (!Stripe) loading = null; return Stripe; });
  return loading;
}

/// Back on the club page from Checkout: the session's id off the address
/// (?paid stays for the page to read).
export function tidyReturn() {
  const params = new URLSearchParams(location.search);
  if (!params.has("session_id")) return;
  params.delete("session_id");
  try { history.replaceState(history.state, "", `${location.pathname}?${params}${location.hash}`); } catch {}
}

/// "Dec 15, 2026" from Stripe's trial end (seconds or milliseconds).
export function dayOf(t) {
  if (!Number.isFinite(t)) return "";
  return new Date(t < 1e12 ? t * 1000 : t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/// What the summary and the button say, from Stripe's session:
/// { trial, trialDays, price, discount: {code, amount} | null, tax, due,
///   then, button }. tax: null until the address is in.
export function summaryOf(s) {
  const trial = s?.recurring?.trial || null;
  const item = s?.lineItems?.[0] || null;
  // The plan's price itself: in a trial the line's subtotal is $0.00.
  const each = item?.unitAmount?.amount || s?.recurring?.dueNext?.subtotal?.amount || item?.subtotal?.amount || "";
  const disc = s?.discountAmounts?.[0] || null;
  const taxReady = s?.tax?.status === "ready";
  const due = s?.total?.total?.amount || "";
  const next = s?.recurring?.dueNext?.total?.amount || "";
  const end = dayOf(trial?.trialEnd);
  return {
    trial: !!trial,
    trialDays: trial?.trialPeriodDays || 0,
    price: each ? `${each} / year` : "",
    discount: disc ? { code: disc.promotionCode || disc.displayName || "", amount: disc.amount } : null,
    tax: taxReady ? s?.total?.taxExclusive?.amount || "" : null,
    due,
    then: trial && next ? `Then ${next} a year${end ? ` from ${end}` : ""}.` : "",
    button: trial ? "Start free trial" : due ? `Subscribe · ${due}` : "Subscribe",
  };
}

let open = null; // the panel showing: { panel, close }

/// Checkout for a plan. ask(ui) → org-billing's checkout answer: ask("elements")
/// for this page's own, ask(null) for Stripe's page. title heads the panel;
/// terms sit under its button; from is the button pressed (focus goes back
/// to it); onBack runs when the organizer leaves without paying. Throws
/// org-billing's failure for the page to say.
export async function openCheckout({ ask, title, terms = "", from = null, onBack = () => {} }) {
  const hosted = async () => { const { url } = await ask(null); location.href = url; };
  let answer = null;
  try {
    answer = await ask("elements");
  } catch (failure) {
    if (failure?.code !== "not_configured") throw failure;
  }
  const Stripe = answer?.client_secret && answer?.publishable_key ? await stripeJs() : null;
  let checkout, actions;
  try {
    checkout = Stripe(answer.publishable_key).initCheckoutElementsSdk({ clientSecret: answer.client_secret, elementsOptions: { appearance: APPEARANCE, fonts: FONTS } });
    const loaded = await checkout.loadActions();
    if (loaded?.type !== "success") throw new Error(loaded?.error?.message || "no actions");
    actions = loaded.actions;
  } catch {
    return hosted();
  }

  open?.close(false);
  const panel = build(title, terms);
  const $ = (q) => panel.querySelector(q);
  // The page under it out of reach; the site bar stays.
  const others = [...document.querySelectorAll("body > main, body > footer")];
  const before = document.documentElement.style.overflow;
  // The page stays where it was under the panel: overflow: hidden stops a
  // wheel, not a focus deep in Stripe's fields scrolling the page itself,
  // which took the site bar away (QA, 11/15, the AU tax ID form).
  // Held at the top, so the site bar shows over it, however far down the
  // page was (QA, 11/15: a club page opened scrolled lost the bar); back
  // where it was once the panel goes.
  const was = { x: scrollX, y: scrollY };
  // The browser's own scroll restore off while it's open (QA, 11/15): going
  // back to this entry it would glide the page to where it was saved, the
  // top, after we put it back.
  const restoration = history.scrollRestoration;
  const held = { x: 0, y: 0 };
  // Instant: the site's html { scroll-behavior: smooth } would glide, and
  // a glide under overflow: hidden stops short.
  const jump = (p) => scrollTo({ left: p.x, top: p.y, behavior: "instant" });
  const hold = () => { if (scrollX !== held.x || scrollY !== held.y) jump(held); };
  let pushed = false;
  let leaving = false;
  const close = (back = true) => {
    if (open?.panel !== panel) return;
    open = null;
    removeEventListener("popstate", popped);
    removeEventListener("scroll", hold);
    for (const el of [wallets, card, address, taxId, contact]) try { el?.destroy(); } catch {}
    panel.remove();
    for (const n of others) n.inert = false;
    document.documentElement.style.overflow = before;
    document.documentElement.classList.remove("cx-open");
    jump(was);
    // Once this traversal is done, the page's own setting again.
    requestAnimationFrame(() => requestAnimationFrame(() => { try { history.scrollRestoration = restoration; } catch {} }));
    if (back) {
      onBack();
      from?.focus?.({ preventScroll: true });
    }
  };
  const popped = () => close();
  open = { panel, close };
  for (const n of others) n.inert = true;
  document.documentElement.style.overflow = "hidden";
  jump(held);
  // The site bar pinned while it's open, whatever the page's scroll (a tap
  // while the page still glides carries the glide on under the panel).
  document.documentElement.classList.add("cx-open");
  document.body.append(panel);
  // The browser's Back, a phone's swipe back too, closes it.
  try { history.scrollRestoration = "manual"; } catch {}
  try { history.pushState({ checkout: true }, ""); pushed = true; } catch {}
  addEventListener("popstate", popped);
  addEventListener("scroll", hold, { passive: true });
  const leave = () => (pushed && history.state?.checkout ? history.back() : close());
  $(".cx-back").addEventListener("click", leave);
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); leave(); } });
  $(".cx-back").focus({ preventScroll: true });

  // Any of Stripe's fields failing to load: Stripe's own page.
  const failed = () => {
    if (leaving) return;
    leaving = true;
    close(false);
    hosted().catch(() => {});
  };
  let session = actions.getSession();
  // Card in the card field only: Apple Pay and Google Pay are their own
  // buttons above it (Chris, 11/15); Link (its "Save my information" and
  // "Bank · $5 back") is a wallet the Payment Element shows over card
  // unless told never, and stays off.
  const card = checkout.createPaymentElement({ wallets: { applePay: "never", googlePay: "never", link: "never" } });
  // Apple Pay and Google Pay (Chris, 11/15), riding on the session's card
  // payment method: Stripe's buttons above the card, "or pay by card" under
  // them, both only where the phone or browser has one. No Link, Amazon
  // Pay, PayPal or Klarna. Not loading is no wallets, never Stripe's page.
  const wallets = checkout.createExpressCheckoutElement?.({
    paymentMethods: { applePay: "auto", googlePay: "auto", link: "never", amazonPay: "never", paypal: "never", klarna: "never" },
    buttonTheme: { applePay: "white", googlePay: "white" },
    buttonHeight: 48,
    layout: { maxColumns: 2, overflow: "never" },
  }) || null;
  if (wallets) {
    wallets.on?.("ready", (e) => { $(".cx-wallets").hidden = !Object.values(e?.availablePaymentMethods || {}).some(Boolean); });
    wallets.on?.("loaderror", () => { $(".cx-wallets").hidden = true; });
    wallets.on?.("confirm", async (e) => {
      $(".cx-said").textContent = "";
      const r = await actions.confirm({ expressCheckoutConfirmEvent: e }).catch((error) => ({ type: "error", error }));
      if (r?.type === "error") $(".cx-said").textContent = r.error?.message || "That didn't go through. Try again or pay by card.";
    });
    wallets.mount($(".cx-wallet-el"));
  }
  const address = checkout.createBillingAddressElement();
  const contact = session?.email ? null : checkout.createContactDetailsElement?.() || null;
  let taxId = null;
  for (const el of [card, address, contact]) el?.on?.("loaderror", failed);
  card.mount($(".cx-card-el"));
  address.mount($(".cx-addr-el"));
  if (contact) { $(".cx-contact").hidden = false; contact.mount($(".cx-contact-el")); }

  let busy = false;
  const paint = (s) => {
    session = s || session;
    const v = summaryOf(session);
    $(".cx-chip").hidden = !v.trial;
    $(".cx-chip").textContent = v.trialDays ? `First ${v.trialDays} days free` : "Free trial";
    $(".cx-price").textContent = v.price;
    $(".cx-disc").hidden = !v.discount;
    if (v.discount) {
      $(".cx-disc-name").textContent = `Promo ${v.discount.code}`.trim();
      $(".cx-disc-amt").textContent = `−${v.discount.amount}`;
    }
    $(".cx-tax").textContent = v.tax ?? "Added with your address";
    $(".cx-tax").classList.toggle("num", v.tax !== null);
    $(".cx-due").textContent = v.due;
    $(".cx-then").textContent = v.then;
    $(".cx-then").hidden = !v.then;
    $(".cx-go").textContent = v.button;
    $(".cx-go").disabled = busy || !session?.canConfirm;
    // Applied: the code and Remove in place of the field.
    $(".cx-promo-form").hidden = !!v.discount;
    $(".cx-promo-on").hidden = !v.discount;
    if (v.discount) $(".cx-promo-code").textContent = v.discount.code;
  };
  checkout.on("change", paint);
  paint(session);

  // A promo code, applied through the session.
  const promoSaid = (t, bad = false) => { $(".cx-promo-said").textContent = t; $(".cx-promo-said").classList.toggle("err", bad); };
  $(".cx-promo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $(".cx-promo-in").value.trim();
    if (!code) return promoSaid("Type a code first.", true);
    $(".cx-promo-go").disabled = true;
    const r = await actions.applyPromotionCode(code).catch((error) => ({ type: "error", error }));
    $(".cx-promo-go").disabled = false;
    if (r?.type === "error") return promoSaid(r.error?.message || "That code doesn't work.", true);
    $(".cx-promo-in").value = "";
    promoSaid("Code applied.");
    paint(r?.session || actions.getSession());
  });
  $(".cx-promo-off").addEventListener("click", async () => {
    const r = await actions.removePromotionCode().catch((error) => ({ type: "error", error }));
    if (r?.type === "error") return promoSaid(r.error?.message || "Couldn't remove the code.", true);
    promoSaid("");
    paint(r?.session || actions.getSession());
  });

  // Buying as a business: Stripe's tax ID field (the type follows the country).
  $(".cx-biz-in").addEventListener("change", async () => {
    const on = $(".cx-biz-in").checked;
    $(".cx-biz-more").hidden = !on;
    if (on && !taxId) {
      taxId = checkout.createTaxIdElement({ fields: { businessName: "always" } });
      taxId.on?.("loaderror", () => { $(".cx-biz-note").textContent = "The business fields didn't load. You can still subscribe."; });
      taxId.mount($(".cx-tax-el"));
    } else if (!on && taxId) {
      try { taxId.destroy(); } catch {}
      taxId = null;
      await actions.updateTaxIdInfo?.().catch(() => {});
    }
  });

  // Subscribe: Stripe confirms (3D Secure over the page), then sends the
  // page back to the club page; an error stays here, said under the button.
  $(".cx-pay").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    paint();
    $(".cx-said").textContent = "";
    const r = await actions.confirm().catch((error) => ({ type: "error", error }));
    busy = false;
    if (r?.type === "error") $(".cx-said").textContent = r.error?.message || "That didn't go through. Check the card and try again.";
    paint(actions.getSession());
  });
}

function build(title, terms) {
  const panel = document.createElement("div");
  panel.className = "cx cx-own";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "cx-h");
  panel.innerHTML = `
    <div class="cx-head">
      <button type="button" class="cx-back"><span aria-hidden="true">‹</span> Back</button>
      <div class="cx-words"><h2 id="cx-h"></h2></div>
    </div>
    <div class="cx-body">
      <section class="cx-box cx-sum" aria-label="Your plan">
        <p class="cx-plan"><b>Carve Club</b><span class="cx-chip" hidden></span></p>
        <dl class="cx-rows">
          <div><dt>Club</dt><dd class="cx-price num"></dd></div>
          <div class="cx-disc" hidden><dt class="cx-disc-name"></dt><dd class="cx-disc-amt num"></dd></div>
          <div><dt>Tax</dt><dd class="cx-tax"></dd></div>
          <div class="cx-total"><dt>Due today</dt><dd class="cx-due num"></dd></div>
        </dl>
        <p class="cx-then" hidden></p>
        <form class="cx-promo-form" novalidate>
          <label for="cx-promo-in">Promo code</label>
          <div class="cx-promo-row"><input id="cx-promo-in" class="cx-promo-in" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false"><button type="submit" class="cx-promo-go go ghost">Apply</button></div>
        </form>
        <p class="cx-promo-on" hidden><span class="cx-promo-code"></span> applied · <button type="button" class="cx-promo-off textlink">Remove</button></p>
        <p class="cx-promo-said" role="status" aria-live="polite"></p>
      </section>
      <form class="cx-box cx-pay" novalidate>
        <div class="cx-wallets" hidden><div class="cx-wallet-el"></div><p class="cx-or"><span>or pay by card</span></p></div>
        <div class="cx-contact" hidden><h3>Email</h3><div class="cx-contact-el"></div></div>
        <h3>Card</h3>
        <div class="cx-card-el"></div>
        <h3>Billing address</h3>
        <div class="cx-addr-el"></div>
        <label class="cx-biz"><input type="checkbox" class="cx-biz-in"> Buying as a business</label>
        <div class="cx-biz-more" hidden>
          <p class="cx-biz-note">Your business name, and its tax ID where your country has one.</p>
          <div class="cx-tax-el"></div>
        </div>
        <button type="submit" class="go cx-go" disabled>Start free trial</button>
        <p class="cx-said" role="alert"></p>
        <p class="cx-terms"></p>
      </form>
    </div>`;
  panel.querySelector("#cx-h").textContent = title;
  panel.querySelector(".cx-terms").textContent = terms;
  panel.querySelector(".cx-terms").hidden = !terms;
  return panel;
}
