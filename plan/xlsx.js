// A spreadsheet's first sheet as rows of text (the Attendees drop target,
// the approved mock 11/9: "Drop your list here"). An .xlsx is a zip of XML:
// read the zip's directory, inflate with the browser's own
// DecompressionStream, and take the first sheet's cells. No library: dates
// come back as the spreadsheet's day numbers (attendees.js reads those).

const td = new TextDecoder();

/// The zip's files: { name → { method, offset, size } } from its central directory.
function entries(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not_xlsx");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = {};
  for (let n = 0; n < count; n++) {
    if (v.getUint32(at, true) !== 0x02014b50) throw new Error("not_xlsx");
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true);
    const comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = td.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    out[name] = { method, size, local };
    at += 46 + nameLen + extra + comment;
  }
  return { v, out };
}

async function fileText(bytes, { v, out }, name) {
  const e = out[name];
  if (!e) return null;
  const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const raw = bytes.subarray(start, start + e.size);
  if (e.method === 0) return td.decode(raw);
  if (e.method !== 8) throw new Error("not_xlsx");
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return td.decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
/// The text of a string item: its <t> runs joined (rich text has several).
const textOf = (xml) => unescape([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
/// "C12" → column 2 (0-based).
const colOf = (ref) => [...ref.replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

/// An .xlsx's first sheet → rows of trimmed text, blank rows dropped.
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const zip = entries(bytes);
  const shared = [...((await fileText(bytes, zip, "xl/sharedStrings.xml")) || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  // The first sheet in the workbook's order, through its relationship.
  const book = (await fileText(bytes, zip, "xl/workbook.xml")) || "";
  const rels = (await fileText(bytes, zip, "xl/_rels/workbook.xml.rels")) || "";
  const rid = book.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || rels.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheet = await fileText(bytes, zip, path) ?? await fileText(bytes, zip, "xl/worksheets/sheet1.xml");
  if (sheet == null) throw new Error("not_xlsx");
  const rows = [];
  for (const [, body] of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, attrs, inner = ""] of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const value = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
      const text = type === "s" ? shared[Number(value)] ?? "" : type === "inlineStr" ? textOf(inner) : type === "b" ? (value === "1" ? "TRUE" : "FALSE") : unescape(value);
      const i = ref ? colOf(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = text.trim();
    }
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

/// A dropped or chosen file → rows: .xlsx by its zip, anything else as
/// CSV or tab-separated text (parseTable's).
export async function rowsOfFile(file, parseTable) {
  const name = String(file.name || "").toLowerCase();
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (name.endsWith(".xlsx") || (head[0] === 0x50 && head[1] === 0x4b)) return readXlsx(await file.arrayBuffer());
  if (name.endsWith(".xls") || name.endsWith(".numbers") || name.endsWith(".pdf") || /^image\//.test(file.type || "")) throw new Error("unsupported");
  return parseTable(await file.text());
}
