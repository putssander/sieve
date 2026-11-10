// Which paper is this PDF? Downloaded PDFs keep the publisher's file name ("1-s2.0-S153204…-main.pdf"),
// so the match uses the record ID at the start of the name if present, otherwise the DOI or the title on
// the first pages. Saved web pages ("Download" landing pages) are recognised and rejected.

const words = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2));

export const isPdf = bytes => {
  const u = new Uint8Array(bytes.slice ? bytes.slice(0, 1024) : bytes);
  const head = String.fromCharCode(...u).replace(/^\s+/, "");
  return head.startsWith("%PDF");
};

// head = text of the first pages; records = candidate records (e.g. those without full text).
export function matchPdf(fileName, head, records) {
  const low = String(head || "").toLowerCase();
  const hw = words(head);
  const titleScore = r => { const tw = words(r.title); return tw.size ? [...tw].filter(w => hw.has(w)).length / tw.size : 0; };
  const byName = String(fileName).match(/^(\d+)[ ._-]/);
  if (byName) {
    const r = records.find(x => x.rid === byName[1]);
    if (r && ((r.doi && low.includes(r.doi.toLowerCase())) || titleScore(r) >= 0.7)) return { rid: r.rid, why: "file name, checked" };
    if (r) return { rid: null, why: `named ${r.rid}, but the first pages show neither its DOI nor its title` };
  }
  const byDoi = records.find(r => r.doi && low.includes(r.doi.toLowerCase()));
  if (byDoi) return { rid: byDoi.rid, why: "DOI in the PDF" };
  const best = records.map(r => ({ r, s: titleScore(r) })).sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= 0.8) return { rid: best.r.rid, why: `title (${Math.round(best.s * 100)}% of title words)` };
  return { rid: null, why: "no paper matched" };
}
