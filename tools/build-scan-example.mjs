#!/usr/bin/env node
// Records an example scan: every AI answer for one of the home-page example questions, keyed by the fingerprint
// of its exact input, so the scan replays without a key or a call (site/examples/scans/<id>.json).
// It drives the real app in headless Chrome with the scan page's own exported functions, so the search, the
// processing of records and full texts, the prompts and the fingerprints are exactly what a browser computes.
//
//   node tools/build-scan-example.mjs <example-id>      e.g. writing, climate (ids in site/js/review-plan.js)
//
// Answers live in examples/scans/<id>/ (plan.json, screen-<n>.json, extract-<rid>.json, summary.json). Each run
// goes as far as the answers reach and writes the prompts that still need an answer next to them
// (*.prompt.txt, git-ignored: they can contain full texts): answer each one in a chat (or with a model) and save the JSON with the same name, then run
// again. The search is frozen in search.json on the first run (record ids, counts, date).
// Only ids, counts and the AI answers are published: no abstracts or full texts (those are fetched live).
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ID = process.argv[2];
if (!ID) { console.error("usage: node tools/build-scan-example.mjs <example-id>"); process.exit(2); }
const REPO = new URL("..", import.meta.url).pathname;
const DIR = join(REPO, "examples", "scans", ID);
await mkdir(DIR, { recursive: true });
const readJson = async (f, d = null) => (existsSync(join(DIR, f)) ? JSON.parse(await readFile(join(DIR, f), "utf8")) : d);
const config = await readJson("config.json", { caps: { pubmed: 30, europepmc: 10 }, model: "claude-opus-5-5 (copy-paste)", date: new Date().toISOString().slice(0, 10) });
await writeFile(join(DIR, "config.json"), JSON.stringify(config, null, 1));
const files = await readdir(DIR);
const list = async re => (await Promise.all(files.filter(f => re.test(f)).sort().map(f => readJson(f)))).flatMap(j => j.results || [j]);
const answers = { plan: await readJson("plan.json"), search: await readJson("search.json"), screen: await list(/^screen-\d+\.json$/),
  extract: await list(/^extract-.+\.json$/), summary: await readJson("summary.json") };

// ---------------------------------------------------------------- headless Chrome on the app
const PORT = 8700 + Math.floor(Math.random() * 80), DEBUG = 9700 + Math.floor(Math.random() * 80), BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
const profile = await mkdtemp(join(tmpdir(), "sieve-scan-"));
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", join(REPO, "site")], { stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const done = async code => { chrome.kill(); server.kill(); await new Promise(r => setTimeout(r, 300)); await rm(profile, { recursive: true, force: true }).catch(() => {}); process.exit(code); };
for (let i = 0; i < 80; i++) { if (await Promise.all([fetch(`http://localhost:${DEBUG}/json/version`), fetch(`${BASE}/`)]).then(r => r.every(x => x.ok)).catch(() => false)) break; await new Promise(r => setTimeout(r, 250)); }
const page = (await (await fetch(`http://localhost:${DEBUG}/json/list`)).json()).find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r, { once: true }));
let n = 0; const waiting = new Map();
ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++n; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Page.navigate", { url: `${BASE}/#/settings` }); await new Promise(r => setTimeout(r, 1500));

// ---------------------------------------------------------------- the scan, in the page
const script = async (ID, config, A) => {
  const S = await import("/js/store.js"), RP = await import("/js/review-plan.js"), V = await import("/js/views/scan.js");
  const SC = await import("/js/scan.js"), Q = await import("/js/query.js"), P = await import("/js/prompts.js"), FT = await import("/js/views/fulltext.js");
  const R = await import("/js/views/records.js");
  const ex = RP.QUESTION_EXAMPLES.find(e => e.id === ID);
  if (!ex) return { error: `unknown example id ${ID}; ids: ${RP.QUESTION_EXAMPLES.map(e => e.id).join(", ")}` };
  const draft = { question: ex.question, purpose: ex.purpose, type: ex.type, framework: RP.REVIEW_TYPES[ex.type].framework, exampleId: ex.id, maintenance: "update" };
  const p = S.emptyProject("example scan build");
  RP.applyReviewPlan(p.protocol, draft);
  p.scan = { caps: { ...config.caps } };
  const ctx = { get project() { return p; }, save() {}, rerender() {}, go() {} };
  const cache = { model: config.model, date: config.date, answers: {} };
  const out = { prompts: {}, draft, name: ex.name };
  // 1 · plan
  const planKey = SC.scanKeys.plan(p);
  if (!A.plan) { out.prompts.plan = SC.scanPlanPrompt(p); return out; }
  cache.answers[planKey] = A.plan;
  V.applyCachedPlan(p, cache);
  // 2 · search (frozen after the first run)
  const pq = Q.pmQuery(p.search.blocks), eq = SC.epmcQuery(p.search.blocks), sKey = SC.scanKeys.search(pq, eq, p.scan.caps);
  await V.runSearch(ctx, pq, eq, null, A.search?.key === sKey ? A.search : null);
  const s = p.scan.search;
  out.search = { key: sKey, date: s.date, pubmed: { query: pq, count: s.pubmed.count, ids: s.pubmed.ids }, europepmc: { query: eq, count: s.europepmc.count, ids: s.europepmc.ids } };
  // 3 · screen
  const recs = R.active(p);
  for (const a of A.screen) { const r = recs.find(x => x.rid === String(a.id)); if (r) cache.answers[SC.scanKeys.screen(p, r)] = a; }
  V.applyCachedScreen(p, cache);
  const todo = recs.filter(r => !Object.values(p.screening.runs).some(R => R.results?.[r.rid]));
  for (let i = 0; i < todo.length; i += 20) out.prompts[`screen-next${i / 20 + 1}`] = P.screeningPrompt(p, todo.slice(i, i + 20).map(r => ({ source: P.sourceBlock(r) })));
  if (todo.length) { out.todo = `screen ${todo.length} records`; return out; }
  // 4 · full texts (live, the same chain as the app)
  const sel = V.scanSelected(p);
  await FT.fetchAuto(ctx, sel, { set() {} }, null);
  const texts = await V.loadTexts(p, sel);
  // 5 · extract
  const fields = P.modelFields(p.extraction.fields);
  for (const a of A.extract) { const r = sel.find(x => x.rid === String(a.id)); if (r) cache.answers[SC.scanKeys.extract(p, r, texts[r.rid], fields)] = a; }
  V.applyCachedExtract(p, cache, texts);
  const exTodo = sel.filter(r => !Object.values(p.extraction.runs).some(R => R.results?.[r.rid]));
  for (const r of exTodo) out.prompts[`extract-${r.rid}`] = P.extractionPrompt(p, [{ source: P.sourceBlock(r, texts[r.rid] || "", 30000) }], fields);
  if (exTodo.length) { out.todo = `extract ${exTodo.length} papers`; return out; }
  // 6 · summary
  const papers = V.papersForSummary(p, texts), sumKey = SC.scanKeys.summary(p, papers);
  if (!A.summary) { out.prompts.summary = SC.scanSummaryPrompt(p, papers); out.todo = "summary"; return out; }
  cache.answers[sumKey] = A.summary;
  out.done = true;
  out.cache = cache;
  out.stats = { records: recs.length, included: sel.length, texts: Object.keys(texts).length };
  return out;
};
let r;
for (let attempt = 1; attempt <= 3; attempt++) {   // a module can fail to load while the server starts: reload and retry
  r = await send("Runtime.evaluate", { expression: `(${script})(${JSON.stringify(ID)}, ${JSON.stringify(config)}, ${JSON.stringify(answers)})`, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (!/Failed to fetch dynamically imported module/.test(r.result.exceptionDetails?.exception?.description || "")) break;
  await send("Page.reload", { ignoreCache: true }); await new Promise(res => setTimeout(res, 2000));
}
if (r.result.exceptionDetails) { console.error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); await done(1); }
const out = r.result.result.value;
if (out.error) { console.error(out.error); await done(1); }
if (out.search && !answers.search) await writeFile(join(DIR, "search.json"), JSON.stringify(out.search, null, 1));
// Prompts that still need an answer, numbered after the answers already there.
let next = files.filter(f => /^screen-\d+\.json$/.test(f)).length;
for (const [name, text] of Object.entries(out.prompts)) {
  const file = name.startsWith("screen-next") ? `screen-${++next}` : name;
  await writeFile(join(DIR, `${file}.prompt.txt`), text);
  console.log(`needs an answer: examples/scans/${ID}/${file}.prompt.txt → ${file}.json`);
}
if (out.done) {
  const pub = join(REPO, "site", "examples", "scans");
  await mkdir(pub, { recursive: true });
  const cacheFile = { format: "sieve-scan-example", id: ID, name: out.name, draft: out.draft, caps: config.caps, model: config.model, date: config.date,
    search: out.search, answers: out.cache.answers, stats: out.stats };
  await writeFile(join(pub, `${ID}.json`), JSON.stringify(cacheFile));
  const idxFile = join(pub, "index.json");
  const idx = existsSync(idxFile) ? JSON.parse(await readFile(idxFile, "utf8")).filter(e => e.id !== ID) : [];
  idx.push({ id: ID, name: out.name, draft: out.draft, model: config.model, date: config.date, records: out.stats.records, included: out.stats.included });
  await writeFile(idxFile, JSON.stringify(idx, null, 1));
  console.log(`done: site/examples/scans/${ID}.json · ${Object.keys(out.cache.answers).length} answers · ${JSON.stringify(out.stats)}`);
} else console.log(`next: ${out.todo || "plan"}`);
await done(0);
