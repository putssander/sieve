import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
import { REVIEW_TYPES } from "../review-plan.js";
import { h, download, copy, fmt } from "../util.js";
import { card, btn, help, row, table } from "../ui.js";
import { exportProject } from "../store.js";
import { toOvid, toWos } from "../query.js";
import { TARGETS, translateStrategy, formatTranslation } from "../strategy.js";
import { counts, prisma, criteriaFlowCard } from "./flow.js";

export function render(m, ctx) {
  const p = ctx.project, c = counts(p);
  m.append(stepIntro("report", "Selection counts, a draft methods paragraph built from what was actually run, and the exports. Check the reporting guidance for your chosen review type."));
  if (c.taHuman < c.screened) m.append(help(`Note: ${c.screened - c.taHuman} of ${c.screened} title/abstract decisions are model-only (no human decision yet); they count where the models agree.`));
  const reviewType = REVIEW_TYPES[p.protocol.review_type];
  m.append(card(termHelp("prisma", "Study selection flow"),
    reviewType && help(reviewType.reporting, " This diagram is one part of reporting your review."),
    h("div", { class: "prisma" }, prisma(c)),
    row(btn("Download SVG", () => download(`${p.id}-prisma.svg`, prisma(c).outerHTML, "image/svg+xml")))));
  const flowCard = criteriaFlowCard(p);
  if (flowCard) m.append(flowCard);
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
