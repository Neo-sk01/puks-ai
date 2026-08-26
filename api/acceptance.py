"""/api/acceptance — the acceptance set, its recorded results, and testers'
verdicts. Needs neither the corpus nor a model: scoring must work when the
engine is not ready and in PUKS_MOCK=1."""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from api.acceptance_store import VERDICTS, Store, normalise_tester

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = ROOT / "docs" / "acceptance-questions.json"
RESULTS = ROOT / "docs" / "acceptance-results.json"
RUN_META = ROOT / "docs" / "acceptance-run.json"
GROUP_ORDER = "ROLSMGDTXCN"
NAME_MAX, NOTE_MAX = 60, 500

router = APIRouter(prefix="/api/acceptance", tags=["acceptance"])


def _store() -> Store:
    return Store(Path(os.getenv("PUKS_ACCEPTANCE_DB") or ROOT / "var" / "acceptance.db"))


@lru_cache(maxsize=1)
def _questions() -> list[dict]:
    return json.loads(QUESTIONS.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _question_ids() -> frozenset[str]:
    return frozenset(q["id"] for q in _questions())


class VerdictIn(BaseModel):
    tester_name: str
    verdict: str | None
    note: str = ""


@router.get("/questions")
def questions() -> dict:
    groups: dict[str, dict] = {}
    for q in _questions():
        g = groups.setdefault(q["group"], {"key": q["group"], "title": q["group_title"],
                                           "note": q["group_note"], "questions": []})
        g["questions"].append({k: q[k] for k in ("id", "question", "asked", "must_contain", "source", "kind")})
    return {"groups": [groups[k] for k in GROUP_ORDER if k in groups]}


@router.get("/results")
def results() -> dict:
    run = json.loads(RUN_META.read_text(encoding="utf-8")) if RUN_META.exists() else None
    rows = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else []
    return {"run": run, "results": {r["id"]: r for r in rows}}


@router.get("/verdicts")
def verdicts(tester: str = Query(...)) -> dict:
    if not normalise_tester(tester):
        raise HTTPException(status_code=400, detail="tester is required")
    return {"verdicts": _store().for_tester(tester)}


@router.put("/verdicts/{question_id}")
def put_verdict(question_id: str, body: VerdictIn) -> dict:
    if question_id not in _question_ids():
        raise HTTPException(status_code=404, detail=f"unknown question {question_id}")
    name = body.tester_name.strip()
    if not name or len(name) > NAME_MAX:
        raise HTTPException(status_code=400, detail=f"tester_name must be 1-{NAME_MAX} characters")
    if len(body.note or "") > NOTE_MAX:
        raise HTTPException(status_code=400, detail=f"note must be at most {NOTE_MAX} characters")
    store = _store()
    if body.verdict is None:
        store.delete(question_id, name)
        return {"question_id": question_id, "tester": normalise_tester(name), "verdict": None}
    if body.verdict not in VERDICTS:
        raise HTTPException(status_code=400, detail=f"verdict must be one of {list(VERDICTS)} or null")
    return store.upsert(question_id, name, body.verdict, body.note or "")


@router.get("/summary")
def summary() -> dict:
    return _store().summary([q["id"] for q in _questions()])
