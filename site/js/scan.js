// Quick evidence scan: question → plan → PubMed + Europe PMC → AI screening → open-access texts →
// extraction → summary. Everything is written into the normal project fields (protocol, criteria,
// search.blocks, records, screening.runs, fulltext, extraction), so the same project can continue
// as a scoping or systematic review in the eight steps. Pure functions only (tested in node).
import { parseTerm, blockTerms } from "./query.js";
import { REVIEW_TYPES, FRAMEWORKS } from "./review-plan.js";
import { screeningPrompt, sourceBlock, extractionPrompt } from "./prompts.js";
import { SOURCES as SRC } from "./methods.js";

const str = d => (d ? { type: "string", description: d } : { type: "string" });
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = items => ({ type: "array", items });

export const SYSTEM_SCAN = "You are an experienced information specialist and evidence-synthesis methodologist. You make concrete, conservative suggestions and return ONLY JSON matching the requested schema.";

export const SCAN_STAGES = [
  { id: "plan", label: "Plan", what: "Criteria, search terms and data fields drafted from your question." },
  { id: "search", label: "Search", what: "PubMed and Europe PMC searched live, the most relevant records kept." },
  { id: "screen", label: "Screen", what: "Every title and abstract judged against each criterion, with quotes." },
  { id: "texts", label: "Full texts", what: "Open-access full texts collected for the selected papers." },
  { id: "extract", label: "Extract", what: "The data fields filled per paper, each value with a quote." },
  { id: "summary", label: "Summary", what: "An answer with citations, the selection flow and the limitations." },
];

// Worked example per stage, from the public example project (LLM title/abstract screening).
export const SCAN_EXAMPLES = {
  plan: [["Question", "How accurate are LLMs at title/abstract screening, compared with human reviewers?"],
    ["Criteria", "LLM screens records · compared with humans · accuracy reported · original study"],
    ["Search blocks", "Large language models AND screening AND systematic review"],
    ["Data fields", "LLM and version · prompting · dataset · sensitivity · specificity · workload saving"]],
  search: [["PubMed", '("large language model*"[tiab] OR ChatGPT[tiab] OR …) AND (screen*[tiab] OR …)'],
    ["Europe PMC", '(TITLE_ABS:"large language model*" OR …) AND (SRC:PPR OR SRC:PMC)'],
    ["Kept", "the most relevant records from each source; duplicates linked automatically"]],
  screen: [["Paper", "GPT-4 for title and abstract screening in four reviews"],
    ["Criteria", "LLM screens records: Yes · compared with humans: Yes · accuracy reported: Yes · original study: Yes"],
    ["Decision", "Include · quote: “sensitivity of 0.91 compared with dual human screening”"]],
  texts: [["Found automatically", "open-access copies via Europe PMC, PubMed Central, arXiv and Unpaywall"],
    ["Not found", "subscription papers keep their abstract; add the PDFs later in step 5"]],
  extract: [["Field", "Sensitivity / recall"], ["Value", "0.91 (range 0.85–0.97 across reviews)"],
    ["Evidence", "❝ quote checked word for word against the full text"]],
  summary: [["Answer", "Recall is high in most studies, specificity varies widely [14][24]"],
    ["Flow", "records identified → screened → selected → with full text → extracted"],
    ["Limits", "open databases only · one AI screener · open-access texts only"]],
};

// ------------------------------------------------------------------ plan
const ELEMENT_KEYS = ["P", "I", "C", "O", "Co", "C2", "S", "PI", "D", "E", "R"];

export const scanPlanSchema = obj({
  framework: { type: "string", enum: Object.keys(FRAMEWORKS) },
  elements: arr(obj({ key: { type: "string", enum: ELEMENT_KEYS }, text: str() })),
  criteria: arr(obj({ label: str("2-5 words"), description: str("what must be true; decidable from a title and abstract") })),
  blocks: arr(obj({ label: str(), terms: arr(str('one PubMed term, e.g. "machine learning"[tiab] or Artificial Intelligence[Mesh]')) })),
  fields: arr(obj({ label: str(), description: str("what to extract; units or answer options if relevant"), type: { type: "string", enum: ["text", "number", "yesno"] } })),
  notes: str("assumptions you made about the question; what the user should check"),
});

export function scanPlanPrompt(project) {
  const p = project.protocol;
  const type = REVIEW_TYPES[p.review_type] || REVIEW_TYPES.scoping;
  const fw = FRAMEWORKS[p.framework] && p.framework !== "Open" ? p.framework : type.framework;
  const known = p.elements.filter(e => e.text).map(e => `${e.label}: ${e.text}`);
  return `Plan a quick, AI-assisted evidence scan for this question. It will search PubMed and Europe PMC, screen titles and abstracts with your criteria, and extract your fields from open-access full texts.

Question: ${p.question}
Intended review type if the scan is continued: ${type.label}
Question framework: ${fw}${known.length ? `\nAlready filled in by the user (keep these):\n${known.join("\n")}` : ""}

Return:
- framework and elements: the ${fw} elements (keys ${(FRAMEWORKS[fw] || []).map(([k]) => k).join(", ") || "of your choice"}), one short phrase each.
- criteria: 3-5 eligibility criteria, each decidable from a title and abstract, written so that "Yes" means the paper fits. Include the study type (e.g. original research) as a criterion when it matters for the question.
- blocks: 2-3 concept blocks that every relevant record must match (combined with AND). 4-10 PubMed terms per block: "phrase"[tiab], word*[tiab], Heading[Mesh]. Prefer specific vocabulary; avoid generic words that cause noise.
- fields: 4-7 data fields that answer the question across studies (setting, design, sample, the main outcome with its unit). Do not include title, authors, year or DOI.
- notes: assumptions and what the user should check first.

Example of the level of detail (a different question):
{"criteria": [{"label": "LLM screens records", "description": "A large language model is used to screen titles/abstracts or full texts for a literature review"}],
 "blocks": [{"label": "Large language models", "terms": ["\\"large language model*\\"[tiab]", "ChatGPT[tiab]", "Large Language Models[Mesh]"]}],
 "fields": [{"label": "Sensitivity / recall", "description": "proportion of relevant records the LLM kept, as reported (e.g. 0.91)", "type": "number"}]}

Return JSON {"framework", "elements": [{"key", "text"}], "criteria": [{"label", "description"}], "blocks": [{"label", "terms"}], "fields": [{"label", "description", "type"}], "notes"}.`;
}

const slugId = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_").slice(0, 24) || "x";
function unique(list, base) { let id = base, i = 2; while (list.some(x => x.id === id)) id = `${base}_${i++}`; return id; }

// Writes the plan into the project. Existing criteria, blocks and fields are replaced only when `replace`.
export function applyScanPlan(project, plan, { replace = true } = {}) {
  const p = project.protocol;
  if (plan.framework && FRAMEWORKS[plan.framework]?.length) {
    const labels = Object.fromEntries(FRAMEWORKS[plan.framework]);
    const given = Object.fromEntries((plan.elements || []).map(e => [e.key, e.text]));
    const prev = Object.fromEntries((p.framework === plan.framework ? p.elements : []).map(e => [e.key, e.text]));
    p.framework = plan.framework;
    p.elements = FRAMEWORKS[plan.framework].map(([key]) => ({ key, label: labels[key], text: prev[key] || given[key] || "" }));
  }
  if (replace || !project.criteria.length) {
    project.criteria = [];
    for (const c of plan.criteria || []) project.criteria.push({ id: unique(project.criteria, slugId(c.label)), label: c.label, description: c.description, fail_decision: "Exclude" });
  }
  if (replace || !project.search.blocks.length) {
    project.search.blocks = [];
    for (const b of plan.blocks || []) project.search.blocks.push({ id: unique(project.search.blocks, slugId(b.label).slice(0, 12)), label: b.label, role: "include", terms: (b.terms || []).filter(Boolean) });
  }
  const ex = project.extraction;
  if (replace || !ex.fields.length) {
    ex.fields = [];
    for (const f of plan.fields || []) ex.fields.push({ id: unique(ex.fields, slugId(f.label)), label: f.label, description: f.description || "", type: f.type === "number" || f.type === "yesno" ? f.type : "text", core: true });
  }
  project.scan = { ...(project.scan || {}), plan: { notes: plan.notes || "", date: new Date().toISOString().slice(0, 10) } };
  return project;
}

// ------------------------------------------------------------------ Europe PMC
// PubMed block syntax → Europe PMC: [tiab]/[ti]/[ab] → TITLE_ABS / TITLE / ABSTRACT, [Mesh] → MESH (also matched
// in title/abstract, because preprints have no MeSH), proximity pairs become AND within TITLE_ABS.
function epmcTerm(t) {
  const phrase = s => (/[\s-]/.test(s) || /^".*"$/.test(s) ? `"${s.replace(/"/g, "")}"` : s);
  if (t.kind === "near") return `(TITLE_ABS:(${t.left.map(phrase).join(" OR ")}) AND TITLE_ABS:(${t.right.map(phrase).join(" OR ")}))`;
  if (t.kind === "raw") return null;
  const f = String(t.field).replace(/:~\d+$/, "");
  const txt = t.quoted ? `"${t.text}"` : t.text;
  if (f.startsWith("mesh") || f === "majr") return `(MESH:"${t.text}" OR TITLE_ABS:"${t.text}")`;
  if (f === "ti") return `TITLE:${txt}`;
  if (f === "ab") return `ABSTRACT:${txt}`;
  if (f === "dp") { const [a, b] = t.text.split(":").map(x => x.slice(0, 4)); return b ? `PUB_YEAR:[${a} TO ${b}]` : `PUB_YEAR:${a}`; }
  // [la] is left out: Europe PMC preprints have no language field, so LANG:eng drops almost all of them.
  if (["tiab", "tw", "all", "tw:noexp"].includes(f)) return `TITLE_ABS:${txt}`;
  return null;   // publication types and other PubMed-only fields: no safe Europe PMC equivalent
}

export function epmcQuery(blocks, { sources = "(SRC:PPR OR SRC:PMC)" } = {}) {
  const inc = blocks.filter(b => b.enabled !== false && b.role !== "exclude")
    .map(b => blockTerms(b).map(l => epmcTerm(parseTerm(l))).filter(Boolean))
    .filter(parts => parts.length).map(parts => `(${parts.join(" OR ")})`);
  if (!inc.length) return "";
  return `${inc.join(" AND ")}${sources ? ` AND ${sources}` : ""}`;
}

export function epmcToRecord(r) {
  const j = r.journalInfo || {};
  return {
    rid: r.pmid || (/^[A-Z]/.test(r.id) ? r.id : `${r.source}${r.id}`), pmid: r.pmid || "", pmcid: r.pmcid || "", doi: r.doi || "",
    title: String(r.title || "").replace(/\.$/, ""), abstract: String(r.abstractText || "").replace(/<[^>]+>/g, " "),
    year: r.pubYear || "", authors: r.authorString || "", journal: j.journal?.title || r.bookOrReportDetails?.publisher || (r.source === "PPR" ? "Preprint" : ""),
    volume: j.volume || "", issue: j.issue || "", pages: r.pageInfo || "", pubtypes: r.pubTypeList?.pubType || [],
    europepmc_id: `${r.source}:${r.id}`, is_preprint: r.source === "PPR",
  };
}

// ------------------------------------------------------------------ inclusion / exclusion flow
// Each excluded record is attributed to the FIRST criterion (in protocol order) it fails, so the bars add up
// to the number excluded and read as a flowchart. `decide(rid)` returns the final decision and the criterion
// answers that support it: {decision, criteria: {id: "Yes"|"No"|"Unclear"}, reason}.
export function criteriaFlow(project, records, decide) {
  const crit = project.criteria;
  const rows = crit.map(c => ({ id: c.id, label: c.label, n: 0 }));
  const other = { id: "_other", label: "Other or not recorded", n: 0 };
  let included = 0, unclear = 0, pending = 0;
  for (const r of records) {
    const d = decide(r.rid);
    if (!d?.decision) { pending++; continue; }
    if (d.decision === "Include") { included++; continue; }
    if (!/^Exclude/.test(d.decision)) { unclear++; continue; }
    let k = crit.findIndex(c => d.criteria?.[c.id] === "No");
    if (k < 0 && d.reason) k = crit.findIndex(c => new RegExp(`\\b${c.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(d.reason) || d.reason === c.id);
    if (k < 0) other.n++; else rows[k].n++;
  }
  return { screened: records.length - pending, pending, included, unclear, excluded: rows.reduce((s, x) => s + x.n, other.n), rows: other.n ? [...rows, other] : rows };
}

// ------------------------------------------------------------------ summary
export const scanSummarySchema = obj({
  answer: str("2-4 sentences that answer the question, citing papers as [PAPER_ID]"),
  findings: arr(obj({ statement: str("one finding, specific, with numbers where the data has them"), paper_ids: arr(str()) })),
  agreement: str("where the studies agree or disagree, and why that may be"),
  gaps: arr(str("a gap or open question the included studies leave")),
  next_steps: arr(str("what a full review should add or check first")),
});

export function scanSummaryPrompt(project, papers) {
  return `Write the summary of a quick, AI-assisted evidence scan. Use ONLY the papers and extracted data below; cite every claim as [PAPER_ID]. Report numbers as extracted. Say so when papers are few, small or heterogeneous. Do not call this a systematic review.

Question: ${project.protocol.question}
${project.criteria.length ? `Eligibility criteria: ${project.criteria.map(c => `${c.label} (${c.description})`).join("; ")}` : ""}

${papers.map(x => `=== PAPER [${x.rid}] ===\n${x.cite}\n${x.lines.join("\n")}`).join("\n\n")}

Return JSON {"answer", "findings": [{"statement", "paper_ids"}], "agreement", "gaps": [...], "next_steps": [...]}.`;
}

// Limitations follow from what was actually done; no model writes them.
// Limitations follow from what was actually done; no model writes them. The checks follow the Cochrane rapid
// review guidance (Garritty et al., BMJ 2024;384:e076335; recommendation numbers in brackets).
export function scanLimits(project, facts) {
  const out = [];
  const s = project.scan?.search, press = project.scan?.press;
  out.push(s ? `Searched PubMed and Europe PMC (preprints and PubMed Central) on ${s.date}; subscription databases such as Embase, CENTRAL or Web of Science and grey literature were not searched (rec. 5: at least two bibliographic databases; rec. 7).` : "Searched open databases only.");
  if (s?.pubmed && s.pubmed.count > s.pubmed.fetched) out.push(`Only the ${s.pubmed.fetched} most relevant of ${s.pubmed.count} PubMed records were screened (PubMed relevance ranking).`);
  if (s?.europepmc && s.europepmc.count > s.europepmc.fetched) out.push(`Only the ${s.europepmc.fetched} most relevant of ${s.europepmc.count} Europe PMC records were screened.`);
  const pressN = Object.values(press?.items || {}).filter(Boolean).length;
  out.push(press?.reviewer ? `Search strategy peer reviewed by ${press.reviewer} (${pressN} of 6 PRESS elements checked).`
    : pressN ? `Search strategy checked by the author on ${pressN} of 6 PRESS elements; not peer reviewed by an information specialist (rec. 4, 6).`
    : "Search strategy not peer reviewed (PRESS, rec. 6).");
  const c = facts.calibration;
  if (facts.humanChecked && facts.humanChecked >= facts.screened && facts.screenMode === "independent") {
    out.push(`Titles and abstracts: one person screened every record independently of the AI, the AI acted as second reviewer${c?.n ? ` (agreement κ = ${c.kappa.toFixed(2)} on ${c.n} records)` : ""}, and the person resolved the ${c?.conflicts || 0} disagreements; another reviewer for the conflicts, as Hamel et al. (2021) advise, was not involved.`);
  } else if (facts.humanChecked && facts.humanChecked >= facts.screened) {
    out.push(`Titles and abstracts: an AI model suggested a decision for every record and one person made every final decision${c?.n ? `; on a calibration sample of ${c.n} records screened blind, agreement between the person and the AI was κ = ${c.kappa.toFixed(2)}${c.kappa >= 0.8 ? "" : " (below the 0.8 the guidance uses before continuing with single screening, rec. 9)"}` : ""}. Single human screening misses more studies than two independent reviewers.`);
  } else out.push(facts.humanChecked ? `Titles and abstracts were screened by one AI model; ${facts.humanChecked} of ${facts.screened} decisions were checked by a person.` : "Titles and abstracts were screened by one AI model, without a human check (single-reviewer screening misses studies).");
  if (facts.selected) out.push(`Full texts: ${facts.withText} of ${facts.selected} selected papers had an open-access text; the others were extracted from the abstract only.`);
  if (facts.selected) out.push(facts.extractChecked >= facts.selected ? `Data were extracted by an AI model and every value was checked against the source by one person (rec. 12).` : `Extracted values: ${facts.extractChecked || 0} of ${facts.selected} papers checked by a person.`);
  out.push("No risk-of-bias or quality appraisal (rec. 14–16) and no certainty-of-evidence (GRADE) rating (rec. 21–23).");
  return out;
}

// Cochrane rapid review rec. 8–9: pilot, then dual independent screening of a proportion of records (e.g. 20%) and
// check agreement; with κ ≥ 0.8 continue with single screening. Here the second rater is the AI, the person screens
// the sample blind. The sample is fixed per project (seeded), 20% with a minimum of 10 and a maximum of 50 records.
export function calibrationSample(rids, seed = "") {
  const n = rids.length <= 10 ? rids.length : Math.min(50, Math.max(10, Math.ceil(rids.length * 0.2)));
  return [...rids].sort((a, b) => hashKey(seed + a).localeCompare(hashKey(seed + b))).slice(0, n);
}

// Cohen's κ for two raters on a yes/no judgement (here: keep = Include or Unclear, versus Exclude).
export function kappa(pairs) {
  const n = pairs.length;
  if (!n) return null;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n;
  const pe = pa * pb + (1 - pa) * (1 - pb);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

// AI use disclosure (Cochrane Rapid Reviews Methods Group, 2025): which tools, which tasks, model versions, prompts,
// and how the outputs were verified by a person.
export function aiUseDisclosure(info) {
  const out = [];
  if (info.plan) out.push(`Plan (criteria, search blocks, data fields): drafted by ${info.plan.model || "an AI model"}; ${info.plan.approved ? `checked and approved by the author on ${info.plan.approved}` : "not yet approved by the author"}.`);
  if (info.screen) out.push(`Title/abstract screening (${info.screen.mode === "assisted" ? "AI suggestion shown to the author after a blind calibration sample" : "the author screened blind, the AI as independent second reviewer"}): ${info.screen.models.join(", ") || "an AI model"} for ${info.screen.n} records; ${info.screen.checked} final decisions made by the author${info.screen.changed ? `, of which ${info.screen.changed} differ from the AI suggestion` : ""}${info.screen.calibration?.n ? `; blind calibration on ${info.screen.calibration.n} records, κ = ${info.screen.calibration.kappa.toFixed(2)}, ${info.screen.calibration.missed} records the author kept were excluded by the AI` : ""}.`);
  if (info.extract) out.push(`Data extraction: values with quotes by ${info.extract.models.join(", ") || "an AI model"} for ${info.extract.n} papers; ${info.extract.checked} papers checked against the source by the author${info.extract.changed ? `, ${info.extract.changed} values corrected` : ""}.`);
  if (info.summary) out.push(`Summary: drafted by ${info.summary.model || "an AI model"} from the checked data; ${info.summary.approved ? `checked against the cited papers and approved by the author on ${info.summary.approved}` : "not yet checked by the author (draft)"}.`);
  out.push("Every prompt is built by fixed code from this project and can be downloaded; the exact model versions are listed above.");
  return out;
}

// "Smith, A; Jones, B" (PubMed) and "Smith A, Jones B" (Europe PMC) → "Smith".
export const surname = authors => String(authors || "").split(/[;,]/)[0].trim().split(/\s+/)[0] || "Anon.";

export function summaryMarkdown(project, facts, flow) {
  const s = project.scan?.summary || {};
  const cite = id => { const r = project.records.find(x => x.rid === String(id)); return r ? `[${id}] ${surname(r.authors)} ${r.year || ""}. ${String(r.title || "").replace(/\.$/, "")}. ${String(r.journal || "").replace(/\.$/, "")}${r.doi ? `. https://doi.org/${r.doi}` : ""}` : `[${id}]`; };
  const ids = [...new Set((s.findings || []).flatMap(f => f.paper_ids || []).concat(String(s.answer || "").match(/\[(\w+)\]/g)?.map(x => x.slice(1, -1)) || []))];
  return [`# Evidence scan: ${project.protocol.question}`, "",
    `*AI-assisted evidence scan, not a systematic or rapid review. Made with Sieve.${s.approved ? ` Summary checked by the author on ${s.approved}.` : " DRAFT: the summary has not been checked by the author."}*`, "",
    "## Answer", "", s.answer || "", "",
    "## Findings", "", ...(s.findings || []).map(f => `- ${f.statement} ${(f.paper_ids || []).map(i => `[${i}]`).join("")}`), "",
    s.agreement ? `## Agreement between studies\n\n${s.agreement}\n` : "",
    (s.gaps || []).length ? `## Gaps\n\n${s.gaps.map(g => `- ${g}`).join("\n")}\n` : "",
    "## Selection", "",
    `${facts.identified} records identified, ${facts.duplicates} duplicate${facts.duplicates === 1 ? "" : "s"}, ${flow.screened} screened, ${flow.excluded} excluded (${flow.rows.filter(r => r.n).map(r => `${r.label}: ${r.n}`).join("; ")}), ${facts.selected} selected, ${facts.withText} with open-access full text.`, "",
    "## Limitations", "", ...scanLimits(project, facts).map(l => `- ${l}`), "",
    ...(facts.disclosure?.length ? ["## AI use disclosure", "", ...facts.disclosure.map(l => `- ${l}`), ""] : []),
    (s.next_steps || []).length ? `## To continue as a full review\n\n${s.next_steps.map(g => `- ${g}`).join("\n")}\n` : "",
    "## References", "", ...ids.map(cite), ""].join("\n");
}

// ------------------------------------------------------------------ cached answers
// Every AI answer is stored with a fingerprint of the exact prompt input. An example scan ships the answers
// recorded for its inputs; as long as the inputs are unchanged the answer is reused without a call. Edit the
// question, a criterion, a field or the search terms and the fingerprint changes: only those items need a call.
export function hashKey(str) {   // cyrb53: fast, synchronous, identical in the browser and node
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const scanKeys = {
  plan: p => hashKey(`plan\n${scanPlanPrompt(p)}`),
  search: (pq, eq, caps) => hashKey(`search\n${pq}\n${eq}\n${caps.pubmed}\n${caps.europepmc}`),
  screen: (p, r) => hashKey(`screen\n${screeningPrompt(p, [{ source: sourceBlock(r) }])}`),
  extract: (p, r, text, fields) => hashKey(`extract\n${extractionPrompt(p, [{ source: sourceBlock(r, text || "", 30000) }], fields)}`),
  summary: (p, papers) => hashKey(`summary\n${scanSummaryPrompt(p, papers)}`),
};

// ------------------------------------------------------------------ go deeper: when to go all in
// Advice on continuing the scan as a full review, from the purpose and from what the scan found, with per route
// the requirements of its guidance and whether this project already meets them. Sources: methods.js.
export function goDeeperAdvice(project, facts) {
  const p = project, purpose = p.protocol.purpose || "";
  const sources = new Set(p.records.map(r => String(r.source || "").toLowerCase()));
  const has = re => [...sources].some(s => re.test(s));
  const press = p.scan?.press || {};
  const sel = facts.selected || 0, withText = facts.withText || 0;
  const reasons = [];
  let rec = "scan";
  if (purpose === "map") { rec = "scoping"; reasons.push("You want to map what exists: a scoping review fits that purpose (JBI)."); }
  else if (purpose === "decision") { rec = "rapid"; reasons.push("The answer will inform a decision: a rapid review is the minimum when there is a deadline; a systematic review when there is time (Garritty 2024)."); }
  else if (purpose === "answer" || purpose === "update") { rec = "systematic"; reasons.push("You want a trustworthy answer to a focused question: that needs a systematic review (Cochrane Handbook, MECIR)."); }
  else reasons.push("For background and orientation the scan can be enough, as long as you report it as a scan with its limitations.");
  if (sel < 3) reasons.push(`Only ${sel} papers were selected: a broader search (more databases, more records) comes first before any conclusion.`);
  if (sel && withText < sel) reasons.push(`${sel - withText} of ${sel} selected papers were read from the abstract only.`);
  if (facts.calibration && facts.calibration.kappa < 0.8) reasons.push(`Your agreement with the AI was κ = ${facts.calibration.kappa.toFixed(2)} (< 0.8): a second human screener is advised.`);
  const s = p.scan?.search;
  if (s && (s.pubmed?.count > s.pubmed?.fetched)) reasons.push(`The search found ${s.pubmed.count} PubMed records of which only ${s.pubmed.fetched} were screened.`);

  const pressOk = !!press.reviewer;
  const step = id => `#/p/${p.id}/${id}`;
  const item = (text, done, src, href) => ({ text, done: !!done, src, href });
  const routes = [
    { id: "systematic", label: "Systematic review", items: [
      item("Register the protocol (e.g. PROSPERO, OSF) before searching further", false, SRC.prismaP, step("protocol")),
      item("Search CENTRAL, MEDLINE and Embase, and trial registers where relevant (MECIR C24, C27)", has(/embase/) && has(/central|cochrane/), SRC.mecir, step("search")),
      item("Peer review of the search by an information specialist (PRESS)", pressOk, SRC.press, step("search")),
      item("Two people decide on eligibility independently; full texts always by two (MECIR C39)", false, SRC.mecir, step("screening")),
      item("Full texts of all potentially eligible reports, also behind paywalls", sel && withText >= sel, SRC.prisma, step("fulltext")),
      item("Outcome data extracted by two people independently (MECIR C46)", false, SRC.mecir, step("extraction")),
      item("Risk of bias with a validated tool, by two people (MECIR C52-C53)", false, SRC.mecir, step("extraction")),
      item("PRISMA 2020 and PRISMA-S reporting; certainty of evidence (GRADE)", false, SRC.prisma, step("report")),
    ] },
    { id: "rapid", label: "Rapid review", items: [
      item("A protocol, registered where possible (rec. 2)", !!p.scan?.plan?.approved, SRC.rr2024, step("protocol")),
      item("At least two bibliographic databases, e.g. MEDLINE + Embase or CENTRAL (rec. 5)", has(/embase|central|cochrane|web of science|wos|psycinfo|cinahl/), SRC.rr2024, step("search")),
      item("PRESS peer review of the primary search (rec. 6)", pressOk, SRC.rr2024, step("search")),
      item("Two people screen ~20% independently; single screening if κ ≥ 0.8 (rec. 8-9)", false, SRC.rr2024, step("screening")),
      item("A second person verifies critical extracted data (rec. 12)", false, SRC.rr2024, step("extraction")),
      item("Risk of bias with a validated tool, verified by a second person (rec. 14-16)", false, SRC.rr2024, step("extraction")),
      item("Restricted methods and their limitations reported (rec. 24)", true, SRC.rr2024, step("report")),
    ] },
    { id: "scoping", label: "Scoping review", items: [
      item("An a priori protocol with population, concept and context", !!p.scan?.plan?.approved, SRC.jbiScoping, step("protocol")),
      item("A search broad enough for the scope, with an information specialist", pressOk, SRC.jbiScoping, step("search")),
      item("Selection by two or more reviewers independently, after a pilot (JBI Manual 10.2.6)", false, SRC.jbiManual, step("screening")),
      item("Charting piloted by at least two team members (JBI Manual 10.2.7)", false, SRC.jbiManual, step("extraction")),
      item("Report with PRISMA-ScR", false, SRC.prismaScR, step("report")),
    ] },
  ];
  return { recommended: rec, reasons, routes };
}
