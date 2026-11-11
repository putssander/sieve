import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
import { REVIEW_TYPES } from "../review-plan.js";
import { h, download, copy, fmt } from "../util.js";
import { card, btn, help, row, table, textarea, badge } from "../ui.js";
import { exportProject } from "../store.js";
import { toOvid, toWos, toCochrane } from "../query.js";
import { TARGETS, translateStrategy, formatTranslation } from "../strategy.js";
import { counts, prisma, criteriaFlowCard } from "./flow.js";
import { certaintyCard, certaintyDone } from "./certainty.js";
import { CHECKLISTS, checklistRows, checklistMarkdown, checklistsFor } from "../reporting.js";
import { reviewers, compareScreening } from "../team.js";
import { robDone, toolFor, humanRob } from "./rob.js";
import { included, finalValue } from "./extraction.js";
import { robOverallLabel } from "./rob.js";
import { surname } from "../scan.js";

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
  m.append(findingsCard(ctx));
  m.append(certaintyCard(ctx, reportFindings(p), reportPapers(p), { empty: "List the outcomes or findings to rate above." }));
  m.append(card("Methods (draft)", h("p", {}, methods(p, c)), row(btn("Copy", () => copy(methods(p, c))))));
  const ai = aiStatement(p);
  m.append(card("AI use statement",
    help("Which AI tools did what, with model versions, and how a person verified the output (joint AI position statement 2025 / RAISE; Cochrane rapid reviews AI position: an \"AI Use Disclosure\" section). Built from the runs stored in this project."),
    ai.length ? h("ul", {}, ai.map(l => h("li", {}, l))) : help("No AI runs in this project."),
    ai.length ? row(btn("Copy", () => copy(ai.map(l => `- ${l}`).join("\n")))) : null));
  m.append(checklistCard(p, c));
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
  if (p.search.blocks.length) out.push("## Ovid MEDLINE", toOvid(p.search.blocks, "medline").text, "", "## Embase (Ovid)", toOvid(p.search.blocks, "embase").text, "", "## Web of Science", toWos(p.search.blocks).text, "", "## Cochrane Library (CENTRAL)", toCochrane(p.search.blocks).text);
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

// Outcomes or findings to rate for certainty: one per line, "statement | id, id". Starts from the quick scan's
// findings when there are any.
export function reportFindings(p) {
  const own = p.certainty?.findings;
  if (own?.length) return own;
  return (p.scan?.summary?.findings || []).map(x => ({ finding: x.statement, paper_ids: x.paper_ids || [] }));
}
function reportPapers(p) {
  return included(p).map(r => ({ rid: r.rid, rob: robOverallLabel(p, r.rid),
    cite: `${surname(r.authors)} ${r.year || ""}. ${String(r.title || "").replace(/\.$/, "")}`,
    lines: p.extraction.fields.map(f => [f.label, finalValue(p, r.rid, f.id).value]).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => `${k}: ${v}`) }));
}
function findingsCard(ctx) {
  const p = ctx.project;
  const text = reportFindings(p).map(f => `${f.finding} | ${(f.paper_ids || []).join(", ")}`).join("\n");
  return card("Outcomes and findings",
    help("The outcomes (GRADE) or review findings (GRADE-CERQual) your conclusions rest on, one per line, with the studies that contribute: ",
      h("code", {}, "statement | id, id"), ". Rate each below; the ratings go into the summary-of-findings table."),
    textarea(text, v => {
      (p.certainty ||= {}).findings = v.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
        const [finding, ids = ""] = l.split("|");
        return { finding: finding.trim(), paper_ids: ids.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean) };
      });
      ctx.save();
    }, { rows: 4, placeholder: "Peer writing groups improved writing self-efficacy | 31345510, 37887691" }),
    row(btn("Update the ratings below", () => ctx.rerender(), "ghost sm")));
}

// ------------------------------------------------------------------ reporting checklists
export function reportFacts(p, c) {
  const inc = included(p);
  const sources = [...new Set(p.records.map(r => String(r.source || "").replace(/\s*\((scan|example search)\)$/, "")).filter(Boolean))];
  const dates = [...new Set([...p.search.versions.map(v => v.date), p.scan?.search?.date].filter(Boolean))];
  const names = reviewers(p);
  const sec = names.length ? compareScreening(p, names[0], p.records.filter(r => !r.duplicate_of).map(r => r.rid)) : null;
  const mode = p.scan?.screen_mode;
  const screenHow = sec?.n ? `Two people screened independently (κ = ${sec.kappa === null ? "–" : sec.kappa.toFixed(2)}), disagreements resolved by consensus`
    : mode === "assisted" ? "One person decided every record with the AI suggestion shown, after a blind calibration sample"
    : c.taHuman ? "One person screened every record; an AI model as independent second reviewer, disagreements resolved by the person" : "Model decisions only";
  const tools = [...new Set(inc.filter(r => humanRob(p, r.rid)).map(r => toolFor(p, r.rid).name))];
  const findings = reportFindings(p);
  return {
    sources, registers: p.records.some(r => r.is_register), searchDates: dates, strategies: p.search.versions.length > 0 || (p.search.strategies || []).length > 0,
    press: p.scan?.press?.reviewer || "", criteria: p.criteria.length, screened: c.screened, screenHow, second: { screening: !!sec?.n, extraction: names.some(n => Object.keys(p.team.reviewers[n].extraction || {}).length) },
    fields: p.extraction.fields.length, extracted: inc.filter(r => Object.keys(p.extraction.human?.[r.rid] || {}).length).length,
    rob: robDone(p, inc) ? `${tools.join(", ")}, every domain judged by a person${names.some(n => Object.keys(p.team.reviewers[n].rob || {}).length) ? " and by a second person independently" : ""}` : "",
    certainty: findings.length && certaintyDone(p, findings) ? (p.certainty.approach === "cerqual" ? "GRADE-CERQual" : "GRADE") : "",
    included: inc.length, ftExcluded: c.ftExcluded, protocolDate: p.scan?.protocol?.date || "", flow: c.identified > 0, identified: c.identified,
    ai: Object.keys(p.screening.runs).length + Object.keys(p.extraction.runs).length > 0,
  };
}

function checklistCard(p, c) {
  const f = reportFacts(p, c);
  const lists = checklistsFor(p.protocol.review_type);
  let cur = lists[0];
  const host = h("div");
  const draw = () => {
    host.replaceChildren();
    const rows = checklistRows(cur, f);
    const n = k => rows.filter(r => r.status === k).length;
    host.append(row(...lists.map(id => btn(CHECKLISTS[id].name, () => { cur = id; draw(); }, cur === id ? "on sm" : "sm")),
      h("span", { class: "muted small" }, `${n("sieve")} items in Sieve · ${n("partly")} partly · ${n("you")} to write`)),
      table([
        { label: "Item", render: r => h("strong", {}, r.id, r.optional ? h("span", { class: "muted small" }, " (optional)") : "") },
        { label: "Checklist item", cls: "title", render: r => h("span", {}, h("strong", {}, r.topic), h("div", { class: "small muted" }, r.text)) },
        { label: "In Sieve", render: r => r.status === "you" ? h("span", { class: "muted small" }, r.where || "to write") : h("span", { class: "small" }, badge(r.status === "sieve" ? "in Sieve" : "partly", r.status === "sieve" ? "ok" : "warn"), " ", r.where) },
      ], rows, { limit: 100 }),
      h("p", { class: "small muted" }, CHECKLISTS[cur].cite, ". ", CHECKLISTS[cur].licence),
      row(btn(`Download ${CHECKLISTS[cur].name} checklist (.md)`, () => download(`${p.id}-${cur}-checklist.md`, checklistMarkdown(cur, f), "text/markdown"), "primary")));
  };
  draw();
  return card("Reporting checklists", help("Each item with what Sieve already holds for this project and where; the rest is for you to write. Add the page numbers of your manuscript in the downloaded file."), host);
}

// ------------------------------------------------------------------ AI use statement (full review)
export function aiStatement(p) {
  const out = [];
  const runLine = (task, runs, n, verified) => {
    for (const [id, r] of Object.entries(runs)) {
      const k = Object.values(r.results || {}).filter(x => x && !x._error).length;
      if (k) out.push(`${task}: ${r.model || r.label || id} (${r.backend || "route not recorded"}, ${r.date || "date not recorded"}) for ${k} ${n}.`);
    }
    if (Object.keys(runs).length && verified) out.push(verified);
  };
  if (p.scan?.plan?.model) out.push(`Protocol draft (criteria, search blocks, data fields): ${p.scan.plan.model}; ${p.scan.plan.approved ? `approved by the author on ${p.scan.plan.approved}` : "not approved"}.`);
  const human = Object.values(p.screening.human || {}).filter(x => x?.decision).length;
  runLine("Title/abstract and full-text screening", p.screening.runs, "records", `Screening: ${human} final decisions made by people; the models' quotes were checked word for word against the source.`);
  const cells = Object.values(p.extraction.human || {}).reduce((n, x) => n + Object.keys(x || {}).length, 0);
  runLine("Data extraction", p.extraction.runs, "papers", `Extraction: ${cells} values verified or entered by people against the quoted source.`);
  runLine("Risk of bias drafts", p.rob?.runs || {}, "studies", `Risk of bias: ${Object.keys(p.rob?.human || {}).length} studies judged domain by domain by a person.`);
  if (p.certainty?.ai) out.push(`Certainty of the evidence: drafted by ${p.certainty.ai.model} (${p.certainty.ai.date}); every rating set and explained by the author.`);
  if (p.scan?.summary?.model) out.push(`Summary: drafted by ${p.scan.summary.model}; ${p.scan.summary.approved ? `checked against the papers and approved on ${p.scan.summary.approved}` : "not yet approved"}.`);
  if (out.length) out.push("Prompts are fixed templates built by Sieve from this project (stored with each run in the project file); no AI made a final decision.");
  return out;
}
