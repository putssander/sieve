// JATS XML (Europe PMC / PubMed Central full text) → plain text, identical in the browser and in node,
// so the example project and the app produce the same prompts. Paragraphs, titles and table rows end
// with a blank line; the reference list, figure captions and table footnotes are left out.

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));

function strip(xml) {
  return decode(xml
    .replace(/<(ref-list|table-wrap-foot|fig|supplementary-material)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<\/(p|title|sec|tr|list-item|caption|abstract)>/g, "\n\n")
    .replace(/<\/(td|th)>/g, " \t ")
    .replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function jatsToText(xml) {
  const s = String(xml || "");
  const title = (s.match(/<article-title[^>]*>([\s\S]*?)<\/article-title>/) || [])[1] || "";
  const abstract = (s.match(/<abstract(?:\s[^>]*)?>([\s\S]*?)<\/abstract>/) || [])[1] || "";
  const body = (s.match(/<body>([\s\S]*)<\/body>/) || [])[1] || "";
  return [strip(title), strip(abstract), strip(body)].filter(Boolean).join("\n\n");
}

export const jatsHasBody = xml => /<body>[\s\S]*<\/body>/.test(String(xml || ""));
