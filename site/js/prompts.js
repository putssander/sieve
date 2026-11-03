// The single source of truth for every LLM task: prompt text + JSON schema.
// The same builders feed the API backends, the copy-paste chat panel and the job files for
// the Python runner (Colab / local GPU), so results from all routes are comparable.

export const DECISIONS = ["Include", "Exclude", "Exclude, but save for snowballing", "Unclear"];
export const SYSTEM_SCREEN = "You are a careful systematic-review screening assistant. You screen papers against fixed eligibility criteria and return ONLY JSON matching the requested schema.";
export const SYSTEM_EXTRACT = "You are a careful systematic-review data-extraction assistant. You extract only what the paper reports, with short verbatim quotes as evidence, and return ONLY JSON matching the requested schema.";
export const SYSTEM_SEARCH = "You are an expert information specialist who builds and peer-reviews (PRESS) systematic search strategies. Return ONLY JSON matching the requested schema.";

const str = (description) => (description ? { type: "string", description } : { type: "string" });
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items) => ({ type: "array", items });
const batch = (item) => obj({ results: arr(item) });

// ------------------------------------------------------------------ source material
export function sourceBlock(rec, text = "", maxChars = 16000) {
  const lines = [
    `PAPER_ID: ${rec.rid}`,
    `TITLE: ${rec.title || ""}`,
    rec.year && `YEAR: ${rec.year}`,
    rec.authors && `AUTHORS: ${String(rec.authors).slice(0, 300)}`,
    rec.journal && `JOURNAL: ${rec.journal}`,
    rec.doi && `DOI: ${rec.doi}`,
    `ABSTRACT: ${rec.abstract || "(no abstract available)"}`,
  ];
  if (text) lines.push(`FULL_TEXT_EXCERPT: ${text.slice(0, maxChars)}`);
  return lines.filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ screening
export function screeningSchema(project) {
  const ids = project.criteria.map(c => c.id);
  const decisions = project.criteria.some(c => c.fail_decision === DECISIONS[2]) ? DECISIONS : DECISIONS.filter(d => d !== DECISIONS[2]);
  return obj({
    id: str("PAPER_ID exactly as given"),
    decision: { type: "string", enum: decisions },
    criteria: obj(Object.fromEntries(ids.map(id => [id, { type: "string", enum: ["Yes", "No", "Unclear"] }]))),
    failed_criteria: arr(obj({ criterion: { type: "string", enum: ids }, evidence_quote: str("<= 25 words, verbatim from the source"), interpretation: str() })),
    primary_exclusion_reason: str("Single main reason; 'N/A' if included"),
    eligibility_evidence: str("If included: one short paragraph with short verbatim quotes per criterion; otherwise ''"),
    screening_note: str(),
    needs_human_review: { type: "boolean" },
  });
}

function criteriaText(project) {
  return project.criteria.map((c, i) => `${i + 1}. [${c.id}] ${c.label}: ${c.description}${c.fail_decision === DECISIONS[2] ? ` (if this fails: decision "${DECISIONS[2]}")` : ""}`).join("\n");
}

const SCREEN_RULES = `General rules:
- Judge each criterion as Yes / No / Unclear from the source material only.
- decision: Include only if every criterion is Yes. If any criterion is No, exclude (use the decision named in that criterion if given). If none is No but some are Unclear, use "Unclear" and set needs_human_review=true.
- failed_criteria: only criteria that are No or Unclear, each with a SHORT verbatim quote (<= 25 words) copied from the source. If there is no exact quote, write "No direct quote available in provided source material." and set needs_human_review=true.
- Be transparent when only the title/abstract is available.`;

export function screeningPrompt(project, items, { attachments = false } = {}) {
  const p = project.protocol;
  const many = items.length > 1;
  return `${many ? `Screen the ${items.length} papers below` : "Screen the paper below"} for a ${p.review_type || "systematic"} review.

Review question: ${p.question || "(see criteria)"}

Eligibility criteria:
${criteriaText(project)}

${SCREEN_RULES}
${project.screening_rules ? `\nReview-specific rules:\n${project.screening_rules}\n` : ""}${attachments ? "\nThe full texts are attached as PDF files; each file name starts with the PAPER_ID. Use them in addition to the metadata below.\n" : ""}
${many ? `Return JSON {"results": [...]} with one object per paper, in the same order` : "Return one JSON object"} with exactly these keys: id, decision, criteria{${project.criteria.map(c => c.id).join(", ")}}, failed_criteria[{criterion, evidence_quote, interpretation}], primary_exclusion_reason, eligibility_evidence, screening_note, needs_human_review.

${items.map(it => `=== PAPER ===\n${it.source}`).join("\n\n")}`;
}

export const screeningBatchSchema = project => batch(screeningSchema(project));

// ------------------------------------------------------------------ extraction
export function applicableFields(project, rec) {
  const ex = project.extraction;
  const until = Number(ex.core_until_year || 0);
  if (until && Number(rec.year) && Number(rec.year) <= until) return ex.fields.filter(f => f.core);
  return ex.fields;
}

export function extractionSchema(fields) {
  return obj({
    id: str("PAPER_ID exactly as given"),
    fields: obj(Object.fromEntries(fields.map(f => [f.id, obj({ value: str(), quote: str("short verbatim quote supporting the value, or ''") })]))),
    notes: str(),
  });
}

function fieldText(f, markCore) {
  const bits = [`- ${f.id}${markCore && f.core ? " *" : ""}: ${f.label}`];
  if (f.description && f.description !== f.label) bits.push(` — ${f.description}`);
  if (f.type === "number") bits.push(" (number as reported, e.g. 0.82 or 82%)");
  if (f.type === "yesno") bits.push(" (Yes / No)");
  if (f.options?.length) bits.push(f.type === "enum" ? ` (choose from: ${f.options.join(" | ")}; several allowed, separated by '; ')` : ` (e.g. ${f.options.join(", ")})`);
  if (f.group) bits.push(` [${f.group}]`);
  return bits.join("");
}

export function extractionPrompt(project, items, fields, { attachments = false } = {}) {
  const many = items.length > 1;
  const markCore = items.some(it => it.coreOnly);
  return `Extract data from ${many ? `the ${items.length} included papers below` : "the included paper below"} for a ${project.protocol.review_type || "systematic"} review.

Review question: ${project.protocol.question || ""}

Fields to extract (use the field id as JSON key):
${fields.map(f => fieldText(f, markCore)).join("\n")}

Rules:
- Extract only what the paper reports. Use "NR" when not reported and "NA" when not applicable.
- Give a short verbatim quote (<= 30 words) for every value that is not NR/NA.
- Several values for one field: separate them with "; ".
${markCore ? '- Papers marked CORE_ONLY: yes need only the fields marked *; give the other fields the value "NA".\n' : ""}${project.extraction.instructions ? `- ${project.extraction.instructions}\n` : ""}${attachments ? "\nThe full texts are attached as PDF files; each file name starts with the PAPER_ID. Prefer the full text over the abstract.\n" : ""}
${many ? `Return JSON {"results": [...]} with one object per paper` : "Return one JSON object"}: {"id": PAPER_ID, "fields": {field_id: {"value": ..., "quote": ...}, ...}, "notes": ...}.

${items.map(it => `=== PAPER ===\n${it.coreOnly ? "CORE_ONLY: yes\n" : ""}${it.source}`).join("\n\n")}`;
}

export const extractionBatchSchema = fields => batch(extractionSchema(fields));

// ------------------------------------------------------------------ search assistance
export const searchBlocksSchema = obj({
  blocks: arr(obj({ label: str(), role: { type: "string", enum: ["include", "exclude"] }, terms: arr(str("one PubMed term, e.g. \"machine learning\"[tiab] or Artificial Intelligence[Mesh]")) })),
  notes: str(),
});

export function searchFromProtocolPrompt(project) {
  const p = project.protocol;
  return `Draft a PubMed search strategy for this review as concept blocks.

Review question: ${p.question}
${p.elements.filter(e => e.text).map(e => `${e.label}: ${e.text}`).join("\n")}
${project.criteria.length ? `\nEligibility criteria:\n${criteriaText(project)}\n` : ""}
Rules:
- One block per concept that every relevant record must match (combined with AND). Add exclusion blocks (role "exclude") for publication types such as reviews/editorials only if the criteria exclude them.
- Each term is one line of PubMed syntax: "phrase"[tiab], word*[tiab], Heading[Mesh], word[ti].
- For "X near Y" ideas you may use the macro NEAR/4(a | b | c ; x | y | z)[tiab].
- Prefer specific vocabulary over generic words that cause noise (e.g. avoid bare "integration*" or "model*").
Return JSON {"blocks": [{"label", "role", "terms": [...]}], "notes": "..."}.`;
}

export const suggestSchema = obj({
  suggestions: arr(obj({ block: str("label of the block to change"), action: { type: "string", enum: ["add", "remove"] }, term: str("PubMed syntax"), reason: str() })),
  notes: str(),
});

export function suggestTermsPrompt(project, blocks, missed, stats) {
  return `Help me tune a PubMed search string. Recall is measured on a validation set of known relevant articles.

Review question: ${project.protocol.question}

Current concept blocks (AND between include blocks, NOT for exclude blocks):
${blocks.filter(b => b.enabled !== false).map(b => `## ${b.label} (${b.role || "include"})\n${b.terms.join("\n")}`).join("\n\n")}

${stats ? `Current result: ${stats}\n` : ""}
Validation articles the string MISSES (with the blocks they fail):
${missed.length ? missed.map(m => `- PMID ${m.pmid}: ${m.title}\n  fails: ${m.fails.join(", ") || "?"}\n  MeSH: ${(m.mesh || []).join("; ")}\n  abstract: ${(m.abstract || "").slice(0, 700)}`).join("\n") : "(none — focus on removing noise without losing recall)"}

Suggest specific terms to add (to recover the missed articles) or to remove (to cut noise). Avoid generic words. Return JSON {"suggestions": [{"block", "action", "term", "reason"}], "notes"}.`;
}

export const titleJudgeSchema = batch(obj({ id: str(), judgement: { type: "string", enum: ["yes", "maybe", "no"] }, reason: str() }));

export function titleJudgePrompt(project, recs) {
  return `Quick precision check of a search result. Judge each title only: "yes" = likely eligible, "maybe" = unclear, "no" = clearly not eligible.

Review question: ${project.protocol.question}
${project.criteria.length ? `Criteria:\n${criteriaText(project)}\n` : ""}
Return JSON {"results": [{"id", "judgement", "reason"}]} for every title.

${recs.map(r => `${r.pmid}: ${r.title}`).join("\n")}`;
}

export const protocolSchema = obj({
  question: str(),
  elements: arr(obj({ key: str("P, I, C, O, or Co, S, ..."), label: str(), text: str() })),
  criteria: arr(obj({ label: str(), description: str() })),
  notes: str(),
});

export function protocolFromDocPrompt(docText) {
  return `Read this research document (protocol, PICO form, proposal or ticket) and draft the review protocol fields: the review question, the PICO (or PICo/SPIDER) elements, and eligibility criteria that a screener can apply to a title/abstract. Keep the document's language for the labels if it is not English, but write criteria in English.
Return JSON {"question", "elements": [{"key", "label", "text"}], "criteria": [{"label", "description"}], "notes"}.

=== DOCUMENT ===
${docText.slice(0, 30000)}`;
}
