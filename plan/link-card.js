// A drive's route link with its QR code, shared by the Attendees step's
// "Just share the route link" and the Send step (the approved mock, 11/9):
// App Dev's drive_get.route_link { token, url }, never the drive's
// invitation link (/d/<token>, which withholds the route until confirmed).
//   linkCard({ el, url, label, driveName, onRotate?, refusal? }) → an element
// With url null: "The route link comes once the drive is saved.", Copy and
// the QR off. onRotate (async, → the new url) adds "New link", asked twice
// since the old link and QR code stop working. The QR downloads as a PNG
// named for the drive ("Coastal Run route link.png"). refusal(failure) → the
// words when onRotate throws (attendees-step.js's routeLinkRefusal).

/// The QR's file name: the drive's name, safe for a file system.
export const qrFileName = (driveName) => `${String(driveName || "Group drive").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Group drive"} route link.png`;

export function linkCard({ el, url, label = "Route link", driveName = "", onRotate = null, refusal = null }) {
  const box = el("div", "lc");
  let armed = false;
  let said = "";
  let current = url || null;
  const button = (text, cls, onClick) => { const b = el("button", cls, text); b.type = "button"; b.addEventListener("click", onClick); return b; };

  function qrModel() {
    if (!current || !window.qrcode) return null;
    const qr = window.qrcode(0, "M");
    qr.addData(current);
    qr.make();
    return qr;
  }

  function download() {
    const qr = qrModel();
    if (!qr) return;
    const count = qr.getModuleCount();
    const scale = 24;
    const margin = 4 * scale;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = count * scale + margin * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111113";
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect(margin + c * scale, margin + r * scale, scale, scale);
    const a = el("a");
    a.href = canvas.toDataURL("image/png");
    a.download = qrFileName(driveName);
    document.body.append(a);
    a.click();
    a.remove();
  }

  function render() {
    const parts = [el("h4", "lc-h", label)];
    if (!current) {
      parts.push(el("p", "lc-none", "The route link comes once the drive is saved."));
    } else {
      parts.push(el("p", "lc-url", current.replace(/^https?:\/\//, "")));
      const qr = qrModel();
      if (qr) {
        const pic = el("div", "lc-qr");
        pic.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
        pic.setAttribute("role", "img");
        pic.setAttribute("aria-label", `QR code for ${current}`);
        parts.push(pic);
      }
    }
    const row = el("div", "lc-row");
    const copy = button("Copy link", "pill grey", async () => {
      try { await navigator.clipboard.writeText(current); said = "Link copied."; } catch { said = "Couldn't copy. Select the link and copy it."; }
      render();
    });
    const qrBtn = button("Download QR code", "pill grey", download);
    copy.disabled = qrBtn.disabled = !current;
    row.append(copy, qrBtn);
    if (onRotate && current) {
      row.append(button(armed ? "Make a new link: the old link and QR code stop working" : "New link", "textlink", async () => {
        if (!armed) { armed = true; return render(); }
        armed = false;
        try {
          current = (await onRotate()) || current;
          said = "New link made. The old one and its QR code no longer work.";
        } catch (failure) {
          said = refusal?.(failure) || "Couldn't make a new link. Try again.";
        }
        render();
      }));
    }
    parts.push(row);
    if (said) parts.push(el("p", "lc-said", said));
    box.replaceChildren(...parts);
  }
  render();
  return Object.assign(box, {
    /// A new url from the server (a pull, or the link made at last).
    setUrl(next) { current = next || null; said = ""; armed = false; render(); },
  });
}
