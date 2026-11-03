// Free literature APIs that allow direct browser calls (CORS): PubMed E-utilities, Crossref,
// Europe PMC, Unpaywall. Plus the optional local helper (`python -m srp serve`) for pages that
// block browsers (publisher HTML/PDF).

import { getSettings } from "./store.js";
import { sleep, cleanText, normDoi, htmlToText } from "./util.js";

// ------------------------------------------------------------------ PubMed
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
let lastCall = 0;
let chain = Promise.resolve();

// NCBI allows 3 requests/s without a key, 10/s with one. All calls are serialised through one queue.
function throttled(fn) {
  const run = chain.then(async () => {
    const gap = getSettings().ncbiKey ? 110 : 360;
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    return fn();
  });
  chain = run.catch(() => {});
  return run;
}

async function eutils(ep, params, { retries = 4 } = {}) {
  const s = getSettings();
  const p = new URLSearchParams({ db: "pubmed", tool: "srp", ...params });
  if (s.ncbiKey) p.set("api_key", s.ncbiKey);
  if (s.email) p.set("email", s.email);
  for (let i = 0; ; i++) {
    try {
      const r = await throttled(() => fetch(EUTILS + ep, { method: "POST", body: p }));
      if (r.status === 429 || r.status >= 500) throw new Error(`PubMed HTTP ${r.status}`);
      if (!r.ok) throw new Error(`PubMed HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return params.retmode === "json" ? r.json() : r.text();
    } catch (e) {
      if (i >= retries) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

export async function pmCount(q) {
  const j = await eutils("esearch.fcgi", { term: q, retmode: "json", retmax: 0 });
  if (j.esearchresult?.ERROR) throw new Error(j.esearchresult.ERROR);
  return { count: Number(j.esearchresult.count), warnings: j.esearchresult.warninglist, translation: j.esearchresult.querytranslation };
}

export async function pmIds(q, retmax = 10000, retstart = 0) {
  const j = await eutils("esearch.fcgi", { term: q, retmode: "json", retmax, retstart });
  return j.esearchresult.idlist || [];
}

// Which of these PMIDs does the query find?
export async function pmHits(q, pmids) {
  if (!pmids.length) return new Set();
  const ids = await pmIds(`(${q}) AND (${pmids.map(p => `${p}[pmid]`).join(" OR ")})`, pmids.length + 5);
  return new Set(ids);
}

export async function pmSummaries(pmids) {
  const out = {};
  for (let i = 0; i < pmids.length; i += 200) {
    const j = await eutils("esummary.fcgi", { id: pmids.slice(i, i + 200).join(","), retmode: "json" });
    for (const k of j.result?.uids || []) {
      const d = j.result[k];
      out[k] = { pmid: k, title: d.title, year: (d.pubdate || "").slice(0, 4), journal: d.source,
        doi: (d.articleids || []).find(a => a.idtype === "doi")?.value || "" };
    }
  }
  return out;
}

// Full records incl. abstract, MeSH and keywords (PubMed XML).
export async function pmFetch(pmids, onProgress) {
  const recs = [];
  for (let i = 0; i < pmids.length; i += 200) {
    const xml = await eutils("efetch.fcgi", { id: pmids.slice(i, i + 200).join(","), retmode: "xml" });
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    for (const a of doc.querySelectorAll("PubmedArticle")) {
      const t = sel => cleanText(a.querySelector(sel)?.textContent);
      const abs = [...a.querySelectorAll("Abstract AbstractText")].map(n => (n.getAttribute("Label") ? n.getAttribute("Label") + ": " : "") + n.textContent).join(" ");
      recs.push({
        pmid: t("MedlineCitation > PMID"),
        title: t("ArticleTitle"),
        abstract: cleanText(abs),
        year: t("PubDate Year") || t("PubDate MedlineDate").slice(0, 4),
        journal: t("Journal > Title"),
        authors: [...a.querySelectorAll("AuthorList Author")].map(au => `${au.querySelector("LastName")?.textContent || au.querySelector("CollectiveName")?.textContent || ""}, ${au.querySelector("Initials")?.textContent || ""}`).join("; "),
        doi: normDoi(a.querySelector('ArticleId[IdType="doi"]')?.textContent || ""),
        mesh: [...a.querySelectorAll("MeshHeading > DescriptorName")].map(n => n.textContent),
        keywords: [...a.querySelectorAll("KeywordList Keyword")].map(n => cleanText(n.textContent)),
        pubtypes: [...a.querySelectorAll("PublicationType")].map(n => n.textContent),
      });
    }
    onProgress?.(Math.min(i + 200, pmids.length), pmids.length);
  }
  return recs;
}

export async function doiToPmid(doi) {
  const ids = await pmIds(`${doi}[doi]`, 2);
  return ids.length === 1 ? ids[0] : "";
}

// ------------------------------------------------------------------ Crossref
export async function crossref(doi) {
  const mail = getSettings().email;
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}${mail ? `?mailto=${encodeURIComponent(mail)}` : ""}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Crossref HTTP ${r.status}`);
  return (await r.json()).message;
}

export async function crossrefByTitle(title) {
  const mail = getSettings().email;
  const u = `https://api.crossref.org/works?rows=3&query.bibliographic=${encodeURIComponent(title)}${mail ? `&mailto=${encodeURIComponent(mail)}` : ""}`;
  const r = await fetch(u);
  if (!r.ok) return [];
  return (await r.json()).message.items || [];
}

export function crossrefYears(msg) {
  const ys = [];
  for (const k of ["published", "published-print", "published-online", "issued", "created"]) {
    const y = msg?.[k]?.["date-parts"]?.[0]?.[0];
    if (y && !ys.includes(y)) ys.push(y);
  }
  return ys;
}

// ------------------------------------------------------------------ open-access full text
export async function europePmcFullText(doi, pmid) {
  const q = doi ? `DOI:"${doi}"` : `EXT_ID:${pmid} AND SRC:MED`;
  const r = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&query=${encodeURIComponent(q)}`);
  if (!r.ok) return null;
  const hit = (await r.json()).resultList?.result?.[0];
  if (!hit?.pmcid || hit.isOpenAccess !== "Y") return { pmcid: hit?.pmcid || "", oa: false };
  const x = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${hit.pmcid}/fullTextXML`);
  if (!x.ok) return { pmcid: hit.pmcid, oa: true };
  const doc = new DOMParser().parseFromString(await x.text(), "text/xml");
  doc.querySelectorAll("ref-list, table-wrap-foot, fig").forEach(n => n.remove());
  const text = cleanText([doc.querySelector("article-title")?.textContent, doc.querySelector("abstract")?.textContent, doc.querySelector("body")?.textContent].join("\n"));
  return { pmcid: hit.pmcid, oa: true, text, url: `https://europepmc.org/article/PMC/${hit.pmcid}` };
}

export async function unpaywall(doi) {
  const mail = getSettings().email || "srp@example.org";
  const r = await fetch(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(mail)}`);
  if (!r.ok) return null;
  const j = await r.json();
  const loc = j.best_oa_location;
  return { is_oa: j.is_oa, pdf: loc?.url_for_pdf || "", landing: loc?.url_for_landing_page || "", status: j.oa_status };
}

// ------------------------------------------------------------------ local helper (python -m srp serve)
export async function localHealth() {
  const base = localBase();
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? r.json() : null;
  } catch { return null; }
}
function localBase() {
  // When the GUI itself is served by the helper, use the same origin.
  return location.port === "8765" ? location.origin : getSettings().localUrl.replace(/\/$/, "");
}
export async function localFetch(url) {
  const r = await fetch(`${localBase()}/api/fetch?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`fetch via local helper: HTTP ${r.status}`);
  const type = r.headers.get("x-content-type") || r.headers.get("content-type") || "";
  if (type.includes("pdf")) return { pdf: await r.arrayBuffer(), url: r.headers.get("x-final-url") || url };
  return { text: htmlToText(await r.text()), url: r.headers.get("x-final-url") || url };
}
