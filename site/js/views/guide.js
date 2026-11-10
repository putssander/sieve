import { h } from "../util.js";
import { field, input, help } from "../ui.js";
import { WORKFLOW, estimateCost } from "../workflow.js";
import { stageIcon } from "../icons.js";
import { openExample } from "./example.js";
import { disclosure } from "../disclosure.js";
import { STEP_WHY, stepTerms } from "../explain.js";
import { platformLogo } from "../brand.js";

const link = (label, href, cls = "") => h("a", { class: `btn ${cls}`, href }, label);

export function render(m, ctx, id) {
  const step = WORKFLOW.find(s => s.id === id) || WORKFLOW[0];
  const i = WORKFLOW.indexOf(step);
  m.append(h("header", { class: "page-head guide-head" },
    h("div", { class: "eyebrow" }, "Explore before you commit"),
    h("h1", {}, "Find your way through the review."),
    h("p", { class: "lead" }, "Pick a step. See the essentials. Try it when you’re ready.")),
    h("nav", { class: "tour-track", "aria-label": "Workflow preview" }, WORKFLOW.map((s, n) =>
      h("a", { href: `#/guide/${s.id}`, class: s.id === step.id ? "active" : "", "aria-current": s.id === step.id ? "step" : undefined },
        h("span", { class: "tour-marker" }, stageIcon(s.id), String(n + 1).padStart(2, "0")), s.label))),
    h("section", { class: "step-preview" },
      h("div", { class: "preview-title" }, h("span", { class: "icon-tile" }, stageIcon(step.id)),
        h("div", {}, h("div", { class: "eyebrow" }, `${step.phase} · Step ${i + 1} of 8`), h("h2", {}, step.headline))),
      h("p", { class: "step-why" }, h("strong", {}, "Why this matters. "), STEP_WHY[step.id]),
      h("div", { class: "essentials" },
        h("div", {}, h("h3", {}, stageIcon("folder"), "Start with"), h("p", {}, step.bring)),
        h("div", {}, h("h3", {}, stageIcon("verify"), "Leave with"), h("p", {}, step.output))),
      h("div", { class: "row preview-actions" },
        h("button", { class: "btn primary", onclick: () => openExample(ctx, step.id) }, stageIcon("arrow"), `Try ${step.label.toLowerCase()}`),
        ctx.project && link("Return to your project", `#/p/${ctx.project.id}/${step.id}`),
        h("span", { class: "small muted" }, "Opens an editable example project"))),
    h("div", { class: "guide-details" },
      disclosure(step.id, "What you do & how Sieve helps", "Your role, the tools and the decisions", h("p", {}, step.intro),
        h("dl", { class: "tour-responsibilities" }, h("dt", {}, "You decide"), h("dd", {}, step.you), h("dt", {}, "Sieve helps"), h("dd", {}, step.sieve)), stepTerms(step.id)),
      disclosure("fulltext", "See an example", "A quick look at the expected output",
        h("div", { class: "example-sheet", "aria-label": "Illustrative example" },
          h("h3", { class: "stage-heading" }, stageIcon(step.id), step.label, " in practice"),
          h("p", { class: "small muted" }, "Illustrative example · not research findings"),
          h("dl", {}, step.example.map((t, j) => h(j % 2 ? "dd" : "dt", {}, t))))),
      disclosure("clock", "Time, effort & what comes next", "Plan before you commit", h("p", {}, step.effort), h("p", {}, step.next)),
      disclosure("verify", "Methods & guidance", "Check the approach and its limitations",
        h("a", { class: "btn", href: `#/methods/${step.id}` }, "Read the method for this step →"))),
    h("nav", { class: "tour-controls", "aria-label": "Continue walkthrough" },
      i > 0 ? link(`← ${WORKFLOW[i - 1].label}`, `#/guide/${WORKFLOW[i - 1].id}`) : link("← Overview", "#/"),
      h("span", { class: "muted small" }, `${i + 1} / ${WORKFLOW.length}`),
      i < WORKFLOW.length - 1 ? link(`Next: ${WORKFLOW[i + 1].label} →`, `#/guide/${WORKFLOW[i + 1].id}`, "primary") : link("Choose how to work →", "#/guide/options", "primary")),
    h("div", { class: "guide-footer" }, link("Your projects", "#/"), link("AI, tokens & local tools", "#/guide/options", "ghost")));
}

export function routeCards() {
  const routes = [
    ["01", "Copy & paste", "An easy place to start", "Copy Sieve’s prompt into your chat tool, then paste the answer back. You control each batch.", "Setup: a chat account. Usage limits and any subscription depend on that service.", "Data: the text and PDFs you send are shared with your chat provider."],
    ["02", "Connect an API", "For repeated batches", "An API key lets Sieve send the prompts and save model responses automatically.", "Setup: a provider key and API billing. Cost depends on the model and tokens processed.", "Data: prompts go from your browser to the provider. Your key stays in this browser and is excluded from project exports."],
    ["03", "Run a local model", "For your own hardware", "Connect a model server such as Ollama or LM Studio running on your computer.", "Setup: install a server and download a model. Available memory and hardware affect speed and capacity.", "Data: model prompts go to the server URL you configure. A server on another machine or in Colab is remote."],
  ];
  return h("div", { class: "choice-grid" }, routes.map(([n, title, tag, desc, setup, data], i) =>
    h("article", { class: "choice-card" }, h("div", { class: "platform-duo" },
      (i === 2 ? ["ollama", "lmstudio"] : i === 1 ? ["openai", "claude"] : ["chatgpt", "claude"]).map(id => platformLogo(id))),
      h("h3", {}, title), h("div", { class: "eyebrow" }, tag),
      h("p", {}, desc), disclosure("verify", "Setup & data sharing", "", h("p", {}, setup), h("p", {}, data)))));
}

export function renderOptions(m) {
  m.append(h("header", { class: "page-head guide-head" }, h("div", { class: "eyebrow" }, "Choose your setup"),
    h("h1", {}, "Choose a little help."),
    h("p", { class: "lead" }, "AI is optional. Start manually, or choose a route below. You can change it later.")),
    routeCards(),
    h("div", { class: "row setup-actions" }, link("Configure models & keys", "#/settings", "primary"), link("Keep working manually", "#/")),
    disclosure("costs", "Tokens & costs", "Understand what you pay for before running a batch",
      h("p", {}, "Tokens are pieces of text a model processes. Input tokens include your instructions, criteria and article text. Output tokens are the model’s response; some models also bill for reasoning tokens. A token is not a paper or a fixed number of words."),
      h("p", {}, "Full-text extraction generally sends more text than title/abstract screening. Repeating a run or comparing several models adds usage. Pilot a few papers, check the provider’s usage dashboard, then decide whether to scale up."),
      h("p", {}, "Chat subscriptions and API billing are separate. Check your provider’s billing and any credits before running a large batch. ",
        h("a", { href: "https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform", target: "_blank", rel: "noopener" }, "OpenAI billing guide ↗"), " · ",
        h("a", { href: "https://support.claude.com/en/articles/9876003-why-is-claude-api-usage-billed-separately-from-my-paid-claude-plan", target: "_blank", rel: "noopener" }, "Claude billing guide ↗")),
      costPlanner()),
    h("div", { class: "options-details" },
      disclosure("computer", "Local models & the PDF helper", "Two different tools, both optional",
        h("h4", {}, "Local model · optional AI"), h("p", {}, "A model server generates answers on the machine where it runs. The Sieve website itself does not run a language model. A local server has no cloud token charge, but uses your hardware, memory and electricity."),
        h("h4", {}, "Local helper · optional full-text fetching"), h("p", {}, "Sieve’s Python helper serves the site and fetches publisher pages or PDFs that the browser cannot fetch directly. It is separate from a model server. It still contacts publishers and does not inherit your browser’s library login."),
        help("From an installed Sieve checkout: ", h("code", {}, "python3 -m sieve serve"), ". Connect it in Models & keys. For library sign-in, use the manual download list in step 5.")),
      disclosure("folder", "Your files, backups & privacy", "What stays in the browser and what is shared",
        h("p", {}, "Projects and extracted texts are saved in this browser profile. They do not automatically sync to another computer or to your supervisor. Export a project backup regularly; choose the full-text export option when needed."),
        h("p", {}, "Importing a PDF reads it in your browser. Running a cloud model sends the selected source content to that provider. Literature lookups send identifiers or search queries to the relevant service."),
        h("h4", {}, "Colab and job files"), h("p", {}, "You can also export a batch job, run it with the Python runner locally or in Colab, then import the results. Colab uses a remote runtime; access, limits and costs depend on that service."))),
    disclosure("protocol", "Your first session", "Four small steps to get started",
      h("ol", { class: "getting-started" }, h("li", {}, "Bring your question or protocol and a few known papers."), h("li", {}, "Explore the eight steps, then create a project or import your document."),
        h("li", {}, "Pilot screening and extraction on a small set. Check the results yourself before running a larger batch."), h("li", {}, "Export a backup and review the approach with your supervisor or team.")),
      h("div", { class: "row" }, link("Explore the eight steps", "#/guide/protocol"), link("Go to projects", "#/", "primary"), link("Configure models & keys", "#/settings"))));
}

function costPlanner() {
  const values = { papers: 100, runs: 1, inputTokens: 2000, outputTokens: 300, inputRate: "", outputRate: "" };
  const result = h("p", { class: "cost-result", "aria-live": "polite" });
  const update = () => {
    const amount = estimateCost(values);
    result.textContent = amount === null ? "Enter both rates to calculate an estimate." : `Estimated token cost: ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} in the currency of your rates.`;
  };
  update();
  return h("details", { class: "cost-planner" }, h("summary", {}, "Estimate a batch with your model’s prices"),
    help("Illustrative token counts below, not a measurement of your project. Enter your provider’s current prices per million tokens, in the same currency."),
    h("div", { class: "cost-fields" }, [
      ["papers", "Papers"], ["runs", "Runs per paper"], ["inputTokens", "Input tokens per paper / run"], ["outputTokens", "Output tokens per paper / run"],
      ["inputRate", "Input price / 1M tokens"], ["outputRate", "Output price / 1M tokens"],
    ].map(([key, label]) => field(label, input(values[key], value => { values[key] = value; update(); }, { type: "number", min: 0, step: key.includes("Rate") ? "any" : 1, placeholder: key.includes("Rate") ? "Enter provider rate" : "" })))),
    result, help("Calculation: papers × runs × (input tokens × input rate + output tokens × output rate) ÷ 1,000,000. Excludes retries, caching discounts, tool fees and extra reasoning usage. This does not set a spending limit or make an API call."));
}
