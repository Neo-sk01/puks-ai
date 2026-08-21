# Next.js front end replacing Streamlit — design

**Date:** 2026-08-21
**Branch:** `frontend/nextjs-replaces-streamlit`
**Status:** approved, ready for implementation planning

This is the work README §8 named as all that remains: *"the Next.js front end replacing
Streamlit. `puks_rag.py` was written with no Streamlit import specifically so it can sit
behind a FastAPI route unchanged."*

---

## 1. Current state

`APPLICATION(STREAMLIT)/APP.py` is a ~200-line Streamlit UI over `puks_rag.py`. It renders a
chat, a `top_k` slider, a retrieved-context debug expander, an 8-turn conversation memory
with a reset button, and a static About page.

Three facts about the state of the repo constrain this work:

1. **The app cannot start.** `DATA/vector_store/` holds a MiniLM-era index (`dimension: 384`,
   673 vectors, `metadata.pkl`). `puks_rag.py` requires 3072-dim `text-embedding-3-large`, and
   `Corpus.__init__` raises `ConfigError` on the dimension check rather than answering wrongly.
   README §4: *"You must rebuild the index before the app will start."*
2. **There is no `.env` in the working tree**, so no `AZURE_AI_KEY`. `SCRIPTS/build_index.py`
   cannot run, and neither gpt-5, `text-embedding-3-large` nor `Cohere-rerank-v4.0-pro` is
   reachable from the development machine.
3. `APPLICATION(STREAMLIT)/style/style.css` is dead — no code loads it. A grep for `style.css`
   across every `.py` in the repo returns nothing.

Consequence: **the implementation must be verifiable with zero Azure access**, or it cannot be
verified at all. See §9.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Next.js front end → FastAPI → `puks_rag.answer()` / `answer_stream()` | FAISS, `rank-bm25` and the `enrich_text` index contract are Python-native. A TypeScript port would have to reproduce `enrich_text()` and `bm25_text()` exactly; README §5 warns the failure mode is *degraded retrieval with no error*. Zero retrieval-quality risk this way, and it is what `puks_rag.py` was written for. |
| D2 | Parity **plus token streaming**; `puks_rag.py` gains one generator | Streamlit blocked on a spinner because `answer()` returns a finished string. Verified against Microsoft Learn (2026-08-21): `gpt-5` (2025-08-07) supports Streaming, Chat Completions, `max_completion_tokens` and `reasoning_effort` together, so the existing call shape streams unchanged. |
| D3 | Delete `APPLICATION(STREAMLIT)/`; new code in `web/` and `api/` | One front end, no ambiguity about which is live. |

**Rejected:** a full TypeScript port of retrieval (D1 risk above); inline source citations
(needs `build_prompt` changes and a citation contract, on top of a refusal threshold README §7.2
already calls uncalibrated — retrieval-quality work that should not ride along with a UI swap).

---

## 3. Architecture

```
Browser
   │
Next.js (App Router, TypeScript)
   │  POST /api/chat  — server-side route handler, proxies SSE
   │                    FASTAPI_URL never reaches the browser
FastAPI :8000
   │
puks_rag.answer_stream(corpus, q, memory_text, top_k)
   │
FAISS + BM25 + exact-name → RRF → Cohere rerank → gpt-5
   │
Azure Foundry (single tenant)
```

Target layout:

```
puks-ai/
  puks_rag.py                  ← additive changes only (§4)
  DATA/                        ← unchanged
  SCRIPTS/                     ← unchanged
  api/
    main.py                    ← FastAPI app
    mock.py                    ← fixture-backed engine for PUKS_MOCK=1
    fixtures/*.json
    requirements.txt
    Dockerfile
  web/
    app/                       ← App Router: /, /about, api/chat/route.ts
    components/
    lib/
    Dockerfile
  docker-compose.yml
  APPLICATION(STREAMLIT)/      ← DELETED
```

---

## 4. `puks_rag.py` changes

Retrieval is untouched. `retrieve_context`, `enrich_text`, `bm25_text`, `detect_document_type`,
`classify_query`, `build_prompt`, `build_context_text`, `SYSTEM_PROMPT`, `Corpus`, and every
`_render_*` helper keep their current bodies. Three additions plus one refactor:

```python
def _prepare(corpus, query, memory_text, top_k) -> tuple[list, float, dict, str | None]:
    """Shared front half: retrieve, classify, guard, build prompt.
    Returns (retrieved, confidence, intent, prompt). prompt is None when refused."""

def call_llm_stream(prompt: str, system: str) -> Iterator[str]:
    """Mirrors call_llm with stream=True. Same max_completion_tokens /
    reasoning_effort / verbosity, same TypeError fallback for SDKs < 1.99."""

def answer_stream(corpus, query, memory_text=..., top_k=TOP_K_DEFAULT) -> Iterator[tuple[str, Any]]:
    """Yields ('retrieved', payload) → ('token', str)* → ('done', payload)."""
```

`answer()` keeps its exact return contract — `{answer, retrieved, confidence, intent, refused}`
— because `SCRIPTS/06_rag_pipeline.ipynb` calls it. (`07_retrieval_baseline.ipynb` calls only
`retrieve_context`; `08_end_to_end_validation.ipynb` predates the refactor and imports nothing
from `puks_rag`.) `answer()` is re-expressed over `_prepare` so the refusal guard cannot drift
between the streaming and non-streaming paths.

**Implementation constraint.** `call_llm` retries without `verbosity` on `TypeError` for older
SDKs. In a generator that retry must resolve *before the first token is yielded*, or a retry
replays tokens already sent to the browser. Open the stream and pull the first chunk inside the
try block; yield nothing until it succeeds.

### 4.1 `format_memory` — the prompt contract, moved not rewritten

Streamlit's `ConversationMemory` is part of the prompt, so its rules move into Python verbatim:

- `deque(maxlen=max_turns * 2)`, `max_turns = 8`
- assistant content over 400 chars truncated to `content[:400] + "... [truncated]"`
- lines rendered `USER: …` / `ASSISTANT: …`, joined by `\n`
- empty history renders exactly `(No prior conversation)`

A golden test pins `format_memory` byte-for-byte against the current `ConversationMemory.format()`
across empty, short, over-400-char, and over-8-turn histories.

### 4.2 Statelessness

FastAPI holds no session. The client sends `history`; the server formats it. This is what allows
multiple replicas on Container Apps without a shared session store. The *formatting* stays
server-side so the truncation and labelling rules cannot drift into TypeScript.

---

## 5. Parity trap: refused turns never entered memory

In `APP.py` the assistant message is appended to `st.session_state.messages` (display)
unconditionally, but `st.session_state.memory.add_turn(...)` sits inside the `else` branch of
`if result["refused"]`. **Refused turns are visible in the transcript and invisible to the prompt.**

The Next.js client must reproduce this: every message carries a `refused` flag, and the `history`
sent to `/api/chat` excludes refused pairs. Missing this means every refusal begins poisoning
subsequent prompts with "I do not have enough information to answer this."

This is an explicit acceptance test, not a code comment.

---

## 6. FastAPI surface

| Route | Returns |
|---|---|
| `POST /api/chat` | `text/event-stream` — the SSE contract in §7 |
| `POST /api/answer` | JSON, wraps `answer()` unchanged. Tests and non-streaming callers. |
| `GET /api/config` | deployment names, `top_k` bounds, threshold, `rerank_configured` |
| `GET /health` | `{ready, index: {dimension, ntotal, model}, rerank_configured, error}` |

Request body for both POST routes:

```jsonc
{ "message": "how do I reverse a GRN?",
  "history": [{"role": "user", "content": "…"}, {"role": "assistant", "content": "…"}],
  "top_k": 5 }
```

`top_k` is clamped server-side to the 3–10 range the Streamlit slider enforced.

### 6.1 Corpus lifecycle

`Corpus()` loads once in the FastAPI lifespan handler — the `@st.cache_resource` equivalent.
**`ConfigError` is caught and held, never raised out of startup.** The process stays up and
`/health` reports `ready: false` with the message.

This is not hypothetical: the committed index is 384-dim, so `Corpus()` throws *today*. The UI
must render the same legible "not ready to answer questions" state Streamlit rendered, rather
than the container crash-looping.

### 6.2 `/api/config` exists because Streamlit read the module directly

The sidebar printed `puks_rag.CHAT_DEPLOYMENT`, `EMBED_DEPLOYMENT`, `RERANK_MODEL`,
`TOP_K_DEFAULT` and `CONFIDENCE_THRESHOLD` by importing the module. A browser cannot. These
values are served rather than duplicated into TypeScript, so changing an env var still changes
what the UI says.

---

## 7. SSE contract

Named events, JSON `data`, one event per message.

```
event: retrieved
data: {"chunks": [...], "confidence": 0.83, "intent": {...}}

event: token
data: {"text": "Reverse"}

event: done
data: {"refused": false, "model": "gpt-5", "elapsed_ms": 4120}
```

Refusal short-circuits — `retrieved` then `done`, no `token` events:

```
event: retrieved
data: {"chunks": [...], "confidence": 0.11, "intent": {...}}

event: done
data: {"refused": true, "reason": "below_threshold", "threshold": 0.30, "confidence": 0.11}
```

Errors terminate the stream as an event rather than a dead socket:

```
event: error
data: {"message": "Generation failed: …"}
```

Each chunk in `chunks` carries the fields `retrieve_context` already produces — `index`,
`fusion_score`, `in_dense`, `in_bm25`, `in_exact`, `doc_type`, `relevance_score`, `metadata`,
`text`.

Two deliberate wire decisions:

- **`structured_data` is not sent.** Streamlit never displayed it, it is already folded into the
  prompt server-side by `build_context_text`, and README §5.2 documents that it is not uniformly
  shaped. Its TypeScript type would have to be `unknown` anyway.
- **`text` is sent in full**, not truncated to 600 chars as Streamlit did. Five chunks is a small
  payload and the UI can offer expand/collapse — a strict-parity truncation would only remove
  information the debug panel exists to show.

---

## 8. Next.js front end

App Router, TypeScript, Tailwind. `app/api/chat/route.ts` proxies the SSE stream server-side so
`FASTAPI_URL` — and any auth added later — stays out of the browser.

| Component | Replaces |
|---|---|
| `ChatPanel` | `st.chat_message` loop + streaming assistant bubble. Markdown with GFM tables and SQL syntax highlighting — the corpus is largely SQL procedures and schema tables. |
| `Composer` | `st.chat_input`. Enter sends, disabled mid-stream. |
| `RetrievalPanel` | the debug expander: rank, dense/bm25/exact provenance chips, Cohere relevance, fusion score, doc type, collapsible metadata JSON, text |
| `Sidebar` | nav, `top_k` slider (3–10), "show retrieved context" toggle, model captions from `/api/config`, reset button |
| `NotReadyBanner` | `st.error(...)` + `st.stop()` on `ConfigError` |
| `/about` | the About page, as a real route |

Streaming UX: the `retrieved` event lands before generation starts, so the retrieval panel fills
immediately. This matters more than it would for a non-reasoning model — gpt-5 reasons before
emitting its first output token, so time-to-first-token stays high and `retrieved` is what
removes the dead air.

Visual direction is deferred to implementation, where the `frontend-design` skill applies.

---

## 9. Verification strategy

**What cannot be verified here:** there is no `.env` and no `AZURE_AI_KEY`, and the committed
index is the wrong dimension. Nothing on this machine can reach gpt-5, `text-embedding-3-large`
or `Cohere-rerank-v4.0-pro`, and `build_index.py` cannot run.

**`PUKS_MOCK=1`** makes `api/` serve captured fixtures in the exact `answer()` result shape and
stream them token-wise with a small delay. Fixtures cover an answered query, a refused query, a
schema query, and an operational query. This makes the entire front end — including the refusal
path, the retrieval panel, and the not-ready banner — testable with no Azure access.

| Layer | Tests |
|---|---|
| Python | `format_memory` golden parity; `_prepare` refusal guard; SSE event ordering and refusal short-circuit; `/health` when `Corpus()` raises; `call_llm_stream` against a stubbed SDK client |
| TypeScript | SSE parser; the refused-turns-excluded-from-history rule (§5); `top_k` clamping |
| End-to-end | Playwright against `PUKS_MOCK=1`: send, stream, expand retrieval panel, trigger refusal, reset memory, not-ready banner |

**The real-model path will be code-reviewed, type-checked and unit-tested against a stubbed
client, but not executed.** Completion will be reported as such. Confirming it needs a key,
`python SCRIPTS/build_index.py`, and a run against the live Foundry resource.

---

## 10. Risk recorded: a rerank outage refuses every query

Not introduced by this work, and **not fixed by this work** — but the new `/health` route is the
natural place to surface it, so it is recorded here.

`cohere_rerank` returns `[(i, 0.0), …]` both when `AZURE_RERANK_ENDPOINT` is unset and when the
HTTP call raises. `retrieve_context` then reads `confidence` from that same `relevance_score`
field (line 511), and `validate_context` gates on `confidence >= CONFIDENCE_THRESHOLD` (0.30).

So `confidence` is `0.0`, the gate fails, and **every query is refused**. The comment on the
fallback — *"availability beats precision here"* — describes an intent the code does not achieve:
the fallback costs availability completely, because the confidence gate consumes the reranker's
score.

Scope of this design: `/health` and `/api/config` expose `rerank_configured`, and the UI shows a
warning when it is false, so the failure is legible instead of looking like a bad knowledge base.
Changing the refusal semantics is a retrieval decision for the environment owner, tied to the
`PUKS_CONFIDENCE_THRESHOLD` calibration README §7.2 already lists as outstanding.

---

## 11. Deployment

A `Dockerfile` for each service and a `docker-compose.yml` for local use.

The Azure runbook is **not** written here. README §6 states that resource names, the access
chain and deployment runbooks live in gitignored `ENVIRONMENT.local.md`, which is not in this
working tree; §8 lists "which architecture are we building" as an open question for the
environment owner, and notes the handover document explicitly rules out Streamlit-on-App-Service.
Deployment lands as a documented handoff with the container contract and required app settings.

`.github/workflows/ci-cd.yml` currently lints and tests Python only, and deploys to app names
(`puks-ai-staging`, `puks-ai-production`) whose existence this design does not assume. It gains a
`web/` lint-and-build job; its deploy jobs are left alone.

---

## 12. Removals

- `APPLICATION(STREAMLIT)/` in full, including:
  - `style/style.css` — dead, loaded by nothing
  - `data/vector_store/` — the 200-vector / 768-dim orphan from a different model, which README
    flags for deletion in four separate places (§1 trust map, §3 layout, §4 table, §8)
  - `requirements.txt` — duplicate of the root file
- `streamlit` from the root `requirements.txt`
- `docs/DEPLOYMENT.md` references to `streamlit run` in the startup command

`DATA/vector_store/metadata.pkl` is left alone. It is stale, but deleting it is `build_index.py`'s
business (it already prints a notice), not the front end's.

---

## 13. Out of scope

Inline source citations · auth or SSO · persisted conversation history · evaluation-set work
(README §8 calls this the highest-value unblocked task, but it is not front-end work) ·
`PUKS_CONFIDENCE_THRESHOLD` calibration · rebuilding the index · changing retrieval behaviour of
any kind.
