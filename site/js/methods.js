// Accepted methods per step, with sources, and how Sieve applies them (done / partly / missing).
// Single source for the in-app "Methods & guidance" page and docs/methods.md (node tools/build-methods.mjs).
// Keep claims to what the sources say; mark gaps honestly.

const S = {
  prisma: { name: "PRISMA 2020", cite: "Page MJ et al. BMJ 2021;372:n71", url: "https://doi.org/10.1136/bmj.n71" },
  prismaS: { name: "PRISMA-S", cite: "Rethlefsen ML et al. Syst Rev 2021;10:39", url: "https://doi.org/10.1186/s13643-020-01542-z" },
  prismaP: { name: "PRISMA-P", cite: "Moher D et al. Syst Rev 2015;4:1", url: "https://doi.org/10.1186/2046-4053-4-1" },
  prismaScR: { name: "PRISMA-ScR", cite: "Tricco AC et al. Ann Intern Med 2018;169:467-73", url: "https://doi.org/10.7326/M18-0850" },
  press: { name: "PRESS 2015", cite: "McGowan J et al. J Clin Epidemiol 2016;75:40-6", url: "https://doi.org/10.1016/j.jclinepi.2016.01.021" },
  sampson: { name: "Relative recall", cite: "Sampson M et al. BMC Med Res Methodol 2006;6:33", url: "https://doi.org/10.1186/1471-2288-6-33" },
  bramerDb: { name: "Database combinations", cite: "Bramer WM et al. Syst Rev 2017;6:245", url: "https://doi.org/10.1186/s13643-017-0644-y" },
  bramerDedup: { name: "Bramer deduplication", cite: "Bramer WM et al. J Med Libr Assoc 2016;104(3):240-3; correction 2017;105(1):111", url: "https://doi.org/10.3163/1536-5050.104.3.014" },
  waffen: { name: "Single vs. dual screening", cite: "Waffenschmidt S et al. BMC Med Res Methodol 2019;19:132", url: "https://doi.org/10.1186/s12874-019-0782-0" },
  safe: { name: "SAFE stopping procedure", cite: "Boetje J, van de Schoot R. Syst Rev 2024;13:81", url: "https://doi.org/10.1186/s13643-024-02502-7" },
  buscemi: { name: "Single vs. double extraction", cite: "Buscemi N et al. J Clin Epidemiol 2006;59:697-703", url: "https://pubmed.ncbi.nlm.nih.gov/16765272/" },
  probastAI: { name: "PROBAST+AI", cite: "Moons KGM et al. BMJ 2025;388:e082505", url: "https://doi.org/10.1136/bmj-2024-082505" },
  ai2025: { name: "AI in evidence synthesis (RAISE)", cite: "Joint position statement of Cochrane, Campbell, JBI and CEE, 2025", url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12594113/" },
  handbook: { name: "Cochrane Handbook", cite: "Higgins JPT et al. (eds). Cochrane Handbook for Systematic Reviews of Interventions, current version", url: "https://training.cochrane.org/handbook" },
};

export const SOURCES = S;

// status: done | partly | missing
export const METHODS = [
  {
    id: "general", title: "Across all steps",
    method: [
      [S.prisma, "Report what was done at every stage, with a flow diagram of records identified, screened, excluded (with reasons) and included."],
      [S.ai2025, "The authors stay accountable for AI use; justify and validate a tool for the specific review, keep human oversight, and report any AI that makes or suggests judgements."],
    ],
    sieve: [
      ["done", "Every AI step is a fixed prompt + JSON schema, stored per run with model and date, next to the human decision."],
      ["done", "Evidence quotes are checked word for word against the paper and can be opened highlighted in the text."],
      ["partly", "The methods draft (step 8) names the models used; a complete AI-use statement (tool, version, validation results, human oversight) is not generated yet."],
    ],
  },
  {
    id: "protocol", title: "1 · Protocol",
    method: [
      [S.prismaP, "Define the question and eligibility criteria before searching, and register or publish the protocol (e.g. PROSPERO, OSF)."],
      [S.prismaScR, "Scoping reviews: the same a priori approach (population, concept, context) with their own reporting checklist."],
    ],
    sieve: [
      ["done", "Question, PICO / PICo / SPIDER / PCC, eligibility criteria with the consequence of failing each one."],
      ["done", "Start from an existing document (ticket, proposal, criteria flowchart)."],
      ["missing", "Export in PRISMA-P / registration format and a frozen, dated protocol version."],
    ],
  },
  {
    id: "search", title: "2 · Search",
    method: [
      [S.press, "Peer review of the MEDLINE strategy before translation, on six elements: translation of the question, Boolean/proximity operators, subject headings, text words, spelling/syntax/line numbers, limits and filters."],
      [S.sampson, "Test the strategy against a set of known relevant studies (relative recall)."],
      [S.bramerDb, "Search at least Embase, MEDLINE, Web of Science and Google Scholar; add subject databases (e.g. CINAHL, PsycInfo) when the topic fits."],
      [S.prismaS, "Report every database with its platform, the full strategy, limits, search date and number of records."],
    ],
    sieve: [
      ["done", "Validation and hold-out sets, tested live in PubMed (recall, missed articles and why), and recall per database after importing the exports."],
      ["done", "Translations of a MEDLINE (Ovid) strategy to Embase, Web of Science, PsycInfo and ACM, with a check list and an assistant review; counts per line."],
      ["partly", "PRESS: syntax checks and an assistant review, but no structured PRESS 2015 checklist for a second searcher."],
      ["partly", "PRISMA-S: strategies and counts per line are kept; platform, search date and limits per database are not recorded as fields yet."],
      ["missing", "Google Scholar (first 200 results), CINAHL and Scopus translations."],
    ],
  },
  {
    id: "records", title: "3 · Records and deduplication",
    method: [
      [S.bramerDedup, "Remove duplicates in fixed passes from strict to loose field combinations, with normalised page numbers; check the loose matches by hand."],
      [S.prisma, "Report records identified per source and the number of duplicates removed."],
    ],
    sieve: [
      ["done", "Bramer passes A-G plus DOI/PMID, run after every import; strict matches linked automatically, the rest in a review list (docs/deduplication.md)."],
      ["done", "Duplicates are linked, not deleted; overlap per database (already found / only here)."],
    ],
  },
  {
    id: "verify", title: "4 · Verify records",
    method: [
      [S.handbook, "Check whether included reports have been retracted or corrected, and identify the version of a study that is reported (preprint vs. journal article)."],
    ],
    sieve: [
      ["done", "DOI ↔ title ↔ year checks against Crossref, shared wrong links, erratum and supplement flags."],
      ["done", "Preprints recognised, with the published version found and used."],
      ["missing", "Automatic retraction check (Crossref / Retraction Watch data)."],
    ],
  },
  {
    id: "fulltext", title: "5 · Full text",
    method: [
      [S.prisma, "Retrieve the full text of every record that passes title/abstract screening; report reports sought and reports not retrieved."],
    ],
    sieve: [
      ["done", "Automatic retrieval from open sources (Europe PMC, PubMed Central, arXiv, Unpaywall), a download list for the rest, PDFs or a whole folder matched by content."],
      ["missing", "\"Reports not retrieved\" as a separate number in the PRISMA flow diagram."],
    ],
  },
  {
    id: "screening", title: "6 · Screening",
    method: [
      [S.waffen, "Single-reviewer title/abstract screening misses studies (median 5%, 13% for less experienced reviewers): screen in duplicate, independently, with conflict resolution."],
      [S.ai2025, "An AI screener needs validation against human decisions on this review (sensitivity first) and human oversight; report it."],
      [S.safe, "With prioritised (active learning) screening, use an explicit, conservative stopping rule."],
    ],
    sieve: [
      ["done", "Model runs per criterion with verified quotes; sensitivity, specificity and κ against your decisions; disagreements first; full-text exclusions require a reason."],
      ["partly", "A model can be the second reviewer, but a true two-human mode (blinded, independent, with conflict resolution) is not there yet."],
      ["missing", "Prioritised screening with a stopping rule such as SAFE."],
    ],
  },
  {
    id: "extraction", title: "7 · Data extraction",
    method: [
      [S.buscemi, "Single extraction produces more errors than double extraction; extract key (outcome) data independently in duplicate or at least verify every value."],
      [S.handbook, "Pilot the extraction form on a few studies before extracting everything."],
      [S.probastAI, "Assess quality / risk of bias with a tool that fits the study type: e.g. PROBAST+AI for (AI) prediction models, RoB 2, ROBINS-I, QUADAS-2."],
    ],
    sieve: [
      ["done", "Every value with a verified quote; two runs compared field by field; the human verifies each cell (disagreements and unverified quotes first)."],
      ["done", "Pilot run and run checks (completeness, verified quotes, core-only rule)."],
      ["missing", "Risk-of-bias / quality appraisal module (e.g. PROBAST+AI, QUADAS-2) as a form like extraction."],
    ],
  },
  {
    id: "report", title: "8 · Report",
    method: [
      [S.prisma, "Flow diagram and the 27-item checklist."],
      [S.prismaS, "Search appendix with every full strategy."],
      [S.ai2025, "A transparent statement of AI use and its validation."],
    ],
    sieve: [
      ["done", "PRISMA 2020 counts and diagram, a methods draft built from what was run, a search appendix with all strategies and translations."],
      ["missing", "PRISMA 2020 checklist export, PRISMA-S checklist export, a complete AI-use statement."],
    ],
  },
];

// Gaps in order of priority for a systematic review.
export const GAPS = [
  "Risk-of-bias / quality appraisal (PROBAST+AI, QUADAS-2, RoB 2, ROBINS-I) as a form with evidence quotes.",
  "Two-human screening mode: independent, blinded decisions with conflict resolution.",
  "PRESS 2015 checklist for peer review of the search, and PRISMA-S fields (platform, date, limits) per database.",
  "Complete AI-use statement in the report (tools, versions, validation results, human oversight).",
  "PRISMA 2020 and PRISMA-S checklist exports; \"reports not retrieved\" in the flow diagram.",
  "Retraction check; protocol export (PRISMA-P / registration).",
  "Prioritised screening with the SAFE stopping procedure.",
  "Google Scholar, CINAHL and Scopus translations.",
];

export function methodsMarkdown() {
  const out = ["# Methods in Sieve: accepted guidance per step", "",
    "Generated by `node tools/build-methods.mjs` from site/js/methods.js (also shown in the app: Methods & guidance).", "",
    "Status: ✓ done · ◐ partly · ✗ missing", ""];
  const mark = { done: "✓", partly: "◐", missing: "✗" };
  for (const s of METHODS) {
    out.push(`## ${s.title}`, "", "**Accepted method**", "");
    for (const [src, text] of s.method) out.push(`- ${text} *${src.name}: ${src.cite}* (${src.url})`);
    out.push("", "**In Sieve**", "");
    for (const [st, text] of s.sieve) out.push(`- ${mark[st]} ${text}`);
    out.push("");
  }
  out.push("## Gaps, in order of priority", "", ...GAPS.map((g, i) => `${i + 1}. ${g}`), "");
  return out.join("\n");
}
