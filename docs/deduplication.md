# Deduplication in Sieve

Sieve removes duplicate records across database exports (PubMed, MEDLINE/Embase via Ovid, Web of Science,
PsycInfo, ACM, CINAHL, Scopus, …) with an adaptation of the **Bramer method**:

> Bramer WM, Giustini D, de Jonge GB, Holland L, Bekhuis T. De-duplication of database search results for
> systematic reviews in EndNote. *J Med Libr Assoc.* 2016;104(3):240–3. doi:10.3163/1536-5050.104.3.014
> (PMC4915647). Correction: *J Med Libr Assoc.* 2017;105(1):111. doi:10.5195/jmla.2017.128.

Code: `site/js/dedup.js` (passes), `site/js/bibparse.js` (reading exports). Tests: `tests/dedup.test.mjs`.

## The method in the paper

DOIs and PMIDs are not present, or not exportable, in every database, so the method uses page numbers in
combination with other fields as an identifier. Two preparation steps make the fields comparable:

1. **Page numbers are normalised.** MEDLINE and the Cochrane Library abbreviate them (`1008–12`), most other
   databases do not (`1008–1012`); CINAHL appends the length (`1008–1012 5p`). The authors re-export
   PubMed/MEDLINE/Cochrane records through a custom EndNote style to expand the abbreviation.
2. **Journal titles**: some databases export abbreviations, others full titles; custom import filters
   bring in the abbreviations (optional, improves step A).

Then EndNote's duplicate finder is run seven times, each time with a different field combination
(Table 1 of the paper):

| Row | Fields compared | What the paper does with the matches |
|---|---|---|
| A | Author, Year, Title, Secondary title (journal) | delete without manual check |
| B | Author, Year, Title, Pages | delete without manual check |
| C | Title, Volume, Pages | check records with blank title/author; review the records **without page numbers or with page numbers starting with 1** for equivalent authors (wording of the 2017 correction); delete the rest |
| D | Author, Volume, Pages | deselect records without page numbers or starting with page 1; delete the rest |
| E | Year, Volume, Issue, Pages | check records with one page, or pages starting with 1 or a letter; delete the rest |
| F | Title | compare page numbers: different pages → check journal and authors; blank or page 1 → usually true duplicates |
| G | Author, Year | delete only after comparing page numbers (same pages → duplicate) |

The authors' point: the first two rows are specific enough to need no checking, the next three need only the
small subset without (proper) page numbers checked, and the last two are checked by hand with page numbers as a
guide. They note that simplifying the method (fewer field combinations, no page normalisation) increases the
manual workload. The article itself reports no accuracy figures; it refers to an earlier conference paper
(EAHIL 2014) for the comparison with other methods.

## Our assessment

We agree with the method and apply it, adapted to an app instead of EndNote:

* **Strengths.** Ordered, reproducible passes from strict to loose; it does not depend on DOIs/PMIDs being
  present; the manual work is limited to well-defined subsets; it is widely used by medical librarians.
* **The EndNote work-arounds are not needed.** Sieve reads volume, issue, start/end page, ISSN and both journal
  names from the exports and normalises them itself, so there is no re-export step and no custom filters.
* **DOIs and PMIDs are still the best key when present.** The paper avoids them because of availability, not
  accuracy, so Sieve uses them first, with one safeguard (below).
* **Links, not deletions.** For PRISMA the number of duplicates must stay traceable; a duplicate keeps a link to
  the record that is kept, and every decision can be undone.

## How Sieve applies it

Passes run in this order after every import. Within a pass, records are compared with the records imported
before them; **the first imported record is kept** (as in row G, where the record with the higher record number
is removed). Import the database with the most complete records first (usually PubMed or MEDLINE).

| Pass | Fields (normalised) | Linked automatically | Sent to the review list |
|---|---|---|---|
| DOI | DOI (lower case, without `https://doi.org/`) | titles at least 60% similar | same DOI but different titles (erratum, comment or a wrong DOI) |
| PMID | PMID | titles at least 60% similar | same PMID but different titles |
| A | first author, year, title, journal | always | short title (< 4 words) with different pages, e.g. two letters titled "Reply" |
| B | first author, year, title, pages | always | – |
| C | title, volume, pages | pages are a proper range not starting with 1, and first authors agree | pages missing/single/starting with 1 (correction 2017), or different first authors |
| D | first author, volume, pages | proper page range | pages missing/single/starting with 1 |
| E | year, volume, issue, pages | proper page range and title of 4+ words | one page, page 1, or pages starting with a letter; short title |
| F | title only (4+ words) | never | always, with the page comparison as the reason |
| G | first author, year, pages | never | same first author, year and (proper) pages |
| ≈ | almost identical title (≥ 90% similar), year ± 1 | never | always (Sieve addition: typos, punctuation, subtitles) |

Normalisation:

* **Pages**: `1008-12` → `1008-1012`; `SP 240` + `EP 243` → `240-243`; `5p` suffixes and `pp.` removed;
  a range that starts with 1, a single page, or a start with a letter (e-locators such as `e71838`, supplement
  pages such as `S12`) counts as *weak* and is never used for an automatic link in C–E.
* **Titles**: lower case, punctuation and HTML removed, translated titles in `[brackets]` unwrapped.
* **Authors**: surname of the first author (`Bramer, Wichor M.`, `Bramer WM`, `W.M. Bramer` → `bramer`).
  The paper compares the whole author field; the first surname is more robust across database formats and is
  always combined with other fields.
* **Journals**: ISSN when present; otherwise the acronym of the full or abbreviated name (`Journal of the
  Medical Library Association` and `J Med Libr Assoc` → `jmla`), so abbreviated and full titles match.

Sieve additions, besides DOI/PMID and the fuzzy title check: missing DOI, PMID, abstract, volume, issue, pages,
ISSN or journal are copied from a duplicate into the kept record (undone if the pair is later marked
"different"), so screening and the recall check see the most complete record.

## What the reviewer does

Step 3 (Records) → *Duplicates across databases* shows how many records each pass linked, the overlap per
database (already found / only here), and the review list with the rule and the reason. For each pair choose
**Same paper** or **Different**; both decisions are kept when the passes run again after the next import.

For the report, the methods draft (step 8) contains a sentence like: *"Duplicates were identified following the
method of Bramer et al. (2016), adapted: DOI and PMID matches, then author, year, title, journal, volume, issue
and (normalised) page combinations from strict to loose; N duplicates were linked automatically and M after
manual review."*

## Validation and limits

* The unit tests cover every pass, the 2017 correction, page/author/journal normalisation, the DOI guard,
  decisions being kept, and reading RIS and MEDLINE (.nbib) exports (synthetic records).
* Not yet done: a comparison on a real project against a librarian's EndNote deduplication with the Bramer
  method (sensitivity and specificity). Until then, check the overlap table and the review list, and spot-check a
  sample of automatic links (the record table shows the rule per duplicate).
* Conference abstracts and the later full article are different records (different journal/pages) and are not
  linked, which is what PRISMA expects. Different versions (preprint vs. journal) usually differ in year and
  pages and end up in the review list via F or ≈.
* Records without year, volume and pages (some ACM and grey-literature exports) can only be matched on DOI or
  title, so more of them end up in the review list.
