// Certainty of the evidence per outcome or finding: GRADE for effects (Cochrane Handbook ch. 14; GRADE Handbook) and
// GRADE-CERQual for findings of qualitative evidence syntheses (Lewin et al. 2018). Cochrane rapid review guidance
// rec. 21-23. The AI drafts a rating per domain with its reason; the person decides, and every downgrade carries an
// explanation (a footnote in the summary-of-findings table). Pure functions (node-tested).
import { hashKey } from "./hash.js";

const str = d => (d ? { type: "string", description: d } : { type: "string" });
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = items => ({ type: "array", items });

export const CERTAINTY_SOURCES = {
  grade: { name: "GRADE", cite: "Schünemann H, Brożek J, Guyatt G, Oxman A (eds). GRADE Handbook, 2013; Cochrane Handbook ch. 14 (Schünemann HJ et al.)", url: "https://gdt.gradepro.org/app/handbook/handbook.html" },
  handbook14: { name: "Cochrane Handbook ch. 14", cite: "Completing 'Summary of findings' tables and grading the certainty of the evidence, version 6.5, 2024", url: "https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-14" },
  grade18: { name: "GRADE guidelines 18", cite: "Schünemann HJ et al. GRADE guidelines: 18. How ROBINS-I and other tools to assess risk of bias in nonrandomized studies should be used to rate the certainty of a body of evidence. J Clin Epidemiol 2019;111:105-14", url: "https://doi.org/10.1016/j.jclinepi.2018.01.012" },
  cerqual: { name: "GRADE-CERQual", cite: "Lewin S et al. Applying GRADE-CERQual to qualitative evidence synthesis findings. Implement Sci 2018;13(Suppl 1):2", url: "https://doi.org/10.1186/s13012-017-0688-3" },
};

export const LEVELS = [
  { id: "high", label: "High", n: 4, sym: "⊕⊕⊕⊕" },
  { id: "moderate", label: "Moderate", n: 3, sym: "⊕⊕⊕◯" },
  { id: "low", label: "Low", n: 2, sym: "⊕⊕◯◯" },
  { id: "very_low", label: "Very low", n: 1, sym: "⊕◯◯◯" },
];
export const levelById = id => LEVELS.find(l => l.id === id) || null;

// GRADE: five reasons to rate down, three to rate up.
export const GRADE_DOWN = [
  { id: "risk_of_bias", label: "Risk of bias", options: ["not_serious", "serious", "very_serious", "very_very_serious"] },
  { id: "inconsistency", label: "Inconsistency", options: ["not_serious", "serious", "very_serious"] },
  { id: "indirectness", label: "Indirectness", options: ["not_serious", "serious", "very_serious"] },
  { id: "imprecision", label: "Imprecision", options: ["not_serious", "serious", "very_serious"] },
  { id: "publication_bias", label: "Publication bias", options: ["undetected", "strongly_suspected"] },
];
export const GRADE_UP = [
  { id: "large_effect", label: "Large effect", max: 2 },
  { id: "dose_response", label: "Dose-response gradient", max: 1 },
  { id: "confounding", label: "Plausible confounding would reduce the effect", max: 1 },
];
const STEPS = { not_serious: 0, undetected: 0, serious: 1, strongly_suspected: 1, very_serious: 2, very_very_serious: 3 };
export const ratingLabel = r => ({ not_serious: "not serious", serious: "serious (−1)", very_serious: "very serious (−2)", very_very_serious: "very, very serious (−3, ROBINS-I start)", undetected: "undetected", strongly_suspected: "strongly suspected (−1)" }[r] || r || "–");

// Randomised trials start high; non-randomised studies start low, or high when risk of bias was assessed with
// ROBINS-I (GRADE guidelines 18), where the risk-of-bias domain then carries the rating down: usually two levels, and
// a third level is needed to reach very low (GRADE 18). Cochrane ch. 14: sound non-randomised studies are generally
// still graded low; not rating them down from high needs a detailed justification.
export const GRADE_START = [
  { id: "rct", label: "Randomised trials: start high", level: 4 },
  { id: "nrs_robins", label: "Non-randomised, assessed with ROBINS-I: start high, rate down for risk of bias (usually 2-3 levels)", level: 4 },
  { id: "observational", label: "Observational studies: start low", level: 2 },
];

export function gradeLevel(start, down = {}, up = {}) {
  const s = GRADE_START.find(x => x.id === start)?.level ?? 4;
  const minus = GRADE_DOWN.reduce((n, d) => n + (STEPS[down[d.id]] || 0), 0);
  const plus = GRADE_UP.reduce((n, u) => n + Math.min(u.max, Number(up[u.id]) || 0), 0);
  const n = Math.max(1, Math.min(4, s - minus + plus));
  return LEVELS.find(l => l.n === n).id;
}

// GRADE-CERQual: four components, each with a level of concern; the overall confidence starts from the assumption
// that the finding is a reasonable representation of the phenomenon (high confidence) and is a judgement, not a sum.
export const CERQUAL_COMPONENTS = [
  { id: "methodological_limitations", label: "Methodological limitations" },
  { id: "coherence", label: "Coherence" },
  { id: "adequacy", label: "Adequacy of data" },
  { id: "relevance", label: "Relevance" },
];
export const CONCERNS = ["none_or_very_minor", "minor", "moderate", "serious"];
export const concernLabel = c => ({ none_or_very_minor: "no or very minor", minor: "minor", moderate: "moderate", serious: "serious" }[c] || c || "–");

// Which approach fits: qualitative findings → CERQual, effects → GRADE.
export function certaintyApproach(project) {
  const robTool = project.rob?.tool;
  if (robTool === "jbiQual" || ["PICo", "SPIDER"].includes(project.protocol.framework)) return "cerqual";
  return "grade";
}

export const SYSTEM_CERTAINTY = "You are a GRADE and GRADE-CERQual methodologist. You rate the certainty of evidence conservatively from the data given, explain every judgement, and return ONLY JSON matching the requested schema.";

export function certaintySchema(approach) {
  const reason = str("why, citing paper ids; empty only when there is no concern");
  if (approach === "cerqual") return obj({ results: arr(obj({
    finding: str("the finding exactly as given"),
    components: obj(Object.fromEntries(CERQUAL_COMPONENTS.map(c => [c.id, obj({ concern: { type: "string", enum: CONCERNS }, reason })]))),
    confidence: { type: "string", enum: LEVELS.map(l => l.id) },
    explanation: str("one or two sentences explaining the overall confidence"),
  })) });
  return obj({ results: arr(obj({
    finding: str("the outcome or finding exactly as given"),
    start: { type: "string", enum: GRADE_START.map(s => s.id) },
    down: obj(Object.fromEntries(GRADE_DOWN.map(d => [d.id, obj({ rating: { type: "string", enum: d.options }, reason })]))),
    up: obj(Object.fromEntries(GRADE_UP.map(u => [u.id, { type: "integer", minimum: 0, maximum: u.max }]))),
    certainty: { type: "string", enum: LEVELS.map(l => l.id) },
    explanation: str("one or two sentences explaining the certainty"),
  })) });
}

// findings: [{finding, paper_ids}], papers: [{rid, cite, lines, rob}] (rob = the person's overall judgement).
export function certaintyPrompt(project, approach, findings, papers) {
  const head = approach === "cerqual"
    ? `Assess confidence in each review finding with GRADE-CERQual (${CERTAINTY_SOURCES.cerqual.cite}). For each of the four components (methodological limitations, coherence, adequacy of data, relevance) give the level of concern (none_or_very_minor, minor, moderate, serious) with a reason. Start from the assumption that each finding is a reasonable representation of the phenomenon (high confidence) and move down for important concerns; the overall confidence is a judgement, not a sum.`
    : `Rate the certainty of the evidence for each outcome or finding with GRADE (${CERTAINTY_SOURCES.grade.cite}). Choose the starting level (randomised trials high; non-randomised studies low, or high when assessed with ROBINS-I), then rate down for risk of bias, inconsistency, indirectness, imprecision and publication bias, and rate up only for a large effect, a dose-response gradient or plausible confounding that would reduce the effect. Give a reason for every rating down.`;
  return `${head}
Use only the data below. Be conservative: few, small or abstract-only studies usually mean serious imprecision or inadequate data.

Question: ${project.protocol.question}

FINDINGS:
${findings.map((f, i) => `${i + 1}. ${f.finding} [${(f.paper_ids || []).join(", ")}]`).join("\n")}

PAPERS:
${papers.map(x => `=== [${x.rid}] ${x.cite}\n${x.rob ? `Risk of bias / appraisal (by the reviewer): ${x.rob}\n` : ""}${x.lines.join("\n")}`).join("\n\n")}

Return JSON {"results": [one object per finding, in the same order]}.`;
}

export const certaintyKey = (project, approach, findings, papers) => hashKey(`certainty\n${certaintyPrompt(project, approach, findings, papers)}`);

// Footnotes for the summary-of-findings table: one per rating down / per component with a concern.
export function footnotes(approach, a) {
  if (!a) return [];
  if (approach === "cerqual") return CERQUAL_COMPONENTS.filter(c => a.components?.[c.id]?.concern && a.components[c.id].concern !== "none_or_very_minor")
    .map(c => `${c.label}: ${concernLabel(a.components[c.id].concern)} concerns. ${a.components[c.id].reason || ""}`.trim());
  return [...GRADE_DOWN.filter(d => STEPS[a.down?.[d.id]?.rating]).map(d => `${d.label}: ${ratingLabel(a.down[d.id].rating)}. ${a.down[d.id].reason || ""}`.trim()),
    ...GRADE_UP.filter(u => Number(a.up?.[u.id])).map(u => `Rated up: ${u.label} (+${a.up[u.id]}).`)];
}

// Markdown summary-of-findings table.
export function sofMarkdown(approach, rows) {
  const notes = [];
  const lines = approach === "cerqual"
    ? ["| Finding | Studies | Confidence (GRADE-CERQual) | Explanation |", "|---|---|---|---|"]
    : ["| Outcome / finding | Studies | Certainty (GRADE) | Explanation |", "|---|---|---|---|"];
  for (const r of rows) {
    const fn = footnotes(approach, r.a).map(t => { notes.push(t); return notes.length; });
    const lv = levelById(r.a?.final || r.a?.certainty || r.a?.confidence);
    lines.push(`| ${r.finding} | ${(r.paper_ids || []).length} | ${lv ? `${lv.sym} ${lv.label}` : "not rated"}${fn.length ? ` ${fn.map(n => `^${n}^`).join("")}` : ""} | ${r.a?.explanation || ""} |`);
  }
  return [...lines, "", ...notes.map((t, i) => `${i + 1}. ${t}`)].join("\n");
}
