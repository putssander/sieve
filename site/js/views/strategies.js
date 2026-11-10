// Step 2, database strategies: a line-numbered strategy written for one database (usually MEDLINE
// via Ovid, as in a library search ticket) and its translations to Embase, Web of Science, PsycInfo
// and ACM. The rules in strategy.js make an instant draft with warnings; the assistant (copy-paste →
// JSON) checks and improves it and maps the subject headings; the searcher runs each line in the
// database and records the count.

import { h, clear, toast, copy, download, slug, today, fmt } from "../util.js";
import { card, btn, help, row, modal, badge, textarea, input, runPanel } from "../ui.js";
import { TARGETS, translateStrategy, parseStrategyText, strategyToText, headingsIn, mergeHeadings, formatTranslation } from "../strategy.js";
import { SYSTEM_SEARCH, translationPrompt, translationSchema } from "../prompts.js";
import { pickDocument, importDialog } from "./docload.js";

let selected = null;   // strategy id
let target = "embase";
let source = "rules";  // "rules" | "assistant"

export function strategiesCard(ctx) {
  const S = ctx.project.search;
  S.strategies ||= [];
  S.headingMap ||= {};
  const el = h("section", { class: "card" });
  const draw = () => { clear(el); render(el, ctx, draw); };
  draw();
  return el;
}

function render(el, ctx, redraw) {
  const S = ctx.project.search;
  // Default: the most recent line strategy (tickets list V1, V2, … in order).
  const st = S.strategies.find(s => s.id === selected) || [...S.strategies].reverse().find(s => s.kind === "lines") || S.strategies[0];
  selected = st?.id ?? null;
  el.append(h("h3", {}, "Database strategies & translations"),
    help("For strategies written for a database, e.g. MEDLINE via Ovid in a library search ticket. ",
      h("strong", {}, "1"), " load or paste the strategy · ", h("strong", {}, "2"), " Sieve drafts Embase, Web of Science, PsycInfo and ACM by rules and lists what to check · ",
      h("strong", {}, "3"), " let ChatGPT/Claude check the drafts and map the subject headings (copy-paste → JSON) · ",
      h("strong", {}, "4"), " run each line in the database and note the count."),
    row(btn("Paste strategy", () => pasteDialog(ctx, redraw)), btn("Load from document", async () => {
      try { const a = await pickDocument(); if (a) importDialog(ctx, a); } catch (e) { toast(e.message, "err"); }
    }), h("span", { class: "spacer" }),
    S.strategies.length > 0 && h("span", { class: "muted small" }, "Strategy:"),
    S.strategies.length > 0 && h("select", { onchange: e => { selected = e.target.value; redraw(); } },
      S.strategies.map(s => h("option", { value: s.id, selected: s.id === selected }, `${s.name}${s.kind === "by-database" ? " (reference)" : ""}`)))));

  if (!st) { el.append(help("No strategies yet.")); return; }

  el.append(row(h("span", { class: "muted small" }, `${st.source ? `from ${st.source}` : "pasted"}${st.imported ? ` · ${st.imported}` : ""}`),
    h("span", { class: "spacer" }),
    btn("Rename", () => { const n = prompt("Name", st.name); if (n) { st.name = n; ctx.save(); redraw(); } }, "ghost sm"),
    btn("Remove", () => { if (confirm(`Remove "${st.name}"?`)) { S.strategies = S.strategies.filter(x => x !== st); selected = null; ctx.save(); redraw(); } }, "ghost sm danger")));

  if (st.kind === "by-database") {
    el.append(help("A table with one row per database, as found in the document (for reference). The generated translations of a line strategy are under that strategy."),
      h("table", { class: "strat-lines" }, h("tbody", {}, st.lines.map(l => h("tr", {}, h("td", { class: "n" }, l.label), h("td", { class: "q" }, l.query))))));
    return;
  }

  // ---------------------------------------------------------------- source lines
  const ta = textarea(strategyToText(st), () => {}, { class: "strategy", spellcheck: false });
  el.append(h("details", { class: "block", style: { margin: "8px 0" } },
    h("summary", {}, h("strong", {}, `Source: ${st.lines.filter(l => !l.deferred).length} lines`), st.database ? ` · ${st.database}` : " · read as MEDLINE (Ovid)"),
    help("One line per row: number | concept | search | count. Lines without a search are left out; a limit written as ", h("code", {}, "Limit … to yr=\"2020-current\""), " is applied to the last line."),
    ta, row(btn("Save lines", () => {
      const parsed = parseStrategyText(ta.value, st.name);
      st.lines = parsed.lines; st.assistant = null;
      ctx.save(); toast(`${st.lines.length} lines`); redraw();
    }, "primary"))));

  // ---------------------------------------------------------------- tabs
  const A = st.assistant;
  el.append(h("div", { class: "tabs" }, Object.entries(TARGETS).map(([k, t]) =>
    btn(t.short, () => { target = k; redraw(); }, `sm ${k === target ? "on" : ""}`))),
  row(h("span", { class: "muted small" }, "Version:"),
    btn("Rules draft", () => { source = "rules"; redraw(); }, `sm ${source === "rules" ? "on" : "ghost"}`),
    btn(A ? `Assistant (${A.date})` : "Assistant: not run yet", () => { if (A) { source = "assistant"; redraw(); } else assistantRun(ctx, st, redraw); }, `sm ${source === "assistant" && A ? "on" : "ghost"}`),
    h("span", { class: "spacer" }),
    btn(A ? "Run the assistant again" : "Check & improve with the assistant (copy-paste)", () => assistantRun(ctx, st, redraw), A ? "sm" : "primary")));

  const out = h("div");
  el.append(out);
  const opts = { headings: S.headingMap };
  const r = translateStrategy(st, target, opts);
  const asst = A?.databases?.[target];
  if (source === "assistant" && asst) showAssistant(out, ctx, st, asst, r);
  else showRules(out, ctx, st, r);

  // ---------------------------------------------------------------- subject headings
  el.append(headingTable(ctx, st, redraw));
  el.append(row(btn("Download all translations (.md)", () => download(`${slug(st.name)}-translations.md`, report(ctx, st), "text/markdown"))));
}

function showRules(out, ctx, st, r) {
  const counts = (st.counts ||= {})[r.target] ||= {};
  const lines = r.lines.filter(l => l.n !== null);
  out.append(h("div", {},
    !r.history && help("ACM has no search history: the lines document the logic (#n = line n). Paste the one-string version."),
    lineTable(lines.map(l => ({ n: `${r.prefix}${l.n}`, label: l.label, query: l.text, note: l.note, key: l.from })), counts, ctx),
    row(btn("Copy all lines", () => copy(formatTranslation(r)), "sm"), btn("Copy as one string", () => copy(r.single), "sm"),
      h("span", { class: "muted small" }, `${fmt(r.single.length)} characters`)),
    r.warnings.length && h("details", { open: true }, h("summary", {}, h("strong", {}, `Check (${r.warnings.length})`)),
      h("ul", { class: "small warnlist" }, r.warnings.map(w => h("li", { class: "muted" }, w))))));
}

function showAssistant(out, ctx, st, a, r) {
  const counts = (st.counts ||= {})[r.target] ||= {};
  out.append(h("div", {},
    lineTable((a.lines || []).map(l => ({ n: String(l.n), label: l.label, query: l.query, note: syntaxCheck(l.query), key: `a${l.n}` })), counts, ctx),
    row(btn("Copy all lines", () => copy((a.lines || []).map(l => `${l.n}  ${l.query}`).join("\n")), "sm"),
      btn("Copy as one string", () => copy(a.one_string || ""), "sm"),
      a.one_string && syntaxCheck(a.one_string) && badge(`one string: ${syntaxCheck(a.one_string)}`, "warn")),
    a.changes && h("p", { class: "small" }, h("strong", {}, "Changed: "), a.changes),
    a.checks && h("p", { class: "small" }, h("strong", {}, "Verify in the database: "), a.checks),
    st.assistant.notes && help(st.assistant.notes)));
}

function lineTable(rows, counts, ctx) {
  return h("table", { class: "strat-lines" }, h("thead", {}, h("tr", {}, ["#", "Concept", "Search", "Results", ""].map(x => h("th", {}, x)))),
    h("tbody", {}, rows.map(l => h("tr", {},
      h("td", { class: "n" }, l.n),
      h("td", { class: "small" }, l.label || ""),
      h("td", { class: "q" }, l.query, l.note && h("div", { class: "muted small" }, l.note)),
      h("td", {}, input(counts[l.key] ?? "", v => { counts[l.key] = v; ctx.save(); }, { style: { width: "90px" }, placeholder: "count" })),
      h("td", {}, btn("Copy", () => copy(l.query), "ghost sm"))))));
}

// Light check of a query the assistant wrote: brackets and quotes must balance.
function syntaxCheck(q) {
  const s = String(q || "");
  let depth = 0;
  for (const c of s.replace(/"[^"]*"/g, "")) { if (c === "(") depth++; if (c === ")") depth--; if (depth < 0) break; }
  const quotes = (s.match(/"/g) || []).length % 2;
  return [depth !== 0 && "brackets do not balance", quotes && "odd number of quotes"].filter(Boolean).join(", ");
}

function pasteDialog(ctx, redraw) {
  const S = ctx.project.search;
  const name = input("MEDLINE (Ovid)", () => {}, { placeholder: "name" });
  const ta = textarea("", () => {}, { class: "strategy", placeholder: "Paste an Ovid search history, or the rows of a search table copied from Word (concept, search, #results).\n\n1  exp Artificial Intelligence/\n2  (\"machine learning\" or AI).ti,ab,kf.\n3  1 or 2" });
  const close = modal("Paste a strategy", h("div", {}, help("Copy the table rows straight from Word or Excel (they arrive tab-separated), an Ovid search history export, or lines like ", h("code", {}, "3  1 or 2"), "."),
    name, ta, row(btn("Add", () => {
      const s = parseStrategyText(ta.value, name.value || "Pasted strategy");
      if (!s?.lines.length) return toast("No lines found", "err");
      const st = { ...s, id: `st-${slug(s.name)}-${Date.now().toString(36)}`, imported: today() };
      S.strategies.push(st); selected = st.id; ctx.save(); close(); redraw();
      toast(`${s.lines.length} lines`);
    }, "primary"))), { wide: true });
}

function assistantRun(ctx, st, redraw) {
  const S = ctx.project.search;
  const drafts = Object.keys(TARGETS).map(t => { const r = translateStrategy(st, t, { headings: S.headingMap }); return { target: t, label: r.label, text: formatTranslation(r), single: r.single, warnings: r.warnings }; });
  let close;
  close = modal(`Check the translations of "${st.name}"`, h("div", {},
    help("The prompt contains the source strategy, the rule-based drafts for all five databases and their warnings. The assistant returns corrected versions and the subject-heading mapping as JSON; you see them next to the drafts."),
    runPanel({
      title: "search-translate", system: SYSTEM_SEARCH, batchable: false, runName: "search-translator",
      items: [{ id: "translate", label: st.name }],
      build: () => ({ prompt: translationPrompt(st, drafts, headingsIn(st)), schema: translationSchema, name: "translations" }),
      save: (_, json, run) => {
        if (json._error) return toast(json._error, "err");
        const dbs = {};
        for (const d of json.databases || []) if (TARGETS[d.database]) dbs[d.database] = d;
        if (!Object.keys(dbs).length) return toast("No databases in the answer", "err");
        st.assistant = { date: today(), run: run?.label || "", databases: dbs, notes: json.notes || "" };
        let mapped = 0;
        for (const m of json.heading_map || []) {
          if (!m.mesh) continue;
          const cur = (S.headingMap[m.mesh] ||= {});
          if (m.embase && !cur.embase) { cur.embase = m.embase; mapped++; }
          if (m.psycinfo && !cur.psycinfo) { cur.psycinfo = m.psycinfo; mapped++; }
        }
        source = "assistant";
        ctx.save(); close(); redraw();
        toast(`Assistant translations saved${mapped ? ` · ${mapped} heading mappings added` : ""}`);
      },
      done: () => {},
    })), { wide: true });
}

function headingTable(ctx, st, redraw) {
  const S = ctx.project.search;
  const heads = headingsIn(st);
  if (!heads.length) return "";
  const merged = mergeHeadings(S.headingMap);
  const cell = (term, db) => {
    const own = S.headingMap[term]?.[db];
    const def = merged[term.toLowerCase()]?.[db];
    return input(own ?? "", v => { (S.headingMap[term] ||= {})[db] = v.trim(); ctx.save(); }, { placeholder: def ? String(def) : "not mapped: MeSH name is used", style: { width: "100%" } });
  };
  return h("details", { class: "block", style: { marginTop: "10px" } },
    h("summary", {}, h("strong", {}, `Subject headings (${heads.length}): MeSH → Emtree / APA Thesaurus`)),
    help("Grey = built-in suggestion; type to override (\"raw:PO Animal\" is used as written). The assistant fills empty ones when you import its answer. Check each in the Emtree / APA Thesaurus browser. Web of Science and ACM have no subject headings."),
    h("table", { class: "strat-lines" }, h("thead", {}, h("tr", {}, ["MeSH", "Emtree (Embase)", "APA Thesaurus (PsycInfo)"].map(x => h("th", {}, x)))),
      h("tbody", {}, heads.map(t => h("tr", {}, h("td", { class: "small" }, t), h("td", {}, cell(t, "embase")), h("td", {}, cell(t, "psycinfo")))))),
    row(btn("Update translations", () => redraw(), "sm")));
}

function report(ctx, st) {
  const S = ctx.project.search;
  const out = [`# ${st.name}: database translations`, "", `Project: ${ctx.project.name} · generated ${today()} by Sieve`, ""];
  for (const t of Object.keys(TARGETS)) {
    const r = translateStrategy(st, t, { headings: S.headingMap });
    const a = st.assistant?.databases?.[t];
    const counts = st.counts?.[t] || {};
    out.push(`## ${r.label}`, "");
    if (a) {
      out.push(`Checked by the assistant (${st.assistant.date}${st.assistant.run ? `, ${st.assistant.run}` : ""}).`, "", "| # | Concept | Search | Results |", "|---|---|---|---|",
        ...(a.lines || []).map(l => `| ${l.n} | ${l.label || ""} | \`${l.query.replace(/\|/g, "\\|")}\` | ${counts[`a${l.n}`] || ""} |`), "", "One string:", "", "```", a.one_string || "", "```", "");
      if (a.changes) out.push(`Changed: ${a.changes}`, "");
      if (a.checks) out.push(`Verify: ${a.checks}`, "");
      out.push("<details><summary>Rule-based draft</summary>", "", "```", formatTranslation(r), "```", "", "</details>", "");
    } else {
      out.push("| # | Concept | Search | Results |", "|---|---|---|---|",
        ...r.lines.filter(l => l.n !== null).map(l => `| ${r.prefix}${l.n} | ${l.label || ""} | \`${l.text.replace(/\|/g, "\\|")}\` | ${counts[l.from] || ""} |`), "", "One string:", "", "```", r.single, "```", "");
    }
    if (r.warnings.length) out.push("Check:", "", ...r.warnings.map(w => `- ${w}`), "");
  }
  return out.join("\n");
}
