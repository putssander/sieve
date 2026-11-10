// Optional: run every real document in a local folder through the importer and the translator.
// Real tickets stay outside the repository:   SIEVE_LOCAL_DOCS=~/path/to/docs npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readDocument, analyzeDocument } from "../site/js/docimport.js";
import { translateStrategy, TARGETS } from "../site/js/strategy.js";

const dir = process.env.SIEVE_LOCAL_DOCS;
const balanced = s => { let d = 0; for (const c of s.replace(/"[^"]*"/g, "")) { if (c === "(") d++; if (c === ")" && --d < 0) return false; } return d === 0; };

test("local documents translate cleanly", { skip: !dir && "set SIEVE_LOCAL_DOCS to a folder with .docx tickets" }, async () => {
  const files = (await readdir(dir)).filter(f => /\.docx$/i.test(f) && !f.startsWith("~$"));
  assert.ok(files.length, "no .docx files");
  for (const f of files) {
    const a = analyzeDocument(await readDocument(f, await readFile(join(dir, f))), { name: f });
    for (const s of a.strategies.filter(x => x.kind === "lines")) {
      for (const t of Object.keys(TARGETS)) {
        const r = translateStrategy(s, t);
        for (const l of r.lines.filter(x => x.n !== null)) assert.ok(balanced(l.text), `${f} / ${s.name} / ${t} line ${l.n}: ${l.text}`);
        assert.ok(balanced(r.single), `${f} / ${s.name} / ${t}: one string`);
      }
    }
  }
});
