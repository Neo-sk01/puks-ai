"""Owns the one expensive object in the process: the loaded Corpus.

Loaded once at startup, the equivalent of Streamlit's @st.cache_resource.

A ConfigError is CAPTURED, not raised. The committed index is 384-dim against a
3072-dim requirement, so Corpus() raises today; a service that crash-loops on
that is strictly worse than one that stays up and explains itself through
/health. Streamlit rendered st.error() and stopped — this is the same idea at
the service level.
"""
from __future__ import annotations

import os

import puks_rag


def mock_enabled() -> bool:
    return os.getenv("PUKS_MOCK", "").strip().lower() in {"1", "true", "yes"}


class Engine:
    def __init__(self) -> None:
        self.mock:   bool = mock_enabled()
        self.corpus       = None
        self.error: str | None = None

        if self.mock:
            from api import mock
            self._impl  = mock
            self.corpus = mock.MockCorpus()
            return

        self._impl = puks_rag
        try:
            self.corpus = puks_rag.Corpus()
        except puks_rag.ConfigError as exc:
            # The expected failure: a missing, stale or mismatched index.
            self.error = str(exc)
        except Exception as exc:  # noqa: BLE001
            # Everything else Corpus() can raise — a corrupt FAISS file
            # (RuntimeError), malformed config.json or metadata.json
            # (JSONDecodeError), a bad legacy pickle. Startup must survive
            # these too, or the container crash-loops on a bad data mount,
            # which is the outcome this whole design exists to prevent.
            # The class name is kept so a genuine programming error stays
            # diagnosable through /health instead of looking like bad data.
            self.error = f"{type(exc).__name__}: {exc}"

    @property
    def ready(self) -> bool:
        return self.corpus is not None

    def answer(self, query: str, memory_text: str, top_k: int) -> dict:
        return self._impl.answer(self.corpus, query, memory_text=memory_text, top_k=top_k)

    def answer_stream(self, query: str, memory_text: str, top_k: int):
        return self._impl.answer_stream(self.corpus, query, memory_text=memory_text, top_k=top_k)

    def info(self) -> dict:
        """Index facts for /health. Never raises."""
        if not self.ready:
            return {"dimension": None, "ntotal": None, "model": None}
        if self.mock:
            return {"dimension": self.corpus.dimension,
                    "ntotal":    self.corpus.ntotal,
                    "model":     self.corpus.model}
        return {
            "dimension": self.corpus.index.d,
            "ntotal":    self.corpus.index.ntotal,
            "model":     self.corpus.config.get("model_name"),
        }
