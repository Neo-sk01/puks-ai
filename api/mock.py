"""Fixture-backed engine for PUKS_MOCK=1.

There is no AZURE_AI_KEY in development and the committed index is the wrong
dimension, so the front end would otherwise be unbuildable. This serves captured
results in the exact shape puks_rag produces, streamed word by word.

It deliberately reuses puks_rag.REFUSAL_TEXT and CONFIDENCE_THRESHOLD rather
than restating them — a mock that drifts from the real contract is worse than
no mock.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from puks_rag import CHAT_DEPLOYMENT, CONFIDENCE_THRESHOLD, REFUSAL_TEXT, TOP_K_DEFAULT

FIXTURES           = Path(__file__).resolve().parent / "fixtures"
TOKEN_DELAY_SECONDS = 0.012


class MockCorpus:
    """A stand-in for Corpus in mock mode.

    NOT an interface match for the real Corpus, which exposes .index, .config,
    .chunks, .bm25 and .exact_name_hits() and has none of these attributes.
    These three exist only so Engine.info() can report index facts uniformly:
    it reads them here, and reads .index.d / .index.ntotal / .config on the
    real object. Nothing else may assume these attributes exist on a Corpus.
    """
    ntotal    = 627
    dimension = 3072
    model     = "mock"


def _load() -> list[dict]:
    return [json.loads(path.read_text(encoding="utf-8"))
            for path in sorted(FIXTURES.glob("*.json"))]


def _select(query: str) -> dict:
    """First fixture whose `match` string appears in the query; else the refusal."""
    fixtures = _load()
    lowered  = query.lower()
    for fixture in fixtures:
        if fixture["match"] and fixture["match"] in lowered:
            return fixture
    return next(f for f in fixtures if not f["match"])


def _tokenise(text: str) -> list[str]:
    """Split into word-plus-whitespace pieces so streaming looks like generation."""
    return re.findall(r"\S+\s*", text)


def answer(corpus, query: str, memory_text: str = "(No prior conversation)",
           top_k: int = TOP_K_DEFAULT) -> dict:
    fixture = _select(query)
    refused = fixture["answer"] is None
    return {
        "answer":     REFUSAL_TEXT if refused else fixture["answer"],
        "retrieved":  fixture["chunks"][:top_k],
        "confidence": fixture["confidence"],
        "intent":     fixture["intent"],
        "refused":    refused,
    }


def answer_stream(corpus, query: str, memory_text: str = "(No prior conversation)",
                  top_k: int = TOP_K_DEFAULT):
    fixture = _select(query)
    refused = fixture["answer"] is None

    yield "retrieved", {
        "chunks":     fixture["chunks"][:top_k],
        "confidence": fixture["confidence"],
        "intent":     fixture["intent"],
    }

    if refused:
        yield "done", {
            "refused":    True,
            "reason":     "below_threshold",
            "confidence": fixture["confidence"],
            "threshold":  CONFIDENCE_THRESHOLD,
        }
        return

    for token in _tokenise(fixture["answer"]):
        if TOKEN_DELAY_SECONDS:
            time.sleep(TOKEN_DELAY_SECONDS)
        yield "token", {"text": token}

    yield "done", {"refused": False, "model": f"{CHAT_DEPLOYMENT} (mock)"}
