// Quick evidence scan: plan → project fields, PubMed blocks → Europe PMC, the inclusion/exclusion flow and limitations.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyScanPlan, epmcQuery, epmcToRecord, criteriaFlow, scanLimits, scanPlanPrompt, scanSummaryPrompt, summaryMarkdown, SCAN_STAGES, SCAN_EXAMPLES } from "../site/js/scan.js";

const project = () => ({
  protocol: { question: "How accurate are LLMs at title/abstract screening?", review_type: "scoping", framework: "PCC", elements: [{ key: "P", label: "Population", text: "" }] },
  criteria: [], search: { blocks: [], validation: [], holdout: [], versions: [] }, extraction: { fields: [], runs: {} }, records: [], screening: { runs: {}, human: {} },
});

const PLAN = {
  framework: "PCC", elements: [{ key: "P", text: "systematic reviews" }, { key: "C", text: "LLM screening" }, { key: "C2", text: "any field" }],
  criteria: [{ label: "LLM screens records", description: "an LLM screens titles/abstracts" }, { label: "Accuracy reported", description: "sensitivity or specificity" }],
  blocks: [{ label: "LLMs", terms: ['"large language model*"[tiab]', "Large Language Models[Mesh]"] }, { label: "Screening", terms: ["screen*[tiab]", '"systematic review*"[ti]'] }],
  fields: [{ label: "Sensitivity / recall", description: "as reported", type: "number" }, { label: "LLM(s) and version", description: "", type: "text" }, { label: "Odd", description: "", type: "date" }],
  notes: "check whether full-text screening counts",
};

test("every stage has a worked example", () => {
  for (const s of SCAN_STAGES) assert.ok(SCAN_EXAMPLES[s.id]?.length, s.id);
});

test("the plan prompt names the framework and asks for decidable criteria", () => {
  const t = scanPlanPrompt(project());
  assert.match(t, /PCC/);
  assert.match(t, /decidable from a title and abstract/);
});

test("applyScanPlan fills protocol, criteria, blocks and fields with unique ids", () => {
  const p = applyScanPlan(project(), PLAN);
  assert.deepEqual(p.protocol.elements.map(e => [e.key, e.text]), [["P", "systematic reviews"], ["C", "LLM screening"], ["C2", "any field"]]);
  assert.deepEqual(p.criteria.map(c => c.id), ["llm_screens_records", "accuracy_reported"]);
  assert.equal(p.criteria[0].fail_decision, "Exclude");
  assert.equal(p.search.blocks.length, 2);
  assert.ok(p.search.blocks.every(b => b.role === "include" && b.terms.length === 2));
  assert.deepEqual(p.extraction.fields.map(f => [f.id, f.type]), [["sensitivity_recall", "number"], ["llms_and_version", "text"], ["odd", "text"]]);
  assert.equal(p.scan.plan.notes, PLAN.notes);
});

test("applyScanPlan keeps what the user already filled in", () => {
  const p = project();
  p.protocol.elements = [{ key: "P", label: "Population", text: "my own population" }];
  p.criteria = [{ id: "mine", label: "Mine", description: "x" }];
  applyScanPlan(p, PLAN, { replace: false });
  assert.equal(p.protocol.elements[0].text, "my own population");
  assert.deepEqual(p.criteria.map(c => c.id), ["mine"]);
  assert.equal(p.search.blocks.length, 2);
});

test("PubMed blocks become a Europe PMC query", () => {
  const q = epmcQuery(applyScanPlan(project(), PLAN).search.blocks);
  assert.equal(q, '(TITLE_ABS:"large language model*" OR (MESH:"Large Language Models" OR TITLE_ABS:"Large Language Models")) AND (TITLE_ABS:screen* OR TITLE:"systematic review*") AND (SRC:PPR OR SRC:PMC)');
  assert.equal(epmcQuery([{ label: "x", role: "include", terms: ["NEAR/3(AI | machine learning ; implementation)[tiab]"] }], { sources: "" }),
    '((TITLE_ABS:(AI OR "machine learning") AND TITLE_ABS:(implementation)))');
  assert.equal(epmcQuery([]), "");
  assert.equal(epmcQuery([{ label: "years", role: "include", terms: ["2023:2025[dp]"] }, { label: "lang", role: "include", terms: ["english[la]", "review[pt]"] }], { sources: "" }),
    "(PUB_YEAR:[2023 TO 2025])");
});

test("Europe PMC results become records with their own ids", () => {
  const r = epmcToRecord({ id: "PPR912345", source: "PPR", title: "A preprint.", abstractText: "<p>Text</p>", pubYear: "2025", authorString: "Doe J, Roe K", doi: "10.1101/x" });
  assert.equal(r.rid, "PPR912345");
  assert.equal(r.title, "A preprint");
  assert.equal(r.abstract.trim(), "Text");
  assert.equal(r.is_preprint, true);
  assert.equal(epmcToRecord({ id: "123", source: "PMC", pmid: "" }).rid, "PMC123");
  assert.equal(epmcToRecord({ id: "40000001", source: "MED", pmid: "40000001" }).rid, "40000001");
});

test("criteriaFlow counts each exclusion once, at the first criterion not met", () => {
  const p = applyScanPlan(project(), PLAN);
  const [a, b] = p.criteria.map(c => c.id);
  const d = {
    1: { decision: "Include", criteria: { [a]: "Yes", [b]: "Yes" } },
    2: { decision: "Exclude", criteria: { [a]: "No", [b]: "No" } },
    3: { decision: "Exclude", criteria: { [a]: "Yes", [b]: "No" } },
    4: { decision: "Exclude", criteria: {}, reason: "Accuracy reported: none" },
    5: { decision: "Exclude", criteria: {}, reason: "conference abstract" },
    6: { decision: "Unclear", criteria: { [a]: "Unclear" } },
    7: null,
  };
  const f = criteriaFlow(p, Object.keys(d).map(rid => ({ rid })), rid => d[rid]);
  assert.deepEqual(f.rows.map(r => r.n), [1, 2, 1]);
  assert.equal(f.rows[2].label, "Other or not recorded");
  assert.equal(f.excluded, 4);
  assert.equal(f.included, 1);
  assert.equal(f.unclear, 1);
  assert.equal(f.pending, 1);
  assert.equal(f.screened, 6);
});

test("limitations follow from what was done", () => {
  const p = project();
  p.scan = { search: { date: "2026-11-10", pubmed: { count: 900, fetched: 200 }, europepmc: { count: 50, fetched: 50 } } };
  const l = scanLimits(p, { screened: 230, humanChecked: 0, selected: 20, withText: 12 }).join(" ");
  assert.match(l, /200 most relevant of 900 PubMed/);
  assert.doesNotMatch(l, /Europe PMC records were screened/);
  assert.match(l, /without a human check/);
  assert.match(l, /12 of 20 selected papers/);
});

test("summary prompt and markdown cite by paper id", () => {
  const p = applyScanPlan(project(), PLAN);
  p.records = [{ rid: "14", title: "GPT-4 screening", authors: "Smith A, Jones B", year: "2024", journal: "J X", doi: "10.1/abc" }];
  const t = scanSummaryPrompt(p, [{ rid: "14", cite: "Smith 2024. GPT-4 screening.", lines: ["Sensitivity / recall: 0.91"] }]);
  assert.match(t, /=== PAPER \[14\] ===/);
  assert.match(t, /Do not call this a systematic review/);
  p.scan.summary = { answer: "Recall is high [14].", findings: [{ statement: "Sensitivity 0.91", paper_ids: ["14"] }], agreement: "", gaps: ["few studies"], next_steps: [] };
  const md = summaryMarkdown(p, { identified: 10, duplicates: 1, screened: 9, humanChecked: 0, selected: 1, withText: 1 }, { screened: 9, excluded: 8, rows: [{ label: "Accuracy reported", n: 8 }] });
  assert.match(md, /not a systematic or rapid review/);
  assert.match(md, /DRAFT: the summary has not been checked/);
  assert.match(md, /\[14\] Smith 2024\. GPT-4 screening\. J X\. https:\/\/doi\.org\/10\.1\/abc/);
  assert.match(md, /Accuracy reported: 8/);
});

test("fingerprints change with the input that matters, and only then", async () => {
  const { hashKey, scanKeys } = await import("../site/js/scan.js");
  assert.equal(hashKey("abc"), hashKey("abc"));
  assert.notEqual(hashKey("abc"), hashKey("abd"));
  const p = applyScanPlan(project(), PLAN);
  const r = { rid: "1", title: "Writing groups for PhD students", abstract: "We studied a writing group." };
  const k = scanKeys.screen(p, r);
  assert.equal(scanKeys.screen(p, { ...r }), k, "same record and criteria → same key");
  p.criteria[0].description += " (edited)";
  assert.notEqual(scanKeys.screen(p, r), k, "edited criterion → new key");
  const fields = p.extraction.fields;
  assert.notEqual(scanKeys.extract(p, r, "text A", fields), scanKeys.extract(p, r, "text B", fields), "other full text → new key");
  assert.notEqual(scanKeys.search("q", "e", { pubmed: 30, europepmc: 10 }), scanKeys.search("q", "e", { pubmed: 60, europepmc: 10 }), "other number of records → new key");
});

test("the published example scans hold answers and ids only, no abstracts or full texts", async () => {
  const { readFile } = await import("node:fs/promises");
  const idx = JSON.parse(await readFile(new URL("../site/examples/scans/index.json", import.meta.url), "utf8"));
  assert.ok(idx.length >= 1);
  for (const e of idx) {
    const c = JSON.parse(await readFile(new URL(`../site/examples/scans/${e.id}.json`, import.meta.url), "utf8"));
    assert.equal(c.format, "sieve-scan-example");
    assert.ok(Object.keys(c.answers).length > 10);
    assert.ok(c.search.pubmed.ids.length > 0);
    const s = JSON.stringify(c);
    assert.doesNotMatch(s, /ABSTRACT:|FULL_TEXT_EXCERPT:/);
  }
});

test("calibration sample: 20%, at least 10, at most 50, fixed per project", async () => {
  const { calibrationSample } = await import("../site/js/scan.js");
  const ids = n => Array.from({ length: n }, (_, i) => String(i + 1));
  assert.equal(calibrationSample(ids(7), "p").length, 7);
  assert.equal(calibrationSample(ids(32), "p").length, 10);
  assert.equal(calibrationSample(ids(100), "p").length, 20);
  assert.equal(calibrationSample(ids(1000), "p").length, 50);
  assert.deepEqual(calibrationSample(ids(100), "p"), calibrationSample(ids(100), "p"));
  assert.notDeepEqual(calibrationSample(ids(100), "p"), calibrationSample(ids(100), "q"));
});

test("Cohen's kappa", async () => {
  const { kappa } = await import("../site/js/scan.js");
  assert.equal(kappa([[true, true], [false, false], [true, true], [false, false]]), 1);
  assert.equal(kappa([]), null);
  // 20 pairs: 8 both keep, 8 both exclude, 2 + 2 disagree → po 0.8, pe 0.5 → κ 0.6
  const pairs = [...Array(8).fill([true, true]), ...Array(8).fill([false, false]), ...Array(2).fill([true, false]), ...Array(2).fill([false, true])];
  assert.ok(Math.abs(kappa(pairs) - 0.6) < 1e-9);
});

test("limitations and disclosure reflect the human checks and cite the guidance", async () => {
  const { aiUseDisclosure } = await import("../site/js/scan.js");
  const p = project();
  p.scan = { search: { date: "2026-11-10", pubmed: { count: 30, fetched: 30 }, europepmc: { count: 2, fetched: 2 } }, press: { items: { question: true, syntax: true } } };
  const l = scanLimits(p, { screened: 32, humanChecked: 32, selected: 7, withText: 5, extractChecked: 7, calibration: { n: 10, kappa: 0.62, missed: 1 } }).join(" ");
  assert.match(l, /one person made every final decision/);
  assert.match(l, /κ = 0\.62 \(below the 0\.8/);
  assert.match(l, /2 of 6 PRESS elements/);
  assert.match(l, /every value was checked against the source/);
  assert.match(l, /No risk-of-bias/);
  const d = aiUseDisclosure({ plan: { model: "m1", approved: "2026-11-10" }, screen: { models: ["m1"], n: 32, checked: 32, changed: 3, calibration: { n: 10, kappa: 0.9, missed: 0 } },
    extract: { models: ["m1"], n: 7, checked: 7, changed: 2 }, summary: { model: "m1", approved: "" } }).join(" ");
  assert.match(d, /32 final decisions made by the author, of which 3 differ/);
  assert.match(d, /not yet checked by the author \(draft\)/);
  assert.match(d, /prompt/);
});

test("go deeper: the route follows the purpose, and each route lists what its guidance still asks", async () => {
  const { goDeeperAdvice } = await import("../site/js/scan.js");
  const p = applyScanPlan(project(), PLAN);
  p.id = "x"; p.protocol.purpose = "map"; p.scan.plan.approved = "2026-11-10";
  p.records = [{ rid: "1", source: "PubMed (scan)" }];
  let a = goDeeperAdvice(p, { selected: 2, withText: 1, calibration: { n: 10, kappa: 0.7 } });
  assert.equal(a.recommended, "scoping");
  assert.ok(a.reasons.some(r => /Only 2 papers/.test(r)) && a.reasons.some(r => /κ = 0\.70/.test(r)));
  assert.deepEqual(a.routes.map(r => r.id), ["systematic", "rapid", "scoping"]);
  assert.ok(a.routes.every(r => r.items.every(i => i.src?.url && i.href.startsWith("#/p/x/"))));
  assert.equal(a.routes.find(r => r.id === "rapid").items.find(i => /two bibliographic/.test(i.text)).done, false);
  p.records.push({ rid: "2", source: "Embase" });
  p.protocol.purpose = "answer";
  a = goDeeperAdvice(p, { selected: 7, withText: 7 });
  assert.equal(a.recommended, "systematic");
  assert.equal(a.routes.find(r => r.id === "rapid").items.find(i => /two bibliographic/.test(i.text)).done, true);
});

test("methods: every step compares all routes and cites a source with a link", async () => {
  const { METHODS, ROUTES } = await import("../site/js/methods.js");
  for (const m of METHODS) {
    assert.ok(m.method.every(([src]) => src?.url?.startsWith("http")), m.id);
    for (const row of m.compare || []) assert.equal(row.length, ROUTES.length + 1, `${m.id}: ${row[0]}`);
  }
  assert.ok(METHODS.find(m => m.id === "scan"));
});
