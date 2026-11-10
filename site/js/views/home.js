import { h, pickFile, toast, download, fmt } from "../util.js";
import { listProjects, emptyProject, saveProject, importProject, deleteProject, exportProject, loadProject, updateProjectFromFile } from "../store.js";
import { card, btn, help, table, row } from "../ui.js";
import { STEPS } from "../app.js";
import { pickDocument, setPending } from "./docload.js";
import { disclosure } from "../disclosure.js";
import { stageIcon } from "../icons.js";
import { openExample } from "./example.js";
import { platformStrip } from "../brand.js";
import { reviewStarter } from "./review-start.js";
import { applyReviewPlan } from "../review-plan.js";

let destroyStarter;
export function cleanup() { destroyStarter?.(); destroyStarter = null; }

export async function render(m, ctx) {
  cleanup();
  const createProject = async () => {
    const name = prompt("Name of the review", "My review");
    if (!name) return;
    const p = emptyProject(name);
    await saveProject(p);
    ctx.go(`#/p/${p.id}/protocol`);
  };
  const projects = await listProjects();
  const overview = h("section", { class: "workflow-overview home-workflow" },
    h("div", { class: "section-heading" }, h("div", {}, h("h2", {}, "A clear path through your review"), h("p", { class: "muted" }, "Explore any step before you begin.")),
      btn("Try an example", () => openExample(ctx, "protocol"), "ghost sm")),
    h("nav", { class: "pipeline", "aria-label": "Explore the eight steps" }, STEPS.map(s => h("a", { class: "pstep", href: `#/guide/${s.id}`, title: `${s.n}. ${s.label}: ${s.sub}` },
      stageIcon(s.id), h("span", {}, h("b", {}, s.label), h("small", {}, s.sub))))));
  const starter = reviewStarter({ home: true, resumeHref: projects.length ? `#/p/${projects[0].id}/protocol` : "",
    onStart: async draft => {
      const p = emptyProject(draft.question.length > 90 ? draft.question.slice(0, 87).trim() + "…" : draft.question);
      applyReviewPlan(p.protocol, draft);
      await saveProject(p);
      ctx.go(`#/p/${p.id}/protocol`);
    } });
  destroyStarter = starter.destroy;
  m.append(starter.el, overview);

  const list = card(null,
    row(btn("New project", createProject, "primary"),
    btn("New project from a document…", async () => {
      try {
        const a = await pickDocument();
        if (!a) return;
        const p = emptyProject(a.name.replace(/\.(docx|pdf|txt|md)$/i, ""));
        await saveProject(p);
        setPending(p.id, a);
        ctx.go(`#/p/${p.id}/protocol`);
      } catch (e) { toast(e.message, "err"); }
    }),
    btn("Import project file", async () => {
      const f = await pickFile(".json");
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const existing = obj.id && await loadProject(obj.id);
        let p;
        if (existing && confirm(`"${existing.name}" is already in this browser.\n\nOK = update it from this file: new records, full texts and model runs are added; your decisions, verified cells and edits are kept.\nCancel = import it as a separate copy.`)) {
          p = await updateProjectFromFile(obj);
          toast(`Updated "${p.name}": ${p.records.length} records, ${Object.keys(p.fulltext || {}).length} full texts`);
        } else p = await importProject(obj, { overwrite: false });
        ctx.go(`#/p/${p.id}/protocol`);
      }
      catch (e) { toast(e.message, "err"); }
    })),
    table([
      { label: "Project", render: p => h("a", { href: `#/p/${p.id}/protocol` }, p.name) },
      { label: "Records", cls: "num", render: p => fmt(p.n) },
      { label: "Updated", render: p => (p.updated || "").slice(0, 16).replace("T", " ") },
      { label: "", render: p => row(
        btn("Export", async e => { e.stopPropagation(); const full = await loadProject(p.id); download(`${p.id}.json`, await exportProject(full)); }, "sm"),
        btn("Delete", async e => { e.stopPropagation(); if (confirm(`Delete '${p.name}' from this browser?`)) { await deleteProject(p.id); ctx.rerender(); } }, "sm danger")) },
    ], projects, { empty: "Your reviews will appear here. Start fresh or bring a protocol you already have." }),
    disclosure("folder", "Importing & backing up your work", "",
    help("Have a search ticket, protocol or PICO form already? ", h("strong", {}, "New project from a document"),
      " fills in the question, PICO, known articles and search tables, and the assistant drafts the rest (copy-paste, no key needed)."),
    help("Projects save in this browser. Export a project file to back up your work or share it with a co-reviewer.")));
  const projectsPanel = disclosure("folder", `Your projects (${projects.length})`, "", list);
  m.append(h("div", { class: "home-bottom-row" }, projectsPanel, platformStrip()));

  // Demo projects are generated locally by `python -m sieve build-demo`.
  let demos = [];
  try { const r = await fetch("demo/index.json", { cache: "no-store" }); if (r.ok) demos = await r.json(); } catch { /* none */ }
  if (demos.length) projectsPanel.lastElementChild.append(disclosure("fulltext", "More example projects", "Explore with sample data",
    help("Opening a demo copies it into your browser; you can change it freely."),
    demos.map(d => h("div", { class: "route" }, h("h4", {}, d.name), h("p", { class: "muted" }, d.description),
      btn("Open demo", async () => {
        const r = await fetch(`demo/${d.file}`, { cache: "no-store" });
        const p = await importProject(await r.json());
        toast(`Loaded ${p.name}`);
        ctx.go(`#/p/${p.id}/${p.search.blocks.length ? "search" : "screening"}`);
      }, "primary")))));

}
