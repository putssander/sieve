// Suggestions orient the researcher; the question and agreed protocol determine the final method.
export const FRAMEWORKS = {
  PICO: [["P", "Population / problem"], ["I", "Intervention / exposure"], ["C", "Comparison"], ["O", "Outcome"]],
  PICo: [["P", "Population"], ["I", "Phenomenon of interest"], ["Co", "Context"]],
  SPIDER: [["S", "Sample"], ["PI", "Phenomenon of interest"], ["D", "Design"], ["E", "Evaluation"], ["R", "Research type"]],
  PCC: [["P", "Population"], ["C", "Concept"], ["C2", "Context"]],
  Open: [],
};

export const PURPOSES = [
  { id: "answer", icon: "search", label: "Answer a focused question", hint: "Does it work? How well?", suggested: "systematic" },
  { id: "map", icon: "general", label: "Map a field", hint: "What exists? Where are the gaps?", suggested: "scoping" },
  { id: "background", icon: "fulltext", label: "Build a foundation", hint: "Put my own study in context", suggested: "narrative" },
  { id: "decision", icon: "verify", label: "Support a decision", hint: "Inform practice, policy or a guideline", suggested: "systematic" },
  { id: "update", icon: "clock", label: "Keep evidence current", hint: "Update an existing review", suggested: "systematic" },
];

export const REVIEW_TYPES = {
  systematic: {
    label: "Systematic review", short: "Answer a defined question with a transparent, planned method.", framework: "PICO",
    why: "A good starting point when you need a focused answer and an assessment of how trustworthy the evidence is.",
    question: "PICO means Population, Intervention, Comparison and Outcome, and often fits intervention questions. PICo means Population, phenomenon of Interest and Context, and may suit experiences. Other questions may need a different framework.",
    work: "Search broadly, apply agreed eligibility rules, assess study limitations and synthesise findings. Pool results only when the studies and data support it; meta-analysis is not automatic.",
    appraisal: "Plan a study-appropriate quality or risk-of-bias assessment. Complete it outside Sieve’s current dedicated tools and record your approach.",
    reporting: "PRISMA 2020; add a question-specific extension where appropriate.", checklist: "https://www.prisma-statement.org/prisma-2020",
  },
  scoping: {
    label: "Scoping review", short: "Map the scope, concepts and gaps in a body of research.", framework: "PCC",
    why: "A good starting point when you want to understand what has been studied and how, rather than estimate one overall effect.",
    question: "PCC: Population, Concept and Context. This helps you define a broad but bounded topic.",
    work: "Use a planned search and selection process, chart study characteristics and map patterns or gaps. A broad question still needs clear boundaries.",
    appraisal: "Formal quality appraisal is not normally required; include it if your aims call for it and explain why.",
    reporting: "PRISMA-ScR, the reporting checklist for scoping reviews.", checklist: "https://www.prisma-statement.org/scoping",
  },
  narrative: {
    label: "Narrative review", short: "Build understanding and place an idea or study in context.", framework: "Open",
    why: "A possible fit for a background chapter or conceptual discussion when an exhaustive, formal evidence synthesis is not your aim.",
    question: "Start with an open question. Use a framework if it helps clarify your scope.",
    work: "Explain how you chose literature and organised the discussion. A narrative review should be thoughtful and critical; avoid claiming an exhaustive search without the methods to support it.",
    appraisal: "Discuss strengths and limitations of the evidence. The formal appraisal approach depends on your question and discipline.",
    reporting: "Describe your approach clearly and follow your discipline or journal’s guidance.",
  },
  rapid: {
    label: "Rapid review", short: "Provide a timely answer using explicit, streamlined methods.", framework: "PICO",
    why: "Consider this when a decision has a real deadline and your team can justify which methods to streamline.",
    question: "Usually a focused question. For intervention decisions, PICO asks about Population, Intervention, Comparison and Outcome.",
    work: "Agree and document limits or shortcuts in advance, and explain their implications. A systematic review completed quickly with AI is not automatically a rapid review.",
    appraisal: "Plan an appropriate appraisal method and explain any streamlining. A deadline does not remove the need to assess trustworthiness.",
    reporting: "Use appropriate PRISMA guidance and explicitly report the streamlined methods.", checklist: "https://www.prisma-statement.org/prisma-2020",
  },
  umbrella: {
    label: "Umbrella review", short: "Bring together findings from existing reviews.", framework: "PICO",
    why: "Consider this when several relevant reviews already exist and you need an overview of their findings.",
    question: "Define which existing reviews address your question. For intervention topics, specify the Population, Intervention, Comparison and Outcome (PICO).",
    work: "Search for reviews, assess their quality and consider overlap: the same primary study can appear in more than one review.",
    appraisal: "Appraise the included reviews using an appropriate review-level tool; record overlapping evidence.",
    reporting: "Use overview-of-reviews reporting guidance appropriate to your field.",
  },
};

export const QUESTION_EXAMPLES = [
  { id: "writing", name: "Education", question: "Do peer writing groups improve doctoral students’ writing confidence compared with working alone?", purpose: "answer", type: "systematic" },
  { id: "implementation", name: "Health & technology", question: "How are implementation frameworks used to introduce AI in hospitals, and where are the research gaps?", purpose: "map", type: "scoping" },
  { id: "climate", name: "Climate & cities", question: "What approaches have cities studied to protect older adults during heatwaves?", purpose: "map", type: "scoping" },
  { id: "work", name: "Work & wellbeing", question: "What is known about remote work and employee wellbeing, and how could it inform my own study?", purpose: "background", type: "narrative" },
  { id: "schools", name: "Policy & practice", question: "Which school-based approaches could reduce loneliness among teenagers, to inform a decision this term?", purpose: "decision", type: "rapid" },
  { id: "medication", name: "Health research", question: "How accurately do AI methods detect adverse drug events in clinical notes?", purpose: "answer", type: "systematic" },
  { id: "update", name: "Keeping up to date", question: "What new evidence on digital support for student mental health has appeared since our last review?", purpose: "update", type: "systematic" },
];

export function suggestedType(purpose) {
  return PURPOSES.find(p => p.id === purpose)?.suggested || null;
}

// Cache each framework's filled fields so changing direction never discards previous work.
export function changeFramework(protocol, next) {
  if (!FRAMEWORKS[next] || protocol.framework === next) return;
  protocol.framework_elements ||= {};
  protocol.framework_elements[protocol.framework] = structuredClone(protocol.elements || []);
  const prior = protocol.framework_elements[next];
  const population = (protocol.elements || []).find(e => e.key === "P" && /population/i.test(e.label));
  protocol.elements = FRAMEWORKS[next].map(([key, label]) => ({ key, label,
    text: prior ? prior.find(e => e.key === key)?.text ?? "" : (key === "P" ? population?.text : "") || "" }));
  protocol.framework = next;
}

export function applyReviewPlan(protocol, draft) {
  const type = REVIEW_TYPES[draft.type];
  if (!type) throw new Error("Choose a review type first.");
  protocol.question = draft.question.trim();
  protocol.purpose = draft.purpose;
  protocol.review_type = draft.type;
  protocol.maintenance = draft.purpose === "update" ? draft.maintenance || "update" : "one-off";
  if (draft.exampleId) protocol.starter_example = draft.exampleId;
  else delete protocol.starter_example;
  changeFramework(protocol, draft.framework || type.framework);
}
