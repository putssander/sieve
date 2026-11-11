import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
import { h, pickFile, toast, pdfToText, slug, clear } from "../util.js";
import { readDocument } from "../docimport.js";
import { blocksToText } from "../docx.js";
import { pickDocument, importDialog, takePending } from "./docload.js";
import { card, btn, help, field, input, textarea, select, row, runPanel, modal } from "../ui.js";
import { DECISIONS, SYSTEM_SEARCH, protocolSchema, protocolFromDocPrompt } from "../prompts.js";
import { FRAMEWORKS, changeFramework, applyReviewPlan } from "../review-plan.js";
import { reviewStarter } from "./review-start.js";

export function render(m, ctx) {
  const p = ctx.project, pr = p.protocol;
  const save = () => ctx.save();
  let redrawProtocol = () => {};
  m.append(stepIntro("protocol", "The protocol drives everything after it: the search assistant uses the question and PICO, "
    + "and every screening prompt is built from the criteria below."));

  m.append(reviewStarter({ initial: { question: pr.question, purpose: pr.purpose, type: pr.review_type, framework: pr.framework, exampleId: pr.starter_example, maintenance: pr.maintenance === "one-off" ? "update" : pr.maintenance },
    onChange(draft, reason) {
      if (reason === "question") { pr.question = draft.question; delete pr.starter_example; save(); return; }
      if (reason === "maintenance") { pr.maintenance = draft.maintenance; save(); return; }
      applyReviewPlan(pr, draft); save(); redrawProtocol();
    } }).el);

  m.append(documentsCard(ctx));
  const pending = takePending(p.id);
  if (pending) setTimeout(() => importDialog(ctx, pending), 0);

  const protocolForm = h("div");
  redrawProtocol = () => protocolForm.replaceChildren(
    field("Project name", input(p.name, v => { p.name = v; save(); })),
    help("A ", termHelp("framework", "question framework"), " helps you break a broad topic into clear parts."),
      field("Framework", select(pr.framework, Object.keys(FRAMEWORKS), v => {
        changeFramework(pr, v);
        save(); redrawProtocol();
      })),
    h("div", { class: "grid2" }, pr.elements.map(e => field(`${e.key} · ${e.label}`, textarea(e.text, v => { e.text = v; save(); }, { rows: 2 })))),
    field("Notes / open decisions", textarea(pr.notes, v => { pr.notes = v; save(); }, { rows: 2 })));
  redrawProtocol();
  m.append(card("Refine your protocol", protocolForm));

  const crit = h("div");
  function renderCriteria() {
    clear(crit);
    p.criteria.forEach((c, i) => crit.append(h("div", { class: "block include", style: { marginBottom: "8px" } },
      row(h("strong", {}, `${i + 1}.`), input(c.label, v => { c.label = v; save(); }, { style: { maxWidth: "320px" }, placeholder: "short label" }),
        h("code", { class: "muted" }, c.id),
        h("span", { class: "spacer" }),
        field("If it fails", select(c.fail_decision || "Exclude", DECISIONS.slice(1, 3), v => { c.fail_decision = v; save(); })),
        btn("↑", () => { if (i) { [p.criteria[i - 1], p.criteria[i]] = [p.criteria[i], p.criteria[i - 1]]; save(); renderCriteria(); } }, "ghost sm"),
        btn("✕", () => { p.criteria.splice(i, 1); save(); renderCriteria(); }, "ghost sm danger")),
      textarea(c.description, v => { c.description = v; save(); }, { rows: 2, placeholder: "What exactly must be true? Give examples of what does and does not count." }))));
    crit.append(row(btn("+ Add criterion", () => {
      const label = `Criterion ${p.criteria.length + 1}`;
      p.criteria.push({ id: uniqueId(p.criteria, label), label, description: "", fail_decision: "Exclude" });
      save(); renderCriteria();
    })));
  }
  renderCriteria();
  m.append(card(termHelp("eligibility"), help("A record is included only if every criterion is met. Write each one so that a screener (human or model) can decide it from a title/abstract or full text."),
    crit,
    field("Extra screening rules (shown to the model as-is)", textarea(p.screening_rules, v => { p.screening_rules = v; save(); }, { rows: 6, class: "code",
      placeholder: "- Clinical topic does not imply a clinical data source.\n- Reviews: exclude but save for snowballing." }))));

}

// At the top of the step, so it is the first thing you see: a ticket, protocol, PICO form or
// proposal fills in what it already contains; the assistant drafts the rest from the same text.
function documentsCard(ctx) {
  const p = ctx.project, pr = p.protocol;
  const load = async () => {
    try {
      const a = await pickDocument();
      if (a) importDialog(ctx, a);
    } catch (e) { toast(e.message, "err"); }
  };
  const attachOnly = async () => {
    const f = await pickFile(".docx,.pdf,.txt,.md");
    if (!f) return;
    try {
      const text = blocksToText(await readDocument(f.name, await f.arrayBuffer(), { pdfToText }));
      pr.documents.push({ name: f.name, kind: "attached", text });
      ctx.save(); ctx.rerender();
    } catch (e) { toast(e.message, "err"); }
  };
  return h("section", { class: "card start-doc" },
    h("h3", {}, "Start from a document"),
    help("Already have a search ticket, protocol, PICO form, proposal or a criteria flowchart (image)? Load it (.docx, .pdf, .txt, .png/.jpg) and Sieve fills in what it finds: the review question, PICO elements, "
      + "known articles (PMIDs/DOIs → validation or hold-out set) and search tables (→ step 2, with translations for Embase, Web of Science, PsycInfo, ACM and the Cochrane Library (CENTRAL)). "
      + "You see the list first. The assistant can then draft the eligibility criteria from the same document."),
    row(btn("Load document…", load, "primary"), btn("Attach without filling in", attachOnly, "ghost")),
    pr.documents.map((d, i) => h("details", { class: "block", style: { marginTop: "8px" } },
      h("summary", {}, h("strong", {}, d.name), " ", h("span", { class: "badge" }, d.kind || "document"), ` · ${Math.round(d.text.length / 100) / 10}k characters`),
      h("pre", {}, d.text.slice(0, 6000)),
      row(btn("Draft protocol from this document", () => draftFromDoc(ctx, d), "primary"),
        btn("Remove", () => { pr.documents.splice(i, 1); ctx.save(); ctx.rerender(); }, "danger sm")))));
}

function uniqueId(list, label) {
  let id = slug(label).replace(/-/g, "_"), n = 2;
  while (list.some(c => c.id === id)) id = `${slug(label).replace(/-/g, "_")}_${n++}`;
  return id;
}

function draftFromDoc(ctx, doc) {
  const p = ctx.project;
  let close;
  const task = {
    title: "protocol", system: SYSTEM_SEARCH, batchable: false, runName: "protocol-draft",
    items: [{ id: "protocol", label: doc.name }],
    build: () => ({ prompt: protocolFromDocPrompt(doc.text), schema: protocolSchema, name: "protocol" }),
    save: (_, json) => {
      if (json._error) { toast(json._error, "err"); return; }
      close?.();
      reviewDraft(ctx, json);
    },
    done: () => {},
  };
  close = modal(`Draft protocol from ${doc.name}`, runPanel(task), { wide: true });
}

function reviewDraft(ctx, d) {
  const p = ctx.project;
  const body = h("div", {},
    h("p", {}, h("strong", {}, "Question: "), d.question),
    h("ul", {}, (d.elements || []).map(e => h("li", {}, h("strong", {}, `${e.key} · ${e.label}: `), e.text))),
    h("ol", {}, (d.criteria || []).map(c => h("li", {}, h("strong", {}, c.label), ` — ${c.description}`))),
    d.notes && help(d.notes),
    row(btn("Replace question + elements", () => {
      p.protocol.question = d.question || p.protocol.question;
      if (d.elements?.length) p.protocol.elements = d.elements;
      ctx.save(); close(); ctx.rerender();
    }, "primary"),
    btn("Add the criteria", () => {
      for (const c of d.criteria || []) p.criteria.push({ id: uniqueId(p.criteria, c.label), label: c.label, description: c.description, fail_decision: "Exclude" });
      ctx.save(); close(); ctx.rerender();
    })));
  const close = modal("Review the draft before applying it", body, { wide: true });
}
