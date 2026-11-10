// App shell: hash router, step sidebar, project load/save.

import { h, clear, toast } from "./util.js";
import { loadProject, saveProject } from "./store.js";
import * as home from "./views/home.js";
import * as settings from "./views/settings.js";
import * as protocol from "./views/protocol.js";
import * as search from "./views/search.js";
import * as records from "./views/records.js";
import * as verify from "./views/verify.js";
import * as fulltext from "./views/fulltext.js";
import * as screening from "./views/screening.js";
import * as extraction from "./views/extraction.js";
import * as report from "./views/report.js";
import { pageHelpButton } from "./views/pagehelp.js";

export const STEPS = [
  { id: "protocol", n: 1, label: "Protocol", sub: "question, PICO, criteria", view: protocol },
  { id: "search", n: 2, label: "Search", sub: "build & tune the string", view: search },
  { id: "records", n: 3, label: "Records", sub: "import & deduplicate", view: records },
  { id: "verify", n: 4, label: "Verify", sub: "DOI, title, year checks", view: verify },
  { id: "fulltext", n: 5, label: "Full text", sub: "open access, PDFs", view: fulltext },
  { id: "screening", n: 6, label: "Screening", sub: "criteria, models, humans", view: screening },
  { id: "extraction", n: 7, label: "Extraction", sub: "form, evidence, tables", view: extraction },
  { id: "report", n: 8, label: "Report", sub: "PRISMA, export", view: report },
];

function status(p, id) {
  const n = o => Object.keys(o || {}).length;
  switch (id) {
    case "protocol": return p.protocol.question && p.criteria.length ? "done" : p.protocol.question || p.criteria.length ? "part" : "";
    case "search": return p.search.versions.length ? "done" : p.search.blocks.length ? "part" : "";
    case "records": return p.records.length ? `${p.records.length}` : "";
    case "verify": return n(p.resolve) ? `${n(p.resolve)}` : "";
    case "fulltext": return Object.values(p.fulltext).filter(f => !f.failed).length ? `${Object.values(p.fulltext).filter(f => !f.failed).length}` : "";
    case "screening": return n(p.screening.runs) || n(p.screening.human) ? `${n(p.screening.human)}✓` : "";
    case "extraction": return p.extraction.fields.length ? (n(p.extraction.runs) ? "part" : "form") : "";
    default: return "";
  }
}

let current = null;   // the open project
let saveTimer = null;
const main = () => document.getElementById("main");
const side = () => document.getElementById("side");

export const ctx = {
  get project() { return current; },
  save(now = false) {
    clearTimeout(saveTimer);
    const run = () => saveProject(current).catch(e => toast(`Save failed: ${e.message}`, "err"));
    if (now) return run();
    saveTimer = setTimeout(run, 400);
    renderSide();
  },
  rerender() { route(); },
  go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
};

function renderSide() {
  const el = clear(side());
  const parts = location.hash.split("/");
  el.append(h("a", { class: "brand", href: "#/" }, h("span", { class: "logo" }, "◧"), " Sieve"));
  if (current) {
    el.append(h("div", { class: "pname", title: current.name }, current.name));
    const nav = h("nav", { class: "steps-nav" });
    for (const s of STEPS) {
      const st = status(current, s.id);
      nav.append(h("a", { href: `#/p/${current.id}/${s.id}`, class: parts[3] === s.id ? "active" : "" },
        h("span", { class: `num ${st === "done" ? "done" : st ? "part" : ""}` }, s.n),
        h("span", { class: "lbl" }, s.label, h("small", {}, s.sub)),
        st && st !== "done" && st !== "part" && h("span", { class: "count" }, st)));
    }
    el.append(nav);
  }
  el.append(h("div", { class: "side-foot" },
    h("a", { href: "#/", class: parts[1] === "" || !parts[1] ? "active" : "" }, "Projects"),
    h("a", { href: "#/settings", class: parts[1] === "settings" ? "active" : "" }, "Models & keys")));
}

async function route() {
  const parts = location.hash.replace(/^#/, "").split("/"); // ["", "p", id, step]
  const m = clear(main());
  try {
    if (parts[1] === "p" && parts[2]) {
      if (!current || current.id !== parts[2]) {
        current = await loadProject(parts[2]);
        if (!current) { toast("Project not found", "err"); location.hash = "#/"; return; }
      }
      const step = STEPS.find(s => s.id === parts[3]) || STEPS[0];
      renderSide();
      document.title = `${step.label} · ${current.name}`;
      m.append(h("header", { class: "page-head" }, h("div", { class: "page-tools" }, pageHelpButton(ctx, step.id)),
        h("div", { class: "kicker" }, `Step ${step.n} of ${STEPS.length}`), h("h1", {}, step.label)));
      await step.view.render(m, ctx);
      const next = STEPS[STEPS.indexOf(step) + 1];
      if (next) m.append(h("div", { class: "next" }, h("a", { class: "btn", href: `#/p/${current.id}/${next.id}` }, `Next: ${next.label} →`)));
    } else if (parts[1] === "settings") {
      renderSide();
      document.title = "Models & keys";
      await settings.render(m, ctx);
    } else {
      current = null;
      renderSide();
      document.title = "Sieve";
      await home.render(m, ctx);
    }
  } catch (e) {
    console.error(e);
    m.append(h("div", { class: "card err" }, h("h3", {}, "Something went wrong"), h("pre", {}, String(e.stack || e))));
  }
  window.scrollTo(0, 0);
}

export function setProject(p) { current = p; }

window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", () => { if (saveTimer && current) saveProject(current); });
route();
