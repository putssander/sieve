// Reporting checklists (PRISMA 2020, PRISMA-S, PRISMA-ScR; item text in checklists.js, verified against the sources)
// with, per item, what Sieve already holds for this project and where. Items Sieve cannot know (rationale,
// discussion, funding…) are left to the author. The author fills in the page numbers of the manuscript.
import { CHECKLISTS } from "./checklists.js";

export { CHECKLISTS };

// facts: { sources: [name], registers: bool, searchDates: [date], strategies: bool, press: string, criteria: n,
//   screened: n, screenHow: string, second: {screening, extraction}, fields: n, extracted: n, rob: string,
//   certainty: string, included: n, ftExcluded: n, protocolDate: string, flow: bool, ai: bool }
const S = (status, where) => ({ status, where });   // status: sieve | partly | you
export function itemStatus(listId, id, f) {
  const you = S("you", "");
  if (listId === "prismaS") {
    switch (id) {
      case "1": return f.sources.length ? S("partly", `Databases: ${f.sources.join(", ")}. Add the platform of each (e.g. Ovid, Embase.com).`) : you;
      case "3": return f.registers ? S("sieve", "ClinicalTrials.gov searched (records marked as registrations).") : you;
      case "8": return f.strategies ? S("sieve", "Search strategy appendix (step 8): every version and translation, as run.") : you;
      case "9": return f.strategies ? S("partly", "Limits are in the strategies of the appendix; state them in the methods.") : you;
      case "13": return f.searchDates.length ? S("sieve", `Search dates: ${f.searchDates.join(", ")}.`) : you;
      case "14": return f.press ? S("sieve", `Peer reviewed (PRESS) by ${f.press}.`) : you;
      case "15": return f.identified ? S("sieve", `Records per source and in total in the PRISMA flow (${f.identified} records).`) : you;
      case "16": return f.identified ? S("sieve", "Bramer method (2016), strict to loose passes; counts in the flow diagram.") : you;
      default: return you;
    }
  }
  const scoping = listId === "prismaScR";
  const map = scoping ? { "5": "protocol", "6": "criteria", "7": "sources", "8": "search", "9": "selection", "10": "charting", "11": "items", "12": "robMethod", "14": "flow", "15": "chars", "16": "robResult", "17": "chars" }
    : { "5": "criteria", "6": "sources", "7": "search", "8": "selection", "9": "charting", "10a": "items", "10b": "items", "11": "robMethod", "15": "certMethod", "16a": "flow", "16b": "ftExcl",
      "17": "chars", "18": "robResult", "19": "chars", "22": "certResult", "24b": "protocol", "27": "data" };
  switch (map[id]) {
    case "protocol": return f.protocolDate ? S("partly", `Protocol fixed on ${f.protocolDate} (approved plan); register it (e.g. OSF) and cite it.`) : you;
    case "criteria": return f.criteria ? S("sieve", `${f.criteria} eligibility criteria (step 1).`) : you;
    case "sources": return f.sources.length ? S("partly", `Sources: ${f.sources.join(", ")}${f.searchDates.length ? `; searched ${f.searchDates.join(", ")}` : ""}. Add other sources (reference lists, experts).`) : you;
    case "search": return f.strategies ? S("sieve", "Full strategies in the search strategy appendix (step 8).") : you;
    case "selection": return f.screened ? S("sieve", `${f.screenHow} (methods draft, AI use statement).`) : you;
    case "charting": return f.extracted ? S("sieve", `${f.second?.extraction ? "Two people extracted independently" : "One person checked every value against its quote"}${f.ai ? "; AI drafts with verified quotes (AI use statement)" : ""}.`) : you;
    case "items": return f.fields ? S("sieve", `${f.fields} fields in the extraction form (step 7, form export).`) : you;
    case "robMethod": return f.rob ? S("sieve", `${f.rob} (step 7).`) : scoping ? S("you", "Optional for scoping reviews.") : you;
    case "robResult": return f.rob ? S("sieve", "Risk-of-bias table and summary per domain (step 7, CSV).") : scoping ? S("you", "Optional for scoping reviews.") : you;
    case "certMethod": return f.certainty ? S("sieve", `${f.certainty}; reasons for every rating (step 8).`) : you;
    case "certResult": return f.certainty ? S("sieve", "Summary-of-findings table with footnotes (step 8).") : you;
    case "flow": return f.flow ? S("sieve", "PRISMA flow diagram (step 8, SVG).") : you;
    case "ftExcl": return f.ftExcluded ? S("partly", `${f.ftExcluded} full-text exclusions with reasons (step 6); cite the studies that seemed eligible.`) : you;
    case "chars": return f.included ? S("partly", `Extraction table of ${f.included} studies (step 7, Excel).`) : you;
    case "data": return S("partly", "The project file (step 8) holds the decisions, values, prompts and runs; share it, e.g. on OSF.");
    default: return you;
  }
}

export function checklistRows(listId, facts) {
  const c = CHECKLISTS[listId];
  return c.items.map(it => ({ ...it, ...itemStatus(listId, it.id, facts) }));
}

export function checklistMarkdown(listId, facts) {
  const c = CHECKLISTS[listId];
  const label = { sieve: "in Sieve", partly: "partly in Sieve", you: "to write" };
  return [`# ${c.name} checklist`, "", `${c.cite} (${c.url}). ${c.licence}`, "",
    "| Section | Item | Checklist item | Status | Where / what Sieve has | Reported on page |", "|---|---|---|---|---|---|",
    ...checklistRows(listId, facts).map(r => `| ${r.section} | ${r.id}${r.optional ? " (optional)" : ""} | ${r.topic}: ${String(r.text).replace(/\|/g, "/").replace(/\n/g, " ")} | ${label[r.status]} | ${r.where.replace(/\|/g, "/")} | |`), ""].join("\n");
}

// Which checklists fit the review type.
export const checklistsFor = type => (type === "scoping" ? ["prismaScR", "prismaS"] : ["prisma2020", "prismaS"]);
