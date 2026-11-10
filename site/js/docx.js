// Minimal .docx reader that keeps the document structure: paragraphs and tables (rows × cells).
// No dependencies: unzips with the platform's DecompressionStream (browsers and Node >= 18),
// so the same code runs in the app and in the node tests / command-line tool.
//
//   const blocks = await readDocx(arrayBuffer);
//   // [{ type: "p", text }, { type: "table", rows: [["Concept", "Search", "#results"], ...] }, ...]

export async function readDocx(buf) {
  const files = unzipIndex(buf);
  const entry = files.get("word/document.xml");
  if (!entry) throw new Error("Not a Word document (word/document.xml missing)");
  return parseDocumentXml(await inflateEntry(buf, entry));
}

// Plain text of the blocks (tables as tab-separated rows), e.g. for the protocol assistant.
export function blocksToText(blocks) {
  return blocks.map(b => (b.type === "p" ? b.text : b.rows.map(r => r.map(c => c.replace(/\s*\n\s*/g, " / ")).join("\t")).join("\n"))).join("\n");
}

// Plain text → paragraph blocks, for .txt/.md/.pdf input. Tab-separated runs of lines become tables.
export function textToBlocks(text) {
  const out = [];
  let table = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.includes("\t")) { (table ||= (out.push({ type: "table", rows: [] }), out[out.length - 1])).rows.push(line.split("\t").map(c => c.trim())); continue; }
    table = null;
    if (line.trim()) out.push({ type: "p", text: line.trim() });
  }
  return out;
}

// ------------------------------------------------------------------ zip
function unzipIndex(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a zip / .docx file");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    files.set(dec.decode(u8.subarray(p + 46, p + 46 + nlen)), { method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  return files;
}

async function inflateEntry(buf, { method, csize, local }) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
  const data = u8.subarray(start, start + csize);
  if (method === 0) return new TextDecoder().decode(data);
  if (method !== 8) throw new Error(`Unsupported zip compression ${method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

// ------------------------------------------------------------------ WordprocessingML
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));

export function parseDocumentXml(xml) {
  const out = [];
  const tables = [];        // stack of open tables: { rows, row, cell }
  let para = null, inText = false, inTabs = false;
  const re = /<(\/?)([\w:]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] !== undefined) { if (inText && para !== null) para += unescape(m[5]); continue; }
    const [, close, tag, , self] = m;
    const open = !close, end = close || self;
    switch (tag) {
      case "w:p": if (open && !self) para = ""; if (end) endPara(); break;
      case "w:t": inText = open && !self; break;
      case "w:tabs": inTabs = open && !self; break;                       // tab-stop definitions, not text
      case "w:tab": if (open && !inTabs && para !== null) para += "\t"; break;
      case "w:br": case "w:cr": if (open && para !== null) para += "\n"; break;
      case "w:tbl": if (open) tables.push({ rows: [], row: null, cell: null }); else { const t = tables.pop(); emitTable(t); } break;
      case "w:tr": { const t = tables[tables.length - 1]; if (!t) break; if (open) t.row = []; else { t.rows.push(t.row); t.row = null; } break; }
      case "w:tc": { const t = tables[tables.length - 1]; if (!t) break; if (open) t.cell = []; else { t.row?.push(t.cell.join("\n").trim()); t.cell = null; } break; }
      default: break;
    }
  }
  return out;

  function endPara() {
    if (para === null) return;
    const text = para.replace(/ /g, " ").replace(/[ \t]+$/gm, "").trim();
    para = null;
    const t = tables[tables.length - 1];
    if (t?.cell) { if (text) t.cell.push(text); return; }
    if (text) out.push({ type: "p", text });
  }
  function emitTable(t) {
    const rows = t.rows.filter(r => r && r.some(c => c));
    const parent = tables[tables.length - 1];
    if (parent?.cell) { parent.cell.push(rows.map(r => r.join(" | ")).join("\n")); return; }   // nested table: flatten into the cell
    if (rows.length) out.push({ type: "table", rows });
  }
}
