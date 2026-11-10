// Preprints in a review list: criterion "peer-reviewed full text" needs the published version.
// isPreprintDoi() recognises preprint servers by DOI prefix; publishedVersion() picks the published
// record from a Crossref "is-preprint-of" link or from Europe PMC results for the preprint DOI/title.

const PREPRINT_PREFIX = [
  [/^10\.48550\/arxiv\./i, "arXiv"],
  [/^10\.1101\//, "bioRxiv/medRxiv"],
  [/^10\.2139\/ssrn\./i, "SSRN"],
  [/^10\.21203\/rs\./i, "Research Square"],
  [/^10\.20944\/preprints/i, "Preprints.org"],
  [/^10\.31219\/osf\.io/i, "OSF Preprints"],
  [/^10\.36227\/techrxiv/i, "TechRxiv"],
  [/^10\.2196\/preprints\./i, "JMIR Preprints"],
];
export function isPreprintDoi(doi) {
  const d = String(doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
  const hit = PREPRINT_PREFIX.find(([re]) => re.test(d));
  return hit ? hit[1] : "";
}
const PREPRINT_SOURCE = /arxiv|medrxiv|biorxiv|research square|ssrn|preprints|techrxiv|osf/i;

// Europe PMC results (resultType=core) → the published record, if any.
export function publishedFromEuropePmc(results, title = "") {
  const words = t => new Set(String(t || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length > 2));
  const sim = (a, b) => { const A = words(a), B = words(b); return [...A].filter(x => B.has(x)).length / Math.max(1, new Set([...A, ...B]).size); };
  for (const r of results || []) {
    const journal = r.journalInfo?.journal?.title || "";
    if (r.source === "PPR" || !journal || PREPRINT_SOURCE.test(journal)) continue;
    if (title && sim(title, r.title) < 0.7) continue;
    return {
      title: (r.title || "").replace(/\.$/, ""), journal, year: String(r.journalInfo?.yearOfPublication || r.pubYear || ""),
      volume: r.journalInfo?.volume || "", issue: r.journalInfo?.issue || "", pages: r.pageInfo || "",
      pmid: r.pmid || "", pmcid: r.pmcid || "",
      doi: r.doi && !isPreprintDoi(r.doi) ? r.doi.toLowerCase() : "",       // proceedings often carry the preprint DOI
      via: "Europe PMC",
    };
  }
  return null;
}

// Apply a published version to a record; the preprint DOI is kept for the audit trail.
export function usePublishedVersion(rec, pub) {
  if (!rec.preprint_doi && isPreprintDoi(rec.doi)) rec.preprint_doi = rec.doi;
  Object.assign(rec, { doi: pub.doi || "", pmid: pub.pmid || rec.pmid || "", pmcid: pub.pmcid || rec.pmcid || "", journal: pub.journal, year: pub.year || rec.year,
    volume: pub.volume || "", issue: pub.issue || "", pages: pub.pages || "", link: pub.pmcid ? `https://pmc.ncbi.nlm.nih.gov/articles/${pub.pmcid}/` : pub.doi ? `https://doi.org/${pub.doi}` : rec.link });
  rec.version_note = `Published version used (${pub.journal} ${pub.year}${pub.pages ? `:${pub.pages}` : ""}); preprint ${rec.preprint_doi || ""}`.trim();
  return rec;
}
