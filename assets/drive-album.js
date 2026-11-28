// A drive's album (Chris via Product, 11/25-26; 0141): one shared set of
// photos on the drive page and on its day links. Organizers add, and anyone
// signed in who opens one of its day links, at any time (0142; the server
// decides: drive_album's refusal). Anyone who can open the drive sees it;
// nobody sees who added which, only "yours".
// Your own you can delete; organizers hide any (the file stays); anyone
// signed in can report one, as route photos.
import { el, publicRpc, rpc, sessionUserId, signedIn, WORDS } from "/assets/club-api.js?v=ab5108fda2";
import { removePhoto, uploadPhoto } from "/assets/photo-upload.js?v=c7b700d355";
import { albumWords } from "/assets/club-words.js?v=b2e82d803a";

/// Draws the album into `box`, with `add` (a button) and `file` (a file
/// input) wired. `where`: { driveId } for organizers, { token } for a link.
/// `onState` hears the album as it loads ({ photos, refusal, … }).
export async function renderAlbum({ box, add, file, where, onState }) {
  let album = null;
  let busy = false;
  const ask = (name, body) => (sessionUserId() ? rpc(name, body) : publicRpc(name, body));
  async function load() {
    try {
      album = await ask("drive_album", { p_drive_id: where.driveId || null, p_token: where.token || null });
    } catch (failure) {
      album = null;
      box.replaceChildren(el("p", "dv-empty", failure?.code === "not_found" ? "This drive has no album." : "The album couldn't be loaded."));
      add.hidden = true;
      return;
    }
    if (!album) { box.replaceChildren(); add.hidden = true; return; }
    draw();
    onState?.(album);
  }
  function draw(said = "") {
    const photos = album.photos || [];
    // Signed out: the button asks them to sign in (its click does).
    add.hidden = (!!album.refusal && album.refusal !== "sign_in") || busy;
    add.dataset.label ||= add.textContent;
    add.textContent = album.refusal === "sign_in" ? "Sign in to add photos" : add.dataset.label;
    const words = albumWords(album);
    const parts = [];
    if (!photos.length || words.note) {
      parts.push(el("p", photos.length ? "dv-note" : "dv-empty", photos.length ? words.note : words.empty));
    }
    if (photos.length) {
      const grid = el("div", "dv-album");
      photos.forEach((p, i) => grid.append(tile(p, i === 0)));
      parts.push(grid);
    }
    if (said) parts.push(el("p", "dv-said", said));
    box.replaceChildren(...parts);
  }
  function tile(p, lead) {
    const fig = el("figure", `dv-ph${lead ? " wide" : ""}${p.hidden ? " hidden" : ""}`);
    const a = el("a");
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener";
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = p.url;
    a.append(img);
    fig.append(a);
    if (p.hidden) fig.append(el("span", "dv-ph-tag", "Hidden"));
    const acts = [];
    if (p.mine) acts.push(["Delete", () => act(async () => { const r = await rpc("drive_album_delete", { p_photo_id: p.id }); await removePhoto(r.url, sessionUserId()); })]);
    if (album.organizer && !p.mine) acts.push([p.hidden ? "Show" : "Hide", () => act(() => rpc("drive_album_hide", { p_photo_id: p.id, p_hidden: !p.hidden }))]);
    if (sessionUserId() && !p.mine && !album.organizer) acts.push(["Report", () => act(() => rpc("drive_album_report", { p_photo_id: p.id }), "Thanks. Carve will take a look.")]);
    if (acts.length) {
      const row = el("div", "dv-ph-acts");
      for (const [label, go] of acts) {
        const b = el("button", "dv-ph-act", label);
        b.type = "button";
        b.addEventListener("click", go);
        row.append(b);
      }
      fig.append(row);
    }
    return fig;
  }
  async function act(fn, thanks = "") {
    try {
      await fn();
      if (thanks) { draw(thanks); return; }
      await load();
    } catch (failure) {
      draw(WORDS[failure?.code] || failure?.message || "That didn't work. Try again.");
    }
  }
  add.addEventListener("click", async () => {
    if (!(await signedIn())) return window.carveSignIn?.({ returnTo: location.pathname + location.search });
    file.click();
  });
  file.addEventListener("change", async () => {
    const files = [...file.files];
    file.value = "";
    if (!files.length || !album) return;
    busy = true;
    let done = 0;
    let said = "";
    for (const f of files) {
      draw(`Adding ${done + 1} of ${files.length}…`);
      try {
        const up = await uploadPhoto(f, sessionUserId());
        await rpc("drive_album_add", { p_drive_id: where.driveId || null, p_token: where.token || null, p_url: up.url, p_width: up.width, p_height: up.height });
        done++;
      } catch (failure) {
        said = WORDS[failure?.code] || failure?.message || "A photo couldn't be added.";
        if (failure?.code && failure.code !== "bad_input") break;
      }
    }
    busy = false;
    await load();
    if (said) draw(said);
  });
  await load();
  return { reload: load };
}
