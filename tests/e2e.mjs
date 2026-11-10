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
await send("Page.navigate", { url: `${BASE}/#/methods/extraction` }); await sleep(1000);
const mt = await js(`return document.body.textContent`);   // steps are collapsible: include folded sections
check(await js(`return document.getElementById("m-extraction")?.open === true`) && /Methods & guidance/.test(mt) && /PROBAST\+AI/.test(mt) && /Waffenschmidt/.test(mt) && /Bramer/.test(mt), "methods page: guidance with sources per step");
await js(`const s = await import("/js/store.js"); await s.deleteProject("example-llm-screening"); return true`);

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
