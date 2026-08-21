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
