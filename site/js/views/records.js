import { stepIntro } from "../disclosure.js";
import { termHelp } from "../explain.js";
import { h, clear, toast, pickFile, parseCsv, normDoi, normTitle, cleanText, fmt, download, toCsv, XLSX } from "../util.js";
import { card, btn, help, field, input, row, table, progress, modal, badge, select } from "../ui.js";
import { pmQuery } from "../query.js";
import { pmCount, pmIds, pmFetch } from "../apis.js";
import { dedupe as runDedupe, RULES, sourceOverlap, recallBySource, knownArticles, guessSource } from "../dedup.js";
import { parseExport } from "../bibparse.js";

export const active = p => p.records.filter(r => !r.duplicate_of);

export function render(m, ctx) {
  const p = ctx.project;
  m.append(stepIntro("records", "Bring the search results together: export them from each database (RIS works for Ovid, Embase, Web of Science, Scopus, EndNote, Zotero) "
    + "or fetch them straight from PubMed. Duplicates are linked, not deleted, so the PRISMA numbers stay traceable."));

  const prog = progress();
  m.append(card("Import",
    row(btn("From PubMed (current search string)", () => importPubmed(ctx, prog), "primary"),
      btn("RIS file", () => importFile(ctx, "ris")), btn("CSV / Excel", () => importFile(ctx, "table")), btn("PMID list", () => importPmids(ctx, prog))),
    prog.el,
    help("Each import is tagged with its database, so the report can show records identified per database. Duplicates are linked automatically after every import.")));

  const dups = p.records.filter(r => r.duplicate_of).length;
  const noAbs = active(p).filter(r => !r.abstract && r.pmid).length;
  const bySource = {};
  p.records.forEach(r => (bySource[r.source || "?"] = (bySource[r.source || "?"] || 0) + 1));
  m.append(card("Records",
    h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", {}, fmt(p.records.length)), h("span", {}, "imported")),
      h("div", { class: "stat" }, h("b", {}, fmt(dups)), h("span", {}, "duplicates")),
      h("div", { class: "stat" }, h("b", {}, fmt(p.records.length - dups)), h("span", {}, "unique"))),
    h("p", { class: "small muted" }, Object.entries(bySource).map(([s, n]) => `${s}: ${n}`).join(" · ")),
    row(btn("Find duplicates again", () => dedupe(ctx)),
      noAbs > 0 && btn(`Fetch ${noAbs} missing abstracts from PubMed`, () => completeAbstracts(ctx, prog)),
      btn("Export CSV", () => download(`${p.id}-records.csv`, toCsv(p.records, ["rid", "title", "year", "authors", "journal", "doi", "pmid", "source", "duplicate_of", "abstract"]), "text/csv")),
      p.records.length > 0 && btn("Delete all records", () => { if (confirm("Delete all records (and their screening/extraction results)?")) { p.records = []; ctx.save(); ctx.rerender(); } }, "danger")),
    recordTable(p)));

  if (p.records.length) {
    m.append(overlapCard(ctx));
    m.append(recallCard(ctx));
  }
}

// ------------------------------------------------------------------ overlap & near-duplicates
function overlapCard(ctx) {
  const p = ctx.project;
  const before = p.records.filter(r => r.duplicate_of).length;
  const res = runDedupe(p.records, { distinct: p.dedup_distinct || [] });
  if (res.linked !== before) ctx.save();
  const rows = sourceOverlap(p.records);
  const byRid = new Map(p.records.map(r => [r.rid, r]));
  const decide = (x, same) => {
    if (same) { const b = byRid.get(x.b); b.duplicate_of = x.a; b.dup_manual = "dup"; b.dup_rule = x.rule; }
    else (p.dedup_distinct ||= []).push(`${x.a}|${x.b}`);
    ctx.save(); ctx.rerender();
  };
  const auto = Object.entries(res.byRule).filter(([k]) => k !== "manual");
  return card("Duplicates across databases",
    help("Method: Bramer et al. 2016 (J Med Libr Assoc 104:240), adapted: page numbers are normalised (1008-12 → 1008-1012), then field combinations are compared from strict to loose. ",
      "Strict matches are linked automatically (the first imported record is kept); the cases the method checks by hand are listed below. Details: docs/deduplication.md."),
    h("p", { class: "small" }, h("strong", {}, "Linked automatically: "), auto.length ? auto.map(([k, n]) => `${RULES[k]?.label || k} ${RULES[k]?.what ? `(${RULES[k].what})` : ""}: ${n}`).join(" · ") : "none",
      res.byRule.manual ? ` · confirmed by you: ${res.byRule.manual}` : ""),
    table([
      { label: "Database", render: o => o.source },
      { label: "Imported", cls: "num", render: o => fmt(o.imported) },
      { label: "Already found", cls: "num", render: o => fmt(o.duplicates) },
      { label: "Only here", cls: "num", render: o => fmt(o.unique) },
    ], rows),
    res.review.length ? h("div", {},
      h("h4", {}, `${res.review.length} possible duplicate${res.review.length > 1 ? "s" : ""} to check`),
      table([
        { label: "Rule", render: x => h("span", {}, badge(RULES[x.rule]?.label || x.rule, x.rule === "doi" || x.rule === "pmid" ? "warn" : ""), h("div", { class: "muted small" }, RULES[x.rule]?.what || "")) },
        { label: "Why check", cls: "small", render: x => x.reason },
        { label: "Kept record", cls: "title", render: x => desc(byRid.get(x.a)) },
        { label: "Possible duplicate", cls: "title", render: x => desc(byRid.get(x.b)) },
        { label: "", render: x => row(btn("Same paper", () => decide(x, true), "sm"), btn("Different", () => decide(x, false), "ghost sm")) },
      ], res.review, { limit: 100 })) : help("No possible duplicates left to check."));
}
const desc = r => (r ? h("span", {}, r.title, h("div", { class: "muted small" },
  [r.authors && String(r.authors).split(";")[0], r.year, r.journal_abbr || r.journal, r.volume && `${r.volume}${r.issue ? `(${r.issue})` : ""}`, r.pages && `p. ${r.pages}`, r.source, r.doi].filter(Boolean).join(" · "))) : "");

// ------------------------------------------------------------------ recall per database
function recallCard(ctx) {
  const p = ctx.project;
  const known = knownArticles(p);
  if (!known.length) return card(termHelp("recall", "Recall per database"), help("Add known relevant papers in step 2 (Search → Known articles). Sieve can then check whether each database export contains them."));
  const R = recallBySource(p.records, known);
  return card(termHelp("recall", "Recall per database (known-paper check)"),
    help("Checks every database export against the known articles (by PMID, DOI or title). A miss means the translated search string, or the database's coverage, "
      + "misses that article: open it in the database to see whether it is indexed there, and if so adjust that database's string in step 2."),
    h("div", { class: "stats" }, R.summary.map(s => h("div", { class: "stat" }, h("b", {}, `${s.found}/${s.total}`), h("span", {}, s.source)))),
    table([
      { label: "Set", render: k => badge(k.set === "validation" ? "validation" : "hold-out", k.set === "validation" ? "info" : "") },
      { label: "Article", cls: "title", render: k => h("span", {}, k.title || k.doi || k.pmid, k.pmid && h("span", { class: "muted small" }, ` · PMID ${k.pmid}`)) },
      ...R.sources.map(s => ({ label: s, render: k => (k.found[s] ? h("span", { class: "hit" }, "✓") : h("span", { class: "miss" }, "✗")) })),
    ], R.rows),
    help(`${R.anywhere} of ${known.length} known articles are in at least one database export.`));
}

function recordTable(p) {
  const q = input("", v => { clear(host).append(tbl(v)); }, { placeholder: "filter by title, author, DOI, PMID…", style: { maxWidth: "420px" } });
  const host = h("div");
  const tbl = f => {
    const s = f.toLowerCase();
    const rows = s ? p.records.filter(r => `${r.title} ${r.authors} ${r.doi} ${r.pmid} ${r.rid}`.toLowerCase().includes(s)) : p.records;
    return table([
      { label: "ID", render: r => r.rid },
      { label: "Title", cls: "title", render: r => h("span", {}, r.title, r.duplicate_of && h("span", {}, " ", badge(`duplicate of ${r.duplicate_of}${r.dup_manual === "dup" ? " · by you" : r.dup_rule ? ` · rule ${RULES[r.dup_rule]?.label || r.dup_rule}` : ""}`, "warn"))) },
      { label: "Year", render: r => r.year },
      { label: "DOI / PMID", render: r => r.doi || r.pmid || "" },
      { label: "Abstract", render: r => (r.abstract ? `${Math.round(r.abstract.length / 100) / 10}k` : h("span", { class: "muted" }, "–")) },
      { label: "Source", render: r => h("span", { class: "small muted" }, r.source || "") },
    ], rows, { onRow: r => modal(r.title, recordDetail(r), { wide: true }) });
  };
  host.append(tbl(""));
  return h("div", {}, q, host);
}

export function recordDetail(r) {
  return h("div", {}, h("dl", { class: "kv" },
    ...[["ID", r.rid], ["Authors", r.authors], ["Year", r.year], ["Journal", r.journal], ["DOI", r.doi && h("a", { href: `https://doi.org/${r.doi}`, target: "_blank" }, r.doi)],
      ["PMID", r.pmid && h("a", { href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`, target: "_blank" }, r.pmid)], ["Link", r.link && h("a", { href: r.link, target: "_blank" }, r.link)], ["Source", r.source]]
      .filter(([, v]) => v).flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
  h("p", {}, r.abstract || h("em", { class: "muted" }, "No abstract")));
}

function nextRid(p) { return String(p.records.reduce((m, r) => Math.max(m, Number(r.rid) || 0), 0) + 1); }

export function addRecords(ctx, recs, source) {
  const p = ctx.project;
  let n = Number(nextRid(p));
  for (const r of recs) {
    const rid = r.rid && !p.records.some(x => x.rid === String(r.rid)) ? String(r.rid) : String(n++);
    p.records.push({ ...r, rid, doi: normDoi(r.doi), title: cleanText(r.title), abstract: cleanText(r.abstract), source: r.source || source });
  }
  const before = p.records.filter(r => r.duplicate_of).length;
  const res = runDedupe(p.records, { distinct: p.dedup_distinct || [] });
  const dups = res.linked;
  p.dedup_review = res.review.length;
  ctx.save();
  toast(`Added ${recs.length} records from ${source} · ${dups - before > 0 ? `${dups - before} already found in earlier imports` : "no duplicates of earlier imports"}${res.review.length ? ` · ${res.review.length} possible duplicates to check` : ""}`);
  ctx.rerender();
}

async function importPubmed(ctx, prog) {
  const p = ctx.project;
  const q = pmQuery(p.search.blocks);
  if (!q) return toast("Build a search string in step 2 first", "warn");
  try {
    const { count } = await pmCount(q);
    if (!confirm(`Fetch ${fmt(Math.min(count, 9999))} of ${fmt(count)} PubMed records with abstracts? (PubMed allows at most 9,999 per query; for more, export from pubmed.gov as a file.)`)) return;
    const ids = await pmIds(q, Math.min(count, 9999));
    const recs = await pmFetch(ids, (d, t) => prog.set(d, t, "records"));
    addRecords(ctx, recs.map(r => ({ ...r, rid: r.pmid, authors: r.authors })), `PubMed ${new Date().toISOString().slice(0, 10)}`);
  } catch (e) { toast(e.message, "err"); }
}

async function importPmids(ctx, prog) {
  const txt = prompt("Paste PMIDs (separated by spaces, commas or new lines)");
  if (!txt) return;
  const ids = [...new Set(txt.match(/\d{5,9}/g) || [])];
  try { const recs = await pmFetch(ids, (d, t) => prog.set(d, t)); addRecords(ctx, recs.map(r => ({ ...r, rid: r.pmid })), "PMID list"); }
  catch (e) { toast(e.message, "err"); }
}

export { parseRis } from "../bibparse.js";

const COLS = { title: ["title", "ti", "article title", "titel"], abstract: ["abstract", "ab"], authors: ["authors", "author", "au", "auteurs"],
  year: ["year", "py", "publication year", "jaar"], doi: ["doi", "do"], pmid: ["pmid", "pubmed id"], journal: ["journal", "source", "so", "source title"],
  link: ["link", "url"], rid: ["record_id", "id", "record id", "covidence #"], volume: ["volume", "vl", "vol"], issue: ["issue", "is", "number"],
  pages: ["pages", "page", "pg", "sp"], issn: ["issn", "sn"] };

async function importFile(ctx, kind) {
  const f = await pickFile(kind === "ris" ? ".ris,.txt,.nbib" : ".csv,.tsv,.xlsx,.xls");
  if (!f) return;
  try {
    if (kind === "ris") {
      const text = await f.text();
      const recs = parseExport(text);
      if (!recs.length) throw new Error("no records found (expects RIS: TY - ... ER - blocks, or MEDLINE/PubMed format: PMID- ...)");
      const source = prompt("Which database is this export from? (used for the per-database counts and recall)", guessSource(f.name, text));
      if (source === null) return;
      return addRecords(ctx, recs, source || f.name);
    }
    let rows;
    if (/\.xlsx?$/i.test(f.name)) {
      const X = await XLSX();
      const wb = X.read(await f.arrayBuffer());
      const sheet = wb.SheetNames.length > 1 ? prompt(`Sheet name (${wb.SheetNames.join(", ")})`, wb.SheetNames[0]) : wb.SheetNames[0];
      rows = X.utils.sheet_to_json(wb.Sheets[sheet], { defval: "" });
    } else rows = parseCsv(await f.text());
    if (!rows.length) throw new Error("empty file");
    mapColumns(ctx, rows, f.name);
  } catch (e) { toast(e.message, "err"); }
}

function mapColumns(ctx, rows, name) {
  const heads = Object.keys(rows[0]);
  const guess = {};
  for (const [k, names] of Object.entries(COLS)) guess[k] = heads.find(hd => names.includes(hd.trim().toLowerCase())) || "";
  const body = h("div", {}, help(`${rows.length} rows. Check which column holds which field.`),
    h("div", { class: "grid3" }, Object.keys(COLS).map(k => field(k, select(guess[k], [["", "–"], ...heads], v => (guess[k] = v))))),
    row(btn("Import", () => {
      const recs = rows.map(r => Object.fromEntries(Object.keys(COLS).filter(k => guess[k]).map(k => [k, String(r[guess[k]] ?? "")])));
      const source = prompt("Which database is this export from?", guessSource(name));
      if (source === null) return;
      close(); addRecords(ctx, recs, source || name);
    }, "primary")));
  const close = modal("Map columns", body, { wide: true });
}

function dedupe(ctx) {
  const p = ctx.project;
  const res = runDedupe(p.records, { distinct: p.dedup_distinct || [] });
  ctx.save(); toast(`${res.linked} duplicates linked · ${res.review.length} to check`); ctx.rerender();
}

async function completeAbstracts(ctx, prog) {
  const p = ctx.project;
  const todo = active(p).filter(r => !r.abstract && r.pmid);
  try {
    const recs = await pmFetch(todo.map(r => r.pmid), (d, t) => prog.set(d, t));
    for (const x of recs) {
      const r = p.records.find(y => y.pmid === x.pmid);
      if (r) Object.assign(r, { abstract: x.abstract, doi: r.doi || x.doi, authors: r.authors || x.authors, journal: r.journal || x.journal, year: r.year || x.year, mesh: x.mesh, pubtypes: x.pubtypes });
    }
    ctx.save(); toast(`Added ${recs.filter(r => r.abstract).length} abstracts`); ctx.rerender();
  } catch (e) { toast(e.message, "err"); }
}
