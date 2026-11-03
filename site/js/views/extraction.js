// Step 7: data extraction. The form (fields, groups, answer options, core items) is imported from
// an Excel extraction sheet or built here; models fill it with a quote per value; you verify cell by
// cell; the result is exported in the form's own layout and summarised in pivot tables.

import { h, clear, toast, pickFile, XLSX, slug, quoteInSource, esc } from "../util.js";
import { card, btn, help, row, table, modal, badge, select, input, textarea, field, runPanel } from "../ui.js";
import { SYSTEM_EXTRACT, extractionPrompt, extractionSchema, extractionBatchSchema, applicableFields, sourceBlock } from "../prompts.js";
import { getText } from "../store.js";
import { active } from "./records.js";
import { consensus, isInclude, sourceText } from "./screening.js";

const EMPTY = v => v === undefined || v === null || v === "" ;
const isNR = v => /^(nr|na|n\/a|not reported|-)$/i.test(String(v || "").trim());

export function included(p) {
  return active(p).filter(r => {
    const ft = p.screening.human_ft?.[r.rid]?.decision;
    return ft ? ft === "Include" : isInclude(consensus(p, r.rid)) === true;
  });
}

export function finalValue(p, rid, fid) {
  const hv = p.extraction.human?.[rid]?.[fid];
  if (!EMPTY(hv)) return { value: hv, source: "human" };
  const vals = Object.values(p.extraction.runs).map(r => r.results?.[rid]?.fields?.[fid]?.value).filter(v => !EMPTY(v));
  if (!vals.length) return { value: "", source: "" };
  const norm = v => String(v).trim().toLowerCase();
  return new Set(vals.map(norm)).size === 1 ? { value: vals[0], source: vals.length > 1 ? "agree" : "single" } : { value: vals[0], source: "conflict", all: vals };
}

export async function render(m, ctx) {
  const p = ctx.project, ex = p.extraction;
  ex.human ||= {};
  m.append(h("p", { class: "lead" }, "Import your extraction sheet as the form, let a model propose every value with a verbatim quote, then verify cell by cell. "
    + "Green = verified by you · red = models disagree · ❝✗ = quote not found in the text."));
  m.append(formCard(ctx));
  if (!ex.fields.length) return;

  const recs = included(p);
  const texts = {};
  await Promise.all(recs.map(async r => (texts[r.rid] = await getText(p.id, r.rid))));
  const host = h("div");
  m.append(card(`Extract · ${recs.length} included records`,
    !recs.length ? help("No included records yet: include records in step 6 (your decision, or models that agree).") : null,
    recs.length ? host : null));
  if (recs.length) {
    const runs = Object.keys(ex.runs);
    const pick = recs.filter(r => !runs.some(id => ex.runs[id].results?.[r.rid]));
    host.append(help(`Records not yet extracted by any run: ${pick.length}. `, ex.core_until_year ? `Papers up to ${ex.core_until_year} get only the core (bold) items.` : ""));
    host.append(runPanel({
      title: "extraction", system: SYSTEM_EXTRACT, attachHint: true, runName: "",
      items: (pick.length ? pick : recs).map(r => ({ id: r.rid, label: `${r.rid} ${r.title.slice(0, 40)}` })),
      build: (items, opt = {}) => {
        const rs = items.map(it => p.records.find(r => r.rid === it.id));
        const ids = new Set(rs.flatMap(r => applicableFields(p, r).map(f => f.id)));
        const fields = ex.fields.filter(f => ids.has(f.id));
        const src = rs.map(r => ({ source: sourceBlock(r, opt.attachments ? "" : texts[r.rid], 40000), coreOnly: applicableFields(p, r).length < ex.fields.length }));
        return { prompt: extractionPrompt(p, src, fields, opt), schema: items.length > 1 ? extractionBatchSchema(fields) : extractionSchema(fields), name: "extraction" };
      },
      save: (id, json, run) => { (ex.runs[run.id] ||= { label: run.label, model: run.model, backend: run.backend, date: run.date, results: {} }).results[id] = json; },
      done: () => ctx.save(),
    }));
    host.append(row(btn("Refresh grid", () => ctx.rerender(), "ghost")));
    m.append(gridCard(ctx, recs, texts));
    m.append(pivotCard(ctx, recs));
  }
}

// ------------------------------------------------------------------ form
function formCard(ctx) {
  const ex = ctx.project.extraction;
  const groups = [...new Set(ex.fields.map(f => f.group || ""))];
  return card("Extraction form",
    row(btn("Import form from Excel", () => importForm(ctx), "primary"), btn("+ Field", () => editField(ctx, null)),
      ex.fields.length > 0 && field("Core items only for papers up to year", input(ex.core_until_year || "", v => { ex.core_until_year = v; ctx.save(); }, { type: "number", style: { maxWidth: "110px" } }),
        ex.core_rule || "leave empty to extract all fields for every paper")),
    field("General instructions for the extractor", textarea(ex.instructions, v => { ex.instructions = v; ctx.save(); }, { rows: 2 })),
    ex.fields.length ? h("details", {}, h("summary", {}, `${ex.fields.length} fields in ${groups.length} groups (${ex.fields.filter(f => f.core).length} core)`),
      table([
        { label: "Group", render: f => f.group },
        { label: "Field", render: f => h("span", {}, h("strong", { style: { fontWeight: f.core ? 700 : 400 } }, f.label), " ", h("code", { class: "muted small" }, f.id)) },
        { label: "Type", render: f => f.type },
        { label: "Description / options", render: f => h("span", { class: "small" }, [f.description, f.options?.length ? `[${f.options.join(" | ")}]` : ""].filter(Boolean).join(" ")) },
        { label: "Codebook note", render: f => h("span", { class: "small muted" }, f.note || "") },
      ], ex.fields, { onRow: f => editField(ctx, f), limit: 100 })) : help("Import an Excel extraction form: one column per field, with a header row and optionally a group row above it, a description row and an answer-options row. A codebook sheet with answer lists is used for the options."));
}

function editField(ctx, f) {
  const ex = ctx.project.extraction;
  const isNew = !f;
  f = f ? { ...f } : { id: "", group: "", label: "", description: "", type: "text", options: [], core: true };
  const body = h("div", {},
    h("div", { class: "grid2" }, field("Label", input(f.label, v => (f.label = v))), field("Group", input(f.group, v => (f.group = v)))),
    field("Description (shown to the extractor)", textarea(f.description, v => (f.description = v), { rows: 2 })),
    h("div", { class: "grid2" }, field("Type", select(f.type, ["text", "number", "enum", "yesno"], v => (f.type = v))),
      field("Options (one per line)", textarea((f.options || []).join("\n"), v => (f.options = v.split("\n").map(s => s.trim()).filter(Boolean)), { rows: 3 }))),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: f.core, onchange: e => (f.core = e.target.checked) }), " core item"),
    row(btn("Save", () => {
      if (!f.label) return toast("A label is required", "err");
      if (isNew) { f.id = uniq(ex.fields, slug(f.label).replace(/-/g, "_")); ex.fields.push(f); }
      else Object.assign(ex.fields.find(x => x.id === f.id), f);
      ctx.save(); close(); ctx.rerender();
    }, "primary"), !isNew && btn("Delete field", () => { ex.fields = ex.fields.filter(x => x.id !== f.id); ctx.save(); close(); ctx.rerender(); }, "danger")));
  const close = modal(isNew ? "New field" : `Field · ${f.label}`, body);
}
const uniq = (list, id) => { let x = id, n = 2; while (list.some(f => f.id === x)) x = `${id}_${n++}`; return x; };

async function importForm(ctx) {
  const f = await pickFile(".xlsx,.xls");
  if (!f) return;
  const X = await XLSX();
  const wb = X.read(await f.arrayBuffer(), { cellStyles: true });
  const opts = { sheet: wb.SheetNames[0], header: 0, codebook: wb.SheetNames.find(s => /code|codeboek|codebook/i.test(s)) || "" };
  const preview = h("div");
  const grid = sheet => X.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: "" });
  const guessHeader = rows => rows.slice(0, 15).reduce((best, r, i) => (r.filter(v => String(v).trim()).length > (rows[best]?.filter(v => String(v).trim()).length || 0) ? i : best), 0);
  const draw = () => {
    const rows = grid(opts.sheet);
    if (opts.header === null) opts.header = guessHeader(rows);
    clear(preview).append(
      h("div", { class: "tablewrap" }, h("table", {}, h("tbody", {}, rows.slice(0, opts.header + 2).map((r, i) =>
        h("tr", { class: i === opts.header ? "sel" : "" }, h("td", {}, h("strong", {}, i + 1)), r.slice(0, 14).map(v => h("td", { class: "small" }, String(v).slice(0, 40)))))))));
  };
  opts.header = null;
  const body = h("div", {},
    help("The highlighted row is used as field names; the row above it as groups (merged cells), rows above that as description and answer options. Bold header cells become core items."),
    h("div", { class: "grid3" },
      field("Sheet", select(opts.sheet, wb.SheetNames, v => { opts.sheet = v; opts.header = null; draw(); })),
      field("Header row", input("", v => { opts.header = Number(v) - 1; draw(); }, { type: "number", placeholder: "auto" })),
      field("Codebook sheet (answer lists)", select(opts.codebook, [["", "none"], ...wb.SheetNames], v => (opts.codebook = v)))),
    preview,
    row(btn("Use this form", () => {
      const fields = parseForm(X, wb, opts, grid);
      if (!fields.length) return toast("No fields found in the header row", "err");
      if (ctx.project.extraction.fields.length && !confirm(`Replace the current ${ctx.project.extraction.fields.length} fields?`)) return;
      ctx.project.extraction.fields = fields; ctx.save(); close(); ctx.rerender(); toast(`${fields.length} fields imported`);
    }, "primary")));
  const close = modal(`Import form · ${f.name}`, body, { wide: true });
  draw();
}

function parseForm(X, wb, opts, grid) {
  const ws = wb.Sheets[opts.sheet];
  const rows = grid(opts.sheet);
  const H = opts.header;
  const merges = ws["!merges"] || [];
  const groupAt = c => {
    if (H < 1) return "";
    const m = merges.find(r => r.s.r === H - 1 && c >= r.s.c && c <= r.e.c);
    return String(rows[H - 1][m ? m.s.c : c] || "").trim();
  };
  const lists = {}, notes = {};
  if (opts.codebook) {
    const cb = grid(opts.codebook);
    const head = cb[0] || [];
    head.forEach((name, c) => { if (name && c >= 3) lists[String(name).trim().toLowerCase()] = cb.slice(1).map(r => String(r[c] ?? "").trim()).filter(v => v && v !== "0"); });
    cb.slice(1).forEach(r => { const k = String(r[1] || "").trim().toLowerCase(); const n = String(r[3] || "").trim(); if (k && n && n !== "0") notes[k] = n; });
  }
  const fields = [];
  let group = "";
  rows[H].forEach((label, c) => {
    label = String(label || "").trim();
    if (!label) return;
    group = groupAt(c) || group;
    const desc = H >= 2 && c > 0 ? String(rows[H - 2][c] || "").trim() : "";
    const optRaw = H >= 3 && c > 0 ? String(rows[H - 3][c] || "").trim() : "";
    const key = label.toLowerCase();
    let type = "text", options = [];
    if (lists[key]?.length) { type = "enum"; options = lists[key]; }
    else if (/^ja\/nee|^yes\/no/i.test(optRaw)) { type = "yesno"; options = ["Yes", "No"]; }
    else if (/^(waarde|value)$/i.test(desc) || /^(waarde|value)$/i.test(optRaw)) type = "number";
    else if (optRaw && !/gebruik tabel|vrije tekst|use table|free text/i.test(optRaw)) options = optRaw.split(/,|…/).map(s => s.trim()).filter(s => s && s !== "...");
    const cell = ws[X.utils.encode_cell({ r: H, c })];
    fields.push({ id: uniq(fields, slug(label).replace(/-/g, "_")), group, label, description: desc, options, type, core: !!cell?.s?.font?.bold, note: notes[key] || "" });
  });
  return fields;
}

// ------------------------------------------------------------------ grid
function gridCard(ctx, recs, texts) {
  const p = ctx.project, ex = p.extraction;
  const runs = Object.keys(ex.runs);
  const cell = (r, f) => {
    const fv = finalValue(p, r.rid, f.id);
    if (!applicableFields(p, r).some(x => x.id === f.id) && !fv.value) return h("span", { class: "muted small" }, "n/a");
    const res = runs.map(id => ex.runs[id].results?.[r.rid]?.fields?.[f.id]).filter(Boolean);
    const qbad = fv.source !== "human" && res.some(x => x.quote && quoteInSource(x.quote, sourceText(p, r, texts[r.rid])) === false);
    return h("span", { class: `xcell ${fv.source === "human" ? "human" : fv.source === "conflict" ? "conflict" : ""} ${isNR(fv.value) ? "nr" : ""}`, onclick: () => editCell(ctx, r, f, texts) },
      String(fv.value || "").slice(0, 80) || h("span", { class: "muted" }, "·"), qbad ? h("span", { class: "err-text" }, " ❝✗") : "");
  };
  const done = recs.reduce((n, r) => n + ex.fields.filter(f => finalValue(p, r.rid, f.id).source === "human").length, 0);
  const total = recs.reduce((n, r) => n + applicableFields(p, r).length, 0);
  return card("Verify",
    row(h("span", { class: "muted" }, `${done} of ${total} cells verified`), h("span", { class: "spacer" }),
      btn("Accept all values where models agree", () => {
        let n = 0;
        for (const r of recs) for (const f of applicableFields(p, r)) { const fv = finalValue(p, r.rid, f.id); if (fv.source === "agree") { (ex.human[r.rid] ||= {})[f.id] = fv.value; n++; } }
        ctx.save(); toast(`${n} values accepted`); ctx.rerender();
      }), btn("Export Excel (form layout)", () => exportXlsx(ctx, recs, texts), "primary")),
    h("div", { class: "tablewrap xgrid" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Paper"), ex.fields.map(f => h("th", { title: `${f.group} · ${f.description}` }, f.label)))),
      h("tbody", {}, recs.map(r => h("tr", {}, h("td", { class: "title", style: { minWidth: "200px" } }, h("strong", {}, r.rid), ` ${r.title.slice(0, 70)}`), ex.fields.map(f => h("td", {}, cell(r, f)))))))));
}

function editCell(ctx, r, f, texts) {
  const p = ctx.project, ex = p.extraction;
  const src = sourceText(p, r, texts[r.rid]);
  const cur = ex.human[r.rid]?.[f.id] ?? finalValue(p, r.rid, f.id).value;
  const listId = `opts-${f.id}`;
  const inp = input(cur, () => {}, { list: listId });
  const set = v => { (ex.human[r.rid] ||= {})[f.id] = v; ctx.save(); close(); ctx.rerender(); };
  const body = h("div", {},
    help(`${f.group ? f.group + " · " : ""}${f.description || ""}${f.note ? ` · codebook: ${f.note}` : ""}`),
    Object.entries(ex.runs).map(([id, run]) => {
      const x = run.results?.[r.rid]?.fields?.[f.id];
      if (!x) return null;
      const ok = x.quote ? quoteInSource(x.quote, src) : null;
      return h("div", { class: "block", style: { marginBottom: "8px" } }, row(h("strong", {}, id), h("span", {}, x.value), h("span", { class: "spacer" }), btn("Accept", () => set(x.value), "sm")),
        x.quote && h("p", { class: "small" }, `“${x.quote}” `, ok === true ? h("span", { class: "hit" }, "✓ in text") : ok === false ? h("span", { class: "miss" }, "✗ not found in text") : ""));
    }),
    field("Your value", inp), h("datalist", { id: listId }, (f.options || []).map(o => h("option", { value: o }))),
    row(btn("Save", () => set(inp.value), "primary"), btn("NR (not reported)", () => set("NR")), btn("Clear", () => { delete ex.human[r.rid]?.[f.id]; ctx.save(); close(); ctx.rerender(); }, "ghost")),
    texts[r.rid] && h("details", {}, h("summary", {}, "Search the full text"), searchBox(texts[r.rid])));
  const close = modal(`${r.rid} · ${f.label}`, body, { wide: true });
}

function searchBox(text) {
  const out = h("div", { class: "small" });
  const q = input("", v => {
    clear(out);
    if (v.length < 3) return;
    const lc = text.toLowerCase(); let i = lc.indexOf(v.toLowerCase()), n = 0;
    while (i >= 0 && n < 8) { out.append(h("p", { html: `…${esc(text.slice(Math.max(0, i - 160), i))}<mark>${esc(text.slice(i, i + v.length))}</mark>${esc(text.slice(i + v.length, i + v.length + 160))}…` })); i = lc.indexOf(v.toLowerCase(), i + 1); n++; }
  }, { placeholder: "e.g. F1, precision, MIMIC" });
  return h("div", {}, q, out);
}

async function exportXlsx(ctx, recs, texts) {
  const p = ctx.project, ex = p.extraction;
  const X = await XLSX();
  const groups = ["", ...ex.fields.map(f => f.group)], labels = ["record_id", ...ex.fields.map(f => f.label)];
  const data = recs.map(r => [r.rid, ...ex.fields.map(f => finalValue(p, r.rid, f.id).value)]);
  const ws = X.utils.aoa_to_sheet([groups, labels, ...data]);
  const evidence = [];
  for (const r of recs) for (const f of ex.fields) {
    const fv = finalValue(p, r.rid, f.id);
    for (const [id, run] of Object.entries(ex.runs)) {
      const x = run.results?.[r.rid]?.fields?.[f.id];
      if (x) evidence.push({ record_id: r.rid, field: f.label, final_value: fv.value, status: fv.source, run: id, model_value: x.value, quote: x.quote,
        quote_in_text: x.quote ? String(quoteInSource(x.quote, sourceText(p, r, texts[r.rid]))) : "" });
    }
  }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, "extraction");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(evidence), "evidence");
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ex.fields.map(({ id, group, label, description, type, options, core }) => ({ id, group, label, description, type, options: (options || []).join(" | "), core }))), "form");
  X.writeFile(wb, `${p.id}-extraction.xlsx`);
}

// ------------------------------------------------------------------ pivot tables
function pivotCard(ctx, recs) {
  const p = ctx.project, ex = p.extraction;
  const opts = [["", "–"], ...ex.fields.map(f => [f.id, `${f.group ? f.group + " · " : ""}${f.label}`])];
  const nums = [["", "count studies"], ...ex.fields.filter(f => f.type === "number").map(f => [f.id, f.label])];
  const cfg = JSON.parse(sessionStorage.getItem(`pivot-${p.id}`) || "{}");
  const out = h("div");
  const split = v => String(v || "").split(";").map(s => s.trim()).filter(s => s && !isNR(s));
  const num = v => { const m = String(v || "").replace(",", ".").match(/-?\d+(\.\d+)?/); if (!m) return null; const x = Number(m[0]); return /%/.test(v) || x > 1 ? x / 100 : x; };
  const draw = () => {
    sessionStorage.setItem(`pivot-${p.id}`, JSON.stringify(cfg));
    clear(out);
    if (!cfg.row) return out.append(help("Choose a row field (e.g. method family) and optionally a column field (e.g. department or document type) and a metric (e.g. F1) to rebuild tables like 'F1 scores per clinical department'."));
    const cells = {}, rowsSet = new Set(), colsSet = new Set();
    for (const r of recs) {
      const rv = split(finalValue(p, r.rid, cfg.row).value), cv = cfg.col ? split(finalValue(p, r.rid, cfg.col).value) : ["n"];
      const val = cfg.val ? num(finalValue(p, r.rid, cfg.val).value) : 1;
      if (cfg.val && val === null) continue;
      for (const a of rv) for (const b of cv) { rowsSet.add(a); colsSet.add(b); (cells[`${a}|${b}`] ||= []).push(val); }
    }
    const cols = [...colsSet];
    const fmtCell = xs => !xs ? "" : cfg.val ? (xs.length === 1 ? xs[0].toFixed(2) : `${Math.min(...xs).toFixed(2)}–${Math.max(...xs).toFixed(2)} (n=${xs.length})`) : xs.length;
    out.append(table([{ label: ex.fields.find(f => f.id === cfg.row)?.label, render: x => x }, ...cols.map(c => ({ label: c, cls: "num", render: x => fmtCell(cells[`${x}|${c}`]) }))], [...rowsSet].sort()));
  };
  draw();
  return card("Summary tables",
    h("div", { class: "grid3" },
      field("Rows", select(cfg.row || "", opts, v => { cfg.row = v; draw(); })),
      field("Columns", select(cfg.col || "", opts, v => { cfg.col = v; draw(); })),
      field("Value", select(cfg.val || "", nums, v => { cfg.val = v; draw(); }))),
    help("Values with several entries (separated by ';') are counted under each entry. Metrics above 1 are read as percentages."), out);
}
