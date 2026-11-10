import { h } from "./util.js";
import { stageIcon } from "./icons.js";

const MARKS = {
  openai: ["OpenAI", "openai"], chatgpt: ["ChatGPT", "openai"], claude: ["Claude", "claude"],
  ollama: ["Ollama", "ollama"], lmstudio: ["LM Studio", "lmstudio"], colab: ["Google Colab", "googlecolab"],
};

export function sieveLogo(className = "") {
  return h("img", { src: "assets/sieve-mark.svg", width: 48, height: 48, alt: "", class: `sieve-mark ${className}` });
}

export function platformLogo(id, className = "", decorative = false) {
  if (id === "local") return h("span", { class: `platform-logo platform-local ${className}`, title: "Model server" }, stageIcon("computer"));
  const [name, file] = MARKS[id] || MARKS.openai;
  return h("span", { class: `platform-logo platform-${id} ${className}`, title: name },
    h("img", { src: `assets/brands/${file}.svg`, width: 28, height: 28, alt: decorative ? "" : name }));
}

export function platformStrip() {
  return h("div", { class: "platform-strip" }, h("span", { class: "platform-strip-label" }, "Works with your tools"),
    h("div", { class: "platform-strip-items" }, ["chatgpt", "claude", "ollama", "lmstudio", "colab"].map(id =>
      h("a", { href: "#/guide/options", class: "platform-chip" }, platformLogo(id, "", true), h("span", {}, MARKS[id][0])))));
}

export function backendPlatform(b) {
  if (b.kind === "openai") return "openai";
  if (b.kind === "anthropic") return "claude";
  if (b.kind === "manual") return b.chat === "claude" ? "claude" : "chatgpt";
  const base = b.baseUrl || "";
  return base.includes(":1234") ? "lmstudio" : base.includes(":11434") ? "ollama" : "local";
}
