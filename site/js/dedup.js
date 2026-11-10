// Deduplication across databases, overlap per source, and recall per source against the known
// articles (validation + hold-out sets). Pure functions on the project's records: used by step 3,
// the page assistant, the report and the tests. Method: docs/deduplication.md.
//
// The passes follow Bramer et al. (J Med Libr Assoc 2016;104(3):240-3, with the correction in
// 2017;105(1):111): field combinations from strict to loose, page numbers normalised first. Strict
// passes link automatically; the cases the paper says to check by hand go to a review list.
// Sieve adds DOI/PMID passes first (with a title guard), never deletes (duplicate_of links to the
// kept record, the first imported), and a fuzzy-title check for typos.

import { normTitle, titleSimilarity, normDoi } from "./util.js";

// ------------------------------------------------------------------ normalisation
const ascii = s => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");

// Titles: translated titles are in [brackets] in MEDLINE/Embase; HTML and final punctuation differ.
export const titleNorm = t => normTitle(ascii(String(t ?? "").replace(/<[^>]+>/g, " ").replace(/^\[(.*)\]\.?$/, "$1")));

// First author's surname: "Bramer, Wichor M.", "Bramer WM, Giustini D" (Vancouver), "W.M. Bramer" → "bramer".
export function firstAuthor(authors) {
  const first = String(Array.isArray(authors) ? authors[0] : authors || "").split(/;| and |\n/)[0].trim();
  if (!first) return "";
  const part = first.split(",")[0].trim();                  // "Bramer" | "Bramer WM" | "W.M. Bramer"
  let toks = part.split(/\s+/);
  const initials = t => /^([A-Z]\.?-?){1,4}$/.test(t);
  if (toks.length > 1 && initials(toks[toks.length - 1]) && !initials(toks[0])) toks = toks.slice(0, -1);   // Vancouver: drop initials
  else if (toks.length > 1 && initials(toks[0])) toks = [toks[toks.length - 1]];                           // initials first
  return ascii(toks.join("")).toLowerCase().replace(/[^a-z]/g, "");
}

// Pages: MEDLINE and Cochrane abbreviate (1008-12 → 1008-1012), CINAHL appends the length ("5p").
// weak = no end page, start page 1, or not a number (e-locator, supplement): the paper checks these by hand.
export function normPages(pages, end = "") {
  let s = ascii(pages).replace(/\s*\d+\s*p\.?$/i, "").replace(/[–—‐−]/g, "-").replace(/\s+/g, "").replace(/^pp?\.?/i, "");
  if (end && !s.includes("-")) s = `${s}-${String(end).trim()}`;
  const m = s.match(/^([A-Za-z]*\d+[A-Za-z]?)(?:-([A-Za-z]*\d+[A-Za-z]?))?/);
  if (!m) return { key: "", start: "", weak: true };
  let [, a, b = ""] = m;
  if (b && /^\d+$/.test(a) && /^\d+$/.test(b) && b.length < a.length) b = a.slice(0, a.length - b.length) + b;
  if (b === a) b = "";
  const start = a.toLowerCase();
  return { key: b ? `${start}-${b.toLowerCase()}` : start, start, weak: !b || start === "1" || !/^\d/.test(start) };
}

const STOP = new Set(["of", "the", "and", "for", "in", "on", "de", "la", "le", "der", "und", "an", "a"]);
// Journal names: full ("Journal of the Medical Library Association") vs. abbreviated ("J Med Libr
// Assoc"): both reduce to the same acronym (jmla). ISSN wins when both records have one.
export function journalKeys(r) {
  const keys = [];
  for (const issn of [r.issn, r.eissn].flatMap(x => String(x || "").match(/\d{4}-?\d{3}[\dXx]/g) || [])) keys.push(`issn:${issn.replace("-", "").toLowerCase()}`);
  for (const j of [r.journal, r.journal_abbr]) {
    const toks = ascii(j).toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
    if (toks.length) keys.push(`j:${toks.map(t => t[0]).join("")}`);
    if (toks.length === 1) keys.push(`j:${toks[0]}`);            // "BMJ" is itself the acronym of "British Medical Journal"
  }
  return [...new Set(keys)];
}

const yearOf = r => (String(r.year || "").match(/\d{4}/) || [""])[0];
const num = s => (String(s ?? "").match(/[0-9]+[A-Za-z]?/) || [""])[0].toLowerCase();
const words = t => titleNorm(t).split(" ").filter(Boolean).length;

// ------------------------------------------------------------------ passes
// Each pass: which records take part (keys), and what to do with a match (auto link, review, or skip).
// Rows A-G are Bramer's Table 1; the rest are Sieve's additions.
export const RULES = {
  doi: { label: "DOI", what: "same DOI" },
  pmid: { label: "PMID", what: "same PMID" },
  A: { label: "A", what: "author + year + title + journal" },
  B: { label: "B", what: "author + year + title + pages" },
  C: { label: "C", what: "title + volume + pages" },
  D: { label: "D", what: "author + volume + pages" },
  E: { label: "E", what: "year + volume + issue + pages" },
  F: { label: "F", what: "title only" },
  G: { label: "G", what: "author + year (same pages)" },
  fuzzy: { label: "≈", what: "almost identical title (typo, punctuation), year ±1" },
};

function passes() {
  const T = r => titleNorm(r.title), AU = r => firstAuthor(r.authors), Y = yearOf, P = r => normPages(r.pages, r.end_page), V = r => num(r.volume), I = r => num(r.issue);
  const all = (...xs) => xs.every(Boolean);
  const shortTitle = (a, b) => words(a.title) < 4 || words(b.title) < 4;
  const pagesDiffer = (a, b) => P(a).key && P(b).key && P(a).key !== P(b).key;
  return [
    { rule: "doi", keys: r => (r.doi ? [normDoi(r.doi)] : []),
      decide: (a, b) => (!a.title || !b.title || titleSimilarity(a.title, b.title) >= 0.6 ? "auto" : ["review", "same DOI but different titles: erratum, comment or a wrong DOI?"]) },
    { rule: "pmid", keys: r => (/^\d{5,9}$/.test(String(r.pmid || "")) ? [String(r.pmid)] : []),
      decide: (a, b) => (!a.title || !b.title || titleSimilarity(a.title, b.title) >= 0.6 ? "auto" : ["review", "same PMID but different titles"]) },
    { rule: "A", keys: r => (all(AU(r), Y(r), T(r)) ? journalKeys(r).map(j => `${AU(r)}|${Y(r)}|${T(r)}|${j}`) : []),
      decide: (a, b) => (shortTitle(a, b) && pagesDiffer(a, b) ? ["review", "short title, different pages"] : "auto") },
    { rule: "B", keys: r => (all(AU(r), Y(r), T(r), P(r).key) ? [`${AU(r)}|${Y(r)}|${T(r)}|${P(r).key}`] : []), decide: () => "auto" },
    { rule: "C", keys: r => (all(T(r), V(r), P(r).key) ? [`${T(r)}|${V(r)}|${P(r).key}`] : []),
      // Correction 2017: review only references whose page numbers are missing or start with 1, for equal authors.
      decide: (a, b) => (P(a).weak || P(b).weak ? ["review", "pages missing or starting with 1: check the authors"] : AU(a) && AU(b) && AU(a) !== AU(b) ? ["review", "different first author"] : "auto") },
    { rule: "D", keys: r => (all(AU(r), V(r), P(r).key) ? [`${AU(r)}|${V(r)}|${P(r).key}`] : []),
      decide: (a, b) => (P(a).weak || P(b).weak ? ["review", "pages missing or starting with 1"] : "auto") },
    { rule: "E", keys: r => (all(Y(r), V(r), I(r), P(r).key) ? [`${Y(r)}|${V(r)}|${I(r)}|${P(r).key}`] : []),
      decide: (a, b) => (P(a).weak || P(b).weak ? ["review", "one page, page 1 or a letter: check title and authors"] : shortTitle(a, b) ? ["review", "short title"] : "auto") },
    { rule: "F", keys: r => (T(r) && words(r.title) >= 4 ? [T(r)] : []),
      decide: (a, b) => (pagesDiffer(a, b) && !P(a).weak && !P(b).weak ? ["review", "same title, different pages: check journal and authors"] : ["review", "same title; pages blank or equal: usually a true duplicate"]) },
    { rule: "G", keys: r => (all(AU(r), Y(r)) && P(r).key && !P(r).weak ? [`${AU(r)}|${Y(r)}|${P(r).key}`] : []),
      decide: () => ["review", "same first author, year and pages"] },
  ];
}

// Links duplicates (r.duplicate_of = kept rid, r.dup_rule = the pass) and returns
// { linked, byRule, review: [{a, b, rule, reason, sim}] }. Decisions are respected:
// r.dup_manual === "dup" keeps a hand-made link; `distinct` holds "ridA|ridB" pairs marked different.
export function dedupe(records, { distinct = [] } = {}) {
  const different = new Set(distinct.flatMap(p => [p, p.split("|").reverse().join("|")]));
  const byRid = new Map(records.map(r => [r.rid, r]));
  // Undo what the previous run copied into kept records, then start again from the import order.
  for (const r of records) {
    for (const [f, from] of Object.entries(r._filled || {})) if (from) delete r[f];
    delete r._filled;
    if (r.dup_manual !== "dup") { delete r.duplicate_of; delete r.dup_rule; }
  }
  const root = r => { let x = r, i = 0; while (x?.duplicate_of && i++ < 50) x = byRid.get(x.duplicate_of); return x || r; };
  const review = [], seenPair = new Set();
  const byRule = {};
  for (const pass of passes()) {
    const map = new Map();
    for (const r of records) {
      if (r.duplicate_of) continue;
      const keys = pass.keys(r);
      let linked = false;
      for (const k of keys) {
        const a = map.get(k);
        if (!a || a === r) continue;
        const pair = `${a.rid}|${r.rid}`;
        if (different.has(pair)) continue;
        const d = pass.decide(a, r);
        if (d === "auto") { r.duplicate_of = a.rid; r.dup_rule = pass.rule; byRule[pass.rule] = (byRule[pass.rule] || 0) + 1; linked = true; break; }
        if (Array.isArray(d) && !seenPair.has(pair)) { seenPair.add(pair); review.push({ a: a.rid, b: r.rid, rule: pass.rule, reason: d[1] }); }
      }
      if (!linked) for (const k of keys) if (!map.has(k)) map.set(k, r);
    }
  }
  // Sieve addition: almost identical titles that no exact rule caught (typos, punctuation, subtitles).
  for (const x of nearDuplicates(records)) {
    const pair = `${x.a}|${x.b}`;
    if (different.has(pair) || seenPair.has(pair) || seenPair.has(`${x.b}|${x.a}`)) continue;
    seenPair.add(pair);
    review.push({ ...x, rule: "fuzzy", reason: `${Math.round(x.sim * 100)}% similar titles` });
  }
  // Fill gaps in the kept record from its duplicates (undone on the next run, see above).
  for (const r of records) {
    if (!r.duplicate_of) continue;
    const k = root(r);
    for (const f of ["doi", "pmid", "abstract", "volume", "issue", "pages", "issn", "journal"]) if (!k[f] && r[f]) { k[f] = r[f]; (k._filled ||= {})[f] = r.rid; }
  }
  const linked = records.filter(r => r.duplicate_of).length;
  for (const r of records) if (r.duplicate_of && r.dup_manual === "dup") byRule.manual = (byRule.manual || 0) + 1;
  // Pairs whose records are already linked (by a later, stricter outcome) need no review.
  const open = review.filter(x => byRid.get(x.a) && byRid.get(x.b) && root(byRid.get(x.a)) !== root(byRid.get(x.b)));
  return { linked, byRule, review: open };
}

// Kept for callers that only need the number linked.
export const dedupeRecords = (records, opts) => dedupe(records, opts).linked;

// Likely duplicates the exact rules miss: very similar titles. Only between records that are not linked.
export function nearDuplicates(records, { threshold = 0.9, max = 200 } = {}) {
  const live = records.filter(r => !r.duplicate_of && r.title);
  const byWord = new Map();
  const ws = r => titleNorm(r.title).split(" ").filter(w => w.length > 3);
  live.forEach(r => { for (const w of new Set(ws(r))) (byWord.get(w) || byWord.set(w, []).get(w)).push(r); });
  const out = [], done = new Set();
  for (const a of live) {
    const cands = new Set();
    for (const w of ws(a).sort((x, y) => (byWord.get(x)?.length || 0) - (byWord.get(y)?.length || 0)).slice(0, 3)) for (const b of byWord.get(w) || []) if (b !== a) cands.add(b);
    for (const b of cands) {
      const key = [a.rid, b.rid].sort().join("|");
      if (done.has(key)) continue;
      done.add(key);
      if (a.doi && b.doi && normDoi(a.doi) !== normDoi(b.doi)) continue;
      if (titleNorm(a.title) === titleNorm(b.title)) continue;                   // exact: rule F handles it
      const y = Math.abs((Number(yearOf(a)) || 0) - (Number(yearOf(b)) || 0));
      if (yearOf(a) && yearOf(b) && y > 1) continue;
      const sim = titleSimilarity(a.title, b.title);
      if (sim >= threshold) out.push({ a: a.rid, b: b.rid, sim: Math.round(sim * 100) / 100 });
      if (out.length >= max) return out;
    }
  }
  return out.sort((x, y) => y.sim - x.sim);
}

// ------------------------------------------------------------------ overlap & recall
// Per source: records imported, how many an earlier source already had, and how many only this source contributed.
export function sourceOverlap(records) {
  const byRid = new Map(records.map(r => [r.rid, r]));
  const root = r => { let x = r, i = 0; while (x?.duplicate_of && i++ < 50) x = byRid.get(x.duplicate_of) || null; return x; };
  const groups = new Map();
  for (const r of records) { const k = root(r)?.rid ?? r.rid; (groups.get(k) || groups.set(k, new Set()).get(k)).add(r.source || "?"); }
  const out = new Map();
  for (const r of records) {
    const s = r.source || "?";
    const o = out.get(s) || out.set(s, { source: s, imported: 0, duplicates: 0, unique: 0 }).get(s);
    o.imported++;
    if (r.duplicate_of) o.duplicates++;
  }
  for (const srcs of groups.values()) if (srcs.size === 1) out.get([...srcs][0]).unique++;
  return [...out.values()];
}

// Which known articles (validation + hold-out) each source found: matched by PMID, DOI or title.
export function recallBySource(records, known) {
  const sources = [...new Set(records.map(r => r.source || "?"))];
  const idx = new Map(sources.map(s => [s, { pmid: new Set(), doi: new Set(), title: new Set() }]));
  for (const r of records) {
    const i = idx.get(r.source || "?");
    if (r.pmid) i.pmid.add(String(r.pmid));
    if (r.doi) i.doi.add(normDoi(r.doi));
    if (r.title) i.title.add(titleNorm(r.title));
  }
  const rows = known.map(k => ({
    ...k,
    found: Object.fromEntries(sources.map(s => {
      const i = idx.get(s);
      return [s, !!((k.pmid && i.pmid.has(String(k.pmid))) || (k.doi && i.doi.has(normDoi(k.doi))) || (k.title && i.title.has(titleNorm(k.title))))];
    })),
  }));
  const summary = sources.map(s => ({ source: s, found: rows.filter(r => r.found[s]).length, total: rows.length,
    validation: rows.filter(r => r.set === "validation" && r.found[s]).length, holdout: rows.filter(r => r.set === "holdout" && r.found[s]).length }));
  return { sources, rows, summary, anywhere: rows.filter(r => Object.values(r.found).some(Boolean)).length };
}

export function knownArticles(project) {
  const S = project.search || {};
  const one = set => v => ({ set, pmid: v.pmid || "", doi: v.doi || "", title: v.title || v.label || "" });
  return [...(S.validation || []).map(one("validation")), ...(S.holdout || []).map(one("holdout"))];
}

export function guessSource(fileName, text = "") {
  const t = `${fileName} ${(text.match(/^(DB|DP)  - .*$/m) || [""])[0]}`.toLowerCase();
  if (/embase/.test(t)) return "Embase";
  if (/psyc/.test(t)) return "PsycInfo";
  if (/web of science|wos|savedrecs|clarivate/.test(t)) return "Web of Science";
  if (/acm/.test(t)) return "ACM DL";
  if (/cinahl/.test(t)) return "CINAHL";
  if (/scopus/.test(t)) return "Scopus";
  if (/cochrane/.test(t)) return "Cochrane Library";
  if (/medline|ovid/.test(t)) return "MEDLINE (Ovid)";
  if (/pubmed|nbib/.test(t) || /^PMID- /m.test(text)) return "PubMed";
  return fileName.replace(/\.(ris|txt|nbib|csv|tsv|xlsx?|enw)$/i, "");
}
