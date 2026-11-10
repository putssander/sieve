import { h, clear, toast, pickFile, parseCsv, normDoi, normTitle, cleanText, fmt, download, toCsv, XLSX } from "../util.js";
import { card, btn, help, field, input, row, table, progress, modal, badge, select } from "../ui.js";
import { pmQuery } from "../query.js";
import { pmCount, pmIds, pmFetch } from "../apis.js";
import { dedupeRecords, nearDuplicates, sourceOverlap, recallBySource, knownArticles, guessSource } from "../dedup.js";

export const active = p => p.records.filter(r => !r.duplicate_of);

export function render(m, ctx) {
  const p = ctx.project;
  m.append(h("p", { class: "lead" }, "Bring the search results together: export them from each database (RIS works for Ovid, Embase, Web of Science, Scopus, EndNote, Zotero) "
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
  const rows = sourceOverlap(p.records);
  const exclude = new Set(p.dedup_distinct || []);
  const pairs = nearDuplicates(p.records).filter(x => !exclude.has(`${x.a}|${x.b}`));
  const byRid = new Map(p.records.map(r => [r.rid, r]));
  return card("Duplicates across databases",
    help("Exact duplicates (same DOI, PMID, or title + year) are linked automatically; the first imported record is kept. ",
      "\"Already found\" = records an earlier database also returned; \"only here\" = what this database adds."),
    table([
      { label: "Database", render: o => o.source },
      { label: "Imported", cls: "num", render: o => fmt(o.imported) },
      { label: "Already found", cls: "num", render: o => fmt(o.duplicates) },
      { label: "Only here", cls: "num", render: o => fmt(o.unique) },
    ], rows),
    pairs.length ? h("div", {},
      h("h4", {}, `${pairs.length} possible duplicate${pairs.length > 1 ? "s" : ""} to check`),
      help("Very similar titles that the exact rules did not link (typos, punctuation, preprint vs. journal year)."),
      table([
        { label: "Similarity", render: x => badge(`${Math.round(x.sim * 100)}%`, x.sim > 0.97 ? "warn" : "") },
        { label: "Record A", cls: "title", render: x => desc(byRid.get(x.a)) },
        { label: "Record B", cls: "title", render: x => desc(byRid.get(x.b)) },
        { label: "", render: x => row(
          btn("Same paper", () => { const b = byRid.get(x.b); b.duplicate_of = x.a; b.dup_manual = "dup"; ctx.save(); ctx.rerender(); }, "sm"),
          btn("Different", () => { (p.dedup_distinct ||= []).push(`${x.a}|${x.b}`); ctx.save(); ctx.rerender(); }, "ghost sm")) },
      ], pairs, { limit: 50 })) : help("No possible duplicates left to check."));
}
const desc = r => (r ? h("span", {}, r.title, h("div", { class: "muted small" }, [r.year, r.source, r.doi].filter(Boolean).join(" · "))) : "");

// ------------------------------------------------------------------ recall per database
function recallCard(ctx) {
  const p = ctx.project;
  const known = knownArticles(p);
  if (!known.length) return card("Recall per database", help("Add validation and hold-out articles in step 2 (Search → Known articles): each database export is then checked against them."));
  const R = recallBySource(p.records, known);
  return card("Recall per database (validation & hold-out articles)",
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
      { label: "Title", cls: "title", render: r => h("span", {}, r.title, r.duplicate_of && h("span", {}, " ", badge(`duplicate of ${r.duplicate_of}`, "warn"))) },
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
  const dups = dedupeRecords(p.records);
  ctx.save();
  toast(`Added ${recs.length} records from ${source} · ${dups - before > 0 ? `${dups - before} already found in earlier imports` : "no duplicates of earlier imports"}`);
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

export function parseRis(text) {
  const recs = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z][A-Z0-9])  - ?(.*)$/);
    if (!m) { if (cur && cur._last && line.trim()) cur[cur._last] += " " + line.trim(); continue; }
    const [, tag, val] = m;
    if (tag === "TY") { cur = { authors: [], _last: null }; continue; }
    if (tag === "ER") { if (cur) { cur.authors = cur.authors.join("; "); delete cur._last; recs.push(cur); } cur = null; continue; }
    if (!cur) continue;
    if (tag === "DB" || tag === "DP") cur.db = val.trim();
    const map = { TI: "title", T1: "title", AB: "abstract", N2: "abstract", PY: "year", Y1: "year", DA: "year", DO: "doi", JO: "journal", JF: "journal", T2: "journal", UR: "link", AN: "accession", ID: "rid" };
    if (tag === "AU" || tag === "A1") cur.authors.push(val.trim());
    else if (map[tag]) { const k = map[tag]; if (!cur[k] || k === "abstract") cur[k] = cur[k] && k === "abstract" ? `${cur[k]} ${val}` : val.trim(); cur._last = k; }
  }
  // PubMed / Ovid MEDLINE exports put the PMID in the accession number; Embase's accession numbers are not PMIDs.
  return recs.map(({ accession, db, ...r }) => ({ ...r, pmid: !/embase/i.test(db || "") && /^\d{5,9}$/.test(accession || "") ? accession : "", year: String(r.year || "").slice(0, 4), rid: undefined }));
}

const COLS = { title: ["title", "ti", "article title", "titel"], abstract: ["abstract", "ab"], authors: ["authors", "author", "au", "auteurs"],
  year: ["year", "py", "publication year", "jaar"], doi: ["doi", "do"], pmid: ["pmid", "pubmed id"], journal: ["journal", "source", "so", "source title"],
  link: ["link", "url"], rid: ["record_id", "id", "record id", "covidence #"] };

async function importFile(ctx, kind) {
  const f = await pickFile(kind === "ris" ? ".ris,.txt,.nbib" : ".csv,.tsv,.xlsx,.xls");
  if (!f) return;
  try {
    if (kind === "ris") {
      const text = await f.text();
      const recs = parseRis(text);
      if (!recs.length) throw new Error("no RIS records found (expects TY - ... ER - blocks)");
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
  const n = dedupeRecords(ctx.project.records);
  ctx.save(); toast(`${n} duplicates linked`); ctx.rerender();
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
