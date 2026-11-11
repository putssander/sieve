// Selection flow shared by the report, screening and the quick scan: PRISMA 2020 counts and diagram, and the
// inclusion/exclusion flow per criterion (each excluded record counted at the first criterion it fails).
import { h, fmt } from "../util.js";
import { card, help } from "../ui.js";
import { criteriaFlow } from "../scan.js";
import { active } from "./records.js";
import { consensus, isInclude } from "./screening.js";
import { included } from "./extraction.js";

export function counts(p) {
  const recs = active(p);
  const bySource = {};
  p.records.forEach(r => (bySource[r.source || "unknown"] = (bySource[r.source || "unknown"] || 0) + 1));
  const ta = recs.map(r => ({ r, d: consensus(p, r.rid), human: !!p.screening.human[r.rid] }));
  const taExcluded = ta.filter(x => isInclude(x.d) === false);
  const sought = ta.filter(x => isInclude(x.d) !== false);
  const notRetrieved = sought.filter(x => { const f = p.fulltext[x.r.rid]; return !f || f.failed; });
  const ftExcl = sought.map(x => p.screening.human_ft?.[x.r.rid]).filter(d => d && isInclude(d.decision) === false);
  const reasons = {};
  ftExcl.forEach(d => (reasons[d.reason || "reason not recorded"] = (reasons[d.reason || "reason not recorded"] || 0) + 1));
  const registers = p.records.filter(r => r.is_register).length;
  return {
    bySource, identified: p.records.length, registers, databases: p.records.length - registers, duplicates: p.records.length - recs.length, screened: recs.length,
    taExcluded: taExcluded.length, taHuman: ta.filter(x => x.human).length, sought: sought.length, notRetrieved: notRetrieved.length,
    assessed: sought.length - notRetrieved.length, ftExcluded: ftExcl.length, reasons, included: included(p).length,
  };
}

// Final title/abstract decision with the criterion answers behind it: the human decision first, else the model runs.
export function decideTA(p) {
  return rid => {
    const hum = p.screening.human?.[rid];
    const runs = Object.values(p.screening.runs).filter(r => (r.stage || "ta") === "ta").map(r => r.results?.[rid]).filter(x => x && !x._error);
    const decision = hum?.decision || consensus(p, rid);
    if (!decision) return null;
    const side = isInclude(decision);
    const support = runs.find(x => isInclude(x.decision) === side) || runs[0];
    return { decision, criteria: hum?.criteria || support?.criteria || {}, reason: hum?.reason || hum?.note || support?.primary_exclusion_reason || "" };
  };
}

// Horizontal bars, one hue (--chart-bar), the count at the end of each bar, hover title per bar.
export function criteriaFlowChart(p, records = active(p)) {
  const f = criteriaFlow(p, records, decideTA(p));
  const max = Math.max(1, ...f.rows.map(r => r.n), f.included, f.unclear);
  const bar = (label, n, kind, title) => h("div", { class: `flow-row ${kind}`, title },
    h("span", { class: "flow-label" }, label),
    h("span", { class: "flow-track" }, h("span", { class: "flow-bar", style: { width: `${Math.max(n ? 2 : 0, (100 * n) / max)}%` } })),
    h("span", { class: "flow-n" }, fmt(n)));
  return { flow: f, el: h("div", { class: "criteria-flow", role: "img", "aria-label": `Screened ${f.screened}: excluded ${f.excluded}, unclear ${f.unclear}, included ${f.included}` },
    h("div", { class: "flow-head" }, h("strong", {}, `${fmt(f.screened)} screened`), f.pending ? h("span", { class: "muted small" }, ` · ${fmt(f.pending)} not screened yet`) : null),
    h("div", { class: "flow-group" }, h("div", { class: "flow-caption" }, `Excluded · ${fmt(f.excluded)}, at the first criterion not met`),
      f.rows.map((r, i) => bar(r.id === "_other" ? r.label : `${i + 1}. ${r.label}`, r.n, "excl", p.criteria.find(c => c.id === r.id)?.description || ""))),
    h("div", { class: "flow-group" }, h("div", { class: "flow-caption" }, "Kept"),
      bar("Unclear: a person decides", f.unclear, "unclear", "no criterion failed, but at least one is unclear"),
      bar("Included", f.included, "incl", "all criteria met"))) };
}

export function criteriaFlowCard(p, records) {
  if (!p.criteria.length) return null;
  const { el, flow } = criteriaFlowChart(p, records);
  if (!flow.screened) return null;
  return card("Inclusion and exclusion per criterion", help("Each excluded record is counted once, at the first criterion (in protocol order) that it fails. Human decisions count first, otherwise the model decision."), el);
}

export function prisma(c) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 760 520");
  svg.setAttribute("xmlns", NS);
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.appendChild(e); return e; };
  const defs = el("defs", {});
  const mk = document.createElementNS(NS, "marker");
  Object.entries({ id: "arr", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" }).forEach(([k, v]) => mk.setAttribute(k, v));
  const path = document.createElementNS(NS, "path"); path.setAttribute("d", "M0,0 L10,5 L0,10 z"); path.setAttribute("fill", "#8895a3"); mk.appendChild(path); defs.appendChild(mk);
  const box = (x, y, w, hgt, lines) => {
    el("rect", { x, y, width: w, height: hgt, rx: 6, style: "fill:var(--panel,#fff);stroke:var(--line,#ccc)" });
    lines.forEach((t, i) => el("text", { x: x + 10, y: y + 20 + i * 16, style: "fill:var(--ink,#222);font:12px system-ui,sans-serif" }, t));
  };
  const arrow = (x1, y1, x2, y2) => el("line", { x1, y1, x2, y2, stroke: "#8895a3", "marker-end": "url(#arr)" });
  box(20, 20, 330, 60, c.registers ? ["Records identified", `databases n = ${fmt(c.databases)} · registers n = ${fmt(c.registers)}`] : ["Records identified", `n = ${fmt(c.identified)} (${Object.keys(c.bySource).length} sources)`]);
  box(420, 20, 320, 60, ["Duplicates removed", `n = ${fmt(c.duplicates)}`]);
  box(20, 120, 330, 50, ["Records screened (title/abstract)", `n = ${fmt(c.screened)}`]);
  box(420, 120, 320, 50, ["Records excluded", `n = ${fmt(c.taExcluded)}`]);
  box(20, 210, 330, 50, ["Reports sought for retrieval", `n = ${fmt(c.sought)}`]);
  box(420, 210, 320, 50, ["Reports not retrieved", `n = ${fmt(c.notRetrieved)}`]);
  box(20, 300, 330, 50, ["Reports assessed for eligibility", `n = ${fmt(c.assessed)}`]);
  const rs = Object.entries(c.reasons).slice(0, 5);
  box(420, 300, 320, 40 + Math.max(1, rs.length) * 16, [`Reports excluded: n = ${fmt(c.ftExcluded)}`, ...rs.map(([r, n]) => `· ${r.slice(0, 38)}: ${n}`)]);
  box(20, 420, 330, 50, ["Studies included in review", `n = ${fmt(c.included)}`]);
  arrow(185, 80, 185, 118); arrow(350, 50, 418, 50); arrow(185, 170, 185, 208); arrow(350, 145, 418, 145);
  arrow(185, 260, 185, 298); arrow(350, 235, 418, 235); arrow(185, 350, 185, 418); arrow(350, 325, 418, 325);
  return svg;
}
