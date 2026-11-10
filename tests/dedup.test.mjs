// The deduplication method (docs/deduplication.md): Bramer et al. 2016, rows A-G, plus Sieve's DOI/PMID
// passes and safeguards. Every record set below is synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupe, normPages, firstAuthor, journalKeys, titleNorm } from "../site/js/dedup.js";
import { parseRis, parseMedline, parseExport } from "../site/js/bibparse.js";

const rec = (rid, o) => ({ rid, source: "x", ...o });
const run = (records, opts) => { const r = dedupe(records, opts); return { ...r, link: Object.fromEntries(records.filter(x => x.duplicate_of).map(x => [x.rid, [x.duplicate_of, x.dup_rule]])) }; };

test("page numbers are normalised the way the method requires", () => {
  assert.equal(normPages("1008-12").key, "1008-1012");            // MEDLINE / Cochrane abbreviation
  assert.equal(normPages("1008–1012 5p").key, "1008-1012");       // CINAHL appends the length
  assert.equal(normPages("pp. 240-3").key, "240-243");
  assert.equal(normPages("240", "243").key, "240-243");           // RIS SP + EP
  assert.equal(normPages("e71838").weak, true);                    // e-locator: letter
  assert.equal(normPages("1-10").weak, true);                      // starts with 1 (correction 2017)
  assert.equal(normPages("240").weak, true);                       // single page
  assert.equal(normPages("240-243").weak, false);
  assert.equal(normPages("").key, "");
});

test("authors, titles and journal names compare across databases", () => {
  for (const a of ["Bramer, Wichor M.; Giustini, D.", "Bramer WM, Giustini D", "W.M. Bramer; D. Giustini", "Brämer, W"]) assert.equal(firstAuthor(a), "bramer", a);
  assert.equal(titleNorm("[De-duplication of database search results.]"), titleNorm("De-duplication of database search results"));
  const full = journalKeys({ journal: "Journal of the Medical Library Association" }), abbr = journalKeys({ journal: "J Med Libr Assoc" });
  assert.ok(full.some(k => abbr.includes(k)), `${full} / ${abbr}`);
  assert.ok(journalKeys({ issn: "1536-5050 (Print)" }).includes("issn:15365050"));
  assert.ok(journalKeys({ journal: "BMJ" }).some(k => journalKeys({ journal: "British Medical Journal" }).includes(k)));
  assert.ok(!journalKeys({ journal: "Nature" }).some(k => journalKeys({ journal: "Nature Medicine" }).includes(k)));
});

const paper = { title: "De-duplication of database search results for systematic reviews in EndNote", year: "2016", volume: "104", issue: "3" };

test("A: author + year + title + journal links automatically (full vs. abbreviated journal, abbreviated pages)", () => {
  const R = [rec("1", { ...paper, authors: "Bramer WM", journal: "J Med Libr Assoc", pages: "240-3", source: "PubMed" }),
    rec("2", { ...paper, authors: "Bramer, Wichor M.", journal: "Journal of the Medical Library Association", pages: "240-243", source: "Embase" })];
  assert.deepEqual(run(R).link, { 2: ["1", "A"] });
});

test("B: author + year + title + pages when the journal differs or is missing", () => {
  const R = [rec("1", { ...paper, authors: "Bramer WM", journal: "JMLA", pages: "240-243" }), rec("2", { ...paper, authors: "Bramer W", journal: "", pages: "240-3" })];
  assert.deepEqual(run(R).link, { 2: ["1", "B"] });
});

test("C: title + volume + pages links years that differ (online first vs. print)", () => {
  const R = [rec("1", { ...paper, authors: "Bramer WM", year: "2015", pages: "240-243" }), rec("2", { ...paper, authors: "Bramer WM", year: "2016", pages: "240-243" })];
  assert.deepEqual(run(R).link, { 2: ["1", "C"] });
});

test("C, correction 2017: pages missing or starting with 1 go to review", () => {
  const R = [rec("1", { ...paper, authors: "Smith J", year: "2015", pages: "1-8" }), rec("2", { ...paper, authors: "Smith J", year: "2016", pages: "1-8" })];
  const r = run(R);
  assert.deepEqual(r.link, {});
  assert.equal(r.review[0].rule, "C");
  assert.match(r.review[0].reason, /starting with 1/);
});

test("D and E: author or year + volume + issue + pages catch translated or garbled titles", () => {
  const D = [rec("1", { title: "Deduplizierung von Suchergebnissen", authors: "Bramer WM", year: "2016", volume: "104", pages: "240-243" }),
    rec("2", { title: "[Deduplication of search results]", authors: "Bramer WM", year: "2017", volume: "104", pages: "240-3" })];
  assert.deepEqual(run(D).link, { 2: ["1", "D"] });
  const E = [rec("1", { title: "Ein langer deutscher Titel über Suchen", authors: "Bramer WM", year: "2016", volume: "104", issue: "3", pages: "240-243" }),
    rec("2", { title: "A long English title about searching", authors: "Bramer, W", year: "2016", volume: "104", issue: "3", pages: "240-3" })];
  assert.equal(run(E).link[2][0], "1");
  const weak = [rec("1", { title: "Letter one about something", year: "2016", volume: "104", issue: "3", pages: "e12" }), rec("2", { title: "Another letter here entirely", year: "2016", volume: "104", issue: "3", pages: "e12" })];
  const w = run(weak);
  assert.deepEqual(w.link, {});
  assert.equal(w.review[0].rule, "E");
});

test("F: same title only → review, with the page check as the reason", () => {
  const R = [rec("1", { ...paper, authors: "", pages: "240-243" }), rec("2", { ...paper, authors: "", volume: "", pages: "512-520" })];
  const r = run(R);
  assert.deepEqual(r.link, {});
  assert.equal(r.review[0].rule, "F");
  assert.match(r.review[0].reason, /different pages/);
});

test("G: same first author, year and pages with different titles → review", () => {
  const R = [rec("1", { title: "Searching for systematic reviews part one", authors: "Bramer WM", year: "2016", pages: "240-243", volume: "" }),
    rec("2", { title: "Completely different wording of the same paper", authors: "Bramer W", year: "2016", pages: "240-243", volume: "" })];
  const r = run(R);
  assert.deepEqual(r.link, {});
  assert.equal(r.review.find(x => x.rule === "G")?.b, "2");
});

test("Sieve: DOI and PMID first, with a title guard for errata and wrong DOIs", () => {
  const R = [rec("1", { ...paper, doi: "10.3163/1536-5050.104.3.014" }), rec("2", { title: "Something else", doi: "https://doi.org/10.3163/1536-5050.104.3.014".replace("https://doi.org/", "") }),
    rec("3", { ...paper, doi: "10.3163/1536-5050.104.3.014".toUpperCase() }), rec("4", { ...paper, pmid: "27366130" }), rec("5", { title: "De-duplication of database search results for systematic reviews in EndNote.", pmid: "27366130" })];
  const r = run(R);
  assert.deepEqual(r.link[3], ["1", "doi"]);
  assert.deepEqual(r.link[5], ["4", "pmid"]);
  assert.equal(r.link[2], undefined, "same DOI but a different title is not linked");
  assert.ok(r.review.some(x => x.rule === "doi" && x.b === "2"));
});

test("short generic titles are never linked on title alone", () => {
  const R = [rec("1", { title: "Reply", authors: "Smith J", year: "2020", journal: "BMJ", pages: "m100-m101" }), rec("2", { title: "Reply", authors: "Smith J", year: "2020", journal: "BMJ", pages: "m200-m201" })];
  const r = run(R);
  assert.deepEqual(r.link, {});
  assert.equal(r.review[0].reason, "short title, different pages");
});

test("decisions are kept: different pairs stay apart, manual links stay, copied fields are undone", () => {
  const R = [rec("1", { ...paper, authors: "Bramer WM", journal: "J Med Libr Assoc" }), rec("2", { ...paper, authors: "Bramer WM", journal: "J Med Libr Assoc", doi: "10.1/x" })];
  run(R);
  assert.equal(R[0].doi, "10.1/x", "missing DOI copied into the kept record");
  run(R, { distinct: ["1|2"] });
  assert.equal(R[1].duplicate_of, undefined);
  assert.equal(R[0].doi, undefined, "copy undone when the pair is marked different");
  const M = [rec("1", { title: "A study of things in places" }), rec("2", { title: "Unrelated", duplicate_of: "1", dup_manual: "dup" })];
  run(M);
  assert.equal(M[1].duplicate_of, "1");
  assert.equal(run(R.map(x => ({ ...x })), {}).linked, 1, "running again gives the same result");
});

test("the first imported record is kept, chains resolve to it", () => {
  const R = [rec("1", { ...paper, authors: "Bramer WM", journal: "J Med Libr Assoc", pages: "240-3", source: "PubMed" }),
    rec("2", { ...paper, authors: "Bramer W", journal: "", pages: "240-243", source: "Embase" }),
    rec("3", { ...paper, authors: "Bramer WM", journal: "Journal of the Medical Library Association", source: "WoS" })];
  const r = run(R);
  assert.equal(r.linked, 2);
  assert.ok(!R[0].duplicate_of);
});

test("exports: RIS keeps volume/issue/pages/ISSN/journal names; MEDLINE (.nbib) is read", () => {
  const ris = `TY  - JOUR\nAU  - Bramer, Wichor M.\nTI  - De-duplication of database search results\nT2  - Journal of the Medical Library Association\nJ2  - J Med Libr Assoc\nPY  - 2016\nVL  - 104\nIS  - 3\nSP  - 240\nEP  - 243\nSN  - 1536-5050\nDO  - https://doi.org/10.3163/1536-5050.104.3.014\nDB  - Embase\nAN  - 611234567\nER  - \n`;
  const [r] = parseRis(ris);
  assert.deepEqual([r.journal, r.journal_abbr, r.volume, r.issue, r.pages, r.issn, r.doi, r.pmid], ["Journal of the Medical Library Association", "J Med Libr Assoc", "104", "3", "240-243", "1536-5050", "10.3163/1536-5050.104.3.014", ""]);
  const nbib = `PMID- 27366130\nOWN - NLM\nIS  - 1558-9439 (Electronic)\nVI  - 104\nIP  - 3\nDP  - 2016 Jul\nTI  - De-duplication of database search results for systematic reviews in\n      EndNote.\nPG  - 240-3\nLID - 10.3163/1536-5050.104.3.014 [doi]\nFAU - Bramer, Wichor M\nAU  - Bramer WM\nFAU - Giustini, Dean\nTA  - J Med Libr Assoc\nJT  - Journal of the Medical Library Association : JMLA\n\nPMID- 12345678\nTI  - Second record\nDP  - 2020\n`;
  const m = parseMedline(nbib);
  assert.equal(m.length, 2);
  assert.equal(m[0].title, "De-duplication of database search results for systematic reviews in EndNote.");
  assert.deepEqual([m[0].pmid, m[0].year, m[0].volume, m[0].issue, m[0].pages, m[0].doi, m[0].journal_abbr], ["27366130", "2016", "104", "3", "240-3", "10.3163/1536-5050.104.3.014", "J Med Libr Assoc"]);
  assert.equal(firstAuthor(m[0].authors), "bramer");
  assert.equal(parseExport(nbib).length, 2);
  assert.equal(parseExport(ris).length, 1);
  // Both exports of the same paper are one record after dedup (PubMed abbreviated pages vs. Embase full pages).
  const R = [{ ...m[0], rid: "1", source: "PubMed" }, { ...r, rid: "2", source: "Embase", title: "De-duplication of database search results for systematic reviews in EndNote" }];
  assert.equal(dedupe(R).linked, 1);
});

import { fitText } from "../site/js/prompts.js";
test("full texts fit the prompt budget without losing the results", () => {
  const intro = Array.from({ length: 60 }, (_, i) => `Introduction paragraph ${i} about adverse drug events in clinical notes and why they matter.`).join("\n\n");
  const results = "Table 3. Relation extraction results: precision 0.91, recall 0.87, F1 0.89 (micro-averaged).";
  const refs = "\n\nReferences\n\n" + Array.from({ length: 80 }, (_, i) => `${i}. Author A. Some cited paper. J Biomed Inform. 2020;${i}:1-10.`).join("\n");
  const full = `Abstract: we extract drug-ADE relations.\n\n${intro}\n\n${results}\n\nDiscussion paragraph.${refs}`;
  const fit = fitText(full, 3000);
  assert.ok(fit.length <= 3100, `${fit.length}`);
  assert.match(fit, /^Abstract: we extract/);
  assert.match(fit, /F1 0\.89/, "the results paragraph beyond the cut is kept");
  assert.doesNotMatch(fit, /Some cited paper/, "reference list dropped");
  assert.match(fit, /\[…\]/);
  assert.equal(fitText("short text", 1000), "short text");
});
