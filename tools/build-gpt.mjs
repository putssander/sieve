#!/usr/bin/env node
// Writes the files for the Sieve GPT (see gpt/README.md): node tools/build-gpt.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { gptInstructions, gptKnowledge, gptReadme, GPT_INSTRUCTIONS_LIMIT } from "../site/js/gpt.js";

const dir = new URL("../gpt/", import.meta.url);
await mkdir(dir, { recursive: true });
const ins = gptInstructions();
if (ins.length > GPT_INSTRUCTIONS_LIMIT) { console.error(`instructions are ${ins.length} characters; the limit is ${GPT_INSTRUCTIONS_LIMIT}`); process.exit(1); }
await writeFile(new URL("instructions.md", dir), ins);
await writeFile(new URL("knowledge.md", dir), gptKnowledge());
await writeFile(new URL("README.md", dir), gptReadme());
console.log(`gpt/instructions.md (${ins.length} characters), gpt/knowledge.md, gpt/README.md`);
