// One click from a value or decision to the passage that supports it: the paper's text with every
// evidence quote highlighted and scrolled into view, plus a link that highlights the quote on the
// source web page (text fragment; PMC/publisher HTML, not PDFs).

import { h } from "../util.js";
import { modal, help, row, btn, badge } from "../ui.js";
import { highlightHtml, fragmentUrl, sourceUrl } from "../evidence.js";

// quotes: [{ quote, label }]; focus: index of the quote to show first.
export function showEvidence(rec, text, quotes, { focus = 0, title } = {}) {
  const body = [rec.title, rec.abstract && `\nAbstract\n${rec.abstract}`, text && `\nFull text\n${text}`].filter(Boolean).join("\n");
  const { html, found } = highlightHtml(body, quotes);
  const src = sourceUrl(rec);
  const view = h("div", { class: "evtext", html });
  const go = i => {
    view.querySelectorAll("mark.ev.on").forEach(m => m.classList.remove("on"));
    const m = view.querySelector(`mark.ev[data-ev~="${i}"]`);
    if (m) { m.classList.add("on"); m.scrollIntoView({ block: "center", behavior: "smooth" }); }
  };
  const list = h("div", { class: "evlist" }, quotes.map((q, i) => h("div", { class: `evq ${i === focus ? "on" : ""}` },
    row(q.label && h("strong", { class: "small" }, q.label),
      found.includes(i) ? h("a", { href: "#", class: "small", onclick: e => { e.preventDefault(); go(i); } }, `“${q.quote}”`) : h("span", { class: "small" }, `“${q.quote}” `, badge("not found in the text", "warn")),
      h("span", { class: "spacer" }),
      src && h("a", { class: "small", href: fragmentUrl(src, q.quote), target: "_blank", rel: "noopener", title: "Opens the paper's web page with this passage highlighted (works on web pages, not in PDFs)" }, "open at source ↗")))));
  modal(title || `${rec.rid} · evidence`, h("div", {},
    help(text ? "Highlighted in the paper's text (yellow; orange = selected). Click a quote to jump to it." : "No full text in Sieve for this record: highlighted in the title and abstract."),
    list, view), { wide: true });
  setTimeout(() => go(found.includes(focus) ? focus : found[0]), 50);
}
