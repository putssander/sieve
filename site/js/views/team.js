// The second human reviewer: a blind copy of the project (here or on another computer), their decisions back as a
// small file or directly, agreement (κ) between the two of you and a consensus step for every disagreement.
import { h, clear, toast, download, pickFile, fmt } from "../util.js";
import { card, btn, help, row, badge, table } from "../ui.js";
import { loadProject, saveProject, getText, putText } from "../store.js";
import { blindCopy, decisionsFile, mergeDecisions, reviewers, compareScreening, resolveScreening, compareExtraction, resolveExtraction, isBlindCopy } from "../team.js";
import { dbadge } from "./screening.js";

const NAME_KEY = "sieve-second-reviewer";
const getName = () => { try { return localStorage.getItem(NAME_KEY) || ""; } catch { return ""; } };
const setName = v => { try { localStorage.setItem(NAME_KEY, v); } catch { /* private mode */ } };
const fmtK = k => (k === null || k === undefined ? "–" : (Math.round(k * 100) / 100).toFixed(2));

async function makeCopy(ctx, name, tasks, here, withTexts) {
  const p = ctx.project;
  const copy = blindCopy(p, name, tasks);
  if (here) {
    for (const rid of Object.keys(copy.fulltext || {})) { const t = await getText(p.id, rid); if (t) await putText(copy.id, rid, t); }
    await saveProject(copy);
    (p.team ||= {}).copies = [...(p.team.copies || []), { id: copy.id, reviewer: name, date: copy.team.origin.date }];
    await ctx.save(true);
    toast(`Blind copy made for ${name}: it opens now. Your project is still in the project list.`, "ok");
    ctx.go(`#/p/${copy.id}/${tasks.page || "screening"}`);
    return;
  }
  if (withTexts) for (const rid of Object.keys(copy.fulltext || {})) copy.fulltext[rid].text = await getText(p.id, rid);
  download(`${p.id}-second-reviewer-${name.replace(/\W+/g, "-").toLowerCase()}.json`, JSON.stringify(copy, null, 1));
}

// On your side. tasks: { screening: [rid], extraction: [rid], rob: [rid], page }, plus fields for the comparison.
export function secondReviewerCard(ctx, tasks, opts = {}) {
  const p = ctx.project;
  if (isBlindCopy(p)) return null;
  const names = reviewers(p);
  const nameIn = h("input", { value: getName(), placeholder: "name of the second reviewer", "aria-label": "Second reviewer", oninput: e => setName(e.target.value.trim()) });
  const texts = h("input", { type: "checkbox" });
  const need = () => { const n = nameIn.value.trim(); if (!n) toast("Fill in the name of the second reviewer", "warn"); return n; };
  const body = [
    help(opts.intro || "Guidance asks for two people working independently: on eligibility (MECIR C39; JBI 10.2.6), on outcome data (C46) and on risk of bias (C53). Rapid reviews: a second person on a sample or as verifier (rec. 9, 12, 16). The second reviewer works in a blind copy: the same records, criteria, form and tool, without your decisions and without AI suggestions."),
    row(nameIn,
      btn("Open a blind copy here", async () => { const n = need(); if (n) await makeCopy(ctx, n, tasks, true); }, "primary"),
      btn("Download a blind copy", async () => { const n = need(); if (n) await makeCopy(ctx, n, tasks, false, texts.checked); }),
      h("label", { class: "check small" }, texts, " include full texts (team only: often copyrighted)")),
    row(btn("Import their decisions (.json)", async () => {
      const f = await pickFile(".json"); if (!f) return;
      try {
        const res = mergeDecisions(p, JSON.parse(await f.text()));
        if (!res.sameProject && !confirm(`This decisions file was made for another project. Use it anyway?`)) return;
        ctx.save(); toast(`${res.reviewer}: ${res.screening} screening decisions, ${res.extraction} papers extracted, ${res.rob} appraisals`, "ok"); ctx.rerender();
      } catch (e) { toast(e.message, "err"); }
    }, "ghost"), h("span", { class: "muted small" }, `${tasks.screening?.length || 0} records to screen${tasks.extraction?.length ? ` · ${tasks.extraction.length} papers to extract and appraise` : ""}`)),
  ];
  for (const n of names) body.push(comparison(ctx, n, tasks, opts));
  if (!names.length && (p.team?.copies || []).length) body.push(help(`Blind copies made: ${p.team.copies.map(c => `${c.reviewer} (${c.date})`).join(", ")}. Their decisions appear here once sent back.`));
  return card(opts.title || "Second reviewer", ...body);
}

function comparison(ctx, name, tasks, opts) {
  const p = ctx.project;
  const out = h("div", { class: "team-compare" }, h("h4", {}, `${name} · decisions from ${p.team.reviewers[name].date}`));
  const recs = (tasks.screening || []).map(rid => p.records.find(r => r.rid === rid)).filter(Boolean);
  if (recs.length) {
    const s = compareScreening(p, name, recs.map(r => r.rid));
    out.append(h("p", { class: `badge ${s.kappa === null ? "" : s.kappa >= 0.8 ? "ok" : "warn"}` },
      `Screening: ${s.n} records decided by both · κ = ${fmtK(s.kappa)} · ${s.conflicts.length} disagreements${s.open.length ? `, ${s.open.length} open` : ", all resolved"}`,
      s.missingOther ? ` · ${name} has not decided ${s.missingOther}` : "", s.missingMine ? ` · you have not decided ${s.missingMine}` : ""));
    if (s.open.length) out.append(table([
      { label: "Record", cls: "title", render: rid => { const r = p.records.find(x => x.rid === rid); return h("span", {}, h("strong", {}, rid), ` ${String(r?.title || "").slice(0, 80)}`); } },
      { label: "You", render: rid => dbadge(p.screening.human[rid].first || p.screening.human[rid].decision) },
      { label: name, render: rid => h("span", {}, dbadge(p.team.reviewers[name].screening[rid].decision), h("div", { class: "small muted" }, p.team.reviewers[name].screening[rid].reason || "")) },
      { label: "Consensus", render: rid => row(...["Include", "Exclude", "Unclear"].map(d => btn(d, () => { resolveScreening(p, rid, name, d); ctx.save(); ctx.rerender(); }, "sm"))) },
    ], s.open, { limit: 100 }), help("Discuss each disagreement (or ask a third person) and record the consensus; both original decisions are kept."));
  }
  if (tasks.extraction?.length && opts.fields?.length) {
    const e = compareExtraction(p, name, tasks.extraction, opts.fields);
    if (e.papers) {
      out.append(h("p", { class: `badge ${e.compared && e.same / e.compared >= 0.9 ? "ok" : "warn"}` }, `Extraction: ${e.papers} papers · ${fmt(e.same)} of ${fmt(e.compared)} values the same${e.conflicts.length ? ` · ${e.conflicts.length} to resolve` : ""}`));
      if (e.conflicts.length) out.append(table([
        { label: "Paper", render: x => h("strong", {}, x.rid) },
        { label: "Field", render: x => opts.fields.find(f => f.id === x.fid)?.label || x.fid },
        { label: "You", render: x => String(x.a) },
        { label: name, render: x => String(x.b) },
        { label: "Consensus", render: x => row(btn("yours", () => { resolveExtraction(p, x.rid, x.fid, x.a); ctx.save(); ctx.rerender(); }, "sm"), btn(`${name}'s`, () => { resolveExtraction(p, x.rid, x.fid, x.b); ctx.save(); ctx.rerender(); }, "sm"),
          btn("other…", () => { const v = prompt("Consensus value", x.a); if (v !== null) { resolveExtraction(p, x.rid, x.fid, v); ctx.save(); ctx.rerender(); } }, "ghost sm")) },
      ], e.conflicts, { limit: 100 }));
    }
  }
  const nRob = Object.keys(p.team.reviewers[name].rob || {}).length;
  if (nRob) out.append(help(`Risk of bias: ${nRob} appraisals from ${name}; differences are shown, and resolved, in the risk-of-bias table.`));
  return out;
}

// In the second reviewer's copy, on every page: what to do and how to send the decisions back.
export function blindCopyBanner(ctx) {
  const p = ctx.project;
  if (!isBlindCopy(p)) return null;
  const o = p.team.origin, t = o.tasks || {};
  const box = h("div", { class: "card team-banner" });
  const draw = async () => {
    const original = await loadProject(o.id).catch(() => null);
    clear(box).append(h("strong", {}, `Second reviewer copy for “${o.name}” · ${o.reviewer}`),
      h("p", { class: "small" }, "You work blind: you do not see the first reviewer's decisions or AI suggestions. Decide on your own, then send your decisions back. ",
        `Tasks: screen ${t.screening?.length || 0} records${t.extraction?.length ? `, extract and appraise ${t.extraction.length} papers` : ""}.`),
      row(original ? btn(`Send my decisions to “${o.name}”`, async () => {
        const res = mergeDecisions(original, decisionsFile(p));
        await saveProject(original);
        toast(`Sent: ${res.screening} screening decisions, ${res.extraction} papers, ${res.rob} appraisals`, "ok");
      }, "primary") : null,
      btn("Download my decisions (.json)", () => download(`${o.id}-decisions-${o.reviewer.replace(/\W+/g, "-").toLowerCase()}.json`, JSON.stringify(decisionsFile(p), null, 1)), original ? "" : "primary"),
      original ? h("a", { class: "small", href: `#/p/${o.id}/${t.page || "screening"}` }, "back to the original project") : h("span", { class: "muted small" }, "send the file to the first reviewer")));
  };
  draw();
  return box;
}
