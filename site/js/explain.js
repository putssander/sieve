import { h } from "./util.js";
import { stageIcon } from "./icons.js";

// Short, task-specific explanations: meaning, example, and what to do next.
export const TERMS = {
  blocks: {
    title: "Concept blocks · AND, OR, NOT",
    meaning: "A concept block groups different words for one idea. OR accepts any word in a group. AND requires a match from each group. NOT removes matching results.",
    example: "(doctoral students OR PhD students) AND (writing groups OR peer writing) looks for both a student term and a writing-group term.",
    action: "Use OR for alternative names and AND to join ideas. Be careful with NOT: it can remove relevant papers that happen to mention the excluded word.",
  },
  overfitting: {
    title: "Overfitting",
    meaning: "Making your search work very well for the papers you already know, while it may still miss other relevant papers.",
    example: "Your five known papers all say “peer writing groups”. You keep only that phrase because it finds all five. But another relevant paper says “collaborative writing” and your search misses it.",
    action: "Keep a separate group of relevant papers out of the search-building process: a hold-out set. Use it to check the finished search. If you change the search after seeing those results, those papers are no longer an independent check; use a fresh, untouched group if you can.",
  },
  validation: {
    title: "Validation set",
    meaning: "In Sieve, this is a group of papers you already know are relevant. You use them while building and improving your search.",
    example: "You have six relevant papers from your supervisor. If your search finds only four, inspect the other two to see what wording or database coverage you may have missed.",
    action: "Choose varied, genuinely relevant papers. Finding all of them is a useful check, but does not prove that your search finds every relevant study.",
  },
  holdout: {
    title: "Hold-out set",
    meaning: "A separate group of relevant papers that you do not use to choose or refine your search terms. Think of it as a practice exam you have not seen before.",
    example: "Build the search using one group of papers. Then check whether it also finds a different group that was kept aside.",
    action: "Keep these papers out of term suggestions and other tuning decisions. Sieve displays their results when you run a test; repeatedly using those results to improve the search makes them part of the development process.",
  },
  recall: {
    title: "Recall",
    meaning: "How many relevant papers a search manages to find. In Sieve’s known-paper checks, the score refers only to the relevant papers you supplied.",
    example: "The search finds 8 of your 10 known relevant papers: recall on that set is 80%. This is not a measurement of all relevant papers in the literature.",
    action: "Investigate missing papers. They may use different words, have incomplete records or be absent from that database. Aim for coverage, not just fewer search results.",
  },
  precision: {
    title: "Precision",
    meaning: "The share of search results that are actually relevant to your question. It helps you estimate how much irrelevant material you will need to screen.",
    example: "You check 20 randomly selected results and judge 5 relevant. The sample’s precision is 25%; the full search may differ.",
    action: "Use a sample to understand the reading workload. Do not narrow the search just to improve this score if doing so loses relevant papers.",
  },
  mesh: {
    title: "MeSH",
    meaning: "Medical Subject Headings: standard topic labels used to describe indexed articles in PubMed. They help connect papers that use different words for the same topic.",
    example: "Authors may write “heart attack” while the article is indexed under the subject heading “Myocardial Infarction”.",
    action: "Combine suitable subject headings with words likely to appear in titles and abstracts. Some records, including newly added papers, may not yet have MeSH labels.",
  },
  pmid: {
    title: "PMID",
    meaning: "The identification number for an article’s record in PubMed. It is a string of digits, not the paper’s title or its DOI.",
    example: "On a PubMed article page, look for “PMID:” followed by a number. Copy just that number into the known-article box.",
    action: "Use one PMID per line. Papers outside PubMed do not have a PMID; they can still be relevant to your review.",
  },
  doi: {
    title: "DOI",
    meaning: "A Digital Object Identifier: a stable identifier that usually links to a publication’s publisher page.",
    example: "A DOI starts with “10.” and contains a slash. Putting https://doi.org/ before it creates a link to the publication.",
    action: "Check that the linked title matches your paper. Having a DOI does not mean that the full text is free or that the study is eligible.",
  },
  framework: {
    title: "Question framework",
    meaning: "A set of prompts that helps you make a research question specific. PICO asks about Population, Intervention, Comparison and Outcome. PICo asks about Population, phenomenon of Interest and Context.",
    example: "For an intervention review: Who are the participants? What treatment? Compared with what? Which outcomes? A review of people’s experiences may fit PICo better.",
    action: "Choose a framework that fits your question, with your supervisor or librarian if helpful. Use it to clarify your question; you do not have to turn every element into a required search term.",
  },
  eligibility: {
    title: "Eligibility criteria",
    meaning: "The rules you agree in advance for deciding which studies belong in your review.",
    example: "Include studies of doctoral students’ experiences of writing groups. Exclude studies involving only undergraduate students.",
    action: "Write rules clearly enough that two reviewers can apply them consistently. Record changes and the reasons for excluding studies.",
  },
  deduplication: {
    title: "Deduplication",
    meaning: "Finding multiple database records for the same paper so you do not screen it repeatedly or count it more than once.",
    example: "The same paper appears in PubMed and Scopus. Sieve links the records while keeping both database sources visible.",
    action: "Check uncertain matches. Two papers about the same study are not necessarily duplicates: they can report different results.",
  },
  sensitivity: {
    title: "Sensitivity",
    meaning: "Here, the share of papers you included that a model also includes. Your recorded decisions are the comparison point, not a guarantee of the correct answer.",
    example: "You include 10 papers. The model includes 9 of those and excludes 1: sensitivity against your decisions is 90%.",
    action: "Review the missed includes and disagreements. A high score on a small or unrepresentative sample does not establish that the model is safe to use without checking.",
  },
  specificity: {
    title: "Specificity",
    meaning: "Here, the share of papers you excluded that a model also excludes.",
    example: "You exclude 20 papers and the model excludes 18 of them: specificity against your decisions is 90%.",
    action: "Read this alongside sensitivity. A model can exclude many irrelevant papers yet still miss important studies.",
  },
  kappa: {
    title: "Cohen’s kappa (κ)",
    meaning: "A measure of how much two sets of decisions agree, after allowing for agreement expected by chance.",
    example: "Two reviewers both exclude most papers. Their simple agreement can be high; kappa also takes the pattern of include and exclude decisions into account.",
    action: "A value of 1 means complete agreement; 0 means agreement at the chance level used by the calculation. It can be negative or undefined. Inspect actual disagreements too: agreement does not prove that either reviewer is correct.",
  },
  evidence: {
    title: "Source evidence",
    meaning: "The passage in the paper that supports an extracted value or a screening decision.",
    example: "If your table says there were 18 participants, keep the sentence in the methods section that reports that number.",
    action: "Read the quote in context. Matching words alone does not prove that the interpretation is right. Use “not reported” when the paper does not provide the information.",
  },
  prisma: {
    title: "PRISMA",
    meaning: "Reporting guidance for systematic reviews. Its flow diagram shows how you moved from search results to the studies included in your review.",
    example: "Show how many records you found, removed as duplicates, screened, assessed in full text and finally included, with reasons for full-text exclusions.",
    action: "Check the counts against your actual work. A generated diagram helps with reporting; it does not by itself mean your review meets all reporting requirements.",
  },
};

export const STEP_WHY = {
  protocol: "Agreeing on the question and rules first helps you make consistent decisions instead of changing the rules to fit the papers you find.",
  search: "Different authors use different words. A planned, tested search helps you find relevant work beyond the papers you already know.",
  records: "Combining sources broadens your search. Linking duplicates prevents you from reading and counting the same paper twice.",
  verify: "A wrong title or link can send you to the wrong paper. Checking the details now prevents mistakes later.",
  fulltext: "An abstract is only a summary. You need the full paper to check eligibility and understand its methods and results.",
  screening: "Applying the same rules to every paper makes your selection more consistent and easier to explain to someone else.",
  extraction: "Recording the same information from each study lets you compare findings. Keeping the source passage makes each entry checkable.",
  report: "Showing what you searched, selected and excluded helps readers understand and assess how you reached your conclusions.",
};

const STEP_TERMS = {
  protocol: ["framework", "eligibility"], search: ["validation", "holdout", "overfitting", "blocks", "recall", "precision", "mesh", "pmid"],
  records: ["deduplication", "recall"], verify: ["doi", "pmid"], fulltext: ["doi", "eligibility"],
  screening: ["eligibility", "sensitivity", "specificity", "kappa"], extraction: ["evidence"], report: ["prisma"],
};

let dialogId = 0;
export function termHelp(key, label = TERMS[key].title) {
  const entry = TERMS[key];
  const trigger = h("button", { type: "button", class: "term-info", "aria-label": `Explain ${entry.title}`, "aria-haspopup": "dialog", title: `Explain ${entry.title}`, onclick: () => {
    const titleId = `term-title-${++dialogId}`;
    const dialog = h("dialog", { class: "term-dialog", "aria-labelledby": titleId },
      h("div", { class: "term-dialog-head" }, h("h2", { id: titleId }, entry.title),
        h("button", { type: "button", class: "btn ghost sm", onclick: () => dialog.close(), "aria-label": "Close explanation", autofocus: true }, "Close ×")),
      h("p", { class: "term-meaning" }, entry.meaning),
      h("div", { class: "term-example" }, h("h3", {}, "For example"), h("p", {}, entry.example)),
      h("h3", {}, "What to do in your review"), h("p", {}, entry.action));
    dialog.addEventListener("close", () => { dialog.remove(); trigger.focus(); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  } }, stageIcon("info"));
  return h("span", { class: "explained-term" }, label, trigger);
}

export function stepTerms(id) {
  return h("div", { class: "step-terms" }, h("span", { class: "small muted" }, "Words explained"),
    (STEP_TERMS[id] || []).map(key => termHelp(key)));
}
