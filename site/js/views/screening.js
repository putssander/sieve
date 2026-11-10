import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
// Step 6: screening. Any number of model runs (copy-paste, API, local/Colab, imported) next to
// the human decision. Disagreements are sorted to the top, every evidence quote is checked
// against the source text, and agreement statistics show how far a model can be trusted.

import { showEvidence } from "./evidence.js";
import { highlightHtml } from "../evidence.js";
import { h, clear, toast, fmt, kappa, quoteInSource, quotedFragments, XLSX, esc } from "../util.js";
import { card, btn, help, row, table, modal, badge, select, textarea, runPanel, field } from "../ui.js";
import { DECISIONS, SYSTEM_SCREEN, screeningPrompt, screeningSchema, screeningBatchSchema, sourceBlock } from "../prompts.js";
import { getText } from "../store.js";
import { active } from "./records.js";

export const isInclude = d => (d === "Include" ? true : d && d.startsWith("Exclude") ? false : null);
const dclass = d => (d === "Include" ? "d-Include" : d === DECISIONS[2] ? "d-snowball" : d === "Exclude" ? "d-Exclude" : "d-Unclear");
export const dbadge = d => (d ? h("span", { class: `badge ${dclass(d)}` }, d === DECISIONS[2] ? "Exclude · snowball" : d) : h("span", { class: "muted" }, "–"));

function normDecision(d) {
  const s = String(d || "").toLowerCase();
  if (s.startsWith("incl")) return "Include";
  if (s.includes("snowball")) return DECISIONS[2];
  if (s.startsWith("excl")) return "Exclude";
  return "Unclear";
}

// Final decision for downstream steps: the human decision wins; otherwise models that all agree.
export function consensus(p, rid, layer = "human") {
  const hum = p.screening[layer]?.[rid]?.decision;
  if (hum) return hum;
  const ds = Object.values(p.screening.runs).map(r => r.results?.[rid]).filter(x => x && !x._error).map(x => x.decision);
  if (!ds.length) return null;
  const inc = [...new Set(ds.map(isInclude))];
  return inc.length === 1 ? (inc[0] === true ? "Include" : inc[0] === false ? "Exclude" : "Unclear") : "Unclear";
}

function priority(p, rid, runs, layer) {
  const res = runs.map(r => p.screening.runs[r].results?.[rid]).filter(Boolean);
  const inc = res.filter(x => !x._error).map(x => isInclude(x.decision)).filter(x => x !== null);
  const human = isInclude(p.screening[layer]?.[rid]?.decision);
  if (new Set(inc).size > 1) return "DISAGREE-MODELS";
  if (human !== null && inc.length && inc.some(x => x !== human)) return "DISAGREE-HUMAN";
  if (p.resolve[rid]?.flags?.length) return "FLAGGED";
  if (res.some(x => x.needs_human_review || x._error)) return "REVIEW";
  return "ok";
}
const PRIO_ORDER = { "DISAGREE-MODELS": 0, "DISAGREE-HUMAN": 1, FLAGGED: 2, REVIEW: 3, ok: 4 };

export async function render(m, ctx) {
  const p = ctx.project;
  const sc = p.screening;
  sc.human_ft ||= {};
  let stage = sessionStorage.getItem("screen-stage") || "ta";
  const layer = stage === "ft" ? "human_ft" : "human";
  const recs = active(p).filter(r => stage === "ta" || [true, null].includes(isInclude(consensus(p, r.rid))));
  const texts = {};
  await Promise.all(recs.filter(r => p.fulltext[r.rid] && !p.fulltext[r.rid].failed).map(async r => (texts[r.rid] = await getText(p.id, r.rid))));
  const runs = Object.keys(sc.runs);

  m.append(stepIntro("screening", "Screen with as many routes as you like (ChatGPT by copy-paste, an API model, a local model) and compare them with your own decisions. "
    + "Work from the top of the table: model–model and model–human disagreements first."));

  m.append(card("Stage",
    row(...[["ta", "Title / abstract"], ["ft", "Full text"]].map(([v, l]) => btn(l, () => { sessionStorage.setItem("screen-stage", v); ctx.rerender(); }, stage === v ? "on" : "")),
      h("span", { class: "muted small" }, stage === "ta" ? `${recs.length} unique records` : `${recs.length} records included or unclear after title/abstract`)),
    !p.criteria.length && h("p", { class: "badge err" }, "Add eligibility criteria in step 1 first.")));

  // ---------------------------------------------------------------- run
  if (p.criteria.length) {
    let scope = "unscreened";
    const host = h("div");
    const build = () => {
      const pick = scope === "all" ? recs : scope === "disagree" ? recs.filter(r => priority(p, r.rid, runs, layer) !== "ok")
        : recs.filter(r => !runs.some(id => sc.runs[id].results?.[r.rid] && (sc.runs[id].stage || "ta") === stage));
      clear(host).append(runPanel({
        title: `screening-${stage}`, system: SYSTEM_SCREEN, attachHint: stage === "ft",
        items: pick.map(r => ({ id: r.rid, label: `${r.rid} ${r.title.slice(0, 40)}` })),
        build: (items, opt = {}) => {
          const src = items.map(it => { const r = p.records.find(x => x.rid === it.id); return { source: sourceBlock(r, stage === "ft" && !opt.attachments ? texts[r.rid] : "") }; });
          return { prompt: screeningPrompt(p, src, opt), schema: items.length > 1 ? screeningBatchSchema(p) : screeningSchema(p), name: "screening" };
        },
        save: (id, json, run) => {
          const R = (sc.runs[run.id] ||= { label: run.label, model: run.model, backend: run.backend, date: run.date, stage, results: {} });
          R.results[id] = json._error ? json : { ...json, decision: normDecision(json.decision) };
        },
        done: () => { ctx.save(); },
      }));
      host.append(row(btn("Refresh table", () => ctx.rerender(), "ghost")));
    };
    m.append(card("Screen with a model",
      row(field("Which records", select(scope, [["unscreened", "not yet screened at this stage"], ["disagree", "disagreements / flagged / needs review"], ["all", "all"]], v => { scope = v; build(); }))),
      host));
    build();
  }

  // ---------------------------------------------------------------- comparison
  const rows = recs.map(r => ({ r, prio: priority(p, r.rid, runs, layer) })).sort((a, b) => PRIO_ORDER[a.prio] - PRIO_ORDER[b.prio] || a.r.rid.localeCompare(b.r.rid, undefined, { numeric: true }));
  const counts = rows.reduce((o, x) => ((o[x.prio] = (o[x.prio] || 0) + 1), o), {});
  let filter = sessionStorage.getItem("screen-filter") || "";
  const tableHost = h("div");
  const drawTable = () => clear(tableHost).append(table([
    { label: "ID", render: x => x.r.rid },
    { label: "Title", cls: "title", render: x => x.r.title },
    { label: "You", render: x => dbadge(sc[layer][x.r.rid]?.decision) },
    ...runs.map(id => ({ label: id, title: sc.runs[id].label, render: x => {
      const res = sc.runs[id].results?.[x.r.rid];
      if (!res) return h("span", { class: "muted" }, "–");
      if (res._error) return badge("error", "err");
      const bad = quotesOk(res, x.r, texts[x.r.rid], p) === false;
      return h("span", {}, dbadge(res.decision), res.needs_human_review ? " ⚑" : "", bad ? h("span", { class: "err-text", title: "a quote was not found in the source text" }, " ❝✗") : "");
    } })),
    { label: "Priority", render: x => (x.prio === "ok" ? h("span", { class: "muted" }, "ok") : badge(x.prio.toLowerCase(), x.prio.startsWith("DISAGREE") ? "err" : "warn")) },
  ], rows.filter(x => !filter || x.prio === filter), { onRow: x => detail(ctx, x.r, rows.filter(y => !filter || y.prio === filter).map(y => y.r), layer, texts, stage), rowClass: x => `prio-${x.prio}`, limit: 300 }));
  drawTable();
  m.append(card("Decisions",
    row(...[["", `all ${rows.length}`], ...Object.keys(PRIO_ORDER).filter(k => counts[k]).map(k => [k, `${k.toLowerCase()} ${counts[k]}`])].map(([k, l]) =>
      btn(l, () => { filter = k; sessionStorage.setItem("screen-filter", k); drawTable(); }, filter === k ? "on sm" : "sm")),
      h("span", { class: "spacer" }), btn("Export Excel", () => exportXlsx(p, rows, runs, layer))),
    help("⚑ = the model asks for human review · ❝✗ = an evidence quote does not occur in the title/abstract/full text (possible hallucination). Click a row to decide."),
    tableHost));

  m.append(metricsCard(p, recs, runs, layer));
}

// Everything the model was shown: metadata, abstract and full text.
// Everything a model was shown for this record, including the labelled metadata lines of the prompt
// ("YEAR: 2018", "AUTHORS: …"), so quotes copied from those lines verify too.
export const sourceText = (p, r, text) => [r.title, r.year, r.authors, r.journal, r.doi, r.link, p.resolve?.[r.rid]?.resolved_url, r.affiliation,
  r.year && `YEAR: ${r.year}`, r.authors && `AUTHORS: ${r.authors}`, r.journal && `JOURNAL: ${r.journal}`, r.doi && `DOI: ${r.doi}`, r.affiliation && `FIRST AUTHOR AFFILIATION: ${r.affiliation}`,
  r.abstract, text].filter(Boolean).join(" ");

function quotesOk(res, r, text, p) {
  const src = sourceText(p, r, text);
  const qs = [...(res.failed_criteria || []).map(f => f.evidence_quote), ...quotedFragments(res.eligibility_evidence)].filter(Boolean);
  const checks = qs.map(q => quoteInSource(q, src)).filter(x => x !== null);
  return checks.length ? checks.every(Boolean) : null;
}

// Inclusion and exclusion evidence of all runs for one record, highlighted in the paper.
function screeningEvidence(p, r, texts, runs, focusKey) {
  const qs = [];
  for (const id of runs) {
    const res = p.screening.runs[id].results[r.rid] || {};
    for (const f of res.failed_criteria || []) if (f.evidence_quote) qs.push({ key: `${id}|${f.criterion}`, quote: f.evidence_quote, label: `${id} · exclusion · ${p.criteria.find(c => c.id === f.criterion)?.label || f.criterion}` });
    for (const q of quotedFragments(res.eligibility_evidence)) qs.push({ key: `${id}|evidence`, quote: q, label: `${id} · ${res.decision === "Include" ? "inclusion" : "evidence"}` });
  }
  showEvidence(r, texts[r.rid], qs, { focus: Math.max(0, qs.findIndex(q => q.key === focusKey)), title: `${r.rid} · screening evidence` });
}

function detail(ctx, r, order, layer, texts, stage) {
  const p = ctx.project, sc = p.screening;
  const runs = Object.keys(sc.runs).filter(id => sc.runs[id].results?.[r.rid]);
  const src = sourceText(p, r, texts[r.rid]);
  const hum = sc[layer][r.rid] || {};
  const reason = textarea(hum.reason || "", () => {}, { rows: 2, placeholder: "reason (required for exclusions at full-text stage)" });
  const decide = d => {
    sc[layer][r.rid] = { decision: d, reason: reason.value, by: "you", date: new Date().toISOString().slice(0, 10), stage };
    ctx.save();
    const i = order.indexOf(r);
    close();
    if (order[i + 1]) detail(ctx, order[i + 1], order, layer, texts, stage); else ctx.rerender();
  };
  const crit = p.criteria;
  // Exclusion quotes marked in the abstract/full text (robust to PDF line breaks); click a quote for the full view.
  const highlight = text => highlightHtml(text, runs.flatMap(id => (sc.runs[id].results[r.rid].failed_criteria || [])
    .map(f => ({ quote: f.evidence_quote || "", label: `${id}: ${f.criterion}` })))).html;
  const body = h("div", {},
    h("div", { class: "grid2" },
      h("div", {},
        h("p", { class: "small muted" }, [r.authors, r.year, r.journal, r.doi].filter(Boolean).join(" · ")),
        p.resolve[r.rid]?.flags?.length ? h("p", {}, badge(`verify: ${p.resolve[r.rid].flags.join(", ")}`, "warn")) : null,
        h("div", { html: highlight(r.abstract || "(no abstract)") }),
        texts[r.rid] && h("details", {}, h("summary", {}, `Full text (${fmt(texts[r.rid].length)} characters)`), h("div", { class: "small", html: highlight(texts[r.rid].slice(0, 40000)) }))),
      h("div", {},
        runs.length ? h("div", { class: "tablewrap" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Criterion"), runs.map(id => h("th", { title: sc.runs[id].label }, id)))),
          h("tbody", {},
            h("tr", {}, h("td", {}, h("strong", {}, "Decision")), runs.map(id => h("td", {}, dbadge(sc.runs[id].results[r.rid].decision)))),
            crit.map(c => h("tr", {}, h("td", { title: c.description }, c.label), runs.map(id => {
              const v = sc.runs[id].results[r.rid].criteria?.[c.id];
              return h("td", {}, v ? badge(v, v === "Yes" ? "ok" : v === "No" ? "err" : "warn") : "–");
            })))))) : help("No model results for this record yet."),
        runs.map(id => {
          const res = sc.runs[id].results[r.rid];
          return h("div", { class: "block", style: { marginTop: "8px" } }, h("strong", {}, id), " ", res._error && h("span", { class: "err-text" }, res._error),
            (res.failed_criteria || []).map(f => { const ok = quoteInSource(f.evidence_quote, src);
              return h("p", { class: "small" }, h("b", {}, `${crit.find(c => c.id === f.criterion)?.label || f.criterion}: `),
                h("a", { href: "#", title: "show in the paper", onclick: e => { e.preventDefault(); screeningEvidence(p, r, texts, runs, `${id}|${f.criterion}`); } }, `“${f.evidence_quote}”`), " ",
                ok === true ? h("span", { class: "hit", title: "quote found in source" }, "✓") : ok === false ? h("span", { class: "miss", title: "quote NOT found in source" }, "✗ not in source") : "",
                h("br"), h("span", { class: "muted" }, f.interpretation)); }),
            res.eligibility_evidence && h("p", { class: "small" }, res.eligibility_evidence, " ",
              quotedFragments(res.eligibility_evidence).length ? h("a", { href: "#", onclick: e => { e.preventDefault(); screeningEvidence(p, r, texts, runs, `${id}|evidence`); } }, "show in the paper") : ""),
            res.screening_note && h("p", { class: "small muted" }, res.screening_note));
        }))),
    h("div", { class: "card", style: { marginTop: "12px" } },
      h("h3", {}, "Your decision"), reason,
      row(...DECISIONS.map(d => btn(d, () => decide(d), hum.decision === d ? "on" : d === "Include" ? "primary" : "")),
        h("span", { class: "spacer" }), h("span", { class: "muted small" }, `${order.indexOf(r) + 1} of ${order.length} · saving jumps to the next`))));
  const close = modal(`${r.rid} · ${r.title}`, body, { wide: true });
}

function metricsCard(p, recs, runs, layer) {
  const sc = p.screening;
  const human = recs.map(r => isInclude(sc[layer][r.rid]?.decision));
  const nh = human.filter(x => x !== null).length;
  const rowsVsHuman = runs.map(id => {
    const mdl = recs.map(r => { const x = sc.runs[id].results?.[r.rid]; return x && !x._error ? isInclude(x.decision) : null; });
    const k = kappa(mdl, human);
    const pairs = mdl.map((x, i) => [x, human[i]]).filter(([a, b]) => a !== null && b !== null);
    const tp = pairs.filter(([a, b]) => a && b).length, fn = pairs.filter(([a, b]) => !a && b).length, tn = pairs.filter(([a, b]) => !a && !b).length, fp = pairs.filter(([a, b]) => a && !b).length;
    const decided = mdl.filter(x => x !== null).length;
    return { id, label: sc.runs[id].label, screened: Object.keys(sc.runs[id].results || {}).length, decided, unclear: mdl.filter((x, i) => x === null && sc.runs[id].results?.[recs[i].rid]).length,
      n: k.n, agree: k.agree, kappa: k.kappa, sens: tp + fn ? tp / (tp + fn) : null, spec: tn + fp ? tn / (tn + fp) : null, fn };
  });
  const f2 = x => (x === null || x === undefined ? "–" : x.toFixed(2));
  const pairRows = [];
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = recs.map(r => isInclude(sc.runs[runs[i]].results?.[r.rid]?.decision)), b = recs.map(r => isInclude(sc.runs[runs[j]].results?.[r.rid]?.decision));
    const k = kappa(a, b);
    pairRows.push({ pair: `${runs[i]} × ${runs[j]}`, ...k });
  }
  return card("Agreement",
    help(`Compared with your decisions on ${nh} records. Check papers the model excluded but you included: they could be missed if you relied on the model alone. The information buttons explain each score.`),
    table([
      { label: "Run", render: x => h("span", { title: x.label }, x.id, (sc.runs[x.id]?.prompts || []).length
        ? h("div", { class: "small" }, "prompts used: ", sc.runs[x.id].prompts.map((pr, i) => [i ? " · " : "", h("a", { href: pr.file, target: "_blank", rel: "noopener" }, `batch ${i + 1}`)])) : "") },
      { label: "Screened", cls: "num", render: x => x.screened },
      { label: "Unclear", cls: "num", render: x => x.unclear },
      { label: "Compared", cls: "num", render: x => x.n },
      { label: "Agreement", cls: "num", render: x => (x.agree === null ? "–" : `${Math.round(x.agree * 100)}%`) },
      { label: termHelp("kappa", "Cohen's κ"), cls: "num", render: x => f2(x.kappa) },
      { label: termHelp("sensitivity"), cls: "num", render: x => (x.sens === null ? "–" : h("span", { class: x.sens < 0.95 ? "miss" : "hit" }, `${Math.round(x.sens * 100)}%`)) },
      { label: termHelp("specificity"), cls: "num", render: x => (x.spec === null ? "–" : `${Math.round(x.spec * 100)}%`) },
      { label: "Missed includes", cls: "num", render: x => x.fn },
    ], rowsVsHuman, { empty: "No model runs yet." }),
    pairRows.length > 0 && table([{ label: "Model × model", render: x => x.pair }, { label: "Compared", cls: "num", render: x => x.n },
      { label: "Agreement", cls: "num", render: x => (x.agree === null ? "–" : `${Math.round(x.agree * 100)}%`) }, { label: termHelp("kappa", "κ"), cls: "num", render: x => f2(x.kappa) }], pairRows));
}

async function exportXlsx(p, rows, runs, layer) {
  const X = await XLSX();
  const data = rows.map(({ r, prio }) => {
    const o = { record_id: r.rid, year: r.year, title: r.title, doi: r.doi, resolved_url: p.resolve[r.rid]?.resolved_url || r.link || "",
      verify_flags: (p.resolve[r.rid]?.flags || []).join("; "), human_decision: p.screening[layer][r.rid]?.decision || "", human_reason: p.screening[layer][r.rid]?.reason || "" };
    for (const id of runs) {
      const x = p.screening.runs[id].results?.[r.rid] || {};
      o[`${id}_decision`] = x.decision || "";
      o[`${id}_reason`] = x.decision === "Include" ? x.eligibility_evidence || "" : (x.primary_exclusion_reason || (x.failed_criteria || []).map(f => f.criterion).join("; "));
      o[`${id}_needs_review`] = x.needs_human_review ? "yes" : "";
      for (const c of p.criteria) o[`${id}_${c.id}`] = x.criteria?.[c.id] || "";
    }
    o.review_priority = prio;
    return o;
  });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(data), "screening");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(p.criteria.map(c => ({ id: c.id, label: c.label, description: c.description, if_fails: c.fail_decision }))), "criteria");
  X.writeFile(wb, `${p.id}-screening.xlsx`);
}
