// One interface for every model route:  call(backend, {system, prompt, schema, name}) -> parsed JSON.
//
//   manual     copy-paste into ChatGPT / Claude.ai (no key, no GPU) - handled by the UI (see ui.js chatPanel)
//   openai     OpenAI API key, Responses API with a strict JSON schema
//   anthropic  Claude API key, Messages API with output_config.format json_schema
//   compatible any OpenAI-compatible server: Ollama, LM Studio, mlx_lm.server (Mac), vLLM on Colab via a tunnel

import { extractJson } from "./util.js";

export const KINDS = {
  manual: { label: "Copy-paste (ChatGPT / Claude.ai)", needsKey: false },
  openai: { label: "OpenAI API key", needsKey: true, model: "gpt-5.5" },
  anthropic: { label: "Claude API key", needsKey: true, model: "claude-opus-5-5" },
  compatible: { label: "Local / Colab server (OpenAI-compatible)", needsKey: false, model: "qwen3:8b", baseUrl: "http://localhost:11434/v1" },
};

export const CHAT_SITES = {
  chatgpt: { label: "ChatGPT", url: "https://chatgpt.com/" },
  claude: { label: "Claude", url: "https://claude.ai/new" },
};

export async function call(b, { system, prompt, schema, name = "result", signal }) {
  if (b.kind === "openai") return callOpenAI(b, system, prompt, schema, name, signal);
  if (b.kind === "anthropic") return callAnthropic(b, system, prompt, schema, signal);
  if (b.kind === "compatible") return callCompatible(b, system, prompt, schema, name, signal);
  throw new Error(`backend '${b.label}' is copy-paste: use the chat panel`);
}

async function post(url, headers, body, signal) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  const txt = await r.text();
  if (!r.ok) {
    let msg = txt.slice(0, 400);
    try { const j = JSON.parse(txt); msg = j.error?.message || j.message || msg; } catch { /* keep raw */ }
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return JSON.parse(txt);
}

async function callOpenAI(b, system, prompt, schema, name, signal) {
  const base = (b.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const j = await post(`${base}/responses`, { authorization: `Bearer ${b.apiKey}` }, {
    model: b.model || KINDS.openai.model,
    input: [{ role: "system", content: system }, { role: "user", content: prompt }],
    text: { format: { type: "json_schema", name, strict: true, schema } },
    max_output_tokens: b.maxTokens || 16000,
  }, signal);
  if (j.status === "incomplete") throw new Error(`incomplete response: ${JSON.stringify(j.incomplete_details)}`);
  const text = (j.output || []).filter(o => o.type === "message").flatMap(o => o.content || [])
    .filter(c => c.type === "output_text").map(c => c.text).join("");
  return { json: extractJson(text), usage: j.usage, model: j.model };
}

// Models that accept the server-side refusal fallback ("default" routing by refusal category).
const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

async function callAnthropic(b, system, prompt, schema, signal) {
  const model = b.model || KINDS.anthropic.model;
  const headers = {
    "x-api-key": b.apiKey,
    "anthropic-version": "2026-10-21",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  const body = {
    model, max_tokens: b.maxTokens || 16000, system,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema }, effort: b.effort || "medium" },
  };
  if (FALLBACK_MODELS.includes(model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
  const j = await post("https://api.anthropic.com/v1/messages", headers, body, signal);
  if (j.stop_reason === "refusal") throw new Error(`model declined: ${j.stop_details?.explanation || j.stop_details?.category || "refusal"}`);
  if (j.stop_reason === "max_tokens") throw new Error("output hit max_tokens; raise the limit in Settings");
  const text = (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  return { json: extractJson(text), usage: j.usage, model: j.model };
}

async function callCompatible(b, system, prompt, schema, name, signal) {
  const base = (b.baseUrl || KINDS.compatible.baseUrl).replace(/\/$/, "");
  const headers = b.apiKey ? { authorization: `Bearer ${b.apiKey}` } : {};
  // Qwen3 thinks at length by default; the /no_think switch keeps screening fast.
  const sys = b.noThink !== false && /qwen3/i.test(b.model || "") ? `${system}\n/no_think` : system;
  const messages = [{ role: "system", content: sys }, { role: "user", content: prompt }];
  let last;
  for (const rf of [{ type: "json_schema", json_schema: { name, strict: true, schema } }, { type: "json_object" }, null]) {
    try {
      const body = { model: b.model, messages, temperature: 0, max_tokens: b.maxTokens || 4000 };
      if (rf) body.response_format = rf;
      const j = await post(`${base}/chat/completions`, headers, body, signal);
      return { json: extractJson(j.choices?.[0]?.message?.content || ""), usage: j.usage, model: j.model || b.model };
    } catch (e) { if (signal?.aborted) throw e; last = e; }
  }
  throw last;
}

export async function testBackend(b) {
  const schema = { type: "object", properties: { ok: { type: "boolean" }, model: { type: "string" } }, required: ["ok", "model"], additionalProperties: false };
  const r = await call(b, { system: "Reply with JSON only.", prompt: 'Return {"ok": true, "model": "<your model name>"}.', schema, name: "ping" });
  return r.json;
}
