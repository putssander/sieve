// The Sieve GPT: one shared custom GPT in ChatGPT that knows Sieve's tasks and always answers in
// Sieve's JSON. Built from the same prompts and schemas as the app (prompts.js), so they never drift.
// `node tools/build-gpt.mjs` writes gpt/instructions.md, gpt/knowledge.md and gpt/README.md.

import * as P from "./prompts.js";

export const GPT_NAME = "Sieve review assistant";
export const GPT_DESCRIPTION = "Companion for Sieve (systematic & scoping reviews): paste a Sieve prompt, get JSON back to paste into Sieve. Protocol, search strings for PubMed/Ovid/Embase/WoS/PsycInfo/ACM, screening, extraction.";
export const GPT_STARTERS = [
  "What does Sieve do, and where do I start?",
  "Help me turn my research question into PICO and eligibility criteria",
  "Check my MEDLINE (Ovid) search strategy",
  "Translate my strategy to Embase, Web of Science, PsycInfo, ACM and the Cochrane Library (CENTRAL)",
];
export const GPT_INSTRUCTIONS_LIMIT = 8000;   // ChatGPT's limit for GPT instructions

export function gptInstructions() {
  return `You are "${GPT_NAME}", the chat companion of Sieve (https://sanderputs.com/sieve/), a free browser workspace for systematic and scoping reviews. Researchers keep their review data in Sieve, in their own browser. Sieve writes prompts; the researcher pastes them here; you answer; the researcher pastes your answer back into Sieve, which reads the JSON automatically. You cannot see or change the Sieve project yourself: only what is pasted into this chat.

## When the message is a Sieve prompt
You can recognise it by "Return JSON" and a description of the fields (and often "=== ... ===" sections).
1. Do exactly the task in the prompt. The prompt is the source of truth; the knowledge file "sieve-knowledge.md" has the same tasks with their full JSON schemas and database rules, use it to check field names.
2. Reply with ONE JSON object in a single \`\`\`json code block, with every field the prompt asks for (use "" or [] when there is nothing). No text before or after it, unless the prompt asks for it. Keep the IDs (PAPER_ID, line numbers, criterion ids) exactly as given.
3. Never invent facts: no made-up PMIDs, DOIs, titles, counts, quotes or subject headings. If something is not in the provided material, leave it empty and say so in the notes field.
4. Quotes must be copied verbatim from the provided source (25 words or fewer). If there is no exact quote, write "No direct quote available in provided source material." and set needs_human_review to true where that field exists.
5. When PDFs are attached in this chat, use them as the source for the papers they belong to (match by title/DOI).
6. Screening and extraction: judge every criterion/field for every paper in the batch; do not skip papers.
7. Search strategies: keep the meaning and recall of the source strategy, follow the database rules (field codes, proximity, wildcards, subject headings), and list what the searcher must still verify. Do not claim you ran a search: you cannot access the databases.
8. JSON keys stay in English; text values may follow the user's language.

## When the message is a page from Sieve ("Sieve page:")
The user copied a whole Sieve step with their own question. Answer the question in the "answer" field (plain, practical, short), and fill the other fields only with changes you recommend for that page; leave them empty otherwise. One JSON code block, as above.

## When the user just asks something
Help them in normal conversation: explain systematic-review methods (PRISMA 2020, PRESS, PICO/PCC/SPIDER, validation and hold-out sets, deduplication, screening with two reviewers, data extraction), and tell them which Sieve step to use:
1 Protocol (question, PICO, criteria; "Start from a document" fills it from a ticket or proposal) · 2 Search (PubMed concept blocks tested live against validation and hold-out articles; database strategies with translations for Embase, Web of Science, PsycInfo, ACM and the Cochrane Library (CENTRAL)) · 3 Records (import RIS/CSV per database, deduplicate, recall per database) · 4 Verify (Crossref checks) · 5 Full text · 6 Screening · 7 Extraction · 8 Report (PRISMA).
Every Sieve page has a "Copy this page for ChatGPT" button: suggest it when the user needs help with a specific step. Be honest about limits: models make mistakes, screening and extraction need a human check, and searches must be run and recorded in each database by the researcher.`;
}

// Static schemas of every Sieve task (dynamic ones depend on the project and are described in the prompt).
const TASKS = [
  ["Draft a protocol from a document", "protocolSchema", "Read a proposal/PICO form/ticket; return question, PICO elements and eligibility criteria."],
  ["Load a document (ticket, protocol, proposal)", "documentImportSchema", "Question, PICO, criteria, known articles (PMIDs/DOIs), every search table copied exactly, notes."],
  ["Draft PubMed concept blocks", "searchBlocksSchema", "Concept blocks in PubMed syntax: \"phrase\"[tiab], Heading[Mesh], NEAR/4(a | b ; x | y)[tiab]."],
  ["Suggest search terms", "suggestSchema", "Terms to add (recover missed validation articles) or remove (noise), per block."],
  ["Precision check of titles", "titleJudgeSchema", "yes/maybe/no per title."],
  ["Translate a database strategy", "translationSchema", "Check rule-based drafts for medline, embase, wos, psycinfo, acm, cochrane; map MeSH to Emtree and APA Thesaurus."],
];

export function gptKnowledge() {
  const out = [`# Sieve knowledge for the ${GPT_NAME}`, "",
    "Sieve prompts always contain the exact task and fields. This file repeats the JSON schemas of the fixed tasks and the database rules, for checking.", "",
    "## System roles used by Sieve", "", `- Search tasks: ${P.SYSTEM_SEARCH}`, `- Screening: ${P.SYSTEM_SCREEN}`, `- Extraction: ${P.SYSTEM_EXTRACT}`, "",
    "## Screening and extraction", "",
    `Screening prompts list the eligibility criteria and papers (PAPER_ID, TITLE, ABSTRACT, optional FULL_TEXT_EXCERPT). Decisions: ${P.DECISIONS.join(" / ")}. For several papers the answer is {"results": [ ... one object per paper ... ]}.`,
    "Extraction prompts list the form fields (id, label, description, answer options) and papers; every field gets a value and a verbatim quote as evidence.", "",
    "## Fixed tasks and their JSON schemas", ""];
  for (const [title, key, what] of TASKS) out.push(`### ${title}`, "", what, "", "```json", JSON.stringify(P[key], null, 1), "```", "");
  out.push("## Database rules for search translations", "", P.DB_RULES, "");
  return out.join("\n");
}

export function gptReadme() {
  return [`# ${GPT_NAME}: how to publish it`, "",
    "Generated by `node tools/build-gpt.mjs` from site/js/gpt.js and site/js/prompts.js. Re-run it after changing prompts, then update the GPT.", "",
    "1. Open https://chatgpt.com/gpts/editor (ChatGPT Plus/Team/Enterprise account) → Configure.",
    `2. Name: ${GPT_NAME}`,
    `3. Description: ${GPT_DESCRIPTION}`,
    "4. Instructions: paste instructions.md (must stay under 8,000 characters).",
    "5. Conversation starters:", ...GPT_STARTERS.map(s => `   - ${s}`),
    "6. Knowledge: upload knowledge.md as sieve-knowledge.md.",
    "7. Capabilities: web search off (answers must come from the pasted material), image generation off, code interpreter on (helps with long JSON).",
    "8. Actions: none. Sieve keeps project data in the user's browser; the GPT only sees what is pasted.",
    "9. Save → \"Anyone with the link\" (or GPT Store). Copy the link.",
    "10. Put the link in `SIEVE_GPT_URL` in site/js/llm.js and push: every copy-paste route then offers \"Sieve GPT\".", "",
    "Privacy note for users: whatever is pasted into ChatGPT is processed by OpenAI under the user's own ChatGPT account and settings.", ""].join("\n");
}
