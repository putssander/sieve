// The public example project must be reproducible: every example model run was made with exactly the prompt
// the app builds for those papers today. If prompts or the example data change, this test fails:
// rebuild with `node tools/build-example.mjs` and redo the example runs (see examples/runs/).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import * as P from "../site/js/prompts.js";
import { quoteInSource } from "../site/js/util.js";
import { checkRun } from "../site/js/extractcheck.js";

const root = new URL("..", import.meta.url);
const project = JSON.parse(await readFile(new URL("site/examples/llm-screening.json", root), "utf8"));
const cfg = JSON.parse(await readFile(new URL("examples/llm-screening.config.json", root), "utf8"));
const texts = Object.fromEntries(Object.entries(project.fulltext).map(([k, v]) => [k, v.text]));

test("example records are the frozen ones (same IDs, same order) and come from two real sources", () => {
  assert.deepEqual(project.records.filter(r => r.source === "PubMed").map(r => r.pmid), cfg.pubmed_pmids.filter(id => project.records.some(r => r.pmid === id && r.source === "PubMed")));
  assert.ok(project.records.filter(r => r.source === "Europe PMC").length > 10);
  assert.ok(project.records.some(r => r.duplicate_of), "overlap between the sources is deduplicated");
  for (const ft of Object.values(project.fulltext)) assert.ok(/^cc[ -]?by/i.test(ft.license) && !/nd/i.test(ft.license), `embedded text licence ${ft.license}`);
});

test("every example answer was made with exactly the prompt the app builds", async () => {
  const dir = new URL("examples/runs/", root);
  let n = 0;
  for (const run of await readdir(dir)) {
    const kind = run.split("-")[0];
    for (const f of (await readdir(new URL(`${run}/`, dir))).filter(x => x.endsWith(".json"))) {
      const ans = JSON.parse(await readFile(new URL(`${run}/${f}`, dir), "utf8"));
      const ids = (ans.results || [ans]).map(x => String(x.id));
      const recs = ids.map(id => project.records.find(r => r.rid === id));
      let prompt;
      if (kind === "screening") prompt = P.screeningPrompt(project, recs.map(r => ({ source: P.sourceBlock(r, "") })), {});
      else {
        const all = P.applicableFields(project, recs[0]);
        prompt = P.extractionPrompt(project, [{ source: P.sourceBlock(recs[0], texts[recs[0].rid] || "", 40000), coreOnly: all.length < project.extraction.fields.length }], P.modelFields(all), {});
      }
      const stored = await readFile(new URL(`${run}/${f.replace(/\.json$/, ".prompt.txt")}`, dir), "utf8");
      assert.equal(prompt, stored, `${run}/${f}: the app's prompt changed; rebuild the example and redo this run`);
      const published = await readFile(new URL(`site/examples/prompts/${run}/${f.replace(/\.json$/, ".prompt.txt")}`, root), "utf8");
      assert.equal(published, stored, `${run}/${f}: published prompt out of date`);
      n++;
    }
  }
  assert.ok(n >= 3, `${n} example answers`);
});

test("example runs are in the project and their evidence quotes are found in the sources", () => {
  const sr = Object.values(project.screening.runs)[0];
  assert.ok(sr && Object.keys(sr.results).length >= 12);
  const quotes = Object.entries(sr.results).flatMap(([rid, x]) => (x.failed_criteria || []).map(f => [rid, f.evidence_quote]))
    .filter(([, q]) => q && !/no direct quote/i.test(q));
  const ok = quotes.filter(([rid, q]) => { const r = project.records.find(x => x.rid === rid); return quoteInSource(q, [r.title, r.abstract].join(" ")); }).length;
  assert.ok(ok / quotes.length >= 0.9, `screening quotes verified ${ok}/${quotes.length}`);
  const er = Object.values(project.extraction.runs)[0];
  const c = checkRun(project, er, texts).total;
  assert.ok(c.papers >= 2 && c.verified / Math.max(1, c.filled) >= 0.9, `extraction quotes verified ${c.verified}/${c.filled}`);
});
