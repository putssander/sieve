// Risk of bias / quality appraisal (step 7 and the quick scan). The AI drafts a judgement per domain with a quote,
// a person judges every domain (the quote is checked word for word), a second person assesses independently in a
// blind copy or verifies; the result is a traffic-light table and a summary per domain.
import { h, clear, toast, quoteInSource, download } from "../util.js";
import { card, btn, help, row, select, runPanel, badge, modal } from "../ui.js";
import { ROB_TOOLS, toolOf, levelOf, suggestTool, SYSTEM_ROB, robSchema, robPrompt, robKey, robComplete, robSummary, robAgreement } from "../rob.js";
import { reviewers } from "../team.js";
import { showEvidence } from "./evidence.js";
import { sourceText } from "./screening.js";

const today = () => new Date().toISOString().slice(0, 10);

export function robState(p) {
  p.rob ||= {};
  p.rob.tool ||= suggestTool(p);
  p.rob.tools ||= {};
  p.rob.runs ||= {};
  p.rob.human ||= {};
  return p.rob;
}
export const toolFor = (p, rid) => toolOf(p.rob?.tools?.[rid] || p.rob?.tool || suggestTool(p));
export function aiRob(p, r, text) {
  const tool = toolFor(p, r.rid), key = robKey(p, tool, r, text);
  const res = Object.values(p.rob?.runs || {}).map(R => R.results?.[r.rid]).filter(x => x && !x._error && x.tool === tool.id);
  return { key, fresh: res.find(x => x._key === key) || null, stale: res.some(x => x._key !== key) };
}
export const humanRob = (p, rid) => { const a = p.rob?.human?.[rid]; return a && a.tool === toolFor(p, rid).id ? a : null; };
export const robDone = (p, recs) => recs.length > 0 && recs.every(r => robComplete(toolFor(p, r.rid), humanRob(p, r.rid)));
export const robOverall = (p, rid) => { const a = humanRob(p, rid); if (!a) return null; const t = toolFor(p, rid); return a.overall || t.overall(a.domains || {}); };
export function robOverallLabel(p, rid) {
  const t = toolFor(p, rid), id = robOverall(p, rid);
  const l = id && levelOf(t, id, !!t.overallLevels);
  return l ? `${t.name}: ${l.label}` : "";
}

const cell = (tool, id, overall = false) => {
  const l = id && levelOf(tool, id, overall);
  return l ? h("span", { class: `rob-cell tone-${l.tone}`, title: l.label }, h("span", { class: "rob-sym", "aria-hidden": "true" }, l.sym), h("span", { class: "rob-lbl" }, l.label)) : h("span", { class: "muted" }, "–");
};

// opts: { texts, onDone, intro }
export function robCard(ctx, recs, opts = {}) {
  const p = ctx.project, rob = robState(p), texts = opts.texts || {};
  const tool = toolOf(rob.tool);
  const body = [];
  body.push(help(opts.intro || "Judge the risk of bias (or quality) of every included study with a tool made for its design. The AI drafts each domain with a quote; you judge every domain. A second person assesses independently (systematic review, MECIR C53) or verifies your judgements (rapid review, rec. 16)."));
  body.push(row(h("label", { class: "small" }, "Tool for this review ",
    select(rob.tool, Object.values(ROB_TOOLS).map(t => [t.id, `${t.name} · ${t.for}`]), v => { rob.tool = v; ctx.save(); ctx.rerender(); })),
    h("a", { class: "small", href: tool.tool, target: "_blank", rel: "noopener" }, `${tool.name}: full tool and signalling questions`),
    h("a", { class: "small muted", href: tool.url, target: "_blank", rel: "noopener", title: tool.cite }, "source")));
  if (rob.tool !== suggestTool(p)) body.push(help(`Suggested from your question: ${toolOf(suggestTool(p)).name}.`));
  if (tool.note) body.push(help(tool.note));
  body.push(help("Every judgement needs its support and source (MECIR C54-C55): agree only with a quote you checked, and add notes where the paper is silent."));

  const info = new Map(recs.map(r => [r.rid, aiRob(p, r, texts[r.rid])]));
  const todo = recs.filter(r => !info.get(r.rid).fresh && !humanRob(p, r.rid));
  if (todo.length) body.push(runPanel({
    title: "risk-of-bias", system: SYSTEM_ROB, batchable: false, attachHint: true, runName: "",
    items: todo.map(r => ({ id: r.rid, label: `${r.rid} ${String(r.title).slice(0, 40)}${texts[r.rid] ? "" : " (abstract)"}` })),
    build: (items, o = {}) => { const r = p.records.find(x => x.rid === items[0].id), t = toolFor(p, r.rid); return { prompt: robPrompt(p, t, r, o.attachments ? "" : texts[r.rid]), schema: robSchema(t), name: "risk_of_bias" }; },
    save: (id, json, run) => {
      const r = p.records.find(x => x.rid === String(id)); if (!r) return;
      const t = toolFor(p, r.rid);
      (rob.runs[run.id] ||= { label: run.label, model: run.model, backend: run.backend, date: run.date, results: {} }).results[r.rid] = json._error ? json : { ...json, tool: t.id, _key: robKey(p, t, r, texts[r.rid]) };
    },
    done: () => { ctx.save(); ctx.rerender(); },
  }));
  // You can judge with or without an AI draft; a draft that arrives later shows next to each domain.
  const results = h("div");
  const refresh = () => clear(results).append(...(recs.some(r => humanRob(p, r.rid)) ? [robTable(ctx, recs), robBars(p, recs)].filter(Boolean) : []));
  if (recs.length) body.push(h("h4", { class: "scan-check-title" }, "Your judgements"), robCheck(ctx, recs, texts, info, { ...opts, refresh }));
  refresh();
  body.push(results);
  return card("Risk of bias / quality appraisal", ...body);
}

// One paper at a time; every domain judged by the person, with the AI draft and its quote alongside.
function robCheck(ctx, recs, texts, info, opts) {
  const p = ctx.project;
  const host = h("div", { class: "scan-check" });
  let decided = false, edit = null;
  const draw = () => {
    clear(host);
    const todo = recs.filter(r => !robComplete(toolFor(p, r.rid), humanRob(p, r.rid)));
    host.append(h("div", { class: "scan-check-head" }, h("strong", {}, todo.length ? `${recs.length - todo.length} of ${recs.length} studies judged` : `All ${recs.length} studies judged by you`),
      todo.length ? h("span", { class: "muted small" }, " Judge each domain yourself; the AI draft is a suggestion. Check the quote in the paper before you agree.") : null));
    const r = edit || todo[0];
    if (!r) { if (decided) opts.onDone?.(); return; }
    const t = toolFor(p, r.rid), ai = opts.noAI ? null : info.get(r.rid)?.fresh;
    const prev = humanRob(p, r.rid);
    const cur = { domains: { ...(prev?.domains || {}) }, applicability: { ...(prev?.applicability || {}) }, overall: prev?.overall || "", notes: { ...(prev?.notes || {}) } };
    const src = sourceText(p, r, texts[r.rid] || "");
    const overallEl = h("div");
    const drawOverall = () => {
      const sug = t.overall(cur.domains);
      const levels = t.overallLevels || t.levels;
      clear(overallEl).append(h("div", { class: "rob-domain overall" }, h("div", {}, h("strong", {}, "Overall"), h("div", { class: "small muted" }, t.overallRule)),
        h("div", { class: "rob-choices", role: "radiogroup", "aria-label": "Overall" }, levels.map(l => h("button", { type: "button", role: "radio", "aria-checked": String((cur.overall || sug) === l.id),
          class: `btn sm rob-choice tone-${l.tone}${(cur.overall || sug) === l.id ? " on" : ""}`, onclick: () => { cur.overall = l.id; drawOverall(); } }, `${l.sym} ${l.label}`))),
        sug && !cur.overall ? h("span", { class: "small muted" }, "follows the rule; click to change") : null,
        ai?.overall ? h("span", { class: "small muted" }, ` · AI: ${levelOf(t, ai.overall, !!t.overallLevels)?.label || ai.overall}`) : null));
    };
    const domRow = d => {
      const x = ai?.domains?.[d.id];
      const ok = x?.quote ? quoteInSource(x.quote, src) : null;
      const choices = h("div", { class: "rob-choices", role: "radiogroup", "aria-label": d.label });
      const drawChoices = () => clear(choices).append(...t.levels.map(l => h("button", { type: "button", role: "radio", "aria-checked": String(cur.domains[d.id] === l.id),
        class: `btn sm rob-choice tone-${l.tone}${cur.domains[d.id] === l.id ? " on" : ""}`, onclick: () => { cur.domains[d.id] = l.id; drawChoices(); drawOverall(); } }, `${l.sym} ${l.label}`)));
      drawChoices();
      const appl = d.applicability ? h("label", { class: "small" }, "Applicability concerns ", select(cur.applicability[d.id] || "", [["", "–"], ["low", "Low"], ["high", "High"], ["unclear", "Unclear"]], v => { cur.applicability[d.id] = v; })) : null;
      return h("div", { class: "rob-domain" },
        h("div", {}, h("strong", {}, `${d.id} · ${d.label}`), h("div", { class: "small muted" }, d.hint)),
        choices, appl,
        x ? h("div", { class: "small rob-ai" }, h("span", { class: "muted" }, "AI: "), levelOf(t, x.judgement)?.label || x.judgement, x.rationale ? ` · ${x.rationale}` : "",
          x.quote ? h("div", {}, ok ? h("span", { class: "ok-text" }, "❝ found ") : h("span", { class: "err-text" }, "❝✗ not found in the source "), h("q", {}, x.quote), " ",
            btn("show", () => showEvidence(r, texts[r.rid] || r.abstract || "", [x.quote], { title: d.label }), "ghost sm")) : null,
          btn("Agree", () => { cur.domains[d.id] = x.judgement; drawChoices(); drawOverall(); }, "ghost sm")) : null);
    };
    drawOverall();
    const notes = h("textarea", { rows: 2, placeholder: "Notes (optional): support for your judgements, what to ask the authors", class: "scan-check-input" }, prev?.notes?._ || "");
    host.append(h("article", { class: "scan-check-card" },
      h("div", { class: "muted small" }, `${r.rid} · ${r.journal || ""} ${r.year || ""}${texts[r.rid] ? " · full text" : " · abstract only"}${ai?.design ? ` · design (AI): ${ai.design}` : ""}`),
      h("h4", {}, r.title),
      ai && ai.tool_fits === false ? h("p", { class: "badge warn" }, `The AI thinks ${t.name} does not fit this design. Choose another tool for this study:`) : null,
      row(h("label", { class: "small" }, "Tool for this study ", select(t.id, Object.values(ROB_TOOLS).map(x => [x.id, x.name]), v => { p.rob.tools[r.rid] = v; ctx.save(); ctx.rerender(); }))),
      ...t.domains.map(domRow), overallEl, notes,
      row(btn(edit ? "Save" : "Save judgements: next study", () => {
        if (!t.domains.every(d => cur.domains[d.id])) return toast("Judge every domain first", "warn");
        const overall = cur.overall || t.overall(cur.domains);
        if (!overall) return toast("Choose the overall judgement", "warn");
        const changed = ai ? t.domains.filter(d => ai.domains?.[d.id]?.judgement && ai.domains[d.id].judgement !== cur.domains[d.id]).length : 0;
        p.rob.human[r.rid] = { tool: t.id, domains: cur.domains, applicability: cur.applicability, overall, notes: { _: notes.value.trim() }, by: "you", date: today(), ai_changed: changed, ai: !!ai };
        decided = true; edit = null; ctx.save(); draw(); opts.refresh?.();
      }, "primary"), edit ? btn("Cancel", () => { edit = null; draw(); }, "ghost") : h("span", { class: "muted small" }, `${Math.max(0, todo.length - 1)} to go`))));
  };
  host.editStudy = r => { edit = r; draw(); host.scrollIntoView({ block: "start" }); };
  robCheck.last = host;
  draw();
  return host;
}

// Traffic-light table: studies × domains, symbol + label in every cell (never colour alone).
export function robTable(ctx, recs) {
  const p = ctx.project;
  const others = reviewers(p);
  const rows = recs.filter(r => humanRob(p, r.rid));
  const byTool = {};
  rows.forEach(r => (byTool[toolFor(p, r.rid).id] ||= []).push(r));
  return h("div", {}, Object.entries(byTool).map(([tid, list]) => {
    const t = toolOf(tid);
    return h("div", { class: "tablewrap rob-table" }, h("table", {},
      h("caption", { class: "small muted" }, `${t.name} · ${list.length} stud${list.length === 1 ? "y" : "ies"}`),
      h("thead", {}, h("tr", {}, h("th", {}, "Study"), t.domains.map(d => h("th", { title: d.label }, d.id)), h("th", {}, "Overall"), others.length ? h("th", {}, "Second reviewer") : null)),
      h("tbody", {}, list.map(r => {
        const a = humanRob(p, r.rid);
        const sec = others.map(n => ({ n, b: p.team.reviewers[n].rob?.[r.rid] })).find(x => x.b && x.b.tool === t.id);
        const agr = sec ? robAgreement(t, a, sec.b) : null;
        return h("tr", {}, h("td", { class: "title" }, h("a", { href: "#", onclick: e => { e.preventDefault(); robCheck.last?.editStudy?.(r); } }, h("strong", {}, r.rid)), ` ${String(r.title).slice(0, 50)}`),
          t.domains.map(d => h("td", {}, cell(t, a.domains[d.id]))), h("td", {}, cell(t, a.overall, !!t.overallLevels)),
          others.length ? h("td", { class: "small" }, !sec ? h("span", { class: "muted" }, "not yet") : agr.diff.length
            ? h("span", {}, badge(`differs on ${agr.diff.join(", ")}`, "warn"), " ", btn("resolve", () => resolveRob(ctx, r, t, a, sec), "ghost sm"))
            : badge(`${sec.n}: same on all ${agr.n}`, "ok")) : null);
      })),
      h("tfoot", {}, h("tr", {}, h("td", { colspan: t.domains.length + 2 + (others.length ? 1 : 0), class: "small muted" },
        t.domains.map(d => `${d.id} ${d.label}`).join(" · "), " · ", t.levels.map(l => `${l.sym} ${l.label}`).join("  "))))));
  }), row(btn("Download table (CSV)", () => download(`${p.id}-risk-of-bias.csv`, robCsv(p, rows), "text/csv"), "ghost sm")));
}

// Consensus on the domains where the two people differ (after discussion, or by a third person).
function resolveRob(ctx, r, t, a, sec) {
  const p = ctx.project;
  const agr = robAgreement(t, a, sec.b);
  const pick = {};
  const body = h("div", {}, help("Discuss the domains where you differ (or ask a third person) and record the consensus. Both original judgements are kept."),
    agr.diff.map(id => {
      const d = t.domains.find(x => x.id === id);
      const group = h("div", { class: "rob-choices", role: "radiogroup", "aria-label": d.label });
      const draw = () => clear(group).append(...t.levels.map(l => h("button", { type: "button", role: "radio", "aria-checked": String(pick[id] === l.id),
        class: `btn sm rob-choice tone-${l.tone}${pick[id] === l.id ? " on" : ""}`, onclick: () => { pick[id] = l.id; draw(); } }, `${l.sym} ${l.label}`)));
      draw();
      return h("div", { class: "rob-domain" }, h("div", {}, h("strong", {}, `${d.id} · ${d.label}`),
        h("div", { class: "small" }, `You: ${levelOf(t, a.domains[id])?.label} · ${sec.n}: ${levelOf(t, sec.b.domains[id])?.label}`)), group);
    }),
    row(btn("Save consensus", () => {
      if (!agr.diff.every(id => pick[id])) return toast("Choose a consensus judgement for every domain", "warn");
      for (const id of agr.diff) {
        (a.consensus ||= {})[id] = { you: a.domains[id], other: sec.b.domains[id], with: sec.n, date: today() };
        a.domains[id] = pick[id];
        sec.b.domains[id] = pick[id];   // the pair now agrees; both originals stay in a.consensus
      }
      a.overall = t.overall(a.domains) || a.overall;
      ctx.save(); close(); ctx.rerender();
    }, "primary")));
  const close = modal(`${r.rid} · consensus with ${sec.n}`, body);
}

// Summary per domain: the share of studies at each level, one stacked bar per domain (status colours + symbols).
export function robBars(p, recs) {
  const rows = recs.filter(r => humanRob(p, r.rid));
  const t = toolOf(p.rob.tool);
  const list = rows.filter(r => toolFor(p, r.rid).id === t.id).map(r => humanRob(p, r.rid));
  if (!list.length) return null;
  const sum = robSummary(t, list);
  return h("div", { class: "rob-bars", role: "img", "aria-label": `${t.name} summary per domain` },
    h("div", { class: "flow-caption" }, `${t.name}: share of ${list.length} studies per judgement`),
    sum.map(s => h("div", { class: "rob-bar-row", title: t.levels.map(l => `${l.label}: ${s.n[l.id]}`).join(" · ") },
      h("span", { class: "flow-label" }, `${s.id} ${s.label}`),
      h("span", { class: "rob-bar" }, t.levels.filter(l => s.n[l.id]).map(l => h("span", { class: `rob-seg tone-${l.tone}`, style: { width: `${(100 * s.n[l.id]) / s.total}%` } }, s.n[l.id] / s.total >= 0.12 ? l.sym : ""))))),
    h("div", { class: "rob-legend small" }, t.levels.map(l => h("span", {}, h("span", { class: `rob-swatch tone-${l.tone}` }, l.sym), ` ${l.label}`))));
}

function robCsv(p, rows) {
  const q = s => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const out = [["study", "tool", "domain", "judgement", "overall", "notes", "by", "date"].join(",")];
  for (const r of rows) {
    const a = humanRob(p, r.rid), t = toolFor(p, r.rid);
    for (const d of t.domains) out.push([r.rid, t.name, `${d.id} ${d.label}`, levelOf(t, a.domains[d.id])?.label, levelOf(t, a.overall, !!t.overallLevels)?.label, a.notes?._ || "", a.by, a.date].map(q).join(","));
  }
  return out.join("\n");
}
