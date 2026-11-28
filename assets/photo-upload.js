// A photo for the club pages (Chris via Product, 11/25-26: a club's logo and
// cover, a drive's photo, the drive album), checked before anyone sees it,
// as route photos are (migration 0009): made a JPEG of at most 2400 px and
// 2 MB in the page, uploaded to the private route-photo-uploads bucket in
// the account's own folder, then screen-photo's model looks at it; one it
// allows is published into route-photos and its public URL comes back.
import { SUPABASE_KEY, SUPABASE_URL, accessToken } from "/assets/carve-session.js?v=9c9566882f";

const MOST_PX = 2400;
const MOST_BYTES = 2 * 1024 * 1024;

/// The file as a JPEG blob that fits, on white (a logo's transparency).
export async function jpegOf(file, most = MOST_PX) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file isn't a photo Carve can read.");
  let scale = Math.min(1, most / Math.max(bitmap.width, bitmap.height));
  for (let quality = 0.88; ; quality -= 0.12) {
    const w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    g.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", Math.max(0.4, quality)));
    if (blob && (blob.size <= MOST_BYTES || quality <= 0.4 && scale < 0.3)) return { blob, width: w, height: h };
    if (quality <= 0.4) { scale *= 0.75; quality = 1; }
  }
}

/// Upload and check: → { url, width, height }. Throws with words to show.
export async function uploadPhoto(file, accountId) {
  const token = await accessToken().catch(() => null);
  if (!token || !accountId) throw new Error("Sign in to add a photo.");
  const { blob, width, height } = await jpegOf(file);
  const path = `${accountId.toLowerCase()}/${crypto.randomUUID()}.jpg`;
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/storage/v1/object/route-photo-uploads/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "image/jpeg", "x-upsert": "false" },
      body: blob,
    });
  } catch {
    throw new Error("Couldn't reach Carve. Check the connection and try again.");
  }
  if (!response.ok) throw new Error("Couldn't upload the photo. Try again.");
  const checked = await fetch(`${SUPABASE_URL}/functions/v1/screen-photo`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ path }),
  }).catch(() => null);
  const data = await checked?.json().catch(() => null);
  if (!checked?.ok || !data?.url) {
    if (checked?.status === 422) throw new Error("That photo can't be shown on Carve. Try another one.");
    if (checked?.status === 429) throw new Error("That's the most photos for today. Try again tomorrow.");
    throw new Error(data?.error && checked?.status !== 502 ? String(data.error) : "Couldn't check the photo. Try again.");
  }
  return { url: data.url, width, height };
}

/// Takes a published photo of this account's away again (the album's Delete).
export async function removePhoto(url, accountId) {
  const at = url.indexOf("/route-photos/");
  const path = at >= 0 ? url.slice(at + "/route-photos/".length) : "";
  if (!path.startsWith(`${(accountId || "").toLowerCase()}/`)) return;
  const token = await accessToken().catch(() => null);
  await fetch(`${SUPABASE_URL}/storage/v1/object/route-photos/${path}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${token}` },
  }).catch(() => {});
}
