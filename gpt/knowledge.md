# Sieve knowledge for the Sieve review assistant

Sieve prompts always contain the exact task and fields. This file repeats the JSON schemas of the fixed tasks and the database rules, for checking.

## System roles used by Sieve

- Search tasks: You are an expert information specialist who builds and peer-reviews (PRESS) systematic search strategies. Return ONLY JSON matching the requested schema.
- Screening: You are a careful systematic-review screening assistant. You screen papers against fixed eligibility criteria and return ONLY JSON matching the requested schema.
- Extraction: You are a careful systematic-review data-extraction assistant. You extract only what the paper reports, with short verbatim quotes as evidence, and return ONLY JSON matching the requested schema.

## Screening and extraction

Screening prompts list the eligibility criteria and papers (PAPER_ID, TITLE, ABSTRACT, optional FULL_TEXT_EXCERPT). Decisions: Include / Exclude / Exclude, but save for snowballing / Unclear. For several papers the answer is {"results": [ ... one object per paper ... ]}.
Extraction prompts list the form fields (id, label, description, answer options) and papers; every field gets a value and a verbatim quote as evidence.

## Fixed tasks and their JSON schemas

### Draft a protocol from a document

Read a proposal/PICO form/ticket; return question, PICO elements and eligibility criteria.

```json
{
 "type": "object",
 "properties": {
  "question": {
   "type": "string"
  },
  "elements": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "key": {
      "type": "string",
      "description": "P, I, C, O, or Co, S, ..."
     },
     "label": {
      "type": "string"
     },
     "text": {
      "type": "string"
     }
    },
    "required": [
     "key",
     "label",
     "text"
    ],
    "additionalProperties": false
   }
  },
  "criteria": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "label": {
      "type": "string"
     },
     "description": {
      "type": "string"
     }
    },
    "required": [
     "label",
     "description"
    ],
    "additionalProperties": false
   }
  },
  "notes": {
   "type": "string"
  }
 },
 "required": [
  "question",
  "elements",
  "criteria",
  "notes"
 ],
 "additionalProperties": false
}
```

### Load a document (ticket, protocol, proposal)

Question, PICO, criteria, known articles (PMIDs/DOIs), every search table copied exactly, notes.

```json
{
 "type": "object",
 "properties": {
  "question": {
   "type": "string",
   "description": "the review question(s) as written; empty if absent"
  },
  "elements": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "label": {
      "type": "string",
      "enum": [
       "Population",
       "Intervention",
       "Comparison",
       "Outcome",
       "Context",
       "Concept",
       "Design"
      ]
     },
     "text": {
      "type": "string"
     }
    },
    "required": [
     "label",
     "text"
    ],
    "additionalProperties": false
   }
  },
  "criteria": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "label": {
      "type": "string",
      "description": "short label"
     },
     "description": {
      "type": "string",
      "description": "what must be true, decidable from title/abstract"
     },
     "fail_decision": {
      "type": "string",
      "enum": [
       "Exclude",
       "Exclude, but save for snowballing"
      ]
     }
    },
    "required": [
     "label",
     "description",
     "fail_decision"
    ],
    "additionalProperties": false
   }
  },
  "known_articles": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "pmid": {
      "type": "string",
      "description": "digits only, or empty"
     },
     "doi": {
      "type": "string",
      "description": "or empty"
     },
     "title": {
      "type": "string",
      "description": "or empty"
     }
    },
    "required": [
     "pmid",
     "doi",
     "title"
    ],
    "additionalProperties": false
   }
  },
  "strategies": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "name": {
      "type": "string",
      "description": "the heading above the table, e.g. 'V2 – MEDLINE via Ovid'"
     },
     "database": {
      "type": "string",
      "description": "database/platform the lines are written for, e.g. 'MEDLINE (Ovid)'"
     },
     "lines": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "n": {
         "type": "integer",
         "description": "line number; 0 for a note row without a search"
        },
        "label": {
         "type": "string",
         "description": "concept / row label"
        },
        "query": {
         "type": "string",
         "description": "the search EXACTLY as written"
        },
        "count": {
         "type": "string",
         "description": "number of results if given, else empty"
        }
       },
       "required": [
        "n",
        "label",
        "query",
        "count"
       ],
       "additionalProperties": false
      }
     }
    },
    "required": [
     "name",
     "database",
     "lines"
    ],
    "additionalProperties": false
   }
  },
  "notes": {
   "type": "string",
   "description": "open questions, inconsistencies (e.g. line references that do not add up), and anything you could not place"
  }
 },
 "required": [
  "question",
  "elements",
  "criteria",
  "known_articles",
  "strategies",
  "notes"
 ],
 "additionalProperties": false
}
```

### Draft PubMed concept blocks

Concept blocks in PubMed syntax: "phrase"[tiab], Heading[Mesh], NEAR/4(a | b ; x | y)[tiab].

```json
{
 "type": "object",
 "properties": {
  "blocks": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "label": {
      "type": "string"
     },
     "role": {
      "type": "string",
      "enum": [
       "include",
       "exclude"
      ]
     },
     "terms": {
      "type": "array",
      "items": {
       "type": "string",
       "description": "one PubMed term, e.g. \"machine learning\"[tiab] or Artificial Intelligence[Mesh]"
      }
     }
    },
    "required": [
     "label",
     "role",
     "terms"
    ],
    "additionalProperties": false
   }
  },
  "notes": {
   "type": "string"
  }
 },
 "required": [
  "blocks",
  "notes"
 ],
 "additionalProperties": false
}
```

### Suggest search terms

Terms to add (recover missed validation articles) or remove (noise), per block.

```json
{
 "type": "object",
 "properties": {
  "suggestions": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "block": {
      "type": "string",
      "description": "label of the block to change"
     },
     "action": {
      "type": "string",
      "enum": [
       "add",
       "remove"
      ]
     },
     "term": {
      "type": "string",
      "description": "PubMed syntax"
     },
     "reason": {
      "type": "string"
     }
    },
    "required": [
     "block",
     "action",
     "term",
     "reason"
    ],
    "additionalProperties": false
   }
  },
  "notes": {
   "type": "string"
  }
 },
 "required": [
  "suggestions",
  "notes"
 ],
 "additionalProperties": false
}
```

### Precision check of titles

yes/maybe/no per title.

```json
{
 "type": "object",
 "properties": {
  "results": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "id": {
      "type": "string"
     },
     "judgement": {
      "type": "string",
      "enum": [
       "yes",
       "maybe",
       "no"
      ]
     },
     "reason": {
      "type": "string"
     }
    },
    "required": [
     "id",
     "judgement",
     "reason"
    ],
    "additionalProperties": false
   }
  }
 },
 "required": [
  "results"
 ],
 "additionalProperties": false
}
```

### Translate a database strategy

Check rule-based drafts for medline, embase, wos, psycinfo, acm; map MeSH to Emtree and APA Thesaurus.

```json
{
 "type": "object",
 "properties": {
  "heading_map": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "mesh": {
      "type": "string",
      "description": "MeSH heading as used in the MEDLINE strategy"
     },
     "embase": {
      "type": "string",
      "description": "Emtree preferred term, empty if none"
     },
     "psycinfo": {
      "type": "string",
      "description": "APA Thesaurus preferred term, empty if none"
     }
    },
    "required": [
     "mesh",
     "embase",
     "psycinfo"
    ],
    "additionalProperties": false
   }
  },
  "databases": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "database": {
      "type": "string",
      "enum": [
       "medline",
       "embase",
       "wos",
       "psycinfo",
       "acm"
      ]
     },
     "lines": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "n": {
         "type": "integer"
        },
        "label": {
         "type": "string"
        },
        "query": {
         "type": "string",
         "description": "ready to paste in this database"
        }
       },
       "required": [
        "n",
        "label",
        "query"
       ],
       "additionalProperties": false
      }
     },
     "one_string": {
      "type": "string",
      "description": "the complete final search as one string, ready to paste"
     },
     "changes": {
      "type": "string",
      "description": "what you changed compared to the draft and why"
     },
     "checks": {
      "type": "string",
      "description": "what the searcher must still verify in this database"
     }
    },
    "required": [
     "database",
     "lines",
     "one_string",
     "changes",
     "checks"
    ],
    "additionalProperties": false
   }
  },
  "notes": {
   "type": "string"
  }
 },
 "required": [
  "heading_map",
  "databases",
  "notes"
 ],
 "additionalProperties": false
}
```

## Database rules for search translations

Database rules:
- medline = MEDLINE via Ovid: exp Heading/, .ti,ab,kf., adjN, ? (0-1 char), # (1 char), * truncation, line numbers 1, 2, or/1-3.
- embase = Embase via Ovid: Emtree headings in lower case (exp heading/), .ti,ab,kw. (kw = author keywords), Embase publication types (.pt.) and Emtree terms for study types.
- wos = Web of Science Core Collection, Advanced Search: TS=, TI=, AB=, AK=, DT=, PY=; NEAR/n; $ (0-1 char), ? (1 char); history #1 AND #2. No subject headings.
- psycinfo = APA PsycInfo on EBSCOhost: DE "APA Thesaurus term" (explode = tick Explode, which writes out the narrower DE terms), TI, AB, KW field codes; Nn / Wn proximity; # (0-1 char), ? (1 char); history S1 AND S2; limiters for year/language/population (PO Human, PO Animal).
- acm = ACM Digital Library, Edit Query box: Title:(...), Abstract:(...), Keyword:(...); AND/OR/NOT in capitals; no subject headings; wildcards (* ?) are IGNORED inside quotes and not allowed at the start of a word; no search history (one string); proximity only as "word word"~n without wildcards; year via the date filter.
