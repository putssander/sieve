#!/usr/bin/env node
// Browser test of the document → protocol → search translations flow, in the real app.
// Starts `python -m sieve serve` and headless Chrome, then drives the pages over the DevTools protocol:
// load a ticket, read it with the (simulated) copy-paste assistant, apply, check all five database tabs,
// paste an assistant translation back, and check that no page errors occur.
//
//   node tests/e2e.mjs                      # synthetic ticket (tests/fixtures.mjs)
//   node tests/e2e.mjs path/to/ticket.docx  # a real document (stays local)
//   CHROME=/path/to/chrome node tests/e2e.mjs
// Needs Node >= 22 (global WebSocket), Python 3 and Chrome/Chromium.
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { makeDocx, ticketXml } from "./fixtures.mjs";

const REPO = new URL("..", import.meta.url).pathname;
const docPath = process.argv[2];
const docBuf = docPath ? await readFile(docPath) : Buffer.from(makeDocx(ticketXml()));
const docName = docPath ? docPath.split("/").pop() : "ticket.docx";
const PORT = 8790 + Math.floor(Math.random() * 100), DEBUG = 9300 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
if (!CHROME) { console.error("Chrome not found: set CHROME=/path/to/chrome"); process.exit(2); }

const profile = await mkdtemp(join(tmpdir(), "sieve-e2e-"));
const server = spawn("python3", ["-m", "sieve", "serve", "--port", String(PORT)], { cwd: REPO, stdio: "ignore" });
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-sandbox", "--host-resolver-rules=MAP sieve.test 127.0.0.1", "--window-size=1300,1000", "about:blank"], { stdio: "ignore" });
const cleanup = async () => { chrome.kill(); server.kill(); await new Promise(r => setTimeout(r, 300)); await rm(profile, { recursive: true, force: true }).catch(() => {}); };
for (let i = 0; i < 60; i++) {
  const ok = await Promise.all([fetch(`http://localhost:${DEBUG}/json/version`), fetch(`${BASE}/`)]).then(r => r.every(x => x.ok)).catch(() => false);
  if (ok) break;
  await new Promise(r => setTimeout(r, 250));
}

const tabs = await (await fetch(`http://localhost:${DEBUG}/json/list`)).json();
const page = tabs.find(t => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r, { once: true }));
let id = 0; const waiting = new Map(); const errors = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map(a => a.value || a.description).join(" "));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) process.exitCode = 1; };
// Clicks inside the topmost dialog when one is open (pages can have the same buttons underneath).
const click = text => js(`const scope=[...document.querySelectorAll(".modal-bg")].pop() || document; const b=[...scope.querySelectorAll("button,a.btn")].find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})); if(!b) return false; b.click(); return true;`);

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable"); await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Page.navigate", { url: `${BASE}/` }); await sleep(800); await send("Page.reload", { ignoreCache: true }); await sleep(800);
await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(1500);
check(await js(`return [...document.querySelectorAll("button")].some(b=>b.textContent.includes("New project from a document"))`), "home: 'New project from a document…' button");
await sleep(500);
check(/^Sieve \d+\.\d+\.\d+/.test(await js(`return document.querySelector(".side-version")?.textContent || ""`)), "sidebar: version shown at the bottom");

// Simulate the file pick: analyse the document in the page with the app's own modules.
const b64 = docBuf.toString("base64");
await js(`
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0)).buffer;
  const { readDocument, analyzeDocument } = await import("/js/docimport.js");
  const dl = await import("/js/views/docload.js");
  const store = await import("/js/store.js");
  const a = analyzeDocument(await readDocument(${JSON.stringify(docName)}, bytes), { name: ${JSON.stringify(docName)} });
  const p = store.emptyProject("E2E " + ${JSON.stringify(docName)});
  await store.saveProject(p);
  dl.setPending(p.id, a);
  window.__pid = p.id;
  location.hash = "#/p/" + p.id + "/protocol";`);
await sleep(1500);
const pid = await js(`return window.__pid`);
check(await js(`return document.querySelector(".card.start-doc") === document.querySelector("#main .card")`), "protocol: 'Start from a document' is the first card");
const dialog = await js(`const m=document.querySelector(".modal, dialog, .overlay"); return m ? m.innerText.slice(0, 1500) : ""`);
check(/Load from document/.test(dialog), "import dialog opens for the new project");
check(/Read with the assistant/.test(dialog), "dialog offers the copy-paste assistant");
console.log("   dialog items:", (await js(`return [...document.querySelectorAll(".import-item strong")].map(s=>s.textContent)`)).join(" | "));

// Assistant route inside the dialog: copy prompt → paste JSON → merged dialog.
await click("Read with the assistant");
await sleep(500);
const promptLen = await js(`const p=[...document.querySelectorAll("pre.prompt")].pop(); return p ? p.textContent.length : 0`);
check(promptLen > 1000, `assistant prompt is built (${promptLen} characters)`);
const answer = { question: "E2E question from the assistant", elements: [{ label: "Population", text: "Hospitals" }],
  criteria: [{ label: "Empirical study", description: "Primary data on AI implementation.", fail_decision: "Exclude" }],
  known_articles: [{ pmid: "33782057", doi: "", title: "" }], strategies: [], notes: "E2E note" };
await js(`const t=[...document.querySelectorAll("textarea.answer")].pop(); t.value = ${JSON.stringify("Here you go:\n```json\n" + JSON.stringify(answer) + "\n```")}; return true;`);
await click("3 · Save answer"); await sleep(800);
const merged = await js(`return [...document.querySelectorAll(".import-item strong")].map(s=>s.textContent).join(" | ")`);
check(/eligibility criteria/.test(merged) && /Read by the assistant/.test(merged), "merged dialog shows criteria from the assistant");

// Apply (PubMed lookups may fail offline; they are optional).
await click("Apply");
for (let i = 0; i < 120 && await js(`return !!document.querySelector(".import-list")`); i++) await sleep(500);
await sleep(1000);  // ctx.save() is debounced (400 ms)
const P = await js(`const s = await import("/js/store.js"); const p = await s.loadProject(window.__pid); return { q: p.protocol.question, crit: p.criteria.length, val: p.search.validation.length, strat: p.search.strategies.map(x=>x.name+":"+x.kind), docs: p.protocol.documents.length };`);
console.log("   project:", JSON.stringify(P));
check(P.q === answer.question, "question filled in");
check(P.crit === 1 && P.val >= 1 && P.strat.some(s => s.endsWith(":lines")) && P.docs === 1, "criteria, validation set, strategies and document stored");

// Search step: strategies card with translations.
await send("Page.navigate", { url: `${BASE}/#/p/${pid}/search` }); await sleep(1500);
check(await js(`return [...document.querySelectorAll("h3")].some(h=>h.textContent.includes("Database strategies"))`), "search: strategies card present");
for (const db of ["MEDLINE", "Embase", "WoS", "PsycInfo", "ACM"]) {
  await click(db); await sleep(200);
  const first = await js(`const td=document.querySelector(".strat-lines td.q"); return td ? td.textContent.slice(0,90) : ""`);
  check(first.length > 5, `tab ${db}: ${first}`);
}
// Assistant translation round trip.
await click("Check & improve with the assistant"); await sleep(600);
const tp = await js(`const p=[...document.querySelectorAll("pre.prompt")].pop(); return p ? p.textContent : ""`);
check(/=== DRAFT: acm /.test(tp) && /=== DRAFT: psycinfo /.test(tp), `translation prompt has all drafts (${tp.length} characters)`);
const tAnswer = { heading_map: [{ mesh: "Artificial Intelligence", embase: "artificial intelligence", psycinfo: "Artificial Intelligence" }],
  databases: [{ database: "acm", lines: [{ n: 1, label: "AI", query: 'Title:("artificial intelligence" OR AI)' }], one_string: 'Abstract:("artificial intelligence" OR AI)', changes: "E2E change", checks: "E2E check" }], notes: "" };
await js(`const t=[...document.querySelectorAll("textarea.answer")].pop(); t.value = ${JSON.stringify(JSON.stringify(tAnswer))}; return true;`);
await click("3 · Save answer"); await sleep(800);
await click("ACM"); await sleep(300);
const shown = await js(`return document.querySelector(".strat-lines td.q")?.textContent || ""`);
check(shown.startsWith('Title:("artificial intelligence" OR AI)'), "assistant version shown after pasting the JSON");
check(await js(`return document.body.innerText.includes("E2E change")`), "assistant notes (changes/checks) shown");

// ---------------------------------------------------------------- records from three databases
const known = await js(`const s = await import("/js/store.js"); const p = await s.loadProject(window.__pid); return p.search.validation.map(v => ({ pmid: v.pmid, title: v.title || v.label || "", doi: v.doi || "" }));`);
check(known.length > 0, `validation set has ${known.length} articles`);
await send("Page.navigate", { url: `${BASE}/#/p/${pid}/records` }); await sleep(1200);
await js(`
  const { ctx } = await import("/js/app.js");
  const R = await import("/js/views/records.js");
  const k = ${JSON.stringify(known)};
  R.addRecords(ctx, [{ pmid: k[0].pmid, title: k[0].title || "Known article", authors: "Page MJ", journal: "BMJ", year: "2021", volume: "372", pages: "n71" },
    { pmid: "99999991", title: "A PubMed-only paper about AI in hospitals", authors: "Jones A", journal: "BMJ Open", year: "2024", volume: "14", issue: "2", pages: "1008-12" }], "PubMed");
  R.addRecords(ctx, [{ title: k[0].title || "Known article", authors: "Page, Matthew J.", journal: "British Medical Journal", year: "2021" },
    { title: "Implementation of AI in hospitals (Embase title)", authors: "Jones, Anna", journal: "BMJ Open", year: "2024", volume: "14", issue: "2", pages: "1008-1012" },
    { title: "Embase only: nurses and decision support", authors: "Lee K", year: "2023" }], "Embase");
  R.addRecords(ctx, [{ title: "A PubMed-only paper on AI in hospitals", authors: "Jones A", year: "2025" }], "Web of Science");
  return true;`);
await sleep(1500);
const rec = await js(`return document.body.innerText`);
check(/Duplicates across databases/.test(rec) && /Recall per database/.test(rec), "records: overlap and recall cards");
check(/possible duplicate/.test(rec), "records: near-duplicate proposed for review");
check(/Linked automatically: A \(author \+ year \+ title \+ journal\): 1 · D \(author \+ volume \+ pages\): 1/.test(rec), "records: Bramer rules A (BMJ = British Medical Journal) and D (abbreviated pages) linked automatically");
const recall = await js(`return [...document.querySelectorAll(".stats .stat")].map(x => x.innerText.replace(/\\n/g, " ")).join(" | ")`);
console.log("   records stats:", recall);
check(/PubMed/.test(recall) && /Embase/.test(recall), "records: recall per database shown");

// ---------------------------------------------------------------- every step: renders, page button round trip
const steps = ["protocol", "search", "records", "verify", "fulltext", "screening", "extraction", "report"];
for (const step of steps) {
  await send("Page.navigate", { url: `${BASE}/#/p/${pid}/${step}` }); await sleep(1300);
  const before = errors.length;
  const hasBtn = await js(`return !!document.querySelector(".page-head .page-ask")`);
  await js(`document.querySelector(".page-head .page-ask").click(); return true`); await sleep(500);
  const prompt = await js(`const p=[...document.querySelectorAll("pre.prompt")].pop(); return p ? p.textContent : ""`);
  const fill = step === "search"
    ? { answer: `E2E answer ${step}`, blocks: [{ label: "E2E block", role: "include", terms: ["nurs*[tiab]"] }], validation: [], holdout: [], notes: "" }
    : { answer: `E2E answer ${step}`, notes: "" };
  if (step === "protocol") Object.assign(fill, { question: "", elements: [], criteria: [], screening_rules: "" });
  if (step === "extraction") fill.instructions = "";
  await js(`const t=[...document.querySelectorAll("textarea.answer")].pop(); t.value = ${JSON.stringify("Sure:\n```json\n" + JSON.stringify(fill) + "\n```")}; return true;`);
  await click("3 · Save answer"); await sleep(600);
  const shown = await js(`return [...document.querySelectorAll(".answer-text")].map(x => x.textContent).join(" ")`);
  let applied = true;
  if (step === "search") {
    await click("Apply"); await sleep(1500);
    applied = await js(`const s = await import("/js/store.js"); const p = await s.loadProject(window.__pid); return p.search.blocks.some(b => b.label === "E2E block");`);
  }
  await js(`document.querySelectorAll(".modal-head button").forEach(b => b.click()); return true`);
  check(hasBtn && /=== PAGE CONTENT ===/.test(prompt) && shown.includes(`E2E answer ${step}`) && applied && errors.length === before,
    `${step}: renders, page prompt (${prompt.length} chars), answer shown${step === "search" ? ", proposed block applied" : ""}${errors.length > before ? " ERRORS: " + errors.slice(before).join(" / ") : ""}`);
  if (process.env.SHOTS) { const shot = await send("Page.captureScreenshot", { format: "png" }); await (await import("node:fs/promises")).writeFile(join(process.env.SHOTS, `${step}.png`), Buffer.from(shot.result.data, "base64")); }
}

// Search: known articles first, jump bar.
await send("Page.navigate", { url: `${BASE}/#/p/${pid}/search` }); await sleep(1300);
check(await js(`const c = document.querySelector("#main .card"); return !!document.querySelector(".jumpbar") && c && c.id === "sec-known"`), "search: jump bar, known articles is the first card");

// ---------------------------------------------------------------- settings: model list (mocked provider)
await js(`localStorage.setItem("srp-settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("srp-settings") || "{}") })); return true`);
await js(`const st = await import("/js/store.js"); const s = st.getSettings(); const c = s.backends.find(b => b.kind === "anthropic"); c.apiKey = "test-key"; c.model = "claude-old-1"; c.modelChosen = true; c.modelsDate = new Date().toISOString().slice(0,10); c.models = []; st.setSettings(s); return true`);
await send("Page.navigate", { url: `${BASE}/#/settings` }); await sleep(1000);
await js(`const of = window.fetch; window.fetch = (u, o) => String(u).includes("api.anthropic.com/v1/models")
  ? Promise.resolve(new Response(JSON.stringify({ data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z" }, { id: "claude-haiku-5-5", created_at: "2026-09-01T00:00:00Z" }], has_more: false })))
  : of(u, o); return true`);
await js(`const card = document.getElementById("connection-claude"); [...card.querySelectorAll("button")].find(b => /Load (available )?models/.test(b.textContent)).click(); return true`);
await sleep(800);
const st = await js(`return document.body.innerText`);
check(/"claude-old-1" is not offered for this key/.test(st) && /Use claude-opus-5-5/.test(st), "settings: outdated model flagged, newest suggested");
check(/Sieve GPT in ChatGPT/.test(st), "settings: Sieve GPT card");
// A browser that still has the old built-in default saved: it is cleared on load, not shown as a model.
await js(`const st = await import("/js/store.js"); const raw = JSON.parse(localStorage.getItem("srp-settings") || "{}"); raw.backends = (raw.backends || st.DEFAULT_SETTINGS.backends).map(b => b.kind === "openai" ? { ...b, model: "gpt-5.5", modelChosen: undefined } : b); localStorage.setItem("srp-settings", JSON.stringify(raw)); return true`);
await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(500); await send("Page.navigate", { url: `${BASE}/#/settings` }); await sleep(1000);
const oa = await js(`const c = document.getElementById("connection-openai"); const i = c?.querySelector("input[list]"); return { value: i?.value, placeholder: i?.placeholder }`);
check(oa.value === "" && /Load available models/.test(oa.placeholder || ""), `settings: outdated default model not shown (${JSON.stringify(oa)})`);
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" / ") : ""}`);
await send("Page.navigate", { url: `${BASE}/#/p/${pid}/protocol` }); await sleep(800);
await js(`const s = await import("/js/store.js"); await s.deleteProject(window.__pid || ${JSON.stringify(pid)}); return true;`);

// ---------------------------------------------------------------- example project, tour and methods page
await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(1200);
await click("Try an example");
for (let i = 0; i < 60 && !/example-llm-screening/.test(await js(`return location.hash`)); i++) await sleep(500);
await sleep(800);
const exUrl = await js(`return location.hash`);
check(/#\/p\/example-llm-screening\/protocol/.test(exUrl), `home: example project opens (${exUrl})`);
for (const step of ["protocol", "search", "records", "verify", "fulltext", "screening", "extraction", "report"]) {
  const before = errors.length;
  await send("Page.navigate", { url: `${BASE}/#/p/example-llm-screening/${step}` }); await sleep(1500);
  const hasMethod = await js(`return [...document.querySelectorAll(".page-tools a")].some(a => a.getAttribute("href") === "#/methods/${step}")`);
  check(hasMethod && errors.length === before, `example ${step}: renders with a Method link${errors.length > before ? " ERRORS: " + errors.slice(before).join(" / ") : ""}`);
}
const exState = await js(`const s = await import("/js/store.js"); const p = await s.loadProject("example-llm-screening");
  return { records: p.records.length, dups: p.records.filter(r => r.duplicate_of).length, screening: Object.keys(p.screening.runs).length, extraction: Object.keys(p.extraction.runs).length };`);
console.log("   example:", JSON.stringify(exState));
check(exState.records > 20 && exState.dups > 0, "example: real records from two sources, duplicates linked");
check(exState.screening >= 1 && exState.extraction >= 1, "example: example screening and extraction runs present");
await send("Page.navigate", { url: `${BASE}/#/p/example-llm-screening/extraction` }); await sleep(2500);
const exCheck = await js(`const c = [...document.querySelectorAll(".card")].find(x => x.innerText.startsWith("Check the runs")); const a = c?.querySelector("a[href^='examples/prompts/']");
  const r = a ? await fetch(a.getAttribute("href")) : null; return { text: c?.innerText.replace(/\\s+/g, " "), prompt: r ? r.status + " " + (await r.text()).length : "no link", included: document.body.innerText.match(/Extract · (\\d+) included/)?.[1] };`);
console.log("   example extraction:", JSON.stringify(exCheck));
check(/100%|9\d%/.test(exCheck.text || "") && /^200 \d{4,}/.test(exCheck.prompt), "example extraction: quotes verified in the embedded texts, exact prompt published");
await send("Page.navigate", { url: `${BASE}/#/guide/screening` }); await sleep(1000);
await js(`const s = await import("/js/store.js"); await s.deleteProject("example-llm-screening"); return true`);
await click("Try screening");
for (let i = 0; i < 60 && !/example-llm-screening/.test(await js(`return location.hash`)); i++) await sleep(500);
await sleep(800);
check(/example-llm-screening\/screening/.test(await js(`return location.hash`)), "tour: 'Try screening' opens that step of the example project");

// ---------------------------------------------------------------- quick scan, worked examples, inclusion/exclusion flow
{
  const before = errors.length;
  await send("Page.navigate", { url: `${BASE}/#/p/example-llm-screening/scan` }); await sleep(2500);
  const gate = await js(`return { stages: document.querySelectorAll(".scan-stage").length, approve: /approve it/.test(document.getElementById("scan-plan")?.innerText || "") }`);
  await click("I checked the plan"); await sleep(2500);
  const sc = await js(`return { stages: document.querySelectorAll(".scan-stage").length, calib: !!document.querySelector("#scan-screen .runpanel"), side: !!document.querySelector(".scan-nav a.active") }`);
  console.log("   example project as scan:", JSON.stringify(gate), JSON.stringify(sc));
  check(gate.stages === 1 && gate.approve && sc.stages === 3 && sc.calib && sc.side && errors.length === before, `quick scan: plan approval first, then search, then the AI run for records without an AI answer${errors.length > before ? " ERRORS: " + errors.slice(before).join(" / ") : ""}`);
  await send("Page.navigate", { url: `${BASE}/#/p/example-llm-screening/screening` }); await sleep(2000);
  check(await js(`return !!document.querySelector(".step-intro .step-example dd") && !!document.querySelector(".criteria-flow .flow-row")`), "screening: worked example under the intro and the inclusion/exclusion chart");
  await send("Page.navigate", { url: `${BASE}/#/p/example-llm-screening/report` }); await sleep(1500);
  check(await js(`return !!document.querySelector(".criteria-flow") && !!document.querySelector(".prisma svg")`), "report: PRISMA diagram and inclusion/exclusion per criterion");

  await js(`const s = await import("/js/store.js"); const st = s.getSettings(); st.activeBackend = (st.backends.find(b => b.kind === "manual") || st.backends[0]).id; s.setSettings(st); return true`);
  await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(1500);
  await click("Quick scan first");
  for (let i = 0; i < 20 && !/\/scan$/.test(await js(`return location.hash`)); i++) await sleep(300);
  await sleep(1000);
  const scanHash = await js(`return location.hash`);
  check(/#\/p\/p-[\w]+\/scan$/.test(scanHash), `home: 'Quick scan first' opens a new scan (${scanHash})`);
  const plan = { framework: "PICO", elements: [{ key: "P", text: "doctoral students" }, { key: "I", text: "peer writing groups" }, { key: "C", text: "working alone" }, { key: "O", text: "writing confidence" }],
    criteria: [{ label: "Doctoral students", description: "participants are doctoral students" }, { label: "Peer writing group", description: "a peer writing group is studied" }],
    blocks: [{ label: "Doctoral", terms: ['"doctoral student*"[tiab]', '"PhD student*"[tiab]'] }, { label: "Writing groups", terms: ['"writing group*"[tiab]'] }],
    fields: [{ label: "Design", description: "study design", type: "text" }], notes: "check the comparison" };
  await js(`const t = document.querySelector("#scan-plan .chat textarea.answer"); t.value = ${JSON.stringify("Here is the plan: " + JSON.stringify(plan))}; return true`);
  await click("3 · Save answer"); await sleep(1500);
  const after = await js(`const s = await import("/js/store.js"); const p = await s.loadProject(location.hash.split("/")[2]);
    return { criteria: p.criteria.length, blocks: p.search.blocks.length, fields: p.extraction.fields.length, plan: !!document.querySelector(".scan-plan"), search: !!document.getElementById("scan-search") }`);
  await click("I checked the plan"); await sleep(1500);
  const approved = await js(`return !!document.getElementById("scan-search") && !!document.querySelector(".scan-press")`);
  console.log("   new scan after plan:", JSON.stringify(after), "approved → search + PRESS:", approved);
  check(after.criteria === 2 && after.blocks === 2 && after.fields === 1 && after.plan && !after.search && approved, "quick scan: pasted plan fills criteria, blocks and fields; the search opens only after your approval, with the PRESS check");
  await js(`const s = await import("/js/store.js"); await s.deleteProject(location.hash.split("/")[2]); return true`);
}

// ---------------------------------------------------------------- example scan with recorded answers: replay, then edit → new call
{
  const before = errors.length;
  await send("Page.navigate", { url: `${BASE}/#/` }); await sleep(1500);
  await click("See an example scan"); await sleep(800);
  await js(`document.querySelector(".scan-example-pick")?.click(); return 1`);
  for (let i = 0; i < 20 && !/\/scan$/.test(await js(`return location.hash`)); i++) await sleep(300);
  await sleep(1500);
  check(await js(`return !!document.querySelector(".scan-cache") && /Use the example answer/.test(document.getElementById("scan-plan")?.innerText || "")`), "example scan: picked on the home page, plan offers the recorded answer");
  const playOn = async () => { await js(`[...document.querySelectorAll(".scan-cache button")].find(b => /^Play/.test(b.textContent.trim()))?.click(); return 1`); await sleep(2500); };
  await playOn();
  check(await js(`return /approve it/.test(document.getElementById("scan-plan")?.innerText || "") && !document.getElementById("scan-search")`), "example scan: play stops at the plan for your approval (no search before the protocol)");
  await click("I checked the plan"); await sleep(1500);
  await playOn();
  for (let i = 0; i < 60 && !(await js(`return !!document.querySelector(".scan-check-card")`)); i++) await sleep(1000);
  check(await js(`return /Your screening/.test(document.querySelector(".scan-check-head")?.innerText || "") && !document.querySelector(".scan-check-ai") && document.querySelectorAll(".scan-mode input").length === 2`), "example scan: you screen blind by default (AI as independent second reviewer), the faster mode is a choice");
  // Decide every record as the AI suggested (so the recorded extraction and summary still fit).
  const decided = await js(`const a = await import("/js/app.js"); let n = 0;
    for (let i = 0; i < 80; i++) {
      const card = document.querySelector(".scan-check-card"); if (!card) break;
      const rid = card.querySelector(".muted.small").textContent.split(" · ")[0].trim();
      const p = a.ctx.project; const ai = Object.values(p.screening.runs).map(R => R.results?.[rid]).find(Boolean);
      const btns = [...card.querySelectorAll("button")];
      if (ai.decision === "Exclude") {
        btns.find(b => b.textContent.startsWith("Exclude")).click();
        const k = p.criteria.findIndex(c => ai.criteria?.[c.id] === "No");
        const reasons = [...card.querySelectorAll(".scan-check-reasons button")];
        (k >= 0 ? reasons[k] : reasons[reasons.length - 1]).click();
      } else btns.find(b => b.textContent.startsWith(ai.decision)).click();
      n++; await new Promise(r => setTimeout(r, 30));
    }
    return n;`);
  await sleep(2000);
  const afterScreen = await js(`const a = await import("/js/app.js"); const p = a.ctx.project; const h = Object.values(p.screening.human);
    return { human: h.length, blind: h.filter(x => x.blind).length, kappa: (document.getElementById("scan-screen")?.innerText.match(/κ = ([0-9.]+)/) || [])[1] }`);
  console.log("   your screening:", decided, JSON.stringify(afterScreen));
  check(afterScreen.human === 32 && afterScreen.blind === 32 && afterScreen.kappa === "1.00", "example scan: 32 blind decisions by you, agreement with the AI (κ) shown");
  await playOn();
  for (let i = 0; i < 120 && !(await js(`return /Your check ·/.test(document.getElementById("scan-extract")?.innerText || "")`)); i++) await sleep(1000);
  const checkedPapers = await js(`let n = 0; for (let i = 0; i < 20; i++) { const b = [...document.querySelectorAll("#scan-extract button")].find(x => x.textContent.startsWith("Values checked")); if (!b) break; b.click(); n++; await new Promise(r => setTimeout(r, 100)); } return n;`);
  await sleep(2000);
  await playOn(); await sleep(1500);
  const sum = await js(`return { draft: /approve it/.test(document.getElementById("scan-summary")?.innerText || ""), answer: !!document.querySelector(".scan-answer") }`);
  check(checkedPapers === 7 && sum.answer && sum.draft, `example scan: you check the values of all 7 papers; the recorded summary appears as a draft for your approval (${checkedPapers} checked)`);
  await click("I checked the summary"); await sleep(2000);
  const fin = await js(`const t = document.body.innerText; return { approved: /Checked and approved by you/.test(t), disclosure: document.querySelectorAll(".scan-disclosure li").length, routes: document.querySelectorAll(".scan-deeper-route").length, rec: document.querySelector(".scan-deeper-rec")?.innerText,
    limits: document.querySelector(".scan-limits")?.innerText.includes("screened every record independently of the AI") }`);
  console.log("   finished scan:", JSON.stringify(fin));
  check(fin.approved && fin.disclosure >= 4 && fin.routes === 3 && /systematic review/.test(fin.rec || "") && fin.limits, "example scan: approved summary, AI use disclosure, limitations and go-deeper advice per route");
  // Recorded quotes are found word for word in the source.
  const q = await js(`const s = await import("/js/store.js"); const u = await import("/js/util.js"); const sc = await import("/js/views/screening.js"); const a = await import("/js/app.js");
    const p = a.ctx.project; const bad = []; let n = 0;
    for (const R of Object.values(p.screening.runs)) for (const [rid, x] of Object.entries(R.results)) { const r = p.records.find(y => y.rid === rid); const src = sc.sourceText(p, r, "");
      for (const f of x.failed_criteria || []) { n++; if (!u.quoteInSource(f.evidence_quote, src)) bad.push(rid + ": " + f.evidence_quote.slice(0, 50)); } }
    for (const R of Object.values(p.extraction.runs)) for (const [rid, x] of Object.entries(R.results)) { const r = p.records.find(y => y.rid === rid); const src = sc.sourceText(p, r, await s.getText(p.id, rid));
      for (const [k, v] of Object.entries(x.fields || {})) if (v.quote) { n++; if (!u.quoteInSource(v.quote, src)) bad.push(rid + "/" + k + ": " + v.quote.slice(0, 50)); } }
    return { n, bad };`);
  console.log("   recorded quotes:", q.n, "not found:", JSON.stringify(q.bad));
  check(q.n > 50 && q.bad.length === 0, "example scan: every recorded quote is found word for word in the source");
  // The steps teach the official method for this review type.
  const pid = await js(`return location.hash.split("/")[2]`);
  await send("Page.navigate", { url: `${BASE}/#/p/${pid}/screening` }); await sleep(2000);
  check(await js(`const b = document.querySelector(".method-box"); return !!b && /Systematic review/.test(b.innerText) && /MECIR C39/.test(b.innerText) && b.querySelectorAll("table.compare th").length >= 4`), "steps: Official method box with the rule, its source and the route comparison");
  // Edit one criterion: your decisions and the AI suggestions are marked out of date.
  await send("Page.navigate", { url: `${BASE}/#/p/${pid}/scan` }); await sleep(3000);
  await js(`const a = await import("/js/app.js"); a.ctx.project.criteria[1].description += " (including online groups)"; await a.ctx.save(true); a.ctx.rerender(); return 1`);
  await sleep(3000);
  const edited = await js(`const t = document.getElementById("scan-screen")?.innerText || ""; return { yours: (t.match(/([0-9]+) of your decisions were made with an earlier/) || [])[1] }`);
  console.log("   after editing a criterion:", JSON.stringify(edited));
  check(edited.yours === "32", "example scan: editing a criterion marks your 32 decisions as made under earlier criteria");
  check(errors.length === before, `example scan: no page errors${errors.length > before ? ": " + errors.slice(before).join(" / ") : ""}`);
  await js(`const s = await import("/js/store.js"); await s.deleteProject(location.hash.split("/")[2]); return true`);
}

// ---------------------------------------------------------------- public site: no contact with this device unless asked
const requests = [];
const onReq = e => { const m = JSON.parse(e.data); if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url); };
ws.addEventListener("message", onReq);
for (const path of ["#/", "#/settings"]) { await send("Page.navigate", { url: `http://sieve.test:${PORT}/${path}` }); await sleep(1500); }
const local = requests.filter(u => /\/\/(127\.0\.0\.1|localhost)[:/]/.test(u));
check(local.length === 0, `public site: no request to this device on its own${local.length ? ": " + local.join(", ") : ""}`);
check(await js(`return [...document.querySelectorAll("button")].some(b => b.textContent.includes("Connect to the local helper"))`), "public site: opt-in button for the local helper");
ws.removeEventListener("message", onReq);
ws.close();
await cleanup();
console.log(process.exitCode ? "FAILED" : "all checks passed");
process.exit(process.exitCode || 0);
