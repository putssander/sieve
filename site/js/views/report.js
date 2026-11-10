import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
import { h, download, copy, fmt } from "../util.js";
import { card, btn, help, row, table } from "../ui.js";
import { exportProject } from "../store.js";
import { toOvid, toWos } from "../query.js";
import { TARGETS, translateStrategy, formatTranslation } from "../strategy.js";
import { active } from "./records.js";
import { consensus, isInclude } from "./screening.js";
import { included } from "./extraction.js";

function counts(p) {
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
  return {
    bySource, identified: p.records.length, duplicates: p.records.length - recs.length, screened: recs.length,
    taExcluded: taExcluded.length, taHuman: ta.filter(x => x.human).length, sought: sought.length, notRetrieved: notRetrieved.length,
    assessed: sought.length - notRetrieved.length, ftExcluded: ftExcl.length, reasons, included: included(p).length,
  };
}

export function render(m, ctx) {
  const p = ctx.project, c = counts(p);
  m.append(stepIntro("report", "Numbers for the PRISMA 2020 flow diagram, a draft methods paragraph built from what was actually run, and the exports."));
  if (c.taHuman < c.screened) m.append(help(`Note: ${c.screened - c.taHuman} of ${c.screened} title/abstract decisions are model-only (no human decision yet); they count where the models agree.`));
  m.append(card(termHelp("prisma", "PRISMA 2020 flow"), h("div", { class: "prisma" }, prisma(c)),
    row(btn("Download SVG", () => download(`${p.id}-prisma.svg`, prisma(c).outerHTML, "image/svg+xml")))));
  m.append(card("Methods (draft)", h("p", {}, methods(p, c)), row(btn("Copy", () => copy(methods(p, c))))));
  m.append(card("Search strategy appendix",
    help("Every saved version with its counts, plus the final string per database."),
    table([{ label: "Version", render: v => v.name }, { label: "Date", render: v => v.date }, { label: "PubMed records", cls: "num", render: v => fmt(v.count) },
      { label: "Validation", render: v => v.recall }, { label: "Hold-out", render: v => v.holdout || "–" }, { label: "Note", render: v => v.note || "" }], p.search.versions, { empty: "No search versions saved." }),
    row(btn("Download appendix (.txt)", () => download(`${p.id}-search-appendix.txt`, appendix(p), "text/plain")))));
  m.append(card("Export",
    row(btn("Project file (.json)", async () => download(`${p.id}.json`, await exportProject(p)), "primary"),
      btn("Project file incl. full texts", async () => { if (confirm("Full texts are often copyrighted. Only share this file within the review team.")) download(`${p.id}-with-texts.json`, await exportProject(p, { withTexts: true })); })),
    help("Screening and extraction tables are exported from their own steps (Excel).")));
}

function methods(p, c) {
  const runs = Object.values(p.screening.runs);
  const models = [...new Set(runs.map(r => r.model || r.label))];
  const last = p.search.versions[p.search.versions.length - 1];
  const val = p.search.validation.length, ho = p.search.holdout.length;
  return [
    last ? `The search strategy was developed in PubMed as ${p.search.blocks.filter(b => b.enabled !== false && b.role !== "exclude").length} concept blocks and tested iteratively (${p.search.versions.length} versions) against a validation set of ${val} known relevant articles${ho ? ` and a hold-out set of ${ho} articles not used during development` : ""}. The final version (${last.name}, ${last.date}) retrieved ${fmt(last.count)} PubMed records and ${last.recall} validation articles${last.holdout ? ` and ${last.holdout} hold-out articles` : ""}.` : "",
    c.identified ? `${fmt(c.identified)} records were identified (${Object.entries(c.bySource).map(([s, n]) => `${s}: ${fmt(n)}`).join("; ")}); after removing ${fmt(c.duplicates)} duplicates, ${fmt(c.screened)} records were screened on title and abstract.` : "",
    c.duplicates ? `Duplicates were identified following the method of Bramer et al. (2016), adapted: DOI and PMID matches, then author, year, title, journal, volume, issue and (normalised) page combinations from strict to loose; ${fmt(c.duplicates - p.records.filter(r => r.dup_manual === "dup").length)} duplicates were linked automatically and ${fmt(p.records.filter(r => r.dup_manual === "dup").length)} after manual review.` : "",
    Object.keys(p.resolve).length ? `DOIs, titles and publication years were checked against Crossref before screening.` : "",
    runs.length ? `Screening against ${p.criteria.length} predefined eligibility criteria was supported by large language models (${models.join(", ")}) using an identical prompt and output schema; each model judged every criterion with verbatim evidence quotes, which were automatically checked against the source text. Disagreements between models and between models and the reviewer were resolved by the reviewer.` : "",
    c.included ? `${fmt(c.included)} studies were included.` : "",
  ].filter(Boolean).join(" ");
}

function appendix(p) {
  const out = [`Search strategy appendix · ${p.name}`, ""];
  for (const v of p.search.versions) out.push(`## ${v.name} (${v.date}) · ${fmt(v.count)} records · validation ${v.recall} · hold-out ${v.holdout || "-"}`, v.note || "", v.query, "");
  if (p.search.blocks.length) out.push("## Ovid MEDLINE", toOvid(p.search.blocks, "medline").text, "", "## Embase (Ovid)", toOvid(p.search.blocks, "embase").text, "", "## Web of Science", toWos(p.search.blocks).text);
  for (const st of (p.search.strategies || []).filter(s => s.kind === "lines")) {
    out.push("", `# ${st.name}`);
    for (const t of Object.keys(TARGETS)) {
      const a = st.assistant?.databases?.[t];
      const counts = st.counts?.[t] || {};
      const r = translateStrategy(st, t, { headings: p.search.headingMap });
      out.push("", `## ${TARGETS[t].label}${a ? " (checked by the assistant)" : ""}`,
        a ? (a.lines || []).map(l => `${String(l.n).padEnd(4)} ${l.query}${counts[`a${l.n}`] ? `    (${counts[`a${l.n}`]})` : ""}`).join("\n")
          : r.lines.filter(l => l.n !== null).map(l => `${(r.prefix + l.n).padEnd(4)} ${l.text}${counts[l.from] ? `    (${counts[l.from]})` : ""}`).join("\n"));
      if (!r.history || a) out.push("", "As one string:", a ? a.one_string || "" : r.single);
    }
  }
  return out.join("\n");
}

function prisma(c) {
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
  box(20, 20, 330, 60, ["Records identified", `n = ${fmt(c.identified)} (${Object.keys(c.bySource).length} sources)`]);
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
