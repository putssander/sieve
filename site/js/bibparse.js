// Reading database exports: RIS (Ovid, Embase.com, Web of Science, Scopus, PsycInfo/EBSCO, ACM,
// EndNote, Zotero) and MEDLINE/PubMed format (.nbib, Ovid "MEDLINE" export). Keeps the fields the
// deduplication needs: authors, year, title, journal (full and abbreviated), ISSN, volume, issue, pages.

export function parseExport(text) {
  return /^PMID- /m.test(text) && !/^TY  - /m.test(text) ? parseMedline(text) : parseRis(text);
}

export function parseRis(text) {
  const recs = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (!m) { if (cur && cur._last && line.trim()) cur[cur._last] += " " + line.trim(); continue; }
    const [, tag, raw] = m;
    const val = raw.trim();
    if (tag === "TY") { cur = { authors: [], journals: [], _last: null }; continue; }
    if (tag === "ER") { if (cur) recs.push(finishRis(cur)); cur = null; continue; }
    if (!cur) continue;
    cur._last = null;
    if (tag === "DB" || tag === "DP") { cur.db = val; continue; }
    if (tag === "AU" || tag === "A1") { cur.authors.push(val); continue; }
    if (["JF", "T2", "JO", "J2", "JA", "J1"].includes(tag)) { cur.journals.push([tag, val]); continue; }
    const map = { TI: "title", T1: "title", AB: "abstract", N2: "abstract", PY: "year", Y1: "year", DA: "year", DO: "doi", UR: "link", AN: "accession",
      VL: "volume", IS: "issue", SP: "pages", EP: "end_page", SN: "issn", C7: "article_number" };
    const k = map[tag];
    if (!k) continue;
    if (!cur[k] || k === "abstract") cur[k] = cur[k] && k === "abstract" ? `${cur[k]} ${val}` : val;
    cur._last = k;
  }
  return recs;
}

function finishRis({ accession, db, journals, _last, ...r }) {
  // Full journal title first (JF/T2), abbreviations (JO/J2/JA/J1) as the alternative name.
  const full = journals.find(([t]) => t === "JF" || t === "T2")?.[1] || "";
  const abbr = journals.find(([t]) => ["J2", "JO", "JA", "J1"].includes(t))?.[1] || "";
  const pages = r.end_page && r.pages && !String(r.pages).includes("-") ? `${r.pages}-${r.end_page}` : r.pages || r.article_number || "";
  return {
    ...r,
    authors: r.authors.join("; "),
    journal: full || abbr, journal_abbr: full && abbr !== full ? abbr : "",
    pages, end_page: undefined, article_number: undefined,
    // PubMed / Ovid MEDLINE exports put the PMID in the accession number; Embase's accession numbers are not PMIDs.
    pmid: !/embase/i.test(db || "") && /^\d{5,9}$/.test(accession || "") ? accession : "",
    year: (String(r.year || "").match(/\d{4}/) || [""])[0],
    doi: String(r.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
    rid: undefined,
  };
}

// MEDLINE format: "TAG - value", tags padded to 4 characters, continuation lines indented by 6 spaces.
export function parseMedline(text) {
  const recs = [];
  let cur = null, last = null;
  const push = () => { if (cur?.PMID || cur?.TI) recs.push(finishMedline(cur)); };
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9]{0,3})\s*- (.*)$/);
    if (!m) { if (cur && last && /^\s{2,}\S/.test(line)) cur[last][cur[last].length - 1] += " " + line.trim(); continue; }
    const [, tag, val] = m;
    if (tag === "PMID") { push(); cur = {}; }
    if (!cur) continue;
    (cur[tag] ||= []).push(val.trim());
    last = tag;
  }
  push();
  return recs;
}

function finishMedline(c) {
  const one = t => (c[t] || [])[0] || "";
  const doi = [...(c.LID || []), ...(c.AID || [])].find(x => /\[doi\]/.test(x))?.replace(/\s*\[doi\]/, "") || "";
  return {
    pmid: one("PMID"), title: one("TI"), abstract: one("AB"),
    authors: (c.FAU || c.AU || []).join("; "),
    year: (one("DP").match(/\d{4}/) || [""])[0],
    journal: one("JT") || one("TA"), journal_abbr: one("JT") ? one("TA") : "",
    issn: (c.IS || []).map(x => x.split(" ")[0]).join("; "),
    volume: one("VI"), issue: one("IP"), pages: one("PG"), doi,
    pubtypes: c.PT || [],
  };
}
