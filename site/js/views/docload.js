// "Load from document": read a ticket / protocol / PICO form / proposal and fill in the fields it
// already answers (question, PICO, known articles, search tables), after the user has seen what
// will change. Used from the home page (new project from a document) and from step 1.

import { h, pickFile, toast, pdfToText, slug } from "../util.js";
import { btn, help, row, modal, badge, select, runPanel } from "../ui.js";
import { readDocument, analyzeDocument, analysisFromAssistant, mergeAnalyses } from "../docimport.js";
import { SYSTEM_SEARCH, documentImportPrompt, documentImportSchema } from "../prompts.js";
import { pmSummaries, pmidForDoi } from "../apis.js";

export async function pickDocument() {
  const f = await pickFile(".docx,.pdf,.txt,.md,.png,.jpg,.jpeg,.webp");
  if (!f) return null;
  const blocks = await readDocument(f.name, await f.arrayBuffer(), { pdfToText });
  return analyzeDocument(blocks, { name: f.name });
}

// A document picked on the home page, waiting for its new project to open.
let pending = null;
export const setPending = (projectId, analysis) => { pending = { projectId, analysis }; };
export function takePending(projectId) {
  if (pending?.projectId !== projectId) return null;
  const a = pending.analysis; pending = null; return a;
}

export function importDialog(ctx, a, opts = {}) {
  const { onApplied } = opts;
  const p = ctx.project, pr = p.protocol, S = p.search;
  const checks = {};
  const item = (key, on, title, detail, warnText) => {
    const cb = h("input", { type: "checkbox", checked: on });
    checks[key] = cb;
    return h("label", { class: "import-item" }, cb, h("div", {}, h("strong", {}, title), warnText && h("span", {}, " ", badge(warnText, "warn")), detail && h("div", { class: "muted small" }, detail)));
  };
  const short = (t, n = 260) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const found = [];

  a.elements ||= []; a.pmids ||= []; a.dois ||= []; a.strategies ||= [];
  if (a.question) found.push(item("question", true, "Review question", short(a.question), pr.question && pr.question !== a.question ? "replaces the current question" : ""));
  a.elements.forEach((e, i) => {
    const target = matchElement(pr.elements, e.label);
    found.push(item(`el${i}`, !!target, `${e.label}${target ? ` → ${target.key} · ${target.label}` : " (no matching field in this framework)"}`, short(e.text), target?.text ? "replaces the current text" : ""));
  });
  let blockMode = "add";
  let pmSet = "validation", doiSet = a.dois.length > 10 ? "holdout" : "validation";
  if (a.pmids.length) found.push(h("div", { class: "import-item" }, item("pmids", true, `${a.pmids.length} known article${a.pmids.length > 1 ? "s" : ""} (PMID)`, a.pmids.map(x => x.pmid).join(", ")),
    row(h("span", { class: "muted small" }, "add to"), select(pmSet, [["validation", "validation set"], ["holdout", "hold-out set"]], v => { pmSet = v; }))));
  if (a.dois.length) found.push(h("div", { class: "import-item" }, item("dois", true, `${a.dois.length} DOI${a.dois.length > 1 ? "s" : ""} without a PMID: look them up in PubMed`, short(a.dois.join(", "), 200)),
    row(h("span", { class: "muted small" }, "add the ones PubMed has to"), select(doiSet, [["validation", "validation set"], ["holdout", "hold-out set"]], v => { doiSet = v; })),
    help(a.dois.length > 10 ? "Many DOIs: probably a reference list. The hold-out set is the right place for references (they test the string without being used to tune it)." : "")));
  if (a.holdout?.length) found.push(item("holdout", true, `${a.holdout.length} article${a.holdout.length > 1 ? "s" : ""} → hold-out set`, a.holdout.map(x => `${x.pmid} ${x.label || ""}`).join("; ")));
  if (a.blocks?.length) found.push(h("div", { class: "import-item" }, item("blocks", true, `${a.blocks.length} PubMed concept block${a.blocks.length > 1 ? "s" : ""}`,
    short(a.blocks.map(b => `${b.label} (${b.terms.length} terms)`).join(" · "), 300), S.blocks.length ? "see below: replace or add" : ""),
    S.blocks.length ? row(h("span", { class: "muted small" }, "current blocks:"), select(blockMode, [["add", "keep them, add these"], ["replace", "replace them"]], v => { blockMode = v; })) : ""));
  if (a.screening_rules) found.push(item("rules", true, "Extra screening rules (added)", short(a.screening_rules)));
  if (a.instructions) found.push(item("instructions", true, "Extraction instructions", short(a.instructions), p.extraction?.instructions ? "replaces the current instructions" : ""));
  if (a.criteria?.length) found.push(item("criteria", true, `${a.criteria.length} eligibility criteria → added to the list`,
    short(a.criteria.map(c => c.label).join(" · "), 300), p.criteria.length ? `${p.criteria.length} criteria already there; these are added` : ""));
  a.strategies.forEach((s, i) => {
    const exists = S.strategies?.some(x => x.name === s.name);
    found.push(item(`s${i}`, true, s.kind === "lines" ? `Search strategy "${s.name}" (${s.lines.length} lines) → step 2` : `Translations table "${s.name}" (${s.lines.map(l => l.label).join(", ")}) → step 2, for reference`,
      s.kind === "lines" ? short(s.lines.slice(0, 3).map(l => `${l.n ?? "–"} ${l.query}`).join("  ·  "), 220) : "", exists ? "replaces the strategy with this name" : ""));
  });
  if (a.text) found.push(item("doc", !pr.documents.some(d => d.name === a.name), "Keep the document for the protocol assistant",
    "The assistant can then draft the eligibility criteria (and anything not found above) from it."));

  const nothing = found.length <= (a.text ? 1 : 0);
  const assist = a.assisted
    ? h("div", { class: "import-item" }, h("strong", {}, a.answer ? "Answer from the chat" : "✓ Read by the assistant"),
      a.answer && h("p", { class: "answer-text" }, a.answer), a.notes && help(`Notes: ${a.notes}`))
    : h("div", { class: "import-item assist" },
      h("strong", {}, a.image ? "An image (e.g. a criteria flowchart): let ChatGPT or Claude read it" : nothing ? "Nothing recognised automatically: let ChatGPT or Claude read it" : "Let ChatGPT or Claude read the whole document (recommended)"),
      a.image && help(h("strong", {}, "Attach the image in the chat"), " together with the prompt: Sieve cannot read images itself."),
      help("Copy one prompt, paste it in the chat, paste the JSON answer back. The assistant also drafts the eligibility criteria, finds articles and strategies "
        + "the quick scan missed, and points out inconsistencies (e.g. line numbers that do not add up). You review the result here before anything changes."),
      row(btn("Read with the assistant (copy-paste)", () => assistant(ctx, a, close, opts), "primary")));
  const body = h("div", {},
    assist,
    help(nothing ? (a.assisted ? "No changes proposed." : "") : `${a.assisted ? "Proposed changes" : `Found in ${a.name} by the quick scan`}. Untick what you do not want; nothing changes until you press Apply.`),
    h("div", { class: "import-list" }, found),
    row(btn("Apply", async e => {
      const b = e.target;
      b.disabled = true;
      const status = t => { b.textContent = t; };
      try {
        const msg = await apply(status);
        close();
        toast(msg.join(" · ") || "Nothing applied");
        ctx.save(); onApplied?.(); ctx.rerender();
      } catch (err) { toast(err.message, "err"); b.disabled = false; b.textContent = "Apply"; }
    }, "primary"), btn("Cancel", () => close(), "ghost")));
  const close = modal(opts.title || "Load from document", body, { wide: true });

  async function apply(status = () => {}) {
    const msg = [];
    const on = k => checks[k]?.checked;
    if (on("question")) { pr.question = a.question; msg.push("question"); }
    a.elements.forEach((e, i) => { const t = matchElement(pr.elements, e.label); if (t && on(`el${i}`)) { t.text = e.text; msg.push(t.key); } });
    const addTo = (set, items) => {
      const have = new Set(S[set].map(v => v.pmid));
      const add = items.filter(x => !have.has(x.pmid));
      S[set].push(...add);
      return add.length;
    };
    if (on("pmids")) {
      let sums = {};
      status("Looking up titles in PubMed…");
      try { sums = await pmSummaries(a.pmids.map(x => x.pmid)); } catch { /* titles are optional */ }
      const n = addTo(pmSet, a.pmids.map(x => ({ pmid: x.pmid, label: sums[x.pmid]?.title || x.label, title: sums[x.pmid]?.title || "", doi: sums[x.pmid]?.doi || (/^doi:/.test(x.label || "") ? x.label.slice(4) : ""), year: sums[x.pmid]?.year || "" })));
      msg.push(`${n} PMIDs → ${pmSet}`);
    }
    if (on("dois")) {
      const hits = [], missing = [];
      for (const [k, d] of a.dois.entries()) { status(`Looking up DOI ${k + 1} of ${a.dois.length} in PubMed…`); const id = await pmidForDoi(d).catch(() => ""); (id ? hits : missing).push({ doi: d, pmid: id }); }
      let sums = {};
      try { sums = hits.length ? await pmSummaries(hits.map(x => x.pmid)) : {}; } catch { /* optional */ }
      const n = addTo(doiSet, hits.map(x => ({ pmid: x.pmid, label: sums[x.pmid]?.title || `doi:${x.doi}`, title: sums[x.pmid]?.title || "", doi: x.doi, year: sums[x.pmid]?.year || "" })));
      msg.push(`${n} DOIs → ${doiSet}${missing.length ? ` (${missing.length} not in PubMed)` : ""}`);
      if (missing.length) pr.notes = `${pr.notes ? `${pr.notes}\n` : ""}Not in PubMed (from ${a.name}): ${missing.map(x => x.doi).join(", ")}`;
    }
    S.strategies ||= [];
    a.strategies.forEach((s, i) => {
      if (!on(`s${i}`)) return;
      const copy = { ...structuredClone(s), id: `st-${slug(s.name)}-${Date.now().toString(36)}${i}`, imported: new Date().toISOString().slice(0, 10) };
      const at = S.strategies.findIndex(x => x.name === s.name);
      if (at >= 0) S.strategies[at] = copy; else S.strategies.push(copy);
      msg.push(`strategy "${s.name}"`);
    });
    if (on("holdout")) msg.push(`${addTo("holdout", a.holdout.map(x => ({ pmid: x.pmid, label: x.label || "" })))} PMIDs → hold-out`);
    if (on("blocks")) {
      const blocks = a.blocks.map((b, i) => ({ id: `${slug(b.label).slice(0, 12)}${Date.now().toString(36)}${i}`, label: b.label, role: b.role || "include", terms: b.terms }));
      S.blocks = blockMode === "replace" ? blocks : [...S.blocks, ...blocks];
      msg.push(`${blocks.length} blocks`);
    }
    if (on("rules")) { p.screening_rules = [p.screening_rules, a.screening_rules].filter(Boolean).join("\n"); msg.push("screening rules"); }
    if (on("instructions")) { p.extraction.instructions = a.instructions; msg.push("extraction instructions"); }
    if (on("criteria")) {
      for (const c of a.criteria) {
        let id = slug(c.label).replace(/-/g, "_"), n = 2;
        while (p.criteria.some(x => x.id === id)) id = `${slug(c.label).replace(/-/g, "_")}_${n++}`;
        p.criteria.push({ id, label: c.label, description: c.description || "", fail_decision: c.fail_decision || "Exclude" });
      }
      msg.push(`${a.criteria.length} criteria`);
    }
    if (on("doc")) { pr.documents.push({ name: a.name, kind: "loaded", text: a.text }); msg.push("document kept"); }
    return msg;
  }
}

// Match a found label (Population, Intervention, ...) to a field of the current framework.
function matchElement(elements, label) {
  const l = label.toLowerCase();
  const words = { population: ["population", "sample"], intervention: ["intervention", "phenomenon", "concept"], comparison: ["comparison"], outcome: ["outcome", "evaluation"],
    context: ["context"], concept: ["concept", "phenomenon", "intervention"], design: ["design", "research type"] }[l] || [l];
  return elements.find(e => words.some(w => e.label.toLowerCase().includes(w)));
}

// Copy-paste route: the chat reads the whole document and returns JSON; the result is merged with the
// quick scan and shown in the same review dialog.
function assistant(ctx, a, closeDialog, opts) {
  let close;
  close = modal(`Read ${a.name} with the assistant`, runPanel({
    title: "document-import", system: SYSTEM_SEARCH, batchable: false, runName: "document-reader",
    items: [{ id: "document", label: a.name }],
    build: () => ({ prompt: documentImportPrompt(a.image ? `(The document is the image attached to this message, "${a.name}". Read it from the attachment; it may be a flowchart of eligibility criteria: each decision box is a criterion, the exclusion box next to it gives the reason and whether it is "save for snowballing".)` : a.text, a.name), schema: documentImportSchema, name: "document" }),
    save: (_, json) => {
      if (json._error) return toast(json._error, "err");
      close(); closeDialog();
      importDialog(ctx, mergeAnalyses(a, analysisFromAssistant(json, { name: a.name, text: a.text })), opts);
    },
    done: () => {},
  }), { wide: true });
}
