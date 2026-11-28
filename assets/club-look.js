// A club's look on its pages (Chris via Product, 11/25-26): the header and
// the buttons, links and calendar month in the club's color; a club on
// Carve green, or with none, keeps today's header. Plan, Explore and Saved
// never load this.
import { DEFAULT_COVER, lookColors, lookSrc } from "/assets/club-words.js?v=b2e82d803a";

/// Paints the page in `org`'s color (or takes it off, with none).
export function applyLook(org) {
  const look = lookColors(org?.color);
  const root = document.documentElement;
  root.classList.toggle("club-look", !look.carve);
  root.classList.toggle("club-light", !look.carve && look.light);
  for (const [name, value] of [["--club", look.club], ["--club-ink", look.ink], ["--club-text", look.text]]) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  return look;
}

/// The club's logo, or its first letter on the club's color.
export function logoInto(box, org) {
  box.replaceChildren();
  const url = org?.logo_url;
  if (url) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = lookSrc(url);
    img.addEventListener("error", () => logoInto(box, { ...org, logo_url: null }), { once: true });
    box.append(img);
    box.classList.remove("letter");
  } else {
    box.textContent = (org?.name || "C").trim().charAt(0).toUpperCase() || "C";
    box.classList.add("letter");
  }
}

/// The club's cover (Carve's coast when it has none).
export const coverOf = (org) => lookSrc(org?.cover_url || DEFAULT_COVER);
