import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dedupeRecords, nearDuplicates, sourceOverlap, recallBySource, knownArticles, guessSource } from "../site/js/dedup.js";
import { PAGES, pagePrompt, pageSchema, answerToAnalysis } from "../site/js/pagehelp.js";
import { gptInstructions, gptKnowledge, gptReadme, GPT_INSTRUCTIONS_LIMIT } from "../site/js/gpt.js";
import { listModels, suggestModel, chatSite } from "../site/js/llm.js";

const rec = (rid, source, o) => ({ rid, source, title: "", year: "2024", ...o });
const records = () => [
  rec("1", "PubMed", { pmid: "33782057", doi: "10.1136/bmj.n71", title: "The PRISMA 2020 statement: an updated guideline" }),
  rec("2", "PubMed", { pmid: "11111111", authors: "Jones A", journal: "BMJ Open", title: "Implementing AI in hospitals: a qualitative study" }),
  rec("3", "Embase", { doi: "10.1136/BMJ.N71", title: "The PRISMA 2020 statement: an updated guideline." }),         // same DOI (case)
  rec("4", "Embase", { authors: "Jones, Anna", journal: "BMJ open", title: "Implementing AI in hospitals - a qualitative study" }), // rule A after normalising
  rec("5", "Web of Science", { title: "Implementing artificial intelligence in hospitals: a qualitative study", year: "2025" }), // near duplicate
  rec("6", "Web of Science", { doi: "10.1000/only.wos", title: "Something only Web of Science has" }),
  rec("7", "ACM DL", { title: "Sociotechnical barriers to clinical decision support", year: "2023" }),
];

test("dedup across databases: DOI, PMID, title + year; first import kept", () => {
  const R = records();
  assert.equal(dedupeRecords(R), 2);
  assert.equal(R[2].duplicate_of, "1");
  assert.equal(R[3].duplicate_of, "2");
  assert.equal(R[4].duplicate_of, undefined);
  assert.equal(dedupeRecords(R), 2, "running again gives the same result");
});

test("near duplicates are proposed, decisions are kept", () => {
  const R = records(); dedupeRecords(R);
  const pairs = nearDuplicates(R, { threshold: 0.6 });
  assert.ok(pairs.some(x => [x.a, x.b].sort().join() === "2,5"), JSON.stringify(pairs));
  R[4].duplicate_of = "2"; R[4].dup_manual = "dup";
  dedupeRecords(R);
  assert.equal(R[4].duplicate_of, "2", "a manual link survives a new dedup run");
});

test("overlap per database", () => {
  const R = records(); dedupeRecords(R);
  const o = Object.fromEntries(sourceOverlap(R).map(x => [x.source, x]));
  assert.deepEqual(o.Embase, { source: "Embase", imported: 2, duplicates: 2, unique: 0 });
  assert.deepEqual(o["Web of Science"], { source: "Web of Science", imported: 2, duplicates: 0, unique: 2 });
  assert.equal(o.PubMed.unique, 0, "both PubMed records were also found in Embase");
});

test("recall per database against validation and hold-out articles", () => {
  const project = { search: { validation: [{ pmid: "33782057", label: "The PRISMA 2020 statement: an updated guideline", doi: "10.1136/bmj.n71" }],
    holdout: [{ pmid: "", label: "", title: "Sociotechnical barriers to clinical decision support" }] } };
  const K = knownArticles(project);
  const R = recallBySource(records(), K);
  const by = Object.fromEntries(R.summary.map(s => [s.source, s]));
  assert.equal(by.PubMed.found, 1);
  assert.equal(by.Embase.found, 1, "found by DOI although Embase has no PMID");
  assert.equal(by["Web of Science"].found, 0);
  assert.equal(by["ACM DL"].holdout, 1, "found by title");
  assert.equal(R.anywhere, 2);
});

test("database guessed from the export", () => {
  assert.equal(guessSource("savedrecs.ris"), "Web of Science");
  assert.equal(guessSource("export.ris", "TY  - JOUR\nDB  - Embase\n"), "Embase");
  assert.equal(guessSource("psycinfo_2026.ris"), "PsycInfo");
  assert.equal(guessSource("acm.bib.ris"), "ACM DL");
});

const project = () => ({
  name: "Test", protocol: { question: "Does AI help nurses?", framework: "PICO", review_type: "scoping", notes: "", elements: [{ key: "P", label: "Population / problem", text: "nurses" }], documents: [] },
  criteria: [{ id: "c1", label: "Empirical", description: "Primary data", fail_decision: "Exclude" }], screening_rules: "",
  search: { blocks: [{ id: "a", label: "AI", role: "include", terms: ['"machine learning"[tiab]'] }], validation: [{ pmid: "33782057", label: "PRISMA" }], holdout: [], strategies: [], versions: [] },
  records: records(), resolve: {}, fulltext: {}, screening: { runs: {}, human: {} }, extraction: { fields: [{ id: "f", label: "Country", description: "where" }], instructions: "", runs: {} },
});

test("every step has a page prompt with its content and a JSON schema", () => {
  const p = project();
  for (const step of Object.keys(PAGES)) {
    const pr = pagePrompt(step, p, "What next?");
    assert.match(pr, /=== PAGE CONTENT ===/);
    assert.match(pr, /What next\?/);
    const schema = pageSchema(step);
    assert.ok(schema.required.includes("answer"), step);
    for (const f of schema.required) assert.match(pr, new RegExp(`"${f}"`), `${step}: ${f} named in the prompt`);
  }
  assert.match(pagePrompt("protocol", p), /Does AI help nurses\?/);
  assert.match(pagePrompt("search", p), /"machine learning"\[tiab\]/);
  assert.match(pagePrompt("search", p), /Validation set \(1\): 33782057/);
  assert.match(pagePrompt("records", p), /Recall per database: PubMed 1\/1/);
  assert.match(pagePrompt("extraction", p), /Country: where/);
});

test("page answers become reviewable changes; invented PMIDs are dropped", () => {
  const a = answerToAnalysis("search", { answer: "x", blocks: [{ label: "Nurses", role: "include", terms: ["nurs*[tiab]"] }, { label: "empty", role: "include", terms: [] }],
    validation: [{ pmid: "12345678", title: "A" }, { pmid: "unknown", title: "B" }], holdout: [{ pmid: "87654321", title: "C" }], notes: "" });
  assert.equal(a.blocks.length, 1);
  assert.deepEqual(a.pmids, [{ pmid: "12345678", label: "A" }]);
  assert.equal(a.holdout.length, 1);
  assert.deepEqual(answerToAnalysis("records", { answer: "ok", notes: "" }), {});
});

test("Sieve GPT: instructions fit ChatGPT's limit, knowledge has every schema, gpt/ is up to date", async () => {
  const ins = gptInstructions();
  assert.ok(ins.length <= GPT_INSTRUCTIONS_LIMIT, `${ins.length} characters`);
  assert.match(ins, /Copy this page for ChatGPT/);
  const k = gptKnowledge();
  for (const t of ["documentImportSchema", "translationSchema"]) assert.ok(k.length > 2000, t);
  assert.match(k, /"databases"/);
  assert.match(k, /Web of Science Core Collection/);
  assert.equal(await readFile(new URL("../gpt/instructions.md", import.meta.url), "utf8"), ins, "run: node tools/build-gpt.mjs");
  assert.equal(await readFile(new URL("../gpt/knowledge.md", import.meta.url), "utf8"), k, "run: node tools/build-gpt.mjs");
  assert.equal(await readFile(new URL("../gpt/README.md", import.meta.url), "utf8"), gptReadme(), "run: node tools/build-gpt.mjs");
});

test("model lists come from the provider, newest first", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, headers: opts?.headers || {} });
    const body = /anthropic/.test(url)
      ? { data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-09-01T00:00:00Z" }, { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z" }, { id: "claude-opus-4-8", created_at: "2026-01-01T00:00:00Z" }], has_more: false }
      : { data: [{ id: "text-embedding-3-large", created: 1 }, { id: "gpt-old", created: 10 }, { id: "gpt-9", created: 30 }, { id: "gpt-9-mini", created: 31 }, { id: "whisper-1", created: 40 }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const a = await listModels({ kind: "anthropic", apiKey: "k" });
  assert.deepEqual(a.map(m => m.id), ["claude-opus-5-5", "claude-haiku-5-5", "claude-opus-4-8"]);
  assert.equal(calls[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(suggestModel("anthropic", a), "claude-opus-5-5");
  const o = await listModels({ kind: "openai", apiKey: "k" });
  assert.deepEqual(o.map(m => m.id), ["gpt-9-mini", "gpt-9", "gpt-old"], "embeddings/whisper filtered out");
  assert.equal(suggestModel("openai", o), "gpt-9", "flagship over mini");
  assert.equal(chatSite({ chat: "chatgpt", gptUrl: "https://chatgpt.com/g/g-x" }).url, "https://chatgpt.com/g/g-x");
});

import { checkRun, agreement, sameValue } from "../site/js/extractcheck.js";
test("extraction runs are checked: completeness, verified quotes, core-only, agreement", () => {
  const fields = [{ id: "f1", label: "F1", core: true }, { id: "model", label: "Model", core: true }, { id: "country", label: "Country", core: false }];
  const p = { extraction: { fields, core_until_year: 2020 }, records: [{ rid: "1", title: "Old paper", year: "2019", abstract: "" }, { rid: "2", title: "New paper", year: "2024", abstract: "We used BERT." }] };
  const texts = { 1: "The SVM model reached an F1 of 0.89 on the test set.", 2: "Our BERT model achieved F1 = 0.91 in the Netherlands." };
  const A = { results: {
    1: { id: "1", fields: { f1: { value: "0.89", quote: "an F1 of 0.89" }, model: { value: "SVM", quote: "The SVM model reached" }, country: { value: "USA", quote: "" } } },
    2: { id: "2", fields: { f1: { value: "91%", quote: "F1 = 0.91" }, model: { value: "BERT", quote: "We used BERT." }, country: { value: "NLD", quote: "invented quote" } } } } };
  const c = checkRun(p, A, texts).total;
  assert.equal(c.papers, 2);
  assert.equal(c.expected, 5, "core-only paper: 2 fields, other paper: 3");
  assert.equal(c.verified, 4, "quotes found in the full text or abstract");
  assert.equal(c.unverified, 1);
  assert.equal(c.extra, 1, "core-only paper got a non-core value");
  const B = { results: { 1: { fields: { f1: { value: "89%" }, model: { value: "Support vector machine" } } }, 2: { fields: { f1: { value: "0.91" }, model: { value: "BERT" }, country: { value: "NR" } } } } };
  const g = agreement(p, A, B);
  assert.equal(g.compared, 5);
  assert.equal(g.same, 3, "0.89 = 89%, 91% = 0.91, BERT = BERT; SVM vs Support vector machine and NLD vs NR differ");
  assert.ok(sameValue("0.845", "84.5%"));
  assert.ok(!sameValue("0.845", "0.81"));
});

import { recordValue, modelFields } from "../site/js/prompts.js";
test("bibliographic fields come from the record, also without a DOI", () => {
  const F = l => ({ id: l.toLowerCase(), label: l });
  const rec = { doi: "10.2196/71949", authors: "Kopacheva E, Henriksson A, Dalianis H.", year: "2025", pmid: "1" };
  assert.equal(recordValue(F("doi"), rec), "10.2196/71949");
  assert.equal(recordValue(F("doi"), { pmid: "32308902" }), "PMID 32308902", "AMIA proceedings have no DOI");
  assert.equal(recordValue({ id: "auteur_s", label: "Auteur(s)" }, rec), "Kopacheva E et al.");
  assert.equal(recordValue({ id: "publicatiejaar", label: "Publicatiejaar" }, rec), "2025");
  assert.equal(recordValue(F("Land"), rec), null);
  assert.deepEqual(modelFields([F("doi"), { id: "auteur_s", label: "Auteur(s)" }, F("Land")]).map(f => f.id), ["land"]);
});

import { isPreprintDoi, publishedFromEuropePmc, usePublishedVersion } from "../site/js/preprint.js";
test("preprints are recognised and replaced by the published version", () => {
  assert.equal(isPreprintDoi("10.48550/arXiv.2104.10791"), "arXiv");
  assert.equal(isPreprintDoi("https://doi.org/10.1101/2025.03.28.25324847"), "bioRxiv/medRxiv");
  assert.equal(isPreprintDoi("10.2196/71949"), "");
  // Europe PMC: the preprint record itself (PPR) is skipped; the AMIA proceedings record carries the arXiv DOI.
  const results = [{ source: "PPR", title: "Extracting Adverse Drug Events from Clinical Notes", journalInfo: { journal: { title: "arXiv" } } },
    { source: "MED", pmid: "34457157", pmcid: "PMC8378605", doi: "10.48550/arxiv.2104.10791", title: "Extracting Adverse Drug Events from Clinical Notes.",
      pageInfo: "420-429", journalInfo: { yearOfPublication: 2021, journal: { title: "AMIA Joint Summits on Translational Science proceedings" } } }];
  const pub = publishedFromEuropePmc(results, "Extracting Adverse Drug Events from Clinical Notes");
  assert.deepEqual([pub.pmid, pub.pmcid, pub.doi, pub.year, pub.pages], ["34457157", "PMC8378605", "", "2021", "420-429"]);
  const r = usePublishedVersion({ rid: "27", doi: "10.48550/arxiv.2104.10791", year: "2021" }, pub);
  assert.equal(r.preprint_doi, "10.48550/arxiv.2104.10791");
  assert.equal(r.doi, "");
  assert.equal(r.link, "https://pmc.ncbi.nlm.nih.gov/articles/PMC8378605/");
  assert.match(r.version_note, /Published version used \(AMIA/);
});

import { mergeProject } from "../site/js/store.js";
test("updating a project from a newer file keeps the work done in the browser", () => {
  const base = () => ({ records: [{ rid: "1", title: "A" }, { rid: "2", title: "B", duplicate_of: "1", dup_manual: "dup" }], fulltext: { 1: { chars: 10 } },
    screening: { human: { 1: { decision: "Exclude", note: "mine" } }, human_ft: {}, runs: {} }, criteria: [{ id: "c1", label: "mine" }],
    protocol: { question: "My question" }, extraction: { fields: [{ id: "f" }], instructions: "my rule", runs: { a: { results: { 1: {} } } }, human: { 1: { f: "verified" } } } });
  const cur = base();
  const inc = { records: [{ rid: "1", title: "A (fixed)" }, { rid: "2", title: "B" }, { rid: "3", title: "C" }], fulltext: { 2: { chars: 20 }, 3: { chars: 30 } },
    screening: { human: { 1: { decision: "Include" }, 3: { decision: "Include" } }, human_ft: { 3: { decision: "Include" } } },
    criteria: [{ id: "c1", label: "theirs" }, { id: "c2", label: "new" }], protocol: { question: "Other" },
    extraction: { fields: [{ id: "f" }, { id: "g" }], instructions: "their rule", runs: { b: { results: { 3: {} } } } } };
  const m = mergeProject(cur, inc);
  assert.equal(m.records.length, 3);
  assert.equal(m.records[0].title, "A (fixed)");
  assert.equal(m.records[1].duplicate_of, "1", "manual duplicate link kept");
  assert.deepEqual(Object.keys(m.fulltext).sort(), ["1", "2", "3"]);
  assert.equal(m.screening.human[1].decision, "Exclude", "your decision wins");
  assert.equal(m.screening.human[3].decision, "Include");
  assert.deepEqual(m.criteria.map(c => c.label), ["mine", "new"]);
  assert.equal(m.protocol.question, "My question");
  assert.equal(m.extraction.instructions, "my rule");
  assert.deepEqual(Object.keys(m.extraction.runs).sort(), ["a", "b"]);
  assert.equal(m.extraction.human[1].f, "verified");
  assert.deepEqual(cur, base(), "the current project object is not modified");
});

import { locate, highlightHtml, fragmentUrl, sourceUrl } from "../site/js/evidence.js";
test("evidence quotes are found and highlighted despite PDF line breaks and hyphenation", () => {
  const text = "Results\nThe SVM model achieved an F1-\nscore of 89.1% on the test\n  data, using “gold” entities.\nOther text.";
  const q = "The SVM model achieved an F1-score of 89.1% on the test data";
  const at = locate(text, q);
  assert.ok(at, "found across line breaks and the hyphenated line end");
  assert.ok(text.slice(at.start, at.end).startsWith("The SVM") && text.slice(at.start, at.end).endsWith("data"));
  assert.ok(locate(text, 'using "gold" entities'), "straight vs curly quotes");
  assert.ok(locate(text, "The SVM model … on the test data"), "ellipsis between parts");
  assert.equal(locate(text, "a sentence that is not there"), null);
  const { html, found } = highlightHtml(text, [{ quote: q, label: "F1" }, { quote: "not there at all" }]);
  assert.deepEqual(found, [0]);
  assert.match(html, /<mark class="ev" data-ev="0" title="F1">The SVM/);
  const two = highlightHtml(text, [{ quote: q, label: "run A" }, { quote: "achieved an F1-score of 89.1%", label: "run B" }]);
  assert.deepEqual(two.found.sort(), [0, 1], "overlapping quotes are both found");
  assert.match(two.html, /data-ev="0 1" title="run A \| run B"/);
  assert.equal(fragmentUrl("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/", "achieved an F1-score of 89.1%"),
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/#:~:text=achieved%20an%20F1%2Dscore%20of%2089.1%25");
  assert.equal(fragmentUrl("https://x.org/a#top", "one two three four five six seven eight nine ten"),
    "https://x.org/a#:~:text=one%20two%20three%20four,seven%20eight%20nine%20ten");
  assert.equal(sourceUrl({ pmcid: "PMC9", doi: "10.1/x" }), "https://pmc.ncbi.nlm.nih.gov/articles/PMC9/");
  assert.equal(sourceUrl({ doi: "10.1/x", link: "https://x.org/a.pdf" }), "https://doi.org/10.1/x");
});

import { matchPdf, isPdf } from "../site/js/pdfmatch.js";
test("downloaded PDFs are matched to their paper by content, not file name", () => {
  const recs = [{ rid: "52", doi: "10.1016/j.jbi.2021.103968", title: "An attentive joint model with transformer-based weighted graph convolutional network" },
    { rid: "45", doi: "10.1016/j.imu.2025.101701", title: "Text-based approach for detecting cases of ADEs from EHRs" }];
  assert.equal(matchPdf("1-s2.0-S1532046421002975-main.pdf", "Journal of Biomedical Informatics https://doi.org/10.1016/j.jbi.2021.103968", recs).rid, "52");
  assert.equal(matchPdf("download.pdf", "Text-based approach for detecting cases of ADEs from EHRs of participants", recs).rid, "45");
  assert.equal(matchPdf("45.pdf", "Some other paper entirely about something else", recs).rid, null, "a wrong file name is caught");
  assert.equal(matchPdf("52.pdf", "doi 10.1016/j.jbi.2021.103968", recs).rid, "52");
  assert.equal(isPdf(new TextEncoder().encode("%PDF-1.7 ...")), true);
  assert.equal(isPdf(new TextEncoder().encode("<!DOCTYPE html><html>")), false, "a saved web page is rejected");
});

import { METHODS, SOURCES, methodsMarkdown } from "../site/js/methods.js";
test("methods page: every step has guidance with a source and a Sieve status; docs/methods.md is up to date", async () => {
  for (const id of ["protocol", "search", "records", "verify", "fulltext", "screening", "extraction", "report"]) assert.ok(METHODS.some(s => s.id === id), id);
  for (const s of METHODS) {
    assert.ok(s.method.length && s.method.every(([src, t]) => src?.url?.startsWith("https://") && t), s.id);
    assert.ok(s.sieve.every(([st]) => ["done", "partly", "missing"].includes(st)), s.id);
  }
  assert.ok(Object.values(SOURCES).every(x => x.cite && x.url));
  assert.equal(await readFile(new URL("../docs/methods.md", import.meta.url), "utf8"), methodsMarkdown(), "run: node tools/build-methods.mjs");
});

import { jatsToText } from "../site/js/jats.js";
test("JATS full text keeps paragraph boundaries (no glued words) and drops references and figures", () => {
  const xml = `<article><front><article-meta><title-group><article-title>LLM screening</article-title></title-group><abstract><p>We tested GPT-4.</p></abstract></article-meta></front>
<body><sec><title>Results</title><p>Sensitivity was 0.95.</p><p>Specificity was 0.80 &amp; stable.</p><fig><caption>Figure 1</caption></fig>
<table-wrap><table><tr><td>Recall</td><td>0.95</td></tr></table></table-wrap></sec></body><back><ref-list><ref>Cited paper</ref></ref-list></back></article>`;
  const t = jatsToText(xml);
  assert.match(t, /^LLM screening\n\nWe tested GPT-4\.\n\nResults\n\nSensitivity was 0\.95\.\n\nSpecificity was 0\.80 & stable\./);
  assert.match(t, /Recall 0\.95/);
  assert.doesNotMatch(t, /Figure 1|Cited paper/);
});

import { migrateSettings, DEFAULT_SETTINGS } from "../site/js/store.js";
test("no hardcoded OpenAI model; the old built-in default is cleared, a chosen model is kept", () => {
  assert.equal(DEFAULT_SETTINGS.backends.find(b => b.kind === "openai").model, "");
  const s = migrateSettings({ backends: [{ kind: "openai", model: "gpt-5.5" }, { kind: "openai", model: "gpt-5.5", modelChosen: true }, { kind: "anthropic", model: "claude-opus-5-5" }] });
  assert.deepEqual(s.backends.map(b => b.model), ["", "gpt-5.5", "claude-opus-5-5"]);
});

test("the version shown in the app matches sieve/__init__.py", async () => {
  const py = await readFile(new URL("../sieve/__init__.py", import.meta.url), "utf8");
  const v = JSON.parse(await readFile(new URL("../site/version.json", import.meta.url), "utf8"));
  assert.equal(v.version, py.match(/__version__\s*=\s*"([^"]+)"/)[1]);
  const { versionText } = await import("../site/js/version.js");
  assert.equal(versionText({ version: "0.2.0", commit: "5f099df", built: "2026-11-10T19:58Z" }), "Sieve 0.2.0 · 5f099df · built 2026-11-10 19:58 UTC");
});
