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


# --- query expansion (C3: "how to close a grn" retrieved the Jinko ticket) ---

@pytest.mark.parametrize("query,expected", [
    ("how to close a grn", "how to close a receipt"),
    ("GRN closure steps", "receipt closure steps"),
    ("weights missing on the GDN", "weights missing on the delivery note"),
    ("LPNs missing on manifest", "supports missing on manifest"),
    ("create an MO", "create an manufacturing order"),
])
def test_expand_query_substitutes_corpus_vocabulary_for_abbreviations(query, expected):
    """Substitution, not appending: the reranker otherwise still prefers the
    one ticket whose title literally says GRN over 'Receipt closure'."""
    import puks_rag
    assert puks_rag.expand_query(query) == expected


def test_expand_query_leaves_plain_questions_untouched():
    import puks_rag
    q = "How do I close a receipt?"
    assert puks_rag.expand_query(q) == q


def test_expand_query_does_not_match_inside_words():
    import puks_rag
    assert puks_rag.expand_query("the program ran") == "the program ran"   # 'gram' is not 'grn', 'ran' not 'lpn'


# --- unanchored follow-ups (C5: answered after a memory reset) ---

@pytest.mark.parametrize("query", [
    "and which of those fields can I change?",
    "What about its foreign keys?",
    "and the other one?",
    "same for orders",
])
def test_unanchored_followup_detected_when_there_is_no_history(query):
    import puks_rag
    assert puks_rag.is_unanchored_followup(query, "(No prior conversation)")


def test_followup_is_fine_when_history_exists():
    import puks_rag
    assert not puks_rag.is_unanchored_followup(
        "and which of those fields can I change?", "USER: How do I create a receipt header?")


@pytest.mark.parametrize("query", [
    "How do I close a receipt?",
    "What is the status of a support after reception?",
    "stk_dat vs mvt_dat",
])
def test_plain_questions_are_not_followups(query):
    import puks_rag
    assert not puks_rag.is_unanchored_followup(query, "(No prior conversation)")


def test_answer_asks_for_context_instead_of_retrieving(corpus, retrieval_must_not_run):
    import puks_rag
    result = puks_rag.answer(corpus, "and which of those fields can I change?")
    assert result["refused"] is False
    assert result["retrieved"] == []
    assert "which" in result["answer"].lower() or "what" in result["answer"].lower()


def test_answer_stream_asks_for_context_then_done(corpus, retrieval_must_not_run):
    import puks_rag
    events = list(puks_rag.answer_stream(corpus, "what about its foreign keys?"))
    assert [k for k, _ in events][-1] == "done"
    assert events[-1][1]["reason"] == "needs_context"
    assert events[-1][1]["refused"] is False
