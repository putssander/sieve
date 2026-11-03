// Small shared helpers: DOM building, text normalisation, IO, statistics.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function cleanText(s) {
  if (s === null || s === undefined) return "";
  const t = String(s);
  return t.toLowerCase() === "nan" ? "" : t.replace(/\s+/g, " ").trim();
}

export function normDoi(raw) {
  let s = cleanText(raw).toLowerCase();
  if (!s) return "";
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  const m = s.match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[.,;)]+$/, "") : "";
}

function normTitle(t) { return cleanText(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
export { normTitle };

// 0..1 similarity: max of token Jaccard and a bigram Dice coefficient.
export function titleSimilarity(a, b) {
  const na = normTitle(a), nb = normTitle(b);
  if (!na || !nb) return 0;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  const inter = [...ta].filter(x => tb.has(x)).length;
  const jacc = inter / new Set([...ta, ...tb]).size;
  const bigrams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ba = bigrams(na), bb = bigrams(nb);
  let overlap = 0;
  for (const [g, n] of ba) overlap += Math.min(n, bb.get(g) || 0);
  const dice = (2 * overlap) / (na.length - 1 + nb.length - 1);
  return Math.round(Math.max(jacc, dice) * 1000) / 1000;
}

// Best-effort parse of a JSON object from model output (```json fences, <think> blocks, prose).
export function extractJson(text) {
  if (!text) throw new Error("empty model output");
  text = String(text).replace(/<think>[\s\S]*?<\/think>/g, "");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  let start = text.search(/[{[]/);
  while (start !== -1) {
    const open = text[start], close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, escNext = false;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (escNext) escNext = false; else if (c === "\\") escNext = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { break; }
      }
    }
    const next = text.slice(start + 1).search(/[{[]/);
    start = next === -1 ? -1 : start + 1 + next;
  }
  throw new Error("no valid JSON found in the pasted/model output");
}

// Is a (short) evidence quote present in the source text? Whitespace, case, quote style insensitive.
export function quoteInSource(quote, source) {
  const n = s => cleanText(s).toLowerCase().replace(/[“”„"]/g, '"').replace(/[‘’`]/g, "'").replace(/[‐-―]/g, "-").replace(/\s*…\s*|\.\.\./g, " … ");
  const q = n(quote).replace(/^["']|["']$/g, "");
  if (!q || q.startsWith("no direct quote")) return null;
  const src = n(source);
  // Quotes may be stitched with an ellipsis; every part must be present (ignoring edge punctuation).
  return q.split(" … ").map(p => p.trim().replace(/^[\s.,;:"'(]+|[\s.,;:"')]+$/g, "")).filter(p => p.length > 3).every(p => src.includes(p));
}

// Quoted fragments inside a free-text evidence paragraph (curly quotes first, then straight pairs).
export function quotedFragments(text) {
  const s = String(text || "");
  const curly = [...s.matchAll(/“([^”]{6,})”/g)].map(m => m[1]);
  if (curly.length) return curly;
  return [...s.matchAll(/(?:^|[\s(:])"([^"]{6,}?)"(?=[\s.,;:)]|$)/g)].map(m => m[1]);
}

export function download(name, content, type = "application/json") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function pickFile(accept = "", multiple = false) {
  return new Promise(resolve => {
    const inp = h("input", { type: "file", accept, multiple });
    inp.addEventListener("change", () => resolve(multiple ? [...inp.files] : inp.files[0] || null));
    inp.click();
  });
}

export const readText = f => f.text();
export const readBuf = f => f.arrayBuffer();

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied to clipboard"); }
  catch { toast("Copy failed: select the text and copy manually", "warn"); }
}

export function toast(msg, kind = "ok") {
  let host = document.getElementById("toasts");
  if (!host) { host = h("div", { id: "toasts" }); document.body.appendChild(host); }
  const t = h("div", { class: `toast ${kind}` }, msg);
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 8000 : 3500);
}

export function toCsv(rows, cols) {
  cols = cols || [...new Set(rows.flatMap(r => Object.keys(r)))];
  const q = v => { const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\n");
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === "," || c === "\t" && !text.slice(0, 2000).includes(",")) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.some(x => x !== ""));
  return body.map(r => Object.fromEntries(head.map((k, i) => [k.trim(), r[i] ?? ""])));
}

export function fmt(n) { return n === null || n === undefined || n === "" ? "–" : Number(n).toLocaleString("en-US"); }
export function pct(a, b) { return b ? `${Math.round((100 * a) / b)}%` : "–"; }
export function today() { return new Date().toISOString().slice(0, 10); }
export function slug(s) { return cleanText(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item"; }

// Cohen's kappa for two raters over paired labels (null/undefined pairs are skipped).
export function kappa(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => x !== null && x !== undefined && y !== null && y !== undefined);
  const n = pairs.length;
  if (!n) return { n: 0, kappa: null, agree: null };
  const labels = [...new Set(pairs.flat())];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  let pe = 0;
  for (const l of labels) pe += (pairs.filter(([x]) => x === l).length / n) * (pairs.filter(([, y]) => y === l).length / n);
  return { n, agree: po, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe) };
}

// Wilson score interval for a proportion.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - m) / d), Math.min(1, (c + m) / d)];
}

// Run async fn over items with a concurrency limit; onProgress(done, total). Honour signal.aborted.
export async function pool(items, limit, fn, onProgress, signal) {
  let i = 0, done = 0;
  const out = new Array(items.length);
  async function worker() {
    while (i < items.length) {
      if (signal?.aborted) return;
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { _error: String(e?.message || e) }; }
      onProgress?.(++done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
  return out;
}

const loaded = {};
export function loadScript(src) {
  if (!loaded[src]) loaded[src] = new Promise((res, rej) => {
    const s = h("script", { src }); s.onload = res; s.onerror = () => rej(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
  return loaded[src];
}

export const LIBS = {
  xlsx: "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
  mammoth: "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js",
  pdfjs: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs",
  pdfworker: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs",
};

export async function XLSX() { await loadScript(LIBS.xlsx); return window.XLSX; }

export async function pdfToText(buf) {
  const pdfjs = await import(LIBS.pdfjs);
  pdfjs.GlobalWorkerOptions.workerSrc = LIBS.pdfworker;
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const parts = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    parts.push(tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join(""));
  }
  return { text: parts.join("\n").replace(/[ \t]+/g, " ").trim(), pages: doc.numPages };
}

export async function docxToText(buf) {
  await loadScript(LIBS.mammoth);
  const r = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return r.value;
}

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,footer,header,aside,form,noscript").forEach(n => n.remove());
  return cleanText(doc.body?.textContent || "");
}
