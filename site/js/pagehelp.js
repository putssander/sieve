// "Copy this page for ChatGPT": every step can be handed to a chat as one prompt (what the page is for,
// what is on it now, the user's question) and the JSON answer is pasted back into the same page.
// Steps whose fields a chat can fill (protocol, search, extraction) get a schema with those fields;
// the other steps get advice only. Pure functions: used by the UI, the Sieve GPT and the tests.

import { sourceOverlap, recallBySource, knownArticles } from "./dedup.js";
import { DECISIONS } from "./prompts.js";

const str = d => (d ? { type: "string", description: d } : { type: "string" });
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = items => ({ type: "array", items });

const ANSWER = str("your answer to the user's question about this page: practical, short, in the user's language");
const NOTES = str("anything the user should check or decide; empty if nothing");
const ARTICLE = obj({ pmid: str("digits only; never guess"), title: str() });

export const PAGES = {
  protocol: {
    title: "Protocol", purpose: "Review question, PICO/PICo/SPIDER/PCC elements, eligibility criteria (each with what happens if it fails) and extra screening rules. Everything after this step is built on it.",
    schema: obj({
      answer: ANSWER,
      question: str("improved review question, or empty to keep it"),
      elements: arr(obj({ label: str("the element label exactly as on the page, e.g. 'Population / problem'"), text: str() })),
      criteria: arr(obj({ label: str(), description: str("decidable from a title/abstract"), fail_decision: { type: "string", enum: DECISIONS.slice(1, 3) } })),
      screening_rules: str("extra screening rules to ADD, or empty"),
      notes: NOTES,
    }),
  },
  search: {
    title: "Search", purpose: "Build and test the search string. PubMed concept blocks are tested live (record count, recall on validation and hold-out articles); line-numbered database strategies (e.g. MEDLINE via Ovid) are translated to Embase, Web of Science, PsycInfo, ACM and the Cochrane Library (CENTRAL).",
    schema: obj({
      answer: ANSWER,
      blocks: arr(obj({ label: str(), role: { type: "string", enum: ["include", "exclude"] }, terms: arr(str("one PubMed term, e.g. \"machine learning\"[tiab]")) })),
      validation: arr(ARTICLE),
      holdout: arr(ARTICLE),
      notes: NOTES,
    }),
  },
  records: { title: "Records", purpose: "Import the exports of every database (RIS/CSV/PubMed), link duplicates across databases, and check recall per database against the known articles." },
  verify: { title: "Verify", purpose: "Check DOIs, titles, years and publication types against Crossref before screening." },
  fulltext: { title: "Full text", purpose: "Collect full texts: open access via Europe PMC/Unpaywall, PDFs the user adds, publisher pages via the local helper." },
  screening: { title: "Screening", purpose: "Decide per record (title/abstract, then full text) against the criteria, with model runs as a second reviewer and agreement statistics." },
  extraction: {
    title: "Extraction", purpose: "Extract data per included study with an imported form (fields, groups, answer options), with verbatim evidence quotes.",
    schema: obj({ answer: ANSWER, instructions: str("improved general extraction instructions, or empty to keep them"), notes: NOTES }),
  },
  scan: { title: "Quick scan", purpose: "A quick, AI-assisted evidence scan from a question: plan, PubMed + Europe PMC search, AI title/abstract screening, open-access full texts, extraction and a cited summary with its limitations. It can continue as a scoping or systematic review in the eight steps." },
  report: { title: "Report", purpose: "PRISMA 2020 counts and diagram, a draft methods paragraph, the search appendix and the project export." },
};

const ADVICE = obj({ answer: ANSWER, notes: NOTES });
export const pageSchema = step => PAGES[step]?.schema || ADVICE;

const cut = (s, n) => { s = String(s ?? ""); return s.length > n ? `${s.slice(0, n)}… [${s.length - n} more characters]` : s; };

// What is on the page now, as plain text.
export function pageSnapshot(step, p) {
  const S = p.search || {}, out = [];
  const known = () => [`Validation set (${S.validation?.length || 0}): ${(S.validation || []).map(v => `${v.pmid} ${cut(v.title || v.label || "", 90)}`).join("; ") || "(empty)"}`,
    `Hold-out set (${S.holdout?.length || 0}): ${(S.holdout || []).map(v => `${v.pmid} ${cut(v.title || v.label || "", 90)}`).join("; ") || "(empty)"}`];
  const protocolShort = () => [`Review question: ${p.protocol.question || "(empty)"}`, ...p.protocol.elements.map(e => `${e.key} · ${e.label}: ${e.text || "(empty)"}`)];
  switch (step) {
    case "protocol":
      out.push(`Project: ${p.name}`, ...protocolShort(), `Framework: ${p.protocol.framework} · review type: ${p.protocol.review_type}`,
        `Eligibility criteria (${p.criteria.length}):`, ...p.criteria.map((c, i) => `${i + 1}. ${c.label} [if it fails: ${c.fail_decision || "Exclude"}]: ${c.description}`),
        `Extra screening rules: ${p.screening_rules || "(none)"}`, `Notes: ${p.protocol.notes || "(none)"}`);
      for (const d of p.protocol.documents.slice(0, 2)) out.push(`--- Document "${d.name}" ---`, cut(d.text, 12000));
      break;
    case "search": {
      out.push(...protocolShort(), ...known(), `PubMed concept blocks (${S.blocks?.length || 0}):`);
      for (const b of S.blocks || []) out.push(`## ${b.label} (${b.role || "include"}${b.enabled === false ? ", off" : ""})`, ...(b.terms || []).filter(t => t.trim()));
      const L = S.last;
      if (L) out.push(`Last PubMed test (${L.date}): ${L.count} records; validation ${L.validation.found.length}/${L.validation.total}${L.holdout ? `; hold-out ${L.holdout.found.length}/${L.holdout.total}` : ""}`,
        ...[...L.validation.missed, ...(L.holdout?.missed || [])].map(x => `missed PMID ${x.pmid}: ${cut(x.title || "", 120)} (fails: ${(x.fails || []).join(", ") || "?"})`));
      for (const st of (S.strategies || []).filter(s => s.kind === "lines").slice(-2)) {
        out.push(`Database strategy "${st.name}":`, ...st.lines.map(l => `${l.deferred ? "–" : l.n} | ${l.label || ""} | ${cut(l.query, 600)}${l.count ? ` | ${l.count}` : ""}`));
      }
      if (S.versions?.length) out.push(`Saved versions: ${S.versions.map(v => `${v.name} (${v.count} records, validation ${v.recall})`).join("; ")}`);
      break;
    }
    case "records": {
      const ov = sourceOverlap(p.records);
      out.push(`${p.records.length} records imported, ${p.records.filter(r => r.duplicate_of).length} linked as duplicates.`,
        "Per database: " + (ov.map(o => `${o.source}: ${o.imported} imported, ${o.duplicates} already found, ${o.unique} only here`).join("; ") || "(none)"));
      const K = knownArticles(p);
      if (K.length && p.records.length) {
        const R = recallBySource(p.records, K);
        out.push("Recall per database: " + R.summary.map(s => `${s.source} ${s.found}/${s.total}`).join("; "),
          ...R.rows.filter(r => !Object.values(r.found).every(Boolean)).map(r => `not found everywhere: ${r.pmid || r.doi} ${cut(r.title, 100)} (missing in ${Object.entries(r.found).filter(([, v]) => !v).map(([s]) => s).join(", ")})`));
      }
      break;
    }
    case "verify":
      out.push(`${p.records.filter(r => !r.duplicate_of).length} unique records; ${Object.keys(p.resolve || {}).length} checked against Crossref.`);
      break;
    case "fulltext": {
      const ft = Object.values(p.fulltext || {});
      out.push(`${ft.filter(f => !f.failed).length} records with full text, ${ft.filter(f => f.failed).length} failed attempts.`);
      break;
    }
    case "screening": {
      const H = p.screening?.human || {}, runs = p.screening?.runs || {};
      const count = {}; Object.values(H).forEach(d => { const k = d?.decision || d; count[k] = (count[k] || 0) + 1; });
      out.push(...protocolShort(), `Criteria: ${p.criteria.map(c => c.label).join("; ") || "(none)"}`,
        `Human decisions: ${Object.entries(count).map(([k, n]) => `${k} ${n}`).join(", ") || "none yet"}`,
        `Model runs: ${Object.entries(runs).map(([id, r]) => `${id} (${r.label || ""}, ${Object.keys(r.results || {}).length} records)`).join("; ") || "none"}`);
      break;
    }
    case "extraction": {
      const ex = p.extraction || {};
      out.push(`Instructions: ${ex.instructions || "(none)"}`, `Form: ${ex.fields?.length || 0} fields`,
        ...(ex.fields || []).slice(0, 80).map(f => `- ${f.group ? `[${f.group}] ` : ""}${f.label}${f.core ? " (core)" : ""}: ${cut(f.description || "", 160)}${f.options?.length ? ` · options: ${f.options.join(" / ")}` : ""}`));
      break;
    }
    case "scan":
      out.push(...protocolShort(), `Criteria: ${p.criteria.map(c => `${c.label} (${c.description})`).join("; ") || "(none)"}`,
        `Search blocks: ${(S.blocks || []).map(b => `${b.label}: ${b.terms.join(" OR ")}`).join(" AND ") || "(none)"}`,
        `Data fields: ${(p.extraction?.fields || []).map(f => f.label).join("; ") || "(none)"}`,
        `${p.records.length} records, ${Object.keys(p.screening?.runs || {}).length} screening runs, ${Object.values(p.fulltext || {}).filter(f => !f.failed).length} full texts.`,
        p.scan?.summary ? `Summary answer: ${cut(p.scan.summary.answer, 800)}` : "No summary yet.");
      break;
    case "report":
      out.push(`${p.records.length} records, ${p.records.filter(r => r.duplicate_of).length} duplicates, ${Object.keys(p.screening?.human || {}).length} screened by a human.`);
      break;
    default: break;
  }
  return out.join("\n");
}

export function pagePrompt(step, p, question = "") {
  const page = PAGES[step] || { title: step, purpose: "" };
  const fields = Object.keys(pageSchema(step).properties);
  return `Sieve page: Step "${page.title}" of a ${p.protocol.review_type || "systematic"} review in Sieve (a browser workspace for systematic and scoping reviews).
What this step is for: ${page.purpose}

My question: ${question.trim() || "Review this page. What is missing, unclear or risky, and what should I do next?"}

Rules:
- Base your answer on the page content below; do not invent PMIDs, DOIs, counts or quotes.
- "answer": your answer to my question, short and practical.
${fields.length > 2 ? `- The other fields: only changes you recommend for this page (Sieve shows them to me before applying anything); leave them empty ("" or []) otherwise.\n` : ""}- Reply with one JSON object in a single code block: {${fields.map(f => `"${f}"`).join(", ")}}.

=== PAGE CONTENT ===
${pageSnapshot(step, p)}`;
}

// The JSON answer of a fill-in page → the shape of the "Load from document" review dialog.
export function answerToAnalysis(step, json) {
  if (step === "protocol") return { question: json.question || "", elements: json.elements || [], criteria: json.criteria || [], screening_rules: json.screening_rules || "" };
  if (step === "search") {
    const ok = a => /^\d{6,9}$/.test(String(a.pmid || ""));
    return { blocks: (json.blocks || []).filter(b => b.label && b.terms?.length), pmids: (json.validation || []).filter(ok).map(a => ({ pmid: String(a.pmid), label: a.title || "" })),
      holdout: (json.holdout || []).filter(ok).map(a => ({ pmid: String(a.pmid), label: a.title || "" })) };
  }
  if (step === "extraction") return { instructions: json.instructions || "" };
  return {};
}
