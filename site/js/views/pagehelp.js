// The "Copy this page for ChatGPT" button in every step's header: the page + the user's question go
// out as one prompt (copy-paste, API key or local model: the normal run panel), the JSON answer comes
// back into the same page. Fill-in pages show the proposed changes in the review dialog first.

import { h, toast } from "../util.js";
import { btn, help, modal, runPanel, textarea, activeBackend } from "../ui.js";
import { chatSite } from "../llm.js";
import { PAGES, pagePrompt, pageSchema, answerToAnalysis } from "../pagehelp.js";
import { importDialog } from "./docload.js";

export function pageHelpButton(ctx, step) {
  const b = activeBackend();
  const label = b.kind === "manual" ? `Copy this page for ${chatSite(b).label}` : "Ask the assistant about this page";
  return btn(label, () => open(ctx, step), "sm page-ask");
}

function open(ctx, step) {
  const p = ctx.project;
  const page = PAGES[step];
  const q = textarea("", () => {}, { rows: 3, placeholder: "Your question (optional), e.g. \"Are my criteria specific enough?\" or \"Which terms am I missing?\"" });
  let close;
  close = modal(`Ask about this page: ${page.title}`, h("div", {},
    help(`The prompt contains what is on this page now and your question. ${page.schema ? "The chat can also propose changes for this page; you see them before anything is applied." : "You get an answer back here."}`),
    q,
    runPanel({
      title: `page-${step}`, system: "You help researchers with systematic and scoping reviews in the Sieve workspace. Return ONLY JSON matching the requested schema.",
      batchable: false, runName: "page-assistant",
      items: [{ id: step, label: page.title }],
      build: () => ({ prompt: pagePrompt(step, p, q.value), schema: pageSchema(step), name: "page" }),
      save: (_, json) => {
        if (json._error) return toast(json._error, "err");
        close();
        const a = answerToAnalysis(step, json);
        const hasChanges = Object.values(a).some(v => (Array.isArray(v) ? v.length : !!v));
        if (hasChanges) importDialog(ctx, { name: "chat answer", assisted: true, answer: json.answer || "", notes: json.notes || "", ...a }, { title: `Answer for ${page.title}` });
        else showAnswer(page, json);
      },
      done: () => {},
    })), { wide: true });
}

function showAnswer(page, json) {
  modal(`Answer for ${page.title}`, h("div", {},
    h("p", { class: "answer-text" }, json.answer || "(no answer)"),
    json.notes && help(json.notes)), { wide: true });
}
