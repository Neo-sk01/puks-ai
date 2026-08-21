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
