// Deduplication across databases, overlap per source, and recall per source against the known
// articles (validation + hold-out sets). Pure functions on the project's records: used by step 3,
// the page assistant, the report and the tests.
//
// Records keep their source (the database export they came from). Duplicates are linked
// (duplicate_of = rid of the first record), never deleted, so PRISMA numbers stay traceable.

import { normTitle, titleSimilarity, normDoi } from "./util.js";

const titleKey = r => (r.title ? `${normTitle(r.title)}|${String(r.year || "").slice(0, 4)}` : "");

// Exact duplicates: same DOI, same PMID, or same normalised title + year. Returns the number linked.
// Manual decisions are kept: r.dup_manual = "dup" (linked by hand) or "distinct" (never link).
export function dedupeRecords(records) {
  const seen = { doi: new Map(), pmid: new Map(), title: new Map() };
  let n = 0;
  for (const r of records) {
    if (r.dup_manual === "dup" && r.duplicate_of) { n++; continue; }
    delete r.duplicate_of;
    if (r.dup_manual === "distinct") { remember(r); continue; }
    const keys = [["doi", normDoi(r.doi || "")], ["pmid", r.pmid], ["title", titleKey(r)]];
    const hit = keys.map(([k, v]) => v && seen[k].get(v)).find(Boolean);
    if (hit) { r.duplicate_of = hit; n++; }
    else remember(r);
  }
  return n;
  function remember(r) {
    for (const [k, v] of [["doi", normDoi(r.doi || "")], ["pmid", r.pmid], ["title", titleKey(r)]]) if (v && !seen[k].has(v)) seen[k].set(v, r.rid);
  }
}

// Likely duplicates the exact rules miss: very similar titles (typos, punctuation, subtitle changes,
// preprint vs. journal year). Only between records that are not already linked; for a human decision.
export function nearDuplicates(records, { threshold = 0.9, max = 200 } = {}) {
  const live = records.filter(r => !r.duplicate_of && r.title && r.dup_manual !== "distinct");
  const byWord = new Map();
  const words = r => normTitle(r.title).split(" ").filter(w => w.length > 3);
  live.forEach(r => { for (const w of new Set(words(r))) (byWord.get(w) || byWord.set(w, []).get(w)).push(r); });
  const out = [], done = new Set();
  for (const a of live) {
    const cands = new Set();
    // Rare words narrow the comparison down (titles share at least one uncommon word).
    for (const w of words(a).sort((x, y) => (byWord.get(x)?.length || 0) - (byWord.get(y)?.length || 0)).slice(0, 3)) for (const b of byWord.get(w) || []) if (b !== a) cands.add(b);
    for (const b of cands) {
      const key = [a.rid, b.rid].sort().join("|");
      if (done.has(key)) continue;
      done.add(key);
      if (a.doi && b.doi && normDoi(a.doi) !== normDoi(b.doi)) continue;      // different DOIs: different papers
      const y = Math.abs((Number(a.year) || 0) - (Number(b.year) || 0));
      if (a.year && b.year && y > 1) continue;
      const sim = titleSimilarity(a.title, b.title);
      if (sim >= threshold) out.push({ a: a.rid, b: b.rid, sim: Math.round(sim * 100) / 100 });
      if (out.length >= max) return out;
    }
  }
  return out.sort((x, y) => y.sim - x.sim);
}

// Per source: records imported, how many were already found in an earlier source, and how many only
// this source contributed (the "unique" column of a PRISMA-S overlap table).
export function sourceOverlap(records) {
  const byRid = new Map(records.map(r => [r.rid, r]));
  const root = r => { let x = r, i = 0; while (x?.duplicate_of && i++ < 20) x = byRid.get(x.duplicate_of) || null; return x; };
  const groups = new Map();   // root rid → set of sources
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
// This checks every translated strategy against the same articles as the PubMed tuning.
export function recallBySource(records, known) {
  const sources = [...new Set(records.map(r => r.source || "?"))];
  const idx = new Map(sources.map(s => [s, { pmid: new Set(), doi: new Set(), title: new Set() }]));
  for (const r of records) {
    const i = idx.get(r.source || "?");
    if (r.pmid) i.pmid.add(String(r.pmid));
    if (r.doi) i.doi.add(normDoi(r.doi));
    if (r.title) i.title.add(normTitle(r.title));
  }
  const rows = known.map(k => ({
    ...k,
    found: Object.fromEntries(sources.map(s => {
      const i = idx.get(s);
      return [s, !!((k.pmid && i.pmid.has(String(k.pmid))) || (k.doi && i.doi.has(normDoi(k.doi))) || (k.title && i.title.has(normTitle(k.title))))];
    })),
  }));
  const summary = sources.map(s => ({ source: s, found: rows.filter(r => r.found[s]).length, total: rows.length,
    validation: rows.filter(r => r.set === "validation" && r.found[s]).length, holdout: rows.filter(r => r.set === "holdout" && r.found[s]).length }));
  return { sources, rows, summary, anywhere: rows.filter(r => Object.values(r.found).some(Boolean)).length };
}

// Known articles of a project in the shape recallBySource expects.
export function knownArticles(project) {
  const S = project.search || {};
  const one = set => v => ({ set, pmid: v.pmid || "", doi: v.doi || "", title: v.title || v.label || "" });
  return [...(S.validation || []).map(one("validation")), ...(S.holdout || []).map(one("holdout"))];
}

// Guess the database from an export file (name and RIS DB/DP tags).
export function guessSource(fileName, text = "") {
  const t = `${fileName} ${(text.match(/^(DB|DP)  - .*$/m) || [""])[0]}`.toLowerCase();
  if (/embase/.test(t)) return "Embase";
  if (/psyc/.test(t)) return "PsycInfo";
  if (/web of science|wos|savedrecs|clarivate/.test(t)) return "Web of Science";
  if (/acm/.test(t)) return "ACM DL";
  if (/cinahl/.test(t)) return "CINAHL";
  if (/scopus/.test(t)) return "Scopus";
  if (/medline|ovid/.test(t)) return "MEDLINE (Ovid)";
  if (/pubmed|nbib/.test(t)) return "PubMed";
  return fileName.replace(/\.(ris|txt|nbib|csv|tsv|xlsx?|enw)$/i, "");
}
