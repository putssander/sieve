import { h, toast, fmt, pickFile, pdfToText, download, toCsv, pool, clear } from "../util.js";
import { card, btn, help, row, table, progress, badge, modal, select, textarea, field } from "../ui.js";
import { europePmcFullText, unpaywall, localHealth, localFetch } from "../apis.js";
import { getText, putText } from "../store.js";
import { active } from "./records.js";
import { consensus } from "./screening.js";

const MIN_CHARS = 1500;

export async function render(m, ctx) {
  const p = ctx.project;
  m.append(h("p", { class: "lead" }, "Full texts make screening and extraction reliable. Open-access texts are fetched automatically; for the rest, drop the PDFs you downloaded via the library "
    + "(file names starting with the record ID, e.g. 7493.pdf or 7493_smith2022.pdf). Texts stay in this browser and are not included in exported project files."));
  let scope = sessionStorage.getItem("ft-scope") || "tainc";
  const scoped = () => {
    const recs = active(p);
    if (scope === "all") return recs;
    return recs.filter(r => { const c = consensus(p, r.rid); return c === "Include" || c === "Unclear" || c === null; });
  };
  const recs = scoped();
  const got = recs.filter(r => p.fulltext[r.rid] && !p.fulltext[r.rid].failed && (p.fulltext[r.rid].chars || 0) >= MIN_CHARS);
  const health = await localHealth();
  const prog = progress();
  m.append(card("Retrieve",
    row(field("Records", select(scope, [["tainc", "included or unclear after title/abstract screening (or not screened)"], ["all", "all unique records"]], v => { sessionStorage.setItem("ft-scope", v); ctx.rerender(); }))),
    h("div", { class: "stats" }, h("div", { class: "stat" }, h("b", {}, `${got.length}/${recs.length}`), h("span", {}, "with full text"))),
    row(btn("Fetch open-access texts (Europe PMC)", () => fetchOA(ctx, recs.filter(r => !got.includes(r)), prog), "primary"),
      health ? btn("Fetch publisher pages via local helper", () => fetchLocal(ctx, recs.filter(r => !got.includes(r)), prog)) : h("span", { class: "muted small" }, "publisher pages: start `python -m sieve serve` to enable"),
      btn("Add PDFs…", () => addPdfs(ctx)),
      btn("Worklist of missing (CSV)", () => worklist(ctx, recs.filter(r => !got.includes(r))))),
    prog.el));

  m.append(card("Status", table([
    { label: "ID", render: r => r.rid },
    { label: "Title", cls: "title", render: r => r.title },
    { label: "Text", render: r => { const f = p.fulltext[r.rid]; return !f ? h("span", { class: "muted" }, "–") : f.failed ? badge(f.method || "failed", "err") : badge(`${f.method} · ${fmt(f.chars)} chars`, (f.chars || 0) >= MIN_CHARS ? "ok" : "warn"); } },
    { label: "Open access", render: r => { const f = p.fulltext[r.rid]; return f?.oa_pdf ? h("a", { href: f.oa_pdf, target: "_blank" }, "PDF ↗") : f?.oa_landing ? h("a", { href: f.oa_landing, target: "_blank" }, "page ↗") : ""; } },
  ], recs, { onRow: r => editText(ctx, r) })));
}

async function fetchOA(ctx, recs, prog) {
  const p = ctx.project;
  let n = 0;
  await pool(recs, 3, async r => {
    if (!r.doi && !r.pmid) return;
    const e = await europePmcFullText(r.doi, r.pmid).catch(() => null);
    if (e?.text && e.text.length > MIN_CHARS) {
      await putText(p.id, r.rid, e.text);
      p.fulltext[r.rid] = { method: "europepmc-oa", source_url: e.url, chars: e.text.length };
      n++;
      return;
    }
    const u = r.doi ? await unpaywall(r.doi).catch(() => null) : null;
    p.fulltext[r.rid] = { ...(p.fulltext[r.rid] || {}), method: p.fulltext[r.rid]?.method || "not-found", failed: !p.fulltext[r.rid] || p.fulltext[r.rid].failed,
      oa_pdf: u?.pdf || "", oa_landing: u?.landing || "", oa_status: u?.status || "" };
  }, (d, t) => prog.set(d, t, `· ${n} texts`));
  ctx.save(); toast(`${n} open-access full texts added`); ctx.rerender();
}

async function fetchLocal(ctx, recs, prog) {
  const p = ctx.project;
  let n = 0;
  await pool(recs, 2, async r => {
    const url = p.fulltext[r.rid]?.oa_pdf || p.resolve[r.rid]?.resolved_url || (r.doi ? `https://doi.org/${r.doi}` : r.link);
    if (!url) return;
    try {
      const res = await localFetch(url);
      const text = res.pdf ? (await pdfToText(res.pdf)).text : res.text;
      if (text.length < MIN_CHARS) throw new Error(`only ${text.length} characters (paywall or JavaScript page)`);
      await putText(p.id, r.rid, text);
      p.fulltext[r.rid] = { method: res.pdf ? "publisher-pdf" : "publisher-html", source_url: res.url, chars: text.length };
      n++;
    } catch (e) { p.fulltext[r.rid] = { ...(p.fulltext[r.rid] || {}), method: "blocked", failed: true, error: e.message }; }
  }, (d, t) => prog.set(d, t, `· ${n} texts`));
  ctx.save(); toast(`${n} texts fetched`); ctx.rerender();
}

async function addPdfs(ctx) {
  const p = ctx.project;
  const files = await pickFile(".pdf", true);
  if (!files?.length) return;
  let n = 0;
  const miss = [];
  for (const f of files) {
    const stem = f.name.replace(/\.pdf$/i, "");
    const r = active(p).find(x => stem === x.rid || stem.startsWith(`${x.rid}_`) || stem.startsWith(`${x.rid}-`) || stem.startsWith(`${x.rid} `))
      || active(p).find(x => x.doi && stem.toLowerCase().includes(x.doi.replace(/\//g, "_")));
    if (!r) { miss.push(f.name); continue; }
    const { text } = await pdfToText(await f.arrayBuffer());
    await putText(p.id, r.rid, text);
    p.fulltext[r.rid] = { method: text.length < 200 ? "pdf-scanned" : "pdf-local", source_url: f.name, chars: text.length, failed: text.length < 200 };
    n++;
  }
  ctx.save();
  toast(`${n} PDFs added${miss.length ? `; no record ID in: ${miss.join(", ")}` : ""}`, miss.length ? "warn" : "ok");
  ctx.rerender();
}

function worklist(ctx, recs) {
  const p = ctx.project;
  download(`${p.id}-missing-fulltext.csv`, toCsv(recs.map(r => ({ record_id: r.rid, title: r.title, doi: r.doi, url: p.resolve[r.rid]?.resolved_url || r.link || (r.doi ? `https://doi.org/${r.doi}` : ""),
    oa_pdf: p.fulltext[r.rid]?.oa_pdf || "", save_as: `${r.rid}.pdf` }))), "text/csv");
}

async function editText(ctx, r) {
  const p = ctx.project;
  const cur = await getText(p.id, r.rid);
  const ta = textarea(cur, () => {}, { rows: 18, class: "code", placeholder: "Paste the full text (or the methods/results sections) here" });
  const body = h("div", {}, help(`${r.title}`), ta, row(btn("Save text", async () => {
    await putText(p.id, r.rid, ta.value);
    p.fulltext[r.rid] = { method: "pasted", chars: ta.value.length, failed: ta.value.length < 200 };
    ctx.save(); close(); ctx.rerender();
  }, "primary"), btn("Add PDF for this record", async () => {
    const f = await pickFile(".pdf");
    if (!f) return;
    const { text } = await pdfToText(await f.arrayBuffer());
    ta.value = text;
  })));
  const close = modal(`Full text · record ${r.rid}`, body, { wide: true });
}
