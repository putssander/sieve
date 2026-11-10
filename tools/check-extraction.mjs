#!/usr/bin/env node
// Validate extraction runs against the full texts (same checks as step 7's summary card).
//
//   node tools/check-extraction.mjs project.json                     # every run stored in the project
//   node tools/check-extraction.mjs project.json --answers dir/      # plus *.answer.json files (one paper each) as a run
//   node tools/check-extraction.mjs project.json --answers a/ --answers b/   # two runs: also their agreement
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { checkRun, agreement } from "../site/js/extractcheck.js";
import { extractJson } from "../site/js/util.js";

const args = process.argv.slice(2);
const project = JSON.parse(await readFile(args[0], "utf8"));
const texts = Object.fromEntries(Object.entries(project.fulltext || {}).filter(([, f]) => f.text).map(([rid, f]) => [rid, f.text]));
const runs = Object.entries(project.extraction.runs || {}).map(([id, r]) => ({ id, ...r }));
for (let i = 0; i < args.length; i++) if (args[i] === "--answers") {
  const dir = args[++i], results = {};
  for (const f of (await readdir(dir)).filter(x => x.endsWith(".answer.json"))) {
    const j = extractJson(await readFile(join(dir, f), "utf8"));
    results[String(j.id ?? f.split(".")[0])] = j;
  }
  runs.push({ id: dir.replace(/\/$/, "").split("/").pop(), results });
}
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
for (const run of runs) {
  const c = checkRun(project, run, texts);
  const t = c.total;
  console.log(`\n== run ${run.id}: ${t.papers} papers${t.errors ? `, ${t.errors} errors` : ""}`);
  console.log(`   fields expected ${t.expected} · missing ${t.missing} · values ${t.filled} · NR/NA ${t.nr}`);
  console.log(`   quotes found verbatim in the full text: ${t.verified}/${t.filled} (${pct(t.verified, t.filled)}) · values without a verified quote: ${t.unverified}`);
  if (t.extra) console.log(`   core-only papers with non-core values: ${t.extra}`);
  for (const p of c.papers) {
    if (p.error) { console.log(`   ${p.rid}: ERROR ${p.error}`); continue; }
    console.log(`   ${p.rid.padStart(3)} ${p.coreOnly ? "core" : "all "} values ${p.filled}/${p.expected} NR ${p.nr} quotes ok ${p.verified}/${p.filled}${p.missing.length ? ` missing ${p.missing.join(",")}` : ""}  ${p.title.slice(0, 60)}`);
    for (const u of p.unverified) console.log(`         ✗ ${u.field} = ${String(u.value).slice(0, 60)} | quote: ${String(u.quote).slice(0, 90)}`);
  }
}
if (runs.length >= 2) {
  const a = agreement(project, runs[runs.length - 2], runs[runs.length - 1]);
  console.log(`\n== agreement ${runs[runs.length - 2].id} vs ${runs[runs.length - 1].id}: ${a.same}/${a.compared} (${pct(a.same, a.compared)})`);
  for (const d of a.differ) console.log(`   ${d.rid} ${d.field}: "${String(d.a).slice(0, 50)}" vs "${String(d.b).slice(0, 50)}"`);
}
