// Methods gaps filled: risk of bias, certainty (GRADE / CERQual), a second human reviewer, reporting checklists.
import test from "node:test";
import assert from "node:assert/strict";
import { ROB_TOOLS, robSchema, robPrompt, robComplete, robSummary, robAgreement, suggestTool, levelOf } from "../site/js/rob.js";
import { gradeLevel, GRADE_DOWN, footnotes, sofMarkdown, certaintySchema, certaintyApproach } from "../site/js/certainty.js";
import { blindCopy, decisionsFile, mergeDecisions, compareScreening, resolveScreening, compareExtraction, resolveExtraction, secondDone } from "../site/js/team.js";
import { CHECKLISTS, checklistRows, checklistMarkdown, checklistsFor } from "../site/js/reporting.js";
import { scanLimits, goDeeperAdvice } from "../site/js/scan.js";

const project = () => ({
  id: "p1", name: "Test", protocol: { question: "Does exercise reduce falls in older adults? A randomised trial question", framework: "PICO", elements: [{ key: "P", label: "Population", text: "older adults" }], review_type: "systematic", purpose: "answer" },
  criteria: [{ id: "pop", label: "Older adults", description: "65+" }],
  search: { blocks: [], versions: [], validation: [], holdout: [] },
  records: [{ rid: "1", title: "A", abstract: "x" }, { rid: "2", title: "B", abstract: "y" }, { rid: "3", title: "C", abstract: "z" }],
  fulltext: {}, resolve: {},
  screening: { runs: { gpt: { results: { 1: { decision: "Include" } } } }, human: { 1: { decision: "Include" }, 2: { decision: "Exclude", reason: "Older adults" }, 3: { decision: "Include" } }, human_ft: {} },
  extraction: { fields: [{ id: "n", label: "Sample size" }], runs: { gpt: { results: {} } }, human: { 1: { n: "120" }, 3: { n: "80" } } },
  scan: { plan: { approved: "2026-11-11" }, search: { date: "2026-11-11" }, summary: { answer: "x" } },
});

test("risk of bias: overall rules follow the published tools", () => {
  const rob2 = ROB_TOOLS.rob2;
  assert.equal(rob2.domains.length, 5);
  assert.equal(rob2.overall({ D1: "low", D2: "low", D3: "low", D4: "low", D5: "low" }), "low");
  assert.equal(rob2.overall({ D1: "low", D2: "some", D3: "low", D4: "low", D5: "low" }), "some");
  assert.equal(rob2.overall({ D1: "high", D2: "some", D3: "low", D4: "low", D5: "low" }), "high");
  assert.equal(rob2.overall({ D1: "low" }), "low", "only domains given are combined; robComplete checks completeness");
  const ri = ROB_TOOLS.robinsI;
  assert.equal(ri.domains.length, 7);
  assert.equal(ri.overall({ D1: "moderate", D2: "low", D3: "low", D4: "low", D5: "low", D6: "low", D7: "low" }), "moderate");
  assert.equal(ri.overall({ D1: "serious", D2: "ni", D3: "low", D4: "low", D5: "low", D6: "low", D7: "low" }), "serious");
  assert.equal(ri.overall({ D1: "moderate", D2: "ni", D3: "low", D4: "low", D5: "low", D6: "low", D7: "low" }), "ni");
  // QUADAS-2 has no three-level overall: low only if all low, otherwise "at risk of bias".
  const q = ROB_TOOLS.quadas2;
  assert.equal(q.overall({ D1: "low", D2: "low", D3: "low", D4: "low" }), "low");
  assert.equal(q.overall({ D1: "low", D2: "unclear", D3: "low", D4: "low" }), "atrisk");
  assert.equal(levelOf(q, "atrisk", true).label, "At risk of bias");
  // JBI 2024 qualitative checklist: Yes / No / Unclear only; overall include / exclude / seek further info is a decision.
  const j = ROB_TOOLS.jbiQual;
  assert.deepEqual(j.levels.map(l => l.id), ["yes", "no", "unclear"]);
  assert.equal(j.domains.length, 10);
  assert.equal(j.overall({}), null);
  assert.equal(ROB_TOOLS.probastAI.overall({ D1: "high" }), null, "PROBAST+AI: no unverified combination rule");
  for (const t of Object.values(ROB_TOOLS)) assert.ok(t.cite && t.url && t.levels.every(l => l.sym && l.label), t.id);
});

test("risk of bias: schema, prompt, completeness, summary and agreement", () => {
  const p = project();
  const t = ROB_TOOLS.rob2;
  const sch = robSchema(t);
  assert.deepEqual(Object.keys(sch.properties.domains.properties), ["D1", "D2", "D3", "D4", "D5"]);
  assert.deepEqual(sch.properties.domains.properties.D1.properties.judgement.enum, ["low", "some", "high"]);
  assert.ok(robSchema(ROB_TOOLS.quadas2).properties.applicability, "QUADAS-2 asks for applicability");
  assert.match(robPrompt(p, t, p.records[0], "full text"), /PAPER_ID: 1[\s\S]*FULL_TEXT_EXCERPT/);
  assert.equal(robComplete(t, { domains: { D1: "low", D2: "low", D3: "low", D4: "low" } }), false);
  assert.equal(robComplete(t, { domains: { D1: "low", D2: "low", D3: "low", D4: "low", D5: "high" } }), true);
  assert.equal(robComplete(ROB_TOOLS.jbiQual, { domains: Object.fromEntries(ROB_TOOLS.jbiQual.domains.map(d => [d.id, "yes"])) }), false, "JBI needs the overall decision");
  const sum = robSummary(t, [{ domains: { D1: "low" } }, { domains: { D1: "high" } }]);
  assert.deepEqual(sum[0].n, { low: 1, some: 0, high: 1 });
  assert.deepEqual(robAgreement(t, { domains: { D1: "low", D2: "some" } }, { domains: { D1: "low", D2: "high" } }), { n: 2, same: 1, diff: ["D2"] });
  assert.equal(suggestTool(p), "rob2");
  assert.equal(suggestTool({ ...p, protocol: { ...p.protocol, question: "How do PhD students experience writing groups?", framework: "PICo" } }), "jbiQual");
});

test("certainty: GRADE levels, the ROBINS-I start, footnotes and the summary-of-findings table", () => {
  assert.equal(gradeLevel("rct", {}), "high");
  assert.equal(gradeLevel("rct", { imprecision: "serious", risk_of_bias: "serious" }), "low");
  assert.equal(gradeLevel("observational", {}), "low");
  assert.equal(gradeLevel("observational", { inconsistency: "very_serious" }), "very_low", "never below very low");
  assert.equal(gradeLevel("observational", {}, { large_effect: 2 }), "high");
  assert.equal(gradeLevel("nrs_robins", { risk_of_bias: "very_very_serious" }), "very_low", "GRADE 18: three levels down for risk of bias");
  assert.ok(GRADE_DOWN.find(d => d.id === "risk_of_bias").options.includes("very_very_serious"));
  const a = { final: "low", explanation: "Two small studies.", down: { imprecision: { rating: "serious", reason: "few events" }, risk_of_bias: { rating: "not_serious" } }, up: {} };
  assert.deepEqual(footnotes("grade", a), ["Imprecision: serious (−1). few events"]);
  const md = sofMarkdown("grade", [{ finding: "Falls reduced", paper_ids: ["1", "3"], a }]);
  assert.match(md, /\| Falls reduced \| 2 \| ⊕⊕◯◯ Low \^1\^ \| Two small studies\. \|/);
  assert.match(md, /1\. Imprecision: serious/);
  assert.ok(certaintySchema("cerqual").properties.results.items.properties.components.properties.adequacy);
  assert.equal(certaintyApproach({ protocol: { framework: "PICo" } }), "cerqual");
});

test("second reviewer: blind copy, decisions file, κ, consensus", () => {
  const p = project();
  const copy = blindCopy(p, "Reviewer B", { screening: ["1", "2", "3"], extraction: ["1", "3"] }, { id: "copy" });
  assert.equal(copy.id, "copy");
  assert.deepEqual(copy.screening.human, {}, "no first-reviewer decisions");
  assert.deepEqual(copy.screening.runs, {}, "no AI suggestions");
  assert.deepEqual(copy.extraction.human, {});
  assert.equal(copy.scan.summary, undefined);
  assert.equal(copy.records.length, 3);
  assert.equal(p.screening.human[1].decision, "Include", "the original is untouched");
  copy.screening.human = { 1: { decision: "Include" }, 2: { decision: "Include" }, 3: { decision: "Exclude", reason: "Older adults" } };
  copy.extraction.human = { 1: { n: "120" }, 3: { n: "85" } };
  const file = decisionsFile(copy);
  assert.equal(file.project, "p1");
  assert.equal(JSON.stringify(file).includes('"title"'), false, "ids and judgements only");
  const res = mergeDecisions(p, file);
  assert.deepEqual([res.reviewer, res.screening, res.extraction, res.sameProject], ["Reviewer B", 3, 2, true]);
  const c = compareScreening(p, "Reviewer B", ["1", "2", "3"]);
  assert.equal(c.n, 3);
  assert.deepEqual(c.conflicts, ["2", "3"]);
  assert.ok(c.kappa < 0.5);
  resolveScreening(p, "3", "Reviewer B", "Exclude");
  assert.equal(p.screening.human[3].decision, "Exclude");
  assert.equal(p.screening.human[3].first, "Include");
  assert.equal(p.screening.human[3].reason, "Older adults", "the reason comes with the colleague's exclusion");
  assert.deepEqual(compareScreening(p, "Reviewer B", ["1", "2", "3"]).open, ["2"]);
  const e = compareExtraction(p, "Reviewer B", ["1", "3"], p.extraction.fields);
  assert.deepEqual([e.compared, e.same, e.conflicts.length], [2, 1, 1]);
  resolveExtraction(p, "3", "n", "85");
  assert.equal(compareExtraction(p, "Reviewer B", ["1", "3"], p.extraction.fields).conflicts.length, 0);
  assert.equal(secondDone(p, "screening", ["1", "2", "3"]), true);
  assert.throws(() => mergeDecisions(p, { format: "x" }), /Not a Sieve decisions file/);
});

test("reporting checklists: verified items, filled from the project", () => {
  assert.equal(CHECKLISTS.prisma2020.items.length, 42);
  assert.equal(new Set(CHECKLISTS.prisma2020.items.map(i => i.id.replace(/[a-f]$/, ""))).size, 27);
  assert.equal(CHECKLISTS.prismaS.items.length, 16);
  assert.equal(CHECKLISTS.prismaScR.items.length, 22);
  assert.deepEqual(CHECKLISTS.prismaScR.items.filter(i => i.optional).map(i => i.id), ["12", "16"]);
  assert.equal(CHECKLISTS.prismaScR.paraphrased, true);
  const f = { sources: ["PubMed", "Europe PMC"], registers: true, searchDates: ["2026-11-11"], strategies: true, press: "J. Smith, librarian", criteria: 4, screened: 32,
    screenHow: "Two people screened independently", second: { screening: true, extraction: false }, fields: 5, extracted: 7, rob: "RoB 2, every domain judged by a person", certainty: "GRADE",
    included: 7, ftExcluded: 2, protocolDate: "2026-11-10", flow: true, identified: 40, ai: true };
  const rows = checklistRows("prisma2020", f);
  const by = id => rows.find(r => r.id === id);
  assert.equal(by("1").status, "you");
  assert.equal(by("5").status, "sieve");
  assert.match(by("11").where, /RoB 2/);
  assert.equal(by("22").status, "sieve");
  assert.equal(checklistRows("prismaS", f).find(r => r.id === "14").where, "Peer reviewed (PRESS) by J. Smith, librarian.");
  assert.equal(checklistRows("prismaS", f).find(r => r.id === "3").status, "sieve");
  assert.match(checklistMarkdown("prismaScR", f), /\| 12 \(optional\) \|/);
  assert.deepEqual(checklistsFor("scoping"), ["prismaScR", "prismaS"]);
});

test("scan limitations and go-deeper advice follow what was done", () => {
  const p = project();
  const base = { identified: 3, duplicates: 0, screened: 3, humanChecked: 3, selected: 2, withText: 2, extractChecked: 2, screenMode: "dual", calibration: null };
  const none = scanLimits(p, base).join(" ");
  assert.match(none, /No risk-of-bias or quality appraisal/);
  assert.match(none, /No certainty-of-evidence rating/);
  const done = scanLimits(p, { ...base, second: { screening: true, kappa: 0.81, conflicts: 2, flagged: 1, extraction: { same: 9, compared: 10 } }, rob: { done: true, tools: "RoB 2", second: true }, certainty: "GRADE" }).join(" ");
  assert.match(done, /two people screened every record independently \(κ = 0\.81\)/);
  assert.match(done, /second person extracted independently \(9 of 10/);
  assert.match(done, /RoB 2 for 2 studies/);
  assert.match(done, /rated per finding with GRADE/);
  const adv = goDeeperAdvice(p, { ...base, second: { screening: true, extraction: { same: 1 } }, rob: { done: true, second: true }, certainty: "GRADE" });
  const sys = adv.routes.find(r => r.id === "systematic").items;
  assert.ok(sys.find(i => /MECIR C39/.test(i.text)).done);
  assert.ok(sys.find(i => /C52-C53/.test(i.text)).done);
  assert.ok(sys.find(i => /GRADE/.test(i.text)).done);
});

test("auto mode: the manuscript says what a person checked, methods come from the project, HTML is escaped", async () => {
  const { AUTO_STEPS, manuscriptMarkdown, markdownToHtml, manuscriptSchema, manuscriptPrompt } = await import("../site/js/auto.js");
  const d = {
    question: "Does X help?", date: "2026-11-11", verified: {},
    methods: { protocol: "Drafted by AI.", criteria: [{ label: "Adults", description: "18+" }], sources: "PubMed and Europe PMC", searchDate: "2026-11-11", search: "Searched.", queries: [["PubMed", "x[tiab]"]], selection: "AI only.", extraction: "AI.", appraisal: "", synthesis: "Narrative." },
    flow: { identified: 10, duplicates: 1, screened: 9, excluded: 7, rows: [{ label: "Adults", n: 7 }], withText: 1 },
    papers: [{ rid: "1", short: "Smith 2020", values: [["Sample size", "120"]] }], fields: ["Sample size"], robTool: "", robRows: [],
    summary: { answer: "Yes [1].", findings: [{ statement: "Helps", paper_ids: ["1"] }] }, sof: null, limits: ["Open databases only."], disclosure: ["AI did it."], refs: ["[1] Smith 2020. T. J"],
    text: { title: "X: an AI-assisted evidence scan", introduction: ["Intro <script>alert(1)</script>"], discussion: { principal_findings: "P", context: "C", strengths_limitations: "S", implications: "I" }, conclusion: "Maybe." },
  };
  const md = manuscriptMarkdown(d);
  assert.match(md, /UNVERIFIED AI DRAFT/);
  assert.match(md, /### 2\.3 Selection ⚠/);
  assert.match(md, /\| \[1\] Smith 2020 \| 120 \|/);
  assert.equal((md.match(/⚠ not yet: AI only/g) || []).length, AUTO_STEPS.length);
  const ok = manuscriptMarkdown({ ...d, verified: Object.fromEntries(AUTO_STEPS.map(s => [s.id, true])) });
  assert.doesNotMatch(ok, /UNVERIFIED/);
  assert.doesNotMatch(ok, /⚠/);
  const html = markdownToHtml(md);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /<table>/);
  assert.match(html, /<blockquote>/);
  assert.deepEqual(Object.keys(manuscriptSchema.properties), ["title", "introduction", "discussion", "conclusion"]);
  assert.match(manuscriptPrompt(project(), d.summary, [{ rid: "1", cite: "Smith", lines: ["n: 120"] }], ["Open databases only."]), /Do not cite or invent outside literature/);
});
