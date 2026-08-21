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
