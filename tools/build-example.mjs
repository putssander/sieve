#!/usr/bin/env node
// Builds the public example project (site/examples/llm-screening.json) from public sources only:
// PubMed + Europe PMC records, abstracts only for open-access (CC-licensed) records, no full texts.
// Reproducible: the record IDs, queries and search date are frozen in examples/llm-screening.config.json;
// --refresh runs the queries again (then the example runs must be redone). Open-access full texts with a CC
// licence that allows redistribution (no ND) are embedded, converted with the app's own jats.js, so the
// prompts here are byte-identical to what the app builds. Example runs (real model outputs) come from
// examples/runs/<screening|extraction>-<name>/; the exact prompts are written next to them.
//   node tools/build-example.mjs [--refresh]      (needs network)
import { writeFile, readFile, readdir, mkdir } from "node:fs/promises";
import { emptyProject } from "../site/js/store.js";
import { dedupe } from "../site/js/dedup.js";
import { jatsToText, jatsHasBody } from "../site/js/jats.js";
import * as P from "../site/js/prompts.js";

const ROOT = new URL("..", import.meta.url).pathname;
const get = async url => { const r = await fetch(url, { headers: { "user-agent": "sieve-example-builder/0.1" } }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
const TOPIC = '("large language model*"[tiab] OR ChatGPT[tiab] OR GPT-4[tiab] OR "GPT-3.5"[tiab]) AND (screening[tiab] OR "title and abstract"[tiab]) AND ("systematic review*"[tiab] OR "literature review*"[tiab]) AND 2023:2025[dp]';

const CFG_URL = new URL("../examples/llm-screening.config.json", import.meta.url);
const cfg = JSON.parse(await readFile(CFG_URL, "utf8"));
const epmc = async q => (await get(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=100&query=${encodeURIComponent(q)}`)).resultList.result;
if (process.argv.includes("--refresh")) {
  const es = await get(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=30&sort=relevance&tool=sieve&term=${encodeURIComponent(cfg.pubmed_query)}`);
  cfg.pubmed_pmids = es.esearchresult.idlist;
  cfg.europepmc_pmids = (await epmc(cfg.europepmc_query)).slice(0, 40).map(x => x.pmid).filter(Boolean);
  cfg.search_date = new Date().toISOString().slice(0, 10);
  await writeFile(CFG_URL, JSON.stringify(cfg, null, 1));
}
// Records in the frozen order (Europe PMC metadata for both sources; SRC:MED = PubMed records).
const byIds = async ids => { const got = await epmc(`(${ids.map(id => `EXT_ID:${id}`).join(" OR ")}) AND SRC:MED`); return ids.map(id => got.find(x => x.pmid === id)).filter(Boolean); };
const pubmed = await byIds(cfg.pubmed_pmids);
const second = await byIds(cfg.europepmc_pmids);

const toRecord = (x, source) => {
  const ji = x.journalInfo || {};
  const open = /^cc/i.test(x.license || "") || x.isOpenAccess === "Y";
  return { title: (x.title || "").replace(/\.$/, ""), authors: x.authorString || "", year: String(ji.yearOfPublication || x.pubYear || ""), journal: ji.journal?.title || "",
    journal_abbr: ji.journal?.isoabbreviation || "", volume: ji.volume || "", issue: ji.issue || "", pages: x.pageInfo || "", doi: (x.doi || "").toLowerCase(),
    pmid: x.pmid || "", pmcid: x.pmcid || "", abstract: open ? (x.abstractText || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "", license: x.license || "", source };
};
const p = emptyProject("Example: LLMs for title/abstract screening");
p.id = "example-llm-screening";
p.example = true;
p.description = "Public example project: PubMed and Europe PMC records on large language models for title/abstract screening in systematic reviews. Abstracts only for open-access records; example model runs are real copy-paste outputs.";
p.protocol = { ...p.protocol, review_type: "systematic", framework: "PICO", notes: "Example project for trying Sieve. The records are real; the review itself was not carried out.",
  question: "How accurate are large language models (LLMs) at title/abstract screening for systematic reviews, compared with human reviewers?",
  elements: [
    { key: "P", label: "Population / problem", text: "Records (titles and abstracts) from systematic or scoping review searches." },
    { key: "I", label: "Intervention / exposure", text: "Screening by a large language model (e.g. GPT-3.5, GPT-4, Claude, Llama), any prompting approach." },
    { key: "C", label: "Comparison", text: "Human reviewers' screening decisions (reference standard)." },
    { key: "O", label: "Outcome", text: "Sensitivity (recall), specificity, workload saving." },
  ] };
p.criteria = [
  { id: "llm_screening", label: "LLM screens records", description: "A large language model makes or suggests include/exclude decisions on titles/abstracts (or full texts) of a review.", fail_decision: "Exclude" },
  { id: "human_reference", label: "Compared with humans", description: "The LLM's decisions are compared with human screening decisions as reference standard.", fail_decision: "Exclude" },
  { id: "accuracy_reported", label: "Accuracy reported", description: "Sensitivity/recall and/or specificity (or the counts to compute them) are reported.", fail_decision: "Exclude" },
  { id: "original_study", label: "Original study", description: "Primary evaluation study; not a review, commentary or tutorial.", fail_decision: "Exclude, but save for snowballing" },
];
p.search.blocks = [
  { id: "llm", label: "Large language models", role: "include", terms: ['"large language model*"[tiab]', "ChatGPT[tiab]", "GPT-4[tiab]", '"GPT-3.5"[tiab]', "Large Language Models[Mesh]"] },
  { id: "screen", label: "Screening", role: "include", terms: ["screening[tiab]", '"title and abstract"[tiab]', '"citation screening"[tiab]'] },
  { id: "review", label: "Evidence synthesis", role: "include", terms: ['"systematic review*"[tiab]', '"literature review*"[tiab]', "Systematic Reviews as Topic[Mesh]"] },
  { id: "years", label: "Publication years", role: "include", terms: ["2023:2025[dp]"] },
];
p.search.notes = `Example searches run on ${cfg.search_date}; PubMed and Europe PMC queries in examples/llm-screening.config.json.`;
p.search.validation = [
  { pmid: "37989538", label: "Enhancing title and abstract screening for systematic reviews with GPT-3.5 turbo" },
  { pmid: "38976267", label: "Performance of a Large Language Model in Screening Citations" },
  { pmid: "38214966", label: "Automated Paper Screening for Clinical Reviews Using Large Language Models" },
];
p.search.holdout = [
  { pmid: "39151163", label: "Human-Comparable Sensitivity of Large Language Models in Identifying Eligible Studies Through Title and Abstract Screening" },
  { pmid: "40119675", label: "High-performance automated abstract screening with large language model ensembles" },
];
p.search.strategies = [{ id: "st-example-ovid", name: "MEDLINE (Ovid), example", kind: "lines", imported: "example", lines: [
  { n: 1, label: "LLM heading", query: "Large Language Models/", count: null },
  { n: 2, label: "LLM free text", query: '("large language model*" or LLM or LLMs or ChatGPT or "GPT-4" or "GPT-3.5").ti,ab,kf.', count: null },
  { n: 3, label: "LLM", query: "1 or 2", count: null },
  { n: 4, label: "Screening", query: '(screening or "title and abstract" or "citation screening").ti,ab,kf.', count: null },
  { n: 5, label: "Review heading", query: "exp Systematic Reviews as Topic/", count: null },
  { n: 6, label: "Review free text", query: '("systematic review*" or "literature review*").ti,ab,kf.', count: null },
  { n: 7, label: "Review", query: "5 or 6", count: null },
  { n: 8, label: "Combined", query: "3 and 4 and 7", count: null },
  { n: 9, label: "Years", query: 'limit 8 to yr="2023-2025"', count: null },
] }];
let rid = 1;
p.records = [...pubmed.map(x => toRecord(x, "PubMed")), ...second.map(x => toRecord(x, "Europe PMC"))].map(r => ({ ...r, rid: String(rid++) }));
// Open-access records whose search result lacks the abstract: take it from the open-access full text.
for (const r of p.records.filter(x => !x.abstract && x.pmcid)) {
  try {
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`);
    if (!res.ok) continue;
    const abs = ((await res.text()).match(/<abstract[^>]*>([\s\S]*?)<\/abstract>/) || [])[1];
    if (abs) r.abstract = abs.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  } catch { /* keep without abstract */ }
}
const d = dedupe(p.records);
// Embedded open-access full texts (CC licences that allow redistribution, no ND), converted like the app does.
for (const r of p.records.filter(x => !x.duplicate_of && x.pmcid && /^cc[ -]?by/i.test(x.license) && !/nd/i.test(x.license))) {
  try {
    const res = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${r.pmcid}/fullTextXML`);
    if (!res.ok) continue;
    const xml = await res.text();
    if (!jatsHasBody(xml)) continue;
    const text = jatsToText(xml);
    p.fulltext[r.rid] = { method: "europepmc-oa", source_url: `https://europepmc.org/article/PMC/${r.pmcid}`, license: r.license, chars: text.length, text };
  } catch { /* leave for step 5 */ }
}
p.extraction.fields = [
  { id: "llms", label: "LLM(s) and version", group: "Method", core: true, description: "Models evaluated, with version", options: ["GPT-3.5", "GPT-4", "Claude", "Llama"] },
  { id: "prompting", label: "Prompting approach", group: "Method", core: true, description: "Zero-shot, few-shot, criteria in prompt, chain of thought, ensembles", options: [] },
  { id: "dataset", label: "Review(s) / dataset", group: "Data", core: true, description: "Which reviews or datasets were screened", options: [] },
  { id: "n_records", label: "Records screened", group: "Data", core: false, description: "Number of records screened by the LLM", options: [] },
  { id: "sensitivity", label: "Sensitivity / recall", group: "Results", core: true, description: "Best or main result", options: [] },
  { id: "specificity", label: "Specificity", group: "Results", core: true, description: "Best or main result", options: [] },
  { id: "workload", label: "Workload saving", group: "Results", core: false, description: "Reported reduction in records to screen by humans", options: [] },
];
p.extraction.instructions = "Report the main (headline) result for the best-performing configuration; other configurations under notes. Use 'NR' when not reported.";
// Example runs (real outputs) from examples/runs/<run>/<rid>.json, if present.
try {
  const dir = new URL("../examples/runs/", import.meta.url);
  const prompts = {};
  for (const run of await readdir(dir)) {
    const [kind, ...rest] = run.split("-");
    const results = {};
    for (const f of (await readdir(new URL(`${run}/`, dir))).filter(f => f.endsWith(".json"))) {
      const j = JSON.parse(await readFile(new URL(`${run}/${f}`, dir), "utf8"));
      const items = j.results || [j];
      for (const x of items) results[String(x.id)] = x;
      // The exact prompt for this answer, built with the app's code (what "Copy prompt" gives for these papers).
      const promptText = examplePrompt(kind, items.map(x => String(x.id)));
      await writeFile(new URL(`${run}/${f.replace(/\.json$/, ".prompt.txt")}`, dir), promptText);
      // Published with the site so anyone can paste the same prompt into their own chat and compare.
      const pub = `examples/prompts/${run}/${f.replace(/\.json$/, ".prompt.txt")}`;
      await mkdir(new URL(`../site/examples/prompts/${run}/`, import.meta.url), { recursive: true });
      await writeFile(new URL(`../site/${pub}`, import.meta.url), promptText);
      (prompts[run] ||= []).push({ ids: items.map(x => String(x.id)), file: pub });
    }
    const meta = { label: `Example run: Claude (copy-paste route)`, model: "claude-opus-5-5", backend: "copy-paste", date: "2026-11-10", results, prompts: prompts[run] || [] };
    if (kind === "screening") p.screening.runs[rest.join("-") || run] = { ...meta, stage: "ta" };
    if (kind === "extraction") p.extraction.runs[rest.join("-") || run] = meta;
  }
} catch { /* no example runs */ }
function examplePrompt(kind, ids) {
  const recs = ids.map(id => p.records.find(r => r.rid === id));
  if (kind === "screening") return P.screeningPrompt(p, recs.map(r => ({ source: P.sourceBlock(r, "") })), {});
  const r = recs[0], all = P.applicableFields(p, r);
  return P.extractionPrompt(p, [{ source: P.sourceBlock(r, p.fulltext[r.rid]?.text || "", 40000), coreOnly: all.length < p.extraction.fields.length }], P.modelFields(all), {});
}
await mkdir(new URL("../site/examples/", import.meta.url), { recursive: true });
await writeFile(new URL("../site/examples/llm-screening.json", import.meta.url), JSON.stringify(p, null, 1));
await writeFile(new URL("../site/examples/index.json", import.meta.url), JSON.stringify([{ file: "llm-screening.json", name: p.name, description: p.description }], null, 1));
console.log(`search date ${cfg.search_date}; full texts embedded ${Object.keys(p.fulltext).length}; records ${p.records.length} (PubMed ${pubmed.length}, Europe PMC ${second.length}; duplicates linked ${d.linked}), abstracts ${p.records.filter(r => r.abstract).length}, OA (pmcid) ${p.records.filter(r => r.pmcid).length}, screening runs ${Object.keys(p.screening.runs).length}, extraction runs ${Object.keys(p.extraction.runs).length}`);
