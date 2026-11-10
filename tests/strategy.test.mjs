import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOvid, parseStrategyText, strategyFromTable, translateStrategy, formatTranslation, headingsIn, TARGETS } from "../site/js/strategy.js";
import { toOvid } from "../site/js/query.js";
import { TICKET_ROWS } from "./fixtures.mjs";

const strategy = () => strategyFromTable(TICKET_ROWS, "V2");
const all = Object.fromEntries(Object.keys(TARGETS).map(t => [t, translateStrategy(strategy(), t)]));
const line = (r, label) => r.lines.find(l => l.label === label);

// Brackets and quotes must balance in everything we hand to a database.
function balanced(s) {
  let d = 0;
  for (const c of s.replace(/"[^"]*"/g, "")) { if (c === "(") d++; if (c === ")" && --d < 0) return false; }
  return d === 0 && (s.match(/"/g) || []).length % 2 === 0;
}

test("reads a search table: numbering, empty rows, deferred limit", () => {
  const s = strategy();
  assert.equal(s.kind, "lines");
  assert.deepEqual(s.lines.filter(l => !l.deferred).map(l => l.n), [...Array(15)].map((_, i) => i + 1));
  const lim = s.lines.find(l => l.deferred);
  assert.equal(lim.label, "Year filter");
  assert.equal(s.lines[0].count, 263512);
});

test("recognises a per-database table as reference, not as lines", () => {
  const s = strategyFromTable([["Concepts", "Search"], ["Embase via OVID", "x/"], ["WoS", "TS=x"], ["PsycInfo", "DE x"]], "Translations");
  assert.equal(s.kind, "by-database");
});

test("parses Ovid syntax into a tree", () => {
  const { node, warnings } = parseOvid('exp Artificial Intelligence/ not (exp Robotics/ or Prediction Methods, Machine/or "x y")');
  assert.deepEqual(warnings, []);
  assert.equal(node.t, "not");
  assert.deepEqual(node.a[0], { t: "head", term: "Artificial Intelligence", exp: true, major: false, sub: null });
  assert.equal(node.a[1].t, "or");
  assert.equal(node.a[1].a[1].term, "Prediction Methods, Machine");
  assert.deepEqual(parseOvid("or/7-9").node, { t: "or", a: [7, 8, 9].map(n => ({ t: "ref", n })) });
  assert.equal(parseOvid('"Evaluation Study".pt.').node.f[0], "pt");
  assert.equal(parseOvid("Evaluation Study.pt.").node.v, "Evaluation Study");
  assert.deepEqual(parseOvid('limit 15 to yr="2020-current"').node.yr, [2020, null]);
});

test("warns about unbracketed mixed operators and typical slips", () => {
  assert.match(parseOvid("a/ or b/ and c/").warnings[0], /Mixed/);
  const r = translateStrategy(parseStrategyText('1  ("implementation outcome* implementation method*" or x).ti,ab.'), "medline");
  assert.ok(r.warnings.some(w => /truncation inside the phrase/.test(w)));
});

test("MEDLINE round trip keeps the strategy", () => {
  const r = all.medline;
  assert.equal(line(r, "AI Mesh").text, "exp Artificial Intelligence/ not (exp Robotics/ or exp Fuzzy Logic/)");
  assert.equal(line(r, "Impl").text, "7 or 8 or 9");
  assert.equal(line(r, "Impl proximity").text, '(("artificial intelligence" or AI) adj4 (implement* or deploy*)).ti,ab,kf.');
  assert.equal(line(r, "Year filter").text, 'limit 15 to yr="2020-current"');
});

test("Embase: Emtree headings, .kw., publication types", () => {
  const r = all.embase;
  assert.equal(line(r, "AI Mesh").text, "exp artificial intelligence/ not (exp robotics/ or exp fuzzy logic/)");
  assert.equal(line(r, "Care Mesh").text, "exp health care delivery/ or exp health care personnel/");
  assert.match(line(r, "AI free text").text, /\.ti,ab,kw\.$/);
  assert.equal(line(r, "Excl pt").text, "review.pt. or systematic review/ or editorial.pt. or letter.pt. or evaluation study/");
  assert.equal(line(r, "Excl animals").text, "exp animal/ not human/");
});

test("Web of Science: no headings, renumbered history, NEAR, $ wildcard, DT and PY", () => {
  const r = all.wos;
  const kept = r.lines.filter(l => l.n !== null);
  assert.equal(kept[0].text.slice(0, 4), "TS=(");
  assert.match(line(r, "Impl TMF").text, /"behavio\$r change wheel"/);
  assert.match(line(r, "Impl proximity").text, /NEAR\/4/);
  assert.equal(line(r, "Excl pt").text, 'DT=("Review" OR "Editorial Material" OR "Letter")');
  assert.equal(line(r, "Excl animals").n, null);                      // only headings: dropped
  assert.equal(line(r, "AI").n, null);                                 // became a pointer to the free-text line
  assert.match(line(r, "Year filter").text, /^#\d+ AND PY=\(2020-\d{4}\)$/);
  assert.match(r.single, /AND PY=\(2020-\d{4}\)$/);
  assert.ok(r.warnings.some(w => /no equivalent subject headings/.test(w)));
});

test("PsycInfo (EBSCO): DE terms, TI/AB/KW, N4, # wildcard, PO limits", () => {
  const r = all.psycinfo;
  assert.equal(line(r, "AI Mesh").text, 'DE "Artificial Intelligence" NOT (DE "Robotics" OR DE "Fuzzy Logic")');
  assert.match(line(r, "AI free text").text, /^\(TI \(.*\) OR AB \(.*\) OR KW \(.*\)\)$/);
  assert.match(line(r, "Impl TMF").text, /"behavio#r change wheel"/);
  assert.match(line(r, "Impl proximity").text, / N4 /);
  assert.equal(line(r, "Excl animals").text, "PO Animal NOT PO Human");
  assert.match(line(r, "Impl").text, /^S\d+ OR S\d+ OR S\d+$/);
});

test("ACM: one string, Title/Abstract/Keyword, no wildcards in quotes, spelling variants", () => {
  const r = all.acm;
  assert.equal(r.history, false);
  assert.match(r.single, /Title:\(/);
  assert.match(r.single, /Abstract:\(/);
  for (const [, p] of r.single.matchAll(/"([^"]*)"/g)) assert.ok(!/[*?]/.test(p), `wildcard inside the phrase "${p}"`);
  assert.match(r.single, /\("artificial intelligence" OR "artificial intelligences"\)/);
  assert.match(r.single, /"behavior change wheel" OR "behaviour change wheel"/);
  assert.match(r.single, /"normalisation process" OR "normalization process"/);
  assert.match(r.single, /"implementation strategy" OR "implementation strategies"/);
  assert.ok(!/\bor\b|\band\b|\bnot\b/.test(r.single.replace(/"[^"]*"/g, "")), "operators in capitals");
  assert.ok(!/#\d/.test(r.single), "no line references in the one-string version");
});

test("every translation is syntactically balanced", () => {
  for (const r of Object.values(all)) {
    for (const l of r.lines.filter(x => x.n !== null)) assert.ok(balanced(l.text), `${r.target}: ${l.text}`);
    assert.ok(balanced(r.single), `${r.target} single`);
    assert.ok(r.single.length > 100, `${r.target} single is not empty`);
  }
});

test("project heading map overrides the built-in list", () => {
  const r = translateStrategy(strategy(), "psycinfo", { headings: { "Delivery of Health Care": { psycinfo: ["Health Care Delivery", "Health Care Services"] } } });
  assert.equal(line(r, "Care Mesh").text, '(DE "Health Care Delivery" OR DE "Health Care Services") OR DE "Health Personnel"');
});

test("pasted text formats: Ovid history, tab rows, pipe rows", () => {
  assert.equal(parseStrategyText("1 or 2").lines[0].query, "1 or 2");
  const ovid = parseStrategyText("1     exp Artificial Intelligence/  (263512)\n2     (AI or LLM).ti,ab.  (1000)\n3     1 or 2  (2000)");
  assert.deepEqual(ovid.lines.map(l => [l.n, l.count]), [[1, 263512], [2, 1000], [3, 2000]]);
  const tabs = parseStrategyText("Concept\tSearch\t#results\nAI\texp Artificial Intelligence/\t5\nML\tmachine learning.ti.\t\nBoth\t1 or 2\t");
  assert.deepEqual(tabs.lines.map(l => [l.n, l.label]), [[1, "AI"], [2, "ML"], [3, "Both"]]);
  const pipes = parseStrategyText("1 | AI | exp Artificial Intelligence/ | 5\n2 | ML | machine learning.ti. | ");
  assert.equal(pipes.lines[1].query, "machine learning.ti.");
});

test("PubMed concept blocks → Ovid → all databases", () => {
  const blocks = [
    { id: "a", label: "AI", role: "include", terms: ['"machine learning"[tiab]', "Artificial Intelligence[Mesh]", "NEAR/4(AI | machine learning ; implemented | deployed)[tiab]"] },
    { id: "x", label: "Reviews", role: "exclude", terms: ["review[pt]"] },
  ];
  const st = parseStrategyText(toOvid(blocks, "medline").text, "blocks");
  assert.deepEqual(st.lines.map(l => [l.n, l.label]), [[1, ""], [2, ""], [3, "AI"], [4, "Reviews"], [5, ""]]);
  assert.equal(st.lines[2].query, "or/1-2");
  assert.deepEqual(headingsIn(st), ["Artificial Intelligence"]);
  for (const t of Object.keys(TARGETS)) {
    const r = translateStrategy(st, t);
    assert.ok(r.single && balanced(r.single), `${t}: ${r.single}`);
    assert.ok(formatTranslation(r).length > 0);
  }
});
