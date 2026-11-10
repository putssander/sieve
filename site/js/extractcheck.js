// Checks on extraction runs, so the automated extraction can be validated before a human verifies cells:
// completeness, quotes found verbatim in the full text, core-only compliance, and agreement between runs.
// Pure functions: used by step 7 (summary card), tools/check-extraction.mjs and the tests.

import { quoteInSource } from "./util.js";
import { applicableFields, modelFields } from "./prompts.js";

const isEmpty = v => v === undefined || v === null || String(v).trim() === "";
export const isNR = v => /^(nr|na|n\/a|not reported|not applicable|-)$/i.test(String(v ?? "").trim());

// Numbers in a value as fractions (82% → 0.82, 0.82 → 0.82), for comparing metrics between runs.
export function numbers(v) {
  return [...String(v ?? "").matchAll(/(\d+(?:[.,]\d+)?)\s*(%)?/g)].map(([, n, pct]) => {
    const x = Number(n.replace(",", "."));
    return pct || x > 1 && x <= 100 && /\./.test(n) ? x / 100 : x;
  });
}

const norm = v => String(v ?? "").toLowerCase().replace(/[^a-z0-9.%]+/g, " ").trim();

export function sameValue(a, b) {
  if (isNR(a) && isNR(b)) return true;
  if (isNR(a) !== isNR(b)) return false;
  const na = numbers(a), nb = numbers(b);
  if (na.length && nb.length && /^[\d\s.,%;()±-]+$/.test(String(a)) && /^[\d\s.,%;()±-]+$/.test(String(b))) return na.every((x, i) => Math.abs(x - (nb[i] ?? NaN)) < 0.0051);
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size)) >= 0.8;
}

// One run: per paper and in total. texts[rid] = full text (falls back to the abstract).
export function checkRun(project, run, texts = {}) {
  const fields = project.extraction.fields;
  const papers = [];
  for (const [rid, res] of Object.entries(run.results || {})) {
    const rec = project.records.find(r => r.rid === rid);
    if (!rec || res._error) { papers.push({ rid, error: res?._error || "unknown record" }); continue; }
    const all = applicableFields(project, rec);
    const want = modelFields(all);                       // DOI/author/year come from the record
    const coreOnly = all.length < fields.length;
    // Everything the model was shown: metadata, abstract and full text (Europe PMC bodies exclude the abstract).
    const src = [rec.title, rec.authors && `AUTHORS: ${rec.authors}`, rec.year && `YEAR: ${rec.year}`, rec.journal && `JOURNAL: ${rec.journal}`, rec.doi && `DOI: ${rec.doi}`,
      rec.affiliation && `FIRST AUTHOR AFFILIATION: ${rec.affiliation}`, rec.abstract, texts[rid] || ""].filter(Boolean).join("\n");
    const p = { rid, title: rec.title, coreOnly, expected: want.length, missing: [], filled: 0, nr: 0, quoted: 0, verified: 0, unverified: [], extra: [] };
    for (const f of want) {
      const c = res.fields?.[f.id];
      if (!c || isEmpty(c.value)) { p.missing.push(f.id); continue; }
      if (isNR(c.value)) { p.nr++; continue; }
      p.filled++;
      if (!isEmpty(c.quote) && !/no direct quote/i.test(c.quote)) {
        p.quoted++;
        const ok = src ? quoteInSource(c.quote, src) : null;
        if (ok) p.verified++; else p.unverified.push({ field: f.id, value: c.value, quote: c.quote });
      } else p.unverified.push({ field: f.id, value: c.value, quote: "" });
    }
    // Core-only papers must not get values for the other fields (the form's rule).
    if (coreOnly) for (const f of modelFields(fields).filter(x => !x.core)) { const c = res.fields?.[f.id]; if (c && !isEmpty(c.value) && !isNR(c.value)) p.extra.push(f.id); }
    papers.push(p);
  }
  const ok = papers.filter(p => !p.error);
  const sum = k => ok.reduce((n, p) => n + (Array.isArray(p[k]) ? p[k].length : p[k]), 0);
  return {
    papers,
    total: { papers: ok.length, errors: papers.length - ok.length, expected: sum("expected"), missing: sum("missing"), filled: sum("filled"), nr: sum("nr"),
      quoted: sum("quoted"), verified: sum("verified"), unverified: sum("unverified"), extra: sum("extra") },
  };
}

// Two runs on the same papers: agreement on every applicable field both runs answered.
export function agreement(project, runA, runB) {
  const rows = [];
  for (const rid of Object.keys(runA.results || {}).filter(r => runB.results?.[r] && !runA.results[r]._error && !runB.results[r]._error)) {
    const rec = project.records.find(r => r.rid === rid);
    if (!rec) continue;
    for (const f of modelFields(applicableFields(project, rec))) {
      const a = runA.results[rid].fields?.[f.id]?.value, b = runB.results[rid].fields?.[f.id]?.value;
      if (isEmpty(a) || isEmpty(b)) continue;
      rows.push({ rid, field: f.id, a, b, same: sameValue(a, b) });
    }
  }
  const same = rows.filter(r => r.same).length;
  return { compared: rows.length, same, rate: rows.length ? same / rows.length : null, differ: rows.filter(r => !r.same) };
}
