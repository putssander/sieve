// Risk of bias / quality appraisal (MECIR C52-C53; Cochrane rapid review guidance rec. 14-16). A validated tool per
// study design; the AI drafts a judgement per domain with a verbatim quote, a person makes every judgement and a
// second person assesses independently (systematic review) or verifies (rapid review). Pure functions (node-tested).
// Domain names and judgement levels follow the published tools; the hints are short paraphrases, not tool text:
// use the full signalling questions of each tool (linked) when you judge.
import { sourceBlock } from "./prompts.js";
import { hashKey } from "./hash.js";

const str = d => (d ? { type: "string", description: d } : { type: "string" });
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

// tone: ok | warn | err | crit | none (status colours, always shown with the symbol and the label)
const L = (id, label, tone, sym) => ({ id, label, tone, sym });
const LOW = L("low", "Low", "ok", "+"), HIGH = L("high", "High", "err", "×"), UNCLEAR = L("unclear", "Unclear", "warn", "?");

export const ROB_TOOLS = {
  rob2: {
    id: "rob2", name: "RoB 2", for: "randomised trials",
    cite: "Sterne JAC et al. RoB 2: a revised tool for assessing risk of bias in randomised trials. BMJ 2019;366:l4898", url: "https://doi.org/10.1136/bmj.l4898", tool: "https://www.riskofbias.info/welcome/rob-2-0-tool",
    levels: [L("low", "Low risk", "ok", "+"), L("some", "Some concerns", "warn", "−"), L("high", "High risk", "err", "×")],
    domains: [
      { id: "D1", label: "Randomisation process", hint: "random sequence, allocation concealed, baseline differences that suggest a problem" },
      { id: "D2", label: "Deviations from intended interventions", hint: "awareness of assignment, deviations because of the trial context, appropriate analysis (e.g. intention to treat)" },
      { id: "D3", label: "Missing outcome data", hint: "outcome data for (nearly) all participants; if not, could missingness depend on the true value" },
      { id: "D4", label: "Measurement of the outcome", hint: "appropriate method, same in both groups, assessors aware of the intervention" },
      { id: "D5", label: "Selection of the reported result", hint: "analysed as pre-specified; result not selected from several measurements or analyses" },
    ],
    overallRule: "Low if all domains are low; high if any domain is high, or if several domains with some concerns together substantially lower confidence (your judgement); otherwise some concerns. You can override the proposed judgement.",
    overall(j) { const v = Object.values(j); if (!v.length || v.some(x => !x)) return null; return v.includes("high") ? "high" : v.every(x => x === "low") ? "low" : "some"; },
  },
  robinsI: {
    id: "robinsI", name: "ROBINS-I", for: "non-randomised studies of interventions",
    note: "The published 2016 version. A version 2 is available as a draft (riskofbias.info, Nov 2025: six domains, no 'no information' level).",
    cite: "Sterne JAC et al. ROBINS-I: a tool for assessing risk of bias in non-randomised studies of interventions. BMJ 2016;355:i4919", url: "https://doi.org/10.1136/bmj.i4919", tool: "https://www.riskofbias.info/welcome/home",
    levels: [L("low", "Low", "ok", "+"), L("moderate", "Moderate", "warn", "−"), L("serious", "Serious", "err", "×"), L("critical", "Critical", "crit", "!"), L("ni", "No information", "none", "?")],
    domains: [
      { id: "D1", label: "Confounding", hint: "important confounders measured and controlled for" },
      { id: "D2", label: "Selection of participants", hint: "selection into the study related to intervention and outcome; start of follow-up and intervention coincide" },
      { id: "D3", label: "Classification of interventions", hint: "intervention groups clearly defined and recorded at the start" },
      { id: "D4", label: "Deviations from intended interventions", hint: "deviations beyond usual practice, balanced co-interventions" },
      { id: "D5", label: "Missing data", hint: "outcome, intervention and confounder data for (nearly) all participants" },
      { id: "D6", label: "Measurement of outcomes", hint: "outcome measure comparable between groups, assessors aware of the intervention" },
      { id: "D7", label: "Selection of the reported result", hint: "result selected from several outcomes, analyses or subgroups" },
    ],
    overallRule: "The overall judgement is at least as severe as the most severe domain: low only if all domains are low; critical if any is critical; no information if information is missing in a key domain and nothing points to serious or critical.",
    overall(j) {
      const v = Object.values(j); if (!v.length || v.some(x => !x)) return null;
      for (const lv of ["critical", "serious"]) if (v.includes(lv)) return lv;
      return v.includes("ni") ? "ni" : v.includes("moderate") ? "moderate" : "low";
    },
  },
  quadas2: {
    id: "quadas2", name: "QUADAS-2", for: "diagnostic accuracy studies",
    note: "Superseded by QUADAS-3 (Whiting PF et al. Ann Intern Med 2026, doi 10.7326/ANNALS-25-02104); QUADAS-2 is offered until QUADAS-3 is added.",
    cite: "Whiting PF et al. QUADAS-2: a revised tool for the quality assessment of diagnostic accuracy studies. Ann Intern Med 2011;155:529-36", url: "https://doi.org/10.7326/0003-4819-155-8-201110180-00009", tool: "https://www.bristol.ac.uk/population-health-sciences/projects/quadas/quadas-2/",
    levels: [LOW, HIGH, UNCLEAR],
    domains: [
      { id: "D1", label: "Patient selection", hint: "consecutive or random sample, case-control design avoided, inappropriate exclusions avoided", applicability: true },
      { id: "D2", label: "Index test", hint: "interpreted without knowledge of the reference standard; threshold pre-specified", applicability: true },
      { id: "D3", label: "Reference standard", hint: "likely to classify the target condition correctly; interpreted without knowledge of the index test", applicability: true },
      { id: "D4", label: "Flow and timing", hint: "appropriate interval, same reference standard for all, all patients included in the analysis" },
    ],
    overallRule: "No summary score: low risk of bias only if every domain is low; if one or more domains are high or unclear the study may be judged at risk of bias. Applicability concerns are judged separately for the first three domains.",
    overallLevels: [L("low", "Low risk of bias", "ok", "+"), L("atrisk", "At risk of bias", "err", "×")],
    overall(j) { const v = Object.values(j); if (!v.length || v.some(x => !x)) return null; return v.every(x => x === "low") ? "low" : "atrisk"; },
  },
  probastAI: {
    id: "probastAI", name: "PROBAST+AI", for: "prediction model studies (regression or AI)",
    note: "Two parts: model development is judged for quality concerns, model evaluation for risk of bias, each with applicability. External validation studies: the evaluation part only; development studies usually both parts. Record which part in the notes.",
    cite: "Moons KGM et al. PROBAST+AI: an updated quality, risk of bias, and applicability assessment tool for prediction models using regression or artificial intelligence methods. BMJ 2025;388:e082505", url: "https://doi.org/10.1136/bmj-2024-082505", tool: "https://www.probast.org/",
    levels: [LOW, HIGH, UNCLEAR],
    domains: [
      { id: "D1", label: "Participants and data sources", hint: "appropriate data sources; inclusions and exclusions appropriate", applicability: true },
      { id: "D2", label: "Predictors", hint: "defined and assessed in the same way for all participants, without knowledge of the outcome, available at the moment of use", applicability: true },
      { id: "D3", label: "Outcome", hint: "appropriate, pre-specified and defined the same way for all; determined without knowledge of the predictors", applicability: true },
      { id: "D4", label: "Analysis", hint: "enough participants with the outcome, missing data and overfitting handled, performance (calibration and discrimination) evaluated appropriately" },
    ],
    overallRule: "Combine the four domain ratings into the overall judgement (low, high or unclear) as the tool describes; applicability is judged separately. Sieve does not apply a rule here: you choose.",
    overall: () => null,
  },
  jbiQual: {
    id: "jbiQual", name: "JBI checklist for qualitative research", for: "qualitative studies",
    cite: "JBI Critical Appraisal Checklist for Qualitative Research (2024). Porritt K, Evans C, … Lockwood C. Systematic reviews of qualitative evidence. In: JBI Manual for Evidence Synthesis. JBI; 2024", url: "https://jbi.global/critical-appraisal-tools", tool: "https://jbi.global/critical-appraisal-tools",
    levels: [L("yes", "Yes", "ok", "+"), L("no", "No", "err", "×"), L("unclear", "Unclear", "warn", "?")],
    domains: [
      { id: "Q1", label: "Philosophical or theoretical position ↔ methodology", hint: "the philosophical or theoretical positioning fits the methodological approach" },
      { id: "Q2", label: "Methodology ↔ question", hint: "the methodology fits the research question or objectives" },
      { id: "Q3", label: "Methodology ↔ data collection", hint: "the methodology fits the methods used to collect data" },
      { id: "Q4", label: "Methodology ↔ analysis", hint: "the methodology fits how data are represented and analysed" },
      { id: "Q5", label: "Methodology ↔ interpretation", hint: "the methodology fits how results are interpreted" },
      { id: "Q6", label: "Researcher located", hint: "a statement locating the researcher culturally or theoretically" },
      { id: "Q7", label: "Researcher influence", hint: "the influence of the researcher on the research, and vice versa, is addressed" },
      { id: "Q8", label: "Participants' voices", hint: "participants and their voices are adequately represented" },
      { id: "Q9", label: "Ethics", hint: "ethical according to current criteria, or evidence of ethical approval" },
      { id: "Q10", label: "Conclusions flow from data", hint: "conclusions follow from the analysis or interpretation of the data" },
    ],
    overallRule: "No score: the reviewers decide together to include, exclude or seek further information, using criteria set in the protocol.",
    overallLevels: [L("include", "Include", "ok", "+"), L("exclude", "Exclude", "err", "×"), L("seek", "Seek further info", "warn", "?")],
    overall: () => null,
  },
};

export const toolOf = id => ROB_TOOLS[id] || null;
export const levelOf = (tool, id, overall = false) => (overall && tool.overallLevels ? tool.overallLevels : tool.levels).find(l => l.id === id) || null;

// A starting suggestion from the protocol; the study design decides per study (the person can change it).
export function suggestTool(project) {
  const p = project.protocol;
  const text = `${p.question} ${p.elements.map(e => e.text).join(" ")} ${project.criteria.map(c => `${c.label} ${c.description}`).join(" ")}`.toLowerCase();
  if (/\bqualitative|experience|perception|perspective|meaning\b/.test(text) || ["PICo", "SPIDER"].includes(p.framework)) return "jbiQual";
  if (/diagnos|accuracy|sensitivity|specificity|index test/.test(text)) return "quadas2";
  if (/predict|prognos|risk model|machine learning model|ai model/.test(text)) return "probastAI";
  if (/randomi[sz]ed|\brct\b|trial/.test(text)) return "rob2";
  if (/cohort|case-control|observational|non-randomi/.test(text)) return "robinsI";
  return p.framework === "PICO" ? "rob2" : "jbiQual";
}

export const SYSTEM_ROB = "You are an experienced systematic reviewer trained in risk-of-bias and critical appraisal tools. You judge only from what the paper reports, quote it verbatim, and return ONLY JSON matching the requested schema.";

export function robSchema(tool) {
  const ids = tool.levels.map(l => l.id);
  const dom = obj({ judgement: { type: "string", enum: ids }, quote: str("<= 40 words verbatim from the paper that supports the judgement, or empty"), rationale: str("one or two sentences") });
  const props = {
    id: str("PAPER_ID exactly as given"),
    design: str("the study design in a few words"),
    tool_fits: { type: "boolean", description: `true if ${tool.name} fits this design (${tool.for})` },
    domains: obj(Object.fromEntries(tool.domains.map(d => [d.id, dom]))),
  };
  const appl = tool.domains.filter(d => d.applicability);
  if (appl.length) props.applicability = obj(Object.fromEntries(appl.map(d => [d.id, { type: "string", enum: ["low", "high", "unclear"] }])));
  props.overall = { type: "string", enum: (tool.overallLevels || tool.levels).map(l => l.id) };
  props.overall_rationale = str();
  return obj(props);
}

export function robPrompt(project, tool, rec, text = "") {
  const levels = tool.levels.map(l => `"${l.id}" = ${l.label}`).join(", ");
  return `Assess this study with ${tool.name} (${tool.for}). ${tool.cite}.
Review question: ${project.protocol.question}

Judge every domain from what the paper reports. For each domain give the judgement (${levels}), a verbatim quote of at most 40 words that supports it (empty if the paper says nothing; then the judgement is usually the "no information"/"unclear" level), and a one- or two-sentence rationale.
Domains:
${tool.domains.map(d => `- ${d.id} ${d.label}: ${d.hint}${d.applicability ? " (also judge applicability concerns to the review question: low/high/unclear)" : ""}`).join("\n")}
Overall: ${tool.overallRule}
If the design does not fit ${tool.name}, set tool_fits to false and still fill in what you can.

${sourceBlock(rec, text, 40000)}

Return JSON {"id", "design", "tool_fits", "domains": {${tool.domains.map(d => `"${d.id}": {"judgement", "quote", "rationale"}`).join(", ")}}${tool.domains.some(d => d.applicability) ? ', "applicability": {...}' : ""}, "overall", "overall_rationale"}.`;
}

export const robKey = (project, tool, rec, text) => hashKey(`rob\n${robPrompt(project, tool, rec, text)}`);

// The person's judgement is complete when every domain (and the overall) is set.
export function robComplete(tool, a) {
  if (!a) return false;
  return tool.domains.every(d => a.domains?.[d.id]) && !!(a.overall || tool.overall(a.domains || {}));
}

// Counts per domain and level for the summary bars (robvis-style "summary plot").
export function robSummary(tool, assessments) {
  return tool.domains.map(d => {
    const n = Object.fromEntries(tool.levels.map(l => [l.id, 0]));
    for (const a of assessments) { const j = a?.domains?.[d.id]; if (j && j in n) n[j]++; }
    return { id: d.id, label: d.label, n, total: Object.values(n).reduce((s, x) => s + x, 0) };
  });
}

// Agreement between two people on the domain judgements (exact level), for the second-reviewer check.
export function robAgreement(tool, a, b) {
  let same = 0, n = 0;
  const diff = [];
  for (const d of tool.domains) {
    const x = a?.domains?.[d.id], y = b?.domains?.[d.id];
    if (!x || !y) continue;
    n++;
    if (x === y) same++; else diff.push(d.id);
  }
  return { n, same, diff };
}
