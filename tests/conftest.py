"""Fixtures that let the whole suite run with no Azure access.

Nothing here touches FAISS, the network, or a real key. `retrieve_context`
is monkeypatched wholesale because retrieval is out of scope for this work —
these tests cover the guard, the prompt assembly and the streaming contract.
"""
import pytest


def make_chunk(index: int = 0, relevance: float = 0.9, **overrides) -> dict:
    """A chunk shaped exactly as retrieve_context produces one."""
    chunk = {
        "index":           index,
        "fusion_score":    0.0163,
        "in_dense":        True,
        "in_bm25":         False,
        "in_exact":        False,
        "doc_type":        "OPERATIONAL_REFERENCE",
        "text":            "To reverse a GRN, validate the receipt first.",
        "metadata":        {"source": "receiving.pdf", "category": "RECEIVING GOODS",
                            "table_name": "REE_DAT", "chunk_type": "wms_procedure"},
        "structured_data": {"procedure_name": "Reverse GRN", "steps": ["validate", "update"]},
        "relevance_score": relevance,
    }
    chunk.update(overrides)
    return chunk


class FakeCorpus:
    """Stands in for Corpus. Never loaded, never searched — retrieve_context is patched."""


@pytest.fixture
def corpus():
    return FakeCorpus()


@pytest.fixture
def high_confidence(monkeypatch):
    """retrieve_context returns one strong hit."""
    import puks_rag
    chunks = [make_chunk(relevance=0.87)]
    monkeypatch.setattr(puks_rag, "retrieve_context",
                        lambda corpus, query, top_k=5: (chunks, 0.87))
    return chunks


@pytest.fixture
def low_confidence(monkeypatch):
    """retrieve_context returns a hit below CONFIDENCE_THRESHOLD."""
    import puks_rag
    chunks = [make_chunk(relevance=0.11)]
    monkeypatch.setattr(puks_rag, "retrieve_context",
                        lambda corpus, query, top_k=5: (chunks, 0.11))
    return chunks
