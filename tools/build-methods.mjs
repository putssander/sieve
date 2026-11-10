#!/usr/bin/env node
// Writes docs/methods.md from site/js/methods.js: node tools/build-methods.mjs
import { writeFile } from "node:fs/promises";
import { methodsMarkdown } from "../site/js/methods.js";
await writeFile(new URL("../docs/methods.md", import.meta.url), methodsMarkdown());
console.log("docs/methods.md");
