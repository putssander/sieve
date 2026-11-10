# To do

Priorities: **P1** next, **P2** soon, **P3** later. Methodological gaps come from [methods.md](methods.md)
(also in the app: Methods & guidance).

## P1: next

- [ ] **Commit and push the current work** after agreeing who edits the tour / home / methods page
  (several files were changed in parallel on 10 Nov 2026).
- [ ] **Local model presets** under Models & keys, each filling in the URL, showing the one-line CORS setting and
  testing the connection + model list:
  - [ ] Ollama (`OLLAMA_ORIGINS=<site address>`, `http://localhost:11434/v1`)
  - [ ] LM Studio (enable CORS in the server settings, `http://localhost:1234/v1`)
  - [ ] mlx-lm on a Mac (`mlx_lm.server`, `http://localhost:8080/v1`)
  - [ ] vLLM on a GPU server (allowed origins option; HTTPS needed when the page is HTTPS and the server is not localhost)
  - [ ] Colab: job file route as the default (export → `colab/sieve_colab.ipynb` → import results); explain why a
        live tunnel is not recommended
  - [ ] Explain the browser's permission prompt for this device (as for the local helper)
- [ ] **Purpose first in step 1: "What do you want to know, and why?"** Choices such as answer a question /
  map a field / background for my study / inform a guideline / stay up to date suggest the review type
  (systematic, scoping, rapid, narrative), the question framework (PICO, PCC), the reporting checklist
  (PRISMA 2020, PRISMA-ScR) and which steps are required. Sources: Munn et al. 2018 (BMC Med Res Methodol
  18:143), Grant & Booth 2009 (Health Info Libr J 26:91-108).
- [ ] **Evidence scan mode ("Question first."):** question on the main page → protocol and search drafted →
  PubMed + Europe PMC live → AI title/abstract screening → open-access full texts → extraction table with
  quotes → PRISMA counts, summary and an explicit limitations box (open databases only, one AI screener,
  open-access texts only). About an hour with an API key. Label it an AI-assisted evidence scan, not a
  systematic review (rapid review guidance: Garritty et al. 2021, J Clin Epidemiol 130:13-22), and offer
  "continue as a scoping / systematic review" in the same project.
- [ ] **Risk-of-bias / quality appraisal** as a form like extraction, with evidence quotes: PROBAST+AI, QUADAS-2,
  RoB 2, ROBINS-I (methods gap 1).
- [ ] **Two-human screening mode**: independent, blinded decisions, conflict resolution, κ between humans
  (methods gap 2).

## P2: soon

- [ ] PRESS 2015 checklist for peer review of a search strategy (six elements, reviewer form + assistant prompt).
- [ ] PRISMA-S fields per database (platform, search date, limits, record count) and a PRISMA-S checklist export.
- [ ] Complete AI-use statement in the report: tools, versions, prompts, validation results, human oversight
  (2025 joint statement / RAISE).
- [ ] PRISMA 2020 checklist export; "reports not retrieved" in the flow diagram.
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
