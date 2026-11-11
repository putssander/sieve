import { test } from "node:test";
import assert from "node:assert/strict";
import { ctgovQuery, ctgovTranslate, ctgovToRecord, ictrpSearchUrl, ctgovSearch } from "../site/js/registers.js";
import { parseStrategyText, translateStrategy, formatTranslation } from "../site/js/strategy.js";
import { toCochrane } from "../site/js/query.js";

const block = (id, terms, extra = {}) => ({ id, label: id, role: "include", terms, ...extra });

// Synthetic study in the ClinicalTrials.gov API v2 shape (GET /api/v2/studies → studies[i]).
const STUDY = {
  protocolSection: {
    identificationModule: { nctId: "NCT09999999", briefTitle: "Sepsis Alert Trial", officialTitle: "A Randomised Trial of a Sepsis Alert" },
    statusModule: { overallStatus: "RECRUITING", startDateStruct: { date: "2024-03", type: "ACTUAL" } },
    sponsorCollaboratorsModule: { leadSponsor: { name: "Example University Hospital", class: "OTHER" } },
    descriptionModule: { briefSummary: "Tests an early-warning alert for sepsis." },
    conditionsModule: { conditions: ["Sepsis", "Septic Shock"], keywords: ["early warning"] },
    designModule: { studyType: "INTERVENTIONAL", phases: ["NA"] },
    armsInterventionsModule: { interventions: [{ type: "DEVICE", name: "Alert software" }, { type: "OTHER", name: "Usual care" }] },
  },
  hasResults: false,
};

test("ClinicalTrials.gov query: phrases, MeSH as phrases, blocks with AND", () => {
  const q = ctgovQuery([
    block("ai", ['"machine learning"[tiab]', "Artificial Intelligence[Mesh]", "AI[tiab]"]),
    block("sepsis", ["sepsis[ti]"]),
  ]);
  assert.equal(q, '("machine learning" OR "Artificial Intelligence" OR AI) AND sepsis');
});

test("ClinicalTrials.gov query: truncation is stripped (Essie ignores *) and reported", () => {
  const { term, warnings } = ctgovTranslate([block("impl", ["implement*[tiab]", '"large language model*"[tiab]'])]);
  assert.equal(term, '(implement OR "large language model")');
  assert.ok(!term.includes("*"));
  assert.ok(warnings.some(w => /no truncation/.test(w) && /implement\* → implement/.test(w)));
});

test("ClinicalTrials.gov query: limits, publication types and exclusion blocks are left out", () => {
  const { term, warnings } = ctgovTranslate([
    block("a", ["sepsis[tiab]", "english[la]", "2020:2025[dp]"]),
    block("b", ["review[pt]"]),
    block("x", ["animals[mesh]"], { role: "exclude" }),
    block("off", ["ignored[tiab]"], { enabled: false }),
  ]);
  assert.equal(term, "sepsis");
  assert.ok(warnings.some(w => /Exclusion blocks/.test(w)));
  assert.ok(warnings.some(w => /english\[la\]/.test(w)));
});

test("ClinicalTrials.gov query: proximity becomes AND, operators stay balanced", () => {
  const q = ctgovQuery([block("p", ["NEAR/4(AI | machine learning ; implemented | deployed)[tiab]", '"deep learning"[tiab:~3]'])]);
  assert.equal(q, '(((AI OR "machine learning") AND (implemented OR deployed)) OR (deep AND learning))');
  assert.equal((q.match(/\(/g) || []).length, (q.match(/\)/g) || []).length);
});

test("ClinicalTrials.gov study → Sieve record", () => {
  const r = ctgovToRecord(STUDY);
  assert.equal(r.rid, "NCT09999999");
  assert.equal(r.nct_id, "NCT09999999");
  assert.equal(r.title, "Sepsis Alert Trial");
  assert.equal(r.abstract, "Tests an early-warning alert for sepsis.\n\nConditions: Sepsis; Septic Shock. Interventions: Alert software (device); Usual care (other).");
  assert.equal(r.year, "2024");
  assert.equal(r.authors, "Example University Hospital");
  assert.equal(r.journal, "ClinicalTrials.gov registration");
  assert.equal(r.link, "https://clinicaltrials.gov/study/NCT09999999");
  assert.equal(r.study_type, "INTERVENTIONAL");
  assert.equal(r.overall_status, "RECRUITING");
  assert.equal(r.is_register, true);
  assert.equal(r.source, undefined);
  // Sparse records do not break the mapping.
  assert.deepEqual(ctgovToRecord({ protocolSection: { identificationModule: { nctId: "NCT00000001" } } }).abstract, "");
});

test("ctgovSearch builds the v2 URL and returns count and studies", async () => {
  const saved = globalThis.fetch;
  let url = "";
  globalThis.fetch = async u => { url = String(u); return { ok: true, status: 200, json: async () => ({ totalCount: 1, studies: [STUDY], nextPageToken: "abc" }) }; };
  try {
    const r = await ctgovSearch('"machine learning" AND sepsis', 50);
    assert.equal(r.count, 1);
    assert.equal(r.results[0].protocolSection.identificationModule.nctId, "NCT09999999");
    assert.equal(r.nextPageToken, "abc");
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://clinicaltrials.gov/api/v2/studies");
    assert.equal(u.searchParams.get("query.term"), '"machine learning" AND sepsis');
    assert.equal(u.searchParams.get("pageSize"), "50");
    assert.equal(u.searchParams.get("countTotal"), "true");
    assert.equal(u.searchParams.get("format"), "json");
    globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => "Error parsing query in Other terms" });
    await assert.rejects(ctgovSearch("(x AND", 1), /ClinicalTrials\.gov HTTP 400: Error parsing query/);
  } finally { globalThis.fetch = saved; }
});

test("WHO ICTRP: portal URL and a query that keeps end truncation", () => {
  const r = ictrpSearchUrl([block("a", ["implement*[tiab]", '"large language model*"[tiab]', "ab*[tiab]"]), block("b", ["sepsis[tiab]"])]);
  assert.equal(r.url, "https://trialsearch.who.int/");
  assert.equal(r.query, '(implement* OR "large language model" OR ab) AND sepsis');
  assert.ok(r.steps.some(s => /Export results to XML/.test(s)));
});

test("Cochrane Library (CENTRAL): Ovid strategy → Search Manager lines", () => {
  const st = parseStrategyText([
    "1  exp Sepsis/",
    "2  Shock, Septic/",
    '3  (sepsis or septic* or "blood stream infection*").ti,ab,kf.',
    '4  (("early warning" or alert*) adj3 (score* or system*)).ti,ab.',
    "5  or/1-3",
    "6  4 and 5",
    "7  (editorial or letter).pt.",
    "8  6 not 7",
  ].join("\n"), "test");
  const r = translateStrategy(st, "cochrane");
  const line = n => r.lines.find(l => l.from === n).text;
  assert.equal(r.label, "Cochrane Library (CENTRAL)");
  assert.equal(line(1), '[mh "Sepsis"]');
  assert.equal(line(2), '[mh ^"Shock, Septic"]');
  assert.equal(line(3), "(sepsis OR septic* OR (blood NEXT stream NEXT infection*)):ti,ab,kw");
  assert.equal(line(4), '(("early warning" OR alert*) NEAR/3 (score* OR system*)):ti,ab');
  assert.equal(line(5), "#1 OR #2 OR #3");
  assert.equal(line(6), "#4 AND #5");
  assert.equal(line(7), '("editorial" OR "letter"):pt');
  assert.equal(line(8), "#6 NOT #7");
  assert.match(formatTranslation(r), /^#1 {3}\[mh "Sepsis"\]/);
  assert.match(r.single, /NEAR\/3 .* AND .*\[mh \^"Shock, Septic"\].* NOT \(\("editorial" OR "letter"\):pt\)$/);
  assert.ok(!/#\d/.test(r.single), "no line references in the one-string version");
});

test("Cochrane Library from PubMed blocks (toCochrane)", () => {
  const r = toCochrane([
    block("ai", ['"machine learning"[tiab]', "Artificial Intelligence[Mesh]", "Robotics[Mesh:NoExp]", '"large language model*"[tiab]']),
    block("s", ["sepsis[ti]"]),
    block("x", ["review[pt]"], { role: "exclude" }),
  ]);
  const lines = r.text.split("\n");
  assert.equal(lines[0], '#1  [mh "Artificial Intelligence"] OR [mh ^"Robotics"] OR ("machine learning" OR (large NEXT language NEXT model*)):ti,ab,kw    [ai]');
  assert.equal(lines[1], "#2  sepsis:ti    [s]");
  assert.equal(lines[2], "#3  review:pt    [x]");
  assert.equal(lines[3], "#4  #1 AND #2");
  assert.equal(lines[4], "#5  #4 NOT (#3)");
});
