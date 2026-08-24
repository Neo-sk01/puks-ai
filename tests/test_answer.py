import pytest
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


# --- self-description guard -------------------------------------------------

@pytest.fixture
def retrieval_must_not_run(monkeypatch):
    import puks_rag

    def boom(*args, **kwargs):
        raise AssertionError("retrieve_context must not be called for a self-description question")

    monkeypatch.setattr(puks_rag, "retrieve_context", boom)


@pytest.mark.parametrize("query", [
    "What are your capabilities?",
    "what can you do",
    "Who are you?",
    "what do you know about?",
    "help",
])
def test_is_self_description_matches_meta_questions(query):
    import puks_rag
    assert puks_rag.is_self_description(query)


@pytest.mark.parametrize("query", [
    "What can I do once a receipt is closed?",
    "Who is the carrier on load 123?",
    "What are the capabilities of the ZPA replenishment module?",
    "help me reverse a GRN",
])
def test_is_self_description_leaves_corpus_questions_alone(query):
    import puks_rag
    assert not puks_rag.is_self_description(query)


def test_answer_describes_itself_without_retrieving(corpus, retrieval_must_not_run):
    import puks_rag
    result = puks_rag.answer(corpus, "What are your capabilities?")
    assert result["refused"] is False
    assert result["retrieved"] == []
    assert "Speed WMS" in result["answer"]
    assert "cannot" in result["answer"].lower()


def test_answer_stream_describes_itself_as_tokens_then_done(corpus, retrieval_must_not_run):
    import puks_rag
    events = list(puks_rag.answer_stream(corpus, "who are you?"))
    kinds = [kind for kind, _ in events]
    assert "retrieved" not in kinds
    assert kinds[-1] == "done"
    assert all(kind == "token" for kind in kinds[:-1]) and kinds[:-1]
    done = events[-1][1]
    assert done["refused"] is False
    assert done["reason"] == "self_description"
    text = "".join(payload["text"] for kind, payload in events if kind == "token")
    assert "Speed WMS" in text


def test_self_description_lists_the_corpus_areas():
    import puks_rag

    class C:
        chunks = [
            {"metadata": {"category": "RECEIVING GOODS"}},
            {"metadata": {"category": "RECEIVING GOODS"}},
            {"metadata": {"category": "LOADING"}},
        ]

    text = puks_rag.self_description(C())
    assert "Receiving goods" in text
    assert "Loading" in text
