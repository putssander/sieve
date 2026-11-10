import { stepIntro } from "../disclosure.js";
import { h, toast, fmt, pickFile, pdfToText, download, toCsv, pool, clear, esc } from "../util.js";
import { card, btn, help, row, table, progress, badge, modal, select, textarea, field } from "../ui.js";
import { europePmcFullText, unpaywall, localHealth, localFetch, localHelperAllowed, pmcText } from "../apis.js";
import { matchPdf, isPdf } from "../pdfmatch.js";
import { isPreprintDoi } from "../preprint.js";
import { connectLocalHelper } from "./settings.js";
import { getText, putText } from "../store.js";
import { active } from "./records.js";
import { consensus } from "./screening.js";

const MIN_CHARS = 1500;

export async function render(m, ctx) {
  const p = ctx.project;
  m.append(stepIntro("fulltext", "Full texts are needed for full-text screening (step 6, second stage), data extraction (step 7) and the evidence highlighting; title/abstract screening does not need them. "
    + "Sieve first collects every open copy it can reach; the rest you download in your browser (library access) and add as PDFs or a whole folder. Texts stay in this browser."));
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
    h("ol", { class: "steps" },
      h("li", {}, btn(`1 · Find full texts automatically (${recs.length - got.length})`, () => fetchAuto(ctx, recs.filter(r => !got.includes(r)), prog, health), "primary"), " ",
        h("span", { class: "muted small" }, "Europe PMC, PubMed Central, arXiv, Unpaywall PDFs", health ? ", publisher pages via the local helper" : ""),
        !health && (localHelperAllowed() ? h("span", { class: "muted small" }, " · start `python -m sieve serve` to also try publisher pages")
          : h("span", {}, " ", btn("also try publisher pages (local helper)…", () => connectLocalHelper(ctx), "ghost sm")))),
      h("li", {}, "Download the rest in your browser: see ", h("strong", {}, "Download by hand"), " below."),
      h("li", {}, btn("2 · Add PDFs…", () => addPdfs(ctx, false)), " ", btn("Add a folder…", () => addPdfs(ctx, true)), " ",
        h("span", { class: "muted small" }, "file names do not matter: each PDF is matched by the DOI or title inside it"))),
    prog.el));
  const manual = recs.filter(r => !got.includes(r));
  if (manual.length) m.append(manualCard(ctx, manual));

  m.append(card("Status", table([
    { label: "ID", render: r => r.rid },
    { label: "Title", cls: "title", render: r => r.title },
    { label: "Text", render: r => { const f = p.fulltext[r.rid]; return !f ? h("span", { class: "muted" }, "–") : f.failed ? badge(f.method || "failed", "err") : badge(`${f.method} · ${fmt(f.chars)} chars`, (f.chars || 0) >= MIN_CHARS ? "ok" : "warn"); } },
    { label: "Open access", render: r => { const f = p.fulltext[r.rid]; return f?.oa_pdf ? h("a", { href: f.oa_pdf, target: "_blank" }, "PDF ↗") : f?.oa_landing ? h("a", { href: f.oa_landing, target: "_blank" }, "page ↗") : ""; } },
  ], recs, { onRow: r => editText(ctx, r) })));
}

// PDFs or a whole folder: matched by content (record ID in the name is checked against the DOI/title).
async function addPdfs(ctx, folder) {
  const p = ctx.project;
  const files = folder ? await pickFolder() : await pickFile(".pdf", true);
  if (!files?.length) return;
  const recs = active(p);
  const log = [];
  let n = 0;
  for (const f of files.filter(x => /\.pdf$/i.test(x.name))) {
    const buf = await f.arrayBuffer();
    if (!isPdf(buf)) { log.push([f.name, "✗ not a PDF: a web page was saved; download it again via the PDF button"]); continue; }
    let text = "";
    try { text = (await pdfToText(buf)).text; } catch (e) { log.push([f.name, `✗ unreadable PDF (${e.message})`]); continue; }
    const m = matchPdf(f.name, text.slice(0, 8000), recs);
    if (!m.rid) { log.push([f.name, `✗ ${m.why}`]); continue; }
    const r = recs.find(x => x.rid === m.rid);
    await putText(p.id, r.rid, text);
    p.fulltext[r.rid] = { method: text.length < 200 ? "pdf-scanned" : "pdf-local", source_url: f.name, chars: text.length, failed: text.length < 200 };
    log.push([f.name, `✓ #${r.rid} ${r.title.slice(0, 60)} (${m.why})${text.length < 200 ? " · no text layer (scanned): needs OCR" : ""}`]);
    n++;
  }
  ctx.save();
  modal(`${n} of ${files.length} PDFs added`, h("div", {}, table([{ label: "File", render: x => x[0] }, { label: "Result", render: x => x[1] }], log, { limit: 500 })), { wide: true });
  ctx.rerender();
}

function pickFolder() {
  return new Promise(resolve => {
    const inp = h("input", { type: "file", webkitdirectory: true, multiple: true });
    inp.addEventListener("change", () => resolve([...inp.files]));
    inp.click();
  });
}

// Every open route a browser can reach, in order; the local helper adds publisher pages and PDFs on hosts without CORS.
async function fetchAuto(ctx, recs, prog, helper) {
  const p = ctx.project;
  let n = 0;
  const save = async (r, text, method, url) => {
    await putText(p.id, r.rid, text);
    p.fulltext[r.rid] = { ...(p.fulltext[r.rid] || {}), method, source_url: url || "", chars: text.length, failed: false };
    n++;
  };
  const pdfFrom = async url => {
    let buf = null;
    try { const res = await fetch(url); if (res.ok) buf = await res.arrayBuffer(); } catch { /* no CORS: try the helper */ }
    if ((!buf || !isPdf(buf)) && helper) { const res = await localFetch(url).catch(() => null); if (res?.pdf) buf = res.pdf; else if (res?.text?.length > MIN_CHARS) return res.text; }
    return buf && isPdf(buf) ? (await pdfToText(buf)).text : "";
  };
  await pool(recs, 3, async r => {
    if (!r.doi && !r.pmid && !r.pmcid) return;
    const e = await europePmcFullText(r.doi, r.pmid).catch(() => null);
    if (e?.text?.length > MIN_CHARS) return save(r, e.text, "europepmc-oa", e.url);
    const pmcid = r.pmcid || e?.pmcid;
    if (pmcid) { const t = await pmcText(pmcid).catch(() => ""); if (t.length > MIN_CHARS) return save(r, t, "pmc", `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`); }
    const u = r.doi ? await unpaywall(r.doi).catch(() => null) : null;
    const urls = [];
    if (isPreprintDoi(r.doi) === "arXiv") urls.push(`https://arxiv.org/pdf/${r.doi.split(/arxiv\./i)[1]}`);
    for (const l of u?.locations || []) if (l.pdf) urls.push(l.pdf.replace(/^http:/, "https:"));
    for (const url of [...new Set(urls)]) {
      const t = await pdfFrom(url).catch(() => "");
      if (t.length > MIN_CHARS) return save(r, t, /arxiv/.test(url) ? "arxiv-pdf" : "oa-pdf", url);
    }
    if (helper) {
      const url = p.resolve[r.rid]?.resolved_url || (r.doi ? `https://doi.org/${r.doi}` : r.link);
      const res = url ? await localFetch(url).catch(() => null) : null;
      const t = res?.pdf ? (await pdfToText(res.pdf)).text : res?.text || "";
      if (t.length > MIN_CHARS) return save(r, t, res.pdf ? "publisher-pdf" : "publisher-html", res.url);
    }
    p.fulltext[r.rid] = { ...(p.fulltext[r.rid] || {}), method: "not-found", failed: true, pmcid: pmcid || "",
      oa_pdf: u?.pdf || "", oa_landing: u?.landing || "", oa_status: u?.status || (u ? "closed" : ""), is_oa: !!u?.is_oa || !!pmcid };
  }, (d, t) => prog.set(d, t, `· ${n} texts`));
  ctx.save(); toast(`${n} full texts found automatically`); ctx.rerender();
}

// What is left: open each in the browser (library access), save the PDF, add the folder.
function manualCard(ctx, recs) {
  const p = ctx.project;
  const links = r => {
    const f = p.fulltext[r.rid] || {};
    const pmcid = r.pmcid || f.pmcid;
    return [pmcid && ["PMC (free)", `https://pmc.ncbi.nlm.nih.gov/articles/${pmcid}/`], f.oa_pdf && ["open PDF", f.oa_pdf], r.doi && ["publisher", `https://doi.org/${r.doi}`], !r.doi && r.link && ["link", r.link]].filter(Boolean);
  };
  const access = r => { const f = p.fulltext[r.rid] || {}; return f.is_oa || r.pmcid ? "free" : f.oa_status === "closed" ? "subscription" : f.method ? "subscription?" : "not searched yet"; };
  return card(`Download by hand (${recs.length})`,
    help("Open each paper in your browser (on the university network or with the library login for subscriptions), download the PDF and save it in one folder. ",
      "Then use ", h("strong", {}, "Add a folder…"), " above. Saving as the suggested name helps, but Sieve also recognises the paper from the PDF itself."),
    row(btn("Download list (HTML page)", () => download(`${p.id}-download-list.html`, manualHtml(p, recs, links, access), "text/html"), "sm"),
      btn("Worklist (CSV)", () => worklist(ctx, recs), "ghost sm"),
      btn("Open the first 5 in tabs", () => recs.slice(0, 5).forEach(r => { const l = links(r)[0]; if (l) window.open(l[1], "_blank", "noopener"); }), "ghost sm")),
    table([
      { label: "#", render: r => r.rid },
      { label: "Paper", cls: "title", render: r => `${r.title} (${r.year || "–"})` },
      { label: "Access", render: r => badge(access(r), access(r) === "free" ? "ok" : "warn") },
      { label: "Links", render: r => h("span", {}, links(r).map(([n, u], i) => [i ? " · " : "", h("a", { href: u, target: "_blank", rel: "noopener" }, n)])) },
      { label: "Save as", render: r => h("code", {}, `${r.rid}.pdf`) },
    ], recs, { limit: 500 }));
}

function manualHtml(p, recs, links, access) {
  const rows = recs.map(r => `<tr><td>${esc(r.rid)}</td><td>${esc(r.title)} (${esc(r.year || "")})</td><td class="${access(r) === "free" ? "free" : "sub"}">${esc(access(r))}</td><td>${links(r).map(([n, u]) => `<a href="${esc(u)}" target="_blank">${esc(n)}</a>`).join(" · ")}</td><td><code>${esc(r.rid)}.pdf</code></td></tr>`).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Download list · ${esc(p.name)}</title><style>body{font:14px system-ui;margin:24px;max-width:1100px}td,th{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}code{background:#eee;padding:1px 4px}.free{color:#1a7f37}.sub{color:#9a6700}</style>
<h2>Download by hand: ${recs.length} papers</h2><p>Open each paper, download the PDF and save it in one folder (the suggested name helps, but is not required). Then in Sieve, step 5 Full text: <b>Add a folder…</b></p>
<table><tr><th>#</th><th>Paper</th><th>Access</th><th>Links</th><th>Save as</th></tr>${rows}</table>`;
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
