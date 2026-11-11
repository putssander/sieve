// Trial registers (MECIR C27: search trial registers for ongoing and unpublished studies).
//
// ClinicalTrials.gov: API v2, free, no key, CORS open (Access-Control-Allow-Origin: *, also on 400 errors),
//   so the browser calls it directly. Docs: https://clinicaltrials.gov/data-api/api
//   query.term is the "Other terms" box in Essie expression syntax:
//   https://clinicaltrials.gov/find-studies/constructing-complex-search-queries
//   - AND / OR / NOT in capitals, parentheses, "quoted phrases". Precedence: NOT > AND > OR.
//   - Default expansion is Relaxation: words are expanded with plurals, spelling variants and UMLS synonyms,
//     and unquoted words may be apart. A quoted phrase behaves like EXPANSION[Concept] (synonyms, kept together).
//   - There is NO truncation. "*" is read as punctuation and ignored: checked 2026-11-11 against the live API,
//     implement* = implement (5,376 studies), implementation = 14,518, implemen* = 0, nephrolog* = 0,
//     "machine learn*" = 3 (literal "machine learn"). So a truncated term is searched as its stem (plus the
//     plural/spelling variants Essie adds), and a stem that is not a word finds nothing: write the endings out.
//
// WHO ICTRP (https://trialsearch.who.int/): no free public API. The XML web service is for partners and
//   charged ("price upon request": https://www.who.int/clinical-trials-registry-platform/the-ictrp-search-portal/ictrp-search-portal-web-service),
//   and the portal is an ASP.NET form that cannot be prefilled by URL. Manual route:
//     1. open https://trialsearch.who.int/ (or AdvSearch.aspx for field searches), paste the query, Search;
//     2. note the date and the number of records (for PRISMA-S);
//     3. "Export results to XML" (accept the terms of use) and keep the file; ICTRP also holds the
//        ClinicalTrials.gov records, so remove NCT duplicates against the ClinicalTrials.gov search.
//   Syntax (https://www.who.int/tools/clinical-trials-registry-platform/the-ictrp-search-portal/search-tips):
//   AND / OR / NOT, parentheses, "phrases"; * truncation at the end of a word with at least 3 characters before
//   it (switches off synonym search). Long queries can time out: keep the ICTRP query short.
//
// Pure functions except ctgovSearch (fetch), so this runs in node tests.
import { parseTerm, blockTerms } from "./query.js";

export const CTGOV_API = "https://clinicaltrials.gov/api/v2/studies";
export const ICTRP_URL = "https://trialsearch.who.int/";
export const ICTRP_ADVANCED_URL = "https://trialsearch.who.int/AdvSearch.aspx";

// Only the fields ctgovToRecord uses (the response keeps the nested protocolSection shape).
export const CTGOV_FIELDS = ["NCTId", "BriefTitle", "OfficialTitle", "BriefSummary", "Condition", "Keyword", "InterventionType",
  "InterventionName", "StartDate", "LeadSponsorName", "StudyType", "OverallStatus", "Phase"];

// Fields that have a text meaning in a register. Everything else (dates, language, publication type,
// subsets) is a bibliographic limit and is left out.
const TEXT_FIELDS = new Set(["tiab", "ti", "ab", "tw", "tw:noexp", "all", "ot", "kw", "mesh", "mesh:noexp", "majr", "nm", "sh"]);
const RESERVED = /^(and|or|not|near|area|search|coverage|expansion|missing|all|range|distance|tilt)$/i;

// One PubMed-style term → register syntax, or "" when it has no register meaning.
// mode "ctgov": strip * (Essie has no truncation); mode "ictrp": keep * at the end of single words (≥3 chars).
function regTerm(t, mode, warn) {
  const word = (w, quoted = false) => {
    let x = String(w).replace(/"/g, "").trim();
    if (!x) return "";
    if (/[*?]/.test(x)) {
      const multi = /\s/.test(x);
      if (mode === "ctgov" || multi || !/^[^*?]{3,}\*$/.test(x)) {
        const stem = x.replace(/[*?]/g, "");
        warn.trunc.add(`${x} → ${stem}`);
        x = stem;
        if (!x) return "";
      }
      if (/[*?]/.test(x)) return x;   // ICTRP: truncated single word
    }
    return quoted || /[\s-]/.test(x) || RESERVED.test(x) ? `"${x}"` : x;
  };
  if (t.kind === "near") {
    const side = s => (s.length > 1 ? `(${s.map(w => word(w)).filter(Boolean).join(" OR ")})` : word(s[0]));
    warn.add("Proximity (NEAR) has no register equivalent: written as AND of the two word groups (broader).");
    return `(${side(t.left)} AND ${side(t.right)})`;
  }
  if (t.kind === "raw" && !/\[/.test(t.src)) {
    // No field tags: a plain word, phrase or small Boolean expression, searched as written.
    const m = t.src.match(/^"([^"]+)"$|^([^\s()"]+)$/);
    if (m) return word(m[1] ?? m[2], !!m[1]);
    const text = t.src.replace(/"[^"]*"|[^\s()"]+/g, tok => (/^(AND|OR|NOT)$/i.test(tok) ? tok.toUpperCase() : tok.startsWith('"') ? word(tok, true) : word(tok)));
    return /\s/.test(text) && !/^\(.*\)$/.test(text) ? `(${text})` : text;
  }
  if (t.kind === "raw") {
    let kept = 0;
    let text = t.src.replace(/("([^"]+)"|[^\s()"[\]]+)\s*\[([^\]]+)\]/g, m => {
      const r = regTerm(parseTerm(m), mode, warn);
      if (r) kept++;
      return r;
    });
    if (!kept) return "";
    for (let i = 0; i < 5; i++) text = text.replace(/\(\s*\)/g, "").replace(/\b(AND|OR|NOT)\s+(?=\)|$|\b(AND|OR|NOT)\b)/g, "").replace(/\(\s*(AND|OR|NOT)\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s{2,}/g, " ").trim();
    warn.add(`Complex line translated token by token, check by hand: ${t.src.slice(0, 80)}`);
    if (/^\([^()\s]+\)$|^\("[^"]*"\)$/.test(text)) text = text.slice(1, -1);
    return /\s(AND|OR|NOT)\s/.test(text) && !/^\(.*\)$/.test(text) ? `(${text})` : text;
  }
  const f = String(t.field).replace(/:~\d+$/, "");
  if (!TEXT_FIELDS.has(f)) { warn.limits.add(t.src); return ""; }
  if (f.startsWith("mesh") || f === "majr" || f === "sh") { warn.mesh.add(t.text); return word(t.text, true); }
  if (/:~\d+$/.test(t.field)) return `(${t.text.split(/\s+/).map(w => word(w)).filter(Boolean).join(" AND ")})`;
  return word(t.text, t.quoted);
}

function registerQuery(blocks, mode) {
  const warn = new Set();
  warn.trunc = new Set(); warn.mesh = new Set(); warn.limits = new Set();
  const active = blocks.filter(b => b.enabled !== false);
  const inc = active.filter(b => b.role !== "exclude")
    .map(b => [...new Set(blockTerms(b).map(l => regTerm(parseTerm(l), mode, warn)).filter(Boolean))])
    .filter(parts => parts.length).map(parts => (parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0]));
  const notes = [...warn];
  if (active.some(b => b.role === "exclude")) notes.push("Exclusion blocks (publication types, animals, …) are left out: they are bibliographic filters that do not fit register records.");
  if (warn.limits.size) notes.push(`Left out (limits and fields without a register meaning): ${[...warn.limits].slice(0, 8).join(", ")}${warn.limits.size > 8 ? " …" : ""}.`);
  if (warn.mesh.size) notes.push(`MeSH headings searched as phrases: ${[...warn.mesh].slice(0, 8).join(", ")}${warn.mesh.size > 8 ? " …" : ""}.`);
  if (warn.trunc.size) {
    notes.push(mode === "ctgov"
      ? `ClinicalTrials.gov has no truncation (* is ignored): searched as the stem, which only adds plurals and spelling variants. Write the other endings out where they matter: ${[...warn.trunc].join("; ")}.`
      : `ICTRP truncates only at the end of a single word with at least 3 characters before *; changed: ${[...warn.trunc].join("; ")}.`);
  }
  return { term: inc.join(" AND "), warnings: notes };
}

// ------------------------------------------------------------------ ClinicalTrials.gov
// Sieve blocks → { term, warnings } for query.term.
export function ctgovTranslate(blocks) {
  return registerQuery(blocks, "ctgov");
}

export function ctgovQuery(blocks) {
  return registerQuery(blocks, "ctgov").term;
}

// One page of studies with the total count. `pageToken` continues a previous page (nextPageToken).
export async function ctgovSearch(term, pageSize = 100, { pageToken = "", fields = CTGOV_FIELDS } = {}) {
  const p = new URLSearchParams({ "query.term": term, pageSize: String(Math.max(1, Math.min(1000, pageSize))), countTotal: "true", format: "json" });
  if (fields?.length) p.set("fields", fields.join(","));
  if (pageToken) p.set("pageToken", pageToken);
  const r = await fetch(`${CTGOV_API}?${p}`);
  // A query the parser cannot read gives HTTP 400 with a plain-text reason ("Error parsing query …").
  if (!r.ok) throw new Error(`ClinicalTrials.gov HTTP ${r.status}${r.status === 400 ? `: ${(await r.text()).slice(0, 200)}` : ""}`);
  const j = await r.json();
  return { count: Number(j.totalCount ?? 0), results: j.studies || [], nextPageToken: j.nextPageToken || "" };
}

export const ctgovLink = nct => `https://clinicaltrials.gov/study/${nct}`;

// A v2 study → a Sieve record. `source` is set by the caller.
export function ctgovToRecord(study) {
  const ps = study?.protocolSection || {};
  const id = ps.identificationModule || {}, st = ps.statusModule || {}, cond = ps.conditionsModule || {};
  const nct = id.nctId || "";
  const conditions = cond.conditions || [];
  const interventions = (ps.armsInterventionsModule?.interventions || []).map(i => (i.type ? `${i.name} (${i.type.toLowerCase().replace(/_/g, " ")})` : i.name)).filter(Boolean);
  const line = [conditions.length && `Conditions: ${conditions.join("; ")}.`, interventions.length && `Interventions: ${interventions.join("; ")}.`].filter(Boolean).join(" ");
  return {
    rid: nct, nct_id: nct, pmid: "", doi: "",
    title: String(id.briefTitle || id.officialTitle || "").trim(),
    abstract: [String(ps.descriptionModule?.briefSummary || "").trim(), line].filter(Boolean).join("\n\n"),
    year: String(st.startDateStruct?.date || "").slice(0, 4),
    authors: ps.sponsorCollaboratorsModule?.leadSponsor?.name || "",
    journal: "ClinicalTrials.gov registration",
    keywords: cond.keywords || [],
    link: nct ? ctgovLink(nct) : "",
    study_type: ps.designModule?.studyType || "",
    overall_status: st.overallStatus || "",
    is_register: true,
  };
}

// ------------------------------------------------------------------ WHO ICTRP
// No public API (see the top of this file): the portal URL plus a query to paste, and the steps.
export function ictrpSearchUrl(blocks) {
  const { term, warnings } = registerQuery(blocks, "ictrp");
  return {
    url: ICTRP_URL,
    advancedUrl: ICTRP_ADVANCED_URL,
    query: term,
    warnings,
    steps: [
      `Open ${ICTRP_URL} and paste the query into the search box (the portal cannot be prefilled by a link).`,
      "Record the date and the number of records found.",
      "Use \"Export results to XML\" (accept the terms of use) and keep the file with the search records.",
      "ICTRP includes ClinicalTrials.gov: remove NCT numbers already found there before screening.",
    ],
  };
}
