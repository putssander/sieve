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
  rec("2", "PubMed", { pmid: "11111111", title: "Implementing AI in hospitals: a qualitative study" }),
  rec("3", "Embase", { doi: "10.1136/BMJ.N71", title: "The PRISMA 2020 statement: an updated guideline." }),         // same DOI (case)
  rec("4", "Embase", { title: "Implementing AI in hospitals - a qualitative study" }),                                // same title after normalising
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
