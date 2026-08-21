# Next.js Front End Replacing Streamlit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit UI with a Next.js front end talking to a FastAPI service that wraps `puks_rag.py`, adding token streaming, and delete `APPLICATION(STREAMLIT)/`.

**Architecture:** Next.js (App Router) proxies SSE through a server-side route handler to FastAPI on :8000, which calls `puks_rag.answer_stream()`. Retrieval — FAISS, BM25, RRF, Cohere rerank — is untouched; `puks_rag.py` gains only a shared `_prepare()`, a streaming LLM call, a generator, and a memory formatter. FastAPI is stateless: the client sends conversation history, the server formats it into the prompt.

**Tech Stack:** Python 3.11 · FastAPI · uvicorn · pytest · Next.js (App Router) · TypeScript · Tailwind · Vitest · Playwright · Docker Compose

**Spec:** `docs/superpowers/specs/2026-08-21-nextjs-frontend-design.md` — read it before starting. It records three findings that drive decisions here (the index is unloadable today, refused turns never entered prompt memory, and a rerank outage refuses every query).

## Global Constraints

- **Python 3.11** (`python3.11`, present at 3.11.15). Not 3.14 — `faiss-cpu` has no wheels for it. README §4 specifies 3.11.
- **Node v25.6.0, pnpm 9.15.9** — both present.
- **No changes to retrieval.** `retrieve_context`, `enrich_text`, `bm25_text`, `detect_document_type`, `classify_query`, `build_prompt`, `build_context_text`, `Corpus`, `cohere_rerank`, `embed_texts` and every `_render_*` helper keep their current bodies. Changing `enrich_text` or `bm25_text` invalidates the index with no error (README §5).
- **The refusal string is byte-identical:** `I do not have enough information to answer this. Please contact support.`
- **Memory rules are byte-identical:** 8 turns (16 messages), assistant content over 400 chars becomes `content[:400] + "... [truncated]"`, lines are `USER: ` / `ASSISTANT: `, joined by `\n`, empty history is exactly `(No prior conversation)`.
- **`top_k` is clamped server-side to 3–10** — the range the Streamlit slider enforced.
- **`AZURE_AI_KEY` and `FASTAPI_URL` never reach the browser.** All FastAPI calls go through Next.js server-side route handlers or server components.
- **`structured_data` is never sent over the wire.** Streamlit never displayed it, `build_context_text` already folds it into the prompt server-side, and README §5.2 documents it as not uniformly shaped.
- **No Azure access in this environment.** Every task must be verifiable with `PUKS_MOCK=1` or stubbed clients. Do not write a test that requires a real key.

---

## File Structure

| File | Responsibility |
|---|---|
| `puks_rag.py` (modify) | + `format_memory`, `_prepare`, `call_llm_stream`, `answer_stream`, `_wire_chunk`, `REFUSAL_TEXT`. Retrieval untouched. |
| `pyproject.toml` (create) | pytest config only |
| `tests/conftest.py` (create) | `FakeCorpus`, stub client fixtures |
| `tests/test_memory.py` (create) | `format_memory` golden parity |
| `tests/test_answer.py` (create) | `_prepare` / `answer` refusal guard |
| `tests/test_stream.py` (create) | `call_llm_stream`, `answer_stream` event ordering |
| `tests/test_api.py` (create) | FastAPI routes via `TestClient` |
| `api/engine.py` (create) | Chooses real `puks_rag` or mock; owns `Corpus` load + `ConfigError` capture |
| `api/mock.py` (create) | Fixture-backed `answer` / `answer_stream` for `PUKS_MOCK=1` |
| `api/fixtures/*.json` (create) | Two captured results: `answered.json` (carries both an OPERATIONAL_REFERENCE and a TABLE_SCHEMA chunk, so both render paths are exercised) and `refused.json` |
| `api/main.py` (create) | FastAPI app: `/health`, `/api/config`, `/api/answer`, `/api/chat` |
| `api/requirements.txt` (create) | fastapi, uvicorn, + root requirements |
| `web/lib/sse.ts` (create) | SSE parser over a `ReadableStream` |
| `web/lib/history.ts` (create) | Refused-turn exclusion, `top_k` clamp, message types |
| `web/lib/types.ts` (create) | Wire types mirroring the SSE contract |
| `web/app/api/chat/route.ts` (create) | Server-side SSE proxy to FastAPI |
| `web/app/page.tsx` (create) | Chat route |
| `web/app/about/page.tsx` (create) | About route |
| `web/components/*.tsx` (create) | `ChatPanel`, `Composer`, `RetrievalPanel`, `Sidebar`, `NotReadyBanner` |
| `docker-compose.yml`, `api/Dockerfile`, `web/Dockerfile` (create) | Local two-service run |
| `APPLICATION(STREAMLIT)/` (delete) | Replaced |

---

## Task 1: Test harness and `format_memory`

**Files:**
- Create: `pyproject.toml`, `tests/__init__.py`, `tests/test_memory.py`
- Modify: `puks_rag.py` (append after `classify_query`)

**Interfaces:**
- Consumes: nothing
- Produces: `puks_rag.format_memory(history: list[dict], max_turns: int = 8) -> str`, `puks_rag.MEMORY_MAX_TURNS = 8`, `puks_rag.MEMORY_TRUNCATE_AT = 400`

- [ ] **Step 1: Create the virtualenv and install**

```bash
cd ~/Developer/puks-ai
python3.11 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt pytest httpx fastapi uvicorn
```

- [ ] **Step 2: Create `pyproject.toml`**

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-q"
```

- [ ] **Step 3: Write the failing test**

Create `tests/__init__.py` (empty) and `tests/test_memory.py`:

```python
"""format_memory must reproduce APPLICATION(STREAMLIT)/APP.py's ConversationMemory
byte-for-byte — it is part of the prompt, not a display concern."""
from collections import deque

from puks_rag import format_memory


class ReferenceMemory:
    """Verbatim copy of the Streamlit ConversationMemory, kept as the oracle."""

    def __init__(self, max_turns: int = 8):
        self.history = deque(maxlen=max_turns * 2)

    def add_turn(self, question: str, answer: str):
        self.history.append({"role": "user", "content": question})
        self.history.append({"role": "assistant", "content": answer})

    def format(self) -> str:
        if not self.history:
            return "(No prior conversation)"
        lines = []
        for m in self.history:
            role = "USER" if m["role"] == "user" else "ASSISTANT"
            content = m["content"]
            if m["role"] == "assistant" and len(content) > 400:
                content = content[:400] + "... [truncated]"
            lines.append(f"{role}: {content}")
        return "\n".join(lines)


def _both(turns: list[tuple[str, str]]) -> tuple[str, str]:
    reference = ReferenceMemory()
    history: list[dict] = []
    for question, reply in turns:
        reference.add_turn(question, reply)
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": reply})
    return format_memory(history), reference.format()


def test_empty_history_is_the_exact_sentinel():
    assert format_memory([]) == "(No prior conversation)"


def test_single_turn_matches_reference():
    mine, reference = _both([("how do I reverse a GRN?", "Run the validate query first.")])
    assert mine == reference
    assert mine == "USER: how do I reverse a GRN?\nASSISTANT: Run the validate query first."


def test_long_assistant_reply_truncates_at_400():
    mine, reference = _both([("q", "x" * 500)])
    assert mine == reference
    assert mine == "USER: q\nASSISTANT: " + "x" * 400 + "... [truncated]"


def test_long_user_message_is_never_truncated():
    mine, reference = _both([("y" * 500, "short")])
    assert mine == reference
    assert "y" * 500 in mine


def test_reply_of_exactly_400_is_not_truncated():
    mine, reference = _both([("q", "z" * 400)])
    assert mine == reference
    assert "[truncated]" not in mine


def test_window_keeps_only_the_last_eight_turns():
    turns = [(f"q{i}", f"a{i}") for i in range(12)]
    mine, reference = _both(turns)
    assert mine == reference
    assert "q3" not in mine
    assert "q4" in mine
    assert len(mine.splitlines()) == 16
```

- [ ] **Step 4: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_memory.py -v`
Expected: FAIL — `ImportError: cannot import name 'format_memory' from 'puks_rag'`

- [ ] **Step 5: Implement**

Append to `puks_rag.py`, immediately after `classify_query`:

```python
# ==================================================
# CONVERSATION MEMORY
# ==================================================
# Ported verbatim from the Streamlit ConversationMemory. These rules are part
# of the prompt, not a display concern: the model sees this text. The API is
# stateless — the client sends raw history and the server formats it — so that
# the truncation and labelling rules cannot drift into the front end.
MEMORY_MAX_TURNS   = 8
MEMORY_TRUNCATE_AT = 400


def format_memory(history: list[dict], max_turns: int = MEMORY_MAX_TURNS) -> str:
    """Render a message list as the CONVERSATION HISTORY block of the prompt."""
    if not history:
        return "(No prior conversation)"

    lines = []
    for message in history[-(max_turns * 2):]:
        role    = "USER" if message["role"] == "user" else "ASSISTANT"
        content = message["content"]
        if message["role"] == "assistant" and len(content) > MEMORY_TRUNCATE_AT:
            content = content[:MEMORY_TRUNCATE_AT] + "... [truncated]"
        lines.append(f"{role}: {content}")
    return "\n".join(lines)
```

- [ ] **Step 6: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_memory.py -v`
Expected: 6 passed

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml tests/ puks_rag.py
git commit -m "feat(rag): format_memory, ported byte-for-byte from Streamlit

The memory block is part of the prompt, so its rules move into puks_rag
rather than into TypeScript. A reference copy of the Streamlit class is
kept in the tests as the oracle."
```

---

## Task 2: `_prepare()` and `answer()` re-expressed over it

**Files:**
- Create: `tests/conftest.py`, `tests/test_answer.py`
- Modify: `puks_rag.py` (`answer` at ~line 795)

**Interfaces:**
- Consumes: `format_memory` (Task 1)
- Produces: `puks_rag.REFUSAL_TEXT: str`, `puks_rag._prepare(corpus, query, memory_text, top_k) -> tuple[list, float, dict, str | None]` (fourth element is `None` when refused), `answer()` return contract unchanged

- [ ] **Step 1: Write the shared fixtures**

Create `tests/conftest.py`:

```python
"""Fixtures that let the whole suite run with no Azure access.

Nothing here touches FAISS, the network, or a real key. `retrieve_context`
is monkeypatched wholesale because retrieval is out of scope for this work —
these tests cover the guard, the prompt assembly and the streaming contract.
"""
import pytest


def make_chunk(index: int = 0, relevance: float = 0.9, **overrides) -> dict:
    """A chunk shaped exactly as retrieve_context produces one."""
    chunk = {
        "index":           index,
        "fusion_score":    0.0163,
        "in_dense":        True,
        "in_bm25":         False,
        "in_exact":        False,
        "doc_type":        "OPERATIONAL_REFERENCE",
        "text":            "To reverse a GRN, validate the receipt first.",
        "metadata":        {"source": "receiving.pdf", "category": "RECEIVING GOODS",
                            "table_name": "REE_DAT", "chunk_type": "wms_procedure"},
        "structured_data": {"procedure_name": "Reverse GRN", "steps": ["validate", "update"]},
        "relevance_score": relevance,
    }
    chunk.update(overrides)
    return chunk


class FakeCorpus:
    """Stands in for Corpus. Never loaded, never searched — retrieve_context is patched."""


@pytest.fixture
def corpus():
    return FakeCorpus()


@pytest.fixture
def high_confidence(monkeypatch):
    """retrieve_context returns one strong hit."""
    import puks_rag
    chunks = [make_chunk(relevance=0.87)]
    monkeypatch.setattr(puks_rag, "retrieve_context",
                        lambda corpus, query, top_k=5: (chunks, 0.87))
    return chunks


@pytest.fixture
def low_confidence(monkeypatch):
    """retrieve_context returns a hit below CONFIDENCE_THRESHOLD."""
    import puks_rag
    chunks = [make_chunk(relevance=0.11)]
    monkeypatch.setattr(puks_rag, "retrieve_context",
                        lambda corpus, query, top_k=5: (chunks, 0.11))
    return chunks
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_answer.py`:

```python
import puks_rag
from puks_rag import REFUSAL_TEXT, _prepare, answer


def test_prepare_builds_a_prompt_when_confidence_clears_the_bar(corpus, high_confidence):
    retrieved, confidence, intent, prompt = _prepare(corpus, "reverse a GRN", "(No prior conversation)", 5)
    assert retrieved == high_confidence
    assert confidence == 0.87
    assert intent["is_operational"] is True
    assert prompt is not None
    assert "USER QUESTION" in prompt
    assert "reverse a GRN" in prompt


def test_prepare_returns_no_prompt_when_below_threshold(corpus, low_confidence):
    retrieved, confidence, intent, prompt = _prepare(corpus, "what is the weather", "(No prior conversation)", 5)
    assert prompt is None
    assert confidence == 0.11
    assert retrieved == low_confidence


def test_prepare_threads_memory_text_into_the_prompt(corpus, high_confidence):
    _, _, _, prompt = _prepare(corpus, "and then?", "USER: q\nASSISTANT: a", 5)
    assert "USER: q\nASSISTANT: a" in prompt


def test_answer_refuses_with_the_exact_legacy_string(corpus, low_confidence):
    result = answer(corpus, "what is the weather")
    assert result["refused"] is True
    assert result["answer"] == "I do not have enough information to answer this. Please contact support."
    assert result["answer"] == REFUSAL_TEXT
    assert result["confidence"] == 0.11


def test_answer_never_calls_the_model_when_refusing(corpus, low_confidence, monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("call_llm must not run on the refusal path")
    monkeypatch.setattr(puks_rag, "call_llm", explode)
    assert answer(corpus, "what is the weather")["refused"] is True


def test_answer_returns_the_full_legacy_contract(corpus, high_confidence, monkeypatch):
    monkeypatch.setattr(puks_rag, "call_llm", lambda prompt, system: "Validate, then update.")
    result = answer(corpus, "reverse a GRN")
    assert set(result) == {"answer", "retrieved", "confidence", "intent", "refused"}
    assert result["answer"] == "Validate, then update."
    assert result["refused"] is False
    assert result["retrieved"] == high_confidence
```

- [ ] **Step 3: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_answer.py -v`
Expected: FAIL — `ImportError: cannot import name 'REFUSAL_TEXT'`

- [ ] **Step 4: Implement**

In `puks_rag.py`, replace the whole `def answer(...)` block at the end of the file with:

```python
REFUSAL_TEXT = ("I do not have enough information to answer this. "
                "Please contact support.")


def _prepare(corpus: Corpus, query: str, memory_text: str, top_k: int):
    """Shared front half of both answer paths: retrieve, classify, guard, build prompt.

    Returns (retrieved, confidence, intent, prompt). `prompt` is None when the
    context fails the confidence gate — the single place that decision is made,
    so the streaming and non-streaming paths cannot drift apart.
    """
    retrieved, confidence = retrieve_context(corpus, query, top_k=top_k)
    intent = classify_query(query)

    if not validate_context(retrieved, confidence):
        return retrieved, confidence, intent, None

    return retrieved, confidence, intent, build_prompt(query, retrieved, memory_text, intent)


def answer(corpus: Corpus, query: str, memory_text: str = "(No prior conversation)",
           top_k: int = TOP_K_DEFAULT) -> dict:
    """End-to-end: retrieve, guard, generate. Blocking; see answer_stream to stream."""
    retrieved, confidence, intent, prompt = _prepare(corpus, query, memory_text, top_k)

    if prompt is None:
        return {
            "answer":     REFUSAL_TEXT,
            "retrieved":  retrieved,
            "confidence": confidence,
            "intent":     intent,
            "refused":    True,
        }

    return {
        "answer":     call_llm(prompt, SYSTEM_PROMPT),
        "retrieved":  retrieved,
        "confidence": confidence,
        "intent":     intent,
        "refused":    False,
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/ -v`
Expected: 12 passed

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/test_answer.py puks_rag.py
git commit -m "refactor(rag): extract _prepare() so both answer paths share one guard

answer()'s return contract is unchanged — SCRIPTS/06_rag_pipeline.ipynb
calls it. Extracting the retrieve/classify/guard/build-prompt front half
means the streaming path added next cannot drift from it."
```

---

## Task 3: `call_llm_stream()`

**Files:**
- Create: `tests/test_stream.py`
- Modify: `puks_rag.py` (append after `call_llm`, ~line 340)

**Interfaces:**
- Consumes: module config (`CHAT_DEPLOYMENT`, `MAX_OUTPUT`, `REASONING_EFFORT`, `VERBOSITY`)
- Produces: `puks_rag.call_llm_stream(prompt: str, system: str) -> Iterator[str]`

- [ ] **Step 1: Write the failing test**

Create `tests/test_stream.py`:

```python
import pytest

import puks_rag
from puks_rag import call_llm_stream


class Delta:
    def __init__(self, content): self.content = content


class Choice:
    def __init__(self, content): self.delta = Delta(content)


class Chunk:
    """Mimics an openai stream chunk. Azure sends chunks with an empty
    `choices` list (prompt filter results) that must be skipped."""
    def __init__(self, content=None, has_choices=True):
        self.choices = [Choice(content)] if has_choices else []


class StubCompletions:
    def __init__(self, chunks, reject_verbosity=False):
        self._chunks          = chunks
        self._reject          = reject_verbosity
        self.calls            = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._reject and "verbosity" in kwargs:
            raise TypeError("got an unexpected keyword argument 'verbosity'")
        return iter(self._chunks)


class StubClient:
    def __init__(self, chunks, reject_verbosity=False):
        self.chat = type("Chat", (), {})()
        self.chat.completions = StubCompletions(chunks, reject_verbosity)


def install(monkeypatch, chunks, reject_verbosity=False) -> StubClient:
    client = StubClient(chunks, reject_verbosity)
    monkeypatch.setattr(puks_rag, "get_client", lambda: client)
    return client


def test_yields_each_content_delta_in_order(monkeypatch):
    install(monkeypatch, [Chunk("Vali"), Chunk("date"), Chunk(" first.")])
    assert list(call_llm_stream("p", "s")) == ["Vali", "date", " first."]


def test_skips_chunks_with_empty_choices(monkeypatch):
    install(monkeypatch, [Chunk(has_choices=False), Chunk("ok")])
    assert list(call_llm_stream("p", "s")) == ["ok"]


def test_skips_none_and_empty_deltas(monkeypatch):
    install(monkeypatch, [Chunk(None), Chunk(""), Chunk("real")])
    assert list(call_llm_stream("p", "s")) == ["real"]


def test_sends_the_reasoning_model_parameter_set(monkeypatch):
    client = install(monkeypatch, [Chunk("x")])
    list(call_llm_stream("the prompt", "the system"))
    sent = client.chat.completions.calls[0]
    assert sent["stream"] is True
    assert sent["model"] == puks_rag.CHAT_DEPLOYMENT
    assert sent["max_completion_tokens"] == puks_rag.MAX_OUTPUT
    assert sent["reasoning_effort"] == puks_rag.REASONING_EFFORT
    assert "temperature" not in sent
    assert "max_tokens" not in sent
    assert sent["messages"] == [
        {"role": "system", "content": "the system"},
        {"role": "user", "content": "the prompt"},
    ]


def test_retries_without_verbosity_on_older_sdks(monkeypatch):
    client = install(monkeypatch, [Chunk("recovered")], reject_verbosity=True)
    assert list(call_llm_stream("p", "s")) == ["recovered"]
    assert len(client.chat.completions.calls) == 2
    assert "verbosity" in client.chat.completions.calls[0]
    assert "verbosity" not in client.chat.completions.calls[1]


def test_the_verbosity_retry_replays_no_tokens(monkeypatch):
    """The retry must resolve before the first yield, or the browser sees
    duplicated tokens."""
    client = install(monkeypatch, [Chunk("a"), Chunk("b")], reject_verbosity=True)
    assert list(call_llm_stream("p", "s")) == ["a", "b"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_stream.py -v`
Expected: FAIL — `ImportError: cannot import name 'call_llm_stream'`

- [ ] **Step 3: Implement**

Append to `puks_rag.py` immediately after `call_llm`:

```python
def call_llm_stream(prompt: str, system: str):
    """Stream generation with gpt-5. Yields content deltas as they arrive.

    Same parameter set as call_llm — reasoning models take max_completion_tokens
    and reject temperature/top_p/max_tokens. Verified against Microsoft Learn
    2026-08-21: gpt-5 (2025-08-07) supports streaming on Chat Completions
    alongside reasoning_effort.

    The `verbosity` retry sits around create() only, which runs before the first
    yield — retrying after tokens had been emitted would replay them.
    """
    kwargs = {
        "model":                 CHAT_DEPLOYMENT,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        "max_completion_tokens": MAX_OUTPUT,
        "reasoning_effort":      REASONING_EFFORT,
        "stream":                True,
    }

    try:
        stream = get_client().chat.completions.create(verbosity=VERBOSITY, **kwargs)
    except TypeError:
        # Older openai SDKs do not know `verbosity`. Retry without it.
        stream = get_client().chat.completions.create(**kwargs)

    for chunk in stream:
        # Azure emits chunks with an empty `choices` list for prompt filter
        # results and for the final usage chunk.
        if not chunk.choices:
            continue
        text = chunk.choices[0].delta.content
        if text:
            yield text
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_stream.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add tests/test_stream.py puks_rag.py
git commit -m "feat(rag): call_llm_stream() for token-by-token generation

Mirrors call_llm's reasoning-model parameter set. Skips the empty-choices
chunks Azure sends for prompt filter and usage. The verbosity retry wraps
create() only, so it cannot replay already-yielded tokens."
```

---

## Task 4: `answer_stream()` and the wire shape

**Files:**
- Modify: `puks_rag.py` (append at end of file), `tests/test_stream.py`

**Interfaces:**
- Consumes: `_prepare` (Task 2), `call_llm_stream` (Task 3)
- Produces: `puks_rag.answer_stream(corpus, query, memory_text="(No prior conversation)", top_k=TOP_K_DEFAULT) -> Iterator[tuple[str, dict]]` yielding `("retrieved", {...})` → `("token", {"text": str})*` → `("done", {...})`; `puks_rag.wire_chunk(chunk: dict) -> dict`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_stream.py`:

```python
from puks_rag import answer_stream, wire_chunk
from tests.conftest import make_chunk


def test_wire_chunk_drops_structured_data():
    """Streamlit never displayed it, build_context_text already folded it into
    the prompt, and README 5.2 documents it as not uniformly shaped."""
    wired = wire_chunk(make_chunk())
    assert "structured_data" not in wired
    assert set(wired) == {"index", "fusion_score", "in_dense", "in_bm25", "in_exact",
                          "doc_type", "relevance_score", "metadata", "text"}


def test_wire_chunk_sends_text_in_full():
    wired = wire_chunk(make_chunk(text="y" * 2000))
    assert len(wired["text"]) == 2000


def test_stream_emits_retrieved_then_tokens_then_done(monkeypatch, corpus, high_confidence):
    monkeypatch.setattr(puks_rag, "call_llm_stream", lambda prompt, system: iter(["Vali", "date"]))
    events = list(answer_stream(corpus, "reverse a GRN"))

    assert [name for name, _ in events] == ["retrieved", "token", "token", "done"]

    _, retrieved = events[0]
    assert retrieved["confidence"] == 0.87
    assert len(retrieved["chunks"]) == 1
    assert "structured_data" not in retrieved["chunks"][0]
    assert retrieved["intent"]["is_operational"] is True

    assert events[1][1] == {"text": "Vali"}
    assert events[3][1]["refused"] is False
    assert events[3][1]["model"] == puks_rag.CHAT_DEPLOYMENT


def test_refusal_short_circuits_past_every_token(monkeypatch, corpus, low_confidence):
    def explode(*args, **kwargs):
        raise AssertionError("generation must not run on the refusal path")
    monkeypatch.setattr(puks_rag, "call_llm_stream", explode)

    events = list(answer_stream(corpus, "what is the weather"))
    assert [name for name, _ in events] == ["retrieved", "done"]

    done = events[1][1]
    assert done["refused"] is True
    assert done["reason"] == "below_threshold"
    assert done["confidence"] == 0.11
    assert done["threshold"] == puks_rag.CONFIDENCE_THRESHOLD


def test_retrieved_lands_before_any_generation_work(monkeypatch, corpus, high_confidence):
    """The retrieval panel must fill before gpt-5 starts reasoning — that is
    the entire latency argument for streaming a reasoning model."""
    order = []

    def track(prompt, system):
        order.append("generation-started")
        yield "x"

    monkeypatch.setattr(puks_rag, "call_llm_stream", track)
    stream = answer_stream(corpus, "reverse a GRN")
    name, _ = next(stream)
    assert name == "retrieved"
    assert order == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_stream.py -v`
Expected: FAIL — `ImportError: cannot import name 'answer_stream'`

- [ ] **Step 3: Implement**

Append to the end of `puks_rag.py`:

```python
# Fields sent to the browser. `structured_data` is deliberately absent: the UI
# never displayed it, build_context_text already folded it into the prompt, and
# it is not uniformly shaped (README 5.2).
WIRE_FIELDS = ("index", "fusion_score", "in_dense", "in_bm25", "in_exact",
               "doc_type", "relevance_score", "metadata", "text")


def wire_chunk(chunk: dict) -> dict:
    """Project a retrieved chunk down to the fields the front end renders."""
    return {field: chunk[field] for field in WIRE_FIELDS if field in chunk}


def answer_stream(corpus: Corpus, query: str, memory_text: str = "(No prior conversation)",
                  top_k: int = TOP_K_DEFAULT):
    """Streaming sibling of answer().

    Yields ("retrieved", {chunks, confidence, intent}) as soon as retrieval is
    done — before generation begins — then ("token", {"text": ...}) per delta,
    then ("done", {...}). A refusal short-circuits straight to "done".
    """
    retrieved, confidence, intent, prompt = _prepare(corpus, query, memory_text, top_k)

    yield "retrieved", {
        "chunks":     [wire_chunk(chunk) for chunk in retrieved],
        "confidence": confidence,
        "intent":     intent,
    }

    if prompt is None:
        yield "done", {
            "refused":    True,
            "reason":     "below_threshold",
            "confidence": confidence,
            "threshold":  CONFIDENCE_THRESHOLD,
        }
        return

    for token in call_llm_stream(prompt, SYSTEM_PROMPT):
        yield "token", {"text": token}

    yield "done", {"refused": False, "model": CHAT_DEPLOYMENT}
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/ -v`
Expected: 23 passed

- [ ] **Step 5: Commit**

```bash
git add tests/test_stream.py puks_rag.py
git commit -m "feat(rag): answer_stream() yielding retrieved -> token* -> done

The retrieved event lands before generation starts. gpt-5 reasons before
emitting its first output token, so filling the retrieval panel early is
what actually removes the dead air."
```

---

## Task 5: Mock engine and fixtures

**Files:**
- Create: `api/__init__.py`, `api/mock.py`, `api/fixtures/answered.json`, `api/fixtures/refused.json`, `tests/test_mock.py`

**Interfaces:**
- Consumes: `puks_rag.wire_chunk`, `puks_rag.REFUSAL_TEXT`
- Produces: `api.mock.MockCorpus`, `api.mock.answer(corpus, query, memory_text, top_k) -> dict`, `api.mock.answer_stream(corpus, query, memory_text, top_k) -> Iterator[tuple[str, dict]]`

This is what makes every later task verifiable without a key. Build it before the API routes.

- [ ] **Step 1: Write the fixtures**

Create `api/__init__.py` (empty). Create `api/fixtures/answered.json`:

```json
{
  "match": "grn",
  "confidence": 0.87,
  "answer": "To reverse a GRN in Speed WMS:\n\n1. **Validate first** — confirm the receipt is not already closed:\n\n```sql\nSELECT REE_NUM, REE_STATUS FROM REE_DAT WHERE REE_NUM = :grn;\n```\n\n2. **Reverse** once the status is confirmed open.\n\n| Field | Value |\n|---|---|\n| Table | REE_DAT |\n| Access level | Supervisor |\n\nRespect the safety rules: never reverse a GRN with downstream missions.",
  "chunks": [
    {
      "index": 41, "fusion_score": 0.0163, "in_dense": true, "in_bm25": true,
      "in_exact": true, "doc_type": "OPERATIONAL_REFERENCE", "relevance_score": 0.87,
      "metadata": {"source": "RECEIVING GOODS/reverse_grn.docx", "category": "RECEIVING GOODS",
                   "table_name": "REE_DAT", "procedure_name": "Reverse GRN",
                   "chunk_type": "wms_procedure"},
      "text": "Reversing a goods receipt note requires supervisor access. Validate the receipt status before any update, and confirm no downstream missions exist."
    },
    {
      "index": 12, "fusion_score": 0.0142, "in_dense": true, "in_bm25": false,
      "in_exact": false, "doc_type": "TABLE_SCHEMA", "relevance_score": 0.64,
      "metadata": {"source": "Database Tables/REE_DAT.md", "category": "Database Tables",
                   "table_name": "REE_DAT", "chunk_type": "schema_overview"},
      "text": "REE_DAT — receipt header. Primary key REE_NUM. Foreign keys: REE_SUPPLIER -> SUP_DAT."
    }
  ],
  "intent": {"is_schema": false, "is_operational": true, "is_sql": false,
             "schema_hits": [], "operational_hits": ["reverse", "grn"]}
}
```

Create `api/fixtures/refused.json`:

```json
{
  "match": "",
  "confidence": 0.11,
  "answer": null,
  "chunks": [
    {
      "index": 300, "fusion_score": 0.0081, "in_dense": true, "in_bm25": false,
      "in_exact": false, "doc_type": "TEXT", "relevance_score": 0.11,
      "metadata": {"source": "GENERAL/intro.docx", "category": "GENERAL",
                   "chunk_type": "text_prose"},
      "text": "Speed WMS is a warehouse management system used across AGL sites."
    }
  ],
  "intent": {"is_schema": false, "is_operational": false, "is_sql": false,
             "schema_hits": [], "operational_hits": []}
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_mock.py`:

```python
from api import mock


def test_known_query_answers():
    result = mock.answer(mock.MockCorpus(), "how do I reverse a GRN?")
    assert result["refused"] is False
    assert "REE_DAT" in result["answer"]
    assert result["confidence"] == 0.87
    assert len(result["retrieved"]) == 2


def test_unknown_query_refuses_with_the_real_string():
    import puks_rag
    result = mock.answer(mock.MockCorpus(), "what is the weather in Cape Town")
    assert result["refused"] is True
    assert result["answer"] == puks_rag.REFUSAL_TEXT


def test_stream_shape_matches_the_real_generator(monkeypatch):
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)
    events = list(mock.answer_stream(mock.MockCorpus(), "reverse a GRN"))
    assert events[0][0] == "retrieved"
    assert events[-1][0] == "done"
    assert {name for name, _ in events} == {"retrieved", "token", "done"}
    assert events[-1][1]["refused"] is False
    joined = "".join(payload["text"] for name, payload in events if name == "token")
    assert "REE_DAT" in joined


def test_stream_refusal_emits_no_tokens(monkeypatch):
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)
    events = list(mock.answer_stream(mock.MockCorpus(), "unrelated question"))
    assert [name for name, _ in events] == ["retrieved", "done"]
    assert events[1][1]["refused"] is True
    assert events[1][1]["reason"] == "below_threshold"


def test_mock_chunks_carry_no_structured_data(monkeypatch):
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)
    events = list(mock.answer_stream(mock.MockCorpus(), "reverse a GRN"))
    for chunk in events[0][1]["chunks"]:
        assert "structured_data" not in chunk
```

- [ ] **Step 3: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_mock.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.mock'`

- [ ] **Step 4: Implement**

Create `api/mock.py`:

```python
"""Fixture-backed engine for PUKS_MOCK=1.

There is no AZURE_AI_KEY in development and the committed index is the wrong
dimension, so the front end would otherwise be unbuildable. This serves captured
results in the exact shape puks_rag produces, streamed word by word.

It deliberately reuses puks_rag.REFUSAL_TEXT and CONFIDENCE_THRESHOLD rather
than restating them — a mock that drifts from the real contract is worse than
no mock.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from puks_rag import CHAT_DEPLOYMENT, CONFIDENCE_THRESHOLD, REFUSAL_TEXT

FIXTURES           = Path(__file__).resolve().parent / "fixtures"
TOKEN_DELAY_SECONDS = 0.012


class MockCorpus:
    """Stands in for Corpus so the API surface is identical in both modes."""
    ntotal    = 627
    dimension = 3072
    model     = "mock"


def _load() -> list[dict]:
    return [json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(FIXTURES.glob("*.json"))]


def _select(query: str) -> dict:
    """First fixture whose `match` string appears in the query; else the refusal."""
    fixtures = _load()
    lowered  = query.lower()
    for fixture in fixtures:
        if fixture["match"] and fixture["match"] in lowered:
            return fixture
    return next(f for f in fixtures if not f["match"])


def _tokenise(text: str) -> list[str]:
    """Split into word-plus-whitespace pieces so streaming looks like generation."""
    return re.findall(r"\S+\s*", text)


def answer(corpus, query: str, memory_text: str = "(No prior conversation)",
           top_k: int = 5) -> dict:
    fixture = _select(query)
    refused = fixture["answer"] is None
    return {
        "answer":     REFUSAL_TEXT if refused else fixture["answer"],
        "retrieved":  fixture["chunks"][:top_k],
        "confidence": fixture["confidence"],
        "intent":     fixture["intent"],
        "refused":    refused,
    }


def answer_stream(corpus, query: str, memory_text: str = "(No prior conversation)",
                  top_k: int = 5):
    fixture = _select(query)
    refused = fixture["answer"] is None

    yield "retrieved", {
        "chunks":     fixture["chunks"][:top_k],
        "confidence": fixture["confidence"],
        "intent":     fixture["intent"],
    }

    if refused:
        yield "done", {
            "refused":    True,
            "reason":     "below_threshold",
            "confidence": fixture["confidence"],
            "threshold":  CONFIDENCE_THRESHOLD,
        }
        return

    for token in _tokenise(fixture["answer"]):
        if TOKEN_DELAY_SECONDS:
            time.sleep(TOKEN_DELAY_SECONDS)
        yield "token", {"text": token}

    yield "done", {"refused": False, "model": f"{CHAT_DEPLOYMENT} (mock)"}
```

- [ ] **Step 5: Run to verify it passes**

Run: `.venv/bin/pytest tests/ -v`
Expected: 28 passed

- [ ] **Step 6: Commit**

```bash
git add api/ tests/test_mock.py
git commit -m "feat(api): fixture-backed mock engine for PUKS_MOCK=1

No key and a wrong-dimension index mean the front end is otherwise
unverifiable. Reuses REFUSAL_TEXT and CONFIDENCE_THRESHOLD from puks_rag
so the mock cannot drift from the real contract."
```

---

## Task 6: FastAPI — engine loader, `/health`, `/api/config`

**Files:**
- Create: `api/engine.py`, `api/main.py`, `api/requirements.txt`, `tests/test_api.py`

**Interfaces:**
- Consumes: `api.mock` (Task 5), `puks_rag`
- Produces: `api.engine.Engine` with `.ready: bool`, `.error: str | None`, `.corpus`, `.answer(...)`, `.answer_stream(...)`, `.info() -> dict`; `api.main.app` (FastAPI), `api.main.create_app()`

- [ ] **Step 1: Write the failing test**

Create `tests/test_api.py`:

```python
import pytest
from fastapi.testclient import TestClient

from api.main import create_app


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PUKS_MOCK", "1")
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture
def broken_client(monkeypatch):
    """Corpus() raises — exactly today's state, with a 384-dim index."""
    import puks_rag

    def boom():
        raise puks_rag.ConfigError("Index is 384-dim but AZURE_EMBED_DIMENSIONS is 3072")

    monkeypatch.delenv("PUKS_MOCK", raising=False)
    monkeypatch.setattr(puks_rag, "Corpus", boom)
    with TestClient(create_app()) as test_client:
        yield test_client


def test_health_is_ready_in_mock_mode(client):
    body = client.get("/health").json()
    assert body["ready"] is True
    assert body["error"] is None
    assert body["index"]["ntotal"] == 627


def test_health_reports_not_ready_instead_of_crashing(broken_client):
    """A ConfigError must not take the service down — the UI needs to render
    the same legible 'not ready' state Streamlit did."""
    response = broken_client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is False
    assert "384-dim" in body["error"]


def test_config_exposes_what_the_sidebar_needs(client):
    body = client.get("/api/config").json()
    assert body["top_k_default"] == 5
    assert body["top_k_min"] == 3
    assert body["top_k_max"] == 10
    assert body["confidence_threshold"] == 0.30
    assert "chat_deployment" in body
    assert "embed_deployment" in body
    assert "rerank_model" in body


def test_config_reports_whether_rerank_is_configured(client, monkeypatch):
    """With AZURE_RERANK_ENDPOINT unset, cohere_rerank returns 0.0 scores,
    confidence reads that field, and the 0.30 gate refuses every query.
    The UI has to be able to say so. See spec section 10."""
    import puks_rag
    monkeypatch.setattr(puks_rag, "RERANK_ENDPOINT", "")
    assert client.get("/api/config").json()["rerank_configured"] is False
    monkeypatch.setattr(puks_rag, "RERANK_ENDPOINT", "https://x.services.ai.azure.com/models/v2/rerank")
    assert client.get("/api/config").json()["rerank_configured"] is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.main'`

- [ ] **Step 3: Implement the engine**

Create `api/engine.py`:

```python
"""Owns the one expensive object in the process: the loaded Corpus.

Loaded once at startup, the equivalent of Streamlit's @st.cache_resource.

A ConfigError is CAPTURED, not raised. The committed index is 384-dim against a
3072-dim requirement, so Corpus() raises today; a service that crash-loops on
that is strictly worse than one that stays up and explains itself through
/health. Streamlit rendered st.error() and stopped — this is the same idea at
the service level.
"""
from __future__ import annotations

import os

import puks_rag


def mock_enabled() -> bool:
    return os.getenv("PUKS_MOCK", "").strip().lower() in {"1", "true", "yes"}


class Engine:
    def __init__(self) -> None:
        self.mock:   bool = mock_enabled()
        self.corpus       = None
        self.error: str | None = None

        if self.mock:
            from api import mock
            self._impl  = mock
            self.corpus = mock.MockCorpus()
            return

        self._impl = puks_rag
        try:
            self.corpus = puks_rag.Corpus()
        except puks_rag.ConfigError as exc:
            self.error = str(exc)

    @property
    def ready(self) -> bool:
        return self.corpus is not None

    def answer(self, query: str, memory_text: str, top_k: int) -> dict:
        return self._impl.answer(self.corpus, query, memory_text=memory_text, top_k=top_k)

    def answer_stream(self, query: str, memory_text: str, top_k: int):
        return self._impl.answer_stream(self.corpus, query, memory_text=memory_text, top_k=top_k)

    def info(self) -> dict:
        """Index facts for /health. Never raises."""
        if not self.ready:
            return {"dimension": None, "ntotal": None, "model": None}
        if self.mock:
            return {"dimension": self.corpus.dimension,
                    "ntotal":    self.corpus.ntotal,
                    "model":     self.corpus.model}
        return {
            "dimension": self.corpus.index.d,
            "ntotal":    self.corpus.index.ntotal,
            "model":     self.corpus.config.get("model_name"),
        }
```

- [ ] **Step 4: Implement the app**

Create `api/main.py`:

```python
"""Puks AI HTTP surface.

Stateless by design: the client sends conversation history, the server formats
it with puks_rag.format_memory. That is what allows more than one replica
without a shared session store.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel, Field

import puks_rag
from api.engine import Engine

TOP_K_MIN = 3
TOP_K_MAX = 10


class Message(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[Message] = Field(default_factory=list)
    top_k:   int           = puks_rag.TOP_K_DEFAULT

    def clamped_top_k(self) -> int:
        """The Streamlit slider allowed 3-10; a raw client must not exceed it."""
        return max(TOP_K_MIN, min(TOP_K_MAX, self.top_k))

    def memory_text(self) -> str:
        return puks_rag.format_memory([m.model_dump() for m in self.history])


def create_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.engine = Engine()
        yield

    app = FastAPI(title="Puks AI", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict:
        engine = app.state.engine
        return {
            "ready":             engine.ready,
            "mock":              engine.mock,
            "error":             engine.error,
            "index":             engine.info(),
            "rerank_configured": bool(puks_rag.RERANK_ENDPOINT),
        }

    @app.get("/api/config")
    def config() -> dict:
        return {
            "chat_deployment":     puks_rag.CHAT_DEPLOYMENT,
            "embed_deployment":    puks_rag.EMBED_DEPLOYMENT,
            "rerank_model":        puks_rag.RERANK_MODEL,
            "top_k_default":       puks_rag.TOP_K_DEFAULT,
            "top_k_min":           TOP_K_MIN,
            "top_k_max":           TOP_K_MAX,
            "confidence_threshold": puks_rag.CONFIDENCE_THRESHOLD,
            "rerank_configured":   bool(puks_rag.RERANK_ENDPOINT),
            "mock":                app.state.engine.mock,
        }

    return app


app = create_app()
```

- [ ] **Step 5: Create `api/requirements.txt`**

```
# The API service. Installs the root requirements too — puks_rag needs
# faiss-cpu, rank-bm25, numpy, openai and requests.
-r ../requirements.txt

fastapi>=0.115.0
uvicorn[standard]>=0.30.0
pydantic>=2.7.0
```

- [ ] **Step 6: Run to verify it passes**

Run: `.venv/bin/pytest tests/test_api.py -v`
Expected: 4 passed

- [ ] **Step 7: Commit**

```bash
git add api/engine.py api/main.py api/requirements.txt tests/test_api.py
git commit -m "feat(api): FastAPI shell with /health and /api/config

Corpus loads once at startup and a ConfigError is captured rather than
raised — the committed index is 384-dim, so it raises today, and the UI
needs to explain that rather than meet a crash-looping container.

/api/config exists because the Streamlit sidebar read module constants
directly and a browser cannot. rerank_configured is surfaced because an
unset AZURE_RERANK_ENDPOINT makes every query refuse (spec section 10)."
```

---

## Task 7: `POST /api/answer` and `POST /api/chat`

**Files:**
- Modify: `api/main.py`, `tests/test_api.py`

**Interfaces:**
- Consumes: `Engine`, `ChatRequest` (Task 6)
- Produces: `POST /api/answer` → JSON `{answer, retrieved, confidence, intent, refused}`; `POST /api/chat` → `text/event-stream` per the spec §7 contract

- [ ] **Step 1: Write the failing test**

Append to `tests/test_api.py`:

```python
def parse_sse(text: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into (event, data) pairs."""
    import json
    events = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        event, data = None, None
        for line in block.splitlines():
            if line.startswith("event: "):
                event = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        events.append((event, data))
    return events


def test_answer_returns_the_engine_contract(client):
    body = client.post("/api/answer", json={"message": "how do I reverse a GRN?"}).json()
    assert body["refused"] is False
    assert "REE_DAT" in body["answer"]
    assert body["confidence"] == 0.87


def test_answer_refuses_unknown_questions(client):
    body = client.post("/api/answer", json={"message": "weather in Cape Town"}).json()
    assert body["refused"] is True


def test_chat_streams_retrieved_then_tokens_then_done(client):
    response = client.post("/api/chat", json={"message": "how do I reverse a GRN?"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    events = parse_sse(response.text)
    assert events[0][0] == "retrieved"
    assert events[-1][0] == "done"
    assert events[-1][1]["refused"] is False
    assert len(events[0][1]["chunks"]) == 2

    joined = "".join(data["text"] for name, data in events if name == "token")
    assert "REE_DAT" in joined


def test_chat_refusal_emits_no_token_events(client):
    events = parse_sse(client.post("/api/chat", json={"message": "weather"}).text)
    assert [name for name, _ in events] == ["retrieved", "done"]
    assert events[1][1]["reason"] == "below_threshold"


def test_chat_returns_503_when_the_engine_is_not_ready(broken_client):
    response = broken_client.post("/api/chat", json={"message": "anything"})
    assert response.status_code == 503
    assert "384-dim" in response.json()["detail"]


@pytest.mark.parametrize("sent,expected", [(99, 10), (1, 3), (7, 7), (3, 3), (10, 10)])
def test_clamped_top_k(sent, expected):
    """The Streamlit slider allowed 3-10. A raw HTTP client must not exceed it."""
    from api.main import ChatRequest
    assert ChatRequest(message="q", top_k=sent).clamped_top_k() == expected


def test_top_k_default_matches_the_engine(client):
    from api.main import ChatRequest
    import puks_rag
    assert ChatRequest(message="q").clamped_top_k() == puks_rag.TOP_K_DEFAULT


def test_chat_accepts_an_out_of_range_top_k_without_erroring(client):
    """Clamped, not rejected — a 422 here would be a worse experience than
    silently honouring the nearest legal value."""
    response = client.post("/api/chat", json={"message": "grn", "top_k": 99})
    assert response.status_code == 200
    assert parse_sse(response.text)[0][0] == "retrieved"


def test_history_is_formatted_into_the_prompt_memory(client, monkeypatch):
    """The server owns memory formatting; the client only sends raw history."""
    seen = {}
    from api import mock
    original = mock.answer_stream

    def spy(corpus, query, memory_text="(No prior conversation)", top_k=5):
        seen["memory_text"] = memory_text
        return original(corpus, query, memory_text=memory_text, top_k=top_k)

    monkeypatch.setattr(mock, "answer_stream", spy)
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)

    client.post("/api/chat", json={
        "message": "and then?",
        "history": [{"role": "user", "content": "q1"},
                    {"role": "assistant", "content": "a1"}],
    })
    assert seen["memory_text"] == "USER: q1\nASSISTANT: a1"


def test_error_mid_stream_is_delivered_as_an_event(client, monkeypatch):
    """A dead socket gives the UI nothing to show. An error event does."""
    from api import mock
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)

    def failing(corpus, query, memory_text="(No prior conversation)", top_k=5):
        yield "retrieved", {"chunks": [], "confidence": 0.9, "intent": {}}
        raise RuntimeError("upstream exploded")

    monkeypatch.setattr(mock, "answer_stream", failing)
    events = parse_sse(client.post("/api/chat", json={"message": "grn"}).text)
    assert [name for name, _ in events] == ["retrieved", "error"]
    assert "upstream exploded" in events[1][1]["message"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/pytest tests/test_api.py -v`
Expected: FAIL — 405 Method Not Allowed / 404 on the new routes

- [ ] **Step 3: Implement**

In `api/main.py`, add these imports at the top:

```python
import json
import time

from fastapi import HTTPException
from fastapi.responses import StreamingResponse
```

Then add this helper above `create_app()`:

```python
def sse(event: str, data: dict) -> str:
    """One server-sent event. Named events, JSON payloads, blank-line terminated."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
```

And add these two routes inside `create_app()`, before `return app`:

```python
    def _require_ready() -> None:
        engine = app.state.engine
        if not engine.ready:
            raise HTTPException(status_code=503, detail=engine.error or "Engine not ready")

    @app.post("/api/answer")
    def api_answer(request: ChatRequest) -> dict:
        _require_ready()
        return app.state.engine.answer(
            request.message,
            memory_text=request.memory_text(),
            top_k=request.clamped_top_k(),
        )

    @app.post("/api/chat")
    def api_chat(request: ChatRequest) -> StreamingResponse:
        _require_ready()
        engine  = app.state.engine
        started = time.perf_counter()

        def events():
            try:
                for name, payload in engine.answer_stream(
                    request.message,
                    memory_text=request.memory_text(),
                    top_k=request.clamped_top_k(),
                ):
                    if name == "done":
                        payload = {**payload,
                                   "elapsed_ms": round((time.perf_counter() - started) * 1000)}
                    yield sse(name, payload)
            except Exception as exc:  # noqa: BLE001 — a dead socket tells the UI nothing
                yield sse("error", {"message": str(exc)})

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "Cache-Control":     "no-cache",
                "Connection":        "keep-alive",
                "X-Accel-Buffering": "no",   # nginx / App Service must not buffer the stream
            },
        )
```

Note: `engine.answer` and `engine.answer_stream` in `api/engine.py` currently pass `memory_text` positionally. Change both to keyword arguments so these calls match:

```python
    def answer(self, query: str, memory_text: str, top_k: int) -> dict:
        return self._impl.answer(self.corpus, query, memory_text=memory_text, top_k=top_k)
```

(That is already how Task 6 wrote it — verify, do not duplicate.)

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/pytest tests/ -v`
Expected: 45 passed (the `clamped_top_k` parametrize contributes 5)

- [ ] **Step 5: Smoke-test the real server**

```bash
PUKS_MOCK=1 .venv/bin/python -m uvicorn api.main:app --port 8000 &
sleep 3
curl -s localhost:8000/health | head -c 200; echo
curl -sN -X POST localhost:8000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"how do I reverse a GRN?"}' | head -20
kill %1
```

Expected: `"ready": true`, then `event: retrieved`, then `event: token` lines arriving progressively.

- [ ] **Step 6: Commit**

```bash
git add api/main.py tests/test_api.py
git commit -m "feat(api): POST /api/chat (SSE) and POST /api/answer (JSON)

top_k is clamped server-side to the 3-10 range the Streamlit slider
enforced. Mid-stream failures are delivered as an error event rather than
a dead socket. X-Accel-Buffering: no keeps proxies from buffering."
```

---

## Task 8: Next.js scaffold, wire types, and the SSE parser

**Files:**
- Create: `web/` (scaffold), `web/lib/types.ts`, `web/lib/sse.ts`, `web/lib/sse.test.ts`, `web/vitest.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: the SSE contract from Task 7
- Produces: `parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<ServerEvent>`; types `Chunk`, `ServerEvent`, `RetrievedPayload`, `DonePayload`, `ChatMessage`, `AppConfig`

- [ ] **Step 1: Scaffold**

```bash
cd ~/Developer/puks-ai
pnpm create next-app@latest web \
  --typescript --tailwind --app --eslint --no-src-dir --import-alias "@/*"
cd web
pnpm add react-markdown remark-gfm
pnpm add -D vitest @tailwindcss/typography
mkdir -p public   # the Dockerfile in Task 16 copies it; newer scaffolds may omit it
```

The `prose` classes in Task 12 come from the typography plugin. Tailwind v4 loads
plugins from CSS, so add this line to `web/app/globals.css` directly under the
existing `@import "tailwindcss";`:

```css
@plugin "@tailwindcss/typography";
```

If the scaffold produced Tailwind v3 instead (a `tailwind.config.ts` with a
`plugins` array), add `require("@tailwindcss/typography")` to that array and skip
the CSS line.

- [ ] **Step 2: Extend `.gitignore`**

Append:

```
# Next.js
web/node_modules/
web/.next/
web/out/
web/.env.local
```

- [ ] **Step 3: Write the types**

Create `web/lib/types.ts`:

```typescript
/** Mirrors puks_rag.WIRE_FIELDS. `structured_data` is deliberately absent. */
export interface Chunk {
  index: number;
  fusion_score: number;
  in_dense: boolean;
  in_bm25: boolean;
  in_exact: boolean;
  doc_type: string;
  relevance_score: number;
  metadata: Record<string, unknown>;
  text: string;
}

export interface Intent {
  is_schema: boolean;
  is_operational: boolean;
  is_sql: boolean;
  schema_hits: string[];
  operational_hits: string[];
}

export interface RetrievedPayload {
  chunks: Chunk[];
  confidence: number;
  intent: Intent;
}

export interface DonePayload {
  refused: boolean;
  reason?: string;
  confidence?: number;
  threshold?: number;
  model?: string;
  elapsed_ms?: number;
}

export type ServerEvent =
  | { event: "retrieved"; data: RetrievedPayload }
  | { event: "token"; data: { text: string } }
  | { event: "done"; data: DonePayload }
  | { event: "error"; data: { message: string } };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Refused assistant turns are displayed but excluded from prompt history.
   *  Streamlit appended to messages unconditionally but only called
   *  memory.add_turn() on the non-refused branch. */
  refused?: boolean;
  retrieved?: RetrievedPayload;
  done?: DonePayload;
}

export interface AppConfig {
  chat_deployment: string;
  embed_deployment: string;
  rerank_model: string;
  top_k_default: number;
  top_k_min: number;
  top_k_max: number;
  confidence_threshold: number;
  rerank_configured: boolean;
  mock: boolean;
}

/** Lives here, not in lib/server.ts: client components need the type, and
 *  lib/server.ts is `import "server-only"`. A value import of it from a client
 *  component is a build error, and only `import type` erasure hides that. */
export interface Health {
  ready: boolean;
  mock: boolean;
  error: string | null;
  index: { dimension: number | null; ntotal: number | null; model: string | null };
  rerank_configured: boolean;
}
```

- [ ] **Step 4: Write the failing test**

Create `web/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
```

Add to `web/package.json` scripts: `"test": "vitest run"`.

Create `web/lib/sse.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseSSE } from "./sse";

function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const event of parseSSE(stream)) out.push(event);
  return out;
}

describe("parseSSE", () => {
  it("parses a complete event", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"hi"}\n\n'));
    expect(events).toEqual([{ event: "token", data: { text: "hi" } }]);
  });

  it("parses several events in one chunk", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"text":"a"}\n\nevent: token\ndata: {"text":"b"}\n\n'),
    );
    expect(events.map((e) => e.data)).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("reassembles an event split across network chunks", async () => {
    const events = await collect(streamOf('event: tok', 'en\ndata: {"te', 'xt":"split"}\n\n'));
    expect(events).toEqual([{ event: "token", data: { text: "split" } }]);
  });

  it("handles a payload containing blank lines", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"a\\n\\nb"}\n\n'));
    expect(events[0].data).toEqual({ text: "a\n\nb" });
  });

  it("ignores a trailing partial event", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"ok"}\n\nevent: tok'));
    expect(events).toHaveLength(1);
  });

  it("preserves event order across types", async () => {
    const events = await collect(
      streamOf(
        'event: retrieved\ndata: {"chunks":[],"confidence":0.9,"intent":{}}\n\n',
        'event: token\ndata: {"text":"x"}\n\n',
        'event: done\ndata: {"refused":false}\n\n',
      ),
    );
    expect(events.map((e) => e.event)).toEqual(["retrieved", "token", "done"]);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL — cannot resolve `./sse`

- [ ] **Step 6: Implement**

Create `web/lib/sse.ts`:

```typescript
import type { ServerEvent } from "./types";

/**
 * Parse an SSE body into typed events.
 *
 * EventSource cannot POST, so the stream is read by hand. Events are separated
 * by a blank line; a network chunk can split one anywhere, so a buffer carries
 * the remainder between reads.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let name: string | null = null;
        let payload: string | null = null;

        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) name = line.slice(7);
          else if (line.startsWith("data: ")) payload = line.slice(6);
        }

        if (name && payload !== null) {
          yield { event: name, data: JSON.parse(payload) } as ServerEvent;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd web && pnpm test`
Expected: 6 passed

- [ ] **Step 8: Commit**

```bash
git add web/ .gitignore
git commit -m "feat(web): Next.js scaffold, wire types, SSE parser

EventSource cannot POST, so the stream is parsed by hand with a buffer
that carries partial events across network chunk boundaries."
```

---

## Task 9: History rules — the refusal parity trap

**Files:**
- Create: `web/lib/history.ts`, `web/lib/history.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (Task 8)
- Produces: `promptHistory(messages: ChatMessage[]): {role, content}[]`, `clampTopK(value: number, config: AppConfig): number`

This is the single subtlest behaviour in the port. Give it its own task and its own tests.

- [ ] **Step 1: Write the failing test**

Create `web/lib/history.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { clampTopK, promptHistory } from "./history";
import type { AppConfig, ChatMessage } from "./types";

const config = { top_k_min: 3, top_k_max: 10, top_k_default: 5 } as AppConfig;

const user = (content: string): ChatMessage => ({ role: "user", content });
const bot = (content: string, refused = false): ChatMessage => ({
  role: "assistant",
  content,
  refused,
});

describe("promptHistory", () => {
  it("keeps ordinary turns", () => {
    expect(promptHistory([user("q1"), bot("a1")])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("drops a refused assistant turn AND the user turn that provoked it", () => {
    // Streamlit appended both to `messages` for display, but never called
    // memory.add_turn(), so neither reached the prompt.
    const history = promptHistory([
      user("q1"), bot("a1"),
      user("nonsense"), bot("I do not have enough information...", true),
      user("q2"), bot("a2"),
    ]);
    expect(history).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
    expect(JSON.stringify(history)).not.toContain("nonsense");
  });

  it("drops the greeting, which has no user turn", () => {
    expect(promptHistory([bot("Welcome. I am Puks."), user("q"), bot("a")])).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
    ]);
  });

  it("drops a trailing user turn that has no answer yet", () => {
    expect(promptHistory([user("q1"), bot("a1"), user("pending")])).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
    ]);
  });

  it("returns empty for a fresh conversation", () => {
    expect(promptHistory([bot("Welcome.")])).toEqual([]);
  });

  it("strips the display-only fields", () => {
    const [turn] = promptHistory([
      user("q"),
      { role: "assistant", content: "a", retrieved: { chunks: [], confidence: 1, intent: {} as never } },
    ]);
    expect(Object.keys(turn)).toEqual(["role", "content"]);
  });
});

describe("clampTopK", () => {
  it("passes values in range", () => expect(clampTopK(7, config)).toBe(7));
  it("raises below-range values", () => expect(clampTopK(1, config)).toBe(3));
  it("lowers above-range values", () => expect(clampTopK(99, config)).toBe(10));
  it("falls back to the default for NaN", () => expect(clampTopK(NaN, config)).toBe(5));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && pnpm test`
Expected: FAIL — cannot resolve `./history`

- [ ] **Step 3: Implement**

Create `web/lib/history.ts`:

```typescript
import type { AppConfig, ChatMessage } from "./types";

/**
 * The messages the server should fold into the prompt.
 *
 * PARITY TRAP. In APPLICATION(STREAMLIT)/APP.py the assistant reply was pushed
 * onto st.session_state.messages unconditionally, but memory.add_turn() sat
 * inside the `else` of `if result["refused"]`. Refused turns were therefore
 * visible in the transcript and invisible to the prompt.
 *
 * Reproduced here by walking complete user/assistant pairs and skipping any
 * pair whose answer was refused. Drop this and every refusal starts poisoning
 * later prompts with "I do not have enough information to answer this."
 */
export function promptHistory(messages: ChatMessage[]): { role: string; content: string }[] {
  const history: { role: string; content: string }[] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const question = messages[i];
    const reply = messages[i + 1];

    if (question.role !== "user" || reply.role !== "assistant") continue;
    i++; // consume the pair

    if (reply.refused) continue;

    history.push({ role: "user", content: question.content });
    history.push({ role: "assistant", content: reply.content });
  }

  return history;
}

/** Mirrors the server-side clamp; keeps the slider honest before the round trip. */
export function clampTopK(value: number, config: AppConfig): number {
  if (Number.isNaN(value)) return config.top_k_default;
  return Math.max(config.top_k_min, Math.min(config.top_k_max, value));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && pnpm test`
Expected: 16 passed

- [ ] **Step 5: Commit**

```bash
git add web/lib/history.ts web/lib/history.test.ts
git commit -m "feat(web): promptHistory() reproduces Streamlit's refusal rule

Refused turns were displayed but never entered prompt memory. Without
this, every refusal poisons later prompts."
```

---

## Task 10: The SSE proxy route

**Files:**
- Create: `web/app/api/chat/route.ts`, `web/app/api/config/route.ts`, `web/lib/server.ts`, `web/.env.local.example`

**Interfaces:**
- Consumes: FastAPI `/api/chat`, `/api/config`, `/health`
- Produces: `POST /api/chat` (SSE passthrough), `GET /api/config`; `web/lib/server.ts` exports `FASTAPI_URL`, `getConfig()`, `getHealth()`

- [ ] **Step 1: Create the server helper**

Create `web/lib/server.ts`:

```typescript
import "server-only";
import type { AppConfig, Health } from "./types";

/** Server-only. Never imported from a client component — the URL, and any
 *  credential added to it later, must not reach the browser. The Health type
 *  itself lives in ./types so client components can name it. */
export const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";

export type { Health };

export async function getHealth(): Promise<Health> {
  try {
    const response = await fetch(`${FASTAPI_URL}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`health returned ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      ready: false,
      mock: false,
      error: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}`,
      index: { dimension: null, ntotal: null, model: null },
      rerank_configured: false,
    };
  }
}

export async function getConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch(`${FASTAPI_URL}/api/config`, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}
```

Create `web/.env.local.example`:

```
# The FastAPI service. Server-side only — never exposed to the browser.
FASTAPI_URL=http://127.0.0.1:8000
```

- [ ] **Step 2: Create the chat proxy**

Create `web/app/api/chat/route.ts`:

```typescript
import { FASTAPI_URL } from "@/lib/server";

/** Node runtime: the stream is passed through untouched and must not be
 *  buffered or transformed by the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // @ts-expect-error — Node fetch needs this to stream a request body
      duplex: "half",
    });
  } catch (error) {
    return Response.json(
      { detail: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return Response.json({ detail: detail || upstream.statusText }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
```

Create `web/app/api/config/route.ts`:

```typescript
import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getConfig();
  if (!config) return Response.json({ detail: "API unavailable" }, { status: 502 });
  return Response.json(config);
}
```

- [ ] **Step 3: Verify the proxy streams**

```bash
cd ~/Developer/puks-ai
PUKS_MOCK=1 .venv/bin/python -m uvicorn api.main:app --port 8000 &
(cd web && pnpm dev --port 3000 &)
sleep 8
curl -sN -X POST localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"how do I reverse a GRN?"}' | head -8
curl -s localhost:3000/api/config
kill %1 %2 2>/dev/null; pkill -f "next dev" 2>/dev/null
```

Expected: `event: retrieved` first, then `event: token` lines appearing progressively (not all at once), and a JSON config body.

- [ ] **Step 4: Commit**

```bash
git add web/app/api web/lib/server.ts web/.env.local.example
git commit -m "feat(web): server-side SSE proxy to FastAPI

FASTAPI_URL stays out of the browser bundle via server-only. Node runtime
with no-transform so nothing buffers the stream."
```

---

## Task 11: Sidebar, not-ready banner, and the page shell

**Files:**
- Create: `web/components/Sidebar.tsx`, `web/components/NotReadyBanner.tsx`, `web/app/page.tsx`, `web/components/ChatView.tsx`
- Modify: `web/app/layout.tsx`

**Interfaces:**
- Consumes: `getHealth`, `getConfig` (Task 10), `AppConfig` (Task 8), `clampTopK` (Task 9)
- Produces: `<Sidebar config topK onTopK debug onDebug onReset health />`, `<NotReadyBanner health />`, `<ChatView config health />` (client component owning message state)

Before writing the UI, invoke the `frontend-design` skill for aesthetic direction. The Streamlit original was emoji-prefixed default-theme Streamlit; do not reproduce that literally.

- [ ] **Step 1: Write the not-ready banner**

Create `web/components/NotReadyBanner.tsx`:

```tsx
import type { Health } from "@/lib/types";

/** Replaces Streamlit's st.error(...) + st.stop() on ConfigError.
 *  The committed index is 384-dim against a 3072-dim requirement, so this
 *  is the state the app is actually in until build_index.py is run. */
export function NotReadyBanner({ health }: { health: Health }) {
  if (health.ready) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 p-5">
      <h2 className="font-semibold text-red-300">Not ready to answer questions</h2>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm text-red-200/90">
        {health.error}
      </pre>
      <p className="mt-3 text-sm text-red-200/70">
        Set <code>AZURE_AI_KEY</code> in <code>.env</code>, then run{" "}
        <code>python SCRIPTS/build_index.py</code>.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Write the sidebar**

Create `web/components/Sidebar.tsx`:

```tsx
"use client";

import type { AppConfig, Health } from "@/lib/types";
import { clampTopK } from "@/lib/history";

interface Props {
  config: AppConfig | null;
  health: Health;
  topK: number;
  onTopK: (value: number) => void;
  debug: boolean;
  onDebug: (value: boolean) => void;
  onReset: () => void;
}

export function Sidebar({ config, health, topK, onTopK, debug, onDebug, onReset }: Props) {
  return (
    <aside className="flex w-72 shrink-0 flex-col gap-6 border-r border-white/10 p-6">
      <div>
        <h1 className="text-lg font-semibold">Puks AI</h1>
        <p className="text-sm text-white/50">Enterprise Speed WMS Intelligence</p>
      </div>

      <nav className="flex flex-col gap-1 text-sm">
        <a href="/" className="rounded px-2 py-1 hover:bg-white/5">Chatbot</a>
        <a href="/about" className="rounded px-2 py-1 hover:bg-white/5">About</a>
      </nav>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide text-white/40">Retrieval</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span>Chunks passed to the model: {topK}</span>
          <input
            type="range"
            min={config?.top_k_min ?? 3}
            max={config?.top_k_max ?? 10}
            value={topK}
            onChange={(e) => onTopK(config ? clampTopK(Number(e.target.value), config) : Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={debug} onChange={(e) => onDebug(e.target.checked)} />
          Show retrieved context
        </label>
      </section>

      {config && (
        <section className="flex flex-col gap-1 text-xs text-white/50">
          <p>Generation <code className="text-white/80">{config.chat_deployment}</code></p>
          <p>Embeddings <code className="text-white/80">{config.embed_deployment}</code></p>
          <p>Reranker <code className="text-white/80">{config.rerank_model}</code></p>
          {config.mock && <p className="text-amber-400">Mock mode — fixtures, not the model</p>}
        </section>
      )}

      {config && !config.rerank_configured && !config.mock && (
        <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <strong>AZURE_RERANK_ENDPOINT is not set.</strong> Rerank scores fall back to 0.0, and
          confidence is read from that same field — so every query will be refused.
        </p>
      )}

      <button
        onClick={onReset}
        className="mt-auto rounded border border-white/15 px-3 py-2 text-sm hover:bg-white/5"
      >
        Reset conversation memory
      </button>
      <p className="text-xs text-white/30">© Puks AI (Predictive Unified Knowledge System)</p>
    </aside>
  );
}
```

- [ ] **Step 3: Write the page shell**

Create `web/app/page.tsx`:

```tsx
import { ChatView } from "@/components/ChatView";
import { getConfig, getHealth } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [health, config] = await Promise.all([getHealth(), getConfig()]);
  return <ChatView health={health} config={config} />;
}
```

Create `web/components/ChatView.tsx` with the state that Tasks 12–13 fill in:

```tsx
"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { NotReadyBanner } from "./NotReadyBanner";
import type { AppConfig, ChatMessage, Health } from "@/lib/types";

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Welcome. I am Puks — your Speed WMS Retrieval-Augmented Intelligence System. How can I help you today?",
};

const RESET_NOTICE: ChatMessage = {
  role: "assistant",
  content: "Memory has been reset. You can start a new conversation now.",
};

export function ChatView({ health, config }: { health: Health; config: AppConfig | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [topK, setTopK] = useState(config?.top_k_default ?? 5);
  const [debug, setDebug] = useState(false);

  return (
    <div className="flex h-dvh">
      <Sidebar
        config={config}
        health={health}
        topK={topK}
        onTopK={setTopK}
        debug={debug}
        onDebug={setDebug}
        onReset={() => setMessages([RESET_NOTICE])}
      />
      <main className="flex min-w-0 flex-1 flex-col p-6">
        <NotReadyBanner health={health} />
        {health.ready && (
          <p className="text-sm text-white/40">
            {messages.length} message(s) — chat panel arrives in Task 12
          </p>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Verify both states render**

```bash
PUKS_MOCK=1 .venv/bin/python -m uvicorn api.main:app --port 8000 &
(cd web && pnpm dev --port 3000 &)
sleep 8
curl -s localhost:3000 | grep -c "Speed WMS Intelligence"   # expect 1
kill %1 2>/dev/null; pkill -f "next dev" 2>/dev/null

# Now with no API running at all — the banner must render, not a crash
(cd web && pnpm dev --port 3000 &)
sleep 8
curl -s localhost:3000 | grep -c "Not ready to answer questions"  # expect 1
pkill -f "next dev" 2>/dev/null
```

- [ ] **Step 5: Commit**

```bash
git add web/components web/app/page.tsx
git commit -m "feat(web): sidebar, not-ready banner, page shell

The banner replaces st.error + st.stop and is the state the app is in
today. The sidebar warns when rerank is unconfigured, because that makes
every query refuse."
```

---

## Task 12: Chat panel, composer, and streaming

**Files:**
- Create: `web/components/Composer.tsx`, `web/components/Markdown.tsx`, `web/lib/chat.ts`
- Modify: `web/components/ChatView.tsx`

**Interfaces:**
- Consumes: `parseSSE` (Task 8), `promptHistory` (Task 9), `POST /api/chat` (Task 10)
- Produces: `sendMessage(args) => Promise<void>` in `web/lib/chat.ts`

- [ ] **Step 1: Write the send helper**

Create `web/lib/chat.ts`:

```typescript
import { parseSSE } from "./sse";
import { promptHistory } from "./history";
import type { ChatMessage, DonePayload, RetrievedPayload } from "./types";

export interface SendArgs {
  message: string;
  messages: ChatMessage[];
  topK: number;
  onRetrieved: (payload: RetrievedPayload) => void;
  onToken: (text: string) => void;
  onDone: (payload: DonePayload) => void;
  onError: (message: string) => void;
}

export async function sendMessage(args: SendArgs): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: args.message,
        history: promptHistory(args.messages),
        top_k: args.topK,
      }),
    });
  } catch (error) {
    args.onError((error as Error).message);
    return;
  }

  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    args.onError(body.detail ?? response.statusText);
    return;
  }

  for await (const event of parseSSE(response.body)) {
    if (event.event === "retrieved") args.onRetrieved(event.data);
    else if (event.event === "token") args.onToken(event.data.text);
    else if (event.event === "done") args.onDone(event.data);
    else if (event.event === "error") args.onError(event.data.message);
  }
}
```

- [ ] **Step 2: Write the markdown renderer**

Create `web/components/Markdown.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The corpus is largely SQL procedures and schema tables, so GFM tables and
 *  fenced code are not optional. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-invert max-w-none prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 3: Write the composer**

Create `web/components/Composer.tsx`:

```tsx
"use client";

import { useState } from "react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  }

  return (
    <div className="flex gap-2 border-t border-white/10 pt-4">
      <textarea
        rows={1}
        value={value}
        disabled={disabled}
        placeholder="Ask anything about Speed WMS..."
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-11 flex-1 resize-none rounded-lg border border-white/15 bg-transparent px-3 py-2 disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="rounded-lg border border-white/15 px-4 disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Wire streaming into `ChatView`**

Replace the `<main>` block in `web/components/ChatView.tsx` and add the handler. Add these imports:

```tsx
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { sendMessage } from "@/lib/chat";
```

Add `const [streaming, setStreaming] = useState(false);` beside the other state, then:

```tsx
  async function handleSend(text: string) {
    const outgoing: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setStreaming(true);

    const update = (patch: Partial<ChatMessage>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    await sendMessage({
      message: text,
      messages,
      topK,
      onRetrieved: (retrieved) => update({ retrieved }),
      onToken: (token) =>
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + token };
          return next;
        }),
      onDone: (done) => {
        // Refusal short-circuits before any token, so the bubble is still empty.
        update({ done, refused: done.refused, ...(done.refused ? { content: REFUSAL_TEXT } : {}) });
        setStreaming(false);
      },
      onError: (message) => {
        update({ content: `**Request failed.**\n\n\`\`\`\n${message}\n\`\`\``, refused: true });
        setStreaming(false);
      },
    });
  }
```

Add the refusal constant at the top of the file, beside `GREETING`:

```tsx
const REFUSAL_TEXT =
  "I do not have enough information to answer this. Please contact support.";
```

Replace the `<main>` contents with:

```tsx
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">
        <NotReadyBanner health={health} />
        {health.ready && (
          <>
            <div className="flex-1 space-y-6 overflow-y-auto pr-2">
              {messages.map((message, i) => (
                <article key={i} className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-white/35">
                    {message.role === "user" ? "You" : "Puks"}
                  </p>
                  {message.content ? (
                    <Markdown>{message.content}</Markdown>
                  ) : (
                    streaming && i === messages.length - 1 && (
                      <p className="animate-pulse text-sm text-white/40">
                        {message.retrieved ? "Generating…" : "Searching documentation…"}
                      </p>
                    )
                  )}
                  {message.done && (
                    <p className="text-xs text-white/35">
                      {message.done.refused
                        ? `Refused — top relevance ${message.done.confidence?.toFixed(3)} is below the ${message.done.threshold?.toFixed(2)} threshold.`
                        : `Top relevance: ${message.retrieved?.confidence.toFixed(3)} · ${message.done.model}`}
                    </p>
                  )}
                </article>
              ))}
            </div>
            <Composer disabled={streaming} onSend={handleSend} />
          </>
        )}
      </main>
```

- [ ] **Step 5: Verify streaming in a browser**

```bash
PUKS_MOCK=1 .venv/bin/python -m uvicorn api.main:app --port 8000 &
(cd web && pnpm dev --port 3000 &)
```

Open `http://localhost:3000`, ask "how do I reverse a GRN?". Confirm: "Searching documentation…" appears, then the text streams in word by word, then the relevance caption. Ask "what is the weather" and confirm the refusal caption with the 0.30 threshold.

- [ ] **Step 6: Commit**

```bash
git add web/lib/chat.ts web/components/Composer.tsx web/components/Markdown.tsx web/components/ChatView.tsx
git commit -m "feat(web): streaming chat panel and composer

The bubble shows 'Searching documentation' until the retrieved event
lands, then 'Generating' while gpt-5 reasons before its first token."
```

---

## Task 13: Retrieval panel

**Files:**
- Create: `web/components/RetrievalPanel.tsx`
- Modify: `web/components/ChatView.tsx`

**Interfaces:**
- Consumes: `RetrievedPayload`, `Chunk` (Task 8)
- Produces: `<RetrievalPanel retrieved={payload} />`

- [ ] **Step 1: Write the component**

Create `web/components/RetrievalPanel.tsx`:

```tsx
"use client";

import type { Chunk, RetrievedPayload } from "@/lib/types";

function provenance(chunk: Chunk): string[] {
  const found = [
    chunk.in_dense && "dense",
    chunk.in_bm25 && "bm25",
    chunk.in_exact && "exact",
  ].filter(Boolean) as string[];
  return found.length ? found : ["fusion"];
}

export function RetrievalPanel({ retrieved }: { retrieved: RetrievedPayload }) {
  if (!retrieved.chunks.length) return null;

  return (
    <details className="rounded-lg border border-white/10 bg-white/[0.02]">
      <summary className="cursor-pointer px-4 py-2 text-sm text-white/70">
        Retrieved context — {retrieved.chunks.length} chunks, top relevance{" "}
        {retrieved.confidence.toFixed(3)}
      </summary>

      <div className="space-y-5 px-4 pb-4">
        {retrieved.chunks.map((chunk, rank) => (
          <section key={chunk.index} className="space-y-2 border-t border-white/10 pt-4">
            <header className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">Rank {rank + 1}</span>
              <span className="text-white/40">found by</span>
              {provenance(chunk).map((source) => (
                <code key={source} className="rounded bg-white/10 px-1.5 py-0.5 text-xs">
                  {source}
                </code>
              ))}
            </header>

            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-white/40">Cohere relevance</dt>
                <dd>{chunk.relevance_score.toFixed(3)}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Fusion score</dt>
                <dd>{chunk.fusion_score.toFixed(4)}</dd>
              </div>
              <div>
                <dt className="text-xs text-white/40">Doc type</dt>
                <dd className="truncate">{chunk.doc_type}</dd>
              </div>
            </dl>

            <details>
              <summary className="cursor-pointer text-xs text-white/50">Metadata</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-black/40 p-3 text-xs">
                {JSON.stringify(chunk.metadata, null, 2)}
              </pre>
            </details>

            <details>
              <summary className="cursor-pointer text-xs text-white/50">
                Text ({chunk.text.length} chars)
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-xs text-white/70">{chunk.text}</p>
            </details>
          </section>
        ))}
      </div>
    </details>
  );
}
```

- [ ] **Step 2: Wire it in**

In `web/components/ChatView.tsx`, import it and render it inside the message `<article>`, immediately before the `{message.done && ...}` caption:

```tsx
                  {debug && message.retrieved && <RetrievalPanel retrieved={message.retrieved} />}
```

- [ ] **Step 3: Verify**

With both services running, tick "Show retrieved context" and ask "how do I reverse a GRN?". Confirm two ranked chunks, `dense`/`bm25`/`exact` chips on rank 1, relevance `0.870`, fusion `0.0163`, expandable metadata JSON and full text. Untick and confirm the panel disappears.

- [ ] **Step 4: Commit**

```bash
git add web/components/RetrievalPanel.tsx web/components/ChatView.tsx
git commit -m "feat(web): retrieval debug panel

Replaces the Streamlit expander: rank, provenance chips, Cohere
relevance, fusion score, doc type, metadata JSON, full chunk text."
```

---

## Task 14: About page

**Files:**
- Create: `web/app/about/page.tsx`

**Interfaces:**
- Consumes: `getConfig` (Task 10)
- Produces: route `/about`

- [ ] **Step 1: Write the page**

Create `web/app/about/page.tsx`:

```tsx
import { getConfig } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function About() {
  const config = await getConfig();

  const pipeline = [
    ["Dense retrieval", config?.embed_deployment ?? "text-embedding-3-large", "over the full corpus"],
    ["Lexical retrieval", "BM25", "over the full corpus, independently"],
    ["Fusion", "Reciprocal Rank Fusion", "—"],
    ["Reranking", config?.rerank_model ?? "Cohere-rerank-v4.0-pro", "—"],
    ["Generation", config?.chat_deployment ?? "gpt-5", "—"],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-10">
      <div>
        <a href="/" className="text-sm text-white/50 hover:text-white">← Back to chat</a>
        <h1 className="mt-4 text-2xl font-semibold">About Puks AI</h1>
      </div>

      <p className="text-white/70">
        <strong>Puks AI</strong> — Predictive Unified Knowledge System — answers Speed WMS support
        questions from AGL&apos;s warehouse documentation. It answers only from documents it
        retrieves, and refuses rather than guessing.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-white/40">Pipeline</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-white/50">
                <th className="py-2 pr-4 font-medium">Stage</th>
                <th className="py-2 pr-4 font-medium">Model</th>
                <th className="py-2 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map(([stage, model, scope]) => (
                <tr key={stage} className="border-b border-white/5">
                  <td className="py-2 pr-4">{stage}</td>
                  <td className="py-2 pr-4"><code className="text-white/80">{model}</code></td>
                  <td className="py-2 text-white/50">{scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-white/70">
        Everything runs on AGL&apos;s own Azure Foundry resource. No request leaves the tenant.
      </p>

      <p className="text-white/70">
        <strong>It cannot</strong> query live warehouse data, answer outside the knowledge base, or
        change any system. It is read-only by design.
      </p>

      <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-4 text-sm text-sky-100">
        Found a wrong or missing answer? Raise it with the Speed WMS support team — resolved
        tickets are the highest-value source for improving this knowledge base.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Visit `http://localhost:3000/about`. Confirm the five pipeline rows show the deployment names served by `/api/config`, not hardcoded strings.

- [ ] **Step 3: Commit**

```bash
git add web/app/about/page.tsx
git commit -m "feat(web): about page

Model names come from /api/config, so changing an env var changes what
the page says."
```

---

## Task 15: Playwright end-to-end against mock mode

**Files:**
- Create: `web/playwright.config.ts`, `web/e2e/chat.spec.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: the whole stack in `PUKS_MOCK=1`
- Produces: `pnpm e2e`

- [ ] **Step 1: Install**

```bash
cd ~/Developer/puks-ai/web
pnpm add -D @playwright/test
pnpm exec playwright install chromium
```

- [ ] **Step 2: Configure**

Create `web/playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://127.0.0.1:3000" },
  webServer: [
    {
      command: "cd .. && PUKS_MOCK=1 .venv/bin/python -m uvicorn api.main:app --port 8000",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm dev --port 3000",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: !process.env.CI,
      env: { FASTAPI_URL: "http://127.0.0.1:8000" },
    },
  ],
});
```

Add to `web/package.json` scripts: `"e2e": "playwright test"`.

- [ ] **Step 3: Write the tests**

Create `web/e2e/chat.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("answers a known question and streams the reply", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Enterprise Speed WMS Intelligence")).toBeVisible();

  await page.getByPlaceholder("Ask anything about Speed WMS...").fill("how do I reverse a GRN?");
  await page.keyboard.press("Enter");

  await expect(page.getByText("Searching documentation…")).toBeVisible();
  await expect(page.getByText("REE_DAT").first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Top relevance: 0\.870/)).toBeVisible();
});

test("refuses an out-of-corpus question with the threshold caption", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Ask anything about Speed WMS...").fill("what is the weather");
  await page.keyboard.press("Enter");

  await expect(page.getByText(/I do not have enough information/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/below the 0\.30 threshold/)).toBeVisible();
});

test("retrieval panel shows provenance and scores when enabled", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Show retrieved context").check();
  await page.getByPlaceholder("Ask anything about Speed WMS...").fill("how do I reverse a GRN?");
  await page.keyboard.press("Enter");

  const panel = page.getByText(/Retrieved context — 2 chunks/);
  await expect(panel).toBeVisible({ timeout: 15000 });
  await panel.click();

  await expect(page.getByText("Rank 1")).toBeVisible();
  await expect(page.getByText("dense", { exact: true })).toBeVisible();
  await expect(page.getByText("bm25", { exact: true })).toBeVisible();
  await expect(page.getByText("0.0163")).toBeVisible();
});

test("reset clears the transcript", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Ask anything about Speed WMS...").fill("how do I reverse a GRN?");
  await page.keyboard.press("Enter");
  await expect(page.getByText("REE_DAT").first()).toBeVisible({ timeout: 15000 });

  await page.getByRole("button", { name: "Reset conversation memory" }).click();
  await expect(page.getByText("Memory has been reset")).toBeVisible();
  await expect(page.getByText("REE_DAT")).toHaveCount(0);
});

test("about page reads its model names from the API", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "About Puks AI" })).toBeVisible();
  await expect(page.getByText("Reciprocal Rank Fusion")).toBeVisible();
});
```

- [ ] **Step 4: Run**

Run: `cd web && pnpm e2e`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add web/playwright.config.ts web/e2e web/package.json
git commit -m "test(web): playwright end-to-end against PUKS_MOCK=1

Covers answer, refusal, retrieval panel, reset and about with no Azure
access, which is the only way any of this is verifiable here."
```

---

## Task 16: Containers and CI

**Files:**
- Create: `api/Dockerfile`, `web/Dockerfile`, `docker-compose.yml`
- Modify: `.github/workflows/ci-cd.yml`, `.dockerignore`

**Interfaces:**
- Consumes: `api/requirements.txt` (Task 6), `web/` (Task 8)
- Produces: `docker compose up` serving the app on :3000

- [ ] **Step 1: Write `api/Dockerfile`**

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./requirements.txt
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

COPY puks_rag.py ./puks_rag.py
COPY api/ ./api/
COPY DATA/vector_store/ ./DATA/vector_store/

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write `web/Dockerfile`**

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

Add `output: "standalone"` to `web/next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = { output: "standalone" };

export default nextConfig;
```

- [ ] **Step 3: Write `docker-compose.yml`**

```yaml
services:
  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    environment:
      PUKS_MOCK: "${PUKS_MOCK:-}"
      AZURE_AI_KEY: "${AZURE_AI_KEY:-}"
      AZURE_AI_ENDPOINT: "${AZURE_AI_ENDPOINT:-}"
      AZURE_CHAT_DEPLOYMENT: "${AZURE_CHAT_DEPLOYMENT:-gpt-5}"
      AZURE_EMBED_DEPLOYMENT: "${AZURE_EMBED_DEPLOYMENT:-text-embedding-3-large}"
      AZURE_EMBED_DIMENSIONS: "${AZURE_EMBED_DIMENSIONS:-3072}"
      AZURE_RERANK_ENDPOINT: "${AZURE_RERANK_ENDPOINT:-}"
      AZURE_RERANK_MODEL: "${AZURE_RERANK_MODEL:-Cohere-rerank-v4.0-pro}"
      PUKS_CONFIDENCE_THRESHOLD: "${PUKS_CONFIDENCE_THRESHOLD:-0.30}"
    ports:
      - "8000:8000"

  web:
    build:
      context: ./web
    environment:
      FASTAPI_URL: http://api:8000
    ports:
      - "3000:3000"
    depends_on:
      - api
```

- [ ] **Step 4: Update `.dockerignore`**

The current file excludes `SCRIPTS/` and `docs/`, which is still right. Append:

```
# Next.js build artifacts — the web image builds from web/ with its own context
web/node_modules
web/.next
```

- [ ] **Step 5: Add the web CI job**

In `.github/workflows/ci-cd.yml`, add this job after `test:`. Leave the existing `lint`, `test`, `build`, `deploy-staging` and `deploy-production` jobs alone.

```yaml
  web:
    name: Lint, test and build the front end
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
          cache-dependency-path: web/pnpm-lock.yaml

      - name: Install
        working-directory: web
        run: pnpm install --frozen-lockfile

      - name: Lint
        working-directory: web
        run: pnpm lint

      - name: Unit tests
        working-directory: web
        run: pnpm test

      - name: Build
        working-directory: web
        run: pnpm build
```

- [ ] **Step 6: Verify the stack in containers**

```bash
cd ~/Developer/puks-ai
PUKS_MOCK=1 docker compose up --build -d
sleep 25
curl -s localhost:8000/health
curl -s localhost:3000 | grep -c "Enterprise Speed WMS Intelligence"
docker compose down
```

Expected: `"ready": true, "mock": true`, and `1` from the grep.

- [ ] **Step 7: Commit**

```bash
git add api/Dockerfile web/Dockerfile web/next.config.ts docker-compose.yml .dockerignore .github/workflows/ci-cd.yml
git commit -m "build: dockerfiles, compose, and a web CI job

Compose runs both services locally. The Azure runbook is deliberately not
written here — resource names live in gitignored ENVIRONMENT.local.md and
README section 8 lists the target architecture as an open question."
```

---

## Task 17: Delete Streamlit and update the docs

**Files:**
- Delete: `APPLICATION(STREAMLIT)/`
- Modify: `requirements.txt`, `README.md`, `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: everything above, green
- Produces: a repo with one front end

Do this last. Until the Next.js app is proven under mock mode, the Streamlit app is the only record of intended behaviour.

- [ ] **Step 1: Confirm everything is green first**

```bash
cd ~/Developer/puks-ai
.venv/bin/pytest tests/ -q
(cd web && pnpm test && pnpm lint && pnpm build && pnpm e2e)
```

Expected: all green. **Do not proceed otherwise.**

- [ ] **Step 2: Delete**

```bash
git rm -r "APPLICATION(STREAMLIT)"
```

This removes `APP.py`, the dead `style/style.css`, the duplicate `requirements.txt`, `Pictures/`, and the 200-vector/768-dim orphan index README flags for deletion in four places.

- [ ] **Step 3: Drop streamlit from `requirements.txt`**

Replace the `# Core application` block:

```
# Core application
numpy>=1.23.0
```

(`streamlit>=1.31.0` is deleted. The API service adds fastapi/uvicorn through `api/requirements.txt`.)

- [ ] **Step 4: Update `README.md` §4**

Replace the run block:

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r api/requirements.txt

cp .env.example .env
az cognitiveservices account keys list \
  -g <resource-group> -n <foundry-resource> \
  --query key1 -o tsv                                   # paste into AZURE_AI_KEY

python SCRIPTS/build_index.py                           # ~1 min, one embedding pass

uvicorn api.main:app --port 8000 &                      # terminal 1
cd web && pnpm install && pnpm dev                      # terminal 2 → localhost:3000
```

Add beneath it:

```markdown
No key yet? `PUKS_MOCK=1 uvicorn api.main:app --port 8000` serves captured fixtures, so
the front end runs and its whole test suite passes without Azure access.
```

- [ ] **Step 5: Update `README.md` §3 and §8**

In §3, replace the `APPLICATION(STREAMLIT)/` rows with `api/` (FastAPI, SSE) and `web/` (Next.js). In §8, move "the Next.js front end replacing Streamlit" out of the remaining-work list and into "What changed", noting that the real-model path has not been executed and needs a key plus `build_index.py`.

- [ ] **Step 6: Update `docs/DEPLOYMENT.md`**

The file already carries a "Superseded — do not follow" warning. Extend that warning with one line:

```markdown
> It also describes the Streamlit front end, which was replaced by the Next.js app in
> `web/` and the FastAPI service in `api/`. See `docs/superpowers/specs/2026-08-21-nextjs-frontend-design.md`.
```

- [ ] **Step 7: Verify nothing still references the deleted app**

```bash
grep -rn "APPLICATION(STREAMLIT)\|streamlit run\|import streamlit" \
  --include="*.py" --include="*.md" --include="*.txt" --include="*.yml" . \
  | grep -v node_modules | grep -v "docs/superpowers" | grep -v "^./docs/DEPLOYMENT.md"
```

Expected: no output. Anything that appears must be fixed before committing.

- [ ] **Step 8: Full suite one more time, then commit**

```bash
.venv/bin/pytest tests/ -q && (cd web && pnpm test)
git add -A
git commit -m "feat: remove Streamlit, Next.js is the front end

Deletes APPLICATION(STREAMLIT)/ including the dead style.css that nothing
loaded and the 200-vector/768-dim orphan index. Drops streamlit from
requirements and repoints the README at api/ + web/.

The real-model path is unexecuted: this environment has no AZURE_AI_KEY
and the committed index is 384-dim. Everything here is verified under
PUKS_MOCK=1. Confirming against Foundry needs a key and a
SCRIPTS/build_index.py run."
```

---

## Verification summary

| Verified here | Not verified here |
|---|---|
| `format_memory` byte-parity with the Streamlit class | Any call to gpt-5, `text-embedding-3-large` or Cohere rerank |
| Refusal guard, refusal string, and the no-generation-on-refusal path | `build_index.py` against a real Foundry resource |
| `call_llm_stream` parameter set and `verbosity` retry, against a stub | Real streaming latency and time-to-first-token |
| SSE event order and refusal short-circuit | Whether `Corpus()` loads a correctly-built 3072-dim index |
| `/health` staying up when `Corpus()` raises | Azure deployment |
| The whole front end, end-to-end, under `PUKS_MOCK=1` | |

Report completion in exactly these terms. Do not claim the real-model path works.
