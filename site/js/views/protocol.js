import { h, pickFile, toast, docxToText, pdfToText, slug, clear } from "../util.js";
import { card, btn, help, field, input, textarea, select, row, runPanel, modal } from "../ui.js";
import { DECISIONS, SYSTEM_SEARCH, protocolSchema, protocolFromDocPrompt } from "../prompts.js";

const FRAMEWORKS = {
  PICO: [["P", "Population / problem"], ["I", "Intervention / exposure"], ["C", "Comparison"], ["O", "Outcome"]],
  PICo: [["P", "Population"], ["I", "Phenomenon of interest"], ["Co", "Context"]],
  SPIDER: [["S", "Sample"], ["PI", "Phenomenon of interest"], ["D", "Design"], ["E", "Evaluation"], ["R", "Research type"]],
  PCC: [["P", "Population"], ["C", "Concept"], ["C2", "Context"]],
};

export function render(m, ctx) {
  const p = ctx.project, pr = p.protocol;
  const save = () => ctx.save();
  m.append(h("p", { class: "lead" }, "The protocol drives everything after it: the search assistant uses the question and PICO, "
    + "and every screening prompt is built from the criteria below."));

  m.append(card("Review",
    field("Project name", input(p.name, v => { p.name = v; save(); })),
    field("Review question", textarea(pr.question, v => { pr.question = v; save(); }, { rows: 3 })),
    row(field("Review type", select(pr.review_type, ["systematic", "scoping", "rapid", "umbrella"], v => { pr.review_type = v; save(); })),
      field("Framework", select(pr.framework, Object.keys(FRAMEWORKS), v => {
        pr.framework = v;
        pr.elements = FRAMEWORKS[v].map(([key, label]) => ({ key, label, text: pr.elements.find(e => e.key === key)?.text || "" }));
        save(); ctx.rerender();
      }))),
    h("div", { class: "grid2" }, pr.elements.map(e => field(`${e.key} · ${e.label}`, textarea(e.text, v => { e.text = v; save(); }, { rows: 2 })))),
    field("Notes / open decisions", textarea(pr.notes, v => { pr.notes = v; save(); }, { rows: 2 }))));

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
  m.append(card("Eligibility criteria", help("A record is included only if every criterion is met. Write each one so that a screener (human or model) can decide it from a title/abstract or full text."),
    crit,
    field("Extra screening rules (shown to the model as-is)", textarea(p.screening_rules, v => { p.screening_rules = v; save(); }, { rows: 6, class: "code",
      placeholder: "- Clinical topic does not imply a clinical data source.\n- Reviews: exclude but save for snowballing." }))));

  // Documents: proposal, PICO form, ticket... used as input for the protocol assistant.
  const docs = card("Documents", help("Attach the proposal, a PICO form or an earlier prompt (.docx, .pdf, .md, .txt). The assistant can draft the fields above from a document."),
    row(btn("Attach document", async () => {
      const f = await pickFile(".docx,.pdf,.txt,.md");
      if (!f) return;
      try {
        const buf = await f.arrayBuffer();
        const text = f.name.endsWith(".docx") ? await docxToText(buf) : f.name.endsWith(".pdf") ? (await pdfToText(buf)).text : new TextDecoder().decode(buf);
        pr.documents.push({ name: f.name, kind: "attached", text });
        save(); ctx.rerender();
      } catch (e) { toast(e.message, "err"); }
    })),
    pr.documents.map((d, i) => h("details", { class: "block", style: { marginBottom: "8px" } },
      h("summary", {}, h("strong", {}, d.name), " ", h("span", { class: "badge" }, d.kind || "document"), ` · ${Math.round(d.text.length / 100) / 10}k characters`),
      h("pre", {}, d.text.slice(0, 6000)),
      row(btn("Draft protocol from this document", () => draftFromDoc(ctx, d), "primary"),
        btn("Remove", () => { pr.documents.splice(i, 1); save(); ctx.rerender(); }, "danger sm")))));
  m.append(docs);
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
