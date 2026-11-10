// The public example project (site/examples/): real PubMed / Europe PMC records on LLM screening,
// with example model runs. Opening it copies it into this browser; it can be changed freely.
import { toast } from "../util.js";
import { importProject, loadProject } from "../store.js";

export async function openExample(ctx, step = "protocol", file = "llm-screening.json") {
  try {
    const r = await fetch(`examples/${file}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`example not found (${r.status})`);
    const obj = await r.json();
    const p = (await loadProject(obj.id)) || await importProject(obj);
    ctx.go(`#/p/${p.id}/${step}`);
  } catch (e) { toast(e.message, "err"); }
}
