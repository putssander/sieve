// Read an existing document (search ticket, protocol, PICO form, proposal) and pick out what can be
// filled in without a model: the review question, PICO elements, known articles (PMIDs → validation
// set) and search-strategy tables (→ Search step). The full text is kept for the protocol assistant,
// which drafts the eligibility criteria.
//
// Pure functions (no DOM): used by the app, the command-line tool and the tests.

import { readDocx, textToBlocks, blocksToText } from "./docx.js";
import { strategyFromTable } from "./strategy.js";

export async function readDocument(name, buf, { pdfToText } = {}) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) return readDocx(buf);
  if (lower.endsWith(".pdf")) {
    if (!pdfToText) throw new Error("PDF reading is only available in the app");
    return textToBlocks((await pdfToText(buf)).text);
  }
  return textToBlocks(new TextDecoder().decode(buf));
}

const LABEL_RE = /^([A-Za-z][A-Za-z /'()&-]{1,48}?)\s*:\s*(.*)$/;
const QUESTION_RE = /^(main |primary )?(research|review)?\s*questions?$/i;
const ELEMENT_LABELS = [
  [/^(population|patients?|participants?|problem)$/i, "Population"],
  [/^(intervention|exposure|phenomenon of interest|interest)$/i, "Intervention"],
  [/^(comparison|comparator|control)$/i, "Comparison"],
  [/^(outcomes?)$/i, "Outcome"],
  [/^(context|setting)$/i, "Context"],
  [/^(concept)$/i, "Concept"],
  [/^(study design|design|study types?)$/i, "Design"],
];

export function analyzeDocument(blocks, { name = "document" } = {}) {
  // Paragraph lines (soft line breaks split), with the index of the block they came from.
  const lines = [];
  blocks.forEach((b, bi) => { if (b.type === "p") b.text.split(/\n/).map(s => s.trim()).filter(Boolean).forEach(text => lines.push({ text, bi })); });

  // ---------------------------------------------------------------- labelled sections
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(LABEL_RE);
    if (!m || /^https?$/i.test(m[1])) continue;
    sections.push({ label: m[1].trim(), first: m[2].trim(), at: i });
  }
  const sectionText = s => {
    const next = sections.find(x => x.at > s.at);
    const end = next ? next.at : lines.length;
    const body = [s.first, ...lines.slice(s.at + 1, end).filter(l => l.bi === lines[s.at].bi || sameRun(lines[s.at].bi, l.bi)).map(l => l.text)];
    return body.filter(Boolean).join("\n").trim();
  };
  // Paragraph blocks that follow each other without a table in between belong to the same run.
  const sameRun = (a, b) => blocks.slice(Math.min(a, b), Math.max(a, b) + 1).every(x => x.type === "p");

  let question = "";
  for (const s of sections.filter(x => QUESTION_RE.test(x.label))) { question = sectionText(s); if (question) break; }

  const elements = [];
  for (const s of sections) {
    const hit = ELEMENT_LABELS.find(([re]) => re.test(s.label));
    if (!hit) continue;
    const text = sectionText(s);
    if (text && !elements.some(e => e.label === hit[1])) elements.push({ label: hit[1], text });
  }

  // ---------------------------------------------------------------- known articles
  const pmids = new Map(), dois = new Map();
  const scan = (text, allowDoi) => {
    for (const ln of text.split(/\n/)) {
      const doi = (ln.match(/\b(10\.\d{4,9}\/[^\s"<>]+)/) || [])[1]?.replace(/[.,;)\]]+$/, "");
      const found = [...ln.matchAll(/\bPMID\s*:?\s*(\d{6,9})\b/gi), ...ln.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{6,9})/gi)].map(m => m[1]);
      for (const p of found) if (!pmids.has(p)) pmids.set(p, doi ? `doi:${doi}` : "");
      if (doi && allowDoi && !found.length && !dois.has(doi.toLowerCase())) dois.set(doi.toLowerCase(), doi);
    }
  };
  lines.forEach(l => scan(l.text, true));
  blocks.filter(b => b.type === "table").forEach(t => t.rows.flat().forEach(c => scan(c, false)));
  for (const [, v] of pmids) if (v) dois.delete(v.slice(4).toLowerCase());

  // ---------------------------------------------------------------- search tables
  const strategies = [];
  blocks.forEach((b, bi) => {
    if (b.type !== "table") return;
    const prev = blocks.slice(0, bi).reverse().find(x => x.type === "p");
    const title = prev ? prev.text.split(/\n/).filter(Boolean).pop().trim() : "";
    let label = title && title.length <= 100 ? title : `Table ${strategies.length + 1}`;
    if (strategies.some(s => s.name === label)) label = `${label} (${strategies.length + 1})`;
    const s = strategyFromTable(b.rows, label);
    if (s && s.lines.length) strategies.push({ ...s, source: name });
  });

  return {
    name,
    question,
    elements,
    pmids: [...pmids].map(([pmid, label]) => ({ pmid, label })),
    dois: [...dois.values()],
    strategies,
    text: blocksToText(blocks),
  };
}

// The assistant's JSON (documentImportSchema) → the same shape as analyzeDocument().
export function analysisFromAssistant(json, { name = "document", text = "" } = {}) {
  const pmids = [], dois = [];
  for (const k of json.known_articles || []) {
    const pmid = String(k.pmid || "").replace(/\D/g, "");
    const doi = String(k.doi || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").trim();
    if (/^\d{6,9}$/.test(pmid)) pmids.push({ pmid, label: k.title || (doi ? `doi:${doi}` : "") });
    else if (/^10\.\d{4,9}\//.test(doi)) dois.push(doi);
  }
  const strategies = (json.strategies || []).map((s, i) => {
    const rows = [["#", "Concept", "Search", "#results"], ...(s.lines || []).map(l => [l.n ? String(l.n) : "", l.label || "", l.query || "", l.count || ""])];
    const st = strategyFromTable(rows, s.name || `Strategy ${i + 1}`);
    return st && st.lines.length ? { ...st, database: s.database || "", source: `${name} (assistant)` } : null;
  }).filter(Boolean);
  return {
    name, text,
    question: json.question || "",
    elements: (json.elements || []).filter(e => e.text),
    criteria: (json.criteria || []).filter(c => c.label),
    pmids, dois: [...new Set(dois)],
    strategies,
    notes: json.notes || "",
  };
}

// Combine the instant analysis with the assistant's. Tables read straight from the .docx are exact,
// so they win over the assistant's copy; the assistant fills in what the rules did not find.
export function mergeAnalyses(base, ai) {
  const pm = new Map(base.pmids.map(x => [x.pmid, x]));
  ai.pmids.forEach(x => { if (!pm.has(x.pmid)) pm.set(x.pmid, x); else if (!pm.get(x.pmid).label) pm.set(x.pmid, x); });
  const doiKnown = new Set([...pm.values()].map(x => (x.label || "").replace(/^doi:/, "").toLowerCase()));
  const dois = [...new Set([...base.dois, ...ai.dois])].filter(d => !doiKnown.has(d.toLowerCase()));
  const names = new Set(base.strategies.map(s => s.name.toLowerCase()));
  return {
    ...base,
    question: ai.question || base.question,
    elements: ai.elements.length ? ai.elements : base.elements,
    criteria: ai.criteria || [],
    pmids: [...pm.values()],
    dois,
    strategies: [...base.strategies, ...ai.strategies.filter(s => !names.has(s.name.toLowerCase()) && !base.strategies.length)],
    notes: ai.notes || base.notes || "",
    assisted: true,
  };
}
