// The public example project (site/examples/): real PubMed / Europe PMC records on LLM screening,
// with example model runs. Opening it copies it into this browser; it can be changed freely.
import { h, toast } from "../util.js";
import { importProject, loadProject, emptyProject, saveProject } from "../store.js";
import { modal, btn, help } from "../ui.js";
import { applyReviewPlan } from "../review-plan.js";
import { stageIcon } from "../icons.js";

export async function openExample(ctx, step = "protocol", file = "llm-screening.json") {
  try {
    const r = await fetch(`examples/${file}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`example not found (${r.status})`);
    const obj = await r.json();
    const p = (await loadProject(obj.id)) || await importProject(obj);
    ctx.go(`#/p/${p.id}/${step}`);
  } catch (e) { toast(e.message, "err"); }
}

// Example scans: a question with every AI answer recorded (site/examples/scans/). Opening one starts a new
// project with that question; the scan page replays the answers until something is changed.
export async function scanExamples() {
  try { const r = await fetch("examples/scans/index.json", { cache: "no-cache" }); return r.ok ? await r.json() : []; } catch { return []; }
}

export async function startScan(ctx, draft, example = null) {
  const p = emptyProject(draft.question.length > 90 ? draft.question.slice(0, 87).trim() + "…" : draft.question);
  applyReviewPlan(p.protocol, draft);
  p.scan = { started: new Date().toISOString().slice(0, 10), ...(example ? { example } : {}) };
  await saveProject(p);
  ctx.go(`#/p/${p.id}/scan`);
}

export async function pickScanExample(ctx) {
  const list = await scanExamples();
  if (!list.length) return toast("No recorded example scans in this version", "warn");
  let close;
  close = modal("Example scans", h("div", {},
    help("Each example has every AI answer recorded, so it plays through without a key or a call. Change anything and only that part needs your own AI route."),
    h("div", { class: "scan-examples" }, list.map(e => h("button", { type: "button", class: "scan-example-pick", onclick: async () => { close(); await startScan(ctx, e.draft, e.id); } },
      h("span", { class: "eyebrow" }, e.name), h("strong", {}, e.draft.question),
      h("small", { class: "muted" }, `${e.records} records · ${e.included} selected · recorded with ${e.model}, ${e.date}`), stageIcon("arrow"))))));
}
