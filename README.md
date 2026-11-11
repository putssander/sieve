# Sieve

Sieve the literature down to the studies that count. A browser workspace for systematic and scoping reviews: protocol → search-string tuning → records →
verification → full text → screening → data extraction → PRISMA report.

It generalises two earlier review projects: a script-based PubMed search-string tuning study and a
Python screening pipeline that compared an OpenAI model with a local qwen3-8b. Their methods became steps 2–7
below; the copy-paste prompts used before became the copy-paste route, now with JSON answers that are
read back automatically.

## Explore before starting a project

The home page opens with **What do you want to know, and why?** Seven illustrative questions rotate every
six seconds with a rolling crossfade, a progress rail, pause, previous and next controls. Hovering keeps the
cycle running; editing the question pauses it. Reduced-motion preferences
disable autoplay. Choose a purpose to see a suggested review type and compare systematic, scoping,
narrative, rapid and umbrella reviews, with question frameworks, reporting guidance and work involved.
An update or living approach is recorded separately from the underlying review type.
The landing page keeps the animated question, purpose, short suggestion and start button together at
comfortable reading sizes. The eight-step preview follows below. Full comparisons and project management
unfold on demand. The home page uses a simple header; narrow layouts tuck navigation into **Steps & help**
instead of showing an icon grid. The menu supports Escape and closes when clicking outside it.

**Start with this question** creates a project with the draft question and selected plan. Step 1 begins
with the same purpose-first choices. Filled framework fields are cached when switching frameworks so
exploring PICO, PCC or an open question does not discard earlier entries. Purpose is included in screening
and extraction prompts for projects that have it. Suggestions are informed by Munn et al. (2018),
Grant & Booth (2009), JBI, Cochrane and PRISMA guidance, linked directly in the interface.

The home page and sidebar link to a project-free walkthrough of all eight steps (`#/guide/protocol`).
Each step explains what to bring, what the researcher decides, what Sieve helps with, the expected output
and the work involved, alongside a labelled illustrative example. Exploring the walkthrough does not
create a project or call a model. Existing projects have a **What to expect** link on each step.
The walkthrough shows the starting materials and outcome first; explanations, examples and effort estimates
expand on demand. Project steps keep their working controls visible with a compact **Why this step & how it works**
section. Methods, optional setup and data-sharing guidance use the same keyboard-accessible disclosures.
Technical terms such as overfitting, hold-out sets, recall and PRISMA have inline **ⓘ** buttons. Each opens
a plain-language explanation, a practical example and advice for the review. The dialogs support keyboard
navigation, Escape to close and focus return to the original button. Each step also explains why it matters.

**AI, tokens & local tools** (`#/guide/options`) compares copy-paste, API and local model routes, explains
data sharing and browser storage, and distinguishes the local PDF helper from a local model server.
Its optional cost planner uses the researcher's own token counts and provider rates; it makes no API calls
and does not set a spending limit.

## Quick scan: from a question to a cited answer

*Quick scan first* on the home page (or **Quick scan** above the steps in any project) runs a short, AI-assisted
evidence scan on one page, each stage with a worked example and the AI suggestion to check:
**plan** (criteria, PubMed blocks and data fields from the question) → **search** (PubMed and Europe PMC preprints /
PMC live, the most relevant records, duplicates linked) → **screen** (every title/abstract per criterion, with quotes)
→ **full texts** (open access) → **extract** (values with quotes) → **summary** (answer with citations, the PRISMA
flow, inclusion/exclusion per criterion and a limitations box written from what was actually done).
It works with copy-paste, an API key or a local model. Everything is saved in the normal project fields, so
*Continue as a scoping / systematic review* opens the eight steps with the work already in place.
It is labelled an evidence scan, not a systematic review (open databases, one AI screener, open-access texts).

**Example scans with recorded answers** (home page → *See an example scan*, or *Quick scan first* on an example
question): every AI answer is stored with a fingerprint of its exact input, so the scan plays through without a key
or a call (*Play the example*). Change the question, a criterion, a field or the search terms and only the affected
answers are marked out of date and go to your own AI route. Record a new example with
`node tools/build-scan-example.mjs <example-id>` (it drives the app in headless Chrome and writes the prompts that
still need an answer; only ids, counts and answers are published, no abstracts or full texts).

## Try it, and the methods behind it

* **Example project** (home page → *Try the example project*, or *Try … in the example project* on any tour page):
  a small review on LLMs for title/abstract screening, with real PubMed and Europe PMC records (abstracts only for
  open-access records), PubMed blocks with validation articles, an Ovid strategy to translate, and real example model
  runs for screening and extraction. Built by `node tools/build-example.mjs` (public sources only).
* **Methods & guidance** (sidebar, and *Method* on every step): the accepted method per step with its source
  (PRISMA 2020, PRISMA-S, PRESS 2015, relative recall, Bramer deduplication and database combinations, dual screening,
  SAFE, double extraction, PROBAST+AI, the 2025 joint statement on AI in evidence synthesis), what Sieve does,
  and the gaps. Also as [docs/methods.md](docs/methods.md) (`node tools/build-methods.mjs`).

## Help on every page

Every step has **Copy this page for ChatGPT** (top right): the page content plus your question go out as one prompt,
and the JSON answer comes back into the same page. Protocol, Search and Extraction answers can propose changes
(question, criteria, blocks, known articles, instructions) that you review before they are applied; the other
steps get an answer. With an API key it runs without copy-paste.

**Sieve GPT.** `gpt/` holds the instructions, knowledge file and setup steps for one shared custom GPT in ChatGPT
(generated from the app's prompts by `node tools/build-gpt.mjs`). After publishing it, put its link in
`SIEVE_GPT_URL` (`site/js/llm.js`); until then, *Models & keys* shows how to make your own and where to paste its link.

**Models.** *Models & keys → Load available models* asks OpenAI / Anthropic / the local server which models the key
can use (newest first, refreshed weekly) and flags a saved model that is no longer offered.

**Your computer.** On the public site Sieve does not contact `127.0.0.1` until you press *Connect to the local helper*
(or use a local model route): that is what makes Chrome ask to "access other apps and services on this device".

## Three ways to run the AI steps

Every AI step (screening, extraction, search suggestions, protocol drafting) is defined once as
*prompt + JSON schema → JSON*, and can run through any of these routes. Results are stored per run,
so different models (and you) can be compared on the same papers.

1. **Copy-paste (default, no key, no GPU).** The app writes the prompt for a batch of papers; you paste
   it into ChatGPT or Claude, paste the answer back, and the JSON is read automatically. Works with a
   normal subscription, and you can attach PDFs you have access to.
2. **API key.** Paste an OpenAI or Claude key under *Models & keys*; the app calls the API directly from
   the browser for all papers (OpenAI Responses API with a strict schema; Claude Messages API with
   `output_config.format`). The key stays in this browser's localStorage. Use a key with a spending limit.
3. **Local or Colab GPU.** Any OpenAI-compatible server (Ollama, LM Studio, `mlx_lm.server` on a Mac,
   vLLM), or export a *job file*, run it with `python -m sieve run` (e.g. in `colab/sieve_colab.ipynb`) and
   import the results file.

A ChatGPT subscription cannot be used by a website as an API. The realistic future
option is to offer this pipeline *inside* ChatGPT/Claude as an app/connector (MCP), using the same prompts.

## Start

```bash
python3 -m sieve serve            # http://127.0.0.1:8765  (no installs needed for the GUI)
```

Or use the GitHub Pages version: https://sanderputs.com/sieve/ (`.github/workflows/pages.yml` publishes `site/`, no build step). Everything the
app stores (projects, texts, keys) lives in the visitor's own browser.

### Your own data on the Pages site

Nothing about a review is stored on GitHub. On the site, use **Import project file** (a project
`.json` exported from another browser or built locally), or start a new project and import records
(RIS / CSV / Excel / PubMed), an Excel extraction form and PDFs. All of it stays in your browser's
IndexedDB; export the project file to move it or share it with a co-reviewer.

## The steps

| # | Step | What you do | Automated help |
|---|---|---|---|
| 1 | Protocol | question, PICO/PICo/SPIDER/PCC, eligibility criteria (each with "if it fails" → exclude / snowball), extra rules | **Start from a document** (top of the step, or *New project from a document* on the home page): a ticket, protocol, PICO form or proposal fills in the question, PICO, known articles (PMIDs → validation set, DOIs looked up in PubMed) and search tables; the copy-paste assistant reads the whole document and adds eligibility criteria. You review everything before it is applied |
| 2 | Search | concept blocks in PubMed syntax, validation + hold-out PMIDs; or a line-numbered **database strategy** (e.g. MEDLINE via Ovid from a ticket) | live counts, recall, missed-article diagnosis, term diagnostics, MeSH analyser, precision sample, versions + diff, term suggestions; **translations to MEDLINE/Embase (Ovid), Web of Science, PsycInfo (EBSCO) and ACM DL**: an instant rule-based draft with a list of what to check, then the copy-paste assistant checks the drafts and maps MeSH → Emtree / APA Thesaurus (JSON back into the app); counts per line, Markdown export |
| 3 | Records | import PubMed / RIS / CSV / Excel / PMIDs, one export per database | automatic deduplication after every import following the Bramer method (DOI/PMID, then author/year/title/journal/volume/issue/normalised pages from strict to loose; first import kept, links not deletions; [docs/deduplication.md](docs/deduplication.md)), a review list for the cases the method checks by hand, RIS and MEDLINE/.nbib exports, overlap per database (PRISMA-S), **recall per database**: every export is checked against the validation and hold-out articles, which validates each translated string; missing abstracts from PubMed |
| 4 | Verify | fix flagged records | Crossref: DOI ↔ title ↔ year, publication type, supplement/erratum, shared wrong links, DOI by title |
| 5 | Full text | retrieve open copies, download remaining PDFs through your library, add PDFs or a folder, paste text | Europe PMC, PubMed Central, arXiv and Unpaywall PDF retrieval; optional local helper; HTML manual-download page and CSV worklist; PDF matching by DOI/title |
| 6 | Screening | decide per record (title/abstract, then full text) | model runs per criterion with quotes, quote check against the source, priority sorting, κ / sensitivity vs. you, inclusion/exclusion chart per criterion, Excel export |
| 7 | Extraction | import the form, verify cells | values + quotes per field, core-only rule by year, "accept where models agree", Excel in form layout, pivot tables, **Check the runs** (completeness, quotes verified verbatim in the full text, core-only rule, agreement between runs); full texts are fitted to the prompt without losing the results (references dropped, results paragraphs kept); start here directly with an already screened list ("screened outside Sieve") |
| 8 | Report | – | PRISMA 2020 counts + SVG, inclusion/exclusion per criterion, draft methods paragraph, search appendix, project export |

## Local models

* **Mac (Apple silicon):** `pip install mlx-lm` then
  `mlx_lm.server --model mlx-community/Qwen3-8B-4bit --port 8080` → add *Local / Colab server*
  `http://localhost:8080/v1`. Or Ollama: `ollama pull qwen3:8b` → `http://localhost:11434/v1`.
  From the GitHub Pages address, Ollama needs `OLLAMA_ORIGINS=https://<you>.github.io`; from
  `python -m sieve serve` (localhost) it works as is. LM Studio: enable CORS in its server settings.
* **Colab:** `colab/sieve_colab.ipynb` (job file → Qwen3-8B on the GPU → results file).
* **Command line:** `python -m sieve run job.json --backend openai --base-url http://localhost:11434/v1 --model qwen3:8b`
  (resumable; `--backend hf --model Qwen/Qwen3-8B --4bit` for transformers on CUDA).

## Tests

```bash
npm test                      # unit tests: .docx reading, document analysis, strategy parsing + 5 database translations, prompts/schemas
npm run test:e2e              # the real app in headless Chrome (needs Python 3 + Chrome), page by page: document import, translations,
                              # records from 3 databases (dedup, overlap, recall), the page button on all 8 steps, model list,
                              # and that the public site never contacts this computer on its own
node tests/e2e.mjs ticket.docx            # same, with a real document (stays local)
SIEVE_LOCAL_DOCS=~/tickets npm test       # also run every .docx in a local folder through importer + translator
node tools/translate.mjs ticket.docx --strategy V2 --out translations.md   # translations from the command line
node tools/check-extraction.mjs project.json [--answers dir/]           # validate extraction runs against the full texts
```

The fixtures are synthetic (`tests/fixtures.mjs`); real tickets and student data stay outside the repository.
GitHub Actions runs both suites on every push (`.github/workflows/test.yml`).

### Database translations: what is automatic and what is not

The rules translate syntax (field codes, proximity, wildcards, search history, publication types, year/language limits),
map subject headings from a small built-in list plus the project's own list, and list every step that needs a human
check. They cannot know every Emtree / APA Thesaurus term or verify counts in subscription databases; that is
what the copy-paste assistant (heading mapping, corrections) and running each line in the database are for.
ACM has no subject headings, no search history and no wildcards inside phrases: truncated phrases are written out as
singular/plural forms and Ovid `adjN` becomes AND within the same field (broader).

## What has been tested (3 Nov 2026)

Headless Chrome against `python -m sieve serve`, with two real review projects: every step renders
without errors; a live PubMed test that reproduces the original tuning result exactly (7,908 records,
18/18 validation, 12/12 hold-out); Crossref verification of 25 papers; Europe PMC full-text retrieval; copy-paste extraction answer pasted and parsed; job export → `srp run` (against a stand-in
OpenAI-compatible server) → results import; the in-browser *Local server* route.

**Not yet tested:** real OpenAI / Claude API calls from the browser (no key was used), Ollama / LM Studio /
mlx-lm with a real model, the Colab notebook, RIS/CSV import with real database exports, the Excel form
importer on other sheets than the one it was built on, the publisher-page fetch.

## Open items

See [docs/TODO.md](docs/TODO.md) (priorities, untested parts, methodological gaps from [docs/methods.md](docs/methods.md)).

## Layout

```
site/            the app (static, ES modules, no build)
  js/prompts.js  all prompts + JSON schemas (single source of truth)
  js/query.js    search blocks → PubMed / Ovid / WoS
  js/strategy.js line-numbered database strategies → MEDLINE/Embase (Ovid), WoS, PsycInfo (EBSCO), ACM
  js/docx.js     dependency-free .docx reader that keeps tables
  js/docimport.js  document → question, PICO, known articles, search tables
  js/llm.js      copy-paste, OpenAI, Claude, OpenAI-compatible routes
  js/views/      one file per step
sieve/           python -m sieve run | serve
colab/           Colab notebook for job files
tests/           node unit tests (npm test) and the headless-Chrome browser test (npm run test:e2e)
tools/           translate.mjs (strategy translations), build-gpt.mjs (writes gpt/), build-methods.mjs (docs/methods.md),
                 build-example.mjs (site/examples/), check-extraction.mjs (validate extraction runs)
examples/runs/   example model outputs used by the example project
gpt/             instructions + knowledge file for the Sieve GPT in ChatGPT
```
