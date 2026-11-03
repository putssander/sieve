import { h, toast, slug } from "../util.js";
import { getSettings, setSettings } from "../store.js";
import { KINDS, CHAT_SITES, testBackend } from "../llm.js";
import { card, btn, help, field, input, select, row } from "../ui.js";
import { localHealth } from "../apis.js";

export async function render(m, ctx) {
  const s = getSettings();
  const save = () => setSettings(s);
  m.append(h("header", { class: "page-head" }, h("h1", {}, "Models & keys"),
    h("p", { class: "lead" }, "Choose how AI steps run. Everything here is stored only in this browser (localStorage) and is never part of an exported project.")));

  const list = h("div", { class: "grid2" });
  for (const b of s.backends) {
    const k = KINDS[b.kind];
    const active = s.activeBackend === b.id;
    list.append(card(null,
      row(h("h3", { style: { margin: 0 } }, b.label), h("span", { class: "spacer" }),
        active ? h("span", { class: "badge ok" }, "default") : btn("Make default", () => { s.activeBackend = b.id; save(); ctx.rerender(); }, "sm"),
        s.backends.length > 1 && btn("Remove", () => { s.backends = s.backends.filter(x => x !== b); if (active) s.activeBackend = s.backends[0].id; save(); ctx.rerender(); }, "sm danger")),
      h("p", { class: "muted small" }, k.label),
      field("Name", input(b.label, v => { b.label = v; save(); })),
      b.kind === "manual" && [
        field("Chat site", select(b.chat || "chatgpt", Object.entries(CHAT_SITES).map(([v, c]) => [v, c.label]), v => { b.chat = v; save(); })),
        field("Papers per prompt", input(b.batch ?? 5, v => { b.batch = Number(v) || 1; save(); }, { type: "number", min: 1, max: 30 }),
          "5–10 works well for titles/abstracts; use 1–3 when you attach full-text PDFs."),
      ],
      b.kind !== "manual" && [
        field("Model", input(b.model, v => { b.model = v; save(); }),
          b.kind === "openai" ? "e.g. gpt-5.5" : b.kind === "anthropic" ? "e.g. claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5" : "the model name the server knows, e.g. qwen3:8b or mlx-community/Qwen3-8B-4bit"),
        b.kind === "compatible" && field("Server URL", input(b.baseUrl, v => { b.baseUrl = v; save(); }),
          "Ollama http://localhost:11434/v1 · LM Studio http://localhost:1234/v1 · mlx_lm.server http://localhost:8080/v1 · Colab: the tunnel URL + /v1"),
        (k.needsKey || b.kind === "compatible") && field(k.needsKey ? "API key" : "API key (optional)", input(b.apiKey, v => { b.apiKey = v.trim(); save(); }, { type: "password", autocomplete: "off" })),
        b.kind === "anthropic" && field("Effort", select(b.effort || "medium", ["low", "medium", "high"], v => { b.effort = v; save(); }), "low is cheaper and usually enough for title/abstract screening"),
        field("Parallel requests", input(b.concurrency ?? 2, v => { b.concurrency = Number(v) || 1; save(); }, { type: "number", min: 1, max: 8 })),
        row(btn("Test connection", async e => {
          e.target.disabled = true;
          try { const r = await testBackend(b); toast(`OK: ${JSON.stringify(r)}`); }
          catch (err) { toast(`Failed: ${err.message}${b.kind === "compatible" ? " (is the server running and does it allow this page's origin? see README)" : ""}`, "err"); }
          e.target.disabled = false;
        }, "sm")),
      ]));
  }
  m.append(list);

  m.append(card("Add a model route",
    row(...Object.entries(KINDS).map(([kind, k]) => btn(`+ ${k.label}`, () => {
      const id = `${kind}-${Date.now().toString(36)}`;
      s.backends.push({ id, kind, label: kind === "manual" ? "Copy-paste to Claude" : kind === "openai" ? "OpenAI" : kind === "anthropic" ? "Claude API" : "Local model",
        model: k.model, baseUrl: k.baseUrl, chat: kind === "manual" ? "claude" : undefined, batch: 5, concurrency: 2 });
      save(); ctx.rerender();
    }))),
    help("Start with copy-paste. When you screen hundreds of records, an API key saves a lot of pasting: GPT-5.5 and Claude cost roughly a few cents per paper for title/abstract screening. "
      + "A key in a browser is visible to anyone using this browser profile; use a key with a spending limit.")));

  const health = await localHealth();
  m.append(card("Literature APIs & local helper",
    field("Your e-mail (sent to Crossref / Unpaywall / NCBI as contact, recommended)", input(s.email, v => { s.email = v.trim(); save(); }, { type: "email" })),
    field("NCBI API key (optional: 10 instead of 3 PubMed requests per second)", input(s.ncbiKey, v => { s.ncbiKey = v.trim(); save(); }),
      "Free from your NCBI account settings. Speeds up term-by-term search diagnostics."),
    field("Local helper URL", input(s.localUrl, v => { s.localUrl = v.trim(); save(); }),
      health ? `connected: ${health.name} ${health.version}` : "not running. Start it with: python -m sieve serve (needed only to fetch publisher pages/PDFs)"),
  ));
}
