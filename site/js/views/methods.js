// "Methods & guidance": the accepted method per step with sources, and how Sieve applies it.
import { h } from "../util.js";
import { help, badge } from "../ui.js";
import { METHODS, GAPS, ROUTES } from "../methods.js";
import { disclosure } from "../disclosure.js";
import { stageIcon } from "../icons.js";

const BADGE = { done: ["✓ done", "ok"], partly: ["◐ partly", "warn"], missing: ["✗ missing", "err"] };

export function render(m, focus) {
  m.append(h("header", { class: "page-head" }, h("h1", {}, "Methods & guidance"),
    h("p", { class: "lead" }, "What the accepted guidance says for each step, with its source, and how Sieve applies it. "
      + "Open a step for its sources and limitations.")));
  m.append(h("nav", { class: "jumpbar" }, h("span", { class: "muted small" }, "Jump to:"),
    METHODS.map(s => h("button", { class: "btn ghost sm", onclick: () => {
      const section = document.getElementById(`m-${s.id}`);
      if (section) { section.open = true; section.scrollIntoView({ behavior: "smooth" }); }
    } }, stageIcon(s.id), s.title))));
  m.append(h("section", { class: "card routes-card" }, h("h3", {}, "Four routes, four sets of rules"),
    help("The same eight steps, done to different standards. Pick the route that fits your purpose; Sieve shows its rules on every step (Official method) and keeps the work when you move to a more rigorous route."),
    h("ul", { class: "mlist" }, ROUTES.map(r => h("li", {}, h("strong", {}, r.label), ": ",
      r.basis.map((b, i) => [i ? " · " : "", h("a", { href: b.url, target: "_blank", rel: "noopener", class: "small", title: b.cite }, b.name)]))))));
  for (const s of METHODS) {
    const compare = s.compare?.length ? h("div", { class: "table-wrap" }, h("table", { class: "compare" },
      h("thead", {}, h("tr", {}, h("th", {}, ""), ROUTES.map(r => h("th", {}, r.label)))),
      h("tbody", {}, s.compare.map(([label, ...cells]) => h("tr", {}, h("th", {}, label), cells.map(c => h("td", {}, c))))))) : null;
    const c = disclosure(s.id, s.title, "Guidance, sources & what Sieve supports",
      compare && h("h4", {}, "Per route"), compare,
      h("h4", {}, "Accepted method"),
      h("ul", { class: "mlist" }, s.method.map(([src, text]) => h("li", {}, text, " ",
        h("a", { href: src.url, target: "_blank", rel: "noopener", class: "small" }, `${src.name} · ${src.cite}`)))),
      h("h4", {}, "In Sieve"),
      h("ul", { class: "mlist" }, s.sieve.map(([st, text]) => h("li", {}, badge(...BADGE[st]), " ", text))));
    c.id = `m-${s.id}`;
    c.open = focus === s.id;
    m.append(c);
  }
  m.append(disclosure("verify", "What still needs your attention", "Gaps to plan for in your review", help("For a systematic review, do these by hand (and report it) until Sieve supports them."),
    h("ol", {}, GAPS.map(g => h("li", {}, g)))));
  if (focus) setTimeout(() => document.getElementById(`m-${focus}`)?.scrollIntoView({ block: "start" }), 50);
}
