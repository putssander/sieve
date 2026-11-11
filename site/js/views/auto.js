// Auto mode on the quick-scan page: one button runs every AI step unattended (recorded example answers are reused
// where they fit), then a manuscript draft that says on every page what a person has and has not checked.
// No human field is ever written here: decisions, checked values, approvals and ratings stay the person's.
import { h, clear, toast, download, copy, pool } from "../util.js";
import { card, btn, help, row, badge, activeBackend, progress } from "../ui.js";
import { call } from "../llm.js";
import { pmQuery } from "../query.js";
import { SYSTEM_SCREEN, screeningPrompt, screeningSchema, sourceBlock, SYSTEM_EXTRACT, extractionPrompt, extractionSchema, modelFields } from "../prompts.js";
import { SYSTEM_SCAN, scanPlanPrompt, scanPlanSchema, epmcQuery, scanSummaryPrompt, scanSummarySchema, scanKeys, scanLimits, surname, criteriaFlow } from "../scan.js";
import { SYSTEM_ROB, robPrompt, robSchema, robKey, levelOf } from "../rob.js";
import { SYSTEM_CERTAINTY, certaintyPrompt, certaintySchema, certaintyKey, sofMarkdown, levelById } from "../certainty.js";
import { AUTO_STEPS, SYSTEM_WRITE, manuscriptPrompt, manuscriptSchema, manuscriptKey, manuscriptMarkdown, markdownToHtml } from "../auto.js";
import { active } from "./records.js";
import { fetchAuto } from "./fulltext.js";
import { counts, decideTA } from "./flow.js";
import { robState, toolFor, aiRob, humanRob, robDone, robOverall } from "./rob.js";
import { certaintyState, certaintyDone, findingKey } from "./certainty.js";
import { scanSelected, loadTexts, papersForSummary, paperValues, savePlan, saveScreen, saveExtract, applyCachedPlan, applyCachedScreen, applyCachedExtract, applyCachedSummary,
  aiTA, aiEx, exKey, runSearch, stageState, facts, scanFindings } from "./scan.js";

const today = () => new Date().toISOString().slice(0, 10);
const hasText = (p, rid) => p.fulltext[rid] && !p.fulltext[rid].failed;

// What a person has verified, per auto step (the same checks as the stage-by-stage scan).
export function verified(p, texts) {
  const st = stageState(p, texts), sel = scanSelected(p);
  const findings = scanFindings(p);
  return { plan: st.plan, search: Object.values(p.scan?.press?.items || {}).filter(Boolean).length === 6, screen: st.screen, texts: sel.length > 0 && sel.every(r => hasText(p, r.rid)),
    extract: st.extract, appraise: robDone(p, sel), summary: st.summary, certainty: findings.length > 0 && certaintyDone(p, findings), manuscript: !!p.auto?.manuscript?.approved };
}

// The unattended run. Every step skips what already has a fresh answer, so a stopped run continues where it stopped.
export async function runAuto(ctx, { cache, log, prog, signal }) {
  const p = ctx.project, b = activeBackend();
  const canCall = b.kind !== "manual";
  const quiet = { get project() { return p; }, save: () => ctx.save(), rerender() {}, go: ctx.go };
  const run = { id: "auto", label: `Auto mode · ${b.label}`, model: b.model || b.label, backend: b.kind, date: today() };
  const say = (msg, kind = "") => log(msg, kind);
  const need = what => { throw new Error(`${what} needs a model: choose an API key or a local model under Models & keys (copy-paste cannot run unattended).`); };
  const ask = async (system, prompt, schema, name) => { if (!canCall) need(name); return call(b, { system, prompt, schema, name, signal }); };
  const cached = key => cache?.answers?.[key];
  const many = async (label, items, fn) => {
    if (!items.length) return;
    say(`${label}: ${items.length}…`);
    let errors = 0, noModel = null;
    await pool(items, b.concurrency || 3, async it => {
      if (noModel) return;
      try { await fn(it); } catch (e) { if (/needs a model/.test(e.message)) { noModel = e; return; } errors++; say(`${label} ${it.rid}: ${e.message}`, "err"); }
    }, (d, t) => prog.set(d, t, label), signal);
    ctx.save();
    if (noModel) throw noModel;
    if (errors) say(`${label}: ${errors} errors (run again to retry)`, "err");
  };
  p.auto = { ...(p.auto || {}), started: p.auto?.started || today(), last: today(), backend: canCall ? `${b.label}${b.model ? ` · ${b.model}` : ""}` : "recorded example answers" };

  // 1 plan
  if (!(p.criteria.length && p.search.blocks.length && p.extraction.fields.length)) {
    if (applyCachedPlan(p, cache)) say("Plan: example answer");
    else { const r = await ask(SYSTEM_SCAN, scanPlanPrompt(p), scanPlanSchema, "scan_plan"); savePlan(p, r.json, r.model || run.model, scanKeys.plan(p)); say("Plan drafted"); }
    ctx.save();
  }
  // 2 search
  if (!p.scan.search && !p.records.length) {
    p.scan.caps ||= { pubmed: 100, europepmc: 50 };
    const pq = pmQuery(p.search.blocks), eq = epmcQuery(p.search.blocks);
    const frozen = cache?.search?.key === scanKeys.search(pq, eq, p.scan.caps) ? cache.search : null;
    say(frozen ? "Search: the recorded example search" : "Search: PubMed and Europe PMC, live");
    await runSearch(quiet, pq, eq, null, frozen);
  }
  if (signal.aborted) return;
  // 3 screen (AI suggestions only; your decisions stay yours)
  const sc = applyCachedScreen(p, cache);
  if (sc.hit) say(`Screening: ${sc.hit} example answers`);
  await many("Screening", active(p).filter(r => !p.screening.human?.[r.rid]?.decision && !aiTA(p, r)), async r => {
    const key = scanKeys.screen(p, r);
    const a = cached(key) ? { json: cached(key), model: `${cache.model} (example answer)` } : await ask(SYSTEM_SCREEN, screeningPrompt(p, [{ source: sourceBlock(r) }]), screeningSchema(p), "screening");
    saveScreen(p, r.rid, a.json, { ...run, model: a.model || run.model }, key);
  });
  if (signal.aborted) return;
  // 4 full texts
  const sel = scanSelected(p);
  const missing = sel.filter(r => !p.fulltext[r.rid]);
  if (missing.length) { say(`Full texts: looking for ${missing.length} open-access copies…`); p.scan.texts_tried = today(); await fetchAuto(quiet, missing, prog, null); }
  const texts = await loadTexts(p, sel);
  // 5 extract
  const fields = modelFields(p.extraction.fields);
  const ex = applyCachedExtract(p, cache, texts);
  if (ex.hit) say(`Extraction: ${ex.hit} example answers`);
  await many("Extraction", sel.filter(r => !aiEx(p, r, texts)), async r => {
    const key = exKey(p, r, texts);
    const a = cached(key) ? { json: cached(key), model: `${cache.model} (example answer)` } : await ask(SYSTEM_EXTRACT, extractionPrompt(p, [{ source: sourceBlock(r, texts[r.rid] || "", 30000) }], fields), extractionSchema(fields), "extraction");
    saveExtract(p, r.rid, a.json, { ...run, model: a.model || run.model }, key);
  });
  if (signal.aborted) return;
  // Optional drafts: without a model (and without a recorded answer) they are skipped, and the draft says so.
  const soft = async (label, fn) => { try { await fn(); } catch (e) { if (!/needs a model/.test(e.message)) throw e; say(`${label}: skipped, needs an API key or a local model`, "err"); } };
  // 6 appraise (drafts)
  const rob = robState(p);
  await soft("Risk of bias", () => many("Risk of bias", sel.filter(r => !humanRob(p, r.rid) && !aiRob(p, r, texts[r.rid]).fresh), async r => {
    const t = toolFor(p, r.rid), key = robKey(p, t, r, texts[r.rid]);
    const a = cached(key) ? { json: cached(key), model: `${cache.model} (example answer)` } : await ask(SYSTEM_ROB, robPrompt(p, t, r, texts[r.rid]), robSchema(t), "risk_of_bias");
    (rob.runs.auto ||= { label: run.label, model: a.model || run.model, backend: run.backend, date: run.date, results: {} }).results[r.rid] = { ...a.json, tool: t.id, _key: key };
  }));
  if (signal.aborted) return;
  // 7 summary
  const papers = papersForSummary(p, texts);
  const skey = scanKeys.summary(p, papers);
  if (p.scan.summary?._key !== skey) {
    if (applyCachedSummary(p, cache, texts)) say("Summary: example answer");
    else { say("Summary…"); const r = await ask(SYSTEM_SCAN, scanSummaryPrompt(p, papers), scanSummarySchema, "scan_summary"); p.scan.summary = { ...r.json, model: r.model || run.model, date: today(), _key: skey }; }
    p.scan.summary.auto = true;
    ctx.save();
  }
  if (signal.aborted) return;
  // 8 certainty (draft)
  const c = certaintyState(p), findings = scanFindings(p);
  const cpapers = papers.map(x => ({ ...x, rob: x.rob }));
  const ckey = certaintyKey(p, c.approach, findings, cpapers);
  if (findings.length && c.ai?._key !== ckey) await soft("Certainty", async () => {
    say("Certainty of the evidence…");
    const a = cached(ckey) ? { json: cached(ckey), model: `${cache.model} (example answer)` } : await ask(SYSTEM_CERTAINTY, certaintyPrompt(p, c.approach, findings, cpapers), certaintySchema(c.approach), "certainty");
    c.ai = { ...a.json, approach: c.approach, model: a.model || run.model, date: today(), _key: ckey };
    ctx.save();
  });
  // 9 introduction and discussion
  const f = facts(p, texts);
  const limits = scanLimits(p, f);
  const cert = certaintyFor(p, findings);
  const mkey = manuscriptKey(p, p.scan.summary, papers, limits, cert);
  if (p.auto.manuscript?._key !== mkey) await soft("Introduction and discussion", async () => {
    say("Introduction and discussion…");
    const a = cached(mkey) ? { json: cached(mkey), model: `${cache.model} (example answer)` } : await ask(SYSTEM_WRITE, manuscriptPrompt(p, p.scan.summary, papers, limits, cert), manuscriptSchema, "manuscript");
    p.auto.manuscript = { ...a.json, model: a.model || run.model, date: today(), _key: mkey };
  });
  p.auto.finished = today();
  ctx.save(true);
  say("Done: the manuscript draft is at the bottom of this page.", "ok");
}

// Certainty level per finding: the person's rating, else the AI draft (marked).
function certaintyFor(p, findings) {
  return findings.map((f, i) => {
    const hum = p.certainty?.human?.[findingKey(f)];
    const ai = p.certainty?.ai?.results?.[i];
    const id = hum?.final || ai?.certainty || ai?.confidence;
    return { finding: f.finding, level: id ? `${levelById(id)?.label}${hum ? "" : " (AI draft, not checked)"}` : "" };
  });
}

// Everything the manuscript reports, collected from the project.
export function manuscriptData(p, texts) {
  const sel = scanSelected(p), f = facts(p, texts), s = p.scan?.search || {}, ver = verified(p, texts);
  const c = counts(p), flow = criteriaFlow(p, active(p), decideTA(p));
  const findings = scanFindings(p);
  const humanTA = active(p).filter(r => p.screening.human?.[r.rid]?.decision).length;
  const sources = ["PubMed", "Europe PMC (preprints and PubMed Central)", s.registers ? "ClinicalTrials.gov" : null].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
  const tools = [...new Set(sel.map(r => toolFor(p, r.rid).name))];
  const sofRows = findings.map((fd, i) => {
    const hum = p.certainty?.human?.[findingKey(fd)];
    const ai = p.certainty?.ai?.results?.[i];
    return { ...fd, a: hum || (ai ? { ...ai, final: ai.certainty || ai.confidence, explanation: `${ai.explanation || ""} (AI draft, not checked)` } : null) };
  });
  const robRows = sel.map(r => {
    const t = toolFor(p, r.rid), hum = robOverall(p, r.rid);
    const ai = aiRob(p, r, texts[r.rid]).fresh;
    const id = hum || ai?.overall;
    return id ? [r.rid, `${t.name}: ${levelOf(t, id, !!t.overallLevels)?.label || id}${hum ? "" : " (AI draft, not checked)"}`] : null;
  }).filter(Boolean);
  return {
    question: p.protocol.question, date: today(), verified: ver,
    methods: {
      protocol: `The question, eligibility criteria, search concepts and data fields were drafted by ${p.scan?.plan?.model || "an AI model"} and ${p.scan?.plan?.approved ? `approved by the author on ${p.scan.plan.approved} as the protocol of this scan` : "have not been approved by a person"}.`,
      criteria: p.criteria, sources, searchDate: s.date,
      search: s.pubmed ? `PubMed was searched on ${s.date} and the ${s.pubmed.fetched} most relevant of ${s.pubmed.count} records were kept (PubMed relevance ranking); Europe PMC ${s.europepmc?.fetched ?? 0} of ${s.europepmc?.count ?? 0}${s.registers ? `; ClinicalTrials.gov ${s.registers.fetched} of ${s.registers.count}` : ""}. Duplicates were linked with the method of Bramer et al. (2016). ${p.scan?.press?.reviewer ? `The search was peer reviewed (PRESS) by ${p.scan.press.reviewer}.` : "The search was not peer reviewed."}` : "",
      queries: s.pubmed ? [["PubMed", s.pubmed.query], ["Europe PMC", s.europepmc?.query || ""]] : [],
      selection: humanTA >= c.screened && c.screened ? `${f.screenMode === "dual" ? "Two people" : "One person"} screened every title and abstract${f.screenMode === "assisted" ? " with the AI suggestion shown, after a blind calibration sample" : " independently of the AI, which acted as second reviewer"}; disagreements were resolved by ${f.screenMode === "dual" ? "consensus" : "the person"}.`
        : `An AI model (${p.auto?.backend || "see AI use disclosure"}) judged every title and abstract against each criterion with verbatim quotes; ${humanTA} of ${c.screened} decisions were checked by a person. Records judged unclear were kept.`,
      extraction: `An AI model extracted each field with a verbatim quote, and each quote was checked automatically against the text. ${f.extractChecked >= sel.length && sel.length ? "Every value was then checked against its quote by the author." : `${f.extractChecked} of ${sel.length} papers were checked by a person.`}`,
      appraisal: tools.length && (robRows.length) ? `Studies were appraised with ${tools.join(" and ")}. ${ver.appraise ? "Every domain was judged by the author." : "Domain judgements are AI drafts that no person has checked yet."}` : "",
      synthesis: `The extracted data were synthesised narratively in a draft by ${p.scan?.summary?.model || "an AI model"}${p.scan?.summary?.approved ? `, checked against the papers and approved by the author on ${p.scan.summary.approved}` : " that has not been checked"}. ${findings.length ? `Certainty per finding with ${p.certainty?.approach === "cerqual" ? "GRADE-CERQual" : "GRADE"}${ver.certainty ? ", rated by the author" : " (AI draft)"}.` : ""}`,
    },
    flow: { ...flow, identified: c.identified, duplicates: c.duplicates, withText: sel.filter(r => hasText(p, r.rid)).length },
    papers: sel.map(r => ({ rid: r.rid, short: `${surname(r.authors)} ${r.year || ""}`, values: paperValues(p, r, texts) })),
    fields: p.extraction.fields.map(x => x.label), robTool: tools.join(", "), robRows,
    summary: p.scan?.summary, sof: sofRows.some(r => r.a) ? sofMarkdown(p.certainty?.approach || "grade", sofRows) : null,
    limits: scanLimits(p, f),
    disclosure: [...f.disclosure, p.auto?.started ? `Auto mode: the AI steps were first run unattended (${p.auto.backend}, ${p.auto.last}); every part marked ⚠ has not yet been checked by a person.` : ""].filter(Boolean),
    refs: sel.map(r => `[${r.rid}] ${surname(r.authors)} ${r.year || ""}. ${String(r.title || "").replace(/\.$/, "")}. ${String(r.journal || "").replace(/\.$/, "")}${r.doi ? `. https://doi.org/${r.doi}` : r.pmid ? `. PMID ${r.pmid}` : ""}`),
    text: p.auto?.manuscript,
  };
}

export function autoCard(ctx, cache) {
  const p = ctx.project, b = activeBackend();
  const canCall = b.kind !== "manual";
  const log = h("div", { class: "log auto-log" });
  const prog = progress();
  let ctrl = null;
  const add = (msg, kind = "") => log.prepend(h("div", { class: kind }, msg));
  const start = btn([h("span", { "aria-hidden": "true" }, "▶ "), p.auto?.finished ? "Run auto mode again (only what changed)" : "Run auto mode"], async () => {
    ctrl = new AbortController(); start.disabled = true; stop.disabled = false;
    try { await runAuto(ctx, { cache, log: add, prog, signal: ctrl.signal }); }
    catch (e) { add(e.message, "err"); toast(e.message, "err"); }
    start.disabled = false; stop.disabled = true;
    ctx.rerender();
    setTimeout(() => document.getElementById("auto-manuscript")?.scrollIntoView({ block: "start" }), 120);
  }, "primary");
  const stop = btn("Stop", () => ctrl?.abort(), "ghost");
  stop.disabled = true;
  return h("details", { class: "card auto-card", open: !p.auto && !p.records.length },
    h("summary", {}, h("strong", {}, "Auto mode: question in, manuscript draft out"), h("span", { class: "muted small" }, p.auto?.finished ? ` · last run ${p.auto.last}` : " · every AI step unattended, then you check")),
    h("p", { class: "small" }, "One click runs every AI step: plan, live search, screening, open-access texts, extraction, appraisal, summary, certainty, introduction and discussion. ",
      "The result is a manuscript draft marked ", h("strong", {}, "UNVERIFIED AI DRAFT"), " until you have done the checks below: guidance does not allow AI to fully automate any step, so the decisions in the draft are suggestions, not findings."),
    !canCall ? help(cache ? "This example has recorded answers: auto mode replays them without a key. Steps without a recorded answer need an API key or a local model."
      : "Auto mode needs a model that can be called without you: an API key or a local model (Models & keys). Copy-paste cannot run unattended: use the stages below instead.") : null,
    row(start, stop, !canCall && !cache ? h("a", { class: "btn ghost", href: "#/settings" }, "Models & keys") : null),
    prog.el, log);
}

export function manuscriptCard(ctx, texts) {
  const p = ctx.project;
  if (!p.auto?.manuscript && !p.auto?.finished) return null;
  const d = manuscriptData(p, texts);
  const mdText = manuscriptMarkdown(d);
  const ver = d.verified;
  const n = AUTO_STEPS.filter(s => ver[s.id]).length;
  const preview = h("div", { class: "manuscript-preview" });
  preview.innerHTML = markdownToHtml(mdText).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");   // the text is escaped by markdownToHtml
  const stageOf = { plan: "plan", search: "search", screen: "screen", texts: "texts", extract: "extract", appraise: "appraise", summary: "summary", certainty: "summary", manuscript: "auto-manuscript" };
  return h("section", { class: "card", id: "auto-manuscript" },
    h("h3", {}, "Manuscript draft"),
    h("p", { class: `badge ${n === AUTO_STEPS.length ? "ok" : "err"}` }, n === AUTO_STEPS.length ? "Every step checked by you" : `UNVERIFIED AI DRAFT · ${n} of ${AUTO_STEPS.length} steps checked by you`),
    h("ol", { class: "auto-verify" }, AUTO_STEPS.map(s => h("li", { class: ver[s.id] ? "done" : "" }, h("span", { class: "tick" }, ver[s.id] ? "✓" : "⚠"), " ",
      h("a", { href: "#", onclick: e => { e.preventDefault(); document.getElementById(stageOf[s.id] === "auto-manuscript" ? "auto-manuscript" : `scan-${stageOf[s.id]}`)?.scrollIntoView({ block: "start" }); } }, `${s.label}: ${s.check}`)))),
    row(btn("Download (.md)", () => download(`${p.id}-manuscript.md`, mdText, "text/markdown"), "primary"),
      btn("Download for Word (.doc)", () => download(`${p.id}-manuscript.doc`, markdownToHtml(mdText, d.text?.title || "Manuscript"), "application/msword")),
      btn("Copy", () => copy(mdText)),
      p.auto?.manuscript && !p.auto.manuscript.approved ? btn("I read and rewrote the introduction and discussion", () => { p.auto.manuscript.approved = today(); ctx.save(); ctx.rerender(); }, "ghost") : null),
    h("details", { open: true }, h("summary", {}, "Read the draft"), preview));
}
