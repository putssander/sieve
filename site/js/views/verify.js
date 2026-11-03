import { h, toast, fmt, titleSimilarity, normDoi, cleanText, pool } from "../util.js";
import { card, btn, help, row, table, progress, badge, modal } from "../ui.js";
import { crossref, crossrefByTitle, crossrefYears, doiToPmid } from "../apis.js";
import { active } from "./records.js";

const NON_ARTICLE = new Set(["journal-issue", "book", "proceedings", "dataset", "reference-book", "report", "standard", "peer-review", "grant", "posted-content"]);
const TITLE_MATCH = 0.6;

export function render(m, ctx) {
  const p = ctx.project;
  const recs = active(p);
  m.append(h("p", { class: "lead" }, "Check every record against Crossref before screening: does the DOI belong to this title and year, is it a journal article, "
    + "and do several records share one (wrong) link? A spreadsheet in which three different papers share one link means at least two of them were screened on the wrong text."));
  const prog = progress();
  const done = recs.filter(r => p.resolve[r.rid]).length;
  m.append(card("Run checks",
    row(btn(done ? `Re-check all ${recs.length}` : `Check ${recs.length} records`, () => runAll(ctx, recs, prog), "primary"),
      done < recs.length && done > 0 && btn(`Check ${recs.length - done} unchecked`, () => runAll(ctx, recs.filter(r => !p.resolve[r.rid]), prog))),
    prog.el, help("Uses the free Crossref API (about 3 records per second). Records without a DOI get a title search with a suggested DOI.")));

  const flagged = recs.filter(r => p.resolve[r.rid]?.flags?.length);
  const rows = [...flagged, ...recs.filter(r => !flagged.includes(r))];
  m.append(card(`Results · ${flagged.length} flagged of ${fmt(done)} checked`,
    table([
      { label: "ID", render: r => r.rid },
      { label: "Title", cls: "title", render: r => r.title },
      { label: "DOI", render: r => r.doi || h("span", { class: "muted" }, "–") },
      { label: "Title match", cls: "num", render: r => { const v = p.resolve[r.rid]; return v?.title_similarity === null || v?.title_similarity === undefined ? "–" : badge(v.title_similarity.toFixed(2), v.title_match ? "ok" : "err"); } },
      { label: "Year", render: r => { const v = p.resolve[r.rid]; return v?.year_match === false ? badge(`${r.year} ≠ ${v.crossref_years.join("/")}`, "err") : v?.year_match ? "✓" : "–"; } },
      { label: "Type", render: r => p.resolve[r.rid]?.crossref_type || "" },
      { label: "Flags", render: r => (p.resolve[r.rid]?.flags || []).map(f => badge(f.split(":")[0], "warn")) },
    ], rows, { onRow: r => detail(ctx, r), rowClass: r => (p.resolve[r.rid]?.flags?.length ? "prio-FLAGGED" : "") })));
}

async function runAll(ctx, recs, prog) {
  const p = ctx.project;
  await pool(recs, 3, async r => { p.resolve[r.rid] = await check(r); }, (d, t) => prog.set(d, t));
  flagSharedLinks(p);
  ctx.save(); ctx.rerender();
}

export async function check(r) {
  const doi = normDoi(r.doi);
  const out = { doi, resolved_url: r.link || "", resolved_via: r.link ? "sheet_link" : "none", crossref_title: "", crossref_year: null, crossref_years: [], crossref_type: "",
    title_similarity: null, title_match: null, year_match: null, flags: [], notes: "", checked: new Date().toISOString().slice(0, 10) };
  if (!doi) {
    const items = await crossrefByTitle(r.title).catch(() => []);
    const best = items.map(it => ({ it, sim: titleSimilarity(r.title, it.title?.[0] || "") })).sort((a, b) => b.sim - a.sim)[0];
    out.flags.push("no_doi");
    if (best && best.sim >= 0.9) { out.suggested_doi = best.it.DOI.toLowerCase(); out.notes = `Crossref title match (${best.sim}): ${best.it.title?.[0]}`; }
    return out;
  }
  const msg = await crossref(doi).catch(() => null);
  if (!msg) { out.flags.push("doi_not_found"); out.notes = "DOI does not resolve in Crossref (DataCite DOIs and some preprints are not in Crossref)."; return out; }
  out.crossref_title = cleanText(msg.title?.[0]);
  out.crossref_years = crossrefYears(msg);
  out.crossref_year = out.crossref_years[0] || null;
  out.crossref_type = msg.type || "";
  out.resolved_url = msg.resource?.primary?.URL || `https://doi.org/${doi}`;
  out.resolved_via = msg.resource?.primary?.URL ? "crossref_primary" : "doi.org";
  out.title_similarity = titleSimilarity(r.title, out.crossref_title);
  out.title_match = out.title_similarity >= TITLE_MATCH;
  if (r.year && out.crossref_years.length) out.year_match = out.crossref_years.some(y => Math.abs(y - Number(r.year)) <= 1);
  if (out.title_match === false) out.flags.push("title_mismatch");
  if (out.year_match === false) out.flags.push("year_mismatch");
  if (NON_ARTICLE.has(out.crossref_type)) out.flags.push(`non_article_type:${out.crossref_type}`);
  // Meeting abstracts usually sit in a supplement issue; errata announce themselves in the title.
  if (/supplement/i.test(String(msg.issue || "")) || /abstracts|poster/i.test(msg["container-title"]?.[0] || "")) out.flags.push("possible_abstract_or_supplement");
  if (/^(erratum|correction|corrigendum)\b/i.test(out.crossref_title)) out.flags.push("erratum");
  if (!r.pmid) r.pmid = await doiToPmid(doi).catch(() => "");
  out.notes = out.flags.length ? "Check the flags before trusting earlier decisions on this record." : "Consistent with the record.";
  return out;
}

function flagSharedLinks(p) {
  const groups = {};
  for (const r of active(p)) if (r.link) (groups[r.link.toLowerCase()] ||= []).push(r.rid);
  for (const ids of Object.values(groups)) if (ids.length > 1) for (const id of ids) {
    const v = p.resolve[id];
    if (v && !v.flags.some(f => f.startsWith("shared_link"))) v.flags.push(`shared_link:${ids.filter(x => x !== id).join(",")}`);
  }
}

function detail(ctx, r) {
  const v = ctx.project.resolve[r.rid];
  if (!v) return;
  const body = h("div", {}, h("dl", { class: "kv" },
    ...[["Record title", r.title], ["Crossref title", v.crossref_title], ["Year (record / Crossref)", `${r.year} / ${v.crossref_years.join(", ")}`], ["Type", v.crossref_type],
      ["Resolved URL", v.resolved_url && h("a", { href: v.resolved_url, target: "_blank" }, v.resolved_url)], ["Record link", r.link], ["Flags", v.flags.join("; ")], ["Notes", v.notes]]
      .filter(([, x]) => x).flatMap(([k, x]) => [h("dt", {}, k), h("dd", {}, x)])),
    v.suggested_doi && row(btn(`Use suggested DOI ${v.suggested_doi}`, async () => {
      r.doi = v.suggested_doi; ctx.project.resolve[r.rid] = await check(r); ctx.save(); close(); ctx.rerender();
    }, "primary")),
    v.title_match === false && help("Title mismatch: the DOI probably belongs to another paper. Correct the DOI in the record (step 3) or exclude the record."),
  );
  const close = modal(`Record ${r.rid}`, body, { wide: true });
}
