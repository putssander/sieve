// Project storage. Projects live in the browser (IndexedDB); full texts are kept in a
// separate store because they are large and often copyrighted (never exported by default).
// Settings (incl. API keys) live in localStorage and are never part of a project export.

const DB = "srp";
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("projects"); r.result.createObjectStore("texts"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const FORMAT = "srp-project";

export function emptyProject(name = "New review") {
  const now = new Date().toISOString();
  return {
    format: FORMAT, version: 1, id: `p-${Date.now().toString(36)}`, name, description: "",
    created: now, updated: now,
    protocol: { question: "", framework: "PICO", review_type: "systematic", notes: "",
      elements: [
        { key: "P", label: "Population / problem", text: "" },
        { key: "I", label: "Intervention / exposure", text: "" },
        { key: "C", label: "Comparison", text: "" },
        { key: "O", label: "Outcome", text: "" },
      ], documents: [] },
    criteria: [],
    screening_rules: "",
    search: { blocks: [], validation: [], holdout: [], versions: [], sample: null, last: null, strategies: [], headingMap: {} },
    records: [],
    resolve: {},
    fulltext: {},
    screening: { runs: {}, human: {} },
    extraction: { fields: [], instructions: "", runs: {}, human: {} },
  };
}

// Fill in any keys missing from older/hand-written project files.
export function normalize(p) {
  const base = emptyProject(p.name);
  const out = { ...base, ...p };
  for (const k of ["protocol", "search", "screening", "extraction"]) out[k] = { ...base[k], ...(p[k] || {}) };
  out.records = (p.records || []).map(r => ({ ...r, rid: String(r.rid ?? r.record_id ?? r.id) }));
  return out;
}

export async function listProjects() {
  const all = await tx("projects", "readonly", s => s.getAll());
  return (all || []).map(p => ({ id: p.id, name: p.name, updated: p.updated, n: p.records?.length || 0, demo: !!p.demo }))
    .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}
export const loadProject = id => tx("projects", "readonly", s => s.get(id)).then(p => p && normalize(p));
export async function saveProject(p) { p.updated = new Date().toISOString(); await tx("projects", "readwrite", s => s.put(p, p.id)); }
export async function deleteProject(id) {
  await tx("projects", "readwrite", s => s.delete(id));
  const keys = await tx("texts", "readonly", s => s.getAllKeys());
  await tx("texts", "readwrite", s => { keys.filter(k => k.startsWith(id + ":")).forEach(k => s.delete(k)); });
}

export const getText = (pid, rid) => tx("texts", "readonly", s => s.get(`${pid}:${rid}`)).then(t => t || "");
export const putText = (pid, rid, text) => tx("texts", "readwrite", s => s.put(text, `${pid}:${rid}`));

// Import a project file. Embedded full texts (demo files) are moved to the text store.
export async function importProject(obj, { overwrite = true } = {}) {
  if (obj.format !== FORMAT) throw new Error("Not a project file (format must be 'srp-project')");
  const p = normalize(structuredClone(obj));
  if (!overwrite && (await loadProject(p.id))) p.id = `${p.id}-${Date.now().toString(36)}`;
  for (const [rid, ft] of Object.entries(p.fulltext || {})) {
    if (ft.text) { await putText(p.id, rid, ft.text); ft.chars = ft.text.length; delete ft.text; }
  }
  await saveProject(p);
  return p;
}

export async function exportProject(p, { withTexts = false } = {}) {
  const out = structuredClone(p);
  if (withTexts) for (const rid of Object.keys(out.fulltext || {})) out.fulltext[rid].text = await getText(p.id, rid);
  return JSON.stringify(out, null, 1);
}

// ------------------------------------------------------------------ settings
const SKEY = "srp-settings";
export const DEFAULT_SETTINGS = {
  // The first backend is the default: copy-paste needs no key, GPU or install.
  backends: [
    { id: "chat", label: "Copy-paste to ChatGPT", kind: "manual", chat: "chatgpt", batch: 5 },
    { id: "openai", label: "OpenAI API", kind: "openai", model: "gpt-5.5", apiKey: "", concurrency: 2 },
    { id: "claude", label: "Claude API", kind: "anthropic", model: "claude-opus-5-5", apiKey: "", effort: "medium", concurrency: 2 },
  ],
  activeBackend: "chat",
  email: "",
  ncbiKey: "",
  localUrl: "http://127.0.0.1:8765",
};
export function getSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
export function setSettings(s) { localStorage.setItem(SKEY, JSON.stringify(s)); }
