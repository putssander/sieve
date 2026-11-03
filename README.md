# Sieve

Sieve the literature down to the studies that count. A browser workspace for systematic and scoping reviews: protocol → search-string tuning → records →
verification → full text → screening → data extraction → PRISMA report.

It generalises two earlier review projects: a script-based PubMed search-string tuning study and a
Python screening pipeline that compared GPT-5.5 with a local qwen3-8b. Their methods became steps 2–7
below; the copy-paste prompts used before became the copy-paste route, now with JSON answers that are
read back automatically.

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
| 1 | Protocol | question, PICO/PICo/SPIDER/PCC, eligibility criteria (each with "if it fails" → exclude / snowball), extra rules | draft protocol from a .docx/.pdf (proposal, PICO form, ticket) |
| 2 | Search | concept blocks in PubMed syntax, validation + hold-out PMIDs | live counts, recall, missed-article diagnosis, term diagnostics, MeSH analyser, precision sample, versions + diff, Ovid/Embase/WoS translation, term suggestions |
| 3 | Records | import PubMed / RIS / CSV / Excel / PMIDs | deduplication (DOI, PMID, title+year), missing abstracts from PubMed |
| 4 | Verify | fix flagged records | Crossref: DOI ↔ title ↔ year, publication type, supplement/erratum, shared wrong links, DOI by title |
| 5 | Full text | drop PDFs named by record ID, paste text | Europe PMC open access, Unpaywall links, publisher pages via the local helper, worklist CSV |
| 6 | Screening | decide per record (title/abstract, then full text) | model runs per criterion with quotes, quote check against the source, priority sorting, κ / sensitivity vs. you, Excel export |
| 7 | Extraction | import the form, verify cells | values + quotes per field, core-only rule by year, "accept where models agree", Excel in form layout, pivot tables |
| 8 | Report | – | PRISMA 2020 counts + SVG, draft methods paragraph, search appendix, project export |

## Local models

* **Mac (Apple silicon):** `pip install mlx-lm` then
  `mlx_lm.server --model mlx-community/Qwen3-8B-4bit --port 8080` → add *Local / Colab server*
  `http://localhost:8080/v1`. Or Ollama: `ollama pull qwen3:8b` → `http://localhost:11434/v1`.
  From the GitHub Pages address, Ollama needs `OLLAMA_ORIGINS=https://<you>.github.io`; from
  `python -m sieve serve` (localhost) it works as is. LM Studio: enable CORS in its server settings.
* **Colab:** `colab/sieve_colab.ipynb` (job file → Qwen3-8B on the GPU → results file).
* **Command line:** `python -m sieve run job.json --backend openai --base-url http://localhost:11434/v1 --model qwen3:8b`
  (resumable; `--backend hf --model Qwen/Qwen3-8B --4bit` for transformers on CUDA).

## What has been tested (3 Nov 2026)

Headless Chrome against `python -m sieve serve`, with two real review projects: every step renders
without errors; a live PubMed test that reproduces the original tuning result exactly (7,908 records,
18/18 validation, 12/12 hold-out); Crossref verification of 25 papers; Europe PMC full-text retrieval; copy-paste extraction answer pasted and parsed; job export → `srp run` (against a stand-in
OpenAI-compatible server) → results import; the in-browser *Local server* route.

**Not yet tested:** real OpenAI / Claude API calls from the browser (no key was used), Ollama / LM Studio /
mlx-lm with a real model, the Colab notebook, RIS/CSV import with real database exports, the Excel form
importer on other sheets than the one it was built on, the publisher-page fetch.

## Open items

* Two-reviewer mode (independent decisions, conflict resolution) and blinding of model decisions.
* Active-learning ordering of records for large title/abstract sets (ASReview-style).
* Risk-of-bias / quality appraisal as a form like extraction.
* A ChatGPT / Claude app (MCP connector) so researchers can run the pipeline inside their subscription.

## Layout

```
site/            the app (static, ES modules, no build)
  js/prompts.js  all prompts + JSON schemas (single source of truth)
  js/query.js    search blocks → PubMed / Ovid / WoS
  js/llm.js      copy-paste, OpenAI, Claude, OpenAI-compatible routes
  js/views/      one file per step
sieve/           python -m sieve run | serve
colab/           Colab notebook for job files
```
