#!/usr/bin/env node
// Translate the search strategies in a document (or a pasted strategy file) to other databases.
//
//   node tools/translate.mjs ticket.docx                    # list what is in the document
//   node tools/translate.mjs ticket.docx --strategy V2      # translate the strategy whose name contains "V2"
//   node tools/translate.mjs strategy.txt --to embase,wos --out translations.md
//   node tools/translate.mjs ticket.docx --json             # everything found, as JSON
//
// Same code as the app (site/js), so app, tests and this tool give identical output.
import { readFile, writeFile } from "node:fs/promises";
import { readDocument, analyzeDocument } from "../site/js/docimport.js";
import { parseStrategyText, translationReport, TARGETS } from "../site/js/strategy.js";

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find(a => !a.startsWith("--") && !Object.values({ s: opt("strategy"), t: opt("to"), o: opt("out"), h: opt("headings") }).includes(a));
if (!file) { console.error("usage: node tools/translate.mjs <document.docx|strategy.txt> [--strategy NAME] [--to medline,embase,wos,psycinfo,acm] [--headings map.json] [--out file.md] [--json]"); process.exit(2); }

const buf = await readFile(file);
// A .docx/.md/.pdf-text document is analysed; a .txt is read as a strategy (Ovid history or table rows).
let strategies, analysis = null;
if (/\.(docx|md)$/i.test(file)) {
  analysis = analyzeDocument(await readDocument(file, buf), { name: file.split("/").pop() });
  strategies = analysis.strategies.filter(s => s.kind === "lines");
} else {
  strategies = [parseStrategyText(buf.toString(), file.split("/").pop())];
}

if (args.includes("--json")) { console.log(JSON.stringify(analysis ?? { strategies }, null, 1)); process.exit(0); }

const want = opt("strategy");
const chosen = want ? strategies.filter(s => s.name.toLowerCase().includes(want.toLowerCase())) : strategies;
if (!want && strategies.length > 1) {
  console.error(`${strategies.length} strategies found; pick one with --strategy:`);
  strategies.forEach(s => console.error(`  - ${s.name} (${s.lines.length} lines)`));
  if (analysis) console.error(`Also found: question ${analysis.question ? "yes" : "no"}, ${analysis.pmids.length} PMIDs, ${analysis.dois.length} DOIs without PMID.`);
  process.exit(1);
}
if (!chosen.length) { console.error("No matching strategy."); process.exit(1); }

const targets = (opt("to") || Object.keys(TARGETS).join(",")).split(",").map(s => s.trim()).filter(Boolean);
for (const t of targets) if (!TARGETS[t]) { console.error(`Unknown database "${t}". Use: ${Object.keys(TARGETS).join(", ")}`); process.exit(2); }
const headings = opt("headings") ? JSON.parse(await readFile(opt("headings"), "utf8")) : {};
const md = chosen.map(s => translationReport(s, targets, { headings })).join("\n\n");
if (opt("out")) { await writeFile(opt("out"), md); console.error(`Wrote ${opt("out")}`); } else console.log(md);
