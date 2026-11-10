// Evidence quotes → where they are in the paper. locate() finds a quote in a text despite PDF line breaks,
// hyphenation, curly quotes and "…" gaps; highlightHtml() marks all quotes; fragmentUrl() builds a
// "text fragment" link (#:~:text=…) so the browser highlights the passage on the source web page
// (Chrome, Edge, Safari, recent Firefox; not inside PDFs). Pure functions: used by steps 6 and 7 and the tests.

const isQuote = c => /[“”„‟″"]/.test(c), isApos = c => /[‘’‚‛′`]/.test(c), isDash = c => /[-‐-―−]/.test(c);

// Normalised text (lower case, single spaces, straight quotes, "-" for every dash, line-end hyphenation
// removed) with a map from each normalised character back to its position in the original.
function normalise(text) {
  const src = String(text ?? "");
  let out = "";
  const map = [];
  let space = true;
  for (let i = 0; i < src.length; i++) {
    let c = src[i];
    if (isDash(c)) {
      // Dashes are ignored on both sides ("F1-score" = "F1score"), and a dash at a line end takes the line
      // break with it, so hyphenation ("medi-\ncation") and real hyphens at a line end ("F1-\nscore") both match.
      let j = i + 1;
      while (j < src.length && /[ \t\r]/.test(src[j])) j++;
      if (src[j] === "\n") { while (j < src.length && /\s/.test(src[j])) j++; i = j - 1; }
      continue;
    }
    if (/\s/.test(c)) { if (!space) { out += " "; map.push(i); space = true; } continue; }
    c = isQuote(c) ? '"' : isApos(c) ? "'" : isDash(c) ? "-" : c.toLowerCase();
    out += c; map.push(i); space = false;
  }
  return { out, map };
}

const cleanQuote = q => normalise(String(q ?? "").replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, "")).out.replace(/^[.,;:]+|[.,;:]+$/g, "").trim();

// Position of a quote in a text: { start, end } in the original text, or null. With "…" the parts are
// located in order and the span covers all of them.
export function locate(text, quote) {
  const parts = cleanQuote(quote).split(/\s*(?:…|\.\.\.)\s*/).map(s => s.trim()).filter(s => s.length > 3);
  if (!parts.length) return null;
  const { out, map } = normalise(text);
  let from = 0, start = -1, end = -1;
  for (const part of parts) {
    const at = out.indexOf(part, from);
    if (at < 0) return null;
    if (start < 0) start = at;
    end = at + part.length;
    from = end;
  }
  return { start: map[start], end: map[end - 1] + 1 };
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// HTML of the text with every located quote in <mark class="ev" data-ev="i">. Returns { html, found: [i...] }.
export function highlightHtml(text, quotes) {
  const spans = quotes.map((q, i) => ({ i, title: q.label || "", ...(locate(text, q.quote) || {}) })).filter(s => s.start !== undefined)
    .sort((a, b) => a.start - b.start);
  // Overlapping quotes (e.g. two runs citing the same sentence) share one mark: data-ev lists them all.
  const groups = [];
  for (const s of spans) {
    const g = groups[groups.length - 1];
    if (g && s.start < g.end) { g.end = Math.max(g.end, s.end); g.ids.push(s.i); g.titles.push(s.title); }
    else groups.push({ start: s.start, end: s.end, ids: [s.i], titles: [s.title] });
  }
  let html = "", pos = 0;
  for (const g of groups) {
    html += esc(text.slice(pos, g.start)) + `<mark class="ev" data-ev="${g.ids.join(" ")}" title="${esc(g.titles.filter(Boolean).join(" | "))}">${esc(text.slice(g.start, g.end))}</mark>`;
    pos = g.end;
  }
  return { html: html + esc(text.slice(pos)), found: groups.flatMap(g => g.ids) };
}

// Text-fragment link: long quotes as "start,end" (first and last words), which is robust to small
// differences in the middle. https://wicg.github.io/scroll-to-text-fragment/
export function fragmentUrl(url, quote) {
  if (!url) return "";
  const words = String(quote ?? "").replace(/[“”"‘’]/g, "").split(/\s*(?:…|\.\.\.)\s*/)[0].trim().split(/\s+/).filter(Boolean);
  if (!words.length) return url;
  const enc = s => encodeURIComponent(s).replace(/-/g, "%2D");
  const directive = words.length <= 8 ? enc(words.join(" ")) : `${enc(words.slice(0, 4).join(" "))},${enc(words.slice(-4).join(" "))}`;
  return `${url.split("#")[0]}#:~:text=${directive}`;
}

// The web page of a record to highlight in: PMC (full text) first, then the record's link, then the DOI.
export function sourceUrl(rec) {
  if (rec?.pmcid) return `https://pmc.ncbi.nlm.nih.gov/articles/${rec.pmcid}/`;
  if (rec?.link && !/\.pdf($|\?)/i.test(rec.link)) return rec.link;
  return rec?.doi ? `https://doi.org/${rec.doi}` : "";
}
