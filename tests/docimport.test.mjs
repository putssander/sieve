import { test } from "node:test";
import assert from "node:assert/strict";
import { readDocx, blocksToText } from "../site/js/docx.js";
import { analyzeDocument, analysisFromAssistant, mergeAnalyses, readDocument } from "../site/js/docimport.js";
import { documentImportPrompt, documentImportSchema, translationPrompt, translationSchema } from "../site/js/prompts.js";
import { translateStrategy, formatTranslation, TARGETS } from "../site/js/strategy.js";
import { makeDocx, ticketXml, TICKET_ROWS } from "./fixtures.mjs";

const docx = makeDocx(ticketXml());

test("reads paragraphs and tables from a .docx", async () => {
  const blocks = await readDocx(docx);
  const tables = blocks.filter(b => b.type === "table");
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].rows[1], TICKET_ROWS[1]);
  assert.ok(!blocks.some(b => b.type === "p" && b.text.includes("\t")), "tab-stop definitions are not text");
  assert.match(blocksToText(blocks), /Concept\tSearch\t#results/);
});

test("finds question, PICO, known articles and strategies in a ticket", async () => {
  const a = analyzeDocument(await readDocx(docx), { name: "ticket.docx" });
  assert.match(a.question, /^1\. Which factors .*\n2\. Which frameworks are used to study it\?$/);
  assert.deepEqual(a.elements.map(e => e.label), ["Population", "Outcome"]);
  assert.deepEqual(a.pmids, [{ pmid: "33782057", label: "doi:10.1136/bmj.n71" }]);
  assert.deepEqual(a.dois, ["10.1000/preprint.123"]);
  assert.deepEqual(a.strategies.map(s => [s.name, s.kind, s.lines.length]), [["V2 – MEDLINE via Ovid", "lines", 16], ["Translations", "by-database", 2]]);
});

test("plain text documents work too", async () => {
  const txt = new TextEncoder().encode("Review question: Does AI help nurses?\nPMID: 12345678\n");
  const a = analyzeDocument(await readDocument("notes.txt", txt), { name: "notes.txt" });
  assert.equal(a.question, "Does AI help nurses?");
  assert.equal(a.pmids[0].pmid, "12345678");
});

test("copy-paste route: prompt in, JSON back, merged with the quick scan", async () => {
  const quick = analyzeDocument(await readDocx(docx), { name: "ticket.docx" });
  const prompt = documentImportPrompt(quick.text, "ticket.docx");
  assert.match(prompt, /Return JSON/);
  assert.match(prompt, /exp Artificial Intelligence\//);
  assert.deepEqual(Object.keys(documentImportSchema.properties), ["question", "elements", "criteria", "known_articles", "strategies", "notes"]);

  // What a chat answer looks like (shape of documentImportSchema).
  const answer = {
    question: "Which factors affect AI implementation?",
    elements: [{ label: "Population", text: "Healthcare organisations" }],
    criteria: [{ label: "Empirical", description: "Reports primary data.", fail_decision: "Exclude" }, { label: "Not a review", description: "Reviews are mined for references.", fail_decision: "Exclude, but save for snowballing" }],
    known_articles: [{ pmid: "33782057", doi: "", title: "PRISMA 2020" }, { pmid: "", doi: "https://doi.org/10.1000/other.1", title: "" }, { pmid: "not known", doi: "", title: "x" }],
    strategies: [{ name: "V2 – MEDLINE via Ovid", database: "MEDLINE (Ovid)", lines: [{ n: 1, label: "AI", query: "exp Artificial Intelligence/", count: "" }] }],
    notes: "Line 15 refers to a limit without a number.",
  };
  const ai = analysisFromAssistant(answer, { name: "ticket.docx" });
  assert.deepEqual(ai.pmids, [{ pmid: "33782057", label: "PRISMA 2020" }]);
  assert.deepEqual(ai.dois, ["10.1000/other.1"]);
  const m = mergeAnalyses(quick, ai);
  assert.equal(m.question, answer.question);
  assert.equal(m.criteria.length, 2);
  assert.equal(m.pmids.length, 1);
  assert.deepEqual(m.dois.sort(), ["10.1000/other.1", "10.1000/preprint.123"]);
  assert.equal(m.strategies[0].lines.length, 16, "the exact .docx table wins over the assistant's copy");
  assert.equal(m.assisted, true);
});

test("translation prompt carries all drafts and the schema covers all databases", async () => {
  const st = analyzeDocument(await readDocx(docx)).strategies[0];
  const drafts = Object.keys(TARGETS).map(t => { const r = translateStrategy(st, t); return { target: t, label: r.label, text: formatTranslation(r), single: r.single, warnings: r.warnings }; });
  const p = translationPrompt(st, drafts, ["Artificial Intelligence"]);
  for (const t of Object.keys(TARGETS)) assert.match(p, new RegExp(`=== DRAFT: ${t} `));
  assert.deepEqual(translationSchema.properties.databases.items.properties.database.enum, Object.keys(TARGETS));
});
