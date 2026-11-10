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
- [ ] OCR for scanned PDFs / PDFs with garbled font tables (one real paper had unreadable table text).
- [ ] Retraction check (Crossref / Retraction Watch data) in Verify.
- [ ] Publish the shared Sieve GPT (`gpt/README.md`) and set `SIEVE_GPT_URL`.

## P3: later

- [ ] Prioritised (active learning) screening with the SAFE stopping procedure.
- [ ] Google Scholar (first 200), CINAHL and Scopus translations.
- [ ] Protocol export (PRISMA-P / registration format) and a frozen, dated protocol version.
- [ ] Sieve browser extension that fetches PDFs through the user's own library session (one paper at a time).
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
