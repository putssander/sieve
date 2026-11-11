// Auto mode: question in, manuscript draft out. Every AI step runs unattended (plan, search, screening, full texts,
// extraction, appraisal, summary, certainty, introduction and discussion), and the result is a manuscript in the
// structure of a review paper. It is an UNVERIFIED AI DRAFT until a person has done the checks of the quick scan:
// guidance does not allow AI to fully automate any step (Cochrane Rapid Reviews Methods Group 2025, rec. 1; Hamel et
// al. 2021: AI alone deciding on inclusion "should be avoided"). The draft says so on every page and lists, section by
// section, what is verified by a person and what is not.
// Methods and results are written by code from what was actually run (no model can invent a method); only the
// introduction and the discussion are written by the model, from the extracted data. Pure functions (node-tested).
import { hashKey } from "./hash.js";

const str = d => (d ? { type: "string", description: d } : { type: "string" });
const obj = properties => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = items => ({ type: "array", items });

export const AUTO_STEPS = [
  { id: "plan", label: "Plan", check: "Approve the plan (criteria, search, fields)" },
  { id: "search", label: "Search", check: "Check the search (PRESS)" },
  { id: "screen", label: "Screen", check: "Screen every record yourself (the AI as second reviewer)" },
  { id: "texts", label: "Full texts", check: "Add subscription papers through your library" },
  { id: "extract", label: "Extract", check: "Check every value against its quote" },
  { id: "appraise", label: "Appraise", check: "Judge every risk-of-bias domain" },
  { id: "summary", label: "Summary", check: "Check every statement against the cited papers" },
  { id: "certainty", label: "Certainty", check: "Rate the certainty of each finding" },
  { id: "manuscript", label: "Manuscript", check: "Read and rewrite the introduction and discussion" },
];

export const SYSTEM_WRITE = "You are an experienced author of evidence syntheses. You write clear, cautious academic prose, claim nothing the data do not show, cite every claim about a study as [PAPER_ID], and return ONLY JSON matching the requested schema.";

export const manuscriptSchema = obj({
  title: str("a descriptive title that names the design honestly, e.g. 'an AI-assisted evidence scan'"),
  introduction: arr(str("one paragraph")),
  discussion: obj({
    principal_findings: str("one paragraph"),
    context: str("one paragraph: how the findings relate to each other and to what the papers themselves say about earlier work; no outside sources"),
    strengths_limitations: str("one paragraph, using the limitations given"),
    implications: str("one paragraph for practice and research"),
  }),
  conclusion: str("two or three sentences, as certain as the certainty ratings allow"),
});

// papers: [{rid, cite, lines}], summary: the scan summary JSON, limits: [string], certainty: [{finding, level}]
export function manuscriptPrompt(project, summary, papers, limits, certainty = []) {
  return `Write the introduction and the discussion of a short review paper. The methods and results sections are written separately from the project data; do not repeat them in detail.
Use ONLY the information below. Do not cite or invent outside literature; where background would need outside sources, say what is generally assumed without a citation, or leave it out. Cite included studies as [PAPER_ID]. Keep the certainty of each statement in line with the ratings. Call the work an AI-assisted evidence scan, not a systematic review.

Question: ${project.protocol.question}
${project.protocol.purpose ? `Purpose: ${project.protocol.purpose}\n` : ""}Eligibility criteria: ${project.criteria.map(c => `${c.label} (${c.description})`).join("; ")}

ANSWER (from the synthesis): ${summary?.answer || ""}
FINDINGS:
${(summary?.findings || []).map((f, i) => `${i + 1}. ${f.statement} [${(f.paper_ids || []).join(", ")}]${certainty[i]?.level ? ` (certainty: ${certainty[i].level})` : ""}`).join("\n")}
AGREEMENT BETWEEN STUDIES: ${summary?.agreement || ""}
GAPS: ${(summary?.gaps || []).join("; ")}
LIMITATIONS: ${limits.join(" ")}

PAPERS:
${papers.map(x => `=== [${x.rid}] ${x.cite}\n${x.lines.join("\n")}`).join("\n\n")}

Return JSON {"title", "introduction": [paragraphs], "discussion": {"principal_findings", "context", "strengths_limitations", "implications"}, "conclusion"}.`;
}
export const manuscriptKey = (project, summary, papers, limits, certainty) => hashKey(`manuscript\n${manuscriptPrompt(project, summary, papers, limits, certainty)}`);

const md = s => String(s ?? "").replace(/\|/g, "/").replace(/\n+/g, " ");
const noDot = s => String(s || "").trim().replace(/\.$/, "");

// d: everything the manuscript reports, collected by the page from the project (see views/auto.js):
// { question, date, verified: {stepId: bool}, methods: {...}, flow, papers: [{rid, cite, values: [[label, value]], rob}],
//   fields: [label], robTool, robRows: [[rid, overall]], summary, sof: markdown|null, limits, disclosure, refs: [string], text: manuscript JSON }
export function manuscriptMarkdown(d) {
  const ver = d.verified || {};
  const all = AUTO_STEPS.every(s => ver[s.id]);
  const mark = id => (ver[id] ? "" : " ⚠");
  const m = d.methods || {};
  const t = d.text || {};
  const out = [];
  out.push(`# ${t.title || `Evidence scan: ${d.question}`}`, "");
  out.push(all ? `*AI-assisted evidence scan made with Sieve on ${d.date}. Every AI output was checked by the author (see Verification).*`
    : `> **UNVERIFIED AI DRAFT.** Parts of this text and the decisions behind it were made by AI without a human check (marked ⚠). It is not a systematic review and must not be used, shared as findings or submitted until a person has done the checks listed under Verification. Guidance: do not rely on AI to fully automate any step (Cochrane Rapid Reviews Methods Group, 2025).`, "");
  out.push("## Abstract", "",
    `**Question.** ${d.question}`, "",
    `**Methods.** ${m.sources || "Open databases"} were searched (${m.searchDate || "date not recorded"}). Records were screened against ${m.criteria?.length || 0} eligibility criteria${ver.screen ? " by a person with an AI model as second reviewer" : " by an AI model (not yet checked by a person)"}; data were extracted ${ver.extract ? "by an AI model and checked by a person" : "by an AI model (not yet checked)"}${d.robTool ? `; studies were appraised with ${d.robTool}` : ""}.`, "",
    `**Results.** ${d.flow ? `${d.flow.identified} records were identified, ${d.flow.screened} screened and ${d.papers.length} included.` : ""} ${d.summary?.answer || ""}`, "",
    `**Conclusion.** ${t.conclusion || "(not written yet)"}`, "");
  out.push(`## 1. Introduction${mark("manuscript")}`, "", ...(t.introduction || ["(not written yet)"]).flatMap(x => [x, ""]));
  out.push(`## 2. Methods`, "",
    `### 2.1 Protocol and eligibility${mark("plan")}`, "", m.protocol || "", "", ...(m.criteria || []).map((c, i) => `${i + 1}. **${c.label}**: ${c.description}`), "",
    `### 2.2 Information sources and search${mark("search")}`, "", m.search || "", "", ...(m.queries || []).flatMap(([db, q]) => [`*${db}*`, "", "```", q, "```", ""]),
    `### 2.3 Selection${mark("screen")}`, "", m.selection || "", "",
    `### 2.4 Data collection${mark("extract")}`, "", m.extraction || "", "", d.fields?.length ? `Data items: ${d.fields.join("; ")}.` : "", "",
    `### 2.5 Risk of bias / quality${mark("appraise")}`, "", m.appraisal || "Not assessed.", "",
    `### 2.6 Synthesis and certainty${mark("certainty")}`, "", m.synthesis || "", "");
  out.push(`## 3. Results`, "", `### 3.1 Selection${mark("screen")}`, "", d.flow ? `${d.flow.identified} records were identified (${d.flow.duplicates} duplicates removed); ${d.flow.screened} were screened on title and abstract and ${d.flow.excluded} excluded (${(d.flow.rows || []).filter(r => r.n).map(r => `${md(r.label)}: ${r.n}`).join("; ") || "no reasons recorded"}). ${d.papers.length} studies were included${d.flow.withText !== undefined ? `, ${d.flow.withText} with an open-access full text` : ""}. Figure 1 (PRISMA flow diagram) is exported separately.` : "", "");
  if (d.papers.length) {
    out.push(`### 3.2 Study characteristics${mark("extract")}`, "", `| Study | ${d.fields.map(md).join(" | ")} |`, `|---|${d.fields.map(() => "---").join("|")}|`,
      ...d.papers.map(x => `| [${x.rid}] ${md(x.short || x.rid)} | ${d.fields.map(f => md(x.values.find(([k]) => k === f)?.[1] ?? "–")).join(" | ")} |`), "");
  }
  if (d.robRows?.length) out.push(`### 3.3 Risk of bias / quality${mark("appraise")}`, "", "| Study | Overall judgement |", "|---|---|", ...d.robRows.map(([rid, o]) => `| [${rid}] | ${md(o)} |`), "");
  out.push(`### 3.4 Findings${mark("summary")}`, "", ...(d.summary?.findings || []).map(f => `- ${f.statement} ${(f.paper_ids || []).map(i => `[${i}]`).join("")}`), "",
    d.summary?.agreement ? `${d.summary.agreement}\n` : "");
  if (d.sof) out.push(`### 3.5 Certainty of the evidence${mark("certainty")}`, "", d.sof, "");
  out.push(`## 4. Discussion${mark("manuscript")}`, "");
  if (t.discussion) for (const [h, k] of [["Principal findings", "principal_findings"], ["In context", "context"], ["Strengths and limitations", "strengths_limitations"], ["Implications", "implications"]])
    out.push(`### ${h}`, "", t.discussion[k] || "", "");
  else out.push("(not written yet)", "");
  out.push("### Limitations of the methods", "", ...(d.limits || []).map(l => `- ${l}`), "");
  out.push("## 5. Conclusion", "", t.conclusion || "(not written yet)", "");
  out.push("## AI use disclosure", "", ...(d.disclosure || []).map(l => `- ${l}`), "");
  out.push("## Verification", "", "| Step | What a person must do | Done |", "|---|---|---|", ...AUTO_STEPS.map(s => `| ${s.label} | ${s.check} | ${ver[s.id] ? "✓ by the author" : "⚠ not yet: AI only"} |`), "");
  out.push("## References", "", ...(d.refs || []).map((r, i) => `${i + 1}. ${r}`), "");
  return out.join("\n");
}

// Plain HTML of the Markdown (headings, paragraphs, lists, tables, code, bold/italic): a file Word and browsers open.
export function markdownToHtml(src, title = "Manuscript") {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\^(\d+(?:,\d+)*)\^/g, "<sup>$1</sup>");
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("```")) { const code = []; while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]); out.push(`<pre>${esc(code.join("\n"))}</pre>`); continue; }
    const hm = l.match(/^(#{1,4}) (.*)/);
    if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); continue; }
    if (l.startsWith("|")) {
      const rows = [];
      for (; i < lines.length && lines[i].startsWith("|"); i++) if (!/^\|[-|\s]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split(" | ").map(c => c.trim()));
      i--;
      out.push(`<table><thead><tr>${rows[0].map(c => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l), items = [];
      for (; i < lines.length && /^(- |\d+\. )/.test(lines[i]); i++) items.push(lines[i].replace(/^(- |\d+\. )/, ""));
      i--;
      out.push(`<${ordered ? "ol" : "ul"}>${items.map(x => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (l.startsWith("> ")) { out.push(`<blockquote>${inline(l.slice(2))}</blockquote>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Georgia,serif;max-width:46em;margin:2em auto;line-height:1.5;padding:0 1em}table{border-collapse:collapse;font-size:.9em}td,th{border:1px solid #999;padding:3px 6px;vertical-align:top}blockquote{border-left:4px solid #b3372f;margin:1em 0;padding:.5em 1em;background:#fbe5e3}pre{white-space:pre-wrap;font-size:.85em;background:#f4f4f4;padding:.5em}</style></head><body>${out.join("\n")}</body></html>`;
}
