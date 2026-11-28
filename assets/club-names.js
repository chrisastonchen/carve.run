// Start a club's name suggestions (Chris via Product, 11/13): as the
// organizer types, names from the club directory (0045's clubs and their
// regions), clubs and regions matched together, so "PCA Golden" or
// "Golden Gate" offers "Porsche Club of America · Golden Gate Region".
// A pick only fills the field (still editable); nothing about it is kept.
// Suggestions from two letters, 200 ms after the last one (both tables
// are readable by anyone, RLS clubs_read and club_regions_read). The
// directory is read once, when the field first has the focus.

/// A name folded for matching: lower case, no accents, words only.
export function fold(text) {
  return String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}
const words = (text) => fold(text).split(" ").filter(Boolean);

/// The directory as entries to match: each club, then each region as
/// "Club · Region". clubs: [{ id, name, short_name, aliases, popularity }];
/// regions: [{ club_id, name }].
export function entries(clubs, regions) {
  const byId = new Map();
  const out = [];
  for (const c of clubs || []) {
    if (!c?.name) continue;
    const keys = new Set([...words(c.name), ...words(c.short_name), ...(c.aliases || []).flatMap(words)]);
    const whole = [c.name, c.short_name, ...(c.aliases || [])].filter(Boolean).map(fold);
    const club = { name: c.name, club: keys, whole, region: [], pop: Number(c.popularity) || 0,
      // What a pick links (Chris via Product, 11/26): the club, its logo and color.
      link: { club_id: c.id, region_id: null, club_name: c.name, region_name: null, logo_url: c.logo_url || null, color: c.color || null } };
    byId.set(c.id, club);
    out.push(club);
  }
  for (const r of regions || []) {
    const club = byId.get(r?.club_id);
    if (!club || !r.name) continue;
    out.push({ name: `${club.name} · ${r.name}`, club: club.club, whole: club.whole, region: words(r.name), pop: club.pop, isRegion: true,
      link: { ...club.link, region_id: r.id || null, region_name: r.name } });
  }
  return out;
}

/// How well one query word fits a list of words: 3 whole, 2 the start of one; 0 none.
function fit(q, list) {
  let best = 0;
  for (const w of list) {
    if (w === q) return 3;
    if (w.startsWith(q)) best = 2;
  }
  return best;
}

/// The best `most` names for what's typed (two letters or more): every
/// word typed has to start a word of the club (its name, short name or
/// aliases) or of the region. Regions the words name in full come first
/// ("Golden Gate", "PCA Golden"); a club before its regions when only the
/// club is named, and before regions a few letters only start ("por" is
/// Porsche Club of America, not Mercedes-Benz Club of America · Portland);
/// then the better known.
export function suggest(list, typed, most = 8) {
  const q = words(typed);
  if (q.join("").length < 2) return [];
  const whole = fold(typed);
  const scored = [];
  for (const e of list) {
    let score = 0, inRegion = 0, wholeInRegion = 0;
    let ok = true;
    for (const w of q) {
      const r = fit(w, e.region), c = fit(w, e.club);
      if (!r && !c) { ok = false; break; }
      if (r >= c) inRegion++;
      if (r === 3 && r >= c) wholeInRegion++;
      score += Math.max(r, c);
    }
    if (!ok) continue;
    // Typed as the club's own name or short name ("PCA"): the club itself first.
    if (!e.isRegion && e.whole.includes(whole)) score += 4;
    if (e.isRegion && wholeInRegion) score += 2 + wholeInRegion;
    // A region nobody named sits after the clubs.
    if (e.isRegion && !inRegion) score -= 3;
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || !!a.e.isRegion - !!b.e.isRegion || b.e.pop - a.e.pop || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name));
  const seen = new Set();
  const out = [];
  for (const { e } of scored) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e.name);
    if (out.length === most) break;
  }
  return out;
}

/// The list entry a name is exactly (one picked from the suggestions), or
/// null for a name of its own: what Start a club links and suggests.
export function listMatch(directory, name) {
  const typed = String(name || "").trim();
  return (directory || []).find((e) => e.name === typed)?.link || null;
}

/// The directory, read whole once: clubs, then the regions 1,000 at a time
/// (PostgREST's most). select: (table, query) → rows.
export async function loadDirectory(select) {
  const clubs = await select("clubs", "select=id,name,short_name,aliases,popularity,logo_url,color&active=is.true&order=id&limit=1000");
  const regions = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const page = await select("club_regions", `select=id,club_id,name&active=is.true&order=id&limit=1000&offset=${offset}`);
    regions.push(...(page || []));
    if (!page || page.length < 1000) break;
  }
  return entries(clubs, regions);
}

/// The suggestions under a name field: a listbox the field controls
/// (arrow keys, Enter or a click picks, Esc closes), asked 200 ms after
/// the last letter. load() → the entries, once.
export function wireNames(input, list, load) {
  let directory = null, asking = null, timer = 0, active = -1, shown = [];
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-controls", list.id);
  const close = () => {
    list.hidden = true;
    list.replaceChildren();
    shown = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  };
  const mark = (i) => {
    active = i;
    [...list.children].forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
    if (i >= 0) input.setAttribute("aria-activedescendant", list.children[i].id);
    else input.removeAttribute("aria-activedescendant");
  };
  const pick = (name) => {
    input.value = name;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };
  const show = (names) => {
    shown = names;
    if (!names.length || document.activeElement !== input) return close();
    list.replaceChildren(...names.map((name, i) => {
      const li = document.createElement("li");
      li.id = `${list.id}-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      const [club, region] = name.split(" · ");
      const b = document.createElement("b");
      b.textContent = club;
      li.append(b);
      if (region) {
        const s = document.createElement("span");
        s.textContent = ` · ${region}`;
        li.append(s);
      }
      // Before the field's blur closes the list.
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(name); });
      return li;
    }));
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    mark(-1);
  };
  const ask = async () => {
    const typed = input.value;
    if (fold(typed).replace(/ /g, "").length < 2) return close();
    try {
      directory ??= await (asking ??= load());
    } catch {
      asking = null;
      return close();
    }
    if (input.value === typed) show(suggest(directory, typed));
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    if (shown.includes(input.value)) return close();
    timer = setTimeout(ask, 200);
  });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); mark((active + 1) % shown.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mark(active <= 0 ? shown.length - 1 : active - 1); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  input.addEventListener("blur", () => setTimeout(close, 0));
  // Read on the first focus, so the first letters find it there.
  input.addEventListener("focus", () => { asking ??= load(); asking.catch(() => { asking = null; }); }, { once: true });
  return { close };
}
