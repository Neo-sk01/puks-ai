# Puks AI — Speed WMS Support Assistant

> **Predictive Unified Knowledge System.** A RAG assistant that answers Speed WMS support questions from AGL's warehouse documentation.

**Status: not deployed, but unblocked.** The app runs from a clean checkout once you supply a key and rebuild the index ([§4](#4-running-it-locally)). Azure access is granted and sufficient to deploy — via API keys rather than managed identity. Read [§1](#1-read-this-first) first.

> **This repository is public.** Nothing tenant-specific belongs in it: no resource names, no object IDs, no access chains, no network posture. That material lives in `ENVIRONMENT.local.md`, which is gitignored — see [§6](#6-the-environment). Check before you commit.

Built for **AGL / Africa Global Logistics** (MSC group). Original author: Siyanda Matolengwe. Azure environment owner (per resource tags): **Dominique Kouassi**, ServiceNow case `INC2620802`.

---

## Table of contents

1. [Read this first](#1-read-this-first)
2. [What it does and how](#2-what-it-does-and-how)
3. [Repository layout](#3-repository-layout)
4. [Running it locally](#4-running-it-locally)
5. [The knowledge base and how to rebuild it](#5-the-knowledge-base-and-how-to-rebuild-it)
6. [The environment](#6-the-environment)
7. [Known defects](#7-known-defects)
8. [Where this is going](#8-where-this-is-going)

---

## 1. Read this first

Five things that will otherwise cost you a day each.

| # | Thing |
|---|---|
| 1 | **Three live Groq API keys were published to a public GitHub repo. Rotate them anyway.** Groq is no longer used — generation, embeddings and reranking all run on Foundry now — but the keys are still valid at `console.groq.com` and were public. Revoke them. See `ENVIRONMENT.local.md`. |
| 2 | **You must rebuild the index before the app will run.** Embeddings moved to `text-embedding-3-large` (3072-dim), so the committed 384-dim index is unusable. `python SCRIPTS/build_index.py`. See [§4](#4-running-it-locally). |
| 3 | **There is still no ground truth.** Retrieval changed substantially and nothing in the repo can show whether it improved. `SCRIPTS/07_retrieval_baseline.ipynb` captures a before/after baseline over the eight seed queries — run it. See [§5.1](#51-the-only-evaluation-asset-that-exists). |
| 4 | **Azure access is granted, and it is enough to deploy — via keys, not managed identity.** The role we hold cannot create role assignments, so the keyless design in older drafts of this file is unreachable. The key-based path works today and is written out in [§6](#6-the-environment). |
| 5 | **`ci-cd.yml` and `docs/DEPLOYMENT.md` are fiction.** They deploy to app names that do not exist, in a region this project does not use, with a Groq key nothing reads. Do not follow them. |

### Trust map

The repo ships more documentation than code, and most of it describes a system that was never built. Before you open anything:

| File | Verdict |
|---|---|
| **`README.md`** (this) | Trust. Every fact dated and sourced; see the closing note. |
| **`DOCUMENTATION.md`** (68 KB) | **Trust the code sections only.** Its deployment half is fiction: it creates `rg-puks-ai` in `southafricanorth`, supplies Terraform for infrastructure that does not exist, rolls back via slot swap on a **B1 plan that cannot have slots**, and references a `retrain.sh` that is not in the tree. |
| **`docs/DEPLOYMENT.md`** | **Do not follow.** Same greenfield fantasy, wrong region, wrong resource group — and it now also configures a Groq key that nothing reads. Carries a superseded banner. |
| **`.github/workflows/ci-cd.yml`** | **Do not follow.** Builds an image with `push: false` and deploys to app names that do not exist. |
| **`puks_rag.py`** | Trust. The retrieval and generation core — single source of truth for `enrich_text()`, shared with the index builder. |
| **`SCRIPTS/build_index.py`** | Trust. Rebuilds `DATA/vector_store` from the corpus. |
| **`ENVIRONMENT.local.md`** | Trust — and **never commit it**. The Azure estate, access chain, deployment runbook, traps and cost. Gitignored deliberately. If it is missing from your checkout, ask the environment owner. |
| **`CONTRIBUTING.md`** / **`SECURITY.md`** / **`CHANGELOG.md`** | Generic boilerplate. Harmless, not project-specific. |
| **`Handover Documents/AGL_Handover_1_Overview.pdf`** | **Read it.** *Reviewed 2026-08-21.* It is the only statement of intended architecture, and it does not match either this repo or the provisioned estate — see [§6](#6-the-environment). It is also **document 1 of 4**; the other three are missing and should be requested. |
| **`APPLICATION(STREAMLIT)/data/vector_store/`** | Delete. Wrong model, wrong size — see §4. |
| **`SCRIPTS/06_rag_pipeline.ipynb`** | Trust. Thin harness over `puks_rag.py`; holds no logic of its own. |
| **`SCRIPTS/07_retrieval_baseline.ipynb`** | Trust. Before/after baseline over the eight seed queries. |
| **`SCRIPTS/08_end_to_end_validation.ipynb`** | A stub. There is no end-to-end validation — see §5. |
| **`Dockerfile`**, **`docker-compose.yml`**, **`home.py`**, **`Help Page.py`**, **`07_llm_answer_generation - Copy.ipynb`** | **Deleted 2026-08-21.** Recoverable from git history if needed. |

The previous marketing-style README is preserved in git history at commit `ed3b4d6`.

---

## 2. What it does and how

A support agent asks *"how do I reverse a closed GRN?"*. Puks AI finds the most relevant documents from a 627-chunk knowledge base, hands them to an LLM, and the LLM answers **using only what it was given**.

```
Question
   │
   ├─ classify_query()        schema / operational / SQL intent
   │
   ├─┬─ Dense    text-embedding-3-large, 3072-dim, IndexFlatIP, top 60
   │ ├─ BM25     rank-bm25 over the full 627-chunk corpus, top 60
   │ └─ Exact    literal table / procedure name match
   │        │
   │        └─ Reciprocal Rank Fusion (k=60) → top 50
   │
   ├─ Cohere-rerank-v4.0-pro   top 50 → top 5, relevance in [0,1]
   │
   ├─ build_prompt()           context-only guardrails, 8-turn memory
   │
   └─ gpt-5                    reasoning_effort=low, max_completion_tokens
```

**All three models run on a single Azure Foundry resource**, authenticated with one account key. No request leaves the AGL tenant, and there is no third-party API in the path. Resource names, endpoints and the deployment runbook are in `ENVIRONMENT.local.md` — see [§6](#6-the-environment).

The retrieval core is `puks_rag.py` at the repo root. It imports no Streamlit, so the planned Next.js/FastAPI backend ([§8](#8-where-this-is-going)) can use it unchanged, and `SCRIPTS/build_index.py` shares `enrich_text()` with it rather than keeping a second copy.

### What changed from the original pipeline

*Provider switch completed 2026-08-21. The Groq/MiniLM/CrossEncoder stack is gone.*

| | Before | Now |
|---|---|---|
| Generation | Groq — 4 selectable models | Foundry `gpt-5` |
| Embeddings | `all-MiniLM-L6-v2`, 384-dim, in-process | `text-embedding-3-large`, 3072-dim |
| Reranking | `ms-marco-MiniLM-L-6-v2` CrossEncoder, in-process | `Cohere-rerank-v4.0-pro` |
| Fusion | weighted sum of four hand-tuned constants | Reciprocal Rank Fusion |
| BM25 scope | re-weighted dense's top 40 only | the full corpus, independently |
| Confidence | unbounded CrossEncoder logit | Cohere relevance, calibrated `[0,1]` |
| Dependencies | torch + transformers + sentence-transformers, ~2 GB | `openai` + `requests`, ~40 MB |

The old `W_VECTOR / W_BM25 / W_HYBRID / W_RERANK` constants are gone. They never meant what they appeared to — the CrossEncoder used Identity activation, so `predict()` returned unbounded logits (roughly ±11) that were summed onto a bounded quantity, and the reranker actually carried 77–95% of the score variance rather than the nominal 30%. RRF removes the need to tune anything: it operates on ranks, not scores, so no retriever's score scale can dominate another's.

---

## 3. Repository layout

```
puks_rag.py               ← THE CORE. Retrieval, reranking, generation, prompts.
                            No Streamlit import — reusable by any backend.

APPLICATION(STREAMLIT)/
  APP.py                  Streamlit UI over puks_rag. UI only.
  data/vector_store/      ⚠ STALE — 200 vectors at 768 dims, a different model. Delete.
  style/style.css
  Pictures/

DATA/
  Cleaned_Generative/     cleaned source documents, by WMS area
    Database Tables/      18 table schemas as JSON
    LOREAL/               19 client-specific procedure documents
    Speed Support Document/
    GENERAL/ LOADING/ ORDER PREPARATION/ RECEIVING GOODS/ ...
  Extracted/              raw text extracted from PDF/DOCX (pipeline stage 1 output)
  unified_semantic_chunks/
    unified_chunks.json   ← THE CORPUS. 627 chunks, 1.3 MB.
  vector_store/           ← THE REAL INDEX. 673 vectors. faiss.index + metadata.pkl + config.json
  Support Ticket Docs/    only 2 tickets

SCRIPTS/
  build_index.py          rebuilds DATA/vector_store — run after any corpus change
  01-05, 08               the build pipeline, see §5
  06_rag_pipeline         end-to-end harness over puks_rag
  07_retrieval_baseline   before/after baseline over the 8 seed queries
Powerapps/                Power Automate HTML email templates (Dataverse-backed, separate system)
Handover Documents/       AGL_Handover_1_Overview.pdf
docs/DEPLOYMENT.md        ⚠ boilerplate, targets a greenfield RG that does not exist
.github/workflows/        ⚠ aspirational, see §7
.env.example              every setting the app reads
```

---

## 4. Running it locally

The hardcoded Windows paths are gone — `puks_rag.py` resolves everything relative to the repo root. What you need now is a key and an index.

```bash
python3.11 -m venv .venv && source .venv/bin/activate   # 3.10+ also resolves
pip install -r requirements.txt                         # ~40 MB now, not 2 GB

cp .env.example .env
az cognitiveservices account keys list \
  -g <resource-group> -n <foundry-resource> \
  --query key1 -o tsv                                   # paste into AZURE_AI_KEY

python SCRIPTS/build_index.py                           # ~1 min, one embedding pass
streamlit run "APPLICATION(STREAMLIT)/APP.py"
```

`.env` is gitignored; `.env.example` documents every setting.

### You must rebuild the index before the app will start

Embeddings moved from a local 384-dim MiniLM to `text-embedding-3-large` at 3072 dims, so **the committed index is unusable** and `Corpus()` refuses to load it rather than returning silently wrong answers:

| Index | `d` | `ntotal` | Status |
|---|---:|---:|---|
| `DATA/vector_store/` | 384 | 673 | ❌ MiniLM-era. Rebuild over it. |
| `APPLICATION(STREAMLIT)/data/vector_store/` | 768 | 200 | ❌ A different experiment entirely. Delete. |
| after `build_index.py` | **3072** | **627** | ✅ |

`build_index.py` writes `metadata.json` rather than the old `metadata.pkl`: the chunks are plain dicts, so pickle bought nothing and unpickling a file that will later be shipped from Blob Storage is a risk worth not carrying. The legacy `.pkl` is still readable so the old store can be inspected, but the dimension check rejects that index anyway.

### Why 627 vectors now, not 673

`04_embeddings_and_vector_store.ipynb` embedded `wms_procedure` and `schema_overview` chunks twice (`OPERATIONAL_BOOST = 2`, plus a hardcoded duplication that ignored `SCHEMA_BOOST = 1`). It never worked as a ranking boost — identical vectors produce identical inner products in an exact `IndexFlatIP` search, land adjacently, and the app's dedup kept the first at exactly the rank it would have held anyway. It only consumed a candidate slot, and now it would also cost duplicate embedding calls. `build_index.py` embeds each chunk once.

### `enrich_text()` — still load-bearing

It prepends `CATEGORY`, `SOURCE`, `DOCUMENT TYPE` and type-specific metadata to each chunk before embedding, plus a keyword-stuffing line for `OPERATIONAL_REFERENCE` chunks only. That asymmetry is why *"reverse a GRN"* finds operational content.

It now lives in `puks_rag.py`, imported by both the app and the index builder, because the index and the query path must have been built by the same function. Change it and you must re-embed; the failure mode otherwise is degraded retrieval with no error.

> **BM25 deliberately does not index `enrich_text()` output.** The `KEYWORDS:` line is identical across every operational chunk, so indexing it would make "reverse" match all 82 of them equally. `bm25_text()` indexes raw chunk text plus table names, procedure names and related tables — the exact codes WMS queries actually turn on.

---

## 5. The knowledge base and how to rebuild it

**627 chunks** from **194 source files**, no exact duplicates.

| `chunk_type` | Count | What it is |
|---|---:|---|
| `text_prose` | 470 | narrative procedure text |
| `wms_procedure` | 28 | step-by-step operations with SQL |
| `text_table` | 25 | tabular content |
| `schema_overview` | 18 | table definitions |
| `wms_overview` | 18 | area introductions |
| `wms_join_logic` | 18 | table relationships |
| `wms_safety_rules` | 18 | do-not-do rules |
| `schema_core_columns` | 17 | primary columns |
| `schema_extra_columns` | 15 | remaining columns |

Chunk text: min 45 chars, median 680, mean 754, max 6,059. 100 chunks carry `structured_data`.

### The pipeline

Run in order. Every notebook has hardcoded Windows paths that need the same fix as §4.

| Notebook | Reads | Writes |
|---|---|---|
| `01_document_ingestion` | `DATA/` (PDF, DOCX) | `DATA/Extracted/` |
| `02_text_cleaning_preprocessing` | `DATA/Extracted/` | `DATA/Cleaned_Generative/` |
| `03_text_chunking` | `DATA/Cleaned_Generative/` | `DATA/unified_semantic_chunks/` |
| ~~`04_embeddings_and_vector_store`~~ | — | **Superseded by `SCRIPTS/build_index.py`.** Kept for the chunking history; do not run it, it writes a 384-dim MiniLM index. |
| `05_retrieval_testing` | index | — evaluation. **Contains the 8 seed queries** — see §5.1 |
| `06_rag_pipeline` | index | — end-to-end harness over `puks_rag.py` |
| `07_retrieval_baseline` | index | `SCRIPTS/baseline.json` — run before and after any retrieval change |
| `08_end_to_end_validation` | — | ⚠ **a 4-cell stub.** Its entire code is `print('Full system validation')` and `pip install streamlit`. There is no end-to-end validation. |
| `table_scheme` | `DATA/Database Tables/` (xlsx) | schema JSON |

### 5.1 The only evaluation asset that exists

`05_retrieval_testing.ipynb` carries an 8-query `test_queries` list. It is not a golden set — there are no expected answers — but it is the seed of one, and it is the only thing in the repo resembling a test:

```python
# Operational
"How do I reverse a GRN?"
"Reset a mission in Speed"
"Resend outbound shipment"
# Schema
"What is the primary key of REE_DAT?"
"Show join between REE_DAT and DOS_DAT"
"List columns of REE_DAT"
"How does receipt relate to STK_DAT table?"
# Text/General
"Explain warehouse picking process"
```

**Capture a baseline against these before you change retrieval.** Record which source documents come back in the top 5 for each. Without that, fixing defect §7.1 is unfalsifiable — you will have no way to show the change helped rather than hurt. Note that *"How do I reverse a GRN?"* retrieves a 165-character chunk whose SQL exists but is never rendered into the prompt (§7.6) — a useful canary for the context-assembly bug as well as for retrieval.

### 5.2 `structured_data` is not uniformly shaped

Of the 100 chunks with non-empty `structured_data`: **82 are dicts, 18 are lists.** Any code touching it must handle both. `chunk_type` lives under `metadata`, not at the top level.

**To add a document:** drop it in the right `DATA/Cleaned_Generative/<AREA>/` folder, then re-run `03` and `04`. There is no incremental path — it is a full rebuild.

### Why the index has 673 vectors for 627 chunks

`04_embeddings_and_vector_store.ipynb` cell 5 embeds `wms_procedure` and `schema_overview` chunks **twice** (`OPERATIONAL_BOOST = 2`, plus a hardcoded duplication of `schema_overview` that ignores `SCHEMA_BOOST = 1`). 627 + 28 + 18 = 673.

**This never worked as a ranking boost.** Identical vectors produce identical inner products in an exact `IndexFlatIP` search, land adjacently in the results, and `APP.py:252`'s `if text in seen_texts: continue` keeps the first at exactly the rank it would have held without duplication. It only consumed a candidate slot. Do not reproduce it.

### `enrich_text()` — load-bearing, easy to lose

`04` cell 4 prepends metadata to each chunk **before embedding**: `CATEGORY`, `SOURCE`, `DOCUMENT TYPE`, plus type-specific fields (`TABLE NAME`, `RELATED TABLES`, `PRIMARY KEY`, `FOREIGN KEYS` for schemas; `PROCEDURE`, `BUSINESS LOGIC`, `ACCESS LEVEL`, join keys for operational chunks).

It also appends a keyword-stuffing line **only for `OPERATIONAL_REFERENCE` chunks**:

```
KEYWORDS: reverse, resend, reset, grn, receipt, order, movement, mission, loading, stock, inbound, outbound
```

That asymmetry is why *"reverse a GRN"* finds operational content. If you re-embed without porting `enrich_text()` verbatim, retrieval quality drops and the cause is not obvious.

---

## 6. The environment

**This repository is public.** Everything specific to the AGL Azure estate — resource names, the access chain, Entra identifiers, deployment runbooks, network posture, traps and cost — lives in **`ENVIRONMENT.local.md`**, which is gitignored and must stay that way.

That file is the one to read before touching Azure. It covers:

| | |
|---|---|
| **Access** | the group → custom role → scope chain, what it permits, and the one thing it does not |
| **Deploying** | an egress probe that gates everything, then the runbook that works under that role |
| **What the ARM export omits** | role assignments, app settings, telemetry — and why their absence proves nothing |
| **Traps** | eight of them, each of which costs a day |
| **Security and cost** | credential handling, data residency, and the standing monthly bill |

If you do not have it, ask the environment owner rather than reconstructing it. The reconstruction is how identifiers end up somewhere public.

> To run anything you need `AZURE_AI_KEY` and a Foundry resource carrying three deployments: a chat model, `text-embedding-3-large`, and `Cohere-rerank-v4.0-pro`. `.env.example` lists every setting the app reads. Nothing else in this README depends on the environment.

---

## 7. Known defects

### 7.1 BM25 contributes no recall — ✅ FIXED 2026-08-21

*The old implementation searched FAISS for 40 candidates and then only re-weighted those same 40 with BM25, so BM25 could never surface anything dense retrieval had missed. Recall ceiling: 40/627 = 6.4%. A document findable only by an exact code (`REE_DAT`, `LPN`, `ZPA`, `DLUO`) was invisible if the semantic search missed it.*

`puks_rag.retrieve_context()` now runs dense and BM25 independently over the whole corpus, adds a third exact-name-match signal, and fuses all three with Reciprocal Rank Fusion. Both retrievers see all 627 chunks.

**Verify it, do not take it on trust.** `SCRIPTS/07_retrieval_baseline.ipynb` reports how many top-5 hits were reachable *only* via BM25 — those are precisely the documents the old pipeline could never have returned. If that number is zero across all eight seed queries, the fix is not earning its keep and something is wrong.

### 7.2 The refusal threshold — ⚠️ now meaningful, still uncalibrated

*The old `CONFIDENCE_THRESHOLD = 0.01` compared a blend of a bounded hybrid score against an **unbounded** CrossEncoder logit, so its effective strictness varied roughly 7× depending on which metadata boosts happened to fire — loosest exactly when retrieval was most driven by hand-tuned priors.*

Confidence is now Cohere's relevance score for the top hit: a calibrated quantity in `[0,1]` that means the same thing on every query. The scale problem is gone.

**The number itself is still a guess.** `PUKS_CONFIDENCE_THRESHOLD` defaults to `0.30` and has never been tuned against real queries. Calibrate it before anyone relies on the refusal: run the eight seed queries plus a handful of deliberately off-corpus ones and find the value that separates them. This matters more than it sounds — the answers include SQL that people run against a live WMS.

### 7.3 Intent classification inverts on common queries — ✅ FIXED 2026-08-21

*The old `classify_query` zeroed `is_schema` whenever both fired. Both keyword sets contain ordinary WMS nouns, so "List all columns in the receipt header table REE_DAT" contains "receipt", was classified operational, and got the operational boost and not the schema one. Exactly backwards, and systematic — 11 of 50 schema chunks contain an operational keyword in their own header text.*

The inversion is removed; both flags now stand. The additive score boosts they used to drive are gone too — precedence is settled by rank fusion and the reranker rather than by hand-tuned constants on incomparable scales.

### 7.4 SCHEMA MODE never fires for the chunks that list columns — ✅ FIXED 2026-08-21

*`has_schema` was set only for `schema_overview`, so the 32 `schema_core_columns` and `schema_extra_columns` chunks — the ones that actually enumerate columns — never triggered it.*

`build_context_text` now sets `has_schema` for any retrieved chunk carrying a `columns` array, whatever its `chunk_type`.

### 7.5 MVT_DAT has 32 unretrievable columns

*Corrected 2026-08-19. An earlier version of this section claimed all 1,574 column names were unreachable. That was wrong — measure before you act on it.*

Of the 1,574 column entries across 18 tables, **1,542 appear verbatim in some chunk's raw text**, which is both embedded and BM25-indexed. They are retrievable.

The exception is **MVT_DAT**: it is the only table with no `schema_core_columns` chunk, so 32 of its columns — including `MVT_QTE` (quantity), `MVT_SENS` (direction), `MVT_NoMV` (movement number) — appear in no chunk text anywhere. They reach the model only if the MVT_DAT `schema_overview` chunk is retrieved by some other signal, at which point `build_context_text` (`APP.py:352-383`) dumps `structured_data["columns"]` into the prompt.

Verify with:

```python
names = [col["name"] for c in chunks
         if isinstance(c.get("structured_data"), dict)
         for col in c["structured_data"].get("columns", [])]
alltext = "\n".join(c["text"] for c in chunks)
missing = [n for n in names if n not in alltext]   # → 32, all MVT_DAT
```

### 7.6 Nineteen procedures have SQL the app never shows the model — ✅ FIXED 2026-08-21

*Corrected 2026-08-19. Earlier versions of this section said these procedures were empty and needed a subject-matter expert. That was wrong on both counts — most of them are complete, and the fix is code.*

`build_context_text` rebuilds context from `structured_data` for `TABLE_SCHEMA` chunks. The `OPERATIONAL_REFERENCE` branch does not:

```python
elif doc_type == "OPERATIONAL_REFERENCE":
    has_operational = True          # APP.py:385-386 — and nothing else
```

It sets a flag and falls through to the raw `text`. So for procedure chunks, everything in `structured_data` — the `validate_before_update` queries, the `update` statements, the numbered steps — is **silently dropped before the prompt is built**.

Measured over the 22 `wms_procedure` chunks under 400 characters:

| | Count |
|---|---:|
| SQL present in `structured_data`, never rendered | **19** |
| Genuinely empty — nothing anywhere | **3** |

The three with nothing are **Cancel the Order**, **Clean Up Temporary Table** and **Cancel the Mission**. Those need someone who knows the procedures.

`puks_rag._render_procedure()` now renders the `OPERATIONAL_REFERENCE` branch — procedure name, business logic, access level, numbered steps with their SQL, and the `validate_before_update` / `update` / `rollback` / `safety_rules` keys. Nineteen procedures came back, including **Reverse Closed GRN** with both its `validate_before_update` SELECT and its UPDATE against `REE_DAT`.

**The three genuinely empty ones still need a subject-matter expert:** Cancel the Order, Clean Up Temporary Table, Cancel the Mission.

*"How do I reverse a GRN?" was the canary for this bug — it retrieved a 165-character chunk whose SQL existed but was never rendered. It is the first query in `07_retrieval_baseline.ipynb`; check that the answer now contains actual SQL.*

> Counting by string match misleads here in both directions. Grepping `SQL: N/A` finds nothing; grepping `N/A` finds 11; screening on text length and SQL keywords finds 6. None of those is the number that matters, which is how many have usable content the pipeline discards.

### 7.7 Everything else

- ✅ **Hardcoded Windows paths** — gone from the app; notebooks 01-05 and 08 still carry them
- ✅ **`Help Page.py` mock** and **`07_llm_answer_generation - Copy.ipynb`** — both deleted
- ⚠️ **Stale vector store** at `APPLICATION(STREAMLIT)/data/vector_store` — still there, still delete it (§4)
- ⚠️ **`ci-cd.yml` and `docs/DEPLOYMENT.md` are fiction** (§7)
- ⚠️ **No ground truth.** The largest remaining gap, and the reason none of the fixes above can be *proved* to have helped. See [§5.1](#51-the-only-evaluation-asset-that-exists).

---

## 8. Where this is going

*Two of the three items below are now done.* Retrieval was reworked so both search methods cover the full corpus, and generation moved off Groq onto the provisioned `gpt-5` — with an account key rather than managed identity, because our role cannot create the role assignment ([§6](#6-the-environment)).

What remains is the **Next.js front end replacing Streamlit**. `puks_rag.py` was written with no Streamlit import specifically so it can sit behind a FastAPI route unchanged.

Work that needs **no Azure access** and can start immediately:

- **Build the evaluation set.** Still the highest-value unblocked work: `07_retrieval_baseline.ipynb` detects change, not correctness, because the eight seed queries have no expected answers
- Front-end shell against `puks_rag.answer()`
- Calibrate `PUKS_CONFIDENCE_THRESHOLD` — it defaults to 0.30 on Cohere's scale and has not been tuned against real queries
- Delete `APPLICATION(STREAMLIT)/data/vector_store/`

Everything touching Azure is gated on the access grant in [§6](#6-the-environment). Request it first; it has the longest lead time.

### Open questions for the environment owner

1. **Do the integration subnets permit outbound internet egress?** The single highest-risk unknown — it decides whether the current app can run at all. We cannot read the NSGs. The egress probe in `ENVIRONMENT.local.md` answers it empirically in twenty minutes; ask the network team in parallel.
2. **Which architecture are we building?** This repo, the handover PDF and the provisioned estate describe three different systems ([§6](#6-the-environment)). Streamlit-on-App-Service is the fastest route to something running, but the handover explicitly rules it out.
3. **Where are handover documents 2, 3 and 4?** The PDF in this repo is document 1 of 4.
4. **Should the public web app be opened to Power Automate, or the Function Apps?** Both are network-posture decisions we can execute but should not take unilaterally.
5. Does AGL run **VNet-resident CI runners**? If so, the private site becomes viable and most deployment complexity disappears.
6. Who owns **data residency** sign-off? `gpt-5` is `GlobalStandard`, which may route outside the EU, and the SKU cannot be changed in place.
7. Is there a **real support ticket queue** to draw evaluation questions from? This repo has only two tickets.
8. Is **User Access Administrator** on `RGRT001` obtainable? Not a blocker — it upgrades the deployment from keys to managed identity.

---

*Environment facts were read from `main.bicep` (exported 2026-08-18) and verified against the repository. Azure behaviour was verified against Microsoft Learn on 2026-08-19 and 2026-08-21. Permission and RBAC facts in [§6](#6-the-environment) were confirmed live on 2026-08-21 via Azure CLI. Anything still marked unverified has not been confirmed against the live subscription.*
