// A club's look, chosen (Chris via Product, 11/25-26; mock v13): the logo,
// the cover and the color, the same choices at Start a club (steps 2-4)
// and in Customize. `look` is { logo_url, cover_url, color } as stored (null
// for none: the first letter, Carve's coast, Carve green); `extra` the
// list's suggestions ({ logo_url, color }) and, in Customize, the club's
// own route photos. Uploads go through screen-photo (photo-upload.js).
import { el, sessionUserId } from "/assets/club-api.js?v=ab5108fda2";
import { CARVE_GREEN, DEFAULT_COVER, STOCK_COVERS, SWATCHES, clubTitle, lookColors, lookSrc } from "/assets/club-words.js?v=b2e82d803a";
import { logoInto } from "/assets/club-look.js?v=5a0ad6b0e5";
import { uploadPhoto } from "/assets/photo-upload.js?v=c7b700d355";

/// A file asked for, uploaded and checked: → its URL, or null when they
/// changed their mind. `say` shows progress and failures.
export function picker(input, say) {
  return () => new Promise((resolve) => {
    input.value = "";
    input.onchange = async () => {
      const f = input.files[0];
      if (!f) return resolve(null);
      say("Checking the photo…");
      try {
        const up = await uploadPhoto(f, sessionUserId());
        say("");
        resolve(up.url);
      } catch (failure) {
        say(failure.message || "Couldn't add the photo. Try again.");
        resolve(null);
      }
    };
    input.click();
  });
}

function tile(cls, on, label, onClick) {
  const b = el("button", `${cls}${on ? " on" : ""}`);
  b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", label);
  b.addEventListener("click", onClick);
  return b;
}

/// Logo: the list's (picked for you when the club is on the list), an
/// upload, or none (the first letter).
export function drawLogo(box, look, { name, listLogo, uploaded, pick, change }) {
  const opts = [];
  const choose = (url) => { look.logo_url = url; change(); };
  if (listLogo) {
    const t = tile("lk-opt", look.logo_url === listLogo, "From Carve's club list", () => choose(listLogo));
    const img = el("img", "lk-lg");
    img.alt = "";
    img.src = lookSrc(listLogo);
    t.append(img, el("span", "", "From Carve's club list"));
    opts.push(t);
  } else {
    const t = tile("lk-opt", !look.logo_url, "Your club's first letter", () => choose(null));
    const letter = el("span", "lk-lg lk-letter");
    logoInto(letter, { name, color: look.color });
    t.append(letter, el("span", "", "First letter"));
    opts.push(t);
  }
  if (uploaded) {
    const t = tile("lk-opt", look.logo_url === uploaded, "Your upload", () => choose(uploaded));
    const img = el("img", "lk-lg");
    img.alt = "";
    img.src = lookSrc(uploaded);
    t.append(img, el("span", "", "Your upload"));
    opts.push(t);
  }
  const up = tile("lk-opt", false, "Upload your own", async () => {
    const url = await pick();
    if (url) { look.uploadedLogo = url; choose(url); }
  });
  const plus = el("span", "lk-lg lk-up", "+");
  up.append(plus, el("span", "", "Upload your own"), el("small", "", "PNG or JPG, square"));
  opts.push(up);
  box.replaceChildren(...opts);
}

/// Cover: an upload, the club's own route photos (Customize), or Carve's
/// stock (coast, the default; desert; forest).
export function drawCover(box, look, { routePhotos = [], uploaded, pick, change }) {
  const current = look.cover_url || DEFAULT_COVER;
  const choose = (url) => { look.cover_url = url; change(); };
  const up = tile("lk-cov lk-cov-up", false, "Upload a cover", async () => {
    const url = await pick();
    if (url) { look.uploadedCover = url; choose(url); }
  });
  up.append(el("b", "", "+ Upload"), el("small", "", "Wide photos work best"));
  const photos = [...new Set([uploaded, ...routePhotos].filter(Boolean))].map((url) => ({ url, name: url === uploaded ? "Your upload" : "" }));
  const items = [...photos, ...STOCK_COVERS].map(({ url, name }) => {
    const t = tile("lk-cov", current === url, name || "A photo from your routes", () => choose(url));
    t.style.backgroundImage = `url("${lookSrc(url).replace(/"/g, "%22")}")`;
    if (name) t.append(el("span", "", name));
    return t;
  });
  box.replaceChildren(up, ...items);
}

/// Color: the list's first, then Carve green and four more, or any hex.
export function drawColor(box, look, { listColor, change }) {
  const colors = [...new Set([listColor, ...SWATCHES].filter(Boolean).map((c) => c.toUpperCase()))];
  const current = (look.color || CARVE_GREEN).toUpperCase();
  const row = el("div", "lk-sws");
  for (const c of colors) {
    const t = tile("lk-sw", current === c, c === CARVE_GREEN ? "Carve green" : c === listColor?.toUpperCase() ? `Your club's color (${c})` : c, () => { look.color = c; change(); });
    t.style.background = c;
    row.append(t);
  }
  const hex = el("label", `lk-hex${colors.includes(current) ? "" : " on"}`);
  const input = el("input");
  input.type = "text";
  input.maxLength = 7;
  input.placeholder = "#RRGGBB";
  input.setAttribute("aria-label", "Any color, as #RRGGBB");
  input.value = colors.includes(current) ? "" : current;
  input.addEventListener("change", () => {
    const v = input.value.trim().replace(/^([0-9a-f]{6})$/i, "#$1");
    if (/^#[0-9a-f]{6}$/i.test(v)) { look.color = v.toUpperCase(); change(); } else input.setCustomValidity("Six hex digits, like #B3162B");
  });
  input.addEventListener("input", () => input.setCustomValidity(""));
  hex.append(el("span", "", "Hex"), input);
  row.append(hex);
  box.replaceChildren(row, el("p", "lk-swl", listColor ? "First: your club's color from Carve's list. Then Carve green and four more." : "Carve green, four more, or any color as hex."));
}

/// The preview (step 4): the cover, the logo and the name, the button in the color.
export function drawPreview(box, look, org) {
  const t = clubTitle(org);
  const colors = lookColors(look.color);
  box.style.backgroundImage = `url("${lookSrc(look.cover_url || DEFAULT_COVER).replace(/"/g, "%22")}")`;
  const logo = el("span", "cl-logo lk-pv-logo");
  logoInto(logo, { ...org, logo_url: look.logo_url, color: look.color });
  const words = el("div", "lk-pv-words");
  if (t.kicker) words.append(el("span", "cl-kick", t.kicker));
  words.append(el("b", "lk-pv-name", t.name));
  const btn = el("span", "lk-pv-btn", "+ Plan a drive");
  btn.style.background = colors.club || CARVE_GREEN;
  btn.style.color = colors.club ? colors.ink : "#0E1210";
  const inner = el("div", "lk-pv-in");
  inner.append(logo, words);
  box.replaceChildren(inner, btn);
}
