// Test fixtures: a synthetic search ticket (no real project data) and a tiny .docx writer.
import { deflateRawSync } from "node:zlib";

// A MEDLINE (Ovid) strategy with the features found in real library tickets: exploded and
// unexploded headings, an exclusion inside a line, field groups, adj4, Ovid wildcards (? and *),
// or/7-9, publication types, animals-not-humans, an empty row and a limit written with "…".
export const TICKET_ROWS = [
  ["Concept", "Search", "#results"],
  ["AI Mesh", "exp Artificial Intelligence/ not (exp Robotics/ or exp Fuzzy Logic/)", "263512"],
  ["AI free text", '("artificial intelligence*" or AI or "machine learning" or "large language model*").ti,ab,kf.', "574966"],
  ["AI", "1 or 2", "629467"],
  ["Care Mesh", "exp Delivery of Health Care/ or exp Health Personnel/", ""],
  ["Care free text", '(healthcare or "health care" or hospital* or "clinical setting*").ti,ab,kf.', ""],
  ["Care", "4 or 5", ""],
  ["Impl Mesh", "Implementation Science/ or exp Diffusion of Innovation/", ""],
  ["Impl TMF", '(CFIR or "RE-AIM" or "behavio?r change wheel" or "normali?ation process" or "implementation strateg*").ti,ab,kf.', ""],
  ["Impl proximity", '(("artificial intelligence" or AI) adj4 (implement* or deploy*)).ti,ab,kf.', ""],
  ["Impl", "or/7-9", ""],
  ["Combined", "3 and 6 and 10", "12302"],
  ["Excl pt", '(review or "systematic review" or editorial or letter or "Evaluation Study").pt.', ""],
  ["Excl animals", "exp animals/ not humans/", ""],
  ["Excl", "12 or 13", ""],
  ["Full", "11 not 14", "7775"],
  ["Year filter", "Limit … to yr = “2020-current”", "7244"],
  ["Note row", "", ""],
];

export const TICKET_PARAGRAPHS = [
  "Literature search service ticket",
  "Research question:\n1. Which factors affect the implementation of AI in hospitals?\n2. Which frameworks are used to study it?",
  "Articles:",
  "https://doi.org/10.1000/preprint.123",
  "https://doi.org/10.1136/bmj.n71 PMID: 33782057",
  "Population: adults in hospital care",
  "Outcome: implementation outcomes",
];

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const para = t => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${t.split("\n").map((ln, i) => `${i ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${esc(ln)}</w:t></w:r>`).join("")}</w:p>`;
const tbl = rows => `<w:tbl><w:tblPr/>${rows.map(r => `<w:tr>${r.map(c => `<w:tc><w:tcPr/>${para(c)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;

export function ticketXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
    + TICKET_PARAGRAPHS.map(para).join("")
    + para("V2 – MEDLINE via Ovid") + tbl(TICKET_ROWS)
    + para("Translations") + tbl([["Concepts", "Search", "#results"], ["Embase via OVID", "artificial intelligence/", ""], ["WoS", "TS=(AI)", ""]])
    + `<w:sectPr/></w:body></w:document>`;
}

// Minimal zip writer (deflate) → a .docx that Word-like readers accept.
export function makeDocx(xml) {
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`],
    ["word/document.xml", xml],
  ];
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, "utf8"), data = deflateRawSync(raw), nm = Buffer.from(name);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm);
    offset += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...locals, cd, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
