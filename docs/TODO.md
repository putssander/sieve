# To do

Priorities: **P1** next, **P2** soon, **P3** later. Methodological gaps come from [methods.md](methods.md)
(also in the app: Methods & guidance).

## P1: next

- [ ] **Local model presets** under Models & keys, each filling in the URL, showing the one-line CORS setting and
  testing the connection + model list:
  - [x] Ollama (`OLLAMA_ORIGINS=<site address>`, `http://localhost:11434/v1`) (connection card in Models & keys)
  - [x] LM Studio (enable CORS in the server settings, `http://localhost:1234/v1`)
  - [ ] mlx-lm on a Mac (`mlx_lm.server`, `http://localhost:8080/v1`)
  - [ ] vLLM on a GPU server (allowed origins option; HTTPS needed when the page is HTTPS and the server is not localhost)
  - [ ] Colab: job file route as the default (export → `colab/sieve_colab.ipynb` → import results); explain why a
        live tunnel is not recommended
  - [ ] Explain the browser's permission prompt for this device (as for the local helper)
- [x] **Purpose first in step 1: "What do you want to know, and why?"** Choices such as answer a question /
  map a field / background for my study / inform a guideline / stay up to date suggest the review type
  (systematic, scoping, rapid, narrative), the question framework (PICO, PCC), the reporting checklist
  (PRISMA 2020, PRISMA-ScR) and which steps are required. Sources: Munn et al. 2018 (BMC Med Res Methodol
  18:143), Grant & Booth 2009 (Health Info Libr J 26:91-108).
- [x] **Evidence scan mode ("Question first."):** done as *Quick scan* (`#/p/<id>/scan`, site/js/scan.js); question on the main page → protocol and search drafted →
  PubMed + Europe PMC live → AI title/abstract screening → open-access full texts → extraction table with
  quotes → PRISMA counts, summary and an explicit limitations box (open databases only, one AI screener,
  open-access texts only). About an hour with an API key. Label it an AI-assisted evidence scan, not a
  systematic review (rapid review guidance: Garritty et al. 2021, J Clin Epidemiol 130:13-22), and offer
  "continue as a scoping / systematic review" in the same project.
- [x] **Risk-of-bias / quality appraisal** with evidence quotes: RoB 2, ROBINS-I, QUADAS-2, PROBAST+AI, JBI qualitative
  (step 7 and the scan's Appraise stage).
- [ ] Add QUADAS-3 (Ann Intern Med 2026, supersedes QUADAS-2) and ROBINS-I V2 (draft, Nov 2025: six domains);
  PROBAST+AI with separate development (quality) and evaluation (risk of bias) parts.
- [x] **Second reviewer**: blind copy (same device or file), decisions file back, κ, consensus; dual mode in the scan
  with the AI as a check on records both excluded.
- [x] **GRADE / GRADE-CERQual** per outcome or finding, summary-of-findings table (step 8 and the scan).
- [x] **Auto mode**: question in, manuscript draft out, labelled UNVERIFIED AI DRAFT until the checks are done.
- [ ] Record the appraisal, certainty and manuscript answers for the "writing" example, so auto mode runs the whole
  example without a key (`tools/build-scan-example.mjs` needs those stages).
- [ ] Second reviewer for certainty ratings (rapid review rec. 23); full-text screening in the team comparison.

- [x] Example scans with recorded answers (fingerprinted per input; edits → out of date → new call): "writing" recorded.
- [ ] Record more example scans (e.g. `climate`, `medication`) with `node tools/build-scan-example.mjs <id>`.
- [ ] Quick scan follow-ups:
  a "check a sample of AI exclusions" step (e.g. 10 random exclusions shown for a human decision) before the summary;
  an optional second AI screener with agreement shown in the scan.
- [ ] Record IDs: records imported after a PubMed import get "highest PMID + 1", which looks like a real PMID;
  use a prefix (e.g. `R1`) for records without their own identifier.

## P2: soon

- [ ] PRESS 2015 checklist for peer review of a search strategy (six elements, reviewer form + assistant prompt).
- [ ] PRISMA-S fields per database (platform, search date, limits, record count). Checklist export: done.
- [x] AI use statement in the report, built from every stored run.
- [x] PRISMA 2020 / PRISMA-ScR / PRISMA-S checklists filled from the project (step 8).
- [ ] An importer for WHO ICTRP XML exports; CENTRAL (Cochrane Library) and ClinicalTrials.gov: done.
- [ ] Extraction instructions per review: "one value per field, the main result by a fixed rule; others in notes",
  and answer options instead of free text, to make runs more reproducible (seen in the 10 Nov reproducibility test:
  metrics 96% agreement, free text 68%).
- [ ] **Help with subscription papers:**
  - [ ] Library link per paper: a setting for the institution's proxy / OpenURL prefix, so "open via library"
        is one click (on or off campus).
  - [ ] **Local PDF folder in sync** (File System Access API, Chrome/Edge): choose the folder once, Sieve
        re-scans it and adds new PDFs automatically (matched by DOI/title inside the PDF). Fallback for
        Safari/Firefox: the existing "Add a folder…".
  - [ ] **Sieve browser extension:** Sieve hands the missing DOIs to the extension, which opens each paper in
        the user's own session, follows the standard `citation_pdf_url` tag to the PDF and returns it to
        step 5. One paper at a time, started by the user (publisher terms forbid bulk downloading).
- [ ] **Storage:** ask the browser for persistent storage (`navigator.storage.persist()`) so texts are not
  evicted; show how much is stored; licence-aware export (only texts with a licence that allows sharing go
  into a shared project file by default).
- [ ] OCR for scanned PDFs / PDFs with garbled font tables (one real paper had unreadable table text).
- [ ] Retraction check (Crossref / Retraction Watch data) in Verify.
- [ ] Publish the shared Sieve GPT (`gpt/README.md`) and set `SIEVE_GPT_URL`.

## P3: later

- [ ] Prioritised (active learning) screening with the SAFE stopping procedure.
- [ ] Google Scholar (first 200), CINAHL and Scopus translations.
- [ ] Protocol export (PRISMA-P / registration format) and a frozen, dated protocol version.
- [ ] A ChatGPT / Claude app (MCP connector) so researchers can run the pipeline inside their subscription.

## Not yet tested with real services

- [ ] Real OpenAI / Claude API calls from the browser (model list and runs; only mocked so far).
- [ ] Ollama / LM Studio / mlx-lm / vLLM with a real model, from the local and the public site.
- [ ] The Colab notebook end to end.
- [ ] "Add a folder…" in step 5 with a real folder of downloaded PDFs (matching is unit-tested).
- [ ] The Excel form importer on other forms than the one it was built on.

## Done (10 Nov 2026)

- [x] Load from document (tickets, protocols, criteria flowcharts) with the copy-paste assistant
- [x] Database strategy translations (MEDLINE/Embase via Ovid, WoS, PsycInfo, ACM) with assistant review
- [x] Bramer deduplication, overlap and recall per database
- [x] Preprint check with published-version lookup
- [x] Full text: automatic open-access chain, download list, PDFs/folder matched by content
- [x] Extraction checks (verified quotes, completeness, agreement between runs) and evidence highlighting
- [x] Copy this page for ChatGPT on every step; Sieve GPT files
- [x] Model lists from the provider instead of hardcoded models
- [x] Methods & guidance page; reproducible example project with real example runs
- [x] Quick scan (question → plan → PubMed + Europe PMC → AI screening → OA texts → extraction → cited summary),
      continued as a scoping / systematic review in the same project
- [x] Inclusion/exclusion chart per criterion (screening, report, scan) next to the PRISMA diagram
- [x] A worked example under every step's one-line intro (from the workflow tour)
