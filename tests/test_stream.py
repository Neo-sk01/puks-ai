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


class MidStreamTypeError:
    """A stream whose ITERATION raises TypeError after the first chunk.

    This is what distinguishes a try/except scoped to create() from one that
    also wraps the consumption loop. The latter would swallow this, call
    create() a second time, and replay the token already yielded.
    """

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self._position = 0

    def __iter__(self):
        return self

    def __next__(self):
        if self._position >= len(self._chunks):
            raise StopIteration
        chunk = self._chunks[self._position]
        self._position += 1
        if chunk is None:
            raise TypeError("raised during iteration, not from create()")
        return chunk


class MidStreamCompletions:
    def __init__(self, chunks):
        self._chunks = chunks
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return MidStreamTypeError(self._chunks)


def test_typeerror_during_iteration_propagates_instead_of_retrying(monkeypatch):
    """The retry must cover create() only.

    If the try block also wrapped the consumption loop, this TypeError would be
    caught, create() would run a second time, and "a" would be delivered twice.
    """
    client = StubClient([])
    client.chat.completions = MidStreamCompletions([Chunk("a"), None])
    monkeypatch.setattr(puks_rag, "get_client", lambda: client)

    emitted = []
    with pytest.raises(TypeError, match="during iteration"):
        for token in call_llm_stream("p", "s"):
            emitted.append(token)

    assert emitted == ["a"]                          # delivered once, not replayed
    assert len(client.chat.completions.calls) == 1   # no second create() — no retry


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
