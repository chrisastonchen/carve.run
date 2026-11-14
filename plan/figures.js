// A fact's figures apart from its words (Chris, 11/13: numbers in Oxanium,
// units and words in Figtree): "2 hr 50 min" → 2 · " hr " · 50 · " min".
// Pure, for the tests (scripts/plan-tests/figures.test.mjs); /r/'s page
// script and the guides' generator (scripts/drives/page_parts.py) split
// the same way.

/// [{ figure: true, text: "2" }, { figure: false, text: " hr " }, …]
export function figureParts(text) {
  return String(text ?? "").split(/(\d[\d,.]*)/).filter((t) => t !== "").map((t) => ({ figure: /^\d/.test(t), text: t }));
}

/// The parts as nodes: each figure a <b>, the rest text.
export function figureNodes(text, doc = document) {
  return figureParts(text).map((p) => {
    if (!p.figure) return doc.createTextNode(p.text);
    const b = doc.createElement("b");
    b.textContent = p.text;
    return b;
  });
}
