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
    assert body["provider"] in ("azure", "openai")


def test_health_reports_the_provider(client):
    assert client.get("/health").json()["provider"] in ("azure", "openai")


def test_config_reports_a_provider_per_role(client):
    providers = client.get("/api/config").json()["providers"]
    assert set(providers) == {"chat", "embed", "rerank"}
    assert all(v in ("azure", "openai") for v in providers.values())


def test_config_reports_whether_rerank_is_configured(client, monkeypatch):
    """With AZURE_RERANK_ENDPOINT unset, cohere_rerank returns 0.0 scores,
    confidence reads that field, and the 0.30 gate refuses every query.
    The UI has to be able to say so. See spec section 10."""
    import puks_rag
    monkeypatch.setattr(puks_rag, "RERANK_ENDPOINT", "")
    assert client.get("/api/config").json()["rerank_configured"] is False
    monkeypatch.setattr(puks_rag, "RERANK_ENDPOINT", "https://x.services.ai.azure.com/models/v2/rerank")
    assert client.get("/api/config").json()["rerank_configured"] is True


def test_startup_survives_a_non_configerror_from_corpus(monkeypatch):
    """A corrupt index file raises RuntimeError, not ConfigError. Startup must
    still succeed — a crash-looping container is the failure this prevents."""
    import puks_rag
    from api.main import create_app

    def boom():
        raise RuntimeError("could not read index header")

    monkeypatch.delenv("PUKS_MOCK", raising=False)
    monkeypatch.setattr(puks_rag, "Corpus", boom)

    with TestClient(create_app()) as client:
        body = client.get("/health").json()

    assert body["ready"] is False
    assert "RuntimeError" in body["error"]        # type preserved for diagnosis
    assert "could not read index header" in body["error"]


def test_configerror_message_is_not_type_prefixed(monkeypatch):
    """The ConfigError text is written for a human and rendered verbatim in the
    UI banner — it must not gain a 'ConfigError: ' prefix."""
    import puks_rag
    from api.main import create_app

    def boom():
        raise puks_rag.ConfigError("Index is 384-dim but AZURE_EMBED_DIMENSIONS is 3072")

    monkeypatch.delenv("PUKS_MOCK", raising=False)
    monkeypatch.setattr(puks_rag, "Corpus", boom)

    with TestClient(create_app()) as client:
        body = client.get("/health").json()

    assert body["error"] == "Index is 384-dim but AZURE_EMBED_DIMENSIONS is 3072"
    assert not body["error"].startswith("ConfigError")


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


def test_neither_http_route_leaks_structured_data(client, monkeypatch):
    """structured_data is not uniformly shaped and has no stable wire type.
    puks_rag.answer() returns it; both HTTP routes must project it away."""
    from api import mock
    monkeypatch.setattr(mock, "TOKEN_DELAY_SECONDS", 0)

    def raw(corpus, query, memory_text="(No prior conversation)", top_k=5):
        return {
            "answer": "x", "confidence": 0.9, "intent": {}, "refused": False,
            "retrieved": [{
                "index": 1, "fusion_score": 0.01, "in_dense": True, "in_bm25": False,
                "in_exact": False, "doc_type": "TEXT", "relevance_score": 0.9,
                "metadata": {}, "text": "t",
                "structured_data": {"procedures": ["leak"]},
            }],
        }

    monkeypatch.setattr(mock, "answer", raw)
    body = client.post("/api/answer", json={"message": "grn"}).json()
    assert body["retrieved"], "fixture must not be empty or the assertion is vacuous"
    for chunk in body["retrieved"]:
        assert "structured_data" not in chunk

    events = parse_sse(client.post("/api/chat", json={"message": "grn"}).text)
    for chunk in events[0][1]["chunks"]:
        assert "structured_data" not in chunk
