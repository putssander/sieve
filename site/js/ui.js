// Shared UI components: cards, tables, modal, and the RUN PANEL that executes any LLM task
// through the chosen route (copy-paste chat, API key, or a job file for Colab / local GPU).

import { h, clear, copy, toast, download, pickFile, extractJson, pool, slug, esc } from "./util.js";
import { call, KINDS, CHAT_SITES } from "./llm.js";
import { getSettings, setSettings } from "./store.js";

export const card = (title, ...body) => h("section", { class: "card" }, title && h("h3", {}, title), ...body);
export const help = (...t) => h("p", { class: "help" }, ...t);
export const btn = (label, onclick, cls = "") => h("button", { class: `btn ${cls}`, onclick }, label);
export const badge = (text, kind = "") => h("span", { class: `badge ${kind}` }, text);
export const row = (...c) => h("div", { class: "row" }, ...c);

export function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", { class: "flabel" }, label), input, hint && h("span", { class: "fhint" }, hint));
}
export function input(value, oninput, attrs = {}) {
  return h("input", { value: value ?? "", oninput: e => oninput(e.target.value), ...attrs });
}
export function textarea(value, oninput, attrs = {}) {
  return h("textarea", { oninput: e => oninput(e.target.value), ...attrs }, value ?? "");
}
export function select(value, options, onchange, attrs = {}) {
  return h("select", { onchange: e => onchange(e.target.value), ...attrs },
    options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h("option", { value: v, selected: v === value }, l); }));
}

export function table(cols, rows, { onRow, rowClass, empty = "Nothing here yet.", limit = 200 } = {}) {
  if (!rows.length) return h("p", { class: "muted" }, empty);
  let shown = limit;
  const tbody = h("tbody");
  const wrap = h("div", { class: "tablewrap" });
  const more = h("div", { class: "more" });
  function fill() {
    clear(tbody);
    for (const r of rows.slice(0, shown)) {
      tbody.appendChild(h("tr", { class: (rowClass?.(r) || "") + (onRow ? " clickable" : ""), onclick: onRow ? () => onRow(r) : undefined },
        cols.map(c => h("td", { class: c.cls || "" }, c.render ? c.render(r) : String(r[c.key] ?? "")))));
    }
    clear(more);
    if (rows.length > shown) more.appendChild(btn(`Show more (${rows.length - shown} hidden)`, () => { shown += limit; fill(); }, "ghost"));
  }
  fill();
  wrap.appendChild(h("table", {}, h("thead", {}, h("tr", {}, cols.map(c => h("th", { class: c.cls || "", title: c.title || "" }, c.label)))), tbody));
  wrap.appendChild(more);
  return wrap;
}

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => { bg.remove(); onClose?.(); };
  const bg = h("div", { class: "modal-bg", onclick: e => e.target === bg && close() },
    h("div", { class: `modal ${wide ? "wide" : ""}` },
      h("div", { class: "modal-head" }, h("h3", {}, title), btn("✕", close, "ghost")),
      h("div", { class: "modal-body" }, body)));
  document.body.appendChild(bg);
  return close;
}

export function progress() {
  const bar = h("div", { class: "bar" }, h("div", { class: "fill" }));
  const label = h("span", { class: "muted" });
  const el = h("div", { class: "progress" }, bar, label);
  return { el, set(done, total, msg = "") { bar.firstChild.style.width = `${total ? (100 * done) / total : 0}%`; label.textContent = `${done}/${total} ${msg}`; } };
}

// ------------------------------------------------------------------ backends
export function activeBackend() {
  const s = getSettings();
  return s.backends.find(b => b.id === s.activeBackend) || s.backends[0];
}

export function backendPicker(onchange) {
  const s = getSettings();
  return h("div", { class: "backend-picker" },
    h("span", { class: "flabel" }, "Model route"),
    select(s.activeBackend, s.backends.map(b => [b.id, `${b.label}${b.model ? ` · ${b.model}` : ""}`]), v => {
      setSettings({ ...getSettings(), activeBackend: v }); onchange?.();
    }),
    h("a", { href: "#/settings", class: "small" }, "manage"));
}

// ------------------------------------------------------------------ run panel
//
// task = {
//   title, system,
//   items: [{id, label}],                      // work units (papers, or one item for single prompts)
//   build(items) -> {prompt, schema, name}     // prompt for 1..n items (n>1 only for copy-paste batches)
//   save(id, json, run)                        // store one result
//   done()                                     // re-render after saving
//   runName: suggested name, batchable: bool, attachHint: bool
// }
export function runPanel(task) {
  const b = activeBackend();
  const host = h("div", { class: "runpanel" });
  const nameIn = input(task.runName || defaultRunName(b), () => {}, { class: "runname" });
  const head = row(backendPicker(() => { const n = runPanel(task); host.replaceWith(n); }),
    field("Save results as run", nameIn, "results from different models/routes are kept side by side"));
  host.append(head);
  if (!task.items.length) { host.append(help("Nothing to run: no items match the current selection.")); return host; }
  const runName = () => slug(nameIn.value || defaultRunName(b));
  host.append(b.kind === "manual" ? chatPanel(task, b, runName) : apiPanel(task, b, runName));
  host.append(h("details", { class: "advanced" }, h("summary", {}, "Run on Colab / a local GPU instead (job file)"),
    help("Export a job file, run it with ", h("code", {}, "python -m srp run job.json --backend hf --model Qwen/Qwen3-8B"),
      " (Colab notebook in ", h("code", {}, "colab/"), "), then import the results file here."),
    row(btn("Export job file", () => exportJob(task, runName())), btn("Import results file", () => importResults(task, runName())))));
  return host;
}

function defaultRunName(b) {
  if (b.kind === "manual") return `${b.chat === "claude" ? "claude-chat" : "chatgpt"}`;
  return b.model || b.label;
}

function apiPanel(task, b, runName) {
  const prog = progress();
  const log = h("div", { class: "log" });
  let ctrl;
  const start = btn(`Run ${task.items.length} item${task.items.length > 1 ? "s" : ""} with ${b.label}`, async () => {
    if (KINDS[b.kind]?.needsKey && !b.apiKey) { toast("Add the API key in Settings first", "err"); location.hash = "#/settings"; return; }
    ctrl = new AbortController();
    start.disabled = true; stop.disabled = false;
    const run = { id: runName(), label: `${b.label} · ${b.model || ""}`, model: b.model, backend: b.kind, date: new Date().toISOString().slice(0, 10) };
    let errors = 0;
    await pool(task.items, b.concurrency || 2, async it => {
      const { prompt, schema, name } = task.build([it]);
      try {
        const r = await call(b, { system: task.system, prompt, schema, name, signal: ctrl.signal });
        task.save(it.id, r.json, { ...run, model: r.model || run.model });
        log.prepend(h("div", {}, `✓ ${it.label || it.id}`));
      } catch (e) {
        errors++;
        task.save(it.id, { _error: String(e.message || e) }, run);
        log.prepend(h("div", { class: "err" }, `✗ ${it.label || it.id}: ${e.message}`));
      }
    }, (d, t) => prog.set(d, t, errors ? `· ${errors} errors` : ""), ctrl.signal);
    start.disabled = false; stop.disabled = true;
    task.done();
  }, "primary");
  const stop = btn("Stop", () => ctrl?.abort(), "ghost");
  stop.disabled = true;
  return h("div", {}, help(`Calls go straight from this browser to ${b.kind === "compatible" ? b.baseUrl : b.kind === "openai" ? "OpenAI" : "Anthropic"}; your key is stored only in this browser.`),
    row(start, stop), prog.el, log);
}

// Copy-paste route: one prompt per batch of items; the answer JSON is pasted back.
function chatPanel(task, b, runName) {
  const size = task.batchable === false ? 1 : Math.max(1, Number(b.batch) || 5);
  const chunks = [];
  for (let i = 0; i < task.items.length; i += size) chunks.push(task.items.slice(i, i + size));
  let idx = 0, attach = false;
  const box = h("div", { class: "chat" });
  const site = CHAT_SITES[b.chat] || CHAT_SITES.chatgpt;

  function render() {
    clear(box);
    const items = chunks[idx];
    const { prompt } = task.build(items, { attachments: attach });
    const answer = h("textarea", { class: "answer", placeholder: "Paste the complete answer from the chat here (the JSON part is found automatically)" });
    box.append(
      row(h("strong", {}, `Batch ${idx + 1} of ${chunks.length}`), h("span", { class: "muted" }, items.map(i => i.label || i.id).join(" · ").slice(0, 160)),
        chunks.length > 1 && btn("◀", () => { idx = Math.max(0, idx - 1); render(); }, "ghost"),
        chunks.length > 1 && btn("▶", () => { idx = Math.min(chunks.length - 1, idx + 1); render(); }, "ghost")),
      h("ol", { class: "steps" },
        h("li", {}, btn("1 · Copy prompt", () => copy(prompt), "primary"), " ",
          h("details", { class: "inline" }, h("summary", {}, `view (${Math.round(prompt.length / 1000)}k characters)`), h("pre", { class: "prompt" }, prompt))),
        h("li", {}, h("a", { class: "btn", href: site.url, target: "_blank", rel: "noopener" }, `2 · Open ${site.label}`), " ",
          h("a", { class: "small", href: (site === CHAT_SITES.chatgpt ? CHAT_SITES.claude : CHAT_SITES.chatgpt).url, target: "_blank", rel: "noopener" },
            `or ${(site === CHAT_SITES.chatgpt ? CHAT_SITES.claude : CHAT_SITES.chatgpt).label}`),
          help("Start a new chat, paste the prompt and send. A reasoning/thinking model gives the best screening. ",
            task.attachHint ? "If you have the PDFs (e.g. via university access), tick the box below and attach them in the chat." : "")),
        h("li", {}, answer, row(btn("3 · Save answer", () => {
          try {
            const json = extractJson(answer.value);
            const list = Array.isArray(json) ? json : json.results || [json];
            const run = { id: runName(), label: `${site.label} (copy-paste)`, model: site.label, backend: "copy-paste", date: new Date().toISOString().slice(0, 10) };
            let n = 0;
            list.forEach((res, k) => {
              const id = String(res.id ?? items[k]?.id ?? "");
              if (items.some(i => String(i.id) === id) || items.length === 1) { task.save(items.length === 1 ? items[0].id : id, res, run); n++; }
            });
            if (!n) throw new Error("no result matched the paper IDs of this batch");
            toast(`Saved ${n} of ${items.length} results`);
            task.done();
            if (idx < chunks.length - 1) { idx++; render(); }
          } catch (e) { toast(e.message, "err"); }
        }, "primary"))),
      ),
      task.attachHint && h("label", { class: "check" }, h("input", { type: "checkbox", checked: attach, onchange: e => { attach = e.target.checked; render(); } }), " I will attach the PDFs in the chat"),
    );
  }
  render();
  return box;
}

function exportJob(task, run) {
  const items = task.items.map(it => { const { prompt, schema, name } = task.build([it]); return { id: it.id, prompt, schema, name }; });
  const job = { format: "srp-job", version: 1, task: task.title, run, system: task.system, created: new Date().toISOString(), items };
  download(`job-${slug(task.title)}-${run}.json`, JSON.stringify(job, null, 1));
}

async function importResults(task, run) {
  const f = await pickFile(".json,.jsonl");
  if (!f) return;
  const txt = await f.text();
  let results = {}, meta = { id: run, label: f.name, backend: "import", date: new Date().toISOString().slice(0, 10) };
  try {
    const j = JSON.parse(txt);
    if (j.format === "srp-results") { results = j.results; meta = { ...meta, id: slug(j.model || j.run || run), model: j.model, backend: j.backend, label: `${j.backend || "runner"} · ${j.model || ""}` }; }
    else if (Array.isArray(j)) j.forEach(r => (results[r.id ?? r.record_id] = r));
    else results = j.results || j;
  } catch {
    txt.split("\n").filter(l => l.trim()).forEach(l => { const r = JSON.parse(l); results[r.id ?? r.record_id] = r; });
  }
  let n = 0;
  for (const [id, r] of Object.entries(results)) if (task.items.some(i => String(i.id) === String(id))) { task.save(id, r, meta); n++; }
  toast(`Imported ${n} results as run '${meta.id}'`);
  task.done();
}

export { esc };
