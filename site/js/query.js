// Search-string model and translation.
//
// A search is a list of concept blocks. Each block is a list of terms written in PubMed syntax,
// one per line:   "machine learning"[tiab]   Artificial Intelligence[Mesh]   implement*[ti]
// plus one macro for proximity sets:
//   NEAR/4(artificial intelligence | AI | machine learning ; implementation | implemented | deployed)[tiab]
// which expands to every pair "a b"[tiab:~4] in PubMed, (a or b) adj4 (x or y) in Ovid, NEAR/4 in WoS.
//
// Query = (include block 1) AND (include block 2) ... NOT ((exclude block 1) OR ...)

const NEAR_RE = /^NEAR\/(\d+)\s*\(([\s\S]*)\)\s*(?:\[([^\]]+)\])?$/i;
const TERM_RE = /^("([^"]+)"|([^\s()"[\]]+))\s*\[([^\]]+)\]$/;

export function parseTerm(line) {
  const s = line.trim();
  const near = s.match(NEAR_RE);
  if (near) {
    const [left, right] = near[2].split(";").map(side => side.split("|").map(w => w.trim()).filter(Boolean));
    return { kind: "near", n: Number(near[1]), left: left || [], right: right || [], field: (near[3] || "tiab").toLowerCase(), src: s };
  }
  const m = s.match(TERM_RE);
  if (m) return { kind: "term", text: m[2] ?? m[3], quoted: !!m[2], field: normField(m[4]), src: s };
  // Unquoted phrase such as  systematic review[pt]
  const mw = s.match(/^([A-Za-z0-9*'\- ]+?)\s*\[([^\]]+)\]$/);
  if (mw && !/\b(AND|OR|NOT)\b/.test(mw[1])) return { kind: "term", text: mw[1].trim(), quoted: true, field: normField(mw[2]), src: s };
  return { kind: "raw", src: s };
}

function normField(f) {
  const x = f.trim().toLowerCase().replace(/\s+/g, " ");
  return { mh: "mesh", "mh:noexp": "mesh:noexp", "mesh terms": "mesh", "title/abstract": "tiab", title: "ti", abstract: "ab",
    "publication type": "pt", "majr": "majr", "all fields": "all", "text word": "tw" }[x] || x;
}

export const blockTerms = b => (b.terms || []).map(t => t.trim()).filter(t => t && !t.startsWith("#"));

// ------------------------------------------------------------------ PubMed
function pmTerm(t) {
  if (t.kind === "near") {
    const fld = t.field === "ti" ? "ti" : "tiab";
    return t.left.flatMap(a => t.right.map(b => `"${a} ${b}"[${fld}:~${t.n}]`)).join(" OR ");
  }
  if (t.kind === "raw") return /\s(AND|OR|NOT)\s/.test(t.src) && !/^\(.*\)$/.test(t.src) ? `(${t.src})` : t.src;
  return t.src;
}

export function pmBlock(b, skip = -1) {
  const parts = blockTerms(b).filter((_, i) => i !== skip).map(l => pmTerm(parseTerm(l)));
  return parts.length ? `(${parts.join(" OR ")})` : "";
}

// Full query. `override` lets diagnostics swap one block's text, e.g. {blockId: "(...)"}.
export function pmQuery(blocks, { override = {}, only } = {}) {
  const active = blocks.filter(b => b.enabled !== false && (!only || only.includes(b.id)));
  const q = b => override[b.id] ?? pmBlock(b);
  const inc = active.filter(b => b.role !== "exclude").map(q).filter(Boolean);
  const exc = active.filter(b => b.role === "exclude").map(q).filter(Boolean);
  let s = inc.join(" AND ");
  if (exc.length && s) s = `(${s}) NOT (${exc.join(" OR ")})`;
  return s;
}

// ------------------------------------------------------------------ translations
const q = w => (/[\s-]/.test(w) && !/^".*"$/.test(w) ? `"${w}"` : w);

const OVID_FIELDS = {
  medline: { tiab: "ti,ab,kf", ti: "ti", ab: "ab", tw: "tw", all: "mp", pt: "pt" },
  embase: { tiab: "ti,ab,kw", ti: "ti", ab: "ab", tw: "tw", all: "mp", pt: "pt" },
};
const WOS_FIELDS = { tiab: "TS", ti: "TI", ab: "AB", tw: "TS", all: "ALL" };
const WOS_PT = { review: "Review", editorial: "Editorial Material", letter: "Letter", news: "News Item", "retracted publication": "Retracted Publication",
  "published erratum": "Correction", comment: "Editorial Material", "systematic review": "Review", "meta-analysis": "Review" };

function ovidTerm(t, db, warn) {
  const F = OVID_FIELDS[db];
  if (t.kind === "near") {
    const fld = F[t.field] || F.tiab;
    return { field: fld, text: `((${t.left.map(q).join(" or ")}) adj${t.n} (${t.right.map(q).join(" or ")}))` };
  }
  if (t.kind === "raw") return { field: null, text: ovidRaw(t.src, db, warn) };
  const txt = t.quoted ? `"${t.text}"` : t.text;
  if (t.field.startsWith("mesh") || t.field === "majr") {
    if (db === "embase") warn.add(`Map MeSH "${t.text}" to its Emtree heading (Ovid Map Term).`);
    const head = db === "embase" ? t.text.toLowerCase() : t.text;
    return { field: null, text: `${t.field === "mesh:noexp" ? "" : "exp "}${t.field === "majr" ? "*" : ""}${head}/` };
  }
  const prox = t.field.match(/^(tiab|ti):~(\d+)$/);
  if (prox) return { field: F[prox[1]], text: `(${t.text.split(/\s+/).map(q).join(` adj${prox[2]} `)})` };
  if (t.field === "pt" && db === "embase") warn.add(`Check Embase publication type for "${t.text}" (e.g. conference abstract, review, editorial).`);
  if (!F[t.field]) warn.add(`Field [${t.field}] has no Ovid equivalent; used .mp. for ${t.src}`);
  return { field: F[t.field] || "mp", text: txt };
}

// Token-level translation for complex lines such as  ("A"[Mesh] NOT ("B"[Mesh] OR "C"[Mesh])).
function ovidRaw(src, db, warn) {
  return src.replace(/("([^"]+)"|[^\s()"[\]]+)\s*\[([^\]]+)\]/g, m => {
    const t = parseTerm(m);
    const r = ovidTerm(t, db, warn);
    return r.field ? `${r.text}.${r.field}.` : r.text;
  }).replace(/\b(AND|OR|NOT)\b/g, x => x.toLowerCase());
}

export function toOvid(blocks, db = "medline") {
  const warn = new Set();
  const lines = [];
  const add = s => (lines.push(s), lines.length);
  const blockLine = {};
  for (const b of blocks.filter(b => b.enabled !== false)) {
    const parts = blockTerms(b).map(l => ovidTerm(parseTerm(l), db, warn));
    const nums = [];
    const unfielded = parts.filter(p => !p.field);
    if (unfielded.length) nums.push(add(unfielded.map(p => p.text).join(" or ")));
    const byField = {};
    for (const p of parts.filter(p => p.field)) (byField[p.field] ||= []).push(p.text);
    for (const [f, ts] of Object.entries(byField)) nums.push(add(`(${ts.join(" or ")}).${f}.`));
    if (!nums.length) continue;
    blockLine[b.id] = nums.length === 1 ? nums[0] : add(`or/${nums[0]}-${nums[nums.length - 1]}`);
    lines[blockLine[b.id] - 1] += `    [${b.label}]`;
  }
  const inc = blocks.filter(b => b.enabled !== false && b.role !== "exclude" && blockLine[b.id]).map(b => blockLine[b.id]);
  const exc = blocks.filter(b => b.enabled !== false && b.role === "exclude" && blockLine[b.id]).map(b => blockLine[b.id]);
  if (inc.length) {
    const comb = inc.length > 1 ? add(inc.join(" and ")) : inc[0];
    if (exc.length) add(`${comb} not (${exc.join(" or ")})`);
  }
  if (db === "medline") warn.add("Ovid adjN and PubMed [tiab:~N] are close but not identical; counts will differ somewhat.");
  return { text: lines.map((l, i) => `${String(i + 1).padEnd(3)}${l}`).join("\n"), warnings: [...warn] };
}

function wosTerm(t, warn) {
  if (t.kind === "near") return { field: WOS_FIELDS[t.field] || "TS", text: `((${t.left.map(q).join(" OR ")}) NEAR/${t.n} (${t.right.map(q).join(" OR ")}))` };
  if (t.kind === "raw") {
    let kept = 0;
    let text = t.src.replace(/("([^"]+)"|[^\s()"[\]]+)\s*\[([^\]]+)\]/g, m => {
      const r = wosTerm(parseTerm(m), warn);
      if (r.text) kept++;
      return r.text ? (r.field ? `${r.field}=${r.text}` : r.text) : "";
    });
    if (!kept) return { field: null, text: "" };
    // Tidy operators left dangling by dropped MeSH terms.
    for (let i = 0; i < 5; i++) text = text.replace(/\(\s*\)/g, "").replace(/\b(AND|OR|NOT)\s+(?=\)|$|\b(AND|OR|NOT)\b)/g, "").replace(/\(\s*(AND|OR)\s+/g, "(").trim();
    warn.add(`Complex line translated token by token, check by hand: ${t.src.slice(0, 80)}`);
    return { field: null, text };
  }
  if (t.field.startsWith("mesh") || t.field === "majr") { (warn.mesh ||= []).push(t.text); return { field: null, text: "" }; }
  if (t.field === "pt") {
    const dt = WOS_PT[t.text.toLowerCase()];
    if (!dt) { warn.add(`No WoS document type for ${t.src}; dropped.`); return { field: null, text: "" }; }
    return { field: "DT", text: `"${dt}"` };
  }
  const prox = t.field.match(/^(tiab|ti):~(\d+)$/);
  if (prox) return { field: WOS_FIELDS[prox[1]], text: `(${t.text.split(/\s+/).map(q).join(` NEAR/${prox[2]} `)})` };
  return { field: WOS_FIELDS[t.field] || "TS", text: t.quoted ? `"${t.text}"` : t.text };
}

export function toWos(blocks) {
  const warn = new Set();
  const lines = [], ids = {};
  for (const b of blocks.filter(b => b.enabled !== false)) {
    const parts = blockTerms(b).map(l => wosTerm(parseTerm(l), warn)).filter(p => p.text);
    const byField = {};
    const loose = [];
    for (const p of parts) p.field ? (byField[p.field] ||= []).push(p.text) : loose.push(p.text);
    const segs = [...Object.entries(byField).map(([f, ts]) => `${f}=(${[...new Set(ts)].join(" OR ")})`), ...loose];
    if (!segs.length) continue;
    lines.push(`${segs.join(" OR ")}    [${b.label}]`);
    ids[b.id] = lines.length;
  }
  const inc = blocks.filter(b => b.enabled !== false && b.role !== "exclude" && ids[b.id]).map(b => `#${ids[b.id]}`);
  const exc = blocks.filter(b => b.enabled !== false && b.role === "exclude" && ids[b.id]).map(b => `#${ids[b.id]}`);
  if (inc.length > 1) lines.push(inc.join(" AND "));
  if (exc.length) lines.push(`#${lines.length} NOT (${exc.join(" OR ")})`);
  if (warn.mesh) warn.add(`WoS has no MeSH: dropped ${warn.mesh.length} subject headings (${[...new Set(warn.mesh)].slice(0, 6).join(", ")}…). Their free-text synonyms must carry recall.`);
  warn.add("TS= also searches Keywords Plus; if WoS is noisy, use (TI=… OR AB=… OR AK=…) instead.");
  return { text: lines.map((l, i) => `#${String(i + 1).padEnd(3)}${l}`).join("\n"), warnings: [...warn] };
}

// Terms that appear in one version but not the other (per block), for the version diff.
export function diffBlocks(a, b) {
  const out = [];
  const ids = new Set([...a.map(x => x.id), ...b.map(x => x.id)]);
  for (const id of ids) {
    const A = new Set(blockTerms(a.find(x => x.id === id) || {})), B = new Set(blockTerms(b.find(x => x.id === id) || {}));
    const added = [...B].filter(t => !A.has(t)), removed = [...A].filter(t => !B.has(t));
    if (added.length || removed.length) out.push({ id, label: (b.find(x => x.id === id) || a.find(x => x.id === id)).label, added, removed });
  }
  return out;
}
