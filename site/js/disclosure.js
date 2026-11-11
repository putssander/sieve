import { h } from "./util.js";
import { stageIcon } from "./icons.js";
import { STEP_WHY, stepTerms } from "./explain.js";
import { WORKFLOW } from "./workflow.js";
import { methodFor, ROUTES } from "./methods.js";

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

// A worked example says more than a paragraph: shown under the one-line intro of every step.
export function stepExample(id) {
  const ex = WORKFLOW.find(w => w.id === id)?.example;
  if (!ex) return null;
  const pairs = [];
  for (let i = 0; i < ex.length; i += 2) pairs.push([ex[i], ex[i + 1]]);
  return h("div", { class: "scan-example step-example" }, h("div", { class: "scan-example-k" }, "Example"),
    h("dl", {}, pairs.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
}

// The review type of the open project picks the route shown first in the "Official method" box (set by app.js).
let route = "systematic";
const ROUTE_OF = { systematic: "systematic", rapid: "rapid", scoping: "scoping", narrative: "systematic", umbrella: "systematic" };
export function setRoute(reviewType) { route = ROUTE_OF[reviewType] || "systematic"; }

// What the official guidance asks at this step, for this review type, with the comparison and sources one click away.
export function methodBox(id) {
  const m = methodFor(id);
  if (!m?.compare?.length) return null;
  const k = ROUTES.findIndex(r => r.id === route);
  const r = ROUTES[k];
  return h("aside", { class: "method-box", "aria-label": "Official method" },
    h("div", { class: "method-box-head" }, h("span", { class: "method-box-k" }, "Official method"),
      h("strong", {}, r.label), h("span", { class: "muted small" }, ` · ${r.basis.map(b => b.name).join(", ")}`)),
    h("ul", {}, m.compare.map(([label, ...cells]) => h("li", {}, h("strong", {}, `${label}: `), cells[k]))),
    h("details", { class: "method-compare" }, h("summary", {}, "Compare with the other routes"),
      h("div", { class: "table-wrap" }, h("table", { class: "compare" },
        h("thead", {}, h("tr", {}, h("th", {}, ""), ROUTES.map(x => h("th", { class: x.id === route ? "current" : "" }, x.label)))),
        h("tbody", {}, m.compare.map(([label, ...cells]) => h("tr", {}, h("th", {}, label), cells.map((c, i) => h("td", { class: ROUTES[i].id === route ? "current" : "" }, c)))))))),
    h("a", { class: "small", href: `#/methods/${id}` }, "Guidance and sources for this step →"));
}

export function stepIntro(id, ...body) {
  return h("div", { class: "step-intro" }, h("p", { class: "lead" }, intros[id]), stepExample(id), methodBox(id),
    disclosure(id, "Why this step & how it works", "",
      h("p", { class: "step-why" }, h("strong", {}, "Why we do this. "), STEP_WHY[id]),
      h("p", {}, ...body), stepTerms(id)));
}
