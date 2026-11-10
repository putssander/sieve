import { h } from "./util.js";
import { stageIcon } from "./icons.js";
import { STEP_WHY, stepTerms } from "./explain.js";

// Native details keeps guidance keyboard accessible, with no script needed to open it.
export function disclosure(icon, title, hint, ...body) {
  return h("details", { class: "disclosure" },
    h("summary", {}, h("span", { class: "disclosure-icon" }, stageIcon(icon)),
      h("span", { class: "disclosure-label" }, h("strong", {}, title), hint && h("span", {}, hint)),
      stageIcon("chevron")),
    h("div", { class: "disclosure-body" }, ...body));
}

const intros = {
  protocol: "Define your question and decide which studies belong in your review.",
  search: "Build, test and save your search strategy.",
  records: "Import your search results and review duplicate matches.",
  verify: "Check that each record points to the right paper.",
  fulltext: "Find open copies, then add any remaining PDFs from your library.",
  screening: "Apply your criteria and record the decision for each paper.",
  extraction: "Capture study data and verify it against the source.",
  report: "Check your review counts and export your work.",
};

export function stepIntro(id, ...body) {
  return h("div", { class: "step-intro" }, h("p", { class: "lead" }, intros[id]),
    disclosure(id, "Why this step & how it works", "",
      h("p", { class: "step-why" }, h("strong", {}, "Why we do this. "), STEP_WHY[id]),
      h("p", {}, ...body), stepTerms(id)));
}
