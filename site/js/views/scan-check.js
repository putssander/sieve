// The human checks of the quick scan. The AI suggests, a person decides (Cochrane Rapid Reviews Methods Group,
// position statement on AI, 2025: "Do not rely on AI to fully automate any step"; a human reviewer verifies all AI
// outputs and makes the final decisions). Screening follows the Cochrane rapid review guidance (Garritty et al.,
// BMJ 2024): a blind calibration sample with agreement (κ), then every record decided by the person with the
// AI suggestion shown; extraction: every value checked against its source.
// Decisions are stored where step 6 and step 7 keep them (screening.human, extraction.human).
import { h, clear, fmt } from "../util.js";
import { btn, help, row, badge } from "../ui.js";
import { quoteInSource } from "../util.js";
import { highlightHtml } from "../evidence.js";
import { showEvidence } from "./evidence.js";
import { calibrationSample, kappa } from "../scan.js";
import { sourceText } from "./screening.js";
import { compareScreening, reviewers } from "../team.js";

const today = () => new Date().toISOString().slice(0, 10);
const keep = d => d === "Include" || d === "Unclear";

// ------------------------------------------------------------------ screening
// Two modes. "independent" (default): you screen every record without seeing the AI; the AI is the second
// independent reviewer and only the disagreements come back to you (Hamel et al. 2021, "dual-independent with AI
// reviewer"; Vembye et al. 2025). "assisted" (faster): a blind calibration sample with κ, then every record with
// the AI suggestion shown (Cochrane rapid review guidance rec. 8-9, AI as a check).
export const SCREEN_MODES = {
  independent: { label: "Independent: you screen blind, the AI is the second reviewer", hint: "Most rigorous: like two independent reviewers. You decide every record without seeing the AI; afterwards only the disagreements come back to you, with the AI's reasons." },
  assisted: { label: "Faster: AI suggestion shown after a blind calibration sample", hint: "You screen 20% blind to measure agreement (κ), then decide the rest with the AI suggestion visible. Quicker, but seeing the suggestion can steer you." },
  dual: { label: "Two people: you and a colleague screen blind, the AI checks", hint: "As a systematic review asks (MECIR C39): a second person screens in a blind copy, you resolve your disagreements together, and the AI flags records you both excluded but it would keep (Cochrane RR AI position 2025)." },
};
export const screenMode = p => (["assisted", "dual"].includes(p.scan?.screen_mode) ? p.scan.screen_mode : "independent");

// Dual mode: records excluded in the end (after your consensus) that the AI would keep: a person looks again.
export function aiFlags(p, recs, aiOf) {
  return recs.filter(r => { const x = p.screening.human?.[r.rid], ai = aiOf(r.rid); return x?.decision && !keep(x.decision) && ai && keep(ai.decision) && !x.ai_checked; });
}
function dualState(p, recs) {
  const name = reviewers(p).find(n => recs.some(r => p.team.reviewers[n].screening?.[r.rid]));
  if (!name) return { name: null, waiting: true };
  const c = compareScreening(p, name, recs.map(r => r.rid));
  return { name, waiting: c.missingOther > 0, open: c.open.length, kappa: c.kappa };
}

export function calibrationIds(p, recs) {
  if (!p.scan.calibration) p.scan.calibration = { ids: calibrationSample(recs.map(r => r.rid), p.id), date: today() };
  return p.scan.calibration.ids;
}
// Agreement between your blind decisions and the AI (all blind decisions: the whole set in independent mode).
export function calibrationResult(p, aiOf) {
  const ids = Object.entries(p.screening.human || {}).filter(([rid, x]) => x?.blind && aiOf(rid)).map(([rid]) => rid);
  if (!ids.length) return null;
  const first = rid => p.screening.human[rid].first || p.screening.human[rid].decision;
  const pairs = ids.map(rid => [keep(first(rid)), keep(aiOf(rid).decision)]);
  return { n: ids.length, kappa: kappa(pairs), missed: pairs.filter(([hu, ai]) => hu && !ai).length, conflicts: pairs.filter(([hu, ai]) => hu !== ai).length };
}
const isConflict = (p, rid, aiOf) => { const x = p.screening.human?.[rid], ai = aiOf(rid); return !!(x?.blind && ai && !x.resolved && keep(x.first || x.decision) !== keep(ai.decision)); };
export function screeningComplete(p, recs, aiOf) {
  if (!recs.length || !recs.every(r => p.screening.human?.[r.rid]?.decision)) return false;
  const mode = screenMode(p);
  if (mode === "dual") { const d = dualState(p, recs); return !d.waiting && !d.open && !aiFlags(p, recs, aiOf).length; }
  return mode === "assisted" || !recs.some(r => isConflict(p, r.rid, aiOf));
}

// aiOf(rid) → the AI result. onDone() after the last decision. keyOf(r) → the input fingerprint (for out-of-date checks).
export function screenCheckCard(ctx, recs, aiOf, onDone, keyOf = () => "") {
  const p = ctx.project;
  const mode = screenMode(p);
  const hum = rid => p.screening.human?.[rid]?.decision;
  const calib = mode === "assisted" ? calibrationIds(p, recs) : recs.map(r => r.rid);
  const host = h("div", { class: "scan-check" });
  let keyHandler = null, decided = false;

  function decide(r, decision, criterion, blind, resolve = false) {
    decided = true;
    const ai = aiOf(r.rid);
    const c = p.criteria.find(x => x.id === criterion);
    const prev = p.screening.human[r.rid];
    p.screening.human[r.rid] = { decision, reason: decision === "Exclude" && c ? c.label : (resolve && decision === "Exclude" ? prev?.reason || "" : ""),
      criteria: decision === "Exclude" && c ? { [c.id]: "No" } : (resolve && decision === "Exclude" ? prev?.criteria || {} : {}),
      by: "you (quick scan)", date: today(), stage: "ta", blind: resolve ? !!prev?.blind : blind, ai: ai?.decision || "", _key: keyOf(r),
      ...(resolve ? { first: prev?.first || prev?.decision, resolved: true } : {}) };
    ctx.save();
    draw();
  }

  function draw() {
    if (keyHandler) document.removeEventListener("keydown", keyHandler);
    clear(host);
    const blindTodo = recs.filter(r => calib.includes(r.rid) && !hum(r.rid));
    const conflicts = mode === "independent" && !blindTodo.length ? recs.filter(r => isConflict(p, r.rid, aiOf)) : [];
    const dual = mode === "dual" && !blindTodo.length ? dualState(p, recs) : null;
    const flags = dual && !dual.waiting && !dual.open ? aiFlags(p, recs, aiOf) : [];
    const todo = mode === "assisted" ? recs.filter(r => !hum(r.rid)) : mode === "dual" ? flags : conflicts;
    if (dual && (dual.waiting || dual.open)) {
      host.append(h("div", { class: "scan-check-head" }, h("strong", {}, `Your screening is done · ${recs.length} records`),
        h("span", { class: "muted small" }, dual.waiting ? " Now the second reviewer: make a blind copy for your colleague below. Their decisions come back to this page." : ` ${dual.open} disagreements with ${dual.name}: record your consensus below.`)));
      return;
    }
    const cal = calibrationResult(p, aiOf);
    const head = blindTodo.length
      ? (mode === "independent" ? `Your screening · ${recs.length - blindTodo.length} of ${recs.length}` : `Your check 1 of 2 · calibration: ${calib.length - blindTodo.length} of ${calib.length}`)
      : todo.length ? (mode === "independent" ? `Disagreements with the AI · ${todo.length} to resolve` : mode === "dual" ? `AI check · ${todo.length} records you both excluded that the AI would keep` : `Your check 2 of 2 · ${recs.length - todo.length} of ${recs.length} decided`)
      : `All ${recs.length} decisions are yours`;
    const sub = blindTodo.length ? " You do not see the AI here: your judgement stays independent. Keys: i = include, e = exclude (then 1-9 for the criterion), u = unclear."
      : todo.length && mode === "dual" ? " Look at each one again; keep it excluded or include it. The decision stays with you (and your colleague)."
      : todo.length ? (mode === "independent" ? " You and the AI disagree on these. Read the AI's reasons, then make the final decision (Hamel et al. 2021: conflicts go to another reviewer; with a colleague, let them decide)."
        : " The AI suggestion is shown; the decision is yours. Keys: a = agree, i = include, e = exclude, u = unclear.") : "";
    host.append(h("div", { class: "scan-check-head" }, h("strong", {}, head), h("span", { class: "muted small" }, sub)));
    if (cal && !blindTodo.length) host.append(h("p", { class: `badge ${cal.kappa >= 0.8 ? "ok" : "warn"}` },
      `Agreement on ${cal.n} records screened blind: κ = ${cal.kappa.toFixed(2)}${cal.missed ? ` · the AI excluded ${cal.missed} that you kept` : ""}`,
      cal.kappa >= 0.8 ? " · good agreement" : " · below 0.8: consider a second human screener"));
    const r = blindTodo[0] || todo[0];
    if (!r) { if (decided) onDone?.(); return; }
    const blind = !!blindTodo.length;
    const resolving = !blind && mode === "independent";
    const flagging = !blind && mode === "dual";
    const flagDecide = decision => {
      decided = true;
      const prev = p.screening.human[r.rid];
      p.screening.human[r.rid] = { ...prev, decision, ai_checked: today(), first: prev.first || prev.decision, ...(decision !== prev.decision ? { reason: "", criteria: {} } : {}) };
      ctx.save(); draw();
    };
    const ai = blind ? null : aiOf(r.rid);
    const mine = p.screening.human?.[r.rid];
    const quotes = (ai?.failed_criteria || []).map(f => f.evidence_quote).filter(q => q && !/^No direct quote/i.test(q));
    const abstract = h("div", { class: "scan-check-abstract", html: highlightHtml(r.abstract || "(no abstract)", quotes) });
    const excludeRow = h("div", { class: "scan-check-reasons", hidden: true },
      h("span", { class: "muted small" }, "Which criterion is not met?"),
      p.criteria.map((c, i) => btn(`${i + 1} · ${c.label}`, () => decide(r, "Exclude", c.id, blind, resolving), "sm")),
      btn("other", () => decide(r, "Exclude", "", blind, resolving), "sm ghost"));
    const firstNo = ai && p.criteria.find(c => ai.criteria?.[c.id] === "No");
    const suggestion = ai && h("div", { class: "scan-check-ai" },
      resolving ? h("p", { class: "small" }, "You decided ", badge(mine.first || mine.decision), mine.reason ? ` (${mine.reason})` : "", "; the AI says ", badge(ai.decision, ai.decision === "Include" ? "ok" : ai.decision === "Exclude" ? "err" : "warn"))
        : [h("span", { class: "muted small" }, "AI suggests "), badge(ai.decision, ai.decision === "Include" ? "ok" : ai.decision === "Exclude" ? "err" : "warn")],
      firstNo ? h("span", { class: "small" }, ` · not met according to the AI: ${firstNo.label}`) : null,
      (ai.failed_criteria || []).map(f => h("p", { class: "small muted" }, f.interpretation || "", f.evidence_quote ? [" ", h("q", {}, f.evidence_quote)] : "")));
    const agree = () => decide(r, ai.decision, ai.decision === "Exclude" ? firstNo?.id || "" : "", false, resolving);
    const keepMine = () => decide(r, mine.first || mine.decision, "", false, true);
    host.append(h("article", { class: "scan-check-card" },
      h("div", { class: "muted small" }, `${r.rid} · ${r.journal || ""} ${r.year || ""}`),
      h("h4", {}, r.title), abstract, suggestion,
      flagging ? row(btn(["Keep it excluded", h("kbd", {}, "k")], () => flagDecide(mine.decision), "primary"), btn(["Include", h("kbd", {}, "i")], () => flagDecide("Include")), btn(["Unclear", h("kbd", {}, "u")], () => flagDecide("Unclear"), "ghost"))
      : resolving ? row(btn([`Keep mine: ${mine.first || mine.decision}`, h("kbd", {}, "k")], keepMine, "primary"), btn([`Change to the AI's: ${ai.decision}`, h("kbd", {}, "a")], agree))
        : row(ai && btn([`Agree: ${ai.decision}`, h("kbd", {}, "a")], agree, "primary"),
          btn(["Include", h("kbd", {}, "i")], () => decide(r, "Include", "", blind), ai ? "" : "primary"),
          btn(["Exclude", h("kbd", {}, "e")], () => { excludeRow.hidden = false; }),
          btn(["Unclear", h("kbd", {}, "u")], () => decide(r, "Unclear", "", blind), "ghost")),
      excludeRow));
    keyHandler = e => {
      if (!host.isConnected) { document.removeEventListener("keydown", keyHandler); return; }
      if (e.target.matches?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (flagging) { if (k === "k") flagDecide(mine.decision); else if (k === "i") flagDecide("Include"); else if (k === "u") flagDecide("Unclear"); else return; e.preventDefault(); return; }
      if (resolving) { if (k === "k") keepMine(); else if (k === "a") agree(); else return; e.preventDefault(); return; }
      if (k === "a" && ai) agree();
      else if (k === "i") decide(r, "Include", "", blind);
      else if (k === "u") decide(r, "Unclear", "", blind);
      else if (k === "e") excludeRow.hidden = false;
      else if (!excludeRow.hidden && /^[1-9]$/.test(k) && p.criteria[Number(k) - 1]) decide(r, "Exclude", p.criteria[Number(k) - 1].id, blind);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", keyHandler);
  }
  draw();
  return host;
}

// ------------------------------------------------------------------ extraction
// One paper at a time: each AI value with its quote (checked word for word in the source); the person corrects or
// confirms, and the values are stored as the person's values (step 7 shows them as verified).
export function extractCheckCard(ctx, sel, texts, fields, aiOf, keyOf, onDone) {
  const p = ctx.project, ex = p.extraction;
  p.scan.extract_checked ||= {};
  const checked = r => p.scan.extract_checked[r.rid]?._key === keyOf(r);
  const host = h("div", { class: "scan-check" });
  let decided = false;
  function draw() {
    clear(host);
    const todo = sel.filter(r => !checked(r));
    host.append(h("div", { class: "scan-check-head" }, h("strong", {}, todo.length ? `Your check · ${sel.length - todo.length} of ${sel.length} papers checked` : `All ${sel.length} papers checked by you`),
      todo.length ? h("span", { class: "muted small" }, " Compare each value with its quote and correct it where needed (Cochrane rapid review guidance, rec. 12).") : null));
    const r = todo[0];
    if (!r) { if (decided) onDone?.(); return; }
    const ai = aiOf(r);
    const src = sourceText(p, r, texts[r.rid] || "");
    const inputs = {};
    const rows = fields.map(f => {
      const v = ai?.fields?.[f.id] || {};
      const cur = ex.human?.[r.rid]?.[f.id] ?? v.value ?? "";
      const ok = v.quote ? quoteInSource(v.quote, src) : null;
      inputs[f.id] = h("input", { value: cur, class: "scan-check-input", "aria-label": f.label });
      return h("div", { class: "scan-check-field" }, h("label", { class: "small" }, h("strong", {}, f.label)), inputs[f.id],
        v.quote ? h("div", { class: "small" }, ok ? h("span", { class: "ok-text" }, "❝ found in the source ") : h("span", { class: "err-text" }, "❝✗ not found in the source "),
          h("q", {}, v.quote), " ", btn("show", () => showEvidence(r, texts[r.rid] || r.abstract || "", [v.quote], { title: f.label }), "ghost sm")) : h("div", { class: "small muted" }, "no quote"));
    });
    host.append(h("article", { class: "scan-check-card" },
      h("div", { class: "muted small" }, `${r.rid} · ${r.journal || ""} ${r.year || ""}${texts[r.rid] ? " · full text" : " · abstract only"}`),
      h("h4", {}, r.title), ...rows,
      row(btn("Values checked: next paper", () => {
        let changed = 0;
        ex.human ||= {};
        for (const f of fields) {
          const val = inputs[f.id].value.trim();
          if (val !== String(ai?.fields?.[f.id]?.value ?? "").trim()) changed++;
          if (val) (ex.human[r.rid] ||= {})[f.id] = val;
        }
        p.scan.extract_checked[r.rid] = { date: today(), changed, _key: keyOf(r) };
        decided = true;
        ctx.save();
        draw();
      }, "primary"), h("span", { class: "muted small" }, `${todo.length - 1} to go`))));
  }
  draw();
  return host;
}

// ------------------------------------------------------------------ disclosure facts
export function disclosureInfo(p, recs, sel, aiOf, cal) {
  const runModels = runs => [...new Set(Object.values(runs).map(r => r.model || r.label).filter(Boolean))];
  const human = recs.map(r => p.screening.human?.[r.rid]).filter(x => x?.decision);
  const checked = Object.values(p.scan.extract_checked || {});
  return {
    plan: p.scan.plan ? { model: p.scan.plan.model, approved: p.scan.plan.approved } : null,
    screen: { mode: screenMode(p), models: runModels(Object.fromEntries(Object.entries(p.screening.runs).filter(([, r]) => (r.stage || "ta") === "ta"))), n: recs.length,
      checked: human.length, changed: recs.filter(r => { const hd = p.screening.human?.[r.rid]?.decision, ai = aiOf(r.rid)?.decision; return hd && ai && keep(hd) !== keep(ai); }).length, calibration: cal },
    extract: sel.length ? { models: runModels(p.extraction.runs), n: sel.length, checked: checked.length, changed: checked.reduce((n, c) => n + (c.changed || 0), 0) } : null,
    summary: p.scan.summary ? { model: p.scan.summary.model, approved: p.scan.summary.approved } : null,
  };
}

export const fmtKappa = k => (k === null || k === undefined ? "–" : fmt(Math.round(k * 100) / 100));
