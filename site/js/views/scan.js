// Quick scan: one page from question to a cited answer. Each stage shows a worked example until it is done,
// asks the chosen AI route (copy-paste, API or local model) for the suggestion, and writes the result into the
// normal project fields, so the eight steps can take over at any point ("continue as a full review").
//
// Example scans (site/examples/scans/<id>.json) carry recorded answers keyed by a fingerprint of their exact
// input (scanKeys in scan.js): unchanged inputs replay instantly, edited inputs need a real call. Every result
// keeps its fingerprint (_key), so an answer made before an edit is shown as out of date.
// The helpers are exported for tools/build-scan-example.mjs, which records examples with this same code.
import { h, clear, toast, download, copy, fmt } from "../util.js";
import { card, btn, help, row, field, textarea, select, badge, runPanel, activeBackend, progress, table } from "../ui.js";
import { stageIcon } from "../icons.js";
import { getText } from "../store.js";
import { pmQuery } from "../query.js";
import { pmCount, pmIds, pmFetch, europePmcPage } from "../apis.js";
import { ctgovQuery, ctgovSearch, ctgovToRecord } from "../registers.js";
import { REVIEW_TYPES } from "../review-plan.js";
import { SYSTEM_SCREEN, screeningPrompt, screeningSchema, screeningBatchSchema, sourceBlock,
  SYSTEM_EXTRACT, extractionPrompt, extractionSchema, extractionBatchSchema, modelFields, recordValue } from "../prompts.js";
import { SCAN_STAGES, SCAN_EXAMPLES, SYSTEM_SCAN, scanPlanPrompt, scanPlanSchema, applyScanPlan, epmcQuery, epmcToRecord,
  scanSummaryPrompt, scanSummarySchema, scanLimits, summaryMarkdown, surname, scanKeys, aiUseDisclosure, goDeeperAdvice } from "../scan.js";
import { screenCheckCard, extractCheckCard, calibrationResult, disclosureInfo, screeningComplete, screenMode, SCREEN_MODES } from "./scan-check.js";
import { active, addRecords } from "./records.js";
import { isInclude } from "./screening.js";
import { fetchAuto } from "./fulltext.js";
import { counts, prisma, criteriaFlowChart } from "./flow.js";
import { robCard, robDone, robOverallLabel, humanRob, toolFor } from "./rob.js";
import { certaintyCard, certaintyDone, findingKey } from "./certainty.js";
import { secondReviewerCard, blindCopyBanner } from "./team.js";
import { isBlindCopy, compareScreening, compareExtraction, reviewers } from "../team.js";
import { aiFlags } from "./scan-check.js";
import { autoCard, manuscriptCard } from "./auto.js";

const today = () => new Date().toISOString().slice(0, 10);
const normDecision = d => { const s = String(d || "").toLowerCase(); return s.startsWith("incl") ? "Include" : s.includes("snowball") ? "Exclude, but save for snowballing" : s.startsWith("excl") ? "Exclude" : "Unclear"; };
const hasText = (p, rid) => p.fulltext[rid] && !p.fulltext[rid].failed;
const noDot = s => String(s || "").trim().replace(/\.$/, "");
const EMPTY = v => v === undefined || v === null || v === "" || v === "NR" || v === "NA";

// ------------------------------------------------------------------ fresh results (made with the current inputs)
function taResults(p, r) {
  const key = scanKeys.screen(p, r);
  const res = Object.values(p.screening.runs).filter(R => (R.stage || "ta") === "ta").map(R => R.results?.[r.rid]).filter(x => x && !x._error);
  return { key, fresh: res.filter(x => !x._key || x._key === key), stale: res.filter(x => x._key && x._key !== key) };
}
export function scanDecision(p, r) {
  const hum = p.screening.human?.[r.rid]?.decision;
  if (hum) return hum;
  const inc = [...new Set(taResults(p, r).fresh.map(x => isInclude(x.decision)))];
  if (!inc.length) return null;
  return inc.length === 1 ? (inc[0] === true ? "Include" : inc[0] === false ? "Exclude" : "Unclear") : "Unclear";
}
// Papers that go on to full text and extraction: included, plus unclear ones unless the user turns that off.
export function scanSelected(p) {
  const keepUnclear = p.scan?.keep_unclear !== false;
  return active(p).filter(r => { const d = scanDecision(p, r); return d && (isInclude(d) === true || (keepUnclear && isInclude(d) === null)); });
}
export async function loadTexts(p, recs) {
  const texts = {};
  await Promise.all(recs.filter(r => hasText(p, r.rid)).map(async r => (texts[r.rid] = await getText(p.id, r.rid))));
  return texts;
}
function exResults(p, r, texts) {
  const key = scanKeys.extract(p, r, texts[r.rid], modelFields(p.extraction.fields));
  const res = Object.values(p.extraction.runs).map(R => R.results?.[r.rid]).filter(x => x && !x._error);
  return { key, fresh: res.filter(x => !x._key || x._key === key), stale: res.filter(x => x._key && x._key !== key) };
}
// Value for the summary: your own value first, then the record (title, year…), then a fresh model value.
function scanValue(p, r, f, fresh) {
  const hv = p.extraction.human?.[r.rid]?.[f.id];
  if (!EMPTY(hv)) return hv;
  const rv = recordValue(f, r);
  if (rv !== null) return rv;
  return fresh.map(x => x.fields?.[f.id]?.value).find(v => !EMPTY(v)) ?? "";
}
// The values of one paper as shown in tables: [label, value] per field.
export function paperValues(p, r, texts) {
  const fresh = exResults(p, r, texts).fresh;
  return p.extraction.fields.map(f => [f.label, scanValue(p, r, f, fresh)]);
}
export function papersForSummary(p, texts) {
  return scanSelected(p).map(r => {
    const fresh = exResults(p, r, texts).fresh;
    const vals = p.extraction.fields.map(f => [f.label, scanValue(p, r, f, fresh)]).filter(([, v]) => !EMPTY(v));
    const rob = robOverallLabel(p, r.rid);
    if (rob && vals.length) vals.push(["Risk of bias / quality (judged by the reviewer)", rob]);
    return { rid: r.rid, rob, cite: `${surname(r.authors)} ${r.year || ""}. ${noDot(r.title)}. ${r.journal || ""}${hasText(p, r.rid) ? "" : " (abstract only)"}`,
      lines: vals.length ? vals.map(([k, v]) => `${k}: ${v}`) : [`ABSTRACT: ${String(r.abstract || "").slice(0, 1500)}`] };
  });
}

// ------------------------------------------------------------------ saving answers (from a run or from the cache)
export function saveScreen(p, rid, json, run, key) {
  const R = (p.screening.runs[run.id] ||= { label: run.label, model: run.model, backend: run.backend, date: run.date, stage: "ta", results: {} });
  R.results[rid] = json._error ? json : { ...json, decision: normDecision(json.decision), _key: key };
}
export function saveExtract(p, rid, json, run, key) {
  (p.extraction.runs[run.id] ||= { label: run.label, model: run.model, backend: run.backend, date: run.date, results: {} }).results[rid] = json._error ? json : { ...json, _key: key };
}
export function savePlan(p, json, model, key) {
  const question = p.protocol.question, prompt = scanPlanPrompt(p);
  applyScanPlan(p, json);
  Object.assign(p.scan.plan, { model, question, prompt, _key: key });
}
const cacheRun = cache => ({ id: "example", label: `Example answers (${cache.model}, recorded ${cache.date})`, model: cache.model, backend: "example cache", date: today() });

export function applyCachedPlan(p, cache) {
  const key = scanKeys.plan(p), a = cache?.answers?.[key];
  if (!a) return false;
  savePlan(p, a, `${cache.model} (example answer)`, key);
  return true;
}
export function applyCachedScreen(p, cache) {
  let hit = 0, miss = 0;
  for (const r of active(p)) {
    if (p.screening.human?.[r.rid]?.decision) continue;
    const t = taResults(p, r);
    if (t.fresh.length) continue;
    const a = cache?.answers?.[t.key];
    if (a) { saveScreen(p, r.rid, a, cacheRun(cache), t.key); hit++; } else miss++;
  }
  return { hit, miss };
}
export function applyCachedExtract(p, cache, texts) {
  let hit = 0, miss = 0;
  for (const r of scanSelected(p)) {
    const t = exResults(p, r, texts);
    if (t.fresh.length) continue;
    const a = cache?.answers?.[t.key];
    if (a) { saveExtract(p, r.rid, a, cacheRun(cache), t.key); hit++; } else miss++;
  }
  return { hit, miss };
}
export function applyCachedSummary(p, cache, texts) {
  const key = scanKeys.summary(p, papersForSummary(p, texts)), a = cache?.answers?.[key];
  if (!a) return false;
  p.scan.summary = { ...a, model: `${cache.model} (example answer)`, date: cache.date, _key: key };
  return true;
}

// ------------------------------------------------------------------ example cache
const caches = {};
export async function loadCache(id) {
  if (!id) return null;
  if (!(id in caches)) caches[id] = fetch(`examples/scans/${id}.json`, { cache: "no-cache" }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  return caches[id];
}

export const aiTA = (p, r) => taResults(p, r).fresh[0] || null;
export const aiEx = (p, r, texts) => exResults(p, r, texts).fresh[0] || null;
export const exKey = (p, r, texts) => exResults(p, r, texts).key;
const extractChecked = (p, r, texts) => p.scan?.extract_checked?.[r.rid]?._key === exKey(p, r, texts);

export function stageState(p, texts) {
  const recs = active(p), sel = scanSelected(p);
  const summaryKey = p.scan?.summary ? scanKeys.summary(p, papersForSummary(p, texts)) : "";
  const hasPlan = !!(p.criteria.length && p.search.blocks.length && p.extraction.fields.length);
  return {
    planDrafted: hasPlan,
    plan: hasPlan && !!p.scan?.plan?.approved,
    search: !!p.scan?.search || p.records.length > 0,
    screenAI: recs.length > 0 && recs.every(r => p.screening.human?.[r.rid]?.decision || taResults(p, r).fresh.length),
    screen: screeningComplete(p, recs, rid => aiTA(p, recs.find(r => r.rid === rid))),
    texts: !!p.scan?.texts_tried || (sel.length > 0 && sel.every(r => p.fulltext[r.rid])),
    extractAI: sel.length > 0 && sel.every(r => exResults(p, r, texts).fresh.length),
    extract: sel.length > 0 && sel.every(r => extractChecked(p, r, texts)),
    appraise: robDone(p, sel) || !!p.scan?.rob_skipped,
    summary: !!p.scan?.summary?.approved && (!p.scan.summary._key || p.scan.summary._key === summaryKey),
    summaryDrafted: !!p.scan?.summary && (!p.scan.summary._key || p.scan.summary._key === summaryKey),
    summaryStale: !!p.scan?.summary?._key && p.scan.summary._key !== summaryKey,
  };
}

export function facts(p, texts) {
  const c = counts(p), recs = active(p), sel = scanSelected(p);
  const cal = calibrationResult(p, rid => aiTA(p, recs.find(r => r.rid === rid)));
  const info = disclosureInfo(p, recs, sel, rid => aiTA(p, recs.find(r => r.rid === rid)), cal);
  return { identified: c.identified, duplicates: c.duplicates, screened: c.screened, humanChecked: c.taHuman,
    selected: sel.length, withText: sel.filter(r => hasText(p, r.rid)).length, calibration: cal, screenMode: screenMode(p),
    extractChecked: sel.filter(r => extractChecked(p, r, texts)).length, second: secondFacts(p, recs, sel), rob: robFacts(p, sel), certainty: certaintyFacts(p),
    disclosure: aiUseDisclosure({ ...info, rob: robInfo(p, sel), certainty: p.certainty?.ai && certaintyFacts(p) ? { approach: certaintyFacts(p), model: p.certainty.ai.model } : null }) };
}
const aiOfScan = (p, recs) => rid => aiTA(p, recs.find(r => r.rid === rid));
function secondFacts(p, recs, sel) {
  const names = reviewers(p);
  if (!names.length) return null;
  const n = names[0];
  const s = compareScreening(p, n, recs.map(r => r.rid));
  const e = compareExtraction(p, n, sel.map(r => r.rid), modelFields(p.extraction.fields));
  return { name: n, screening: s.n > 0 && !s.missingOther && !s.open.length, kappa: s.kappa, conflicts: s.conflicts.length,
    flagged: recs.filter(r => p.screening.human?.[r.rid]?.ai_checked).length, extraction: e.papers && e.papers >= sel.length && !e.conflicts.length ? e : null };
}
function robFacts(p, sel) {
  if (!robDone(p, sel)) return null;
  const tools = [...new Set(sel.map(r => toolFor(p, r.rid).name))].join(", ");
  const names = reviewers(p);
  return { done: true, tools, second: names.some(n => sel.every(r => p.team.reviewers[n].rob?.[r.rid])) };
}
function robInfo(p, sel) {
  const done = sel.filter(r => humanRob(p, r.rid));
  if (!done.length) return null;
  const models = [...new Set(Object.values(p.rob?.runs || {}).map(r => r.model || r.label).filter(Boolean))];
  return models.length ? { models, n: done.length, changed: done.reduce((k, r) => k + (humanRob(p, r.rid).ai_changed || 0), 0) } : null;
}
function certaintyFacts(p) {
  const f = scanFindings(p);
  return f.length && certaintyDone(p, f) ? (p.certainty.approach === "cerqual" ? "GRADE-CERQual" : "GRADE") : null;
}
export const scanFindings = p => (p.scan?.summary?.findings || []).map(x => ({ finding: x.statement, paper_ids: x.paper_ids || [] }));

const example = id => h("div", { class: "scan-example" }, h("div", { class: "scan-example-k" }, "Example"),
  h("dl", {}, SCAN_EXAMPLES[id].flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));

let showExamples = true;   // off when a recorded example is open: its own answers are the example
function stageCard(n, s, done, ...body) {
  return h("section", { class: `card scan-stage${done ? " done" : ""}`, id: `scan-${s.id}` },
    h("div", { class: "scan-stage-head" }, h("span", { class: `scan-num${done ? " done" : ""}` }, done ? "✓" : n),
      h("div", {}, h("h3", {}, s.label), h("p", { class: "muted small" }, s.what))),
    !done && showExamples && example(s.id), ...body);
}
const cachedBtn = (label, fn) => btn([stageIcon("play"), label], fn, "primary cached-btn");
const scrollTo = id => setTimeout(() => document.getElementById(`scan-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);

export async function render(m, ctx) {
  const p = ctx.project;
  p.scan ||= {};
  if (isBlindCopy(p)) return secondWork(m, ctx);
  const cache = await loadCache(p.scan.example);
  if (cache && !p.scan.caps) p.scan.caps = { ...cache.caps };
  showExamples = !cache;
  const texts = await loadTexts(p, scanSelected(p));
  const st = stageState(p, texts);
  const type = REVIEW_TYPES[p.protocol.review_type];
  const firstOpen = SCAN_STAGES.findIndex(s => !st[s.id]);

  m.append(h("div", { class: "scan-intro" },
    h("p", { class: "lead" }, "From a question to a cited answer in one page. At every stage the AI makes a suggestion and you decide: no step is left to the AI alone."),
    h("p", { class: "small muted" }, "An AI-assisted evidence scan, not a systematic or rapid review: open databases, one human reviewer with the AI as check, open-access texts. ",
      h("a", { href: "#/methods/scan" }, "Which guidance it follows"), ". ",
      "Everything is saved in this project, so you can continue it as a ", type ? type.label.toLowerCase() : "full review", " at any time.")));
  if (cache) m.append(h("div", { class: "card scan-cache" },
    h("div", {}, h("strong", {}, `Example: ${cache.name}`), h("p", { class: "small" },
      `Every AI answer for this question was recorded (${cache.model}, ${cache.date}), so the whole scan plays without a key or a call. `,
      "Change the question, a criterion, a field or the search terms and only that part needs your own AI route.")),
    row(firstOpen >= 0 && btn([stageIcon("play"), firstOpen ? "Play the rest of the example" : "Play the example"], () => play(ctx, cache), "primary"),
      h("span", { class: "muted small" }, "or go stage by stage below"))));
  m.append(autoCard(ctx, cache));
  m.append(h("nav", { class: "scan-rail", "aria-label": "Scan stages" }, SCAN_STAGES.map((s, i) =>
    h("a", { href: `#/p/${p.id}/scan`, class: `scan-chip${st[s.id] ? " done" : i === firstOpen ? " current" : ""}`,
      onclick: e => { e.preventDefault(); scrollTo(s.id); } },
      h("span", { class: "scan-num" }, st[s.id] ? "✓" : i + 1), s.label))));

  m.append(planStage(ctx, st, cache));
  if (st.plan) m.append(searchStage(ctx, st, cache));
  if (st.plan && st.search) m.append(screenStage(ctx, st, cache));
  if (st.screen) {
    m.append(textsStage(ctx, st));
    m.append(extractStage(ctx, st, cache, texts));
    if (st.extract) m.append(appraiseStage(ctx, st, texts));
    m.append(summaryStage(ctx, st, cache, texts));
    m.append(continueCard(ctx, texts));
  }
  const ms = manuscriptCard(ctx, texts);
  if (ms) m.append(ms);
  if (firstOpen > 0) setTimeout(() => document.getElementById(`scan-${SCAN_STAGES[firstOpen]?.id}`)?.scrollIntoView({ block: "start" }), 60);
}

// Replays the recorded AI answers in order. It stops where a person has to act (approve the plan, screen, check the
// values, approve the summary) and where an answer is missing because something was changed.
export async function play(ctx, cache) {
  const p = ctx.project;
  const quiet = { get project() { return p; }, save: () => ctx.save(), rerender() {}, go: ctx.go };
  const stop = (id, msg, kind = "warn") => { ctx.save(true); ctx.rerender(); if (msg) toast(msg, kind); scrollTo(id); };
  if (!(p.criteria.length && p.search.blocks.length && p.extraction.fields.length) && !applyCachedPlan(p, cache))
    return stop("plan", "The question differs from the example: ask your AI route for the plan.");
  if (!p.scan.plan?.approved) return stop("plan", "Your turn: check the plan and approve it, then play on.", "ok");
  if (!p.scan.search && !p.records.length) {
    const pq = pmQuery(p.search.blocks), eq = epmcQuery(p.search.blocks);
    if (cache.search?.key !== scanKeys.search(pq, eq, p.scan.caps)) return stop("search", "The search differs from the example: run it live.");
    toast("Loading the example search…");
    await runSearch(quiet, pq, eq, null, cache.search);
  }
  const s = applyCachedScreen(p, cache);
  if (s.miss) return stop("screen", `${s.hit} answers replayed; ${s.miss} papers are new or changed and need your AI route.`);
  if (active(p).some(r => !p.screening.human?.[r.rid]?.decision)) return stop("screen", "Your turn: screen the calibration sample, then decide each record with the AI suggestion. Then play on.", "ok");
  const missing = scanSelected(p).filter(r => !p.fulltext[r.rid]);
  if (missing.length) { toast(`Collecting open-access texts for ${missing.length} papers…`); p.scan.texts_tried = today(); await fetchAuto(quiet, missing, { set() {} }, null); }
  const texts = await loadTexts(p, scanSelected(p));
  const e = applyCachedExtract(p, cache, texts);
  if (e.miss) return stop("extract", `${e.hit} answers replayed; ${e.miss} papers need your AI route (new, changed, or a full text that differs from the example).`);
  if (scanSelected(p).some(r => !extractChecked(p, r, texts))) return stop("extract", "Your turn: check the extracted values against their quotes. Then play on.", "ok");
  if (!robDone(p, scanSelected(p)) && !p.scan.rob_skipped) return stop("appraise", "Your turn: appraise the studies with the tool for their design, or skip appraisal for this scan (reported as a limitation).", "ok");
  if (!p.scan.summary || p.scan.summary._key !== scanKeys.summary(p, papersForSummary(p, texts))) {
    if (!applyCachedSummary(p, cache, texts)) return stop("summary", "Your checked data differ from the example: write the summary with your AI route.");
  }
  if (!p.scan.summary.approved) return stop("summary", "Your turn: check the summary against the papers and approve it.", "ok");
  stop("summary", "Example complete", "ok");
}

// ------------------------------------------------------------------ 1 · plan
function planStage(ctx, st, cache) {
  const p = ctx.project;
  const q = textarea(p.protocol.question, v => { p.protocol.question = v; ctx.save(); }, { rows: 2, placeholder: "What do you want to find out?" });
  const panel = h("div");
  const drawPanel = () => clear(panel).append(runPanel({
    title: "scan-plan", system: SYSTEM_SCAN, batchable: false, runName: "plan",
    items: p.protocol.question.trim() ? [{ id: "plan", label: "Plan for this question" }] : [],
    build: () => ({ prompt: scanPlanPrompt(p), schema: scanPlanSchema, name: "scan_plan" }),
    save: (id, json, run) => { if (json._error) return toast(json._error, "err"); savePlan(p, json, run.model || run.label, scanKeys.plan(p)); },
    done: () => { ctx.save(); ctx.rerender(); },
  }));
  q.addEventListener("change", () => { drawPanel(); ctx.rerender(); });
  const body = [field("Question", q)];
  const hit = !st.planDrafted && cache?.answers?.[scanKeys.plan(p)];
  if (st.planDrafted) {
    if (p.scan.plan?.question && p.scan.plan.question !== p.protocol.question)
      body.push(h("p", { class: "badge warn" }, "The question changed after this plan was made: ask for a new plan below, or keep this one."));
    body.push(h("div", { class: "scan-plan" },
      h("div", {}, h("h4", {}, `${p.protocol.framework}`), h("ul", {}, p.protocol.elements.filter(e => e.text).map(e => h("li", {}, h("strong", {}, e.label), ": ", e.text))),
        h("a", { class: "small", href: `#/p/${p.id}/protocol` }, "Edit in step 1 →")),
      h("div", {}, h("h4", {}, "Criteria · all must be met"), h("ol", {}, p.criteria.map(c => h("li", {}, h("strong", {}, c.label), ": ", c.description))),
        h("a", { class: "small", href: `#/p/${p.id}/protocol` }, "Edit criteria →")),
      h("div", {}, h("h4", {}, "Search blocks · AND"), h("ul", {}, p.search.blocks.filter(b => b.enabled !== false).map(b => h("li", {}, h("strong", {}, b.label), ": ", h("span", { class: "mono small" }, b.terms.join(" OR "))))),
        h("a", { class: "small", href: `#/p/${p.id}/search` }, "Tune with live counts in step 2 →")),
      h("div", {}, h("h4", {}, "Data fields"), h("ul", {}, p.extraction.fields.map(f => h("li", {}, h("strong", {}, f.label), f.description ? `: ${f.description}` : ""))),
        h("a", { class: "small", href: `#/p/${p.id}/extraction` }, "Edit the form in step 7 →"))));
    if (p.scan.plan?.notes) body.push(help(h("strong", {}, "Check first: "), p.scan.plan.notes));
    if (p.scan.plan?.model) body.push(h("p", { class: "muted small" }, `Drafted by ${p.scan.plan.model}, ${p.scan.plan.date}.`));
    if (!p.scan.plan?.approved) body.push(h("div", { class: "scan-approve" },
      help("Check the criteria, search blocks and fields above (edit them in steps 1, 2 and 7 if needed). Approving fixes them, with today's date, as the protocol of this scan: the criteria are set before you search (Cochrane rapid review guidance, rec. 2)."),
      btn("I checked the plan: approve it", () => {
        p.scan.plan ||= { notes: "", date: today(), model: "you (protocol made in step 1)" };
        p.scan.plan.approved = today();
        p.scan.protocol = { date: today(), question: p.protocol.question, elements: structuredClone(p.protocol.elements), criteria: structuredClone(p.criteria),
          blocks: structuredClone(p.search.blocks), fields: structuredClone(p.extraction.fields) };
        ctx.save(); ctx.rerender();
      }, "primary")));
    else body.push(h("p", { class: "muted small" }, `Approved by you on ${p.scan.plan.approved}: this is the protocol of the scan.`));
    body.push(h("details", { class: "advanced" }, h("summary", {}, "Ask for a new plan (replaces criteria, blocks and fields)"), panel));
  } else if (hit) {
    body.push(row(cachedBtn("Use the example answer", () => { applyCachedPlan(p, cache); ctx.save(); ctx.rerender(); }), h("span", { class: "muted small" }, `instant · recorded with ${cache.model}`)),
      h("details", { class: "advanced" }, h("summary", {}, "or ask your own AI route"), panel));
  } else {
    if (cache) body.push(h("p", { class: "badge warn" }, "Your question differs from the example, so the recorded plan does not fit: ask your AI route."));
    body.push(help("Your AI route drafts the criteria, the search blocks and the data fields. With copy-paste: copy, paste in the chat, paste the answer back."), panel);
  }
  drawPanel();
  return stageCard(1, SCAN_STAGES[0], st.plan, ...body);
}

// ------------------------------------------------------------------ 2 · search
function searchStage(ctx, st, cache) {
  const p = ctx.project;
  const manual = activeBackend().kind === "manual";
  p.scan.caps ||= manual ? { pubmed: 60, europepmc: 40 } : { pubmed: 200, europepmc: 100 };
  const pq = pmQuery(p.search.blocks), eq = epmcQuery(p.search.blocks);
  const countsEl = h("span", { class: "muted small" });
  const prog = progress();
  const capSel = key => select(String(p.scan.caps[key]), [20, 40, 60, 100, 200, 400].map(n => [String(n), `${n} most relevant`]), v => { p.scan.caps[key] = Number(v); ctx.save(); ctx.rerender(); });
  const s = p.scan.search;
  const frozen = !s && !p.records.length && cache?.search?.key === scanKeys.search(pq, eq, p.scan.caps) ? cache.search : null;
  const body = [
    h("details", { class: "inline" }, h("summary", {}, "The two queries"), h("h4", {}, "PubMed"), h("pre", {}, pq || "(no blocks)"),
      h("h4", {}, "Europe PMC: preprints and PubMed Central articles not in PubMed"), h("pre", {}, eq || "(no blocks)")),
    h("label", { class: "check small" }, h("input", { type: "checkbox", checked: !!p.scan.caps.registers, onchange: e => { p.scan.caps.registers = e.target.checked ? 50 : 0; ctx.save(); ctx.rerender(); } }),
      " Also search ClinicalTrials.gov: registered trials, completed or not (MECIR C27; relevant for interventions)"),
    row(field("PubMed", capSel("pubmed")), field("Europe PMC", capSel("europepmc")),
      btn("Check counts", async () => {
        countsEl.textContent = "counting…";
        try { const [a, b] = await Promise.all([pmCount(pq), europePmcPage(eq, 1)]); countsEl.textContent = `PubMed ${fmt(a.count)} · Europe PMC ${fmt(b.count)}`; }
        catch (e) { countsEl.textContent = e.message; }
      }, "ghost sm"), countsEl),
    manual && !frozen && help("With copy-paste, every 20 records is one paste in the next stage; start small and raise the number later."),
    frozen ? row(cachedBtn(`Use the example search (${frozen.date})`, () => runSearch(ctx, pq, eq, prog, frozen)),
      btn("Search live instead", () => runSearch(ctx, pq, eq, prog), "ghost"), h("span", { class: "muted small" }, "the same records as the recording, so the recorded answers fit"))
      : row(btn(s ? "Search again (adds new records only)" : "Search PubMed + Europe PMC", () => runSearch(ctx, pq, eq, prog), "primary")),
    !frozen && cache && !s && !p.records.length && h("p", { class: "badge warn" }, "The search terms or numbers differ from the example: this search runs live."),
    prog.el,
  ];
  body.push(pressCheck(ctx));
  if (s) body.push(help(`Searched ${s.date}${s.from_example ? " (example search, the recorded records)" : ""}: PubMed ${fmt(s.pubmed.fetched)} of ${fmt(s.pubmed.count)}, Europe PMC ${fmt(s.europepmc.fetched)} of ${fmt(s.europepmc.count)}${s.registers ? `, ClinicalTrials.gov ${fmt(s.registers.fetched)} of ${fmt(s.registers.count)}` : ""} · `,
    `${fmt(p.records.length)} records, ${fmt(p.records.filter(r => r.duplicate_of).length)} duplicates linked. `, h("a", { href: `#/p/${p.id}/records` }, "See records →")));
  else if (p.records.length) body.push(help(`${fmt(p.records.length)} records are already in this project; the scan screens those too.`));
  return stageCard(2, SCAN_STAGES[1], st.search, ...body);
}

// PRESS 2015 (McGowan et al.): six elements for peer review of a search strategy. Cochrane rapid review rec. 6:
// use PRESS for the primary strategy; at a minimum double-check it for errors.
const PRESS = [
  ["question", "Translation of the question: the concepts match the question, nothing essential missing or too narrow"],
  ["boolean", "Boolean and proximity operators: OR within a concept, AND between concepts, no unintended NOT"],
  ["headings", "Subject headings: relevant MeSH included, explosion right, nothing irrelevant"],
  ["textwords", "Text words: synonyms, spelling variants, truncation; no noisy generic words"],
  ["syntax", "Spelling, syntax and field tags: no typos, quotes and tags correct"],
  ["limits", "Limits and filters: only those the question justifies (years, language, study type)"],
];
function pressCheck(ctx) {
  const p = ctx.project;
  p.scan.press ||= { items: {}, reviewer: "" };
  const pr = p.scan.press;
  const n = Object.values(pr.items).filter(Boolean).length;
  return h("details", { class: "advanced scan-press", open: !n && !p.scan.search },
    h("summary", {}, `Check the search (PRESS): ${n} of 6`, pr.reviewer ? ` · peer reviewed by ${pr.reviewer}` : ""),
    help("Peer review of the search catches missed terms and errors before you search (PRESS 2015; Cochrane rapid review guidance, rec. 6). Best done by a librarian or information specialist; at least check it yourself."),
    PRESS.map(([id, label]) => h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!pr.items[id], onchange: e => { pr.items[id] = e.target.checked; pr.date = today(); ctx.save(); } }), " ", label)),
    row(h("label", { class: "small" }, "Peer reviewed by (name, role) ", h("input", { value: pr.reviewer || "", placeholder: "e.g. J. Smith, librarian", onchange: e => { pr.reviewer = e.target.value.trim(); ctx.save(); } }))),
    h("p", { class: "small muted" }, "The page assistant (Copy this page for ChatGPT, top right) can review the strategy against these elements too; the check is yours."));
}

// Europe PMC records by their ids ("PPR:PPR123", "PMC:PMC456"), in the given order.
async function epmcByIds(ids) {
  if (!ids?.length) return [];
  const bySrc = {};
  for (const x of ids) { const [src, id] = x.split(":"); (bySrc[src] ||= []).push(id); }
  const q = Object.entries(bySrc).map(([src, list]) => `((${list.map(id => `EXT_ID:${id}`).join(" OR ")}) AND SRC:${src})`).join(" OR ");
  const got = (await europePmcPage(q, ids.length + 5)).results.map(epmcToRecord);
  return ids.map(x => got.find(r => r.europepmc_id === x)).filter(Boolean);
}

// Live search, or with `frozen` the recorded result list (same records, fetched by id, processed by the same code).
export async function runSearch(ctx, pq, eq, prog, frozen = null) {
  const p = ctx.project, caps = p.scan.caps;
  if (!pq) return toast("Add search blocks first", "warn");
  try {
    prog?.set(0, 3, "PubMed");
    const count = frozen ? frozen.pubmed.count : (await pmCount(pq)).count;
    const ids = frozen ? frozen.pubmed.ids : await pmIds(pq, caps.pubmed, 0, "relevance");
    const have = new Set(p.records.map(r => r.pmid).filter(Boolean));
    const pm = (await pmFetch(ids.filter(id => !have.has(id)))).map(r => ({ ...r, rid: r.pmid, source: "PubMed (scan)" }));
    prog?.set(1, 3, "Europe PMC");
    const e = frozen ? { count: frozen.europepmc.count, results: null } : eq ? await europePmcPage(eq, caps.europepmc) : { count: 0, results: [] };
    const epRecs = frozen ? await epmcByIds(frozen.europepmc.ids) : e.results.map(epmcToRecord);
    const seen = new Set(p.records.map(r => r.europepmc_id).filter(Boolean));
    const ep = epRecs.filter(r => !seen.has(r.europepmc_id) && !(r.pmid && have.has(r.pmid))).map(r => ({ ...r, source: "Europe PMC (scan)" }));
    let reg = null, regRecs = [];
    if (caps.registers && !frozen) {
      prog?.set(2, 3, "ClinicalTrials.gov");
      const term = ctgovQuery(p.search.blocks);
      const res = await ctgovSearch(term, caps.registers);
      const haveNct = new Set(p.records.map(r => r.nct_id).filter(Boolean));
      regRecs = res.results.map(ctgovToRecord).filter(r => !haveNct.has(r.nct_id)).map(r => ({ ...r, source: "ClinicalTrials.gov (scan)" }));
      reg = { query: term, count: res.count, fetched: res.results.length };
    }
    prog?.set(2, 3, "deduplicating");
    const date = frozen ? frozen.date : today();
    p.scan.search = { date, key: scanKeys.search(pq, eq, caps), from_example: !!frozen,
      pubmed: { query: pq, count, fetched: ids.length, ids }, europepmc: { query: eq, count: e.count, fetched: epRecs.length, ids: epRecs.map(r => r.europepmc_id) }, ...(reg ? { registers: reg } : {}) };
    p.search.versions.push({ name: `Evidence scan ${date}`, date, count, recall: p.search.validation.length ? "not tested" : "–", query: pq,
      blocks: structuredClone(p.search.blocks), note: `evidence scan: ${ids.length} most relevant PubMed records; Europe PMC ${epRecs.length} of ${e.count}${frozen ? " (example search)" : ""}` });
    prog?.set(3, 3, "done");
    addRecords(ctx, [...pm, ...ep, ...regRecs], frozen ? "example search" : "scan");
  } catch (err) { toast(err.message, "err"); }
}

// ------------------------------------------------------------------ 3 · screen
function screenStage(ctx, st, cache) {
  const p = ctx.project;
  const recs = active(p);
  const info = new Map(recs.map(r => [r.rid, p.screening.human?.[r.rid]?.decision ? null : taResults(p, r)]));
  const todo = recs.filter(r => info.get(r.rid) && !info.get(r.rid).fresh.length);
  const stale = todo.filter(r => info.get(r.rid).stale.length);
  const hits = todo.filter(r => cache?.answers?.[info.get(r.rid).key]);
  const misses = todo.filter(r => !hits.includes(r));
  const body = [];
  const humanStale = recs.filter(r => { const hd = p.screening.human?.[r.rid]; return hd?._key && hd._key !== scanKeys.screen(p, r); });
  if (humanStale.length) body.push(h("div", { class: "scan-approve" }, h("p", { class: "badge warn" }, `${humanStale.length} of your decisions were made with an earlier question or criteria.`),
    btn(`Screen these ${humanStale.length} again`, () => { for (const r of humanStale) delete p.screening.human[r.rid]; delete p.scan.calibration; ctx.save(); ctx.rerender(); })));
  if (stale.length) body.push(h("p", { class: "badge warn" }, `${stale.length} AI suggestions were made with an earlier question or criteria: they are out of date and are made again below.`));
  if (hits.length) body.push(row(cachedBtn(`Use ${hits.length} example answers`, () => { applyCachedScreen(p, cache); ctx.save(); ctx.rerender(); }),
    h("span", { class: "muted small" }, misses.length ? `${misses.length} other papers are new or changed and need your AI route` : `instant · recorded with ${cache.model}`)));
  if (misses.length) body.push(runPanel({
    title: "scan-screening", system: SYSTEM_SCREEN, batchSize: 20,
    items: misses.map(r => ({ id: r.rid, label: `${r.rid} ${String(r.title).slice(0, 40)}` })),
    build: (items, opt = {}) => {
      const src = items.map(it => ({ source: sourceBlock(p.records.find(x => x.rid === it.id)) }));
      return { prompt: screeningPrompt(p, src, opt), schema: items.length > 1 ? screeningBatchSchema(p) : screeningSchema(p), name: "screening" };
    },
    save: (id, json, run) => { const r = p.records.find(x => x.rid === String(id)); if (r) saveScreen(p, r.rid, json, run, scanKeys.screen(p, r)); },
    done: () => { ctx.save(); ctx.rerender(); },
  }));
  if (st.screenAI) body.push(h("h4", { class: "scan-check-title" }, "Your decisions"),
    h("fieldset", { class: "scan-mode" }, h("legend", { class: "small muted" }, "How do you work with the AI?"),
      Object.entries(SCREEN_MODES).map(([id, m]) => h("label", { class: "check" },
        h("input", { type: "radio", name: "screen-mode", checked: screenMode(p) === id, onchange: () => { p.scan.screen_mode = id; ctx.save(); ctx.rerender(); } }),
        " ", h("strong", {}, m.label), h("span", { class: "small muted" }, ` · ${m.hint}`)))),
    screenCheckCard(ctx, recs, rid => aiTA(p, recs.find(r => r.rid === rid)), () => ctx.rerender(), r => scanKeys.screen(p, r)));
  if (st.screenAI && screenMode(p) === "dual" && recs.every(r => p.screening.human?.[r.rid]?.decision))
    body.push(secondReviewerCard(ctx, { screening: recs.map(r => r.rid), page: "scan" }, { title: "Second reviewer: screening" }));
  const screened = recs.length - todo.length;
  if (screened && st.screen) {
    const { el } = criteriaFlowChart(p, recs);
    body.push(h("div", { class: "scan-result" }, el,
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: p.scan.keep_unclear !== false, onchange: e => { p.scan.keep_unclear = e.target.checked; ctx.save(); ctx.rerender(); } }),
        " Keep the unclear papers for the next stages (safer: the full text often decides)"),
      help(`${fmt(scanSelected(p).length)} papers go on. `, h("a", { href: `#/p/${p.id}/screening` }, "All decisions and the agreement with the AI in step 6 →"))));
  }
  return stageCard(3, SCAN_STAGES[2], st.screen, ...body);
}

// ------------------------------------------------------------------ 4 · full texts
function textsStage(ctx, st) {
  const p = ctx.project, sel = scanSelected(p);
  const got = sel.filter(r => hasText(p, r.rid)), missing = sel.filter(r => !hasText(p, r.rid));
  const tried = missing.filter(r => p.fulltext[r.rid]), untried = missing.filter(r => !p.fulltext[r.rid]);
  const target = untried.length ? untried : missing;   // after a first pass: try the misses again
  const prog = progress();
  const body = [
    row(target.length ? btn(`Find open-access texts for ${target.length} paper${target.length > 1 ? "s" : ""}${untried.length ? "" : " again"}`, async () => {
      p.scan.texts_tried = today();
      await fetchAuto(ctx, target, prog, null);
    }, untried.length ? "primary" : "") : null, h("span", { class: "muted small" }, `${got.length} of ${sel.length} have a full text`)),
    prog.el,
  ];
  if (tried.length) body.push(help(`${tried.length} without an open copy: the scan uses their abstract. Download them through your library and add them in `,
    h("a", { href: `#/p/${p.id}/fulltext` }, "step 5 (Add a folder…)"), " to use the full text."));
  return stageCard(4, SCAN_STAGES[3], st.texts, ...body);
}

// ------------------------------------------------------------------ 5 · extract
function extractStage(ctx, st, cache, texts) {
  const p = ctx.project, sel = scanSelected(p);
  const fields = modelFields(p.extraction.fields);
  const info = new Map(sel.map(r => [r.rid, exResults(p, r, texts)]));
  const todo = sel.filter(r => !info.get(r.rid).fresh.length);
  const stale = todo.filter(r => info.get(r.rid).stale.length);
  const hits = todo.filter(r => cache?.answers?.[info.get(r.rid).key]);
  const misses = todo.filter(r => !hits.includes(r));
  const body = [];
  if (!fields.length) body.push(help("Add data fields in stage 1 or step 7 first."));
  if (stale.length) body.push(h("p", { class: "badge warn" }, `${stale.length} papers were extracted with earlier fields, criteria or text: out of date, extract them again below.`));
  if (fields.length && hits.length) body.push(row(cachedBtn(`Use ${hits.length} example answers`, () => { applyCachedExtract(p, cache, texts); ctx.save(); ctx.rerender(); }),
    h("span", { class: "muted small" }, misses.length ? `${misses.length} other papers are new or changed and need your AI route` : `instant · recorded with ${cache.model}`)));
  if (fields.length && misses.length) body.push(runPanel({
    title: "scan-extraction", system: SYSTEM_EXTRACT, attachHint: true, batchSize: 2,
    items: misses.map(r => ({ id: r.rid, label: `${r.rid} ${String(r.title).slice(0, 40)}${texts[r.rid] ? "" : " (abstract)"}` })),
    build: (items, opt = {}) => {
      const src = items.map(it => { const r = p.records.find(x => x.rid === it.id); return { source: sourceBlock(r, opt.attachments ? "" : texts[r.rid], 30000) }; });
      return { prompt: extractionPrompt(p, src, fields, opt), schema: items.length > 1 ? extractionBatchSchema(fields) : extractionSchema(fields), name: "extraction" };
    },
    save: (id, json, run) => { const r = p.records.find(x => x.rid === String(id)); if (r) saveExtract(p, r.rid, json, run, scanKeys.extract(p, r, texts[r.rid], fields)); },
    done: () => { ctx.save(); ctx.rerender(); },
  }));
  if (fields.length && st.extractAI) body.push(h("h4", { class: "scan-check-title" }, "Your check of the values"),
    extractCheckCard(ctx, sel, texts, fields, r => info.get(r.rid).fresh[0], r => info.get(r.rid).key, () => ctx.rerender()));
  const done = sel.filter(r => extractChecked(p, r, texts));
  if (done.length) body.push(table([
    { label: "Paper", cls: "title", render: r => h("span", {}, h("strong", {}, r.rid), " ", String(r.title).slice(0, 70), texts[r.rid] ? "" : h("span", { class: "muted small" }, " · abstract only")) },
    ...fields.slice(0, 6).map(f => ({ label: f.label, render: r => { const v = scanValue(p, r, f, info.get(r.rid).fresh); return EMPTY(v) ? h("span", { class: "muted" }, v || "–") : String(v).slice(0, 80); } })),
  ], done, { limit: 50 }), help(h("a", { href: `#/p/${p.id}/extraction` }, "All values, quotes and run checks in step 7 →")));
  return stageCard(5, SCAN_STAGES[4], st.extract, ...body);
}

// ------------------------------------------------------------------ 6 · appraise
function appraiseStage(ctx, st, texts) {
  const p = ctx.project, sel = scanSelected(p);
  const body = [];
  if (p.scan.rob_skipped && !robDone(p, sel)) {
    body.push(help(`Skipped on ${p.scan.rob_skipped}: the summary reports that the studies were not appraised (rapid review rec. 14-16).`),
      row(btn("Appraise the studies after all", () => { delete p.scan.rob_skipped; ctx.save(); ctx.rerender(); })));
    return stageCard(6, SCAN_STAGES[5], true, ...body);
  }
  body.push(robCard(ctx, sel, { texts, onDone: () => ctx.rerender(),
    intro: "Judge each study with the tool for its design: the AI drafts every domain with a quote, you judge. Optional in a scan, required in a rapid or systematic review (MECIR C52; rapid review rec. 14)." }));
  if (!robDone(p, sel)) body.push(row(btn("Skip appraisal for this scan", () => { p.scan.rob_skipped = today(); ctx.save(); ctx.rerender(); }, "ghost"),
    h("span", { class: "muted small" }, "the summary then names it as a limitation")));
  else body.push(secondReviewerCard(ctx, { screening: [], extraction: sel.map(r => r.rid), rob: sel.map(r => r.rid), page: "scan" },
    { title: "Second reviewer: extraction and appraisal", fields: modelFields(p.extraction.fields),
      intro: "A second person extracts and appraises the same papers in a blind copy (systematic review: MECIR C46, C53) or verifies yours (rapid review: rec. 12, 16). Differences come back here and in the risk-of-bias table." }));
  return stageCard(6, SCAN_STAGES[5], st.appraise, ...body);
}

// ------------------------------------------------------------------ the second reviewer's blind copy
async function secondWork(m, ctx) {
  const p = ctx.project, t = p.team.origin.tasks || {};
  p.scan.screen_mode = "independent";
  m.append(blindCopyBanner(ctx));
  const byId = rid => p.records.find(r => r.rid === rid);
  const recs = (t.screening || []).map(byId).filter(Boolean);
  if (recs.length) m.append(card(`Screen ${recs.length} records blind`, help("Decide every record on its title and abstract against the criteria. Nobody's decisions and no AI suggestions are shown."),
    h("ol", { class: "small" }, p.criteria.map(c => h("li", {}, h("strong", {}, c.label), ": ", c.description))),
    screenCheckCard(ctx, recs, () => null, () => ctx.rerender())));
  const sel = (t.extraction || []).map(byId).filter(Boolean);
  if (sel.length) {
    const texts = await loadTexts(p, sel);
    m.append(card(`Extract ${sel.length} papers`, help("Fill in every field from the paper yourself."),
      extractCheckCard(ctx, sel, texts, modelFields(p.extraction.fields), () => null, () => "second-reviewer", () => ctx.rerender())));
    if ((t.rob || []).length) m.append(robCard(ctx, sel, { texts, noAI: true, intro: "Judge every domain of every study yourself, with the tool's full signalling questions." }));
  }
}

// ------------------------------------------------------------------ 7 · summary
const citeShort = r => `${surname(r.authors)} ${r.year || ""}`.trim();

function summaryStage(ctx, st, cache, texts) {
  const p = ctx.project;
  const papers = papersForSummary(p, texts);
  const body = [];
  const s = p.scan.summary;
  const f = facts(p, texts);
  const flow = criteriaFlowChart(p);
  const key = scanKeys.summary(p, papers);
  if (!st.extract || !st.appraise) {
    body.push(help(!st.extract ? "The summary is written from the values you checked: finish the check in stage 5 first." : "Appraise the studies in stage 6 first (or skip appraisal for this scan)."),
      h("div", { class: "scan-graphs" }, h("div", {}, h("h4", {}, "Inclusion and exclusion"), flow.el), h("div", { class: "prisma" }, prisma(counts(p)))));
    return stageCard(7, SCAN_STAGES[6], false, ...body);
  }
  const hit = (!s || st.summaryStale) && cache?.answers?.[key];
  if (st.summaryStale) body.push(h("p", { class: "badge warn" }, "The selection or extracted data changed after this summary was written: write it again below."));
  if (hit) body.push(row(cachedBtn("Use the example answer", () => { applyCachedSummary(p, cache, texts); ctx.save(); ctx.rerender(); }), h("span", { class: "muted small" }, `instant · recorded with ${cache.model}`)));
  if (s) {
    const link = text => String(text || "").split(/(\[[\w.:-]+\])/g).map(t => {
      const id = t.match(/^\[([\w.:-]+)\]$/)?.[1];
      const r = id && p.records.find(x => x.rid === id);
      return r ? h("a", { href: `#scan-ref-${id}`, title: r.title, onclick: e => { e.preventDefault(); document.getElementById(`scan-ref-${id}`)?.scrollIntoView({ block: "center" }); } }, `[${citeShort(r)}]`) : t;
    });
    const ids = [...new Set([...(String(s.answer).match(/\[([\w.:-]+)\]/g) || []).map(x => x.slice(1, -1)), ...(s.findings || []).flatMap(x => x.paper_ids || [])])];
    body.push(h("div", { class: "scan-summary" },
      h("p", { class: "scan-answer" }, link(s.answer)),
      h("h4", {}, "Findings"), h("ul", {}, (s.findings || []).map(x => h("li", {}, x.statement, " ", link((x.paper_ids || []).map(i => `[${i}]`).join(""))))),
      s.agreement && [h("h4", {}, "Agreement between studies"), h("p", {}, link(s.agreement))],
      (s.gaps || []).length && [h("h4", {}, "Gaps"), h("ul", {}, s.gaps.map(g => h("li", {}, g)))],
      h("div", { class: "scan-limits" }, h("h4", {}, stageIcon("info"), "Limitations of this scan"), h("ul", {}, scanLimits(p, f).map(l => h("li", {}, l)))),
      h("h4", {}, "References"), h("ol", { class: "scan-refs" }, ids.map(id => p.records.find(r => r.rid === id)).filter(Boolean).map(r =>
        h("li", { id: `scan-ref-${r.rid}` }, `${citeShort(r)}. ${noDot(r.title)}. ${noDot(r.journal)}. `, r.doi ? h("a", { href: `https://doi.org/${r.doi}`, target: "_blank", rel: "noopener" }, `doi:${r.doi}`) : r.pmid ? h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, target: "_blank", rel: "noopener" }, `PMID ${r.pmid}`) : ""))),
      h("p", { class: "muted small" }, `Drafted by ${s.model || "the AI route"} on ${s.date} from the checked data of ${papers.length} papers.`),
      st.summaryDrafted && !s.approved ? h("div", { class: "scan-approve" },
        h("p", { class: "badge warn" }, "Draft: check every statement against the cited papers before you use it."),
        btn("I checked the summary against the papers: approve it", () => { s.approved = today(); ctx.save(); ctx.rerender(); }, "primary"))
        : s.approved ? h("p", { class: "badge ok" }, `Checked and approved by you on ${s.approved}`) : null,
      h("div", { class: "scan-disclosure" }, h("h4", {}, "AI use disclosure"), h("ul", {}, f.disclosure.map(l => h("li", {}, l))),
        btn("Download all prompts (.txt)", () => download(`${p.id}-prompts.txt`, allPrompts(p, texts, papers), "text/plain"), "ghost sm"))),
      row(btn("Download summary (.md)", () => download(`${p.id}-scan.md`, summaryMarkdown(p, f, flow.flow), "text/markdown"), "primary"),
        btn("Copy", () => copy(summaryMarkdown(p, f, flow.flow))),
        btn("Download flow diagram (SVG)", () => download(`${p.id}-prisma.svg`, prisma(counts(p)).outerHTML, "image/svg+xml"))));
  }
  body.push(h("div", { class: "scan-graphs" }, h("div", {}, h("h4", {}, "Inclusion and exclusion"), flow.el), h("div", { class: "prisma" }, prisma(counts(p)))));
  const panel = runPanel({
    title: "scan-summary", system: SYSTEM_SCAN, batchable: false, runName: "summary",
    items: papers.length ? [{ id: "summary", label: `Summary of ${papers.length} papers` }] : [],
    build: () => ({ prompt: scanSummaryPrompt(p, papers), schema: scanSummarySchema, name: "scan_summary" }),
    save: (id, json, run) => { if (json._error) return toast(json._error, "err"); p.scan.summary = { ...json, model: run.model || run.label, date: run.date, _key: key }; },
    done: () => { ctx.save(); ctx.rerender(); },
  });
  body.push(s && !st.summaryStale || hit ? h("details", { class: "advanced" }, h("summary", {}, hit ? "or ask your own AI route" : "Write the summary again (e.g. after checking values)"), panel) : panel);
  if (s && st.summaryDrafted) body.push(certaintyCard(ctx, scanFindings(p), papers.map(x => ({ ...x, rob: x.rob })), { empty: "The summary has no findings to rate." }));
  return stageCard(7, SCAN_STAGES[6], st.summary, ...body);
}

// Every prompt of this scan, built by the same code from the project (AI use disclosure: prompts documented).
function allPrompts(p, texts, papers) {
  const out = ["# Prompts of this evidence scan", `Project: ${p.name} · exported ${today()}`, "",
    "## Plan", p.scan.plan?.prompt || "(not stored: the plan was made before prompts were kept)", ""];
  const fields = modelFields(p.extraction.fields);
  for (const r of active(p)) out.push(`## Screening · ${r.rid}`, screeningPrompt(p, [{ source: sourceBlock(r) }]), "");
  for (const r of scanSelected(p)) out.push(`## Extraction · ${r.rid}`, extractionPrompt(p, [{ source: sourceBlock(r, texts[r.rid] || "", 30000) }], fields), "");
  out.push("## Summary", scanSummaryPrompt(p, papers), "");
  return out.join("\n");
}

// ------------------------------------------------------------------ go deeper
// When to go all in: a recommended route with its reasons, and per route what its guidance still asks of this
// project. Continuing keeps everything; the eight steps carry on with the same data.
function continueCard(ctx, texts) {
  const p = ctx.project;
  const adv = goDeeperAdvice(p, facts(p, texts));
  const go = type => { p.protocol.review_type = type; p.scan.continued = { type, date: today() }; ctx.save(true); ctx.go(`#/p/${p.id}/protocol`); };
  const rec = ROUTE_LABEL[adv.recommended];
  return card("Go deeper: when to go all in",
    h("p", { class: "scan-deeper-rec" }, adv.recommended === "scan" ? "The scan can be enough for your purpose." : h("span", {}, "Suggested next: ", h("strong", {}, rec), ".")),
    h("ul", { class: "scan-deeper-reasons" }, adv.reasons.map(r => h("li", {}, r))),
    help("Everything the scan made stays: protocol, search, records, your decisions and checked values. What each route still asks of this project:"),
    h("div", { class: "scan-deeper-routes" }, adv.routes.map(r => h("section", { class: `scan-deeper-route${r.id === adv.recommended ? " recommended" : ""}` },
      h("h4", {}, r.label, r.id === adv.recommended ? h("span", { class: "suggested-label" }, "Suggested") : null),
      h("ul", { class: "scan-deeper-items" }, r.items.map(it => h("li", { class: it.done ? "done" : "" }, h("span", { class: "tick", "aria-label": it.done ? "done" : "to do" }, it.done ? "✓" : "○"), " ",
        h("a", { href: it.href }, it.text), " ", h("a", { class: "small muted", href: it.src.url, target: "_blank", rel: "noopener", title: it.src.cite }, it.src.name)))),
      h("p", { class: "small muted" }, `${r.items.filter(i => i.done).length} of ${r.items.length} already met`),
      btn(`Continue as a ${r.label.toLowerCase()}`, () => go(r.id), r.id === adv.recommended ? "primary" : "")))),
    p.scan.continued && badge(`continued as ${p.scan.continued.type} on ${p.scan.continued.date}`, "ok"),
    h("p", { class: "small muted" }, "Sources and the full comparison per step: ", h("a", { href: "#/methods/scan" }, "Methods & guidance"), "."));
}
const ROUTE_LABEL = { systematic: "a systematic review", rapid: "a rapid review", scoping: "a scoping review", scan: "the scan" };
