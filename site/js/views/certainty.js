// Certainty of the evidence per finding (GRADE or GRADE-CERQual): the AI drafts every domain with a reason, the
// person sets each rating and the final level, and the result is a summary-of-findings table with footnotes.
import { h, clear, toast, copy, download } from "../util.js";
import { card, btn, help, row, select, runPanel, badge } from "../ui.js";
import { hashKey } from "../hash.js";
import { CERTAINTY_SOURCES as CS, LEVELS, levelById, GRADE_DOWN, GRADE_UP, GRADE_START, gradeLevel, ratingLabel, CERQUAL_COMPONENTS, CONCERNS, concernLabel,
  certaintyApproach, SYSTEM_CERTAINTY, certaintySchema, certaintyPrompt, certaintyKey, footnotes, sofMarkdown } from "../certainty.js";

const today = () => new Date().toISOString().slice(0, 10);
export const findingKey = f => hashKey(`finding\n${f.finding}\n${(f.paper_ids || []).join(",")}`);

export function certaintyState(p) {
  p.certainty ||= {};
  p.certainty.approach ||= certaintyApproach(p);
  p.certainty.human ||= {};
  return p.certainty;
}
export const certaintyDone = (p, findings) => findings.length > 0 && findings.every(f => p.certainty?.human?.[findingKey(f)]?.confirmed);

// findings: [{finding, paper_ids}]; papers: [{rid, cite, lines, rob}] (as for the summary prompt).
export function certaintyCard(ctx, findings, papers, opts = {}) {
  const p = ctx.project, c = certaintyState(p), ap = c.approach;
  const key = certaintyKey(p, ap, findings, papers);
  const ai = c.ai?._key === key ? c.ai : null;
  const body = [help(ap === "cerqual"
    ? "How much confidence can a reader place in each finding? GRADE-CERQual looks at four components; start from high confidence and move down for important concerns. The AI drafts, you decide, and every concern gets a reason."
    : "How certain is each finding? GRADE starts high for randomised trials and low for observational studies, rates down for five reasons and up for three. The AI drafts, you decide, and every rating down gets a reason (Cochrane Handbook ch. 14; rapid review rec. 21-23).")];
  body.push(row(h("label", { class: "small" }, "Approach ", select(ap, [["grade", "GRADE · effects and outcomes"], ["cerqual", "GRADE-CERQual · qualitative findings"]], v => { c.approach = v; ctx.save(); ctx.rerender(); })),
    h("a", { class: "small muted", href: (ap === "cerqual" ? CS.cerqual : CS.grade).url, target: "_blank", rel: "noopener", title: (ap === "cerqual" ? CS.cerqual : CS.grade).cite }, "source")));
  if (!findings.length) { body.push(help(opts.empty || "No findings yet.")); return card("Certainty of the evidence", ...body); }
  if (c.ai && !ai) body.push(h("p", { class: "badge warn" }, "The findings, papers or appraisals changed after the AI draft: ask for a new draft."));
  const panel = runPanel({
    title: "certainty", system: SYSTEM_CERTAINTY, batchable: false, runName: "certainty",
    items: [{ id: "certainty", label: `${findings.length} findings` }],
    build: () => ({ prompt: certaintyPrompt(p, ap, findings, papers), schema: certaintySchema(ap), name: "certainty" }),
    save: (id, json, run) => { if (json._error) return toast(json._error, "err"); c.ai = { ...json, approach: ap, model: run.model || run.label, date: run.date, _key: key }; },
    done: () => { ctx.save(); ctx.rerender(); },
  });
  body.push(ai ? h("details", { class: "advanced" }, h("summary", {}, `AI draft by ${ai.model} (${ai.date}) · ask again`), panel) : panel);
  body.push(...findings.map((f, i) => findingCard(ctx, f, i, ai?.results?.[i], ap)));   // with or without an AI draft
  const done = findings.filter(f => c.human[findingKey(f)]?.confirmed).length;
  body.push(h("p", { class: `badge ${done === findings.length ? "ok" : "warn"}` }, `${done} of ${findings.length} findings rated by you`));
  if (done) {
    const md = sofMarkdown(ap, findings.map(f => ({ ...f, a: c.human[findingKey(f)] })));
    body.push(sofTable(p, findings, ap), row(btn("Copy table (Markdown)", () => copy(md), "ghost sm"), btn("Download (.md)", () => download(`${p.id}-summary-of-findings.md`, md, "text/markdown"), "ghost sm")));
  }
  return card(ap === "cerqual" ? "Confidence in the findings (GRADE-CERQual)" : "Certainty of the evidence (GRADE)", ...body);
}

function findingCard(ctx, f, i, ai, ap) {
  const p = ctx.project, c = p.certainty, k = findingKey(f);
  const prev = c.human[k];
  const cur = structuredClone(prev || (ap === "cerqual"
    ? { components: Object.fromEntries(CERQUAL_COMPONENTS.map(x => [x.id, { concern: ai?.components?.[x.id]?.concern || "", reason: ai?.components?.[x.id]?.reason || "" }])), final: ai?.confidence || "", explanation: ai?.explanation || "" }
    : { start: ai?.start || "rct", down: Object.fromEntries(GRADE_DOWN.map(d => [d.id, { rating: ai?.down?.[d.id]?.rating || "", reason: ai?.down?.[d.id]?.reason || "" }])),
      up: Object.fromEntries(GRADE_UP.map(u => [u.id, Number(ai?.up?.[u.id]) || 0])), final: "", explanation: ai?.explanation || "" }));
  const lvl = h("span");
  const suggested = () => (ap === "cerqual" ? null : gradeLevel(cur.start, Object.fromEntries(GRADE_DOWN.map(d => [d.id, cur.down[d.id].rating])), cur.up));
  const finalSel = h("span");
  const drawLevel = () => {
    const s = suggested();
    clear(lvl).append(s ? h("span", { class: "small muted" }, `by the GRADE steps: ${levelById(s).sym} ${levelById(s).label}`) : "");
    if (s && !cur.manual) cur.final = s;   // follows the steps until you choose a level yourself
    clear(finalSel).append(select(cur.final || "", [["", "–"], ...LEVELS.map(l => [l.id, `${l.sym} ${l.label}`])], v => { cur.final = v; cur.manual = true; }));
  };
  const reason = (o, ph) => h("input", { class: "scan-check-input", value: o.reason || "", placeholder: ph, oninput: e => { o.reason = e.target.value; } });
  const rows = ap === "cerqual"
    ? CERQUAL_COMPONENTS.map(x => h("div", { class: "cert-row" }, h("strong", { class: "small" }, x.label),
      select(cur.components[x.id].concern, [["", "–"], ...CONCERNS.map(o => [o, `${concernLabel(o)} concerns`])], v => { cur.components[x.id].concern = v; }),
      reason(cur.components[x.id], "reason (required for any concern)")))
    : [h("div", { class: "cert-row" }, h("strong", { class: "small" }, "Start"), select(cur.start, GRADE_START.map(s => [s.id, s.label]), v => { cur.start = v; drawLevel(); })),
      ...GRADE_DOWN.map(d => h("div", { class: "cert-row" }, h("strong", { class: "small" }, d.label),
        select(cur.down[d.id].rating, [["", "–"], ...d.options.map(o => [o, ratingLabel(o)])], v => { cur.down[d.id].rating = v; drawLevel(); }),
        reason(cur.down[d.id], "reason (required when rating down)"))),
      h("div", { class: "cert-row" }, h("strong", { class: "small" }, "Rate up"), GRADE_UP.map(u => h("label", { class: "small" }, `${u.label} `,
        select(String(cur.up[u.id] || 0), Array.from({ length: u.max + 1 }, (_, n) => [String(n), n ? `+${n}` : "0"]), v => { cur.up[u.id] = Number(v); drawLevel(); }))))];
  drawLevel();
  const expl = h("input", { class: "scan-check-input", value: cur.explanation || "", placeholder: "explanation for the reader", oninput: e => { cur.explanation = e.target.value; } });
  return h("article", { class: `scan-check-card cert-card${prev?.confirmed ? " done" : ""}` },
    h("div", { class: "muted small" }, `Finding ${i + 1} · ${(f.paper_ids || []).length} studies${ai ? " · AI draft filled in" : ""}${prev?.confirmed ? ` · rated by you ${prev.confirmed}` : ""}`),
    h("p", {}, h("strong", {}, f.finding)),
    h("details", { open: !prev?.confirmed }, h("summary", { class: "small" }, "Domains"), ...rows),
    h("div", { class: "cert-row" }, h("strong", { class: "small" }, ap === "cerqual" ? "Confidence" : "Certainty"), finalSel, lvl), expl,
    row(btn(prev?.confirmed ? "Update" : "I checked this rating", () => {
      const missing = ap === "cerqual" ? CERQUAL_COMPONENTS.filter(x => !cur.components[x.id].concern || (cur.components[x.id].concern !== "none_or_very_minor" && !cur.components[x.id].reason.trim()))
        : GRADE_DOWN.filter(d => !cur.down[d.id].rating || (!/^(not_serious|undetected)$/.test(cur.down[d.id].rating) && !cur.down[d.id].reason.trim()));
      if (missing.length) return toast(`Rate every domain, with a reason for each concern: ${missing.map(x => x.label).join(", ")}`, "warn");
      if (!cur.final) return toast("Choose the final level", "warn");
      c.human[k] = { ...cur, finding: f.finding, confirmed: today(), ai: !!ai };
      ctx.save(); ctx.rerender();
    }, prev?.confirmed ? "ghost sm" : "primary sm")));
}

function sofTable(p, findings, ap) {
  const c = p.certainty;
  let n = 0;
  const notes = [];
  return h("div", { class: "tablewrap" }, h("table", { class: "sof" },
    h("thead", {}, h("tr", {}, h("th", {}, ap === "cerqual" ? "Finding" : "Outcome / finding"), h("th", {}, "Studies"), h("th", {}, ap === "cerqual" ? "Confidence" : "Certainty"), h("th", {}, "Explanation"))),
    h("tbody", {}, findings.map(f => {
      const a = c.human[findingKey(f)];
      const lv = levelById(a?.final);
      const fn = footnotes(ap, a).map(t => { notes.push(t); return ++n; });
      return h("tr", {}, h("td", {}, f.finding), h("td", { class: "num" }, (f.paper_ids || []).length),
        h("td", {}, lv ? h("span", { class: `cert-level lv-${lv.id}` }, h("span", { "aria-hidden": "true" }, lv.sym), ` ${lv.label}`, fn.length ? h("sup", {}, fn.join(",")) : "") : badge("not rated", "warn")),
        h("td", { class: "small" }, a?.explanation || ""));
    })),
    notes.length ? h("tfoot", {}, h("tr", {}, h("td", { colspan: 4, class: "small" }, h("ol", {}, notes.map(t => h("li", {}, t)))))) : null));
}
