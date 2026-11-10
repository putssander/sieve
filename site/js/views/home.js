import { h, pickFile, toast, download, fmt } from "../util.js";
import { listProjects, emptyProject, saveProject, importProject, deleteProject, exportProject, loadProject } from "../store.js";
import { card, btn, help, table, row } from "../ui.js";
import { STEPS } from "../app.js";
import { pickDocument, setPending } from "./docload.js";

export async function render(m, ctx) {
  m.append(h("header", { class: "page-head" }, h("h1", {}, "Sieve"),
    h("p", { class: "lead" }, "One workspace for a systematic or scoping review: write the protocol, build and test the search string, "
      + "screen records against your criteria and extract data. Every AI step works by copy-paste with ChatGPT or Claude, "
      + "so you need no API key and no GPU. Keys and local models are optional.")));

  m.append(h("div", { class: "pipeline" }, STEPS.map(s => h("div", { class: "pstep" }, h("b", {}, `${s.n}. ${s.label}`), h("span", {}, s.sub)))));

  const projects = await listProjects();
  const list = card("Your projects",
    row(btn("New project", async () => {
      const name = prompt("Name of the review", "My review");
      if (!name) return;
      const p = emptyProject(name);
      await saveProject(p);
      ctx.go(`#/p/${p.id}/protocol`);
    }, "primary"),
    btn("New project from a document…", async () => {
      try {
        const a = await pickDocument();
        if (!a) return;
        const p = emptyProject(a.name.replace(/\.(docx|pdf|txt|md)$/i, ""));
        await saveProject(p);
        setPending(p.id, a);
        ctx.go(`#/p/${p.id}/protocol`);
      } catch (e) { toast(e.message, "err"); }
    }, "primary"),
    btn("Import project file", async () => {
      const f = await pickFile(".json");
      if (!f) return;
      try { const p = await importProject(JSON.parse(await f.text()), { overwrite: false }); ctx.go(`#/p/${p.id}/protocol`); }
      catch (e) { toast(e.message, "err"); }
    })),
    table([
      { label: "Project", render: p => h("a", { href: `#/p/${p.id}/protocol` }, p.name) },
      { label: "Records", cls: "num", render: p => fmt(p.n) },
      { label: "Updated", render: p => (p.updated || "").slice(0, 16).replace("T", " ") },
      { label: "", render: p => row(
        btn("Export", async e => { e.stopPropagation(); const full = await loadProject(p.id); download(`${p.id}.json`, await exportProject(full)); }, "sm"),
        btn("Delete", async e => { e.stopPropagation(); if (confirm(`Delete '${p.name}' from this browser?`)) { await deleteProject(p.id); ctx.rerender(); } }, "sm danger")) },
    ], projects, { empty: "No projects yet. Start a new one, import a project file, or open a demo below." }),
    help("Have a search ticket, protocol or PICO form already? ", h("strong", {}, "New project from a document"),
      " fills in the question, PICO, known articles and search tables, and the assistant drafts the rest (copy-paste, no key needed)."),
    help("Projects are stored in this browser only (IndexedDB). Export a project file to back it up or to share it with a co-reviewer."));
  m.append(list);

  // Demo projects are generated locally by `python -m sieve build-demo`.
  let demos = [];
  try { const r = await fetch("demo/index.json", { cache: "no-store" }); if (r.ok) demos = await r.json(); } catch { /* none */ }
  if (demos.length) m.append(card("Demo projects",
    help("Opening a demo copies it into your browser; you can change it freely."),
    demos.map(d => h("div", { class: "route" }, h("h4", {}, d.name), h("p", { class: "muted" }, d.description),
      btn("Open demo", async () => {
        const r = await fetch(`demo/${d.file}`, { cache: "no-store" });
        const p = await importProject(await r.json());
        toast(`Loaded ${p.name}`);
        ctx.go(`#/p/${p.id}/${p.search.blocks.length ? "search" : "screening"}`);
      }, "primary")))));

  m.append(card("How the AI steps run",
    h("div", { class: "routes" },
      h("div", { class: "route first" }, h("h4", {}, "1 · Copy-paste (default)"),
        h("p", {}, "The app writes the prompt; you paste it into ChatGPT or Claude and paste the answer back. Several papers per prompt. "
          + "Works with a normal subscription, and you can attach PDFs you have access to.")),
      h("div", { class: "route" }, h("h4", {}, "2 · API key"),
        h("p", {}, "Paste an OpenAI or Claude API key under Models & keys and the app runs all papers for you. Pay per use, stored only in this browser.")),
      h("div", { class: "route" }, h("h4", {}, "3 · Local or Colab GPU"),
        h("p", {}, "Ollama / LM Studio / mlx-lm on a Mac, or a job file run in the Colab notebook. Free and private, but slower and needs setup."))),
    help("All three use the same prompts and criteria, so you can compare models (or a model with a human) on the same papers.")));
}
