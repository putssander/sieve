import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
// Step 2: build the search string as concept blocks and tune it against PubMed:
// counts, recall on a validation set and a hold-out set, why articles are missed,
// per-term contribution, MeSH of known articles, a precision sample, versions and translations.

import { h, clear, toast, copy, fmt, pct, wilson, today, slug, sleep } from "../util.js";
import { card, btn, help, field, input, textarea, select, row, table, runPanel, modal, progress, badge } from "../ui.js";
import { pmQuery, pmBlock, blockTerms, toOvid, toWos, diffBlocks } from "../query.js";
import { pmCount, pmHits, pmSummaries, pmFetch, pmIds } from "../apis.js";
import { strategiesCard } from "./strategies.js";
import { parseStrategyText, translateStrategy, formatTranslation } from "../strategy.js";
import { SYSTEM_SEARCH, searchFromProtocolPrompt, searchBlocksSchema, suggestTermsPrompt, suggestSchema, titleJudgePrompt, titleJudgeSchema } from "../prompts.js";

export function render(m, ctx) {
  const p = ctx.project, S = p.search;
  m.append(stepIntro("search", "Build the string as concept blocks (terms within a block are OR-ed, include blocks are AND-ed, exclude blocks are removed with NOT). "
    + "Test changes in PubMed to improve coverage and understand your screening workload. Finding all your known papers does not guarantee that you have found every relevant study."));

  // Jump bar: the page is long, and the known articles drive every test.
  const sections = [];
  const sec = (id, label, el) => { el.id = `sec-${id}`; sections.push([id, label]); m.append(el); return el; };
  const nav = h("nav", { class: "jumpbar" });
  m.append(nav);

  // ---------------------------------------------------------------- known articles (first: everything is tested against them)
  sec("known", `Known articles (${S.validation.length} + ${S.holdout.length})`, h("section", { class: "card known" },
    h("h3", {}, "Check your search against papers you already know"),
    help("Use one group of relevant papers to improve your search. Keep a different group aside to check whether it also finds papers you did not use to build it. Select an ⓘ button for an explanation."),
    h("div", { class: "grid2" }, pmidSetCard(ctx, "validation", `Validation set (${S.validation.length})`, "Use these known relevant papers while improving your search."),
      pmidSetCard(ctx, "holdout", `Hold-out set (${S.holdout.length})`, ["Keep aside while building the search. Helps check for ", termHelp("overfitting", "overfitting"), "."]))));

  // ---------------------------------------------------------------- blocks
  const blocksEl = h("div", { class: "blocks" });
  const drawBlocks = () => {
    clear(blocksEl);
    S.blocks.forEach((b, i) => blocksEl.append(blockEditor(ctx, b, i, drawBlocks)));
  };
  drawBlocks();
  // A strategy loaded from a ticket comes first when there are no PubMed blocks yet.
  const strategies = strategiesCard(ctx);
  const strategiesFirst = S.strategies?.length && !S.blocks.length;
  if (strategiesFirst) sec("strategies", "Database strategies", strategies);
  sec("blocks", "PubMed blocks", card(termHelp("blocks", "Concept blocks (PubMed)"),
    row(btn("+ Include block", () => { S.blocks.push({ id: uid(S.blocks, "block"), label: "New concept", role: "include", terms: [] }); ctx.save(); drawBlocks(); }),
      btn("+ Exclude block", () => { S.blocks.push({ id: uid(S.blocks, "excl"), label: "Exclude: …", role: "exclude", terms: [] }); ctx.save(); drawBlocks(); }),
      h("span", { class: "spacer" }),
      btn("Draft blocks from protocol", () => draftBlocks(ctx), "")),
    help("One term per line in PubMed syntax: ", h("code", {}, '"machine learning"[tiab]'), " · ", h("code", {}, "Artificial Intelligence[Mesh]"), " · ", h("code", {}, "implement*[ti]"),
      " · proximity: ", h("code", {}, "NEAR/4(AI | machine learning ; implemented | deployed)[tiab]"), ". Lines starting with # are ignored (handy to switch a term off)."),
    blocksEl));

  if (!strategiesFirst) sec("strategies", "Database strategies", strategies);

  // ---------------------------------------------------------------- test
  const testEl = h("div");
  drawTest(testEl, ctx);
  sec("test", "Test in PubMed", card("Test in PubMed", testEl));

  // ---------------------------------------------------------------- diagnostics
  const diag = h("div");
  sec("diagnostics", "Diagnostics", card("Term diagnostics",
    help("For each term: records it brings in (within the rest of the query), records ONLY this term brings in (its unique contribution, i.e. what you lose by removing it), "
      + "and known relevant articles that depend on it. A term that finds none of your known papers may still find other relevant studies: inspect its results before removing it."),
    row(field("Block", select("", [["", "choose a block…"], ...S.blocks.filter(b => b.enabled !== false).map(b => [b.id, b.label])], v => v && termDiagnostics(ctx, v, diag)))),
    diag));

  sec("mesh", "MeSH", meshCard(ctx));
  sec("sample", "Precision sample", sampleCard(ctx));
  sec("versions", "Versions", versionsCard(ctx));
  sec("translations", "Translations (blocks)", translationsCard(ctx));
  nav.append(h("span", { class: "muted small" }, "Jump to:"), ...sections.map(([id, label]) =>
    h("button", { class: "btn ghost sm", onclick: () => document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }) }, label)));
}

function uid(list, base) { let i = list.length + 1; while (list.some(b => b.id === `${base}${i}`)) i++; return `${base}${i}`; }

function blockEditor(ctx, b, i, redraw) {
  const S = ctx.project.search;
  const countEl = h("span", { class: "badge" }, S.last?.blockCounts?.[b.id] !== undefined ? fmt(S.last.blockCounts[b.id]) : "–");
  return h("div", { class: `block ${b.role || "include"} ${b.enabled === false ? "off" : ""}` },
    row(input(b.label, v => { b.label = v; ctx.save(); }, { style: { fontWeight: 600, flex: 1 } }), countEl),
    row(select(b.role || "include", [["include", "include (AND)"], ["exclude", "exclude (NOT)"]], v => { b.role = v; ctx.save(); redraw(); }),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: b.enabled !== false, onchange: e => { b.enabled = e.target.checked; ctx.save(); redraw(); } }), "on"),
      h("span", { class: "muted small" }, `${blockTerms(b).length} terms`),
      h("span", { class: "spacer" }),
      btn("✕", () => { if (confirm(`Remove block '${b.label}'?`)) { S.blocks.splice(i, 1); ctx.save(); redraw(); } }, "ghost sm danger")),
    h("div", { class: "terms" }, textarea(b.terms.join("\n"), v => { b.terms = v.split("\n"); ctx.save(); }, { spellcheck: false })),
    b.note && h("p", { class: "muted small" }, b.note));
}

// ------------------------------------------------------------------ test run
function drawTest(el, ctx) {
  const S = ctx.project.search;
  clear(el);
  const q = pmQuery(S.blocks);
  const prog = progress();
  el.append(row(btn("Run test", async e => {
    e.target.disabled = true;
    try { await runTest(ctx, prog); drawTest(el, ctx); }
    catch (err) { toast(`PubMed: ${err.message}`, "err"); e.target.disabled = false; }
  }, "primary"),
  btn("Save as version", () => saveVersion(ctx)),
  btn("Copy PubMed string", () => copy(q)),
  q.length < 7000 && h("a", { class: "btn", target: "_blank", rel: "noopener", href: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}` }, "Open in PubMed ↗"),
  h("span", { class: "muted small" }, `${q.length.toLocaleString()} characters`)), prog.el);

  const L = S.last;
  if (!L) { el.append(help("Not tested yet. A test runs about 5 + number of blocks PubMed queries.")); return; }
  const stale = L.query !== q;
  el.append(h("div", { class: "stats" },
    stat(fmt(L.count), "records"),
    stat(`${L.validation.found.length}/${L.validation.total}`, "validation found"),
    L.holdout && stat(`${L.holdout.found.length}/${L.holdout.total}`, "hold-out found"),
    stat(L.date, stale ? "tested · string changed since" : "tested")));
  if (stale) el.append(h("p", { class: "badge warn" }, "The blocks changed after this test: run it again."));
  const missed = [...L.validation.missed.map(x => ({ ...x, set: "validation" })), ...(L.holdout?.missed || []).map(x => ({ ...x, set: "hold-out" }))];
  if (missed.length) {
    el.append(h("h4", {}, "Missed articles and why"),
      table([
        { label: "Set", render: r => badge(r.set, r.set === "validation" ? "err" : "warn") },
        { label: "PMID", render: r => h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, target: "_blank" }, r.pmid) },
        { label: "Title", cls: "title", render: r => r.title || "" },
        { label: "Fails block", render: r => r.fails.length ? r.fails.join(", ") : "–" },
        { label: "Removed by", render: r => r.removedBy?.length ? r.removedBy.join(", ") : "–" },
        { label: "In PubMed", render: r => (r.inPubmed === false ? badge("not indexed", "warn") : "yes") },
      ], missed),
      row(btn("Ask the assistant for terms that recover these", () => suggestTerms(ctx), "primary")));
  } else {
    el.append(h("p", { class: "hit" }, "✓ All validation and hold-out articles are found."), row(btn("Ask the assistant how to cut noise", () => suggestTerms(ctx))));
  }
}

const stat = (v, l) => h("div", { class: "stat" }, h("b", {}, v), h("span", {}, l));

async function runTest(ctx, prog) {
  const S = ctx.project.search;
  const blocks = S.blocks.filter(b => b.enabled !== false && blockTerms(b).length);
  const q = pmQuery(S.blocks);
  if (!q) throw new Error("no terms yet");
  const val = S.validation.map(v => v.pmid), ho = S.holdout.map(v => v.pmid);
  const steps = 1 + blocks.length + 2 + (val.length + ho.length ? 2 : 0);
  let done = 0; const tick = m => prog.set(++done, steps, m);
  const { count } = await pmCount(q); tick("total");
  const blockCounts = {};
  for (const b of blocks) { blockCounts[b.id] = (await pmCount(pmBlock(b))).count; tick(b.label); }
  const all = [...val, ...ho];
  const found = await pmHits(q, all); tick("recall");
  const inPubmed = all.length ? await pmHits("all[sb]", all) : new Set(); tick("indexed");
  const titles = S.validation.concat(S.holdout).reduce((o, v) => (o[v.pmid] = v.label, o), {});
  const missing = all.filter(x => !found.has(x));
  // Why is each missed article missed? Test it against each block separately.
  const why = {};
  if (missing.length) {
    for (const b of blocks) {
      const hit = await pmHits(pmBlock(b), missing);
      for (const x of missing) {
        why[x] ||= { fails: [], removedBy: [] };
        if (b.role === "exclude" ? hit.has(x) : !hit.has(x)) (b.role === "exclude" ? why[x].removedBy : why[x].fails).push(b.label);
      }
    }
  }
  tick("diagnosis");
  const pack = set => ({
    total: set.length,
    found: set.filter(x => found.has(x)),
    missed: set.filter(x => !found.has(x)).map(x => ({ pmid: x, title: titles[x], inPubmed: inPubmed.has(x), ...(why[x] || { fails: [], removedBy: [] }) })),
  });
  S.last = { date: today(), query: q, count, blockCounts, validation: pack(val), holdout: ho.length ? pack(ho) : null };
  ctx.save();
}

function saveVersion(ctx) {
  const S = ctx.project.search;
  const L = S.last, q = pmQuery(S.blocks);
  if (!L || L.query !== q) { toast("Run the test first so the version has counts", "warn"); return; }
  const name = prompt("Version name", `V${S.versions.length + 1}`);
  if (!name) return;
  S.versions.push({ name, date: L.date, count: L.count, recall: `${L.validation.found.length}/${L.validation.total}`,
    holdout: L.holdout ? `${L.holdout.found.length}/${L.holdout.total}` : "", missed: L.validation.missed.map(x => x.pmid),
    query: q, blocks: structuredClone(S.blocks), note: prompt("What changed? (optional)", "") || "" });
  ctx.save(); ctx.rerender();
}

// ------------------------------------------------------------------ validation / hold-out
function pmidSetCard(ctx, key, title, desc) {
  const S = ctx.project.search;
  const ta = textarea(S[key].map(v => `${v.pmid}${v.label ? "  " + v.label : ""}`).join("\n"), () => {}, { rows: 8, class: "code", placeholder: "one PMID per line, optionally followed by a label" });
  return card(termHelp(key, title), help(desc), help("Enter one ", termHelp("pmid"), " per line; an optional title can follow it."),
    ta,
    row(btn("Save & look up titles", async () => {
      const lines = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
      const items = lines.map(l => { const m = l.match(/^(\d{5,9})\s*(.*)$/); return m && { pmid: m[1], label: m[2] }; }).filter(Boolean);
      const prev = Object.fromEntries(S[key].map(v => [v.pmid, v]));
      try {
        // Titles and DOIs are looked up so the records step can match these articles in every database export.
        const sums = await pmSummaries(items.filter(i => !i.label || !prev[i.pmid]?.doi).map(i => i.pmid));
        S[key] = items.map(i => ({ ...prev[i.pmid], pmid: i.pmid, label: i.label || sums[i.pmid]?.title || prev[i.pmid]?.label || "", title: sums[i.pmid]?.title || prev[i.pmid]?.title || "",
          doi: prev[i.pmid]?.doi || sums[i.pmid]?.doi || "", year: prev[i.pmid]?.year || sums[i.pmid]?.year || "" }));
        ctx.save(); toast(`${S[key].length} articles`); ctx.rerender();
      } catch (e) { toast(e.message, "err"); }
    }), h("span", { class: "muted small" }, `${S[key].length} articles`)));
}

// ------------------------------------------------------------------ per-term diagnostics
async function termDiagnostics(ctx, blockId, el) {
  const S = ctx.project.search;
  const b = S.blocks.find(x => x.id === blockId);
  const terms = blockTerms(b);
  const val = S.validation.map(v => v.pmid);
  clear(el);
  const prog = progress();
  let stop = false;
  el.append(row(btn("Stop", () => { stop = true; }, "ghost")), prog.el, help(`${terms.length} terms × 3 queries ≈ ${Math.ceil(terms.length * 3 * 0.36)} s without an NCBI key.`));
  const rows = [];
  const tableHost = h("div");
  el.append(tableHost);
  const others = { ...Object.fromEntries([[b.id, null]]) };
  for (let i = 0; i < terms.length && !stop; i++) {
    const t = terms[i];
    const single = pmBlock({ terms: [t] });
    const rest = pmBlock(b, i);
    try {
      if (b.role === "exclude") {
        // What does this exclusion term remove from the include part, and does it remove validation articles?
        const inc = pmQuery(S.blocks.filter(x => x.role !== "exclude"));
        const hits = (await pmCount(`(${inc}) AND ${single}`)).count;
        const uniq = rest ? (await pmCount(`(${inc}) AND ${single} NOT ${rest}`)).count : hits;
        const v = await pmHits(`(${inc}) AND ${single}`, val);
        rows.push({ term: t, hits, uniq, vals: [...v], removes: true });
      } else {
        const base = pmQuery(S.blocks, { override: { [b.id]: single } });
        const hits = (await pmCount(base)).count;
        const uniq = rest ? (await pmCount(`(${base}) NOT ${rest}`)).count : hits;
        const v = await pmHits(base, val);
        rows.push({ term: t, hits, uniq, vals: [...v] });
      }
    } catch (e) { rows.push({ term: t, error: e.message, vals: [] }); }
    prog.set(i + 1, terms.length);
    // Validation articles found by exactly one term of this block depend on it.
    const counts = {};
    rows.forEach(r => r.vals.forEach(x => (counts[x] = (counts[x] || 0) + 1)));
    rows.forEach(r => (r.needed = r.vals.filter(x => counts[x] === 1)));
    clear(tableHost).append(table([
      { label: "Term", render: r => h("code", {}, r.term.length > 90 ? r.term.slice(0, 90) + "…" : r.term) },
      { label: b.role === "exclude" ? "Removes" : "Hits", cls: "num", render: r => r.error ? h("span", { class: "err-text" }, r.error) : fmt(r.hits) },
      { label: "Unique", cls: "num", title: "records that only this term contributes", render: r => fmt(r.uniq) },
      { label: b.role === "exclude" ? "Validation removed" : "Validation found", cls: "num", render: r => r.removes ? (r.vals.length ? h("span", { class: "miss" }, r.vals.length) : "0") : r.vals.length },
      { label: "Needed for", render: r => r.removes ? "" : r.needed.length ? h("span", { class: "hit" }, r.needed.join(", ")) : "" },
    ], [...rows].sort((a, c) => (c.uniq || 0) - (a.uniq || 0)), { limit: 500 }));
  }
}

// ------------------------------------------------------------------ MeSH analyser
function meshCard(ctx) {
  const S = ctx.project.search;
  const out = h("div");
  return card(termHelp("mesh", "MeSH & keywords of the validation set"),
    help("Find the topic labels and keywords used by your known papers, then compare them with your search terms."),
    row(btn("Analyse", async e => {
      e.target.disabled = true;
      try {
        const recs = await pmFetch([...S.validation, ...S.holdout].map(v => v.pmid));
        const all = S.blocks.flatMap(blockTerms).join(" ").toLowerCase();
        const tally = (key) => {
          const c = {};
          recs.forEach(r => new Set(r[key].map(x => x.trim())).forEach(x => (c[x] = (c[x] || 0) + 1)));
          return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([term, n]) => ({ term, n, inString: all.includes(term.toLowerCase()) }));
        };
        clear(out).append(h("div", { class: "grid2" },
          h("div", {}, h("h4", {}, `MeSH headings (${recs.length} articles)`), table(meshCols, tally("mesh"))),
          h("div", {}, h("h4", {}, "Author keywords"), table(meshCols, tally("keywords")))));
      } catch (err) { toast(err.message, "err"); }
      e.target.disabled = false;
    })), out);
}
const meshCols = [
  { label: "Term", render: r => r.term },
  { label: "Articles", cls: "num", render: r => r.n },
  { label: "In string", render: r => (r.inString ? h("span", { class: "hit" }, "✓") : h("span", { class: "muted" }, "–")) },
];

// ------------------------------------------------------------------ precision sample
function sampleCard(ctx) {
  const S = ctx.project.search;
  const body = h("div");
  const draw = () => {
    clear(body);
    const sm = S.sample;
    body.append(row(field("Sample size", input(sm?.items.length || 50, () => {}, { type: "number", id: "sampleN", style: { maxWidth: "100px" } })),
      btn("Draw random sample", async e => {
        e.target.disabled = true;
        try {
          const q = pmQuery(S.blocks);
          const n = Number(document.getElementById("sampleN").value) || 50;
          const { count } = await pmCount(q);
          const ids = await pmIds(q, Math.min(count, 9999));
          const pick = [...ids].sort(() => Math.random() - 0.5).slice(0, n);
          const sums = await pmSummaries(pick);
          S.sample = { query: q, date: today(), count, biased: count > 9999, items: pick.map(id => ({ pmid: id, title: sums[id]?.title || "", year: sums[id]?.year || "", journal: sums[id]?.journal || "", human: "", model: "" })) };
          ctx.save(); draw();
        } catch (err) { toast(err.message, "err"); e.target.disabled = false; }
      }),
      sm && btn("Judge titles with the assistant", () => judgeTitles(ctx, draw))));
    if (!sm) { body.append(help("Draw random titles from the current result and judge them yes / maybe / no to estimate precision (the share of relevant records).")); return; }
    const judged = sm.items.filter(i => i.human || i.model);
    const yes = judged.filter(i => (i.human || i.model) === "yes").length, maybe = judged.filter(i => (i.human || i.model) === "maybe").length;
    const [lo] = wilson(yes, judged.length), [, hi] = wilson(yes + maybe, judged.length);
    body.append(h("div", { class: "stats" }, stat(`${judged.length}/${sm.items.length}`, "judged"), stat(yes, "yes"), stat(maybe, "maybe"),
      judged.length && stat(`${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, "estimated precision (95% CI, yes … yes+maybe)"),
      judged.length && stat(`${fmt(Math.round(lo * sm.count))}–${fmt(Math.round(hi * sm.count))}`, `relevant of ${fmt(sm.count)} records`)));
    if (sm.biased) body.append(help("PubMed only returns the first 9,999 records (newest first), so this sample leans towards recent years."));
    body.append(table([
      { label: "Title", cls: "title", render: r => h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, target: "_blank" }, r.title) },
      { label: "Year", render: r => r.year },
      { label: "Model", render: r => r.model ? badge(r.model, r.model === "yes" ? "ok" : r.model === "maybe" ? "warn" : "") : "" },
      { label: "You", render: r => h("span", {}, ["yes", "maybe", "no"].map(v => btn(v, () => { r.human = r.human === v ? "" : v; ctx.save(); draw(); }, `sm ${r.human === v ? "on" : ""}`))) },
    ], sm.items, { limit: 100 }));
  };
  draw();
  return card(termHelp("precision", "Precision sample"), body);
}

function judgeTitles(ctx, redraw) {
  const p = ctx.project, sm = p.search.sample;
  const items = sm.items.map(i => ({ id: i.pmid, label: i.title.slice(0, 50) }));
  const close = modal("Judge sample titles", runPanel({
    title: "title-judge", system: SYSTEM_SEARCH, items, runName: "title-judge",
    build: its => ({ prompt: titleJudgePrompt(p, sm.items.filter(i => its.some(x => x.id === i.pmid))), schema: titleJudgeSchema, name: "titles" }),
    save: (id, json) => {
      // A single-item call returns {results:[...]}; a batch answer is split per id by the run panel.
      const list = json.results || [json];
      for (const r of list) { const it = sm.items.find(i => i.pmid === String(r.id ?? id)); if (it && r.judgement) it.model = r.judgement; }
    },
    done: () => { ctx.save(); redraw(); },
  }), { wide: true });
}

// ------------------------------------------------------------------ versions
function versionsCard(ctx) {
  const S = ctx.project.search;
  return card("Versions",
    help("Save a version after each tested change. This table is the audit trail for the methods section and for PRESS peer review."),
    table([
      { label: "Version", render: v => h("strong", {}, v.name) },
      { label: "Date", render: v => v.date },
      { label: "Records", cls: "num", render: v => fmt(v.count) },
      { label: "Validation", render: v => v.recall },
      { label: "Hold-out", render: v => v.holdout || "–" },
      { label: "Missed", render: v => (v.missed || []).join(", ") },
      { label: "Note", render: v => v.note || "" },
      { label: "", render: v => row(
        btn("Copy", e => { e.stopPropagation(); copy(v.query); }, "sm"),
        v.blocks && btn("Diff", e => { e.stopPropagation(); showDiff(v, S.blocks); }, "sm"),
        v.blocks && btn("Restore", e => { e.stopPropagation(); if (confirm(`Replace the current blocks with ${v.name}?`)) { S.blocks = structuredClone(v.blocks); ctx.save(); ctx.rerender(); } }, "sm"),
        btn("Recount", async e => { e.stopPropagation(); try { const { count } = await pmCount(v.query); toast(`${v.name}: ${fmt(count)} records today (was ${fmt(v.count)} on ${v.date})`); } catch (err) { toast(err.message, "err"); } }, "sm")) },
    ], S.versions, { empty: "No versions saved yet." }));
}

function showDiff(v, current) {
  const d = diffBlocks(v.blocks, current);
  modal(`Changes since ${v.name}`, d.length ? h("div", {}, d.map(x => h("div", { class: "block" }, h("strong", {}, x.label),
    x.added.map(t => h("div", { class: "hit mono" }, `+ ${t}`)), x.removed.map(t => h("div", { class: "miss mono" }, `− ${t}`)))))
    : h("p", {}, "No differences."), { wide: true });
}

// ------------------------------------------------------------------ translations
function translationsCard(ctx) {
  const S = ctx.project.search;
  const out = h("div");
  const show = which => {
    const r = which === "wos" ? toWos(S.blocks) : which === "medline" || which === "embase" ? toOvid(S.blocks, which) : viaStrategy(S, which);
    clear(out).append(row(btn("Copy", () => copy(r.text), "sm")), h("pre", {}, r.text),
      r.warnings.length && h("ul", { class: "small" }, r.warnings.map(w => h("li", { class: "muted" }, w))));
  };
  return card("Translations for other databases",
    help("Generated from the blocks. Always run them line by line in the database and record the counts: field codes and subject headings differ."),
    row(btn("Ovid MEDLINE", () => show("medline")), btn("Embase (Ovid)", () => show("embase")), btn("Web of Science", () => show("wos")),
      btn("PsycInfo (EBSCO)", () => show("psycinfo")), btn("ACM DL", () => show("acm")),
      btn("→ as database strategy", () => {
        const st = parseStrategyText(toOvid(S.blocks, "medline").text, "From the PubMed blocks (Ovid MEDLINE)");
        (S.strategies ||= []).push({ ...st, id: `st-blocks-${Date.now().toString(36)}`, imported: today(), source: "concept blocks" });
        ctx.save(); ctx.rerender(); toast("Added under Database strategies: check it with the assistant there");
      }, "ghost")), out);
}

// PsycInfo and ACM go through the line-strategy translator: blocks → Ovid MEDLINE lines → target.
function viaStrategy(S, target) {
  const st = parseStrategyText(toOvid(S.blocks, "medline").text, "blocks");
  const r = translateStrategy(st, target, { headings: S.headingMap });
  return { text: `${formatTranslation(r)}\n\nAs one string:\n${r.single}`, warnings: r.warnings };
}

// ------------------------------------------------------------------ assistant tasks
function suggestTerms(ctx) {
  const p = ctx.project, S = p.search, L = S.last;
  let close;
  const run = async () => {
    const missed = [...(L?.validation.missed || []), ...(L?.holdout?.missed || [])];
    const recs = missed.length ? await pmFetch(missed.map(x => x.pmid)) : [];
    const info = missed.map(x => ({ ...x, ...(recs.find(r => r.pmid === x.pmid) || {}) }));
    const stats = L ? `${fmt(L.count)} records; validation ${L.validation.found.length}/${L.validation.total}` : "";
    close = modal("Term suggestions", runPanel({
      title: "search-suggest", system: SYSTEM_SEARCH, batchable: false, runName: "search-assistant",
      items: [{ id: "suggest", label: "search string" }],
      build: () => ({ prompt: suggestTermsPrompt(p, S.blocks, info, stats), schema: suggestSchema, name: "suggestions" }),
      save: (_, json) => { if (json._error) return toast(json._error, "err"); close(); showSuggestions(ctx, json); },
      done: () => {},
    }), { wide: true });
  };
  run().catch(e => toast(e.message, "err"));
}

function showSuggestions(ctx, json) {
  const S = ctx.project.search;
  const body = h("div", {}, json.notes && help(json.notes),
    table([
      { label: "", render: s => badge(s.action, s.action === "add" ? "ok" : "err") },
      { label: "Term", render: s => h("code", {}, s.term) },
      { label: "Block", render: s => s.block },
      { label: "Why", render: s => s.reason },
      { label: "", render: s => btn("Apply", e => {
        const b = S.blocks.find(x => x.label.toLowerCase() === String(s.block).toLowerCase()) || S.blocks.find(x => String(s.block).toLowerCase().includes(x.label.toLowerCase()));
        if (!b) return toast(`No block named '${s.block}'`, "err");
        if (s.action === "add") b.terms.push(s.term); else b.terms = b.terms.map(t => (t.trim() === s.term.trim() ? `# ${t}` : t));
        e.target.disabled = true; e.target.textContent = "applied"; ctx.save();
      }, "sm") },
    ], json.suggestions || []),
    help("Applied changes are not tested yet: close this window and press Run test."),
    row(btn("Close & re-render", () => { close(); ctx.rerender(); }, "primary")));
  const close = modal("Suggested changes", body, { wide: true });
}

function draftBlocks(ctx) {
  const p = ctx.project;
  if (!p.protocol.question) return toast("Write the review question in step 1 first", "warn");
  let close;
  close = modal("Draft concept blocks from the protocol", runPanel({
    title: "search-draft", system: SYSTEM_SEARCH, batchable: false, runName: "search-assistant",
    items: [{ id: "blocks", label: "protocol" }],
    build: () => ({ prompt: searchFromProtocolPrompt(p), schema: searchBlocksSchema, name: "blocks" }),
    save: (_, json) => {
      if (json._error) return toast(json._error, "err");
      const blocks = (json.blocks || []).map((b, i) => ({ id: `${slug(b.label).slice(0, 12)}${i}`, label: b.label, role: b.role, terms: b.terms }));
      if (!blocks.length) return toast("No blocks in the answer", "err");
      if (p.search.blocks.length && !confirm(`Replace the ${p.search.blocks.length} current blocks? (Cancel = append)`)) p.search.blocks.push(...blocks);
      else p.search.blocks = blocks;
      ctx.save(); close(); ctx.rerender();
      toast("Blocks drafted: test them in PubMed and refine");
    },
    done: () => {},
  }), { wide: true });
}
