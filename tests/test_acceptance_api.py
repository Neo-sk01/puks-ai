"""The five /api/acceptance routes, on a temp database, in mock mode (no keys)."""
import json

import pytest
from fastapi.testclient import TestClient

import api.acceptance
from api.main import create_app


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("PUKS_MOCK", "1")
    monkeypatch.setenv("PUKS_ACCEPTANCE_DB", str(tmp_path / "acceptance.db"))
    with TestClient(create_app()) as c:
        yield c


def test_questions_are_grouped_in_sheet_order(client):
    body = client.get("/api/acceptance/questions").json()
    assert [g["key"] for g in body["groups"]] == list("ROLSMGDTXCN")
    first = body["groups"][0]
    assert first["title"] == "Receiving goods" and first["questions"][0]["id"] == "R1"
    assert sum(len(g["questions"]) for g in body["groups"]) == 65


def test_results_include_run_metadata_and_are_keyed_by_id(client, monkeypatch, tmp_path):
    run_meta = {
        "ran_at": "2026-01-01T00:00:00+00:00", "providers": {"chat": "mock"},
        "chat_deployment": "gpt-mock", "embed_deployment": "embed-mock",
        "rerank_model": "rerank-mock", "threshold": 0.75, "count": 1,
    }
    results = [{
        "id": "R1", "question": "q", "asked": ["q"], "answer": "a", "refused": False,
        "reason": None, "threshold": 0.75, "confidence": 0.9, "top_source": "x.txt",
        "top_category": "X", "sources": ["x.txt"], "elapsed_s": 1.2, "error": None,
    }]
    results_path, run_path = tmp_path / "results.json", tmp_path / "run.json"
    results_path.write_text(json.dumps(results))
    run_path.write_text(json.dumps(run_meta))
    monkeypatch.setattr(api.acceptance, "RESULTS", results_path)
    monkeypatch.setattr(api.acceptance, "RUN_META", run_path)

    body = client.get("/api/acceptance/results").json()
    assert body["run"] == run_meta
    assert "R1" in body["results"] and body["results"]["R1"]["answer"] == "a"


def test_results_route_with_missing_files(client, monkeypatch, tmp_path):
    monkeypatch.setattr(api.acceptance, "RESULTS", tmp_path / "no-results.json")
    monkeypatch.setattr(api.acceptance, "RUN_META", tmp_path / "no-run.json")

    assert client.get("/api/acceptance/results").json() == {"run": None, "results": {}}


def test_questions_route_with_missing_file(client, monkeypatch, tmp_path):
    monkeypatch.setattr(api.acceptance, "QUESTIONS", tmp_path / "no-questions.json")
    api.acceptance._questions.cache_clear()
    try:
        with pytest.raises(FileNotFoundError):
            client.get("/api/acceptance/questions")
    finally:
        api.acceptance._questions.cache_clear()


def test_verdict_round_trip(client):
    r = client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": "ok"})
    assert r.status_code == 200
    assert r.json()["verdict"] == "pass" and r.json()["tester"] == "neo"
    mine = client.get("/api/acceptance/verdicts", params={"tester": "neo"}).json()["verdicts"]
    assert mine == {"R1": {"verdict": "pass", "note": "ok", "updated_at": mine["R1"]["updated_at"]}}


def test_null_verdict_clears_the_row(client):
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    r = client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": None, "note": ""})
    assert r.status_code == 200 and r.json() == {"question_id": "R1", "tester": "neo", "verdict": None}
    assert client.get("/api/acceptance/verdicts", params={"tester": "Neo"}).json()["verdicts"] == {}


@pytest.mark.parametrize("payload,status", [
    ({"tester_name": "Neo", "verdict": "maybe", "note": ""}, 400),
    ({"tester_name": "", "verdict": "pass", "note": ""}, 400),
    ({"tester_name": "x" * 61, "verdict": "pass", "note": ""}, 400),
    ({"tester_name": "Neo", "verdict": "pass", "note": "n" * 501}, 400),
])
def test_validation_errors_are_400(client, payload, status):
    assert client.put("/api/acceptance/verdicts/R1", json=payload).status_code == status


def test_unknown_question_is_404(client):
    r = client.put("/api/acceptance/verdicts/Z9", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    assert r.status_code == 404


def test_verdicts_without_a_tester_is_400(client):
    assert client.get("/api/acceptance/verdicts").status_code in (400, 422)
    assert client.get("/api/acceptance/verdicts", params={"tester": "  "}).status_code == 400


def test_summary_covers_every_question(client):
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Neo", "verdict": "pass", "note": ""})
    client.put("/api/acceptance/verdicts/R1", json={"tester_name": "Thabo", "verdict": "fail", "note": ""})
    body = client.get("/api/acceptance/summary").json()
    assert len(body["questions"]) == 65
    assert body["questions"]["R1"]["disagreement"] is True
    assert body["totals"]["testers"] == 2 and body["totals"]["scored"] == 1


def test_routes_work_when_the_engine_is_not_ready(monkeypatch, tmp_path):
    """Scoring must not depend on the corpus or a model."""
    import puks_rag

    def boom():
        raise puks_rag.ConfigError("no index")

    monkeypatch.delenv("PUKS_MOCK", raising=False)
    monkeypatch.setenv("PUKS_ACCEPTANCE_DB", str(tmp_path / "acceptance.db"))
    monkeypatch.setattr(puks_rag, "Corpus", boom)
    with TestClient(create_app()) as c:
        assert c.get("/health").json()["ready"] is False
        assert c.get("/api/acceptance/questions").status_code == 200
        assert c.put("/api/acceptance/verdicts/R1",
                     json={"tester_name": "Neo", "verdict": "pass", "note": ""}).status_code == 200
