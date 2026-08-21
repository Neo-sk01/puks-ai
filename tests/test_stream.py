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
