"""The runner and the HTML builder both read docs/acceptance-questions.json."""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "SCRIPTS" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_runner_loads_questions_from_json():
    runner = load("run_acceptance")
    qs = runner.load_questions()
    assert len(qs) == 65
    assert qs[0]["id"] == "R1" and qs[0]["asked"] == [qs[0]["question"]]
    c1 = next(q for q in qs if q["id"] == "C1")
    assert len(c1["asked"]) == 2


def test_run_metadata_records_what_the_summary_needs():
    runner = load("run_acceptance")
    meta = runner.run_metadata(
        {"providers": {"chat": "azure", "embed": "azure", "rerank": "azure"},
         "chat_deployment": "gpt-5", "embed_deployment": "text-embedding-3-large",
         "rerank_model": "Cohere-rerank-v4.0-pro", "confidence_threshold": 0.75},
        count=65,
    )
    assert meta["providers"]["rerank"] == "azure"
    assert meta["threshold"] == 0.75 and meta["count"] == 65
    assert meta["ran_at"].endswith("+00:00") or meta["ran_at"].endswith("Z")
