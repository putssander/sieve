// Accepted methods per step, with sources, and how Sieve applies them (done / partly / missing).
// Single source for the in-app "Methods & guidance" page, the "Official method" box on every step, the
// "go deeper" advice of the quick scan and docs/methods.md (node tools/build-methods.mjs).
// Rules: cite primary guidance only; keep claims to what the source says (checked against the source text,
// 10 Nov 2026); mark Sieve's gaps honestly.

const CH = "https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current";
const S = {
  handbook: { name: "Cochrane Handbook", cite: "Higgins JPT et al. (eds). Cochrane Handbook for Systematic Reviews of Interventions, version 6.5.1, 2025", url: `${CH}` },
  handbook4: { name: "Cochrane Handbook ch. 4", cite: "Searching for and selecting studies, version 6.5.1, 2025", url: `${CH}/chapter-04` },
  handbook5: { name: "Cochrane Handbook ch. 5", cite: "Collecting data, version 6.5, 2024", url: `${CH}/chapter-05` },
  handbook8: { name: "Cochrane Handbook ch. 8", cite: "Assessing risk of bias in a randomized trial (RoB 2), version 6.5, 2024", url: `${CH}/chapter-08` },
  mecir: { name: "MECIR", cite: "Methodological Expectations of Cochrane Intervention Reviews, version August 2023", url: "https://www.cochrane.org/authors/handbooks-and-manuals/mecir-manual" },
  rr2024: { name: "Cochrane rapid reviews", cite: "Garritty C et al. Updated recommendations for the Cochrane rapid review methods guidance for rapid reviews of effectiveness. BMJ 2024;384:e076335", url: "https://doi.org/10.1136/bmj-2023-076335" },
  rrAI: { name: "AI in rapid reviews", cite: "Gartlehner G et al. Responsible integration of artificial intelligence in rapid reviews: a position statement from the Cochrane Rapid Reviews Methods Group. Cochrane Evid Synth Methods 2025;4:e70063", url: "https://doi.org/10.1002/cesm.70063" },
  ai2025: { name: "AI in evidence synthesis", cite: "Position statement on AI use in evidence synthesis across Cochrane, the Campbell Collaboration, JBI and the Collaboration for Environmental Evidence (endorsing RAISE), 2025", url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12594113/" },
  prisma: { name: "PRISMA 2020", cite: "Page MJ et al. BMJ 2021;372:n71", url: "https://doi.org/10.1136/bmj.n71" },
  prismaS: { name: "PRISMA-S", cite: "Rethlefsen ML et al. Syst Rev 2021;10:39", url: "https://doi.org/10.1186/s13643-020-01542-z" },
  prismaP: { name: "PRISMA-P", cite: "Moher D et al. Syst Rev 2015;4:1", url: "https://doi.org/10.1186/2046-4053-4-1" },
  prismaScR: { name: "PRISMA-ScR", cite: "Tricco AC et al. Ann Intern Med 2018;169:467-73", url: "https://doi.org/10.7326/M18-0850" },
  jbiScoping: { name: "JBI scoping reviews", cite: "Peters MDJ et al. Updated methodological guidance for the conduct of scoping reviews. JBI Evid Synth 2020;18(10):2119-26", url: "https://doi.org/10.11124/JBIES-20-00167" },
  jbiManual: { name: "JBI Manual, scoping reviews", cite: "Peters MDJ et al. Chapter 10: Scoping reviews. In: Aromataris E et al. (eds). JBI Manual for Evidence Synthesis", url: "https://jbi-global.atlassian.net/wiki/spaces/MANUAL/pages/355862497/10.+Scoping+reviews" },
  press: { name: "PRESS 2015", cite: "McGowan J et al. J Clin Epidemiol 2016;75:40-6", url: "https://doi.org/10.1016/j.jclinepi.2016.01.021" },
  sampson: { name: "Relative recall", cite: "Sampson M et al. BMC Med Res Methodol 2006;6:33", url: "https://doi.org/10.1186/1471-2288-6-33" },
  bramerDb: { name: "Database combinations", cite: "Bramer WM et al. Syst Rev 2017;6:245", url: "https://doi.org/10.1186/s13643-017-0644-y" },
  bramerDedup: { name: "Bramer deduplication", cite: "Bramer WM et al. J Med Libr Assoc 2016;104(3):240-3; correction 2017;105(1):111", url: "https://doi.org/10.3163/1536-5050.104.3.014" },
  hamel2021: { name: "AI for title/abstract screening", cite: "Hamel C et al. Guidance for using artificial intelligence for title and abstract screening while conducting knowledge syntheses. BMC Med Res Methodol 2021;21:285", url: "https://doi.org/10.1186/s12874-021-01451-2" },
  vembye2025: { name: "GPT as second screener", cite: "Vembye MH et al. Generative pretrained transformer models can function as highly reliable second screeners of titles and abstracts in systematic reviews: a proof of concept and common guidelines. Psychol Methods 2025", url: "https://doi.org/10.1037/met0000769" },
  waffen: { name: "Single vs. dual screening", cite: "Waffenschmidt S et al. BMC Med Res Methodol 2019;19:132", url: "https://doi.org/10.1186/s12874-019-0782-0" },
  safe: { name: "SAFE stopping procedure", cite: "Boetje J, van de Schoot R. Syst Rev 2024;13:81", url: "https://doi.org/10.1186/s13643-024-02502-7" },
  buscemi: { name: "Single vs. double extraction", cite: "Buscemi N et al. J Clin Epidemiol 2006;59:697-703", url: "https://pubmed.ncbi.nlm.nih.gov/16765272/" },
  probastAI: { name: "PROBAST+AI", cite: "Moons KGM et al. BMJ 2025;388:e082505", url: "https://doi.org/10.1136/bmj-2024-082505" },
};

export const SOURCES = S;

// The routes compared on every step (the teaching table). `scan` is Sieve's quick scan.
export const ROUTES = [
  { id: "systematic", label: "Systematic review", basis: [S.handbook, S.mecir, S.prisma] },
  { id: "rapid", label: "Rapid review", basis: [S.rr2024, S.rrAI] },
  { id: "scoping", label: "Scoping review", basis: [S.jbiScoping, S.jbiManual, S.prismaScR] },
  { id: "scan", label: "Quick scan (Sieve)", basis: [S.rrAI, S.ai2025] },
];

// status: done | partly | missing
export const METHODS = [
  {
    id: "general", title: "Across all steps",
    method: [
      [S.prisma, "Report what was done at every stage, with a flow diagram of records identified, screened, excluded (with reasons) and included."],
      [S.ai2025, "The authors stay accountable for AI use; justify and validate a tool for the specific review, keep human oversight, and report any AI that makes or suggests judgements."],
      [S.rrAI, "Do not rely on AI to fully automate any step; use it for quality assurance (e.g. flagging missed studies or extraction errors); a human verifies all AI outputs and makes the final decisions; state the tools, their tasks, model versions and prompts."],
    ],
    compare: [
      ["AI use", "Human decisions; AI only when validated for this review and fully reported (joint statement 2025).", "AI as a check next to a single reviewer, never fully automated (Cochrane RR AI position 2025).", "As for systematic reviews (JBI co-signed the joint statement).", "AI suggests at every stage; you approve the plan, decide every record, check every value and approve the summary; AI use disclosure with prompts."],
    ],
    sieve: [
      ["done", "Every AI step is a fixed prompt + JSON schema, stored per run with model and date, next to the human decision; prompts can be downloaded."],
      ["done", "Evidence quotes are checked word for word against the paper and can be opened highlighted in the text."],
      ["done", "Quick scan: no AI-only step (plan approval, blind calibration with κ, a human decision for every record, every value checked, summary approval, AI use disclosure)."],
      ["partly", "Full review: the methods draft (step 8) names the models; a complete AI use statement for the eight steps is not generated yet."],
    ],
  },
  {
    id: "protocol", title: "1 · Protocol",
    method: [
      [S.prismaP, "Define the question and eligibility criteria before searching, and register or publish the protocol (e.g. PROSPERO, OSF)."],
      [S.rr2024, "Rapid reviews: involve knowledge users in the question (rec. 1); a protocol before starting, registered where possible (rec. 2); clear eligibility criteria and any limits (rec. 3)."],
      [S.jbiScoping, "Scoping reviews: an a priori protocol with population, concept and context; report with PRISMA-ScR."],
    ],
    compare: [
      ["Protocol", "Registered protocol before searching (PRISMA-P; e.g. PROSPERO).", "Protocol before starting, registered where possible (rec. 2).", "A priori protocol with PCC (JBI).", "AI drafts criteria, search and fields; your approval fixes them, dated, as the scan's protocol."],
    ],
    sieve: [
      ["done", "Question, PICO / PICo / SPIDER / PCC, eligibility criteria with the consequence of failing each one; purpose-first choice of review type."],
      ["done", "Start from an existing document (ticket, proposal, criteria flowchart)."],
      ["missing", "Export in PRISMA-P / registration format and a frozen, dated protocol version for the full review."],
    ],
  },
  {
    id: "search", title: "2 · Search",
    method: [
      [S.mecir, "Search CENTRAL, MEDLINE and Embase if available (C24, mandatory); trial registers where relevant (C27, mandatory); reference lists (C30, mandatory); specialist databases (C25) and grey literature (C28) highly desirable; document the search (C36)."],
      [S.handbook4, "All search strategies should be peer reviewed before being run, by a librarian or information specialist (4.2.2)."],
      [S.press, "Peer review the strategy on six elements: translation of the question, Boolean/proximity operators, subject headings, text words, spelling/syntax/line numbers, limits and filters."],
      [S.rr2024, "Rapid reviews: involve an information specialist (rec. 4); at least two bibliographic databases, e.g. two of MEDLINE, CENTRAL and Embase (rec. 5); PRESS for the primary strategy, at minimum a check for errors (rec. 6); justify grey literature (rec. 7)."],
      [S.sampson, "Test the strategy against known relevant studies (relative recall)."],
      [S.bramerDb, "Embase, MEDLINE, Web of Science and Google Scholar together gave the best recall in their study."],
      [S.prismaS, "Report every database with its platform, the full strategy, limits, search date and number of records."],
    ],
    compare: [
      ["Databases", "CENTRAL, MEDLINE, Embase (MECIR C24) + registers, specialist databases, grey literature.", "At least two bibliographic databases (rec. 5).", "Broad enough for the scope (JBI).", "PubMed + Europe PMC preprints/PMC, named as a limitation."],
      ["Peer review", "Strongly recommended before running (Handbook 4.2.2; PRESS).", "PRESS for the primary strategy (rec. 6).", "Recommended.", "PRESS checklist on the search stage; peer reviewer's name recorded."],
    ],
    sieve: [
      ["done", "Validation and hold-out sets, tested live in PubMed (recall, missed articles and why), and recall per database after importing the exports."],
      ["done", "Translations of a MEDLINE (Ovid) strategy to Embase, Web of Science, PsycInfo and ACM, with a check list and an assistant review; counts per line."],
      ["partly", "PRESS: a six-element checklist with the peer reviewer's name in the quick scan; no PRESS form in step 2 yet."],
      ["partly", "PRISMA-S: strategies and counts per line are kept; platform, search date and limits per database are not recorded as fields yet."],
      ["missing", "CENTRAL, trial registers (ClinicalTrials.gov, WHO ICTRP), Google Scholar, CINAHL and Scopus translations."],
    ],
  },
  {
    id: "records", title: "3 · Records and deduplication",
    method: [
      [S.bramerDedup, "Remove duplicates in fixed passes from strict to loose field combinations, with normalised page numbers; check the loose matches by hand."],
      [S.mecir, "Document the selection process in enough detail for a flow diagram (C41)."],
      [S.prisma, "Report records identified per source and the number of duplicates removed."],
    ],
    compare: [
      ["Duplicates", "Remove and report per source (PRISMA 2020).", "Same.", "Same.", "Linked automatically (Bramer passes); overlap between PubMed and Europe PMC shown."],
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
    compare: [
      ["Reports", "Link multiple reports of one study; check retractions and errata.", "Same, where time allows.", "Same.", "Not in the scan; step 4 checks DOI, title, year and preprints."],
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
    compare: [
      ["Full texts", "All potentially eligible reports, via the library and authors if needed.", "Same; report what was not retrieved.", "Same.", "Open-access texts only; the others are judged on the abstract, reported as such."],
    ],
    sieve: [
      ["done", "Automatic retrieval from open sources (Europe PMC, PubMed Central, arXiv, Unpaywall), a download list for the rest, PDFs or a whole folder matched by content."],
      ["partly", "\"Reports not retrieved\" is in the flow diagram; reasons for non-retrieval are not recorded."],
    ],
  },
  {
    id: "screening", title: "6 · Screening",
    method: [
      [S.mecir, "Use (at least) two people working independently to decide whether each study meets the eligibility criteria, with a predefined way to resolve disagreements (C39, mandatory); dual title/abstract screening is desirable, not mandatory."],
      [S.handbook4, "Pilot the criteria on a sample of reports (e.g. six to eight); decide on full texts with two people independently (4.6.4). Automatic elimination of records by machine learning was not recommended at the time of writing (mid-2023); classifiers can reduce manual screening by 30% to over 90%, sometimes at a loss of up to 5% sensitivity (4.6.6.2)."],
      [S.waffen, "Single-reviewer title/abstract screening misses studies (median 5%, 13% for less experienced reviewers)."],
      [S.rr2024, "Rapid reviews: pilot screening (rec. 8); dual independent screening of a proportion of records (e.g. 20%), check agreement, continue with single screening if κ ≥ 0.8 (rec. 9); the same for full texts."],
      [S.rrAI, "AI may re-examine records excluded by a single reviewer; a human makes every final decision."],
      [S.hamel2021, "Ways to integrate AI in screening, from most to least robust; among them dual-independent screening with an AI reviewer, where another reviewer resolves records the AI excluded and the human included. Full automation (AI alone deciding on inclusion) performs poorly and should be avoided."],
      [S.vembye2025, "GPT models as independent second screeners of titles and abstracts: a proof of concept against human double screening, with common guidelines."],
      [S.jbiManual, "Scoping reviews: source selection at title/abstract and full-text level by two or more reviewers independently, after pilot testing; the protocol states how disagreements are resolved (10.2.6)."],
      [S.safe, "With prioritised (active learning) screening, use an explicit, conservative stopping rule."],
    ],
    compare: [
      ["Who screens", "Two people independently; titles/abstracts by one acceptable, full texts by two (MECIR C39; Handbook 4.6.4).", "Pilot; two people on ~20%, single screening if κ ≥ 0.8 (rec. 8-9).", "Two or more reviewers independently, titles/abstracts and full texts, after a pilot (JBI Manual 10.2.6).", "You screen every record blind and the AI is the independent second reviewer; you resolve the disagreements (Hamel 2021). Faster option: blind calibration (κ), then the AI suggestion shown."],
    ],
    sieve: [
      ["done", "Model runs per criterion with verified quotes; sensitivity, specificity and κ against your decisions; disagreements first; full-text exclusions require a reason."],
      ["done", "Quick scan: you screen every record blind with the AI as independent second reviewer and resolve the disagreements (κ shown); or, faster, a blind calibration sample and then the AI suggestion shown."],
      ["partly", "Conflicts between you and the AI are resolved by you; a second human for the conflicts (Hamel 2021) is not built in yet."],
      ["partly", "A model can be the second reviewer, but a true two-human mode (blinded, independent, with conflict resolution) is not there yet."],
      ["missing", "Prioritised screening with a stopping rule such as SAFE."],
    ],
  },
  {
    id: "extraction", title: "7 · Data extraction and risk of bias",
    method: [
      [S.mecir, "Use a piloted data collection form (C43, mandatory); two people independently extract outcome data (C46, mandatory) and preferably study characteristics (C45, highly desirable)."],
      [S.handbook5, "More than one person should extract data from every report; at minimum, data needing interpretation and data critical to the results are extracted independently by two people (5.5.2)."],
      [S.buscemi, "Single extraction produces more errors than double extraction."],
      [S.rr2024, "Rapid reviews: limit extraction to the most important fields (rec. 10); pilot (rec. 11); one person extracts, a second verifies critical data (rec. 12)."],
      [S.mecir, "Assess risk of bias of each result that matters, with RoB 2 for randomised trials (C52), by two people independently (C53, mandatory). Rapid reviews: a validated tool, one assesses and a second verifies (Garritty 2024, rec. 14-16)."],
      [S.jbiManual, "Scoping reviews: data extraction is called charting; pilot it with at least two members of the team (10.2.7)."],
      [S.probastAI, "Use a tool that fits the study type: e.g. PROBAST+AI for (AI) prediction models, RoB 2, ROBINS-I, QUADAS-2."],
    ],
    compare: [
      ["Extraction", "Two people independently for outcome data (MECIR C46); piloted form (C43).", "One extracts, a second verifies critical data (rec. 12).", "Data charting, piloted by at least two team members (JBI Manual 10.2.7).", "AI extracts with quotes; you check every value against its quote."],
      ["Risk of bias", "Validated tool (RoB 2 for RCTs), two people independently (C52-C53).", "Validated tool, one assesses and a second verifies (rec. 14-16).", "Not normally required (JBI).", "Not done: named as a limitation."],
    ],
    sieve: [
      ["done", "Every value with a verified quote; two runs compared field by field; the human verifies each cell (disagreements and unverified quotes first)."],
      ["done", "Pilot run and run checks (completeness, verified quotes, core-only rule)."],
      ["missing", "Risk-of-bias / quality appraisal module (RoB 2, ROBINS-I, QUADAS-2, PROBAST+AI) as a form like extraction."],
    ],
  },
  {
    id: "report", title: "8 · Report",
    method: [
      [S.prisma, "Flow diagram and the 27-item checklist."],
      [S.prismaS, "Search appendix with every full strategy."],
      [S.rr2024, "Rapid reviews: describe the restricted methods and discuss their limitations (rec. 24); GRADE for the main comparisons if time allows (rec. 21-23)."],
      [S.ai2025, "A transparent statement of AI use and its validation."],
    ],
    compare: [
      ["Reporting", "PRISMA 2020 + PRISMA-S; certainty of evidence (GRADE).", "PRISMA; the restricted methods and their limitations (rec. 24).", "PRISMA-ScR.", "Labelled an evidence scan; limitations written from what was done; AI use disclosure."],
    ],
    sieve: [
      ["done", "PRISMA 2020 counts and diagram, inclusion/exclusion per criterion, a methods draft built from what was run, a search appendix with all strategies and translations."],
      ["missing", "PRISMA 2020 / PRISMA-ScR / PRISMA-S checklist exports, GRADE, a complete AI use statement for the full review."],
    ],
  },
  {
    id: "scan", title: "Quick scan",
    method: [
      [S.rrAI, "No step fully automated; AI as a check next to one human reviewer; the human verifies all AI outputs and makes the final decisions; disclose tools, tasks, model versions and prompts."],
      [S.rr2024, "The scan borrows the rapid review safeguards: protocol first (rec. 2), PRESS (rec. 6), pilot and calibration with κ (rec. 8-9), verified extraction (rec. 12), explicit limitations (rec. 24)."],
      [S.ai2025, "Accountability stays with the author; AI use is reported."],
    ],
    compare: [
      ["What it is", "Not a systematic review.", "Not a rapid review: fewer databases, no risk of bias, no GRADE (rec. 5, 14-23).", "Can seed a scoping review's search and charting.", "An AI-assisted evidence scan: a fast, transparent first look that continues as a full review in the same project."],
    ],
    sieve: [
      ["done", "Plan approved as a dated protocol; PRESS checklist; blind calibration with κ; every record and every value decided or checked by you; summary approval; limitations and AI use disclosure written from what was done."],
      ["missing", "Risk of bias and GRADE; a second human reviewer (the next steps of the full review)."],
    ],
  },
];

// Gaps in order of priority for a systematic review.
export const GAPS = [
  "Risk-of-bias / quality appraisal (RoB 2, ROBINS-I, QUADAS-2, PROBAST+AI) as a form with evidence quotes, by two people (MECIR C52-C53).",
  "Two-human screening and extraction: independent, blinded decisions with conflict resolution (MECIR C39, C46).",
  "CENTRAL and trial registers (MECIR C24, C27); a PRESS form in step 2; PRISMA-S fields (platform, date, limits) per database.",
  "Complete AI use statement in the report for the full review (tools, versions, prompts, validation, human oversight).",
  "PRISMA 2020, PRISMA-ScR and PRISMA-S checklist exports; GRADE.",
  "Retraction check; protocol export (PRISMA-P / registration).",
  "Prioritised screening with the SAFE stopping procedure.",
  "Google Scholar, CINAHL and Scopus translations.",
];

export const methodFor = id => METHODS.find(m => m.id === id);

export function methodsMarkdown() {
  const out = ["# Methods in Sieve: accepted guidance per step", "",
    "Generated by `node tools/build-methods.mjs` from site/js/methods.js (also in the app: Methods & guidance, and an \"Official method\" box on every step).", "",
    "Status: ✓ done · ◐ partly · ✗ missing", "",
    "## Routes and their guidance", "", ...ROUTES.map(r => `- **${r.label}**: ${r.basis.map(b => `${b.name}, ${b.cite} (${b.url})`).join("; ")}`), ""];
  const mark = { done: "✓", partly: "◐", missing: "✗" };
  for (const s of METHODS) {
    out.push(`## ${s.title}`, "", "**Accepted method**", "");
    for (const [src, text] of s.method) out.push(`- ${text} *${src.name}: ${src.cite}* (${src.url})`);
    if (s.compare?.length) {
      out.push("", `| | ${ROUTES.map(r => r.label).join(" | ")} |`, `|---|${ROUTES.map(() => "---").join("|")}|`);
      for (const [label, ...cells] of s.compare) out.push(`| ${label} | ${cells.join(" | ")} |`);
    }
    out.push("", "**In Sieve**", "");
    for (const [st, text] of s.sieve) out.push(`- ${mark[st]} ${text}`);
    out.push("");
  }
  out.push("## Gaps, in order of priority", "", ...GAPS.map((g, i) => `${i + 1}. ${g}`), "");
  return out.join("\n");
}
