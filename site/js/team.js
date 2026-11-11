// A second human reviewer (MECIR C39 screening, C46 outcome data, C53 risk of bias; Cochrane rapid review guidance
// rec. 9, 12, 16; JBI Manual 10.2.6). Sieve has no server, so the second reviewer works in a blind copy of the
// project: the same records, criteria, fields and tool, without anyone's decisions and without AI suggestions. Their
// decisions come back as a small decisions file (ids and judgements only) or, on the same device, directly.
// Disagreements are resolved by consensus and recorded. Pure functions (node-tested).
import { kappa } from "./scan.js";

export const DECISIONS_FORMAT = "sieve-decisions";
const today = () => new Date().toISOString().slice(0, 10);
const keep = d => d === "Include" || d === "Unclear";
const norm = v => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// tasks: { screening: [rid], extraction: [rid], rob: [rid] } — what the second reviewer is asked to do.
export function blindCopy(project, reviewer, tasks, { id = `${project.id}-r2-${Date.now().toString(36)}` } = {}) {
  const p = structuredClone(project);
  p.id = id;
  p.name = `${project.name} · second reviewer (${reviewer})`;
  p.screening = { runs: {}, human: {}, human_ft: {} };
  p.extraction = { ...p.extraction, runs: {}, human: {} };
  p.rob = p.rob ? { tool: p.rob.tool, tools: p.rob.tools || {}, runs: {}, human: {} } : undefined;
  p.certainty = undefined;
  p.team = { origin: { id: project.id, name: project.name, reviewer, date: today(), tasks } };
  if (p.scan) p.scan = { plan: p.scan.plan, protocol: p.scan.protocol, search: p.scan.search, caps: p.scan.caps };
  delete p.auto;
  return p;
}

export const isBlindCopy = p => !!p.team?.origin;

// From the second reviewer's copy: only ids, decisions, values and judgements (no titles, abstracts or texts).
export function decisionsFile(p) {
  const o = p.team.origin, t = o.tasks || {};
  const pick = (src, ids) => Object.fromEntries((ids || []).filter(id => src?.[id]).map(id => [id, src[id]]));
  return {
    format: DECISIONS_FORMAT, version: 1, project: o.id, project_name: o.name, reviewer: o.reviewer, date: today(),
    screening: pick(p.screening.human, t.screening), screening_ft: pick(p.screening.human_ft, t.screening_ft || []),
    extraction: pick(p.extraction.human, t.extraction), rob: pick(p.rob?.human, t.rob),
  };
}

export function mergeDecisions(project, file) {
  if (file?.format !== DECISIONS_FORMAT) throw new Error("Not a Sieve decisions file");
  if (!file.reviewer) throw new Error("The decisions file names no reviewer");
  project.team ||= {};
  project.team.reviewers ||= {};
  const prev = project.team.reviewers[file.reviewer] || {};
  project.team.reviewers[file.reviewer] = {
    date: file.date, from_project: file.project,
    screening: { ...prev.screening, ...file.screening }, screening_ft: { ...prev.screening_ft, ...file.screening_ft },
    extraction: { ...prev.extraction, ...file.extraction }, rob: { ...prev.rob, ...file.rob },
  };
  return { reviewer: file.reviewer, screening: Object.keys(file.screening || {}).length, extraction: Object.keys(file.extraction || {}).length, rob: Object.keys(file.rob || {}).length, sameProject: file.project === project.id };
}

export const reviewers = p => Object.keys(p.team?.reviewers || {});

// Your independent decision: the first one you made (before resolving a disagreement with the AI or a colleague).
const mine = (p, rid, layer = "human") => { const x = p.screening[layer]?.[rid]; return x ? x.first || x.decision : null; };

export function compareScreening(p, name, rids, layer = "human") {
  const other = p.team?.reviewers?.[name]?.[layer === "human" ? "screening" : "screening_ft"] || {};
  const both = rids.filter(rid => mine(p, rid, layer) && other[rid]?.decision);
  const pairs = both.map(rid => [keep(mine(p, rid, layer)), keep(other[rid].decision)]);
  const conflicts = both.filter(rid => keep(mine(p, rid, layer)) !== keep(other[rid].decision));
  return {
    n: both.length, missingOther: rids.filter(rid => !other[rid]?.decision).length, missingMine: rids.filter(rid => !mine(p, rid, layer)).length,
    kappa: pairs.length ? kappa(pairs) : null, conflicts, open: conflicts.filter(rid => !p.screening[layer]?.[rid]?.team_resolved),
  };
}

// Consensus after discussion (or a third person): the final decision, with both original decisions kept.
export function resolveScreening(p, rid, name, decision, by = "consensus", layer = "human") {
  const cur = p.screening[layer][rid] || {};
  const b = p.team.reviewers[name][layer === "human" ? "screening" : "screening_ft"][rid];
  p.screening[layer][rid] = { ...cur, first: cur.first || cur.decision, decision,
    reason: decision === "Exclude" ? (decision === cur.decision ? cur.reason : b?.reason) || cur.reason || "" : "",
    criteria: decision === "Exclude" ? (decision === cur.decision ? cur.criteria : b?.criteria) || {} : {},
    team_resolved: { with: name, other: b?.decision, by, date: today() } };
}

export function compareExtraction(p, name, rids, fields) {
  const other = p.team?.reviewers?.[name]?.extraction || {};
  const out = { compared: 0, same: 0, conflicts: [], papers: 0 };
  for (const rid of rids) {
    if (!other[rid]) continue;
    out.papers++;
    for (const f of fields) {
      const a = p.extraction.human?.[rid]?.[f.id], b = other[rid][f.id];
      if (a === undefined && b === undefined) continue;
      out.compared++;
      if (norm(a) === norm(b)) out.same++;
      else if (!p.team?.resolved_ex?.[rid]?.[f.id]) out.conflicts.push({ rid, fid: f.id, a: a ?? "", b: b ?? "" });
    }
  }
  return out;
}

export function resolveExtraction(p, rid, fid, value) {
  (p.extraction.human[rid] ||= {})[fid] = value;
  ((p.team.resolved_ex ||= {})[rid] ||= {})[fid] = today();
}

// The second person verifies instead of assessing independently (rapid reviews: rec. 12, 16).
export function verifyStamp(target, by, changed = 0) {
  target.verified = { by, date: today(), changed };
  return target;
}

// What the second reviewer has done for a set of ids, for the "two people" items in the method checks.
export function secondDone(p, kind, rids) {
  if (!rids.length) return false;
  return reviewers(p).some(name => rids.every(rid => p.team.reviewers[name][kind]?.[rid]));
}
