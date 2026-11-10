import { h, pickFile, toast, download, fmt } from "../util.js";
import { listProjects, emptyProject, saveProject, importProject, deleteProject, exportProject, loadProject, updateProjectFromFile } from "../store.js";
import { card, btn, help, table, row } from "../ui.js";
import { STEPS } from "../app.js";
import { pickDocument, setPending } from "./docload.js";
import { disclosure } from "../disclosure.js";
import { stageIcon } from "../icons.js";
import { openExample } from "./example.js";
import { platformStrip } from "../brand.js";

export async function render(m, ctx) {
  const createProject = async () => {
    const name = prompt("Name of the review", "My review");
    if (!name) return;
    const p = emptyProject(name);
    await saveProject(p);
    ctx.go(`#/p/${p.id}/protocol`);
  };
  const projects = await listProjects();
  m.append(h("header", { class: "research-hero welcome-compact" },
    h("div", { class: "hero-copy" }, h("div", { class: "eyebrow" }, "Step-by-step guidance for literature reviews ", h("span", { class: "badge warn" }, "work in progress")),
      h("h1", {}, projects.length ? "Welcome back to your review." : "Your literature review, step by step, with frontier AI."),
      h("p", { class: "lead" }, "Sieve guides you through a systematic or scoping review in eight steps, from question to evidence table, "
        + "and shows how to use frontier models such as ChatGPT and Claude at each step. Every AI answer comes with quotes that Sieve checks against the papers. You make the decisions."),
      h("div", { class: "hero-actions" },
        projects.length
          ? h("a", { class: "btn primary", href: `#/p/${projects[0].id}/protocol` }, stageIcon("folder"), "Continue your review")
          : btn([stageIcon("protocol"), "Start a review"], createProject, "primary"),
        h("a", { class: "btn", href: "#/guide/protocol" }, stageIcon("search"), "Explore the steps")),
      h("p", { class: "hero-reassurance" }, "Works with your own ChatGPT or Claude · No API key needed · AI is optional · Your work stays in this browser")),
    h("div", { class: "home-brand-art", "aria-hidden": "true" },
      h("div", { class: "brand-art-orbit" }),
      h("img", { src: "assets/sieve-mark.svg", alt: "", width: 108, height: 108 }),
      h("span", { class: "art-label art-label-top" }, stageIcon("records"), "A world of papers"),
      h("span", { class: "art-label art-label-bottom" }, stageIcon("verify"), "Your evidence, in focus"))));
  m.append(platformStrip());

  const overview = h("section", { class: "workflow-overview" },
    h("div", { class: "section-heading" }, h("div", {}, h("h2", {}, "Your review at a glance"),
      h("p", { class: "muted" }, "Pick a step to see what’s involved.")),
      btn([stageIcon("fulltext"), "Try the example"], () => openExample(ctx, "protocol"), "ghost")),
    h("div", { class: "pipeline" }, STEPS.map(s => h("a", { class: "pstep", href: `#/guide/${s.id}` },
      h("span", { class: "step-index" }, stageIcon(s.id), String(s.n).padStart(2, "0")), h("b", {}, s.label), h("span", {}, s.sub),
      h("span", { class: "step-arrow", "aria-hidden": "true" }, "↗")))));
  if (!projects.length) m.append(overview);

  const list = card("Your projects",
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
  m.append(list);
  if (projects.length) m.append(overview);

  // Demo projects are generated locally by `python -m sieve build-demo`.
  let demos = [];
  try { const r = await fetch("demo/index.json", { cache: "no-store" }); if (r.ok) demos = await r.json(); } catch { /* none */ }
  if (demos.length) m.append(disclosure("fulltext", "More example projects", "Explore with sample data",
    help("Opening a demo copies it into your browser; you can change it freely."),
    demos.map(d => h("div", { class: "route" }, h("h4", {}, d.name), h("p", { class: "muted" }, d.description),
      btn("Open demo", async () => {
        const r = await fetch(`demo/${d.file}`, { cache: "no-store" });
        const p = await importProject(await r.json());
        toast(`Loaded ${p.name}`);
        ctx.go(`#/p/${p.id}/${p.search.blocks.length ? "search" : "screening"}`);
      }, "primary")))));

  m.append(h("nav", { class: "resource-links", "aria-label": "Help and setup" },
    [["chat", "AI & costs", "Compare your options", "#/guide/options"],
     ["verify", "Methods & guidance", "Understand the approach", "#/methods"],
     ["computer", "Models & keys", "Connect when you’re ready", "#/settings"]].map(([icon, title, hint, href]) =>
      h("a", { href }, stageIcon(icon), h("span", {}, h("strong", {}, title), h("small", {}, hint)), stageIcon("chevron")))));
}
