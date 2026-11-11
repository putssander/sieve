// Line-numbered database strategies (Ovid style) and their translation to other databases.
//
// Input is what librarians and students write in a search table or an Ovid search history:
//   1  exp Artificial Intelligence/ not (exp Robotics/ or exp Fuzzy Logic/)
//   2  ("artificial intelligence*" or AI or "machine learning").ti,ab,kf.
//   3  1 or 2
//   4  ((AI or "machine learning") adj4 (implement* or deploy*)).ti,ab,kf.
//   5  or/3-4
//   6  (review or editorial).pt.
//   7  5 not 6
//   8  limit 7 to yr="2020-current"
//
// parseStrategyText()   pasted text / Word table rows → [{ n, label, query, count }]
// parseOvid()           one Ovid line → syntax tree
// translateStrategy()   lines → MEDLINE (Ovid), Embase (Ovid), Web of Science, PsycInfo (EBSCO), ACM DL,
//                       Cochrane Library (CENTRAL)
//
// Everything here is plain functions without DOM access, so it runs in node tests and the CLI.

export const TARGETS = {
  medline: { label: "MEDLINE (Ovid)", short: "MEDLINE" },
  embase: { label: "Embase (Ovid)", short: "Embase" },
  wos: { label: "Web of Science Core Collection", short: "WoS" },
  psycinfo: { label: "APA PsycInfo (EBSCOhost)", short: "PsycInfo" },
  acm: { label: "ACM Digital Library", short: "ACM" },
  cochrane: { label: "Cochrane Library (CENTRAL)", short: "Cochrane" },
};

// ================================================================== reading strategies
const DB_RE = /^(medline|pubmed|embase|wos|web of science|psyc ?info|psycinfo|acm|cinahl|scopus|cochrane|ieee|eric|lisa)\b/i;
const normQuotes = s => String(s ?? "").replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'").replace(/ /g, " ");

// Rows of a Word/Excel table (first row = header) → strategy, or null if the table is not a search table.
export function strategyFromTable(rows, name = "Strategy") {
  if (!rows?.length) return null;
  const head = rows[0].map(c => c.trim().toLowerCase());
  const qi = head.findIndex(c => /^(search|query|search string|search terms?|strategy|string)\b/.test(c));
  if (qi < 0) return null;
  const ni = head.findIndex(c => /^(#|no\.?|nr\.?|line|step|set)$/.test(c));
  const ci = head.findIndex((c, i) => i !== ni && /(#\s*results?|results?|hits|count|records)/.test(c));
  const li = head.findIndex((c, i) => i !== qi && i !== ni && i !== ci);
  const body = rows.slice(1).map(r => ({
    n: ni >= 0 ? parseInt(r[ni], 10) || null : null,
    label: li >= 0 ? (r[li] || "").replace(/\s*\n\s*/g, " · ").trim() : "",
    query: (r[qi] || "").replace(/\s*\n\s*/g, " ").trim(),
    count: ci >= 0 ? parseCount(r[ci]) : null,
  }));
  const named = body.filter(r => r.label);
  const kind = named.length && named.filter(r => DB_RE.test(r.label)).length >= named.length / 2 ? "by-database" : "lines";
  return { name, kind, lines: kind === "lines" ? numberLines(body) : body.filter(r => r.query) };
}

// Pasted text: an Ovid search history ("1  exp X/  (12345)"), a strategy copied from a Word table
// (tab-separated: concept, search, #results) or the app's own "n | label | query | count" format.
export function parseStrategyText(text, name = "Pasted strategy") {
  const rawLines = normQuotes(text).split(/\r?\n/).filter(l => l.trim());
  const splitter = l => (l.includes("\t") ? l.split("\t") : / \| /.test(l) ? l.split(/ \| /) : null);
  if (rawLines.some(l => splitter(l))) {
    const rows = rawLines.map(l => (splitter(l) || [l]).map(c => c.trim()));
    if (rows[0].some(c => /^(search|query)/i.test(c))) return strategyFromTable(rows, name);
    const body = rows.map(r => {
      if (r.length === 1) return { n: null, label: "", query: r[0], count: null };
      const hasN = /^#?\d+\.?$/.test(r[0]);
      const rest = hasN ? r.slice(1) : r;
      const countLast = rest.length > 1 && /^[\d.,\s]*$/.test(rest[rest.length - 1]);
      const core = countLast ? rest.slice(0, -1) : rest;
      return { n: hasN ? parseInt(r[0].replace("#", ""), 10) : null, label: core.length > 1 ? core[0] : "", query: core[core.length - 1], count: countLast ? parseCount(rest[rest.length - 1]) : null };
    });
    return { name, kind: "lines", lines: numberLines(body) };
  }
  const body = rawLines.map(l => {
    let s = l.trim(), n = null, count = null, label = "";
    // "3  or/1-2" and "3. exp X/" carry a line number; "1 or 2" is a combination without one.
    const mn = s.match(/^#?(\d+)([.):]?)(\s+)(.*)$/);
    if (mn && (mn[2] || mn[3].length >= 2 || !/^(or|and|not)\s/i.test(mn[4]))) { n = Number(mn[1]); s = mn[4]; }
    const mc = s.match(/^(.*\S)\s+\(([\d.,]+)\)\s*$/);
    if (mc && !/\b(or|and|not)\s*$/i.test(mc[1])) { s = mc[1]; count = parseCount(mc[2]); }
    const ml = s.match(/^(.*\S)\s{2,}\[([^\]]+)\]\s*$/);
    if (ml) { s = ml[1]; label = ml[2]; }
    return { n, label, query: s, count };
  });
  return { name, kind: "lines", lines: numberLines(body) };
}

function parseCount(s) {
  const d = String(s ?? "").replace(/[^\d]/g, "");
  return d ? Number(d) : null;
}

// Rows without a search are notes, not lines. A limit written with a placeholder
// ("Limit … to yr=2020-current") has no number of its own: it applies to the final line.
function numberLines(body) {
  const out = [];
  let next = 1;
  for (const r of body) {
    const q = normQuotes(r.query).trim();
    if (!q) continue;
    if (/^limit\s*(…|\.\.\.|x|n)\s+to\b/i.test(q)) { out.push({ ...r, query: q, n: null, deferred: true }); continue; }
    const n = r.n ?? next;
    next = n + 1;
    out.push({ ...r, query: q, n });
  }
  return out;
}

// Turns the strategy back into the editable text format.
export function strategyToText(s) {
  return s.lines.map(l => [l.deferred ? "" : l.n, l.label || "", l.query, l.count ?? ""].join(" | ")).join("\n");
}

// ================================================================== Ovid syntax
// Node types
//   { t: "or" | "and" | "not", a: [nodes] }   ("not": a[0] not a[1] not a[2] ...)
//   { t: "adj", n, a: [left, right] }
//   { t: "ref", n }
//   { t: "head", term, exp, major, sub }        subject heading
//   { t: "text", v, q, f }                      word or phrase; q = quoted; f = ["ti","ab","kf"] or null (= .mp.)
//   { t: "limit", ref, yr: [from, to|null], other: [] }
const OPS = new Set(["or", "and", "not"]);
const FIELD_RE = /^\.([a-z]{2}(?:,[a-z]{2})*)\.?$/i;

function tokenize(src) {
  const s = normQuotes(src);
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { out.push({ k: c }); i++; continue; }
    if (c === '"') {
      const j = s.indexOf('"', i + 1);
      const end = j < 0 ? s.length : j;
      out.push({ k: "q", v: s.slice(i + 1, end).trim().replace(/\s+/g, " ") });
      if (j < 0) out.push({ k: "err", v: "unbalanced quote" });
      i = end + 1;
      continue;
    }
    if (c === "/") {
      const m = s.slice(i + 1).match(/^([a-z]{2}(?:,[a-z]{2})*)?(?=[\s)]|$)/i);
      const sub = m?.[1] && !OPS.has(m[1].toLowerCase()) ? m[1] : null;
      out.push({ k: "/", sub });
      i += 1 + (sub ? sub.length : 0);
      continue;
    }
    if (c === "." && FIELD_RE.test((s.slice(i).match(/^\.[a-z]{2}(?:,[a-z]{2})*\.?/i) || [""])[0])) {
      const m = s.slice(i).match(/^\.([a-z]{2}(?:,[a-z]{2})*)\.?/i);
      out.push({ k: "f", v: m[1].toLowerCase().split(",") });
      i += m[0].length;
      continue;
    }
    const comb = s.slice(i).match(/^(or|and)\/(\d+(?:\s*[-,]\s*\d+)*)/i);   // or/7-11, and/1,3
    if (comb) { out.push({ k: "comb", op: comb[1].toLowerCase(), refs: expandRange(comb[2]) }); i += comb[0].length; continue; }
    // A word runs until whitespace, a bracket, a quote or a slash.
    let j = i;
    while (j < s.length && !/[\s()"/]/.test(s[j])) j++;
    let w = s.slice(i, j);
    i = j;
    const mf = w.match(/^(.+?)\.([a-z]{2}(?:,[a-z]{2})*)\.?$/i);       // word.ti,ab.
    if (mf && !/^\d+$/.test(mf[1])) { pushWord(out, mf[1]); out.push({ k: "f", v: mf[2].toLowerCase().split(",") }); continue; }
    pushWord(out, w);
  }
  return out;
}

function pushWord(out, w) {
  const lw = w.toLowerCase();
  const comb = lw.match(/^(or|and)\/([\d,\s-]+)$/);
  if (comb) { out.push({ k: "comb", op: comb[1], refs: expandRange(comb[2]) }); return; }
  if (OPS.has(lw)) { out.push({ k: "op", v: lw }); return; }
  const adj = lw.match(/^adj(\d*)$/);
  if (adj) { out.push({ k: "op", v: "adj", n: adj[1] ? Number(adj[1]) : 1 }); return; }
  if (/^\d+$/.test(w)) { out.push({ k: "num", v: Number(w) }); return; }
  out.push({ k: "w", v: w });
}

function expandRange(s) {
  const out = [];
  for (const part of s.split(",").map(x => x.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map(Number);
    if (b) for (let i = a; i <= b; i++) out.push(i); else out.push(a);
  }
  return out;
}

// Parse one Ovid line. Returns { node, warnings }.
export function parseOvid(src) {
  const warnings = [];
  const q = normQuotes(src).trim();
  const lim = q.match(/^limit\s+(\d+|…|\.\.\.)\s+to\s+(.+)$/i);
  if (lim) return { node: parseLimit(lim[1], lim[2], warnings), warnings };
  const toks = tokenize(q);
  if (toks.some(t => t.k === "err")) warnings.push("Unbalanced quotation marks.");
  let pos = 0;
  const peek = () => toks[pos];
  const node = parseExpr();
  if (pos < toks.length) warnings.push(`Could not read the end of the line: "${toks.slice(pos).map(t => t.v ?? t.k).join(" ")}" (unbalanced brackets?)`);
  return { node, warnings };

  // Binary operators: adjN binds tighter than and/or/not. Mixed and/or/not without brackets is
  // read left to right and reported, because databases differ in how they rank them.
  function parseExpr() {
    let left = parseAdj();
    const ops = [];
    while (peek()?.k === "op" && peek().v !== "adj") {
      const op = toks[pos++].v;
      ops.push(op);
      const right = parseAdj();
      if (!right) break;
      left = left?.t === op && op !== "not" ? { t: op, a: [...left.a, right] } : left?.t === "not" && op === "not" ? { t: "not", a: [...left.a, right] } : { t: op, a: [left, right] };
    }
    if (new Set(ops).size > 1) warnings.push(`Mixed ${[...new Set(ops)].join("/")} without brackets in "${q.slice(0, 70)}…": read left to right. Add brackets to make the intended grouping explicit.`);
    return left;
  }
  function parseAdj() {
    let left = parseUnit();
    while (peek()?.k === "op" && peek().v === "adj") {
      const n = toks[pos++].n;
      const right = parseUnit();
      left = { t: "adj", n, a: [left, right] };
    }
    return left;
  }
  function parseUnit() {
    const t = peek();
    if (!t) return null;
    let node;
    if (t.k === "(") {
      pos++;
      node = parseExpr();
      if (peek()?.k === ")") pos++; else warnings.push("Missing closing bracket.");
    } else if (t.k === "comb") {
      pos++;
      node = { t: t.op, a: t.refs.map(n => ({ t: "ref", n })) };
    } else if (t.k === "num") {
      pos++;
      node = { t: "ref", n: t.v };
    } else if (t.k === "q" || t.k === "w") {
      node = parseTerm();
    } else { pos++; return parseUnit(); }
    if (peek()?.k === "f") applyFields(node, toks[pos++].v);
    return node;
  }
  // Consecutive words form a phrase; followed by "/" they form a subject heading.
  function parseTerm() {
    let exp = false, major = false;
    const words = [];
    let quoted = false;
    while (peek() && (peek().k === "w" || peek().k === "q" || (peek().k === "num" && words.length))) {
      const t = toks[pos++];
      if (t.k === "num") { words.push(String(t.v)); continue; }
      if (t.k === "q") { words.push(t.v); quoted = true; continue; }
      if (!words.length && t.v.toLowerCase() === "exp" && (peek()?.k === "w" || peek()?.k === "q")) { exp = true; continue; }
      words.push(t.v);
    }
    let text = words.join(" ");
    if (peek()?.k === "/") {
      const sub = toks[pos++].sub;
      if (text.startsWith("*")) { major = true; text = text.slice(1); }
      return { t: "head", term: text.trim(), exp, major, sub };
    }
    if (exp) text = `exp ${text}`;
    return { t: "text", v: text, q: quoted || words.length > 1, f: null };
  }
}

function applyFields(node, f) {
  if (!node) return;
  if (node.t === "text") { node.f ||= f; return; }
  if (node.a) node.a.forEach(c => applyFields(c, f));
}

function parseLimit(ref, rest, warnings) {
  const node = { t: "limit", ref: /^\d+$/.test(ref) ? Number(ref) : null, yr: null, other: [] };
  for (const part of rest.split(/\s+and\s+|,\s*/i).map(x => x.trim()).filter(Boolean)) {
    const y = part.match(/^yr\s*=\s*"?\s*(\d{4})\s*-\s*(\d{4}|current)\s*"?$/i);
    if (y) node.yr = [Number(y[1]), y[2].toLowerCase() === "current" ? null : Number(y[2])];
    else node.other.push(part.replace(/^"|"$/g, ""));
  }
  if (!node.yr && !node.other.length) warnings.push(`Could not read the limit "${rest}".`);
  return node;
}

// ================================================================== mappings
// Subject headings. MeSH (as written in the MEDLINE line) → Emtree / APA Thesaurus.
// Only a small built-in starting list; the project can override and extend it (headingMap)
// and the assistant can propose mappings. "raw:" values are used as written (any field).
export const DEFAULT_HEADINGS = {
  "artificial intelligence": { embase: "artificial intelligence", psycinfo: "Artificial Intelligence" },
  "machine learning": { embase: "machine learning", psycinfo: "Machine Learning" },
  "deep learning": { embase: "deep learning", psycinfo: "Deep Neural Networks" },
  "neural networks, computer": { embase: "artificial neural network", psycinfo: "Artificial Neural Networks" },
  "natural language processing": { embase: "natural language processing", psycinfo: "Natural Language Processing" },
  "generative artificial intelligence": { embase: "generative artificial intelligence", psycinfo: "Generative Artificial Intelligence" },
  "large language models": { embase: "large language model", psycinfo: "Large Language Models" },
  "fuzzy logic": { embase: "fuzzy logic", psycinfo: "Fuzzy Logic" },
  "robotics": { embase: "robotics", psycinfo: "Robotics" },
  "expert systems": { embase: "expert system", psycinfo: "Expert Systems" },
  "delivery of health care": { embase: "health care delivery", psycinfo: "Health Care Delivery" },
  "health personnel": { embase: "health care personnel", psycinfo: "Health Personnel" },
  "health facilities": { embase: "health care facility" },
  "hospitals": { embase: "hospital", psycinfo: "Hospitals" },
  "implementation science": { embase: "implementation science", psycinfo: "Implementation Science" },
  "diffusion of innovation": { embase: "diffusion of innovation" },
  "qualitative research": { embase: "qualitative research", psycinfo: "Qualitative Methods" },
  "interviews as topic": { embase: "interview", psycinfo: "Interviews" },
  "focus groups": { embase: "focus group", psycinfo: "Focus Group" },
  "surveys and questionnaires": { embase: "questionnaire", psycinfo: "Surveys" },
  "program evaluation": { embase: "program evaluation", psycinfo: "Program Evaluation" },
  "pilot projects": { embase: "pilot study" },
  "prospective studies": { embase: "prospective study" },
  "feasibility studies": { embase: "feasibility study" },
  "animals": { embase: "animal", psycinfo: "raw:PO Animal" },
  "humans": { embase: "human", psycinfo: "raw:PO Human" },
};

// Publication types (.pt.) per target. null = not available (dropped with a warning).
const PT = {
  embase: { review: "review.pt.", editorial: "editorial.pt.", letter: "letter.pt.", comment: "note.pt.", "published erratum": "erratum.pt.",
    "systematic review": "systematic review/", "meta analysis": "meta analysis/", "meta-analysis": "meta analysis/", news: null, "retracted publication": "retracted article/", "evaluation study": "evaluation study/" },
  wos: { review: "Review", editorial: "Editorial Material", letter: "Letter", news: "News Item", "retracted publication": "Retracted Publication",
    "published erratum": "Correction", comment: "Editorial Material", "systematic review": "Review", "meta analysis": "Review", "meta-analysis": "Review" },
  psycinfo: { review: 'PT "Review"', editorial: 'PT "Editorial"', letter: 'PT "Letter"', comment: 'PT "Comment/Reply"', "published erratum": 'PT "Erratum/Correction"',
    "systematic review": 'MD "Systematic Review"', "meta analysis": 'MD "Meta Analysis"', "meta-analysis": 'MD "Meta Analysis"' },
  acm: {},
};

// Cochrane Library Search Manager syntax (MECIR C24: search CENTRAL with MEDLINE and Embase). Sources:
//   https://www.cochranelibrary.com/search-manager-help (Search Manager help; also linked as "Search help" in the app)
//   https://www.cochranelibrary.com/documents/20182/439199364/Cochrane+Library+MeSH+Syntax.pdf (MeSH syntax, v1 Aug 2024)
//   https://epoc.cochrane.org/sites/epoc.cochrane.org/files/uploads/Resources-for-authors2017/database_syntax_guide.pdf
//   https://guides.lib.uw.edu/hsl/sr/searchtips (Cochrane column)
// - text words: term:ti,ab,kw  /  (a OR b):ti,ab,kw   (:kw also holds MeSH/Emtree index terms)
// - phrases in quotes; quoted phrases do NOT support truncation: use NEXT, e.g. (health NEXT behavio*)
// - * = zero or more characters (also inside a word), ? = exactly one character
// - [mh "Heading"] = MeSH exploded (default), [mh ^"Heading"] = not exploded
// - NEAR/n (any order, n words apart), NEXT (adjacent, in order); AND/OR/NOT; history #1 OR #2
// - dates are Search Limits (Cochrane Library publication date), not a field in the line
const COCHRANE_FIELDS = { ti: "ti", ab: "ab", kf: "kw", kw: "kw", tw: "ti,ab,kw", mp: "ti,ab,kw", pt: "pt" };

const currentYear = () => new Date().getFullYear();

// ================================================================== translation
// translateStrategy(strategy, target, { headings }) →
//   { lines: [{ n, label, text, note, from }], single, warnings }
// `single` is the final line written out as one string (no search history needed).
export function translateStrategy(strategy, target, { headings = {}, final } = {}) {
  if (!TARGETS[target]) throw new Error(`Unknown target ${target}`);
  const T = makeTarget(target, mergeHeadings(headings));
  const src = strategy.lines.filter(l => !l.deferred);
  const deferred = strategy.lines.filter(l => l.deferred);
  const parsed = new Map();
  for (const l of src) {
    const { node, warnings } = parseOvid(l.query);
    warnings.forEach(w => T.warn(`Line ${l.n}: ${w}`));
    lint(l, T);
    parsed.set(l.n, node);
  }
  // A deferred limit ("Limit … to yr=…") is applied to the last line.
  let lastN = src.length ? src[src.length - 1].n : 0;
  for (const d of deferred) {
    const node = parseOvid(d.query).node;
    if (node?.t === "limit" && lastN) {
      node.ref = lastN;
      const n = Math.max(...parsed.keys()) + 1;
      parsed.set(n, node);
      src.push({ n, label: d.label || "Limit", query: d.query.replace(/(…|\.\.\.)/, String(lastN)), count: d.count, added: true });
      T.warn(`"${d.label || d.query}" had no line number: applied as line ${n} = limit ${lastN}.`);
      lastN = n;
    }
  }

  // Emit every line; lines that end up empty (e.g. only subject headings in WoS) are dropped
  // and the remaining lines are renumbered.
  const num = new Map(), complete = new Map();
  const out = [];
  for (const l of src) {
    const node = parsed.get(l.n);
    const r = node ? T.line(node, { num, complete }) : null;
    if (!r || !r.text) { num.set(l.n, null); out.push({ n: null, label: l.label, text: "", note: "dropped: nothing left to search in this database", from: l.n }); continue; }
    // A line that is only a pointer to another line (e.g. "1 or 2" after line 1 was dropped) is merged.
    const ptr = r.text.match(/^(#|S)?(\d+)$/);
    if (ptr) {
      const to = Number(ptr[2]), orig = [...num.entries()].find(([, v]) => v === to)?.[0];
      num.set(l.n, to);
      complete.set(l.n, complete.get(orig));
      out.push({ n: null, label: l.label, text: "", note: `same as ${ptr[1] || ""}${to} here`, from: l.n });
      continue;
    }
    const n = out.filter(x => x.n !== null).length + 1;
    num.set(l.n, n);
    complete.set(l.n, r.full);
    out.push({ n, label: l.label, text: r.text, note: r.note || "", from: l.n, count: l.count ?? null });
  }
  const finalN = final ?? lastN;
  const single = complete.get(finalN) || "";
  T.finish();
  return { target, label: TARGETS[target].label, lines: out, single, warnings: [...T.warnings], history: T.history, prefix: T.prefix };
}

// Project entries override the built-in list per heading and per database.
export function mergeHeadings(project = {}) {
  const r = structuredClone(DEFAULT_HEADINGS);
  for (const [k, v] of Object.entries(project || {})) {
    const key = k.toLowerCase();
    r[key] = { ...(r[key] || {}) };
    for (const [db, val] of Object.entries(v || {})) if (val !== undefined && val !== "") r[key][db] = val;
  }
  return r;
}

// Common slips in hand-written strategies.
function lint(l, T) {
  const q = normQuotes(l.query);
  for (const m of q.matchAll(/"([^"]+)"/g)) {
    const p = m[1];
    if (/\*\s+\S/.test(p)) T.warn(`Line ${l.n}: "${p}" has a truncation inside the phrase: missing quote or "or"?`);
    if (/\sor\s/i.test(p)) T.warn(`Line ${l.n}: "${p}" contains "or" inside quotes: missing quote?`);
  }
  if (/(?:^|[\s(])([a-z][\w-]*\*?)\s+\1(?=[\s).]|$)/i.test(q.replace(/"[^"]*"/g, " Q ").replace(/\b(or|and|not)\b/gi, m => `${m} `))) T.warn(`Line ${l.n}: repeated word, check for a missing "or".`);
}

// ------------------------------------------------------------------ targets
// Each target turns nodes into { s, f, c }: s = text, f = field key when s still needs a field
// wrapper (so terms that share fields are grouped as (a or b).ti,ab. / TS=(a OR b)), c = compound.
function makeTarget(target, headings) {
  const warnings = new Set();
  const warn = w => warnings.add(w);
  const ovid = target === "medline" || target === "embase";
  const OR = ovid ? "or" : "OR", AND = ovid ? "and" : "AND", NOT = ovid ? "not" : "NOT";
  const unmapped = new Set(), dropped = new Set(), mapped = new Set(), explode = new Set();
  let usedKf = false;
  const acmForms = new Set(), droppedPt = new Set(), cochraneMesh = new Set();
  const year = currentYear();

  // ---------------------------------------------------------------- fields
  // canonical field key from Ovid codes
  function fieldKey(f) {
    if (!f) return "mp";
    const set = new Set(f.map(x => ({ kw: target === "medline" ? "kw" : "kf", kf: "kf", ot: "ti", tw: "tw", mp: "mp", hw: "hw", sh: "sh" }[x] || x)));
    return [...set].join(",");
  }
  function wrap(s, f, compound) {
    if (!f) return s;
    const parts = f.split(",");
    const g = compound || /\s/.test(s) && !/^"[^"]*"$/.test(s) ? `(${s})` : s;
    if (ovid) {
      const codes = parts.map(p => (target === "embase" && p === "kf" ? (usedKf = true, "kw") : p));
      return `${g}.${[...new Set(codes)].join(",")}.`;
    }
    if (target === "wos") {
      const tags = parts.every(p => ["ti", "ab", "kf", "kw"].includes(p)) && parts.length === 1 ? { ti: "TI", ab: "AB", kf: "AK", kw: "AK" }[parts[0]] : "TS";
      if (tags === "TS" && parts.some(p => !["ti", "ab", "kf", "kw", "tw", "mp"].includes(p))) warn(`WoS: fields .${f}. searched as TS= (topic).`);
      return `${tags}=(${s})`;
    }
    if (target === "cochrane") {
      let codes = parts.flatMap(p => (COCHRANE_FIELDS[p] || (warn(`Cochrane: field .${p}. has no equivalent; searched in :ti,ab,kw.`), "ti,ab,kw")).split(","));
      codes = ["ti", "ab", "kw", "pt"].filter(c => codes.includes(c));
      return `${g}:${codes.join(",")}`;
    }
    const map = target === "psycinfo" ? { ti: "TI", ab: "AB", kf: "KW", kw: "KW" } : { ti: "Title", ab: "Abstract", kf: "Keyword", kw: "Keyword" };
    let codes = parts.flatMap(p => (map[p] ? [map[p]] : ["tw", "mp"].includes(p) ? Object.values(map).filter((v, i, a) => a.indexOf(v) === i) : (warn(`${TARGETS[target].short}: field .${p}. has no equivalent; searched in title/abstract/keywords.`), Object.values(map))));
    codes = [...new Set(codes)];
    const one = c => (target === "psycinfo" ? `${c} ${/^\(.*\)$/.test(g) ? g : `(${s})`}` : `${c}:(${s})`);
    return codes.length === 1 ? one(codes[0]) : `(${codes.map(one).join(" OR ")})`;
  }

  // ---------------------------------------------------------------- terms
  function word(v, quoted) {
    let w = v;
    if (target === "wos") w = w.replace(/\$\d*/g, "*").replace(/\?/g, "\u0001").replace(/#/g, "?").replace(/\u0001/g, "$");
    if (target === "psycinfo") w = w.replace(/\$\d*/g, "*").replace(/\?/g, "\u0001").replace(/#/g, "?").replace(/\u0001/g, "#");
    if (ovid) w = w.replace(/\$(?!\d)/g, "*");
    if (target === "acm") return acmWord(w.replace(/\$\d*/g, "*"), quoted);
    if (target === "cochrane") return cochraneWord(w, quoted);
    if (quoted) return `"${w}"`;
    if (!ovid && /^(and|or|not|near|same)$/i.test(w)) return `"${w}"`;
    return w;
  }

  // Cochrane: Ovid $ / $n / ? (0-1 char) become * (* also works inside a word, e.g. behavio*r), # (1 char)
  // becomes ?. A phrase with a wildcard cannot be quoted, so its words are joined with NEXT.
  function cochraneWord(v, quoted) {
    let w = v;
    if (/\$\d/.test(w)) warn(`Cochrane: limited truncation (${w}) written as * (unlimited).`);
    if (/\?/.test(w)) warn(`Cochrane: Ovid ? (zero or one character) in ${w} written as * (zero or more).`);
    w = w.replace(/\$\d*/g, "*").replace(/\?/g, "*").replace(/#/g, "?");
    if (quoted && /[*?]/.test(w) && /\s/.test(w)) return `(${w.split(/\s+/).map(x => (/^(and|or|not|near|next)$/i.test(x) ? `"${x}"` : x)).join(" NEXT ")})`;
    if (quoted) return `"${w}"`;
    if (/^(and|or|not|near|next)$/i.test(w)) return `"${w}"`;
    return w;
  }

  // ACM: wildcards are ignored inside quotes and "?" is exactly one character. Spelling variants
  // (behavio?r, organi?ation) are written out; a truncated phrase becomes an AND of its words.
  function acmWord(w, quoted) {
    let variants = [w];
    if (w.includes("?")) {
      const out = new Set();
      const expand = (s0) => {
        const i = s0.indexOf("?");
        if (i < 0) { out.add(s0); return; }
        const before = s0[i - 1]?.toLowerCase(), after = s0[i + 1]?.toLowerCase();
        const opts = before === "o" && after === "r" ? ["", "u"] : before === "i" && /[aez]/.test(after || "") ? ["s", "z"] : null;
        if (!opts) { out.add(null); return; }
        opts.forEach(o => expand(s0.slice(0, i) + o + s0.slice(i + 1)));
      };
      expand(w);
      if (out.has(null)) { warn(`ACM: "?" in ${w} means exactly one character there (in Ovid: zero or one).`); variants = [w]; } else variants = [...out];
    }
    const one = x => {
      if (quoted && /[*#]/.test(x)) {
        const words = x.split(/\s+/);
        if (words.length === 1) return x.replace(/#/g, "?");
        const last = words[words.length - 1], head = words.slice(0, -1).join(" ");
        if (/^[a-z-]{3,}\*$/i.test(last) && !/[*?#]/.test(head)) {
          const forms = wordForms(last.slice(0, -1));
          acmForms.add(`"${x}" → ${forms.map(f => `"${head} ${f}"`).join(" / ")}`);
          return `(${forms.map(f => `"${head} ${f}"`).join(" OR ")})`;
        }
        warn(`ACM ignores wildcards inside quotes: "${x}" is searched as its words joined by AND (broader).`);
        return `(${words.map(y => y.replace(/#/g, "?")).join(" AND ")})`;
      }
      x = x.replace(/#/g, "?");
      if (/^[*?]/.test(x)) warn(`ACM does not allow a wildcard at the start of a word: ${x}.`);
      return quoted ? `"${x}"` : x;
    };
    const parts = variants.map(one);
    return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
  }

  // Singular/plural forms for a truncated last word (ACM cannot truncate inside a phrase).
  function wordForms(stem) {
    const y = stem.match(/^(.*(?:theor|strateg|polic|therap|stud|technolog|methodolog|ontolog|categor|librar|industr|commun|abilit))$/i);
    if (y) return [`${stem}y`, `${stem}ies`];
    if (/(s|x|z|ch|sh)$/i.test(stem)) return [stem, `${stem}es`];
    return [stem, `${stem}s`];
  }

  function heading(n) {
    const key = n.term.toLowerCase();
    if (target === "medline") return `${n.exp ? "exp " : ""}${n.major ? "*" : ""}${/[,()]|\b(and|or|not)\b/i.test(n.term) ? `"${n.term}"` : n.term}/${n.sub || ""}`;
    if (target === "wos" || target === "acm") { dropped.add(n.term); return ""; }
    if (target === "cochrane") {
      // CENTRAL uses MeSH itself, so the MEDLINE heading is kept as written.
      if (n.major) warn(`Cochrane: major-topic heading *${n.term}/ searched as an ordinary [mh] heading (broader).`);
      if (n.sub) warn(`Cochrane: qualifier /${n.sub} on ${n.term} left out (broader); add it in the MeSH tab if it matters.`);
      cochraneMesh.add(n.term);
      return `[mh ${n.exp ? "" : "^"}"${n.term.replace(/"/g, "")}"]`;
    }
    const m = headings[key]?.[target];
    if (m === null) { dropped.add(n.term); return ""; }
    const list = Array.isArray(m) ? m : m ? [m] : null;
    if (!list) unmapped.add(n.term); else mapped.add(n.term);
    const terms = list || [target === "embase" ? n.term.toLowerCase() : n.term];
    const one = t => {
      if (t.startsWith("raw:")) return t.slice(4);
      if (target === "embase") return `${n.exp ? "exp " : ""}${n.major ? "*" : ""}${/[,()]|\b(and|or|not)\b/i.test(t) ? `"${t}"` : t}/`;
      if (n.exp) explode.add(t);
      return `${n.major ? "MM" : "DE"} "${t}"`;
    };
    const parts = terms.map(one);
    return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
  }

  function pubType(n) {
    const v = n.v.toLowerCase();
    if (target === "medline") return { s: `${n.q && /\s/.test(n.v) ? `"${n.v}"` : n.v}`, f: "pt" };
    if (target === "cochrane") {
      warn("Cochrane: publication types searched as :pt (as indexed in MEDLINE/Embase); records from other sources have none, so check what the line removes.");
      return { s: `"${n.v}"`, f: "pt" };
    }
    const m = PT[target][v];
    if (!m) { droppedPt.add(n.v); return { s: "" }; }
    if (target === "wos") return { s: `"${m}"`, f: "DT" };
    if (target === "embase") warn(`Embase: publication types mapped from MEDLINE (${Object.keys(PT.embase).join(", ")}); check against the Embase list.`);
    if (target === "psycinfo") warn(`PsycInfo: publication types mapped to PT/MD codes; check them in the EBSCO field list.`);
    return { s: m };
  }

  // ---------------------------------------------------------------- nodes
  function emit(n, ctx) {
    if (!n) return { s: "" };
    switch (n.t) {
      case "text": {
        const fk = fieldKey(n.f);
        if (fk === "pt") return pubType(n);
        if (fk === "sh" || fk === "hw") return emit({ t: "head", term: n.v, exp: false }, ctx);
        return { s: word(n.v, n.q), f: fk };
      }
      case "head": return { s: heading(n) };
      case "ref": {
        if (!ctx.num.has(n.n)) { warn(`Line refers to #${n.n}, which does not exist.`); return { s: "" }; }
        const to = ctx.num.get(n.n);
        if (to === null) return { s: "" };
        if (ctx.inline) return { s: ctx.complete.get(n.n), c: true };
        return { s: target === "wos" || target === "acm" || target === "cochrane" ? `#${to}` : target === "psycinfo" ? `S${to}` : String(to) };
      }
      case "adj": {
        const [l, r] = n.a.map(x => emit(x, ctx));
        if (!l.s || !r.s) return l.s ? l : r;
        if (l.f !== r.f) warn(`Proximity between different fields (${l.f} / ${r.f}); fields kept per side.`);
        const p = x => (x.c || /\s/.test(x.s) && !/^"[^"]*"$/.test(x.s) ? `(${x.s})` : x.s);
        if (target === "acm") {
          warn("ACM has no proximity operator for groups with truncation: adjN translated as AND within the same field (broader).");
          return { s: `${p(l)} AND ${p(r)}`, f: l.f === r.f ? l.f : null, c: true };
        }
        const op = ovid ? `adj${n.n}` : target === "wos" || target === "cochrane" ? `NEAR/${n.n}` : `N${n.n}`;
        if (target === "wos" || target === "psycinfo" || target === "cochrane") warn(`${TARGETS[target].short}: Ovid adj${n.n} translated as ${op}; the word distance is counted slightly differently.`);
        if (l.f !== r.f) return { s: `${p(full(l))} ${op} ${p(full(r))}`, c: true };
        return { s: `${p(l)} ${op} ${p(r)}`, f: l.f, c: true };
      }
      case "or": case "and": case "not": {
        let parts = n.a.map(x => emit(x, ctx));
        if (n.t === "or") parts = parts.filter((x, i) => !x.s || parts.findIndex(y => y.s === x.s && y.f === x.f) === i);
        if (n.t === "not") {
          if (!parts[0].s) return { s: "" };
          if (parts.slice(1).some(x => !x.s)) warn(`${TARGETS[target].short}: part of an exclusion (NOT) had no equivalent and was left out.`);
          parts = [parts[0], ...parts.slice(1).filter(x => x.s)];
          if (parts.length === 1) return parts[0];
        } else {
          if (n.t === "and" && parts.some(x => !x.s) && parts.some(x => x.s)) warn(`${TARGETS[target].short}: one concept of an AND had no equivalent and was left out (broader).`);
          parts = parts.filter(x => x.s);
          if (!parts.length) return { s: "" };
          if (parts.length === 1) return parts[0];
        }
        const op = n.t === "or" ? OR : n.t === "and" ? AND : NOT;
        const fs = new Set(parts.map(x => x.f || null));
        if (fs.size === 1 && parts[0].f && !(target === "wos" && parts[0].f === "DT" && n.t !== "or")) {
          return { s: parts.map(x => (x.c ? `(${x.s})` : x.s)).join(` ${op} `), f: parts[0].f, c: true };
        }
        return { s: parts.map(x => { const y = full(x); return y.c ? `(${y.s})` : y.s; }).join(` ${op} `), c: true };
      }
      case "limit": return { s: "" };
      default: return { s: "" };
    }
  }
  // Apply the pending field wrapper.
  function full(x) {
    if (!x.f) return x;
    if (x.f === "DT") return { s: `DT=(${x.s})`, c: false };
    return { s: wrap(x.s, x.f, x.c), c: false };
  }

  function limit(n, ctx) {
    const ref = emit({ t: "ref", n: n.ref }, ctx);
    if (!ref.s) return null;
    const [from, to] = n.yr || [];
    const parts = [];
    if (ovid) warn(`${TARGETS[target].short}: the one-string version has no limit; run the limit line after it.`);
    if (ovid) return { text: `limit ${ref.s} to ${[n.yr && `yr="${from}-${to ?? "current"}"`, ...n.other].filter(Boolean).join(" and ")}`, full: null };
    const notes = [];
    if (n.yr) {
      if (target === "wos") parts.push(`PY=(${from}-${to ?? year})`);
      else if (target === "cochrane") notes.push(`publication year ${from}–${to ?? "current"}: Search Limits only offer the Cochrane Library publication date (date added), not the year of the study report; screen the years instead or note the difference`);
      else notes.push(`publication year ${from}–${to ?? "current"}: use the ${target === "acm" ? "Publication Date filter" : "Publication Year limiter"}`);
    }
    for (const o of n.other) {
      if (/english/i.test(o)) { if (target === "wos") parts.push("LA=(English)"); else if (target === "psycinfo") parts.push("LA English"); else if (target === "cochrane") notes.push("English: CENTRAL has no language limit; leave it out (MECIR C27/C35 advise against language limits) or screen for it"); else notes.push("English: use the language filter"); }
      else if (/humans?/i.test(o) && target === "psycinfo") parts.push("PO Human");
      else notes.push(`limit "${o}" has no equivalent, check by hand`);
    }
    notes.forEach(x => warn(`${TARGETS[target].short}: ${x}.`));
    if (!parts.length) return { text: ref.s, note: notes.join("; "), full: null, passthrough: true };
    return { text: `${ref.s} AND ${parts.join(" AND ")}`, note: notes.join("; "), extra: parts.join(" AND ") };
  }

  return {
    warnings,
    warn,
    history: target !== "acm",
    prefix: target === "wos" || target === "cochrane" ? "#" : target === "psycinfo" ? "S" : "",
    line(node, { num, complete }) {
      const ctx = { num, complete, inline: false };
      const ictx = { num, complete, inline: true };
      if (node.t === "limit") {
        const r = limit(node, ctx);
        if (!r) return null;
        const inner = complete.get(node.ref);
        let fullS = inner;
        if (r.extra) fullS = `(${inner}) AND ${r.extra}`;
        else if (ovid) fullS = inner;
        return { text: r.text, note: r.note, full: fullS };
      }
      const hist = emit(node, ctx), inl = emit(node, ictx);
      if (!hist.s) return null;
      const h = full(hist), f = full(inl);
      return { text: h.s, full: f.s };
    },
    finish() {
      if (dropped.size) warn(`${TARGETS[target].short} has no ${target === "acm" ? "MeSH (only the ACM Computing Classification)" : "equivalent subject headings"} for: ${[...dropped].join(", ")}. Left out; the free-text terms carry recall.`);
      if (unmapped.size) warn(`${TARGETS[target].short}: no ${target === "embase" ? "Emtree" : "APA Thesaurus"} term known for ${[...unmapped].join(", ")}: the MeSH name was used. Check each in the thesaurus (or ask the assistant to map them).`);
      if (mapped.size) warn(`${TARGETS[target].short}: subject headings mapped from the built-in/project list (${[...mapped].join(", ")}). Verify in the ${target === "embase" ? "Emtree" : "APA Thesaurus"} browser.`);
      if (target === "wos") warn("WoS: TS= also searches Keywords Plus; if the result is noisy use (TI=… OR AB=… OR AK=…).");
      if (explode.size && target === "psycinfo") warn(`PsycInfo: exploded in MEDLINE: ${[...explode].join(", ")}. In EBSCO tick Explode in the APA Thesaurus (it writes out the narrower DE terms), or list them in the heading map.`);
      if (target === "acm") warn("ACM has no search history: the lines are for documentation (#n = line n); paste the one-string version into Edit Query. Boolean operators must be in capitals. Field syntax Title:/Abstract:/Keyword: follows the ACM query editor; check it there once.");
      if (droppedPt.size) warn(`${TARGETS[target].short}: no equivalent for publication type${droppedPt.size > 1 ? "s" : ""} ${[...droppedPt].map(x => `"${x}"`).join(", ")}; left out.${target === "acm" ? " Use the Content Type filter instead." : ""}`);
      if (acmForms.size) warn(`ACM ignores wildcards inside quotes: truncated phrases written out as singular/plural (check that no other endings matter): ${[...acmForms].join("; ")}.`);
      if (target === "cochrane") {
        if (cochraneMesh.size) warn(`Cochrane: MeSH kept as [mh] (exploded unless ^). CENTRAL records that come from Embase, registers or handsearching have no MeSH, so the free-text lines carry their recall.`);
        warn("Cochrane: paste the lines into Search Manager (Advanced search), then select Trials (CENTRAL) in the results to count CENTRAL only. :kw also searches index terms.");
      }
      if (target === "embase" && usedKf) warn("Embase: MEDLINE .kf. (author keywords) written as .kw. (Embase author keywords).");
    },
  };
}

// ------------------------------------------------------------------ helpers for the UI / CLI
export function headingsIn(strategy) {
  const out = new Map();
  const walk = n => { if (!n) return; if (n.t === "head") out.set(n.term.toLowerCase(), n.term); n.a?.forEach(walk); };
  for (const l of strategy.lines) walk(parseOvid(l.query).node);
  return [...out.values()];
}

export function formatTranslation(r) {
  const lines = r.lines.filter(l => l.n !== null);
  const pre = r.prefix;
  const body = r.history
    ? lines.map(l => `${(pre + l.n).padEnd(4)} ${l.text}${l.note ? `    [${l.note}]` : ""}`).join("\n")
    : lines.map(l => `${("#" + l.n).padEnd(4)} ${l.text}${l.note ? `    [${l.note}]` : ""}`).join("\n");
  return body;
}

export function translationReport(strategy, targets = Object.keys(TARGETS), opts = {}) {
  const out = [`# ${strategy.name}: translations`, ""];
  for (const t of targets) {
    const r = translateStrategy(strategy, t, opts);
    out.push(`## ${r.label}`, "", r.history ? "Line by line:" : "Per line (for documentation):", "", "```", formatTranslation(r), "```", "", "As one string:", "", "```", r.single, "```", "");
    if (r.warnings.length) out.push("Check:", "", ...r.warnings.map(w => `- ${w}`), "");
  }
  return out.join("\n");
}
