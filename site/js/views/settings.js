import { h, toast, copy, download, today } from "../util.js";
import { getSettings, setSettings } from "../store.js";
import { KINDS, CHAT_SITES, SIEVE_GPT_URL, testBackend, listModels, suggestModel } from "../llm.js";
import { card, btn, help, field, input, select, row, badge } from "../ui.js";
import { localHealth, isLocalPage, localHelperAllowed } from "../apis.js";
import { GPT_NAME, GPT_DESCRIPTION, GPT_STARTERS, gptInstructions, gptKnowledge } from "../gpt.js";
import { disclosure } from "../disclosure.js";
import { platformLogo, backendPlatform, sieveLogo } from "../brand.js";
import { stageIcon } from "../icons.js";

const MODEL_LIST_DAYS = 7;

export async function render(m, ctx) {
  const s = getSettings();
  const save = () => setSettings(s);
  m.append(h("header", { class: "settings-hero" },
    h("div", { class: "settings-hero-copy" }, h("div", { class: "eyebrow" }, "Your workspace, your way"),
      h("h1", {}, "Good research.", h("br"), h("span", {}, "Your favourite tools.")),
      h("p", { class: "lead" }, "Use the chat you know. Connect an API for automatic batches. Or bring a model running on your own computer."),
      h("a", { class: "settings-learn-link", href: "#/guide/options" }, stageIcon("info"), "Help me choose a setup", stageIcon("arrow"))),
    h("div", { class: "settings-hero-art", "aria-hidden": "true" },
      h("div", { class: "brand-art-orbit" }), sieveLogo("hero-sieve-mark"),
      platformLogo("chatgpt", "orbit-openai"), platformLogo("claude", "orbit-claude"), platformLogo("ollama", "orbit-ollama"), platformLogo("lmstudio", "orbit-lmstudio"))),
    h("div", { class: "settings-reassurance" }, h("span", {}, stageIcon("verify"), "Keys stay in this browser"),
      h("span", {}, stageIcon("chat"), "Copy-paste needs no API key"), h("a", { href: "#/guide/options" }, "Costs & data sharing →")),
    h("div", { class: "settings-section-head" }, h("div", {}, h("h2", {}, "Your connections"), h("p", {}, "Choose a default. You can switch routes for each task."))));

  // Model lists older than a week are refreshed in the background for API keys (never for local servers:
  // that would contact this device without asking).
  for (const b of s.backends) {
    if ((b.kind === "openai" || b.kind === "anthropic") && b.apiKey && (!b.modelsDate || Date.now() - Date.parse(b.modelsDate) > MODEL_LIST_DAYS * 864e5)) {
      listModels(b).then(list => { b.models = list.map(x => x.id); b.modelsDate = today(); if (!b.model) b.model = suggestModel(b.kind, list); save(); ctx.rerender(); }).catch(() => {});
    }
  }

  const list = h("div", { class: "connections-grid" });
  for (const b of s.backends) list.append(backendCard(ctx, s, b, save));
  m.append(list);

  const choices = [
    ["chatgpt", "ChatGPT", "Copy & paste", "manual", { chat: "chatgpt", label: "Copy-paste to ChatGPT" }],
    ["claude", "Claude", "Copy & paste", "manual", { chat: "claude", label: "Copy-paste to Claude" }],
    ["openai", "OpenAI", "API connection", "openai", { label: "OpenAI API" }],
    ["claude", "Claude", "API connection", "anthropic", { label: "Claude API" }],
    ["ollama", "Ollama", "Local model", "compatible", { label: "Ollama", baseUrl: "http://localhost:11434/v1" }],
    ["lmstudio", "LM Studio", "Local model", "compatible", { label: "LM Studio", baseUrl: "http://localhost:1234/v1" }],
  ];
  m.append(h("section", { class: "add-connections" },
    h("div", { class: "settings-section-head" }, h("div", {}, h("h2", {}, "Make room for another tool"), h("p", {}, "Add a connection, then choose its settings."))),
    h("div", { class: "connection-catalog" }, choices.map(([logo, title, subtitle, kind, options]) =>
      btn([platformLogo(logo, "", true), h("span", {}, h("strong", {}, title), h("small", {}, subtitle)), h("span", { class: "catalog-plus", "aria-hidden": "true" }, "+")], () => {
        const k = KINDS[kind];
        const b = { id: `${kind}-${Date.now().toString(36)}`, kind, model: k.model, baseUrl: k.baseUrl, batch: 5, concurrency: 2, ...options };
        s.backends.push(b); save(); ctx.rerender();
        requestAnimationFrame(() => document.getElementById(`connection-${b.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
      }, "catalog-card")))));

  m.append(gptCard(ctx, s, save));
  m.append(await literatureCard(ctx, s, save));
}

function backendCard(ctx, s, b, save) {
  const k = KINDS[b.kind];
  const active = s.activeBackend === b.id;
  const modelInfo = h("div");
  const drawModelInfo = () => {
    modelInfo.replaceChildren();
    if (!b.models?.length) return;
    const ok = b.models.includes(b.model);
    const best = suggestModel(b.kind, b.models.map(id => ({ id })));
    modelInfo.append(row(
      ok ? badge(`available · list of ${b.modelsDate}`, "ok") : badge(b.model ? `"${b.model}" is not offered for this key` : "no model chosen", "warn"),
      best && best !== b.model && btn(`Use ${best}`, () => { b.model = best; b.modelChosen = true; save(); ctx.rerender(); }, "sm")));
  };
  const listId = `models-${b.id}`;
  const loadModels = async e => {
    if (KINDS[b.kind].needsKey && !b.apiKey) return toast("Paste the API key first", "warn");
    e.target.disabled = true;
    try {
      const got = await listModels(b);
      b.models = got.map(x => x.id); b.modelsDate = today();
      // Not chosen by you (empty or an automatic pick that is no longer offered): take the newest.
      // A model you chose yourself is kept and flagged below if this key no longer offers it.
      if (!b.model || (!b.modelChosen && !b.models.includes(b.model))) b.model = suggestModel(b.kind, got);
      save();
      toast(`${got.length} models available${got.length ? `; newest: ${got[0].id}` : ""}`);
      ctx.rerender();
    } catch (err) { toast(`Could not list models: ${err.message}`, "err"); e.target.disabled = false; }
  };
  drawModelInfo();
  const platform = backendPlatform(b);
  return h("section", { class: `connection-card connection-${platform}${active ? " is-default" : ""}`, id: `connection-${b.id}` },
    h("div", { class: "connection-card-head" }, platformLogo(platform),
      h("div", { class: "connection-identity" }, h("h3", {}, b.label), h("p", {}, b.kind === "manual" ? "Copy & paste · you send each prompt" : b.kind === "compatible" ? "Your model server" : "API · automatic batches")),
      active && h("span", { class: "default-pill" }, stageIcon("verify"), "Default")),
    h("div", { class: "connection-fields" },
    b.kind === "manual" && [
      h("div", { class: "flabel" }, "Where do you like to chat?"),
      h("div", { class: "chat-choice" }, Object.entries(CHAT_SITES).map(([id, chat]) =>
        h("button", { type: "button", class: (b.chat || "chatgpt") === id ? "selected" : "", "aria-pressed": (b.chat || "chatgpt") === id, onclick: () => {
          if (/^Copy-paste to (ChatGPT|Claude)$/.test(b.label)) b.label = `Copy-paste to ${chat.label}`;
          b.chat = id; save(); ctx.rerender();
        } }, platformLogo(id === "claude" ? "claude" : "chatgpt", "", true), chat.label))),
      field("Papers per prompt", input(b.batch ?? 5, v => { b.batch = Number(v) || 1; save(); }, { type: "number", min: 1, max: 30 }),
        "Try 5–10 titles and abstracts, or 1–3 full-text PDFs."),
    ],
    b.kind !== "manual" && [
      (k.needsKey || b.kind === "compatible") && field(k.needsKey ? "API key" : "API key (optional)", input(b.apiKey, v => {
        b.apiKey = v.trim(); save();
        clearTimeout(b._t);
        if ((b.kind === "openai" || b.kind === "anthropic") && b.apiKey.length > 20) b._t = setTimeout(() => listModels(b).then(list => {
          b.models = list.map(x => x.id); b.modelsDate = today(); if (!b.model) b.model = suggestModel(b.kind, list); delete b._t; save(); ctx.rerender();
        }).catch(err => toast(`Could not list models: ${err.message}`, "err")), 800);
      }, { type: "password", autocomplete: "off", placeholder: k.needsKey ? "Paste your provider key" : "Only if your server needs one" })),
      field("Model", h("div", {},
        input(b.model, v => { b.model = v.trim(); b.modelChosen = true; save(); drawModelInfo(); }, { list: listId, placeholder: b.kind === "openai" ? "paste the key, then Load available models" : "" }),
        h("datalist", { id: listId }, (b.models || []).map(id => h("option", { value: id })))),
        b.kind === "compatible" ? "the model name the server knows, e.g. qwen3:8b" : "Load the list to see which models your key can use (newest first)."),
      modelInfo,
      b.kind === "compatible" && field("Server URL", input(b.baseUrl, v => { b.baseUrl = v; save(); }),
        "Ollama http://localhost:11434/v1 · LM Studio http://localhost:1234/v1 · mlx_lm.server http://localhost:8080/v1 · Colab: the tunnel URL + /v1"),
      b.kind === "compatible" && !isLocalPage() && help("A server on this computer: Chrome will ask to let this site access apps and services on this device the first time you load the model list, test, or run. That request comes from this route only; allow it if you run the local server."),
      row(btn("Load models", loadModels, "sm"), btn("Test connection", async e => {
        e.target.disabled = true;
        try { const r = await testBackend(b); toast(`OK: ${JSON.stringify(r)}`); }
        catch (err) { toast(`Failed: ${err.message}${b.kind === "compatible" ? " (is the server running and does it allow this page's origin? see README)" : ""}`, "err"); }
        e.target.disabled = false;
      }, "sm")),
    ],
    disclosure("general", "Advanced settings", "",
      field("Connection name", input(b.label, v => { b.label = v; save(); })),
      b.kind === "manual" ? field("Your own GPT link (optional)", input(b.gptUrl || "", v => { b.gptUrl = v.trim(); save(); }, { placeholder: "https://chatgpt.com/g/g-…" }), "Opens your custom GPT when you choose ChatGPT.") : [
        b.kind === "anthropic" && field("Effort", select(b.effort || "medium", ["low", "medium", "high", "xhigh", "max"], v => { b.effort = v; save(); }), "Higher effort can increase processing time and cost."),
        field("Parallel requests", input(b.concurrency ?? 2, v => { b.concurrency = Number(v) || 1; save(); }, { type: "number", min: 1, max: 8 })),
      ])),
    h("div", { class: "connection-footer" },
      active ? h("span", { class: "small muted" }, "Used by default in AI tasks") : btn("Make default", () => { s.activeBackend = b.id; save(); ctx.rerender(); }, "sm"),
      s.backends.length > 1 && btn("Remove", () => { s.backends = s.backends.filter(x => x !== b); if (active) s.activeBackend = s.backends[0].id; save(); ctx.rerender(); }, "sm ghost danger")));
}

function gptCard(ctx, s, save) {
  const chatBackend = s.backends.find(b => b.kind === "manual");
  return disclosure("chat", "Sieve GPT in ChatGPT", "Optional custom assistant setup",
    help("A custom GPT that knows every Sieve task and always answers in Sieve's JSON, so pasting back works first time. It only sees what you paste: your project stays in this browser."),
    SIEVE_GPT_URL
      ? row(h("a", { class: "btn primary", href: SIEVE_GPT_URL, target: "_blank", rel: "noopener" }, "Open the Sieve GPT ↗"),
        chatBackend && btn(chatBackend.chat === "sievegpt" && !chatBackend.gptUrl ? "✓ used for copy-paste" : "Use it for copy-paste", () => { chatBackend.chat = "sievegpt"; chatBackend.gptUrl = ""; save(); ctx.rerender(); }))
      : help(h("strong", {}, "The shared Sieve GPT is not published yet. "), "You can make your own in a few minutes (below) and paste its link under the copy-paste route."),
    h("details", { class: "block" }, h("summary", {}, h("strong", {}, "Make your own GPT (ChatGPT Plus or a team account)")),
      h("ol", { class: "small" },
        h("li", {}, "Open ", h("a", { href: "https://chatgpt.com/gpts/editor", target: "_blank", rel: "noopener" }, "chatgpt.com/gpts/editor"), " → Configure."),
        h("li", {}, `Name: ${GPT_NAME}. Description: `, btn("Copy", () => copy(GPT_DESCRIPTION), "ghost sm")),
        h("li", {}, "Instructions: ", btn("Copy instructions", () => copy(gptInstructions()), "sm"), h("span", { class: "muted" }, ` (${gptInstructions().length.toLocaleString()} of 8,000 characters)`)),
        h("li", {}, "Conversation starters: ", btn("Copy", () => copy(GPT_STARTERS.join("\n")), "ghost sm")),
        h("li", {}, "Knowledge: ", btn("Download sieve-knowledge.md", () => download("sieve-knowledge.md", gptKnowledge(), "text/markdown"), "sm"), " and upload it."),
        h("li", {}, "Capabilities: web search off, image generation off, code interpreter on. No actions."),
        h("li", {}, "Save (Only me, or Anyone with the link), copy the GPT link and paste it under the copy-paste route above as \"Your own GPT link\".")),
      help("Whatever you paste into ChatGPT is processed by OpenAI under your ChatGPT account and its data settings.")));
}

// Local helper: opt-in on the public site, because contacting 127.0.0.1 makes the browser ask for permission.
export function connectLocalHelper(ctx) {
  const s = getSettings();
  const ok = confirm("Sieve will now try to reach the local helper on this computer (python -m sieve serve, " + s.localUrl + ").\n\n"
    + "Your browser may ask to let this site \"access other apps and services on this device\". That request is for this helper only: "
    + "allow it if you started the helper; otherwise press Cancel here.");
  if (!ok) return;
  s.localHelperOptIn = true; setSettings(s);
  localHealth({ force: true }).then(hh => { toast(hh ? `Connected: ${hh.name} ${hh.version}` : "Not reachable: start python -m sieve serve and try again", hh ? "ok" : "warn"); ctx.rerender(); });
}

async function literatureCard(ctx, s, save) {
  const health = await localHealth();
  const allowed = localHelperAllowed();
  return disclosure("fulltext", "Literature APIs & local helper", "Optional contact details and full-text fetching",
    field("Your e-mail (sent to Crossref / Unpaywall / NCBI as contact, recommended)", input(s.email, v => { s.email = v.trim(); save(); }, { type: "email" })),
    field("NCBI API key (optional: 10 instead of 3 PubMed requests per second)", input(s.ncbiKey, v => { s.ncbiKey = v.trim(); save(); }),
      "Free from your NCBI account settings. Speeds up term-by-term search diagnostics."),
    field("Local helper URL", input(s.localUrl, v => { s.localUrl = v.trim(); save(); }),
      health ? `connected: ${health.name} ${health.version}` : allowed ? "not running. Start it with: python -m sieve serve (needed only to fetch publisher pages/PDFs)"
        : "optional, only for fetching publisher pages/PDFs. Sieve does not contact your computer until you connect below."),
    !allowed && row(btn("Connect to the local helper…", () => connectLocalHelper(ctx), "sm"),
      h("span", { class: "muted small" }, "your browser will ask for permission; this button explains why first")),
    allowed && !isLocalPage() && row(btn("Stop contacting the local helper", () => { s.localHelperOptIn = false; save(); ctx.rerender(); }, "ghost sm")));
}
